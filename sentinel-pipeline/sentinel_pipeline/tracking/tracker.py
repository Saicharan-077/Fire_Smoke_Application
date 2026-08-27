"""
Shared object tracking layer.

ONE tracker, two internal consumers:

  * the Classifier's Motion and Flicker phases need a ``track_id`` linking
    detections of the same object across frames, plus a rolling history of
    timestamped crops (up to 30-60 frames for Flicker);
  * the Context Engine needs the same track continuity for growth-rate and
    duration maths.

Provenance: this is the ByteTrack-style tracker already present in the existing
application (``detection_layer.ByteTracker``), moved here and extended. It is
NOT a second implementation -- the original is superseded, not duplicated.

Two-stage association is kept from the original because it suits this domain:
flame flicker and smoke occlusion routinely drop a detection's confidence for a
frame or two, and the low-confidence recovery pass reclaims those tracks
instead of fragmenting them into new IDs.

Deliberately NOT using ultralytics' BYTETracker: its Kalman filter models rigid
linear motion, which fits vehicles and people but fits a growing, deforming
smoke plume poorly.

What is new here versus the original:
  * per-track rolling crop history (the Flicker phase's actual requirement)
  * padded RGB + grayscale crop extraction at the tracking boundary
  * track age / duration, for the Context Engine
  * no confidence mutation -- the original overwrote detection confidence with
    an EMA-smoothed value, which silently changed what downstream stages saw.
    Smoothing is exposed separately as ``smoothed_confidence`` instead.
"""

from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass, field

import cv2
import numpy as np

from ..config import TrackingSettings, settings as global_settings
from ..contracts import (
    BBox,
    ClassifierInput,
    CropSnapshot,
    ModelCandidate,
    RawClass,
    freeze,
)

logger = logging.getLogger("sentinel.tracking")


@dataclass(frozen=True, slots=True)
class ExtractedCrop:
    rgb: np.ndarray
    grayscale: np.ndarray
    origin: tuple[int, int]
    padding_applied: tuple[int, int, int, int]  # left, top, right, bottom
    scale: float


def extract_crops(
    frame: np.ndarray, bbox: BBox, padding_ratio: float, max_edge: int = 0
) -> ExtractedCrop:
    """Cut a padded crop out of a BGR frame.

    ``origin`` is the padded crop's top-left in full-frame coordinates, so a
    consumer can map the tight bbox back into crop-local coordinates.

    Padding exists because optical-flow and texture analysis need surrounding
    context; a crop cut exactly to the box has no background to compare against.
    It is clipped where the candidate touches a frame edge, so
    ``padding_applied`` reports what was ACTUALLY applied per side -- Phase 2's
    border-exclusion strip has to be sized per side, not assumed uniform.

    ``max_edge`` of 0 disables downscaling. Pass 0 for the current-frame crop
    that Phases 1 and 2 consume: those apply absolute pixel-count and
    blob-size guards, so a silently rescaled crop makes them measure the wrong
    thing. Downscaling is for stored history only, where the memory saving is
    real (~7.3 GB vs ~566 MB across a 16-camera fleet).
    """
    h, w = frame.shape[:2]
    pad_x = int(round(bbox.width * padding_ratio))
    pad_y = int(round(bbox.height * padding_ratio))

    x1 = max(0, bbox.x1 - pad_x)
    y1 = max(0, bbox.y1 - pad_y)
    x2 = min(w, bbox.x2 + pad_x)
    y2 = min(h, bbox.y2 + pad_y)

    applied = (bbox.x1 - x1, bbox.y1 - y1, x2 - bbox.x2, y2 - bbox.y2)

    if x2 <= x1 or y2 <= y1:
        return ExtractedCrop(
            rgb=np.zeros((1, 1, 3), dtype=np.uint8),
            grayscale=np.zeros((1, 1), dtype=np.uint8),
            origin=(x1, y1),
            padding_applied=(0, 0, 0, 0),
            scale=1.0,
        )

    crop_bgr = frame[y1:y2, x1:x2]
    scale = 1.0

    if max_edge and max(crop_bgr.shape[:2]) > max_edge:
        scale = max_edge / float(max(crop_bgr.shape[:2]))
        crop_bgr = cv2.resize(
            crop_bgr,
            (max(1, int(crop_bgr.shape[1] * scale)), max(1, int(crop_bgr.shape[0] * scale))),
            interpolation=cv2.INTER_AREA,
        )

    # The contract specifies RGB. OpenCV is BGR natively; convert once, here.
    return ExtractedCrop(
        rgb=cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB),
        grayscale=cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY),
        origin=(x1, y1),
        padding_applied=applied,
        scale=scale,
    )


