"""Shared access to the in-repo test frames."""
from __future__ import annotations

import glob
from pathlib import Path

FRAMES_DIR = Path(__file__).resolve().parent / "frames"


def frame_paths() -> list[str]:
    paths = sorted(glob.glob(str(FRAMES_DIR / "*.jpg")))
    if not paths:
        raise SystemExit(
            f"no test frames in {FRAMES_DIR}. These tests need the real model "
            "to produce candidates; a synthetic blob will not do."
        )
    return paths


def load_frame(index: int = 0):
    import cv2

    p = frame_paths()[index]
    f = cv2.imread(p)
    if f is None:
        raise SystemExit(f"could not read {p}")
    return f
