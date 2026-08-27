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

CONF_FIRE  = float(os.environ.get("CONF_FIRE", "0.50"))
CONF_SMOKE = float(os.environ.get("CONF_SMOKE", "0.60"))
CONF_RUN   = 0.25   # passed to YOLO — raised from 0.15 to reject low-quality candidates early

NUMERIC_CLASS_MAP: Dict[int, str] = {0: "fire", 1: "smoke"}

COLORS = {
    "fire":  (0,  30, 255),   # BGR red
    "smoke": (0, 140, 255),   # BGR orange
}

PER_CLASS_THRESHOLD = {
    "fire":  CONF_FIRE,
    "smoke": CONF_SMOKE,
}

# ── Post-processing filter constants ──────────────────────────────────────────
MIN_BBOX_AREA_RATIO = 0.004    # Reject boxes < 0.4% of image area (noise)
MAX_BBOX_AREA_RATIO = 0.85     # Reject boxes > 85% of image area (full-image misclassification)
MIN_ASPECT_RATIO    = 0.08     # Reject extremely thin horizontal boxes (< 1:12)
MAX_ASPECT_RATIO    = 12.0     # Reject extremely thin vertical boxes (> 12:1)

# HSV ranges for fire color validation
FIRE_HSV_RANGES = [
    ((0, 80, 120), (25, 255, 255)),     # Red-orange fire
    ((160, 80, 120), (180, 255, 255)),   # Deep red fire
    ((25, 80, 150), (40, 255, 255)),     # Yellow-orange fire
]
FIRE_COLOR_MIN_RATIO = 0.08  # At least 8% of bounding box pixels must be fire-colored

# HSV ranges for smoke color validation (low saturation, medium-high value)
SMOKE_SAT_MAX = 80     # Smoke is desaturated (grayish)
SMOKE_VAL_MIN = 60     # Smoke is not pitch black
SMOKE_COLOR_MIN_RATIO = 0.12  # At least 12% of bbox pixels must match smoke profile


def _map_class(cls_id: int, raw_name: str) -> str | None:
    low = raw_name.lower().strip()
    if low == "fire": return "fire"
    if low == "smoke": return "smoke"
    if low.isdigit():  return NUMERIC_CLASS_MAP.get(cls_id)
    return None


def _validate_fire_color(roi_bgr: np.ndarray) -> Tuple[bool, float]:
    """Check if a region contains enough warm-toned pixels to be fire."""
    if roi_bgr.size == 0:
        return False, 0.0
    hsv = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2HSV)
    total_pixels = hsv.shape[0] * hsv.shape[1]
    if total_pixels == 0:
        return False, 0.0

    fire_mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
    for lower, upper in FIRE_HSV_RANGES:
        mask = cv2.inRange(hsv, np.array(lower), np.array(upper))
        fire_mask = cv2.bitwise_or(fire_mask, mask)

    fire_ratio = np.count_nonzero(fire_mask) / total_pixels
    return fire_ratio >= FIRE_COLOR_MIN_RATIO, fire_ratio


def _validate_smoke_color(roi_bgr: np.ndarray) -> Tuple[bool, float]:
    """Check if a region has desaturated grayish pixels typical of smoke."""
    if roi_bgr.size == 0:
        return False, 0.0
    hsv = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2HSV)
    total_pixels = hsv.shape[0] * hsv.shape[1]
    if total_pixels == 0:
        return False, 0.0

    # Smoke: low saturation, not too dark
    smoke_mask = cv2.inRange(
        hsv,
        np.array([0, 0, SMOKE_VAL_MIN]),
        np.array([180, SMOKE_SAT_MAX, 255])
    )
    smoke_ratio = np.count_nonzero(smoke_mask) / total_pixels
    return smoke_ratio >= SMOKE_COLOR_MIN_RATIO, smoke_ratio


