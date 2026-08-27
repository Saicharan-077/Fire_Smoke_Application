"""
Public data contracts for the SentinelOS detection pipeline.

This module is the stable interface between pipeline stages, and between the
pipeline and the Classifier implementation supplied by another team. Everything
else under ``sentinel_pipeline`` is a private implementation detail.

Stage handoffs
--------------

    frame --> GateResult --> ModelCandidate --> ClassifierInput
                                                     |
                                                     v
                                              ClassifierVerdict --> Alert

``ClassifierInput`` and ``ClassifierVerdict`` are the versioned contract the
Classifier team builds against. See ``docs/MODEL_CLASSIFIER_CONTRACT.md``.

Numpy arrays are passed by reference (the Classifier runs in-process). They are
treated as READ-ONLY by convention -- a consumer that needs to modify a crop
must copy it first. Arrays are marked non-writeable where cheaply possible.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Sequence

import numpy as np

# Bump only for breaking changes. Additive fields do not require a bump.
CONTRACT_VERSION = "1.0.0"


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class BBox:
    """Axis-aligned box in ORIGINAL full-resolution frame pixel coordinates.

    Coordinates are ints, x1 < x2 and y1 < y2, origin top-left. If the Model
    ran on a downscaled frame, boxes are rescaled back to source resolution
    before they ever reach this contract -- consumers never need to know what
    resolution inference actually happened at.
    """

    x1: int
    y1: int
    x2: int
    y2: int

    @property
    def width(self) -> int:
        return self.x2 - self.x1

    @property
    def height(self) -> int:
        return self.y2 - self.y1

    @property
    def area(self) -> int:
        return max(0, self.width) * max(0, self.height)

    @property
    def centroid(self) -> tuple[float, float]:
        return ((self.x1 + self.x2) / 2.0, (self.y1 + self.y2) / 2.0)

    def iou(self, other: "BBox") -> float:
        ix1, iy1 = max(self.x1, other.x1), max(self.y1, other.y1)
        ix2, iy2 = min(self.x2, other.x2), min(self.y2, other.y2)
        inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
        union = self.area + other.area - inter
        return inter / union if union > 0 else 0.0

    def clamped(self, width: int, height: int) -> "BBox":
        return BBox(
            x1=max(0, min(self.x1, width - 1)),
            y1=max(0, min(self.y1, height - 1)),
            x2=max(0, min(self.x2, width)),
            y2=max(0, min(self.y2, height)),
        )

    def as_dict(self) -> dict[str, int]:
        return {"x1": self.x1, "y1": self.y1, "x2": self.x2, "y2": self.y2}


# --------------------------------------------------------------------------
# Enums
# --------------------------------------------------------------------------


class TriggerReason(str, Enum):
    MOTION = "motion"
    FORCED_OVERRIDE = "forced_override"


class RawClass(str, Enum):
    """Classes the Model (YOLO26s) can emit, verbatim.

    These are the trained weights' own class names. The pipeline does NOT remap
    them before the Classifier -- ``sparks`` reaches the Classifier as
    ``sparks``, so the Classifier decides whether a spark source is fire.
    """

    FIRE = "fire"
    SMOKE = "smoke"
    SPARKS = "sparks"


class ThreatClass(str, Enum):
    """Final Classifier taxonomy (Master Pipeline Document Section 5).

    ``FALSE_POSITIVE`` is a valid Classifier verdict, but the pipeline drops
    those before the Context Engine. What the Context Engine actually receives
    is therefore always one of the four positive classes.
    """

    FIRE = "fire"
    WHITE_SMOKE = "white_smoke"
    GREY_SMOKE = "grey_smoke"
    BLACK_SMOKE = "black_smoke"
    FALSE_POSITIVE = "false_positive"

    @property
    def is_smoke(self) -> bool:
        return self in (
            ThreatClass.WHITE_SMOKE,
            ThreatClass.GREY_SMOKE,
            ThreatClass.BLACK_SMOKE,
        )


class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


# --------------------------------------------------------------------------
# Stage 1 -- Gate output
# --------------------------------------------------------------------------


@dataclass(slots=True)
class GateResult:
    """Emitted by the Gate when a frame should proceed to the Model.

    Matches Gate Module Reference & Build Plan, Section 8. ``frame`` is the
    ORIGINAL frame (BGR, full resolution) -- the Gate's downsampled/CLAHE
    version is used only for scoring and is deliberately not handed downstream,
    because the Model needs full detail.
    """

    camera_id: str
    timestamp: datetime
    frame: np.ndarray
    trigger_reason: TriggerReason
    change_score: float
    zone_risk_weight: float | None

    # Monotonic clock reading taken at frame capture. Used for interval maths
    # (flicker frequency, growth rate) where wall-clock is unsafe.
    monotonic_ts: float = field(default_factory=time.monotonic)

    @property
    def forced(self) -> bool:
        return self.trigger_reason is TriggerReason.FORCED_OVERRIDE


# --------------------------------------------------------------------------
# Stage 2 -- Model output
# --------------------------------------------------------------------------


@dataclass(slots=True)
class ModelCandidate:
    """One raw detection from the Model, before tracking and classification."""

    camera_id: str
    timestamp: datetime
    monotonic_ts: float
    bbox: BBox
    class_raw: RawClass
    confidence_raw: float
    # Set by the tracking layer, not the Model itself.
    track_id: int | None = None


# --------------------------------------------------------------------------
# Model -> Classifier contract  (THE public deliverable)
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CropSnapshot:
    """One timestamped crop of a tracked object.

    A rolling window of these is maintained by the pipeline's tracking layer and
    handed to the Classifier on every ``ClassifierInput``, so the Flicker phase
    has the frame history it needs without keeping its own buffer.

    HISTORY CROPS ARE DOWNSCALED. Retaining 60 native-resolution snapshots per
    track costs ~7.3 GB across a 16-camera fleet with large candidates, versus
    ~566 MB capped -- so the cap stays for history. ``crop_scale`` records the
    factor actually applied to THIS snapshot (1.0 = native), because a growing
    candidate produces a mix of scaled and unscaled entries within one track.
    Any measurement in absolute pixels -- notably Phase 3's displacement --
    must normalise by it.

    The current-frame crop on ``ClassifierInput`` is NOT downscaled; see there.
    """

    timestamp: datetime
    monotonic_ts: float
    bbox: BBox
    crop_rgb: np.ndarray
    crop_grayscale: np.ndarray
    confidence_raw: float
    crop_scale: float = 1.0
    match_iou: float | None = None

    # --- canonical motion window (Phase 3 / Farneback) ---------------------
    # `motion_crop` is grayscale and has IDENTICAL dimensions for every
    # snapshot sharing a `motion_epoch`, cut from a FIXED world position. Flow
    # measured between two same-epoch motion crops is therefore true world
    # displacement -- no window-tracking to compensate for, and no per-frame
    # rescaling.
    #
    # NEVER compare motion crops across different `motion_epoch` values: the
    # window was re-anchored between them and the comparison is meaningless.
    #
    # Convert measured pixel displacement to source-frame pixels by dividing by
    # `motion_scale` (constant within an epoch). Then divide by the
    # `monotonic_ts` delta for velocity.
    motion_crop: np.ndarray | None = None
    motion_window_origin: tuple[int, int] = (0, 0)
    motion_window_size: tuple[int, int] = (0, 0)  # (width, height), post-scale
    motion_epoch: int = 0
    motion_scale: float = 1.0


@dataclass(slots=True)
class ClassifierInput:
    """What the pipeline hands the Classifier for one candidate, one frame.

    CONTRACT NOTES -- read before consuming:

    * ``cropped_frame_rgb`` is **RGB**, not OpenCV's native BGR. The pipeline
      converts once at the boundary.
    * ``cropped_frame_rgb`` / ``cropped_frame_grayscale`` are at **NATIVE
      resolution** -- never downscaled. Phases 1 and 2 apply absolute
      pixel-count and connected-component blob-size guards and can emit
      ``too_small_escalate``, so a silently downscaled crop would make those
      guards measure the wrong thing. Only ``history`` entries are capped
      (see ``CropSnapshot.crop_scale``).
    * Crops are padded outward from ``bbox`` by ``crop_padding_ratio`` so
      optical-flow and texture phases have surrounding context. ``bbox`` remains
      the tight detection box in full-frame coordinates; ``crop_origin`` gives
      the padded crop's top-left in full-frame coordinates, so
      ``bbox`` can be recovered inside the crop as
      ``(bbox.x1 - crop_origin[0], bbox.y1 - crop_origin[1], ...)``.
    * ``timestamp`` is frame CAPTURE time (UTC), not processing time.
      ``monotonic_ts`` is the matching monotonic reading -- use that one for
      frequency and rate maths, since wall-clock can step.
    * ``history`` is oldest-first and includes the current frame as its last
      entry. Length is bounded by the tracker's configured window.
    * Arrays are shared, not copied. Treat as read-only.
    """

    track_id: int
    camera_id: str
    timestamp: datetime
    monotonic_ts: float
    bbox: BBox
    cropped_frame_rgb: np.ndarray
    cropped_frame_grayscale: np.ndarray
    class_raw: RawClass
    confidence_raw: float

    # --- context needed by the temporal phases ---
    history: tuple[CropSnapshot, ...] = ()
    crop_origin: tuple[int, int] = (0, 0)
    crop_padding_ratio: float = 0.0
    frame_size: tuple[int, int] = (0, 0)  # (width, height) of the source frame
    track_age_frames: int = 1
    track_duration_s: float = 0.0

    # Actual padding applied per side, in pixels: (left, top, right, bottom).
    # Clipped asymmetrically when the candidate touches a frame edge, so a
    # border-exclusion strip must be sized per side rather than assumed uniform.
    padding_applied: tuple[int, int, int, int] = (0, 0, 0, 0)
    # Always 1.0 for the current-frame crop; present so callers can assert it.
    crop_scale: float = 1.0

    # --- history window characteristics (Phase 3 / Phase 4) -----------------
    # `history` is bounded by DURATION, not frame count, so its length varies
    # with the source's actual delivered rate. Use these to decide
    # `insufficient_history` from real numbers rather than assuming a rate.
    history_window_s: float = 0.0      # configured window bound
    history_span_s: float = 0.0        # actual time spanned by `history`
    history_sample_rate_hz: float = 0.0  # measured mean rate over `history`
    # Motion epoch of the CURRENT frame. Snapshots in `history` carrying a
    # different epoch must not be flow-compared against this one.
    motion_epoch: int = 0

    contract_version: str = CONTRACT_VERSION


@dataclass(slots=True)
class ClassifierVerdict:
    """What the Classifier returns. Consumed by the Context Engine.

    When ``threat_class`` is ``FALSE_POSITIVE`` **and** ``evidence_sufficient``
    is True, the pipeline discards the candidate and the Context Engine never
    sees it. That is the only path that drops a candidate.
    """

    track_id: int
    camera_id: str
    timestamp: datetime
    bbox: BBox
    threat_class: ThreatClass
    confidence: float

    monotonic_ts: float = 0.0

    # --- recall-first guarantee (Tier-1 Cascade Phase Reference) -------------
    # "'Insufficient history/data' is always a distinct outcome from 'reject'
    #  across all phases, and defaults to escalation -- never silently drops a
    #  candidate lacking evidence."
    #
    # Set False when the phases that would have decided this candidate did not
    # have enough data to decide -- too few frames for Flicker, no tracker
    # match for Motion, a crop below the minimum pixel count for Colour or
    # Texture. The pipeline then ESCALATES rather than rejects, regardless of
    # ``threat_class``.
    #
    # When setting this False, supply your best-guess positive ``threat_class``
    # rather than FALSE_POSITIVE. If FALSE_POSITIVE arrives with
    # evidence_sufficient=False the pipeline must substitute a class to
    # escalate at all; it will do so from ``class_raw``, log a warning, and
    # record the substitution -- correct but blunt, and better avoided.
    evidence_sufficient: bool = True

    # Names of phases that ran in log-only / advisory mode and were therefore
    # EXCLUDED from this verdict (e.g. ("motion", "flicker")). Recorded on the
    # alert for audit; never used for control flow.
    advisory_phases: tuple[str, ...] = ()

    # Free-form, for logging and the hard-negative feedback loop. Never used for
    # control flow by the Context Engine.
    reasoning: dict[str, Any] = field(default_factory=dict)
    contract_version: str = CONTRACT_VERSION

    @property
    def is_rejection(self) -> bool:
        """True only for a CONFIDENT rejection -- the sole drop condition."""
        return (
            self.threat_class is ThreatClass.FALSE_POSITIVE
            and self.evidence_sufficient
        )

    def as_public_dict(self) -> dict[str, Any]:
        """The exact 6-field shape the Context Engine is specified against."""
        return {
            "track_id": self.track_id,
            "class": self.threat_class.value,
            "confidence": round(float(self.confidence), 4),
            "camera_id": self.camera_id,
            "bbox": self.bbox.as_dict(),
            "timestamp": self.timestamp.isoformat(),
        }


# --------------------------------------------------------------------------
# Stage 4 -- Context Engine output
# --------------------------------------------------------------------------


@dataclass(slots=True)
class SeverityAssessment:
    """Context Engine's verdict on how much a confirmed detection matters."""

    severity: Severity
    score: float
    should_alert: bool
    zone_id: str | None
    containment_breached: bool
    envelope_exceeded: bool
    growth_rate: float
    duration_s: float
    reasoning: dict[str, Any] = field(default_factory=dict)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def freeze(arr: np.ndarray) -> np.ndarray:
    """Mark an array read-only where possible. Best-effort; views may refuse."""
    try:
        arr.flags.writeable = False
    except (ValueError, AttributeError):
        pass
    return arr


__all__ = [
    "CONTRACT_VERSION",
    "BBox",
    "TriggerReason",
    "RawClass",
    "ThreatClass",
    "Severity",
    "GateResult",
    "ModelCandidate",
    "CropSnapshot",
    "ClassifierInput",
    "ClassifierVerdict",
    "SeverityAssessment",
    "utc_now",
    "freeze",
]
