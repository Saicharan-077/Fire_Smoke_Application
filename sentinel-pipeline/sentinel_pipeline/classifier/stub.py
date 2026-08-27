"""
=============================================================================
TEMPORARY STUB CLASSIFIER -- NOT FOR PRODUCTION USE
=============================================================================

This exists for exactly one reason: the real Classifier (Stage 3) is being
built separately, and the Context Engine downstream of it cannot be built or
tested end-to-end against nothing. This stub implements the exact final output
contract the Context Engine expects, so Context Engine work can proceed now and
the real Classifier can drop in later with no pipeline changes.

WHAT THIS IS NOT
----------------
* It is NOT the two-tier Rules -> CNN design.
* It has NO trained model, NO hard-negative handling, NO texture analysis,
  NO optical flow, NO flicker FFT.
* Its smoke-colour split is naive brightness banding on the crop, which will
  misclassify backlit smoke, night footage and low-contrast plumes.
* Its false-positive rejection is a crude saturation/brightness heuristic and
  WILL let through fire-coloured objects (sunsets, safety vests, brake lights).

DO NOT ship a deployment running this. ``is_stub = True`` makes the pipeline
log a warning at startup and report ``"classifier_is_stub": true`` on the
health endpoint so this cannot silently reach production.

REPLACEMENT
-----------
Implement ``sentinel_pipeline.classifier.base.Classifier`` and pass it to
``Pipeline(classifier=...)``. Nothing else changes.
"""

from __future__ import annotations

import logging

import cv2
import numpy as np

from ..contracts import ClassifierInput, ClassifierVerdict, RawClass, ThreatClass
from .base import Classifier

logger = logging.getLogger("sentinel.classifier.stub")


class StubClassifier(Classifier):
    """Placeholder standing in for the real two-tier Classifier."""

    name = "stub-heuristic"
    is_stub = True

    # Smoke brightness bands (mean V of the crop, 0-255).
    WHITE_SMOKE_MIN_V = 165.0
    GREY_SMOKE_MIN_V = 95.0

    # Crude false-positive gates.
    MIN_FIRE_SATURATION = 55.0
    MIN_FIRE_VALUE = 70.0
    MAX_SMOKE_SATURATION = 145.0

    def __init__(self, reject_below_confidence: float = 0.22):
        self._reject_below = reject_below_confidence

    def warmup(self) -> None:
        logger.warning(
            "STUB CLASSIFIER ACTIVE -- heuristic placeholder, not the real "
            "two-tier classifier. Do not use in production."
        )

    def classify_batch(
        self, inputs: list[ClassifierInput]
    ) -> list[ClassifierVerdict]:
        return [self._classify_one(i) for i in inputs]

    # -- internals ---------------------------------------------------------

    def _classify_one(self, inp: ClassifierInput) -> ClassifierVerdict:
        try:
            threat, confidence, reasoning = self._decide(inp)
        except Exception as exc:  # noqa: BLE001
            # The interface forbids raising: an exception here would fail the
            # whole frame rather than one candidate.
            logger.warning("[stub] classification failed for track %s: %s", inp.track_id, exc)
            threat = ThreatClass.FALSE_POSITIVE
            confidence = 0.0
            reasoning = {"error": str(exc)}

        return ClassifierVerdict(
            track_id=inp.track_id,
            camera_id=inp.camera_id,
            timestamp=inp.timestamp,
            bbox=inp.bbox,
            threat_class=threat,
            confidence=confidence,
            monotonic_ts=inp.monotonic_ts,
            reasoning={"classifier": self.name, "is_stub": True, **reasoning},
        )

    def _decide(self, inp: ClassifierInput) -> tuple[ThreatClass, float, dict]:
        crop = inp.cropped_frame_rgb
        if crop is None or crop.size == 0:
            return ThreatClass.FALSE_POSITIVE, 0.0, {"reason": "empty_crop"}

        if inp.confidence_raw < self._reject_below:
            return (
                ThreatClass.FALSE_POSITIVE,
                inp.confidence_raw,
                {"reason": "below_stub_floor"},
            )

        # Contract says RGB; OpenCV colour conversions expect BGR ordering.
        hsv = cv2.cvtColor(crop[:, :, ::-1], cv2.COLOR_BGR2HSV)
        mean_s = float(hsv[:, :, 1].mean())
        mean_v = float(hsv[:, :, 2].mean())
        stats = {
            "mean_saturation": round(mean_s, 2),
            "mean_value": round(mean_v, 2),
            "class_raw": inp.class_raw.value,
        }

        if inp.class_raw is RawClass.FIRE:
            if mean_s < self.MIN_FIRE_SATURATION or mean_v < self.MIN_FIRE_VALUE:
                return (
                    ThreatClass.FALSE_POSITIVE,
                    inp.confidence_raw,
                    {**stats, "reason": "fire_colour_gate"},
                )
            return ThreatClass.FIRE, min(0.99, inp.confidence_raw * 1.05), stats

        if inp.class_raw is RawClass.SMOKE:
            if mean_s > self.MAX_SMOKE_SATURATION:
                return (
                    ThreatClass.FALSE_POSITIVE,
                    inp.confidence_raw,
                    {**stats, "reason": "smoke_too_saturated"},
                )
            if mean_v >= self.WHITE_SMOKE_MIN_V:
                threat = ThreatClass.WHITE_SMOKE
            elif mean_v >= self.GREY_SMOKE_MIN_V:
                threat = ThreatClass.GREY_SMOKE
            else:
                threat = ThreatClass.BLACK_SMOKE
            return threat, inp.confidence_raw, stats

        if inp.class_raw is RawClass.SPARKS:
            # Sparks reach the Classifier as sparks -- the pipeline does not
            # pre-map them. The real Classifier makes this call properly; the
            # stub treats a sustained spark source as fire and a brief one as
            # a false positive, purely so the path is exercised.
            if inp.track_age_frames >= 3:
                return (
                    ThreatClass.FIRE,
                    inp.confidence_raw * 0.8,
                    {**stats, "reason": "sustained_sparks"},
                )
            return (
                ThreatClass.FALSE_POSITIVE,
                inp.confidence_raw,
                {**stats, "reason": "transient_sparks"},
            )

        return ThreatClass.FALSE_POSITIVE, 0.0, {**stats, "reason": "unhandled_class"}