@dataclass(slots=True)
class MotionEpoch:
    """A fixed observation window for Phase 3's optical flow.

    Position AND size are frozen for the epoch's lifetime, so every motion crop
    within it is dimensionally identical and cut from the same world
    coordinates. Flow between two same-epoch crops is true world displacement.

    `scale` is computed once here and never per frame: a frame-varying scale
    would distort displacement by an unknown factor, which is exactly what
    Phase 3 measures.
    """

    epoch_id: int
    origin: tuple[int, int]        # top-left in FULL-FRAME coordinates
    size: tuple[int, int]          # (width, height) in world pixels
    scale: float                   # constant downscale applied to stored crops

    @property
    def scaled_size(self) -> tuple[int, int]:
        return (
            max(1, int(round(self.size[0] * self.scale))),
            max(1, int(round(self.size[1] * self.scale))),
        )

    def contains(self, bbox: BBox) -> bool:
        x, y = self.origin
        w, h = self.size
        return (
            bbox.x1 >= x and bbox.y1 >= y
            and bbox.x2 <= x + w and bbox.y2 <= y + h
        )


def build_epoch(
    epoch_id: int, bbox: BBox, padding_ratio: float, expansion: float,
    frame_w: int, frame_h: int, max_edge: int,
) -> MotionEpoch:
    """Anchor a fixed observation window around a candidate.

    Sized from the padded bbox times `expansion`, so the object has room to
    move inside a STATIONARY window. The window deliberately does not follow
    the object: a window that tracked the centroid would cancel out exactly the
    linear motion Phase 3 uses to identify rigid objects, and a vehicle would
    read as motionless.
    """
    pad_x = int(round(bbox.width * padding_ratio))
    pad_y = int(round(bbox.height * padding_ratio))
    w = int(round((bbox.width + 2 * pad_x) * expansion))
    h = int(round((bbox.height + 2 * pad_y) * expansion))
    w = max(8, min(w, frame_w))
    h = max(8, min(h, frame_h))

    cx, cy = bbox.centroid
    x = int(round(cx - w / 2.0))
    y = int(round(cy - h / 2.0))
    # Keep the window inside the frame so every crop is full-size without
    # synthetic padding, which would otherwise inject fake edges into the flow.
    x = max(0, min(x, frame_w - w))
    y = max(0, min(y, frame_h - h))

    scale = 1.0
    if max_edge and max(w, h) > max_edge:
        scale = max_edge / float(max(w, h))

    return MotionEpoch(epoch_id=epoch_id, origin=(x, y), size=(w, h), scale=scale)


def extract_motion_crop(frame: np.ndarray, epoch: MotionEpoch) -> np.ndarray:
    """Cut the epoch's fixed window as grayscale, at the epoch's fixed scale.

    Output dimensions are identical for every call within an epoch, which is
    Farneback's precondition.
    """
    x, y = epoch.origin
    w, h = epoch.size
    fh, fw = frame.shape[:2]
    x2, y2 = min(fw, x + w), min(fh, y + h)
    win = frame[y:y2, x:x2]

    # Only if the frame itself is smaller than the window (very small sources).
    if win.shape[0] != h or win.shape[1] != w:
        padded = np.zeros((h, w, frame.shape[2]) if frame.ndim == 3 else (h, w), frame.dtype)
        padded[: win.shape[0], : win.shape[1]] = win
        win = padded

    gray = cv2.cvtColor(win, cv2.COLOR_BGR2GRAY) if win.ndim == 3 else win
    if epoch.scale != 1.0:
        sw, sh = epoch.scaled_size
        gray = cv2.resize(gray, (sw, sh), interpolation=cv2.INTER_AREA)
    return gray