class DetectionService:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = None
        self.class_names: dict = {}
        self.ready = False
        self.prev_frames: Dict[str, np.ndarray] = {}

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
        logger.info(f"[MODEL] Post-proc : area=[{MIN_BBOX_AREA_RATIO:.3f},{MAX_BBOX_AREA_RATIO:.2f}] aspect=[{MIN_ASPECT_RATIO},{MAX_ASPECT_RATIO}]")
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

    def _load_db_settings(self) -> dict:
        """Loads and returns dynamic settings from the database, falling back to env/defaults."""
        settings = {
            "fire_min_confidence": CONF_FIRE,
            "smoke_min_confidence": CONF_SMOKE,
            "iou_threshold": 0.45,
            "frame_skip": 0,
            "save_evidence": True,
            "enable_motion_filtering": self.config["enable_motion_filtering"]
        }
        try:
            from ..database import SessionLocal
            from ..models import Setting
            db = SessionLocal()
            try:
                # check class specific fire
                fire_set = db.query(Setting).filter(Setting.id == "fire_min_confidence").first()
                if fire_set and fire_set.value:
                    settings["fire_min_confidence"] = float(fire_set.value)

                # check class specific smoke
                smoke_set = db.query(Setting).filter(Setting.id == "smoke_min_confidence").first()
                if smoke_set and smoke_set.value:
                    settings["smoke_min_confidence"] = float(smoke_set.value)

                # Load iou threshold
                iou_set = db.query(Setting).filter(Setting.id == "iou_threshold").first()
                if iou_set and iou_set.value:
                    settings["iou_threshold"] = float(iou_set.value)

                # Load frame skip
                skip_set = db.query(Setting).filter(Setting.id == "frame_skip").first()
                if skip_set and skip_set.value:
                    settings["frame_skip"] = int(skip_set.value)

                # Load save evidence
                save_set = db.query(Setting).filter(Setting.id == "save_evidence").first()
                if save_set and save_set.value:
                    settings["save_evidence"] = save_set.value.lower() == "true"

                # Load motion filtering
                motion_set = db.query(Setting).filter(Setting.id == "enable_motion_filtering").first()
                if motion_set and motion_set.value:
                    settings["enable_motion_filtering"] = motion_set.value.lower() == "true"
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"[MODEL] Failed to load DB settings: {e}")
        return settings

    def _preprocess_frame(self, frame: np.ndarray, prev_frame: np.ndarray | None = None, db_settings: dict | None = None) -> Tuple[np.ndarray, bool]:
        """Runs the modular preprocessing pipeline on the input frame."""
        if db_settings is None:
            db_settings = self._load_db_settings()

        # 1. Motion filtering
        enable_motion = db_settings.get("enable_motion_filtering", self.config["enable_motion_filtering"])
        if enable_motion and prev_frame is not None:
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
            out = (out.astype(np.float32) / 255.0 * 255.0).astype(np.uint8)

        return out, True

    def _post_process_detection(self, det: Dict[str, Any], frame: np.ndarray) -> Tuple[bool, str]:
        """Apply post-processing filters to a single detection.
        Returns (is_valid, rejection_reason).
        """
        bb = det["bbox"]
        x1, y1, x2, y2 = bb["x1"], bb["y1"], bb["x2"], bb["y2"]
        box_w = x2 - x1
        box_h = y2 - y1
        img_h, img_w = frame.shape[:2]
        img_area = img_h * img_w
        box_area = box_w * box_h

        if img_area == 0:
            return False, "zero_image_area"

        # 1. Minimum area filter — reject noise/artifacts
        area_ratio = box_area / img_area
        if area_ratio < MIN_BBOX_AREA_RATIO:
            return False, f"too_small (area_ratio={area_ratio:.4f} < {MIN_BBOX_AREA_RATIO})"

        # 2. Maximum area filter — reject full-image misclassification
        if area_ratio > MAX_BBOX_AREA_RATIO:
            return False, f"too_large (area_ratio={area_ratio:.4f} > {MAX_BBOX_AREA_RATIO})"

        # 3. Aspect ratio filter — reject extreme boxes
        if box_h > 0 and box_w > 0:
            aspect = box_w / box_h
            if aspect < MIN_ASPECT_RATIO or aspect > MAX_ASPECT_RATIO:
                return False, f"bad_aspect_ratio ({aspect:.2f})"

        # 4. Color validation
        # Clamp coordinates to frame bounds
        cx1 = max(0, min(x1, img_w - 1))
        cy1 = max(0, min(y1, img_h - 1))
        cx2 = max(0, min(x2, img_w))
        cy2 = max(0, min(y2, img_h))

        if cx2 <= cx1 or cy2 <= cy1:
            return False, "invalid_bbox_coords"

        roi = frame[cy1:cy2, cx1:cx2]

        detection_type = det["detection_type"]
        if detection_type == "fire":
            is_valid_color, color_ratio = _validate_fire_color(roi)
            if not is_valid_color:
                return False, f"fire_color_invalid (warm_ratio={color_ratio:.4f} < {FIRE_COLOR_MIN_RATIO})"
        elif detection_type == "smoke":
            is_valid_color, color_ratio = _validate_smoke_color(roi)
            if not is_valid_color:
                return False, f"smoke_color_invalid (gray_ratio={color_ratio:.4f} < {SMOKE_COLOR_MIN_RATIO})"

        return True, "passed"

    def _run_inference(self, frame: np.ndarray, db_settings: dict | None = None) -> List[Dict[str, Any]]:
        if db_settings is None:
            db_settings = self._load_db_settings()

        fire_threshold = db_settings.get("fire_min_confidence", CONF_FIRE)
        smoke_threshold = db_settings.get("smoke_min_confidence", CONF_SMOKE)
        iou_threshold = db_settings.get("iou_threshold", 0.45)

        results    = self.model(frame, verbose=False, conf=CONF_RUN, iou=iou_threshold, device=self.device)
        raw_candidates = []
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

                if mapped is None:
                    continue

                # Confidence threshold check
                threshold = fire_threshold if mapped == "fire" else smoke_threshold
                if conf < threshold:
                    logger.debug(f"[REJECT] {mapped} conf={conf:.4f} < threshold={threshold} — below confidence")
                    continue

                det = {
                    "detection_type": mapped,
                    "confidence":     conf,
                    "bbox":           {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                    "raw_class_name": raw_name,
                    "class_id":       cls_id,
                }
                raw_candidates.append(det)

        # Apply post-processing filters
        for det in raw_candidates:
            is_valid, reason = self._post_process_detection(det, frame)
            if is_valid:
                detections.append(det)
            else:
                logger.info(
                    f"[POST-FILTER REJECT] {det['detection_type']} conf={det['confidence']:.4f} "
                    f"bbox=({det['bbox']['x1']},{det['bbox']['y1']},{det['bbox']['x2']},{det['bbox']['y2']}) "
                    f"reason={reason}"
                )

        if raw_candidates and not detections:
            logger.info(f"[POST-FILTER] All {len(raw_candidates)} candidate(s) rejected by post-processing")

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
        db_settings = self._load_db_settings()
        processed, _ = self._preprocess_frame(frame, db_settings=db_settings)
        detections = self._run_inference(processed, db_settings=db_settings)
        annotated  = self.annotate_frame(processed, detections)
        return annotated, detections

    def infer_video(self, video_path: str, consecutive: int = 3):
        self.ensure_ready()
        db_settings = self._load_db_settings()
        cap       = cv2.VideoCapture(video_path)
        frame_num = 0
        counters:  Dict[str, int]  = {"fire": 0, "smoke": 0}
        triggered: Dict[str, bool] = {"fire": False, "smoke": False}
        prev_frame = None
        skip_interval = db_settings.get("frame_skip", 0)

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            frame_num += 1
            if skip_interval > 0 and frame_num % (skip_interval + 1) != 1:
                continue

            processed, should_infer = self._preprocess_frame(frame, prev_frame, db_settings=db_settings)
            if db_settings.get("enable_motion_filtering", self.config["enable_motion_filtering"]):
                prev_frame = frame.copy()

            if not should_infer:
                continue

            detections     = self._run_inference(processed, db_settings=db_settings)
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

    def infer_frame(self, frame: np.ndarray, source_id: str) -> Tuple[np.ndarray, List[Dict], bool]:
        """Runs modular preprocessing and inference on continuous frame sources,
           respecting motion filtering (by caching previous frames for source_id).
           Returns (annotated_frame, detections, did_infer).
        """
        self.ensure_ready()
        db_settings = self._load_db_settings()
        prev_frame = self.prev_frames.get(source_id)

        processed, should_infer = self._preprocess_frame(frame, prev_frame=prev_frame, db_settings=db_settings)

        # Cache copy of original frame
        self.prev_frames[source_id] = frame.copy()

        if not should_infer:
            return frame, [], False

        detections = self._run_inference(processed, db_settings=db_settings)
        annotated  = self.annotate_frame(processed, detections)
        return annotated, detections, True

    def get_class_map(self) -> dict:
        return {
            str(cid): {"raw_name": raw, "mapped": _map_class(cid, raw)}
            for cid, raw in self.class_names.items()
        }
