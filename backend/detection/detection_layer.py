import os
import cv2
import numpy as np
import torch
import logging
import json
import uuid
from datetime import datetime
from ultralytics import YOLO
import time
from typing import List, Dict, Tuple, Any, Generator

from .config import DetectionConfig, get_mode_presets, FireVerificationConfig, SmokeVerificationConfig

logger = logging.getLogger("fireguard.detection.layer")

class DetectionLayer:
    def __init__(self, config: DetectionConfig | None = None):
        if config is None:
            self.config = DetectionConfig()
        else:
            self.config = config

        self.device = "cuda" if (torch.cuda.is_available() and self.config.device == "cuda") else "cpu"
        self.model = None
        self.class_names: Dict[int, str] = {}
        self.ready = False
        self.prev_frames: Dict[str, np.ndarray] = {}
        self.consecutive_tracker: Dict[str, Dict[str, int]] = {}
        self.smoothed_confidence: Dict[str, Dict[str, float]] = {}

        # Resolve model path
        default_model = os.path.join(os.path.dirname(__file__), "..", "models", "best.pt")
        model_path = self.config.model_path if os.path.isabs(self.config.model_path) else os.path.normpath(os.path.join(os.path.dirname(__file__), "..", self.config.model_path))
        if not os.path.exists(model_path):
            model_path = default_model

        if not os.path.isfile(model_path):
            logger.warning(f"[DetectionLayer] Weights not found at {os.path.abspath(model_path)}.")
        else:
            self.model_path = model_path
            self._load_model()

        if self.ready:
            self._warmup()

        # Set up rejected ROIs folders
        self.evidence_dir = os.path.join(os.path.dirname(__file__), "..", self.config.log_dir)
        self.rejected_rois_dir = os.path.join(self.evidence_dir, self.config.rejected_rois_subfolder)
        if self.config.enable_logging:
            os.makedirs(self.rejected_rois_dir, exist_ok=True)

    def _load_model(self):
        try:
            self.model = YOLO(self.model_path)
            self.model.to(self.device)
            self.class_names = self.model.names
            self.ready = True
            logger.info(f"[DetectionLayer] Model successfully loaded on {self.device.upper()} from {self.model_path}")
        except Exception as e:
            logger.error(f"[DetectionLayer] Failed to load model: {e}")
            self.ready = False

    def _warmup(self):
        if not self.model:
            return
        try:
            dummy = np.zeros((self.config.imgsz, self.config.imgsz, 3), dtype=np.uint8)
            self.model(dummy, verbose=False, conf=self.config.conf_threshold, device=self.device)
            logger.info("[DetectionLayer] Warm-up inference completed")
        except Exception as exc:
            logger.warning(f"[DetectionLayer] Warm-up failed: {exc}")

    def _apply_mode_presets(self, current_config: DetectionConfig, mode: str) -> DetectionConfig:
        """Applies preset overrides for operating modes to a copy of the config."""
        presets = get_mode_presets(mode)
        if not presets:
            return current_config

        # Deep copy/clone by deserializing and serializing
        cfg_dict = current_config.model_dump()
        
        # Override values
        cfg_dict["conf_threshold"] = presets.get("conf_threshold", current_config.conf_threshold)
        if "fire" in presets:
            for k, v in presets["fire"].items():
                cfg_dict["fire"][k] = v
        if "smoke" in presets:
            for k, v in presets["smoke"].items():
                cfg_dict["smoke"][k] = v
        
        cfg_dict["operating_mode"] = mode
        return DetectionConfig(**cfg_dict)

    def _merge_db_settings(self, db_settings: dict | None) -> DetectionConfig:
        """Helper to dynamically merge operational overrides (e.g. from the settings DB)"""
        cfg = self.config
        # 1. Check if operating mode is defined in DB settings
        mode = cfg.operating_mode
        if db_settings:
            # Check if there is an explicit operating_mode override
            mode = db_settings.get("operating_mode", mode)
        
        # Apply mode presets first
        cfg = self._apply_mode_presets(cfg, mode)

        if not db_settings:
            return cfg

        # Clone config dict to apply direct setting overrides
        cfg_dict = cfg.model_dump()
        
        # Merge individual parameters
        if "fire_min_confidence" in db_settings:
            cfg_dict["conf_threshold"] = float(db_settings["fire_min_confidence"])
        if "iou_threshold" in db_settings:
            cfg_dict["iou_threshold"] = float(db_settings["iou_threshold"])
        if "imgsz" in db_settings:
            cfg_dict["imgsz"] = int(db_settings["imgsz"])
        if "enable_logging" in db_settings:
            cfg_dict["enable_logging"] = str(db_settings["enable_logging"]).lower() == "true"
            
        return DetectionConfig(**cfg_dict)

    # ── Stage 2: Verification Engine ──────────────────────────────────────────

    def verify_fire(self, roi_bgr: np.ndarray, roi_hsv: np.ndarray, config: FireVerificationConfig) -> Tuple[bool, str, dict]:
        """Fire verification using color, brightness, saturation and component filters."""
        if roi_bgr.size == 0 or roi_bgr.shape[0] == 0 or roi_bgr.shape[1] == 0:
            return False, "empty_roi", {}

        total_pixels = roi_hsv.shape[0] * roi_hsv.shape[1]

        # 1. Multi-range fire color masking
        fire_mask = np.zeros(roi_hsv.shape[:2], dtype=np.uint8)
        for lower, upper in config.hsv_ranges:
            mask = cv2.inRange(roi_hsv, np.array(lower), np.array(upper))
            fire_mask = cv2.bitwise_or(fire_mask, mask)

        # 2. Morphological noise removal
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        fire_mask = cv2.morphologyEx(fire_mask, cv2.MORPH_OPEN, kernel)
        fire_mask = cv2.morphologyEx(fire_mask, cv2.MORPH_CLOSE, kernel)

        # 3. Connected component filtering
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(fire_mask)
        valid_pixels = 0
        for i in range(1, num_labels):
            if stats[i, cv2.CC_STAT_AREA] >= config.min_component_size:
                valid_pixels += stats[i, cv2.CC_STAT_AREA]

        # 4. Pixel density / ratio
        flame_color_ratio = valid_pixels / total_pixels if total_pixels > 0 else 0.0

        # 5. Brightness (V) & Saturation (S)
        if valid_pixels > 0:
            active_hsv = roi_hsv[fire_mask > 0]
            avg_sat = float(np.mean(active_hsv[:, 1]))
            avg_val = float(np.mean(active_hsv[:, 2]))
        else:
            avg_sat = 0.0
            avg_val = 0.0

        scores = {
            "flame_color_ratio": round(flame_color_ratio, 4),
            "avg_brightness": round(avg_val, 2),
            "avg_saturation": round(avg_sat, 2),
            "components_count": max(0, num_labels - 1),
        }

        # 6. Verification Checks
        if flame_color_ratio < config.min_pixel_ratio:
            return False, f"low_flame_ratio (ratio={flame_color_ratio:.4f} < threshold={config.min_pixel_ratio})", scores
        if avg_val < config.min_brightness:
            return False, f"low_brightness (brightness={avg_val:.1f} < threshold={config.min_brightness})", scores
        if avg_sat < config.min_saturation:
            return False, f"low_saturation (saturation={avg_sat:.1f} < threshold={config.min_saturation})", scores

        return True, "passed", scores

    def verify_smoke(self, roi_bgr: np.ndarray, roi_hsv: np.ndarray, roi_gray: np.ndarray, config: SmokeVerificationConfig) -> Tuple[bool, str, dict]:
        """Smoke verification checking texture, desaturation, edges, entropy, and blur."""
        if roi_bgr.size == 0 or roi_bgr.shape[0] == 0 or roi_bgr.shape[1] == 0:
            return False, "empty_roi", {}

        total_pixels = roi_gray.size

        # 1. Saturation distribution (smoke is desaturated gray)
        avg_sat = float(np.mean(roi_hsv[:, :, 1]))
        if avg_sat > config.max_saturation:
            return False, f"highly_saturated (sat={avg_sat:.1f} > max={config.max_saturation})", {"avg_saturation": round(avg_sat, 2)}

        # 2. Brightness minimum (smoke shouldn't be deep shadows/black)
        avg_val = float(np.mean(roi_hsv[:, :, 2]))
        if avg_val < config.min_brightness:
            return False, f"too_dark (brightness={avg_val:.1f} < min={config.min_brightness})", {"avg_brightness": round(avg_val, 2)}

        # 3. Gray/White dominance (Neutral chroma check: max(BGR) - min(BGR) should be low)
        b, g, r = cv2.split(roi_bgr)
        chroma_diff = cv2.absdiff(cv2.max(cv2.max(b, g), r), cv2.min(cv2.min(b, g), r))
        avg_chroma = float(np.mean(chroma_diff))
        if avg_chroma > config.max_chroma:
            return False, f"high_chroma (chroma={avg_chroma:.1f} > max={config.max_chroma})", {"avg_chroma": round(avg_chroma, 2)}

        # 4. Local texture variance (std dev)
        texture_std = float(np.std(roi_gray))
        if texture_std < config.min_texture_std or texture_std > config.max_texture_std:
            return False, f"bad_texture_variance (std={texture_std:.2f} outside [{config.min_texture_std}, {config.max_texture_std}])", {"texture_std": round(texture_std, 2)}

        # 5. Local contrast (max contrast check)
        if texture_std > config.max_contrast:
            return False, f"high_contrast (contrast={texture_std:.1f} > max={config.max_contrast})", {"texture_std": round(texture_std, 2)}

        # 6. Edge density (Canny edges ratio)
        edges = cv2.Canny(roi_gray, 50, 150)
        edge_density = float(np.count_nonzero(edges) / total_pixels) if total_pixels > 0 else 0.0
        if edge_density > config.max_edge_density:
            return False, f"high_edge_density (edges={edge_density:.4f} > max={config.max_edge_density})", {"edge_density": round(edge_density, 4)}

        # 7. Color/grayscale entropy
        hist = cv2.calcHist([roi_gray], [0], None, [256], [0, 256])
        hist = hist.ravel() / (hist.sum() + 1e-7)
        entropy = float(-np.sum(hist * np.log2(hist + 1e-7)))
        if entropy < config.min_entropy or entropy > config.max_entropy:
            return False, f"bad_entropy (entropy={entropy:.2f} outside [{config.min_entropy}, {config.max_entropy}])", {"entropy": round(entropy, 2)}

        # 8. Blur characteristics (Variance of Laplacian)
        laplacian_var = float(cv2.Laplacian(roi_gray, cv2.CV_64F).var())
        if laplacian_var > config.max_laplacian_var:
            return False, f"sharp_structures (laplacian_var={laplacian_var:.1f} > max={config.max_laplacian_var})", {"laplacian_var": round(laplacian_var, 2)}
        if laplacian_var < config.min_laplacian_var:
            return False, f"too_blurry_or_uniform (laplacian_var={laplacian_var:.1f} < min={config.min_laplacian_var})", {"laplacian_var": round(laplacian_var, 2)}

        # 9. Diffusion patterns (Sobel magnitude check)
        sobelx = cv2.Sobel(roi_gray, cv2.CV_64F, 1, 0, ksize=3)
        sobely = cv2.Sobel(roi_gray, cv2.CV_64F, 0, 1, ksize=3)
        grad_mag = cv2.magnitude(sobelx, sobely)
        avg_grad = float(np.mean(grad_mag))
        if avg_grad > config.max_gradient_mag:
            return False, f"high_gradient (gradient={avg_grad:.1f} > max={config.max_gradient_mag})", {"avg_gradient_mag": round(avg_grad, 2)}
        if avg_grad < config.min_gradient_mag:
            return False, f"flat_gradient (gradient={avg_grad:.1f} < min={config.min_gradient_mag})", {"avg_gradient_mag": round(avg_grad, 2)}

        scores = {
            "avg_saturation": round(avg_sat, 2),
            "avg_brightness": round(avg_val, 2),
            "avg_chroma": round(avg_chroma, 2),
            "texture_std": round(texture_std, 2),
            "edge_density": round(edge_density, 4),
            "entropy": round(entropy, 2),
            "laplacian_var": round(laplacian_var, 2),
            "avg_gradient_mag": round(avg_grad, 2),
        }

        return True, "passed", scores

    # ── False Positive Analysis Logger ────────────────────────────────────────

    def _log_rejection(self, original_conf: float, detection_type: str, reason: str, scores: dict, roi: np.ndarray, camera_id: str | None = None):
        """Saves logs and crop images of false positive / rejected candidates for tuning."""
        if not self.config.enable_logging:
            return

        cam_id = camera_id or "UNKNOWN"
        timestamp = datetime.utcnow()
        timestamp_str = timestamp.isoformat().replace(":", "-").replace(".", "-")
        unique_id = uuid.uuid4().hex[:8]

        # 1. Save crop image
        filename = f"rejected_{timestamp_str}_{cam_id}_{detection_type}_{unique_id}.jpg"
        filepath = os.path.join(self.rejected_rois_dir, filename)
        try:
            cv2.imwrite(filepath, roi)
            rel_roi_path = f"/{self.config.log_dir}/{self.config.rejected_rois_subfolder}/{filename}"
        except Exception as e:
            logger.error(f"[DetectionLayer] Failed to save rejected ROI image: {e}")
            rel_roi_path = None

        # 2. Append JSON line log
        log_entry = {
            "timestamp": timestamp.isoformat() + "Z",
            "camera_id": cam_id,
            "class": detection_type,
            "original_confidence": round(original_conf, 4),
            "final_decision": "REJECTED",
            "rejection_reason": reason,
            "verification_scores": scores,
            "roi_image_path": rel_roi_path
        }
        
        log_file = os.path.join(self.evidence_dir, "rejected_detections.jsonl")
        try:
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(log_entry) + "\n")
        except Exception as e:
            logger.error(f"[DetectionLayer] Failed to write rejected log entry: {e}")

    # ── Inference Methods ─────────────────────────────────────────────────────

    def _run_stage2_verification(self, frame: np.ndarray, raw_detections: List[Dict[str, Any]], active_cfg: DetectionConfig, camera_id: str | None = None) -> List[Dict[str, Any]]:
        """Verifies each Stage 1 bounding box ROI using Stage 2 deterministic checks."""
        h, w = frame.shape[:2]
        verified_detections = []

        # Convert full image once to avoid repeated color conversions inside the loop
        hsv_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        for det in raw_detections:
            bb = det["bbox"]
            x1, y1, x2, y2 = bb["x1"], bb["y1"], bb["x2"], bb["y2"]

            # Clamp bounding box coords
            cx1 = max(0, min(x1, w - 1))
            cy1 = max(0, min(y1, h - 1))
            cx2 = max(0, min(x2, w))
            cy2 = max(0, min(y2, h))

            if cx2 <= cx1 or cy2 <= cy1:
                self._log_rejection(det["confidence"], det["detection_type"], "invalid_coordinates", {}, np.array([]), camera_id)
                continue

            roi_bgr = frame[cy1:cy2, cx1:cx2]
            roi_hsv = hsv_frame[cy1:cy2, cx1:cx2]
            roi_gray = gray_frame[cy1:cy2, cx1:cx2]

            # Resize ROI if larger than max_dim (e.g. 256) to optimize CPU processing speeds
            max_dim = 256
            h_roi, w_roi = roi_bgr.shape[:2]
            if h_roi > max_dim or w_roi > max_dim:
                scale = max_dim / max(h_roi, w_roi)
                new_w = int(w_roi * scale)
                new_h = int(h_roi * scale)
                roi_bgr = cv2.resize(roi_bgr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
                roi_hsv = cv2.resize(roi_hsv, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
                roi_gray = cv2.resize(roi_gray, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

            det_type = det["detection_type"]

            if det_type == "fire":
                is_valid, reason, scores = self.verify_fire(roi_bgr, roi_hsv, active_cfg.fire)
            elif det_type == "smoke":
                is_valid, reason, scores = self.verify_smoke(roi_bgr, roi_hsv, roi_gray, active_cfg.smoke)
            else:
                is_valid, reason, scores = False, f"unsupported_class_{det_type}", {}

            if is_valid:
                # Calculate final confidence score derived from Stage 1 (YOLO) and Stage 2 (Verification)
                # Phase 4 - Decision Fusion
                if det_type == "fire":
                    verify_score = 0.5 * (min(1.0, scores["flame_color_ratio"] / 0.20)) + 0.5 * (scores["avg_brightness"] / 255.0)
                else:  # smoke
                    verify_score = 1.0 - (scores["avg_saturation"] / 255.0)
                
                final_conf = 0.6 * det["confidence"] + 0.4 * verify_score
                det["confidence"] = round(float(final_conf), 4)
                det["verification_scores"] = scores
                verified_detections.append(det)
            else:
                logger.info(f"[Stage 2 Reject] {det_type} conf={det['confidence']:.4f} rejected: {reason}")
                self._log_rejection(det["confidence"], det_type, reason, scores, roi_bgr, camera_id)

        return verified_detections

    def _map_class(self, cls_id: int, raw_name: str) -> str | None:
        low = raw_name.lower().strip()
        if low == "fire": return "fire"
        if low == "smoke": return "smoke"
        # support standard numeric class codes
        if low.isdigit():
            if int(low) == 0: return "fire"
            if int(low) == 1: return "smoke"
        return None

    def _run_stage1_ai(self, frame: np.ndarray, active_cfg: DetectionConfig) -> List[Dict[str, Any]]:
        """Stage 1: AI YOLOv8 model inference to extract ROI bounding boxes."""
        if not self.ready or self.model is None:
            return []

        results = self.model(
            frame,
            verbose=False,
            conf=active_cfg.conf_threshold,
            iou=active_cfg.iou_threshold,
            device=self.device,
            half=(self.device == "cuda")
        )
        
        raw_candidates = []
        for r in results:
            if r.boxes is None or len(r.boxes) == 0:
                continue

            for box in r.boxes:
                cls_id = int(box.cls[0])
                raw_name = self.class_names.get(cls_id, str(cls_id))
                conf = round(float(box.conf[0]), 4)
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                mapped_cls = self._map_class(cls_id, raw_name)

                if mapped_cls is None:
                    continue

                raw_candidates.append({
                    "detection_type": mapped_cls,
                    "confidence": conf,
                    "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                    "raw_class_name": raw_name,
                    "class_id": cls_id,
                })
        return raw_candidates

    def detect_image(self, frame: np.ndarray, db_settings: dict | None = None) -> Tuple[np.ndarray, List[Dict[str, Any]]]:
        """Single entry point for image inference. Returns (annotated_frame, detections)."""
        t_start = time.perf_counter()
        
        t_prep_start = time.perf_counter()
        active_cfg = self._merge_db_settings(db_settings)
        t_prep = (time.perf_counter() - t_prep_start) * 1000.0
        
        # Stage 1: AI YOLOv8 model inference
        t_inf_start = time.perf_counter()
        raw_dets = self._run_stage1_ai(frame, active_cfg)
        t_inf = (time.perf_counter() - t_inf_start) * 1000.0
        
        if not raw_dets:
            t_total = (time.perf_counter() - t_start) * 1000.0
            logger.info(
                f"[Inference Profile] Image Upload | Prep: {t_prep:.2f}ms | YOLO Inference: {t_inf:.2f}ms | "
                f"Verification: 0.00ms | Total: {t_total:.2f}ms | Detections: 0"
            )
            return frame, []

        # Stage 2: Verification
        t_ver_start = time.perf_counter()
        verified_dets = self._run_stage2_verification(frame, raw_dets, active_cfg, camera_id="IMAGE-UPLOAD")
        t_ver = (time.perf_counter() - t_ver_start) * 1000.0
        
        # Annotate
        annotated = self.annotate_frame(frame, verified_dets)
        
        t_total = (time.perf_counter() - t_start) * 1000.0
        det_summary = ", ".join([f"{d['detection_type']} ({d['confidence']:.2f})" for d in verified_dets]) or "none"
        logger.info(
            f"[Inference Profile] Image Upload | Prep: {t_prep:.2f}ms | YOLO Inference: {t_inf:.2f}ms | "
            f"Verification: {t_ver:.2f}ms | Total: {t_total:.2f}ms | Detections: {len(verified_dets)} ({det_summary})"
        )
        return annotated, verified_dets

    def temporal_verify(self, source_id: str, detections: List[Dict[str, Any]], active_cfg: DetectionConfig) -> List[Dict[str, Any]]:
        """Filters detections to ensure temporal consistency and performs confidence smoothing."""
        if source_id not in self.consecutive_tracker:
            self.consecutive_tracker[source_id] = {"fire": 0, "smoke": 0}
        if source_id not in self.smoothed_confidence:
            self.smoothed_confidence[source_id] = {"fire": 0.0, "smoke": 0.0}

        detected_types = {d["detection_type"] for d in detections}
        consecutive_req = active_cfg.consecutive_frames
        alpha = active_cfg.smoothing_alpha

        # Update trackers
        for cls in ("fire", "smoke"):
            if cls in detected_types:
                self.consecutive_tracker[source_id][cls] += 1
                # Calculate max confidence for this class
                class_conf = max(d["confidence"] for d in detections if d["detection_type"] == cls)
                prev_conf = self.smoothed_confidence[source_id][cls]
                if prev_conf == 0.0:
                    self.smoothed_confidence[source_id][cls] = class_conf
                else:
                    self.smoothed_confidence[source_id][cls] = round(alpha * class_conf + (1 - alpha) * prev_conf, 4)
            else:
                self.consecutive_tracker[source_id][cls] = 0
                self.smoothed_confidence[source_id][cls] = 0.0

        # Filter detections list
        temporally_verified = []
        for d in detections:
            cls = d["detection_type"]
            if self.consecutive_tracker[source_id][cls] >= consecutive_req:
                # Apply smoothed confidence
                d["confidence"] = self.smoothed_confidence[source_id][cls]
                temporally_verified.append(d)

        return temporally_verified

    def detect_frame(self, frame: np.ndarray, source_id: str, db_settings: dict | None = None) -> Tuple[np.ndarray, List[Dict[str, Any]], bool]:
        """Continuous frame inference supporting motion filtering.
           Returns (annotated_frame, detections, did_infer).
        """
        t_start = time.perf_counter()
        
        t_prep_start = time.perf_counter()
        active_cfg = self._merge_db_settings(db_settings)

        # 1. Motion filtering logic (runs on original resolution before resizing)
        enable_motion = False
        if db_settings:
            enable_motion = str(db_settings.get("enable_motion_filtering", "false")).lower() == "true"
        
        if enable_motion:
            prev_frame = self.prev_frames.get(source_id)
            self.prev_frames[source_id] = frame.copy()
            if prev_frame is not None:
                diff = cv2.absdiff(frame, prev_frame)
                gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
                _, thresh = cv2.threshold(gray, 25, 255, cv2.THRESH_BINARY)
                non_zero = np.count_nonzero(thresh)
                ratio = non_zero / (frame.shape[0] * frame.shape[1])
                if ratio <= 0.005:  # motion threshold
                    # Reset temporal tracking state on skip
                    _ = self.temporal_verify(source_id, [], active_cfg)
                    t_total = (time.perf_counter() - t_start) * 1000.0
                    logger.debug(f"[Inference Skip] Camera {source_id} skipped due to lack of motion ({t_total:.2f}ms)")
                    return frame, [], False
        t_prep = (time.perf_counter() - t_prep_start) * 1000.0

        # Run AI + Verification
        t_inf_start = time.perf_counter()
        raw_dets = self._run_stage1_ai(frame, active_cfg)
        t_inf = (time.perf_counter() - t_inf_start) * 1000.0
        
        if not raw_dets:
            _ = self.temporal_verify(source_id, [], active_cfg)
            t_total = (time.perf_counter() - t_start) * 1000.0
            logger.info(
                f"[Inference Profile] Camera {source_id} | Prep: {t_prep:.2f}ms | YOLO Inference: {t_inf:.2f}ms | "
                f"Verification: 0.00ms | Total: {t_total:.2f}ms | Detections: 0"
            )
            return frame, [], True

        t_ver_start = time.perf_counter()
        verified_dets = self._run_stage2_verification(frame, raw_dets, active_cfg, camera_id=source_id)
        
        # Apply temporal consistency verification
        temporally_verified_dets = self.temporal_verify(source_id, verified_dets, active_cfg)
        t_ver = (time.perf_counter() - t_ver_start) * 1000.0
        
        annotated = self.annotate_frame(frame, temporally_verified_dets)
        
        t_total = (time.perf_counter() - t_start) * 1000.0
        det_summary = ", ".join([f"{d['detection_type']} ({d['confidence']:.2f})" for d in temporally_verified_dets]) or "none"
        logger.info(
            f"[Inference Profile] Camera {source_id} | Prep: {t_prep:.2f}ms | YOLO Inference: {t_inf:.2f}ms | "
            f"Verification: {t_ver:.2f}ms | Total: {t_total:.2f}ms | Detections: {len(temporally_verified_dets)} ({det_summary})"
        )
        return annotated, temporally_verified_dets, True

    def detect_video(self, video_path: str, consecutive: int = 3, db_settings: dict | None = None) -> Generator[Tuple[int, List[Dict[str, Any]], np.ndarray], None, None]:
        """Video stream file reader and batch inference processor."""
        active_cfg = self._merge_db_settings(db_settings)
        cap = cv2.VideoCapture(video_path)
        frame_num = 0
        counters: Dict[str, int] = {"fire": 0, "smoke": 0}
        triggered: Dict[str, bool] = {"fire": False, "smoke": False}
        skip_interval = active_cfg.conf_threshold if not db_settings else int(db_settings.get("frame_skip", 0))

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            frame_num += 1
            if skip_interval > 0 and frame_num % (skip_interval + 1) != 1:
                continue

            raw_dets = self._run_stage1_ai(frame, active_cfg)
            if not raw_dets:
                for cls in ("fire", "smoke"):
                    counters[cls] = 0
                    triggered[cls] = False
                continue

            verified_dets = self._run_stage2_verification(frame, raw_dets, active_cfg, camera_id="VIDEO-UPLOAD")
            detected_types = {d["detection_type"] for d in verified_dets}

            for cls in ("fire", "smoke"):
                if cls in detected_types:
                    counters[cls] += 1
                else:
                    counters[cls] = 0
                    triggered[cls] = False

                if counters[cls] >= consecutive and not triggered[cls]:
                    triggered[cls] = True
                    cls_dets = [d for d in verified_dets if d["detection_type"] == cls]
                    annotated = self.annotate_frame(frame, cls_dets)
                    yield frame_num, cls_dets, annotated

        cap.release()

    def detect_batch(self, frames: List[np.ndarray], db_settings: dict | None = None) -> List[Tuple[np.ndarray, List[Dict[str, Any]]]]:
        """Batch inference support."""
        results = []
        for frame in frames:
            annotated, detections = self.detect_image(frame, db_settings)
            results.append((annotated, detections))
        return results

    def annotate_frame(self, frame: np.ndarray, detections: List[Dict[str, Any]]) -> np.ndarray:
        """Annotates frame with bounding boxes and labels."""
        out = frame.copy()
        colors = {
            "fire": (0, 30, 255),    # BGR Red
            "smoke": (0, 140, 255),  # BGR Orange
        }
        for d in detections:
            bb = d["bbox"]
            color = colors.get(d["detection_type"], (255, 255, 255))
            cv2.rectangle(out, (bb["x1"], bb["y1"]), (bb["x2"], bb["y2"]), color, 2)
            label = f"{d['detection_type'].upper()} {d['confidence']:.0%}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)

            if bb["y1"] - th - 8 >= 0:
                rect_y1 = bb["y1"] - th - 8
                rect_y2 = bb["y1"]
                text_y = bb["y1"] - 4
            else:
                rect_y1 = bb["y1"]
                rect_y2 = bb["y1"] + th + 8
                text_y = bb["y1"] + th + 4

            cv2.rectangle(out, (bb["x1"], rect_y1), (bb["x1"] + tw + 6, rect_y2), color, -1)
            cv2.putText(out, label, (bb["x1"] + 3, text_y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        return out
