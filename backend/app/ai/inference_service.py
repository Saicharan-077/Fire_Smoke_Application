import cv2
import numpy as np
import torch
import os
import logging
from ultralytics import YOLO
from typing import List, Dict, Tuple, Any

logger = logging.getLogger("fireguard.detection")

_default_model = os.path.join(os.path.dirname(__file__), "..", "..", "models", "best.pt")
MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", _default_model)
if not os.path.isabs(MODEL_PATH):
    MODEL_PATH = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", MODEL_PATH))

CONF_FIRE  = float(os.environ.get("CONF_FIRE", "0.35"))
CONF_SMOKE = float(os.environ.get("CONF_SMOKE", "0.40"))
CONF_RUN   = 0.15   # passed to YOLO — collect all boxes, filter ourselves

NUMERIC_CLASS_MAP: Dict[int, str] = {0: "fire", 1: "smoke"}

COLORS = {
    "fire":  (0,  30, 255),   # BGR red
    "smoke": (0, 140, 255),   # BGR orange
}

PER_CLASS_THRESHOLD = {
    "fire":  CONF_FIRE,
    "smoke": CONF_SMOKE,
}

def _map_class(cls_id: int, raw_name: str) -> str | None:
    low = raw_name.lower().strip()
    if low == "fire": return "fire"
    if low == "smoke": return "smoke"
    if low.isdigit():  return NUMERIC_CLASS_MAP.get(cls_id)
    return None

