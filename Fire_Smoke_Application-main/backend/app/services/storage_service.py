import os
import uuid
import cv2
import numpy as np

EVIDENCE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "evidence")
os.makedirs(EVIDENCE_DIR, exist_ok=True)

def save_evidence(frame: np.ndarray, prefix: str = "det") -> str:
    """Save annotated frame to evidence dir. Returns relative URL path."""
    filename = f"{prefix}_{uuid.uuid4().hex[:8]}.jpg"
    full_path = os.path.join(EVIDENCE_DIR, filename)
    cv2.imwrite(full_path, frame)
    return f"/evidence/{filename}"
