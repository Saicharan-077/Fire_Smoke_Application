"""
Gate Step 2 — change scoring via background subtraction.

MOG2 / KNN were chosen over raw frame differencing (too noise-sensitive) and
optical flow (too heavy for whole-frame use). The background model adapts
gradually, so day->dusk drift does not read as motion.

Also implements the per-camera adaptive threshold: a camera watching swaying
trees has a permanently higher noise floor than one watching a storeroom wall,
and no single global threshold serves both.
"""

from __future__ import annotations

from collections import deque

import cv2
import numpy as np

from ..config import GateSettings


class ChangeScorer:
    """Per-camera background model + change score.

    The score is the fraction of foreground pixels in the preprocessed frame,
    in [0, 1]. Shadow pixels (value 127 in MOG2 output) are excluded when
    shadow detection is enabled, so a cloud passing overhead does not register
    as a change.
    """

    __slots__ = ("_cfg", "_subtractor", "_frames_seen", "_scores")

    def __init__(self, cfg: GateSettings):
        self._cfg = cfg
        self._subtractor = self._build(cfg)
        self._frames_seen = 0
        # Rolling history of quiet-scene scores, for the adaptive threshold.
        self._scores: deque[float] = deque(maxlen=cfg.adaptive_window)

    @staticmethod
    def _build(cfg: GateSettings):
        if cfg.algorithm.upper() == "KNN":
            return cv2.createBackgroundSubtractorKNN(
                history=cfg.history,
                dist2Threshold=cfg.var_threshold * 25.0,
                detectShadows=cfg.detect_shadows,
            )
        return cv2.createBackgroundSubtractorMOG2(
            history=cfg.history,
            varThreshold=cfg.var_threshold,
            detectShadows=cfg.detect_shadows,
        )

    @property
    def warm(self) -> bool:
        """True once the background model has seen enough frames to be trusted."""
        return self._frames_seen >= self._cfg.warmup_frames

    @property
    def frames_seen(self) -> int:
        return self._frames_seen

    def score(self, processed: np.ndarray) -> float:
        """Feed one preprocessed frame, return its change score in [0, 1]."""
        mask = self._subtractor.apply(processed, learningRate=self._cfg.learning_rate)
        self._frames_seen += 1

        # MOG2 marks shadows as 127; only 255 is true foreground.
        foreground = int(np.count_nonzero(mask == 255))
        total = mask.size
        score = foreground / total if total else 0.0

        self._scores.append(score)
        return score

    def adaptive_threshold(self, base_threshold: float) -> float:
        """Raise the base threshold to sit above this camera's own noise floor.

        Uses median + sigma*MAD rather than mean + sigma*std: real motion events
        in the history would drag a mean upward and inflate the threshold,
        whereas the median is unaffected by a minority of active frames.
        """
        cfg = self._cfg
        if not cfg.adaptive_enabled or len(self._scores) < cfg.adaptive_min_samples:
            return base_threshold

        arr = np.fromiter(self._scores, dtype=np.float64)
        median = float(np.median(arr))
        mad = float(np.median(np.abs(arr - median)))
        # 1.4826 scales MAD to be a consistent estimator of sigma for normal data.
        noise_floor = median + cfg.adaptive_sigma * mad * 1.4826

        return max(base_threshold, float(noise_floor))

    def reset(self) -> None:
        self._subtractor = self._build(self._cfg)
        self._frames_seen = 0
        self._scores.clear()