class DetectionService:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = None
        self.class_names: dict = {}
        self.ready = False

        if not os.path.isfile(MODEL_PATH):
            logger.warning(
                f"[MODEL] Weights not found at {os.path.abspath(MODEL_PATH)}. "
                "Detection endpoints will return 503 until model is placed."
            )
        else:
            self._load_model()

        if self.ready:
            self._warmup()

        # Modular Preprocessing Pipeline Configuration
        self.config = {
            "enable_motion_filtering":     os.environ.get("PREPROCESS_MOTION_FILTERING", "false").lower() == "true",
            "motion_threshold":            float(os.environ.get("PREPROCESS_MOTION_THRESHOLD", "0.005")),
            "enable_noise_reduction":      os.environ.get("PREPROCESS_NOISE_REDUCTION", "false").lower() == "true",
            "enable_contrast_enhancement": os.environ.get("PREPROCESS_CONTRAST_ENHANCEMENT", "false").lower() == "true",
            "enable_letterbox":            os.environ.get("PREPROCESS_LETTERBOX", "false").lower() == "true",
            "enable_resize":               os.environ.get("PREPROCESS_RESIZE", "false").lower() == "true",
            "resize_shape":                (640, 640),
            "enable_normalization":        os.environ.get("PREPROCESS_NORMALIZATION", "false").lower() == "true",
            "frame_skipping_interval":     int(os.environ.get("PREPROCESS_FRAME_SKIPPING", "0")),
            "roi_cropping":                None, # shape: (x1, y1, x2, y2)
        }

        roi_env = os.environ.get("PREPROCESS_ROI", None)
        if roi_env:
            try:
                self.config["roi_cropping"] = tuple(map(int, roi_env.split(",")))
            except Exception:
                logger.warning("Invalid PREPROCESS_ROI format, expected 'x1,y1,x2,y2'")

        logger.info("=" * 60)
        logger.info(f"[MODEL] Path      : {os.path.abspath(MODEL_PATH)}")
        logger.info(f"[MODEL] Ready     : {self.ready}")
        logger.info(f"[MODEL] Device    : {self.device.upper()}")
        logger.info(f"[MODEL] Thresholds: fire>={CONF_FIRE}  smoke>={CONF_SMOKE}  (run@{CONF_RUN})")
        logger.info(f"[PREPROCESS] Pipeline: {self.config}")
        logger.info("=" * 60)

    def _load_model(self):
        self.model = YOLO(MODEL_PATH)
        self.model.to(self.device)
        self.class_names = self.model.names

        model_classes = {str(v).lower().strip() for v in self.class_names.values()}
        is_coco = "person" in model_classes or "car" in model_classes or "dog" in model_classes
        has_target = (
            "fire" in model_classes or "smoke" in model_classes
            or "0" in model_classes or "1" in model_classes
        )
        if is_coco or not has_target:
            logger.error(f"Invalid model loaded. Classes found: {model_classes}")
            self.model = None
            self.ready = False
            return

        self.ready = True

    def _warmup(self):
        if not self.model:
            return
        try:
            dummy = np.zeros((640, 640, 3), dtype=np.uint8)
            self.model(dummy, verbose=False, conf=CONF_RUN, device=self.device)
            logger.info("[MODEL] Warm-up inference completed")
        except Exception as exc:
            logger.warning(f"[MODEL] Warm-up failed: {exc}")

    def ensure_ready(self):
        if not self.ready or self.model is None:
            raise RuntimeError(
                f"Detection model not loaded. Place fire/smoke weights at {os.path.abspath(MODEL_PATH)}"
            )

    def _letterbox(self, img: np.ndarray, new_shape: Tuple[int, int] = (640, 640), color: Tuple[int, int, int] = (114, 114, 114)) -> np.ndarray:
        """Resize image preserving aspect ratio with padding."""
        shape = img.shape[:2]  # [height, width]
        r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])
        new_unpad = int(round(shape[1] * r)), int(round(shape[0] * r))
        dw, dh = new_shape[1] - new_unpad[0], new_shape[0] - new_unpad[1]
        dw /= 2
        dh /= 2
        if shape[::-1] != new_unpad:
            img = cv2.resize(img, new_unpad, interpolation=cv2.INTER_LINEAR)
        top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
        left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
        return cv2.copyMakeBorder(img, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color)

    def _check_motion(self, frame: np.ndarray, prev_frame: np.ndarray, threshold: float) -> bool:
        """Filter frames based on basic pixel variance differences (Motion Filtering)."""
        diff = cv2.absdiff(frame, prev_frame)
        gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
        _, thresh = cv2.threshold(gray, 25, 255, cv2.THRESH_BINARY)
        non_zero = np.count_nonzero(thresh)
        ratio = non_zero / (frame.shape[0] * frame.shape[1])
        return ratio > threshold

    def _preprocess_frame(self, frame: np.ndarray, prev_frame: np.ndarray | None = None) -> Tuple[np.ndarray, bool]:
        """Runs the modular preprocessing pipeline on the input frame."""
        # 1. Motion filtering
        if self.config["enable_motion_filtering"] and prev_frame is not None:
            if not self._check_motion(frame, prev_frame, self.config["motion_threshold"]):
                return frame, False

        out = frame.copy()

        # 2. ROI Cropping
        roi = self.config["roi_cropping"]
        if roi:
            h, w = out.shape[:2]
            x1, y1, x2, y2 = roi
            x1, x2 = max(0, x1), min(w, x2)
            y1, y2 = max(0, y1), min(h, y2)
            out = out[y1:y2, x1:x2]

        # 3. Noise reduction
        if self.config["enable_noise_reduction"]:
            out = cv2.GaussianBlur(out, (5, 5), 0)

        # 4. Contrast enhancement
        if self.config["enable_contrast_enhancement"]:
            lab = cv2.cvtColor(out, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
            cl = clahe.apply(l)
            limg = cv2.merge((cl, a, b))
            out = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)

        # 5. Resize / Letterbox
        target_shape = self.config["resize_shape"]
        if self.config["enable_letterbox"]:
            out = self._letterbox(out, target_shape)
        elif self.config["enable_resize"]:
            out = cv2.resize(out, target_shape, interpolation=cv2.INTER_LINEAR)

        # 6. Normalization
        if self.config["enable_normalization"]:
            # Min-Max Scaling simulation
            out = (out.astype(np.float32) / 255.0 * 255.0).astype(np.uint8)

        return out, True

    def _run_inference(self, frame: np.ndarray) -> List[Dict[str, Any]]:
        results    = self.model(frame, verbose=False, conf=CONF_RUN, device=self.device)
        detections = []

        for r in results:
            if r.boxes is None or len(r.boxes) == 0:
                continue

            for box in r.boxes:
                cls_id   = int(box.cls[0])
                raw_name = self.class_names.get(cls_id, str(cls_id))
                conf     = round(float(box.conf[0]), 4)
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                mapped   = _map_class(cls_id, raw_name)

                threshold = PER_CLASS_THRESHOLD.get(mapped, 0.25) if mapped else 0.25
                passes    = conf >= threshold

                if mapped is None or not passes:
                    continue

                detections.append({
                    "detection_type": mapped,
                    "confidence":     conf,
                    "bbox":           {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                    "raw_class_name": raw_name,
                    "class_id":       cls_id,
                })
        return detections

    def annotate_frame(self, frame: np.ndarray, detections: List[Dict]) -> np.ndarray:
        out = frame.copy()
        for d in detections:
            bb    = d["bbox"]
            color = COLORS.get(d["detection_type"], (255, 255, 255))
            cv2.rectangle(out, (bb["x1"], bb["y1"]), (bb["x2"], bb["y2"]), color, 2)
            label = f"{d['detection_type'].upper()} {d['confidence']:.0%}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)

            if bb["y1"] - th - 8 >= 0:
                rect_y1 = bb["y1"] - th - 8
                rect_y2 = bb["y1"]
                text_y  = bb["y1"] - 4
            else:
                rect_y1 = bb["y1"]
                rect_y2 = bb["y1"] + th + 8
                text_y  = bb["y1"] + th + 4

            cv2.rectangle(out,
                          (bb["x1"], rect_y1),
                          (bb["x1"] + tw + 6, rect_y2), color, -1)
            cv2.putText(out, label, (bb["x1"] + 3, text_y),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        return out

    def infer_image(self, frame: np.ndarray) -> Tuple[np.ndarray, List[Dict]]:
        self.ensure_ready()
        processed, _ = self._preprocess_frame(frame)
        detections = self._run_inference(processed)
        annotated  = self.annotate_frame(processed, detections)
        return annotated, detections

    def infer_video(self, video_path: str, consecutive: int = 3):
        self.ensure_ready()
        cap       = cv2.VideoCapture(video_path)
        frame_num = 0
        counters:  Dict[str, int]  = {"fire": 0, "smoke": 0}
        triggered: Dict[str, bool] = {"fire": False, "smoke": False}
        prev_frame = None
        skip_interval = self.config["frame_skipping_interval"]

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            frame_num += 1
            if skip_interval > 0 and frame_num % (skip_interval + 1) != 1:
                continue

            processed, should_infer = self._preprocess_frame(frame, prev_frame)
            if self.config["enable_motion_filtering"]:
                prev_frame = frame.copy()

            if not should_infer:
                continue

            detections     = self._run_inference(processed)
            detected_types = {d["detection_type"] for d in detections}

            for cls in ("fire", "smoke"):
                if cls in detected_types:
                    counters[cls] += 1
                else:
                    counters[cls] = 0
                    triggered[cls] = False

                if counters[cls] >= consecutive and not triggered[cls]:
                    triggered[cls] = True
                    cls_dets  = [d for d in detections if d["detection_type"] == cls]
                    annotated = self.annotate_frame(processed, cls_dets)
                    logger.info(f"{cls.upper()} confirmed at frame {frame_num}")
                    yield frame_num, cls_dets, annotated

        cap.release()

    def get_class_map(self) -> dict:
        return {
            str(cid): {"raw_name": raw, "mapped": _map_class(cid, raw)}
            for cid, raw in self.class_names.items()
        }
