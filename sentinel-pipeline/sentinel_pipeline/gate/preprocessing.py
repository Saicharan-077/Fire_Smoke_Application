"""
Gate Step 1 — lightweight frame preprocessing.

Downsample -> grayscale -> mild blur -> optional CLAHE.

This runs on EVERY frame of EVERY camera, so it must stay cheap. Everything
here operates on a ~160x90 image, which is why it costs microseconds rather
than milliseconds.
"""

from __future__ import annotations

import cv2
import numpy as np

from ..config import GateSettings


class Preprocessor:
    """Per-camera preprocessing. Holds the CLAHE object so it isn't rebuilt per frame."""

    __slots__ = ("_cfg", "_clahe")

    def __init__(self, cfg: GateSettings):
        self._cfg = cfg
        self._clahe = (
            cv2.createCLAHE(
                clipLimit=cfg.clahe_clip_limit,
                tileGridSize=(cfg.clahe_grid, cfg.clahe_grid),
            )
            if cfg.clahe_enabled
            else None
        )

    def process(self, frame: np.ndarray) -> np.ndarray:
        """BGR (or grayscale) full-res frame -> small, grayscale, blurred, CLAHE'd.

        Returns a uint8 single-channel image of shape (score_height, score_width).
        """
        if frame is None or frame.size == 0:
            raise ValueError("Preprocessor received an empty frame")

        # 1. Downsample first — every later operation is then ~50x cheaper.
        #    INTER_AREA is the correct choice for shrinking; it averages rather
        #    than point-samples, which suppresses aliasing that would otherwise
        #    read as motion.
        small = cv2.resize(
            frame,
            (self._cfg.score_width, self._cfg.score_height),
            interpolation=cv2.INTER_AREA,
        )

        # 2. Grayscale.
        if small.ndim == 3:
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        else:
            gray = small

        # 3. Mild blur to suppress sensor noise.
        k = self._cfg.blur_kernel
        if k >= 3:
            if k % 2 == 0:
                k += 1
            gray = cv2.GaussianBlur(gray, (k, k), 0)

        # 4. Global illumination normalisation.
        #    Day->dusk drift shifts every pixel by roughly the same amount. The
        #    background model adapts, but only over its history window, so a
        #    drift faster than that window reads as whole-frame motion. Pinning
        #    the mean to a fixed reference removes the global component while
        #    leaving local changes -- which is what real motion and fire are --
        #    fully intact.
        #
        #    Deliberately NOT solved by raising the background learning rate: a
        #    fast-adapting background absorbs a slowly growing fire into itself,
        #    which is the exact blind spot this pipeline must never have.
        if self._cfg.illumination_normalize:
            mean = float(gray.mean())
            shift = int(round(self._cfg.illumination_reference - mean))
            if shift:
                gray = np.clip(gray.astype(np.int16) + shift, 0, 255).astype(np.uint8)

        # 5. CLAHE for low-light / foggy / high-glare footage.
        if self._clahe is not None:
            gray = self._clahe.apply(gray)

        return gray


def preprocess(frame: np.ndarray, cfg: GateSettings) -> np.ndarray:
    """Stateless convenience wrapper. Prefer ``Preprocessor`` on a hot path."""
    return Preprocessor(cfg).process(frame)
