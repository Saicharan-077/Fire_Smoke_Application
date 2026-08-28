import os
import logging
import cv2
import numpy as np
from typing import List, Dict, Tuple, Any

try:
    from detection.detection_layer import DetectionLayer
    from detection.config import DetectionConfig
except ModuleNotFoundError:
    from backend.detection.detection_layer import DetectionLayer
    from backend.detection.config import DetectionConfig

logger = logging.getLogger("fireguard.detection.service_wrapper")

class DetectionService:
    def __init__(self):
        # Instantiate the unified detection layer
        self.layer = DetectionLayer()
        self.ready = self.layer.ready
        self.device = self.layer.device
        self.class_names = self.layer.class_names
        
        # Expose self.config for backward compatibility
        self.config = {
            "enable_motion_filtering": self.layer.config.operating_mode != "High Recall",
            "motion_threshold": 0.005,
            "enable_noise_reduction": False,
            "enable_contrast_enhancement": False,
            "enable_letterbox": False,
            "enable_resize": False,
            "resize_shape": (640, 640),
            "enable_normalization": False,
            "frame_skipping_interval": 0,
            "roi_cropping": None,
        }

    def ensure_ready(self):
        if not self.ready:
            raise RuntimeError("Detection model not loaded.")

    def _load_db_settings(self) -> dict:
        """Helper to load settings from DB for backward compatibility wrappers."""
        settings = {
            "fire_min_confidence": self.layer.config.conf_threshold,
            "smoke_min_confidence": self.layer.config.conf_threshold,
            "iou_threshold": self.layer.config.iou_threshold,
            "frame_skip": 0,
            "save_evidence": True,
            "enable_motion_filtering": False
        }
        try:
            from ..database import SessionLocal
            from ..models import Setting
            db = SessionLocal()
            try:
                fire_set = db.query(Setting).filter(Setting.id == "fire_min_confidence").first()
                if fire_set and fire_set.value:
                    settings["fire_min_confidence"] = float(fire_set.value)

                smoke_set = db.query(Setting).filter(Setting.id == "smoke_min_confidence").first()
                if smoke_set and smoke_set.value:
                    settings["smoke_min_confidence"] = float(smoke_set.value)

                iou_set = db.query(Setting).filter(Setting.id == "iou_threshold").first()
                if iou_set and iou_set.value:
                    settings["iou_threshold"] = float(iou_set.value)

                skip_set = db.query(Setting).filter(Setting.id == "frame_skip").first()
                if skip_set and skip_set.value:
                    settings["frame_skip"] = int(skip_set.value)

                save_set = db.query(Setting).filter(Setting.id == "save_evidence").first()
                if save_set and save_set.value:
                    settings["save_evidence"] = save_set.value.lower() == "true"

                motion_set = db.query(Setting).filter(Setting.id == "enable_motion_filtering").first()
                if motion_set and motion_set.value:
                    settings["enable_motion_filtering"] = motion_set.value.lower() == "true"

                mode_set = db.query(Setting).filter(Setting.id == "operating_mode").first()
                if mode_set and mode_set.value:
                    settings["operating_mode"] = str(mode_set.value)
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"[DetectionService] Failed to load DB settings: {e}")
        return settings

    def infer_image(self, frame: np.ndarray) -> Tuple[np.ndarray, List[Dict]]:
        db_settings = self._load_db_settings()
        return self.layer.detect_image(frame, db_settings=db_settings)

    def infer_frame(self, frame: np.ndarray, source_id: str) -> Tuple[np.ndarray, List[Dict], bool]:
        db_settings = self._load_db_settings()
        return self.layer.detect_frame(frame, source_id, db_settings=db_settings)

    def infer_video(self, video_path: str, consecutive: int = 1, output_video_path: str | None = None):
        db_settings = self._load_db_settings()
        yield from self.layer.detect_video(
            video_path,
            consecutive=consecutive,
            db_settings=db_settings,
            output_video_path=output_video_path,
        )

    def infer_video_stream(self, video_path: str, output_video_path: str | None = None):
        db_settings = self._load_db_settings()
        yield from self.layer.detect_video_stream(
            video_path,
            db_settings=db_settings,
            output_video_path=output_video_path,
        )

    def annotate_frame(self, frame: np.ndarray, detections: List[Dict]) -> np.ndarray:
        return self.layer.annotate_frame(frame, detections)

    def get_class_map(self) -> dict:
        def _map_class(cid: int, raw: str) -> str | None:
            low = raw.lower().strip()
            if low == "fire": return "fire"
            if low == "smoke": return "smoke"
            return None
        return {
            str(cid): {"raw_name": raw, "mapped": _map_class(cid, raw)}
            for cid, raw in self.class_names.items()
        }
