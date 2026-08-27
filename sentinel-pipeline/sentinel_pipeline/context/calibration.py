"""
Calibration Mode — auto-suggested, human-approved zone setup.

Solves the "manually drawing a polygon per camera doesn't scale, and a
hand-drawn mistake sits unnoticed for months" problem by making setup
auto-suggested and one-click approved.

Two safety principles are structural here, not optional:

  * **Calibration never creates a blind spot.** The full pipeline keeps running
    and keeps alerting during the observation window. What is unavailable is
    zone-based SUPPRESSION, not detection.
  * **Never silently auto-expand.** If detections later land consistently
    outside an approved polygon, that is flagged to a human, never absorbed.
    A slowly growing real fire is exactly the thing that must never be
    auto-learned as "normal".
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from datetime import datetime

import cv2
import numpy as np

from ..config import ContextSettings, settings as global_settings
from ..contracts import BBox, utc_now
from .zones import NormalEnvelope, Zone

logger = logging.getLogger("sentinel.calibration")


@dataclass(slots=True)
class CalibrationObservation:
    timestamp: datetime
    monotonic_ts: float
    bbox: BBox
    threat_class: str
    confidence: float


@dataclass(slots=True)
class CalibrationSession:
    camera_id: str
    started_at: datetime
    window_hours: float
    observations: list[CalibrationObservation] = field(default_factory=list)
    reference_frame: np.ndarray | None = None
    closed: bool = False
    # Monotonic start, so a wall-clock step cannot end the window early.
    started_monotonic: float = field(default_factory=time.monotonic)

    @property
    def elapsed_hours(self) -> float:
        return (time.monotonic() - self.started_monotonic) / 3600.0

    @property
    def is_window_complete(self) -> bool:
        return self.elapsed_hours >= self.window_hours

    @property
    def observation_count(self) -> int:
        return len(self.observations)


@dataclass(slots=True)
class ZoneSuggestion:
    """What calibration proposes. Requires human approval before taking effect."""

    camera_id: str
    polygon: tuple[tuple[int, int], ...]
    envelope: NormalEnvelope
    observation_count: int
    suggested_risk_weight: float
    always_on: bool
    coverage_hours: float
    adjacency_candidates: tuple[str, ...] = ()
    notes: tuple[str, ...] = ()

    def as_dict(self) -> dict:
        return {
            "camera_id": self.camera_id,
            "polygon": [list(p) for p in self.polygon],
            "envelope": self.envelope.as_dict(),
            "observation_count": self.observation_count,
            "suggested_risk_weight": self.suggested_risk_weight,
            "always_on": self.always_on,
            "coverage_hours": round(self.coverage_hours, 2),
            "adjacency_candidates": list(self.adjacency_candidates),
            "notes": list(self.notes),
            "requires_human_approval": True,
        }


class CalibrationManager:
    """Runs observation windows and produces zone suggestions."""

    MIN_OBSERVATIONS = 12

    def __init__(self, cfg: ContextSettings | None = None):
        self._cfg = cfg or global_settings.context
        self._sessions: dict[str, CalibrationSession] = {}
        # Trigger times per camera, for behavioural adjacency correlation.
        self._trigger_times: dict[str, list[float]] = {}

    # -- lifecycle ---------------------------------------------------------

    def start(
        self, camera_id: str, window_hours: float | None = None,
        reference_frame: np.ndarray | None = None,
    ) -> CalibrationSession:
        session = CalibrationSession(
            camera_id=camera_id,
            started_at=utc_now(),
            window_hours=window_hours or self._cfg.calibration_window_hours,
            reference_frame=None if reference_frame is None else reference_frame.copy(),
        )
        self._sessions[camera_id] = session
        logger.info(
            "[Calibration] started camera=%s window=%.1fh -- detection and alerting "
            "continue normally during calibration",
            camera_id, session.window_hours,
        )
        return session

    def is_calibrating(self, camera_id: str) -> bool:
        s = self._sessions.get(camera_id)
        return bool(s and not s.closed)

    def get(self, camera_id: str) -> CalibrationSession | None:
        return self._sessions.get(camera_id)

    def observe(
        self, camera_id: str, bbox: BBox, threat_class: str,
        confidence: float, monotonic_ts: float,
    ) -> None:
        """Log a confirmed-normal detection during the observation window."""
        s = self._sessions.get(camera_id)
        if s is None or s.closed:
            return
        s.observations.append(
            CalibrationObservation(
                timestamp=utc_now(), monotonic_ts=monotonic_ts,
                bbox=bbox, threat_class=threat_class, confidence=confidence,
            )
        )
        self._trigger_times.setdefault(camera_id, []).append(monotonic_ts)

    def record_trigger(self, camera_id: str, monotonic_ts: float) -> None:
        """Record any gate/detection trigger, for cross-camera correlation."""
        self._trigger_times.setdefault(camera_id, []).append(monotonic_ts)

    # -- suggestion --------------------------------------------------------

    def suggest(self, camera_id: str) -> ZoneSuggestion | None:
        """Cluster observations into a proposed polygon + normal envelope."""
        s = self._sessions.get(camera_id)
        if s is None:
            return None

        notes: list[str] = []
        obs = s.observations
        if len(obs) < self.MIN_OBSERVATIONS:
            notes.append(
                f"only {len(obs)} observations (minimum {self.MIN_OBSERVATIONS}); "
                "suggestion is low-confidence"
            )
            if not obs:
                return None

        # Build the point cloud from box corners, not centroids: a containment
        # boundary must enclose the full extent of normal activity, and
        # centroids would produce a polygon smaller than the fires themselves.
        points: list[tuple[int, int]] = []
        for o in obs:
            b = o.bbox
            points.extend([(b.x1, b.y1), (b.x2, b.y1), (b.x2, b.y2), (b.x1, b.y2)])

        pts = np.array(points, dtype=np.int32)
        trimmed = self._trim_outliers(pts)
        if len(trimmed) < 3:
            trimmed = pts

        hull = cv2.convexHull(trimmed)
        polygon = tuple((int(p[0][0]), int(p[0][1])) for p in hull)

        areas = np.array([o.bbox.area for o in obs], dtype=np.float64)
        envelope = NormalEnvelope(
            min_area=int(areas.min()),
            max_area=int(areas.max()),
            mean_area=float(areas.mean()),
            std_area=float(areas.std()),
            always_on=self._is_always_on(s),
        )

        if envelope.always_on:
            notes.append("detections were continuous through the window -> always_on")

        return ZoneSuggestion(
            camera_id=camera_id,
            polygon=polygon,
            envelope=envelope,
            observation_count=len(obs),
            # Risk weight is a human/operational judgement, not something
            # observation frequency can determine. Suggest the conservative
            # middle and require the operator to set it.
            suggested_risk_weight=0.5,
            always_on=envelope.always_on,
            coverage_hours=s.elapsed_hours,
            adjacency_candidates=self._adjacency_candidates(camera_id),
            notes=tuple(notes + ["risk_weight is a default -- set it deliberately"]),
        )

    @staticmethod
    def _trim_outliers(pts: np.ndarray, sigma: float = 2.5) -> np.ndarray:
        """Drop points far from the centroid, so one stray detection cannot
        stretch the containment polygon across the whole frame."""
        if len(pts) < 8:
            return pts
        centre = pts.mean(axis=0)
        d = np.linalg.norm(pts - centre, axis=1)
        med = np.median(d)
        mad = np.median(np.abs(d - med)) * 1.4826
        if mad <= 0:
            return pts
        return pts[d <= med + sigma * mad]

    def _is_always_on(self, s: CalibrationSession) -> bool:
        """Continuous through the window -> furnace/flare/chimney-type source."""
        if len(s.observations) < self.MIN_OBSERVATIONS:
            return False
        ts = sorted(o.monotonic_ts for o in s.observations)
        span = ts[-1] - ts[0]
        if span <= 0:
            return False
        # Split the span into buckets; always-on means nearly every bucket saw
        # a detection.
        buckets = 20
        width = span / buckets
        occupied = {min(buckets - 1, int((t - ts[0]) / width)) for t in ts}
        return (len(occupied) / buckets) >= self._cfg.calibration_always_on_ratio

    def _adjacency_candidates(self, camera_id: str, tolerance_s: float = 3.0) -> tuple[str, ...]:
        """Behavioural adjacency: do two cameras repeatedly trigger together?"""
        mine = self._trigger_times.get(camera_id, [])
        if len(mine) < 5:
            return ()
        mine_sorted = sorted(mine)
        out: list[str] = []
        for other, times in self._trigger_times.items():
            if other == camera_id or len(times) < 5:
                continue
            other_sorted = sorted(times)
            hits = 0
            for t in mine_sorted:
                idx = np.searchsorted(other_sorted, t)
                for j in (idx - 1, idx):
                    if 0 <= j < len(other_sorted) and abs(other_sorted[j] - t) <= tolerance_s:
                        hits += 1
                        break
            if hits / len(mine_sorted) >= 0.5:
                out.append(other)
        return tuple(out)

    # -- approval ----------------------------------------------------------

    def approve(
        self, camera_id: str, zone_id: str, *, risk_weight: float,
        polygon: tuple[tuple[int, int], ...] | None = None,
        name: str = "", flammable_materials_nearby: bool = False,
        designated_activity_allowed: tuple[str, ...] = (),
        adjacent_camera_ids: tuple[str, ...] = (),
    ) -> Zone:
        """Human approval step. Operator may adjust the suggested polygon."""
        suggestion = self.suggest(camera_id)
        poly = polygon if polygon is not None else (suggestion.polygon if suggestion else ())
        envelope = suggestion.envelope if suggestion else NormalEnvelope()

        s = self._sessions.get(camera_id)
        if s is not None:
            s.closed = True

        zone = Zone(
            zone_id=zone_id,
            camera_id=camera_id,
            name=name or zone_id,
            polygon=tuple(poly),
            risk_weight=risk_weight,
            flammable_materials_nearby=flammable_materials_nearby,
            designated_activity_allowed=designated_activity_allowed,
            envelope=envelope,
            approved=True,
            adjacent_camera_ids=adjacent_camera_ids,
        )
        logger.info(
            "[Calibration] approved camera=%s zone=%s risk=%.2f polygon_points=%d always_on=%s",
            camera_id, zone_id, risk_weight, len(zone.polygon), envelope.always_on,
        )
        return zone


class BoundaryDriftMonitor:
    """Flags detections landing consistently just outside an approved polygon.

    Never widens the boundary itself. Escalates to a human, because a slowly
    growing real fire looks exactly like a slightly-too-small polygon.
    """

    def __init__(self, window: int = 50, flag_ratio: float = 0.4):
        self._window = window
        self._flag_ratio = flag_ratio
        self._recent: dict[str, list[bool]] = {}

    def record(self, camera_id: str, was_outside: bool) -> bool:
        """Record one detection. Returns True if a human review should be raised."""
        buf = self._recent.setdefault(camera_id, [])
        buf.append(was_outside)
        if len(buf) > self._window:
            buf.pop(0)
        if len(buf) < max(10, self._window // 2):
            return False
        ratio = sum(buf) / len(buf)
        if ratio >= self._flag_ratio:
            logger.warning(
                "[Calibration] camera=%s has %.0f%% of recent detections outside its "
                "approved polygon -- flagging for HUMAN REVIEW (boundary is NOT "
                "auto-expanded)", camera_id, ratio * 100,
            )
            return True
        return False
