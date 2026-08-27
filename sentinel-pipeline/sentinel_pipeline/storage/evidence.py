"""
Evidence capture.

Every confirmed alert must carry a non-null evidence reference. This module
produces those references; ``alerts.AlertStore`` enforces that one exists.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from ..config import StorageSettings, settings as global_settings

logger = logging.getLogger("sentinel.evidence")


class EvidenceCaptureError(RuntimeError):
    """Raised when evidence could not be persisted.

    Deliberately fatal to alert creation rather than warn-and-continue. The
    existing application caught this case, logged a warning and wrote the alert
    with ``evidence_path=None`` -- which is exactly the bug this pipeline is
    required to make structurally impossible.
    """


class EvidenceStore:
    def __init__(self, cfg: StorageSettings | None = None):
        self._cfg = cfg or global_settings.storage
        self._dir = Path(self._cfg.evidence_dir)
        self._dir.mkdir(parents=True, exist_ok=True)

    @property
    def directory(self) -> Path:
        return self._dir

    def save_frame(
        self, frame: np.ndarray, *, camera_id: str, prefix: str = "alert"
    ) -> str:
        """Persist an annotated frame. Returns the evidence reference.

        Raises ``EvidenceCaptureError`` on any failure -- callers must not
        swallow it.
        """
        if frame is None or getattr(frame, "size", 0) == 0:
            raise EvidenceCaptureError(
                f"refusing to save empty evidence frame for camera {camera_id}"
            )

        safe_cam = "".join(c if c.isalnum() or c in "-_" else "_" for c in camera_id)[:48]
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        filename = f"{prefix}_{safe_cam}_{stamp}_{uuid.uuid4().hex[:8]}.jpg"
        full_path = self._dir / filename

        try:
            ok = cv2.imwrite(
                str(full_path),
                frame,
                [int(cv2.IMWRITE_JPEG_QUALITY), self._cfg.evidence_jpeg_quality],
            )
        except Exception as exc:  # noqa: BLE001
            raise EvidenceCaptureError(f"cv2.imwrite raised for {full_path}: {exc}") from exc

        if not ok or not full_path.exists() or full_path.stat().st_size == 0:
            raise EvidenceCaptureError(f"evidence file was not written: {full_path}")

        return f"/evidence/{filename}"

    def resolve(self, evidence_ref: str) -> Path | None:
        """Map a stored reference back to a file on disk."""
        name = evidence_ref.rsplit("/", 1)[-1]
        # Reject traversal attempts: only a bare filename inside the store.
        if not name or "/" in name or "\\" in name or name.startswith("."):
            return None
        candidate = (self._dir / name).resolve()
        try:
            candidate.relative_to(self._dir.resolve())
        except ValueError:
            return None
        return candidate if candidate.exists() else None


def annotate(frame: np.ndarray, detections: list[dict]) -> np.ndarray:
    """Draw boxes and labels for the evidence image."""
    out = frame.copy()
    colours = {
        "fire": (0, 30, 255),
        "white_smoke": (230, 230, 230),
        "grey_smoke": (150, 150, 150),
        "black_smoke": (60, 60, 60),
    }
    for d in detections:
        bb = d["bbox"]
        colour = colours.get(d.get("class", ""), (0, 165, 255))
        cv2.rectangle(out, (bb["x1"], bb["y1"]), (bb["x2"], bb["y2"]), colour, 2)
        label = f"{d.get('class','?').upper()}"
        if d.get("track_id") is not None:
            label += f" #{d['track_id']}"
        label += f" {d.get('confidence', 0):.0%}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
        ty1 = bb["y1"] - th - 8 if bb["y1"] - th - 8 >= 0 else bb["y1"]
        cv2.rectangle(out, (bb["x1"], ty1), (bb["x1"] + tw + 6, ty1 + th + 8), colour, -1)
        cv2.putText(
            out, label, (bb["x1"] + 3, ty1 + th + 2),
            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2,
        )
    return out