@dataclass
class Track:
    """One tracked object and its rolling crop history."""

    track_id: int
    camera_id: str
    class_raw: RawClass
    bbox: BBox
    confidence: float
    smoothed_confidence: float
    first_seen_monotonic: float
    last_seen_monotonic: float
    age: int = 0          # frames since last matched
    hits: int = 1         # total frames matched
    history: deque[CropSnapshot] = field(default_factory=deque)
    epoch: MotionEpoch | None = None
    _next_epoch_id: int = 1

    @property
    def duration_s(self) -> float:
        return max(0.0, self.last_seen_monotonic - self.first_seen_monotonic)

    def area_series(self) -> list[tuple[float, int]]:
        """(monotonic_ts, bbox area) over history — the Context Engine's growth input."""
        return [(s.monotonic_ts, s.bbox.area) for s in self.history]

    def history_span_s(self) -> float:
        if len(self.history) < 2:
            return 0.0
        return self.history[-1].monotonic_ts - self.history[0].monotonic_ts

    def history_rate_hz(self) -> float:
        span = self.history_span_s()
        if span <= 0 or len(self.history) < 2:
            return 0.0
        return (len(self.history) - 1) / span

    def prune_history(self, window_s: float, max_samples: int) -> None:
        """Evict by TIMESTAMP, not by count (G6).

        A frame-count cap cannot express "1-2 seconds" -- 60 frames is 2s at
        30fps and 15s at 4fps. Duration-bounding makes the window mean the same
        thing at any rate, including a variable or dropping one.
        """
        if not self.history:
            return
        newest = self.history[-1].monotonic_ts
        while self.history and (newest - self.history[0].monotonic_ts) > window_s:
            self.history.popleft()
        # Safety valve only, for a source far faster than expected.
        while len(self.history) > max_samples:
            self.history.popleft()


