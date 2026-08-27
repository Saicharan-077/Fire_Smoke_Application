"""
Camera drift detection (Master Pipeline Document, Section 7).

After calibration, a camera that gets bumped, re-mounted or adjusted invalidates
its containment polygon -- the zone no longer covers the physical structure it
was drawn around. Classical feature matching (ORB) against a reference frame
captured at calibration time detects that shift. No training required.

Two reasons this flags a human rather than auto-shifting the polygon:

  * a large unexpected shift may indicate TAMPERING, which is itself worth
    surfacing;
  * silently moving a containment boundary is the same class of mistake as
    silently widening one -- it can absorb a real hazard into "normal".

Auto-shift is available behind an explicit flag for operators who want it, but
the default is to flag.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import cv2
import numpy as np

logger = logging.getLogger("sentinel.drift")


@dataclass(frozen=True, slots=True)
class DriftResult:
    checked: bool
    drifted: bool
    dx: float
    dy: float
    magnitude_px: float
    inliers: int
    matches: int
    confidence: float
    reason: str

    def as_dict(self) -> dict:
        return {
            "checked": self.checked,
            "drifted": self.drifted,
            "dx": round(self.dx, 2),
            "dy": round(self.dy, 2),
            "magnitude_px": round(self.magnitude_px, 2),
            "inliers": self.inliers,
            "matches": self.matches,
            "confidence": round(self.confidence, 3),
            "reason": self.reason,
        }


class DriftDetector:
    """ORB feature matching between a reference frame and the current one."""

    def __init__(
        self,
        *,
        n_features: int = 800,
        min_matches: int = 12,
        min_inliers: int = 8,
        drift_threshold_px: float = 12.0,
    ):
        self._orb = cv2.ORB_create(nfeatures=n_features)
        self._matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        self._min_matches = min_matches
        self._min_inliers = min_inliers
        self._threshold = drift_threshold_px
        self._references: dict[str, tuple] = {}

    def set_reference(self, camera_id: str, frame: np.ndarray) -> bool:
        """Store the calibration-time reference for a camera."""
        gray = self._gray(frame)
        kp, desc = self._orb.detectAndCompute(gray, None)
        if desc is None or len(kp) < self._min_matches:
            logger.warning(
                "[Drift] camera=%s reference has too few features (%d) -- drift "
                "detection will be unavailable for this camera",
                camera_id, 0 if desc is None else len(kp),
            )
            return False
        self._references[camera_id] = (kp, desc, gray.shape)
        logger.info("[Drift] camera=%s reference stored (%d features)", camera_id, len(kp))
        return True

    def has_reference(self, camera_id: str) -> bool:
        return camera_id in self._references

    def clear(self, camera_id: str) -> None:
        self._references.pop(camera_id, None)

    @staticmethod
    def _gray(frame: np.ndarray) -> np.ndarray:
        return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame

    def check(self, camera_id: str, frame: np.ndarray) -> DriftResult:
        ref = self._references.get(camera_id)
        if ref is None:
            return DriftResult(False, False, 0, 0, 0, 0, 0, 0.0, "no reference frame")

        ref_kp, ref_desc, _shape = ref
        gray = self._gray(frame)
        kp, desc = self._orb.detectAndCompute(gray, None)
        if desc is None or len(kp) < self._min_matches:
            return DriftResult(False, False, 0, 0, 0, 0, 0, 0.0, "too few features in current frame")

        matches = self._matcher.match(ref_desc, desc)
        if len(matches) < self._min_matches:
            return DriftResult(
                False, False, 0, 0, 0, 0, len(matches), 0.0,
                f"only {len(matches)} matches (need {self._min_matches})",
            )

        matches = sorted(matches, key=lambda m: m.distance)
        src = np.float32([ref_kp[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
        dst = np.float32([kp[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)

        # Partial affine is the right model: a bumped camera translates and
        # rotates slightly, it does not project to a new plane.
        matrix, inlier_mask = cv2.estimateAffinePartial2D(
            src, dst, method=cv2.RANSAC, ransacReprojThreshold=3.0,
        )
        inliers = int(inlier_mask.sum()) if inlier_mask is not None else 0
        if matrix is None or inliers < self._min_inliers:
            return DriftResult(
                False, False, 0, 0, 0, inliers, len(matches), 0.0,
                f"could not fit a transform ({inliers} inliers)",
            )

        dx, dy = float(matrix[0, 2]), float(matrix[1, 2])
        magnitude = float(np.hypot(dx, dy))
        confidence = inliers / len(matches)
        drifted = magnitude >= self._threshold

        reason = (
            f"shift {magnitude:.1f}px >= threshold {self._threshold:.0f}px"
            if drifted else f"shift {magnitude:.1f}px within tolerance"
        )
        if drifted:
            logger.warning(
                "[Drift] camera=%s appears to have MOVED: dx=%.1f dy=%.1f "
                "(%.1fpx, %d/%d inliers). Zone polygon may no longer align. "
                "Flagged for human review -- not auto-shifted.",
                camera_id, dx, dy, magnitude, inliers, len(matches),
            )
        return DriftResult(
            True, drifted, dx, dy, magnitude, inliers, len(matches), confidence, reason,
        )

    @staticmethod
    def shifted_polygon(
        polygon: tuple[tuple[int, int], ...], dx: float, dy: float
    ) -> tuple[tuple[int, int], ...]:
        """Compute what the polygon WOULD be if shifted. Never applied
        automatically -- offered so an operator can preview and approve."""
        return tuple((int(round(x + dx)), int(round(y + dy))) for x, y in polygon)