class TrackingLayer:
    """Per-camera multi-object tracking with crop history."""

    def __init__(self, cfg: TrackingSettings | None = None):
        self._cfg = cfg or global_settings.tracking
        self._tracks: dict[str, dict[int, Track]] = {}
        self._next_id = 1

    # -- association -------------------------------------------------------

    def _match(
        self, candidates: list[ModelCandidate], tracks: dict[int, Track], unmatched: set[int]
    ) -> list[tuple[ModelCandidate, int]]:
        """Greedy IoU matching, best-IoU-first, same class only."""
        pairs: list[tuple[float, int, int]] = []
        for ci, cand in enumerate(candidates):
            for tid in unmatched:
                tr = tracks[tid]
                if tr.class_raw is not cand.class_raw:
                    continue
                iou = cand.bbox.iou(tr.bbox)
                if iou >= self._cfg.iou_threshold:
                    pairs.append((iou, ci, tid))

        pairs.sort(reverse=True)
        used_c: set[int] = set()
        used_t: set[int] = set()
        out: list[tuple[ModelCandidate, int]] = []
        for _iou, ci, tid in pairs:
            if ci in used_c or tid in used_t:
                continue
            used_c.add(ci)
            used_t.add(tid)
            out.append((candidates[ci], tid))
        return out

    def update(
        self, camera_id: str, frame: np.ndarray, candidates: list[ModelCandidate]
    ) -> list[ClassifierInput]:
        """Associate candidates with tracks, update history, build Classifier inputs."""
        cfg = self._cfg
        tracks = self._tracks.setdefault(camera_id, {})

        # Age every track; drop the stale ones.
        for tid in list(tracks.keys()):
            tracks[tid].age += 1
            if tracks[tid].age > cfg.max_age:
                del tracks[tid]

        high = [c for c in candidates if c.confidence_raw >= cfg.high_threshold]
        low = [
            c for c in candidates
            if cfg.low_threshold <= c.confidence_raw < cfg.high_threshold
        ]

        unmatched = set(tracks.keys())
        matched: list[tuple[ModelCandidate, int]] = []

        # Stage 1 — high-confidence association.
        for cand, tid in self._match(high, tracks, unmatched):
            unmatched.discard(tid)
            matched.append((cand, tid))

        # Stage 2 — recover tracks with low-confidence detections. This is what
        # keeps a flickering flame on one track ID instead of fragmenting it.
        for cand, tid in self._match(low, tracks, unmatched):
            unmatched.discard(tid)
            matched.append((cand, tid))

        matched_candidates = {id(c) for c, _ in matched}

        # Stage 3 — new tracks from EVERY unmatched candidate, including
        # low-confidence ones.
        #
        # Textbook ByteTrack initialises new tracks only from high-confidence
        # detections, because its goal is stable identities and a spurious
        # track is worse than a missed one. That trade is wrong here: the Model
        # runs at a deliberately low floor (0.20) for recall, and the Classifier
        # is the stage that decides precision. Initialising only from >=0.35
        # would silently discard every 0.20-0.35 candidate that isn't already
        # tracked -- reinstating a recall filter upstream of the Classifier,
        # which is the exact anti-pattern this pipeline exists to remove.
        for cand in candidates:
            if id(cand) not in matched_candidates:
                tid = self._next_id
                self._next_id += 1
                tracks[tid] = Track(
                    track_id=tid,
                    camera_id=camera_id,
                    class_raw=cand.class_raw,
                    bbox=cand.bbox,
                    confidence=cand.confidence_raw,
                    smoothed_confidence=cand.confidence_raw,
                    first_seen_monotonic=cand.monotonic_ts,
                    last_seen_monotonic=cand.monotonic_ts,
                    # No maxlen: the bound is DURATION, applied in
                    # prune_history(). A maxlen here would silently reimpose a
                    # frame-count cap and defeat G6.
                    history=deque(),
                )
                matched.append((cand, tid))

        # Update state and build the Classifier handoff.
        outputs: list[ClassifierInput] = []
        h, w = frame.shape[:2]

        for cand, tid in matched:
            tr = tracks.get(tid)
            if tr is None:
                continue

            is_new = tr.hits == 1 and tr.age == 0 and not tr.history
            tr.bbox = cand.bbox
            tr.confidence = cand.confidence_raw
            tr.smoothed_confidence = round(
                0.6 * cand.confidence_raw + 0.4 * tr.smoothed_confidence, 4
            )
            tr.last_seen_monotonic = cand.monotonic_ts
            tr.age = 0
            if not is_new:
                tr.hits += 1

            # Two extractions with different purposes:
            #  - `live` is NATIVE resolution, for Phases 1-2's absolute
            #    pixel-count and blob-size guards. Transient, ~2.5 MB worst case.
            #  - `stored` is capped, because 60 of these per track is what
            #    actually costs memory.
            live = extract_crops(frame, cand.bbox, cfg.crop_padding_ratio, max_edge=0)
            if cfg.max_crop_edge and max(live.rgb.shape[:2]) > cfg.max_crop_edge:
                stored = extract_crops(
                    frame, cand.bbox, cfg.crop_padding_ratio, cfg.max_crop_edge
                )
            else:
                stored = live

            freeze(live.rgb)
            freeze(live.grayscale)
            if stored is not live:
                freeze(stored.rgb)
                freeze(stored.grayscale)

            # --- G4: canonical motion window ---------------------------------
            motion_crop = None
            if cfg.motion_window_enabled:
                need_new = tr.epoch is None or not tr.epoch.contains(cand.bbox)
                if need_new:
                    # RE-ANCHOR policy (documented, never silent): when the
                    # candidate no longer fits the frozen window -- because it
                    # grew, or moved out -- a NEW epoch is opened around the
                    # current bbox. Crops from the old epoch are kept in
                    # history but carry the old epoch id, and Phase 3 must not
                    # flow-compare across the boundary. Clipping instead would
                    # silently truncate a growing fire, which is the failure
                    # mode this pipeline exists to avoid.
                    if tr.epoch is not None:
                        logger.debug(
                            "[Tracking] track=%s re-anchoring motion window "
                            "%s -> epoch %d (bbox %dx%d no longer fits %s)",
                            tid, tr.epoch.size, tr._next_epoch_id,
                            cand.bbox.width, cand.bbox.height, tr.epoch.size,
                        )
                    tr.epoch = build_epoch(
                        tr._next_epoch_id, cand.bbox, cfg.crop_padding_ratio,
                        cfg.motion_window_expansion, w, h, cfg.motion_window_max_edge,
                    )
                    tr._next_epoch_id += 1
                motion_crop = freeze(extract_motion_crop(frame, tr.epoch))

            prev_bbox = tr.history[-1].bbox if tr.history else None
            snapshot = CropSnapshot(
                timestamp=cand.timestamp,
                monotonic_ts=cand.monotonic_ts,
                bbox=cand.bbox,
                crop_rgb=stored.rgb,
                crop_grayscale=stored.grayscale,
                confidence_raw=cand.confidence_raw,
                crop_scale=stored.scale,
                match_iou=(cand.bbox.iou(prev_bbox) if prev_bbox is not None else None),
                motion_crop=motion_crop,
                motion_window_origin=tr.epoch.origin if tr.epoch else (0, 0),
                motion_window_size=tr.epoch.scaled_size if tr.epoch else (0, 0),
                motion_epoch=tr.epoch.epoch_id if tr.epoch else 0,
                motion_scale=tr.epoch.scale if tr.epoch else 1.0,
            )
            tr.history.append(snapshot)
            # G6: duration-bounded, not frame-count-bounded.
            tr.prune_history(cfg.history_window_s, cfg.history_max_samples)

            cand.track_id = tid

            outputs.append(
                ClassifierInput(
                    track_id=tid,
                    camera_id=camera_id,
                    timestamp=cand.timestamp,
                    monotonic_ts=cand.monotonic_ts,
                    bbox=cand.bbox,
                    cropped_frame_rgb=live.rgb,
                    cropped_frame_grayscale=live.grayscale,
                    class_raw=cand.class_raw,
                    confidence_raw=cand.confidence_raw,
                    history=tuple(tr.history),
                    crop_origin=live.origin,
                    crop_padding_ratio=cfg.crop_padding_ratio,
                    frame_size=(w, h),
                    track_age_frames=tr.hits,
                    track_duration_s=tr.duration_s,
                    padding_applied=live.padding_applied,
                    crop_scale=live.scale,
                    history_window_s=cfg.history_window_s,
                    history_span_s=tr.history_span_s(),
                    history_sample_rate_hz=tr.history_rate_hz(),
                    motion_epoch=tr.epoch.epoch_id if tr.epoch else 0,
                )
            )

        return outputs

    # -- accessors for the Context Engine ----------------------------------

    def get_track(self, camera_id: str, track_id: int) -> Track | None:
        return self._tracks.get(camera_id, {}).get(track_id)

    def active_tracks(self, camera_id: str) -> list[Track]:
        return [t for t in self._tracks.get(camera_id, {}).values() if t.age == 0]

    def track_count(self, camera_id: str | None = None) -> int:
        if camera_id is not None:
            return len(self._tracks.get(camera_id, {}))
        return sum(len(v) for v in self._tracks.values())

    def reset_camera(self, camera_id: str) -> None:
        self._tracks.pop(camera_id, None)
