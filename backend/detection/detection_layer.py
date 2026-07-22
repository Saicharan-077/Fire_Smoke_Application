import os
import cv2
import numpy as np
import torch
import logging
import json
import uuid
import base64
from datetime import datetime
from ultralytics import YOLO
import time
from typing import List, Dict, Tuple, Any, Generator

from .config import DetectionConfig, get_mode_presets, FireVerificationConfig, SmokeVerificationConfig

logger = logging.getLogger("fireguard.detection.layer")


class ByteTracker:
    """ByteTrack Multi-Object Tracker for Fire & Smoke persistence.
    Associates high-confidence detections first, then uses low-confidence candidate detections
    to recover trajectories disrupted by flame flickering or smoke occlusion.
    Applies Exponential Moving Average (EMA) for temporal confidence smoothing.
    """
    def __init__(self, high_thresh: float = 0.35, low_thresh: float = 0.15, iou_thresh: float = 0.25, max_age: int = 25):
        self.high_thresh = high_thresh
        self.low_thresh = low_thresh
        self.iou_thresh = iou_thresh
        self.max_age = max_age
        self.next_id = 1
        self.tracks = {}  # track_id -> {"bbox": dict, "detection_type": str, "confidence": float, "age": int, "hits": int}

    @staticmethod
    def _compute_iou(b1: dict, b2: dict) -> float:
        x1 = max(b1["x1"], b2["x1"])
        y1 = max(b1["y1"], b2["y1"])
        x2 = min(b1["x2"], b2["x2"])
        y2 = min(b1["y2"], b2["y2"])
        inter = max(0, x2 - x1) * max(0, y2 - y1)
        area1 = (b1["x2"] - b1["x1"]) * (b1["y2"] - b1["y1"])
        area2 = (b2["x2"] - b2["x1"]) * (b2["y2"] - b2["y1"])
        union = area1 + area2 - inter
        return inter / union if union > 0 else 0.0

    def update(self, all_detections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        for tid in list(self.tracks.keys()):
            self.tracks[tid]["age"] += 1
            if self.tracks[tid]["age"] > self.max_age:
                del self.tracks[tid]

        high_dets = [d for d in all_detections if d.get("confidence", 0) >= self.high_thresh]
        low_dets = [d for d in all_detections if self.low_thresh <= d.get("confidence", 0) < self.high_thresh]

        unmatched_tracks = set(self.tracks.keys())
        assigned_high_indices = set()

        # Stage 1: High-confidence matching
        for i, det in enumerate(high_dets):
            best_iou = 0.0
            best_tid = None
            for tid in unmatched_tracks:
                track = self.tracks[tid]
                if track["detection_type"] == det["detection_type"]:
                    iou = self._compute_iou(det["bbox"], track["bbox"])
                    if iou > best_iou and iou >= self.iou_thresh:
                        best_iou = iou
                        best_tid = tid

            if best_tid is not None:
                unmatched_tracks.remove(best_tid)
                assigned_high_indices.add(i)
                prev_conf = self.tracks[best_tid]["confidence"]
                curr_conf = det["confidence"]
                smoothed_conf = round(0.6 * curr_conf + 0.4 * prev_conf, 4)
                
                self.tracks[best_tid]["bbox"] = det["bbox"]
                self.tracks[best_tid]["confidence"] = smoothed_conf
                self.tracks[best_tid]["age"] = 0
                self.tracks[best_tid]["hits"] += 1
                det["confidence"] = smoothed_conf
                det["track_id"] = best_tid

        # Stage 2: Low-confidence matching to recover flickering tracks
        for det in low_dets:
            best_iou = 0.0
            best_tid = None
            for tid in list(unmatched_tracks):
                track = self.tracks[tid]
                if track["detection_type"] == det["detection_type"]:
                    iou = self._compute_iou(det["bbox"], track["bbox"])
                    if iou > best_iou and iou >= self.iou_thresh:
                        best_iou = iou
                        best_tid = tid

            if best_tid is not None:
                unmatched_tracks.remove(best_tid)
                prev_conf = self.tracks[best_tid]["confidence"]
                curr_conf = det["confidence"]
                smoothed_conf = round(0.3 * curr_conf + 0.7 * prev_conf, 4)

                self.tracks[best_tid]["bbox"] = det["bbox"]
                self.tracks[best_tid]["confidence"] = smoothed_conf
                self.tracks[best_tid]["age"] = 0
                self.tracks[best_tid]["hits"] += 1
                det["confidence"] = smoothed_conf
                det["track_id"] = best_tid
                high_dets.append(det)

        # Stage 3: New track initialization
        for i, det in enumerate(high_dets):
            if i not in assigned_high_indices and "track_id" not in det:
                tid = self.next_id
                self.next_id += 1
                self.tracks[tid] = {
                    "bbox": det["bbox"],
                    "detection_type": det["detection_type"],
                    "confidence": det["confidence"],
                    "age": 0,
                    "hits": 1
                }
                det["track_id"] = tid

        return high_dets


def _frame_to_base64(frame: np.ndarray, max_dim: int = 480, quality: int = 60) -> str:
    """Fast JPEG encoder converting OpenCV frame to lightweight Base64 string for live streaming."""
    h, w = frame.shape[:2]
    if max(h, w) > max_dim:
        scale = max_dim / float(max(h, w))
        nw, nh = int(w * scale), int(h * scale)
        small = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_AREA)
    else:
        small = frame
    _, buf = cv2.imencode(".jpg", small, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    return base64.b64encode(buf).decode("utf-8")


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
        self.model_path = self._resolve_model_path(self.config.model_path)
        logger.info(f"[DetectionLayer] Resolved model path: {os.path.abspath(self.model_path)}")

        self._load_model()

        if self.ready:
            self._warmup()

        # Set up rejected ROIs folders
        self.evidence_dir = os.path.join(os.path.dirname(__file__), "..", self.config.log_dir)
        self.rejected_rois_dir = os.path.join(self.evidence_dir, self.config.rejected_rois_subfolder)
        if self.config.enable_logging:
            os.makedirs(self.rejected_rois_dir, exist_ok=True)

    def _resolve_model_path(self, raw_path: str) -> str:
        """Finds valid model file or directory candidate across common project roots."""
        base_dirs = [
            os.getcwd(),
            os.path.dirname(__file__),
            os.path.abspath(os.path.join(os.path.dirname(__file__), "..")),
            os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")),
        ]
        candidates = []
        if os.path.isabs(raw_path):
            candidates.append(raw_path)
        else:
            for b in base_dirs:
                candidates.append(os.path.normpath(os.path.join(b, raw_path)))
        
        for cand in candidates:
            if os.path.exists(cand):
                return cand
        return raw_path

    def _ensure_pt_container(self, target_dir: str) -> str:
        """If target_dir is an unzipped PyTorch archive directory, packages it into a valid .pt zip container."""
        import zipfile
        sub_best = os.path.join(target_dir, "best")
        source_folder = sub_best if os.path.exists(sub_best) else target_dir

        container_pt = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "models", "yolo26s_auto.pt"))
        os.makedirs(os.path.dirname(container_pt), exist_ok=True)

        logger.info(f"[DetectionLayer] Packaging PyTorch directory package '{source_folder}' into container file '{container_pt}'...")
        with zipfile.ZipFile(container_pt, "w", zipfile.ZIP_STORED) as zf:
            for root, dirs, files in os.walk(source_folder):
                for file in files:
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, os.path.dirname(source_folder))
                    zf.write(full_path, rel_path)
        logger.info(f"[DetectionLayer] Created PyTorch model container: {container_pt}")
        return container_pt

    def _load_model(self):
        target_path = self.model_path
        if not os.path.exists(target_path):
            err_msg = f"[DetectionLayer] CRITICAL: Model weights not found at {os.path.abspath(target_path)}."
            logger.error(err_msg)
            self.ready = False
            raise FileNotFoundError(err_msg)

        if os.path.isdir(target_path):
            try:
                target_path = self._ensure_pt_container(target_path)
            except Exception as exc:
                err_msg = f"[DetectionLayer] Failed to package PyTorch directory into container: {exc}"
                logger.error(err_msg)
                self.ready = False
                raise RuntimeError(err_msg) from exc

        try:
            self.model = YOLO(target_path, task="detect")
            self.model.to(self.device)
            self.class_names = self.model.names
            self.ready = True
            logger.info(f"[MODEL_VERIFICATION] Requested Model Path: {os.path.abspath(self.model_path)}")
            logger.info(f"[MODEL_VERIFICATION] Loaded Model Container File: {os.path.abspath(target_path)}")
            logger.info(f"[MODEL_VERIFICATION] Device: {self.device.upper()} | Model Class Names ({len(self.class_names)}): {self.class_names}")
        except Exception as e:
            err_msg = f"[DetectionLayer] CRITICAL: Failed to load exported YOLO model from {target_path}: {e}"
            logger.error(err_msg)
            self.ready = False
            raise RuntimeError(err_msg) from e

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

            h_roi, w_roi = roi_bgr.shape[:2]

            # 1. Ignore very small boxes (noise / compression artifacts / camera glitching)
            if w_roi < 15 or h_roi < 15:
                det["rejection_reason"] = "box_too_small"
                det["verification_scores"] = {}
                logger.info(f"[Stage 2 Reject] {det['detection_type']} conf={det['confidence']:.4f} rejected: box_too_small ({w_roi}x{h_roi})")
                self._log_rejection(det["confidence"], det["detection_type"], "box_too_small", {}, roi_bgr, camera_id)
                continue

            # Resize ROI if larger than max_dim (e.g. 256) to optimize CPU processing speeds
            max_dim = 256
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
                is_valid, reason, scores = True, "passed_raw_yolo", {}

            # 2. Local Temporal Variance Check to ignore static backgrounds (walls, concrete floors, stationary shadows)
            if is_valid and camera_id and camera_id in self.prev_frames and self.prev_frames[camera_id] is not None:
                prev_frame = self.prev_frames[camera_id]
                if prev_frame.shape == frame.shape:
                    prev_roi_bgr = prev_frame[cy1:cy2, cx1:cx2]
                    if prev_roi_bgr.size > 0:
                        if prev_roi_bgr.shape[0] != roi_bgr.shape[0] or prev_roi_bgr.shape[1] != roi_bgr.shape[1]:
                            prev_roi_bgr = cv2.resize(prev_roi_bgr, (roi_bgr.shape[1], roi_bgr.shape[0]), interpolation=cv2.INTER_LINEAR)
                        prev_roi_gray = cv2.cvtColor(prev_roi_bgr, cv2.COLOR_BGR2GRAY)
                        if prev_roi_gray.shape == roi_gray.shape:
                            diff_img = cv2.absdiff(roi_gray, prev_roi_gray)
                            mad = float(np.mean(diff_img))
                            # If Mean Absolute Difference is extremely low, it's a static background
                            if mad < 1.8:
                                is_valid = False
                                reason = f"static_background (MAD={mad:.2f} < 1.8)"
                                scores["temporal_mad"] = round(mad, 2)

            # Cache verification details for debug logging
            det["rejection_reason"] = reason
            det["verification_scores"] = scores

            if is_valid:
                # Calculate final confidence score derived from Stage 1 (YOLO) and Stage 2 (Verification)
                # Phase 4 - Decision Fusion
                if det_type == "fire" and "flame_color_ratio" in scores and "avg_brightness" in scores:
                    verify_score = 0.5 * (min(1.0, scores["flame_color_ratio"] / 0.20)) + 0.5 * (scores["avg_brightness"] / 255.0)
                    final_conf = 0.6 * det["confidence"] + 0.4 * verify_score
                elif det_type == "smoke" and "avg_saturation" in scores:
                    verify_score = 1.0 - (scores["avg_saturation"] / 255.0)
                    final_conf = 0.6 * det["confidence"] + 0.4 * verify_score
                else:
                    final_conf = det["confidence"]
                
                det["confidence"] = round(float(final_conf), 4)
                verified_detections.append(det)
            else:
                logger.info(f"[Stage 2 Reject] {det_type} conf={det['confidence']:.4f} rejected: {reason}")
                self._log_rejection(det["confidence"], det_type, reason, scores, roi_bgr, camera_id)

        return verified_detections

    def _map_class(self, cls_id: int, raw_name: str) -> str | None:
        """Map YOLO class ID/name to detection type. Returns None for non-threat classes."""
        low = str(raw_name).lower().strip()
        # Direct fire/smoke model class names
        if "fire" in low or "flame" in low:
            return "fire"
        if "smoke" in low:
            return "smoke"
        # Background/neutral class - explicitly skip
        if low in ("other", "background", "neutral", "none", "negative"):
            return None
        # Legacy numeric class codes (some custom datasets)
        if low.isdigit():
            if int(low) == 0: return "fire"
            if int(low) == 1: return "smoke"
        # COCO general classes - skip (not relevant to fire detection)
        return None

    def _run_stage1_ai(self, frame: np.ndarray, active_cfg: DetectionConfig) -> List[Dict[str, Any]]:
        """Stage 1: AI YOLO model inference to extract ROI bounding boxes."""
        if not self.ready or self.model is None:
            return []

        org_h, org_w = frame.shape[:2]
        imgsz = active_cfg.imgsz

        # Pass frame directly to YOLO model for letterboxed aspect-preserving inference
        results = self.model(
            frame,
            imgsz=imgsz,
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

                # Skip non-threat classes (other, background, COCO general classes)
                if mapped_cls is None:
                    logger.debug(f"[Stage1] Skipping non-threat class '{raw_name}' (cls_id={cls_id})")
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
        active_cfg = self._merge_db_settings(db_settings)

        # Stage 1: AI model inference
        raw_dets = self._run_stage1_ai(frame, active_cfg)

        if not raw_dets:
            t_total = (time.perf_counter() - t_start) * 1000.0
            logger.info(f"[Inference] IMAGE-UPLOAD — 0 det(s) in {t_total:.0f}ms")
            return frame, []

        # Stage 2: Verification
        verified_dets = self._run_stage2_verification(frame, raw_dets, active_cfg, camera_id="IMAGE-UPLOAD")
        annotated = self.annotate_frame(frame, verified_dets)

        t_total = (time.perf_counter() - t_start) * 1000.0
        logger.info(f"[Inference] IMAGE-UPLOAD — {len(verified_dets)} det(s) in {t_total:.0f}ms (stage1={len(raw_dets)})")
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
            self.prev_frames[source_id] = frame.copy()
            t_total = (time.perf_counter() - t_start) * 1000.0
            logger.debug(f"[Inference] {source_id} — 0 det(s) in {t_total:.0f}ms")
            return frame, [], True

        t_ver_start = time.perf_counter()
        verified_dets = self._run_stage2_verification(frame, raw_dets, active_cfg, camera_id=source_id)
        
        # Apply temporal consistency verification
        temporally_verified_dets = self.temporal_verify(source_id, verified_dets, active_cfg)
        t_ver = (time.perf_counter() - t_ver_start) * 1000.0
        
        annotated = self.annotate_frame(frame, temporally_verified_dets)
        self.prev_frames[source_id] = frame.copy()
        
        t_total = (time.perf_counter() - t_start) * 1000.0
        if temporally_verified_dets:
            logger.info(f"[Inference] {source_id} — {len(temporally_verified_dets)} det(s) in {t_total:.0f}ms")
        else:
            logger.debug(f"[Inference] {source_id} — 0 verified in {t_total:.0f}ms (stage1={len(raw_dets)})")
        return annotated, temporally_verified_dets, True

    def detect_video(
        self,
        video_path: str,
        consecutive: int = 1,
        db_settings: dict | None = None,
        output_video_path: str | None = None,
    ) -> Generator[Tuple[int, List[Dict[str, Any]], np.ndarray], None, None]:
        """Video stream reader and batch inference processor. Yields (frame_num, detections, annotated_frame).
        Optionally writes an annotated output video to output_video_path.
        """
        active_cfg = self._merge_db_settings(db_settings)
        cap = cv2.VideoCapture(video_path)
        frame_num = 0
        counters: Dict[str, int] = {"fire": 0, "smoke": 0}
        triggered: Dict[str, bool] = {"fire": False, "smoke": False}

        # Use actual frame_skip from db_settings, not conf_threshold
        frame_skip = int(db_settings.get("frame_skip", 0)) if db_settings else 0

        # Set up VideoWriter for annotated output if requested
        writer = None
        if output_video_path:
            fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(output_video_path, fourcc, fps, (w, h))

        total_frames = 0
        detected_frames = 0
        t_start = time.perf_counter()

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            frame_num += 1
            if frame_skip > 0 and frame_num % (frame_skip + 1) != 1:
                if writer:
                    writer.write(frame)
                continue

            total_frames += 1
            raw_dets = self._run_stage1_ai(frame, active_cfg)
            if not raw_dets:
                for cls in ("fire", "smoke"):
                    counters[cls] = 0
                    triggered[cls] = False
                if writer:
                    writer.write(frame)
                continue

            verified_dets = self._run_stage2_verification(frame, raw_dets, active_cfg, camera_id="VIDEO-UPLOAD")
            detected_types = {d["detection_type"] for d in verified_dets}
            annotated = self.annotate_frame(frame, verified_dets) if verified_dets else frame

            if writer:
                writer.write(annotated)

            for cls in ("fire", "smoke"):
                if cls in detected_types:
                    counters[cls] += 1
                else:
                    counters[cls] = 0
                    triggered[cls] = False

                if counters[cls] >= consecutive and not triggered[cls]:
                    triggered[cls] = True
                    detected_frames += 1
                    cls_dets = [d for d in verified_dets if d["detection_type"] == cls]
                    cls_annotated = self.annotate_frame(frame, cls_dets)
                    yield frame_num, cls_dets, cls_annotated

        t_elapsed = time.perf_counter() - t_start
        cap.release()
        if writer:
            writer.release()
        logger.info(f"[VideoInference] Processed {total_frames} frames in {t_elapsed:.1f}s — {detected_frames} detection event(s)")

    def detect_video_stream(
        self,
        video_path: str,
        db_settings: dict | None = None,
        output_video_path: str | None = None,
        cancel_check_func = None,
    ) -> Generator[Dict[str, Any], None, None]:
        """Real-time streaming video decoder & detector.
        Supports ByteTrack IoU persistence, motion-based adaptive frame sampling, early threat alerts, live preview encoding, and Telemetry HUD metrics.
        """
        active_cfg = self._merge_db_settings(db_settings)
        tracker = ByteTracker(high_thresh=0.35, low_thresh=0.15, iou_thresh=0.25, max_age=25)

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error(f"[VideoStream] Could not open video file: {video_path}")
            return

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        writer = None
        if output_video_path:
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(output_video_path, fourcc, fps, (w, h))

        frame_num = 0
        processed_count = 0
        skipped_frames_count = 0
        consecutive_threats = {"fire": 0, "smoke": 0}
        early_alert_sent = {"fire": False, "smoke": False}
        prev_gray = None
        t_start = time.perf_counter()
        frame_latencies = []

        user_frame_skip = int(db_settings.get("frame_skip", 0)) if db_settings else 0
        base_skip = max(1, user_frame_skip + 1)
        
        while cap.isOpened():
            if cancel_check_func and cancel_check_func():
                logger.info(f"[VideoStream] Stream job cancelled by user at frame {frame_num}")
                break

            ret, frame = cap.read()
            if not ret:
                break

            frame_num += 1
            
            # 1. Motion-based adaptive skipping (STATIC vs ACTIVE scene)
            curr_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            is_static = False
            has_active_threat = consecutive_threats["fire"] > 0 or consecutive_threats["smoke"] > 0
            
            if prev_gray is not None and prev_gray.shape == curr_gray.shape:
                diff = cv2.absdiff(curr_gray, prev_gray)
                mad = float(np.mean(diff))
                if mad < 1.2 and not has_active_threat:
                    is_static = True

            prev_gray = curr_gray

            # Decide adaptive skip stride
            skip_this_frame = False
            if user_frame_skip > 0 and (frame_num % base_skip != 1):
                skip_this_frame = True
            elif is_static and (frame_num % 8 != 1):
                skip_this_frame = True
            elif not has_active_threat and (frame_num % 4 != 1):
                skip_this_frame = True

            if skip_this_frame:
                skipped_frames_count += 1
                if writer:
                    writer.write(frame)
                continue

            processed_count += 1
            t_frame_start = time.perf_counter()

            # 2. Stage 1 YOLO + Stage 2 Verification
            raw_dets = self._run_stage1_ai(frame, active_cfg)
            if raw_dets:
                verified_dets = self._run_stage2_verification(frame, raw_dets, active_cfg, camera_id="VIDEO-STREAM")
            else:
                verified_dets = []

            # 3. ByteTrack Multi-Object Association
            tracked_dets = tracker.update(verified_dets) if (raw_dets or tracker.tracks) else []

            # 4. Check Early Threat Alerts
            detected_types = {d["detection_type"] for d in tracked_dets}
            early_threat_triggered = None

            for cls in ("fire", "smoke"):
                if cls in detected_types:
                    consecutive_threats[cls] += 1
                    if consecutive_threats[cls] >= 3 and not early_alert_sent[cls]:
                        early_alert_sent[cls] = True
                        early_threat_triggered = cls
                else:
                    consecutive_threats[cls] = 0

            # Annotate frame
            annotated = self.annotate_frame(frame, tracked_dets) if tracked_dets else frame
            if writer:
                writer.write(annotated)

            t_frame_ms = (time.perf_counter() - t_frame_start) * 1000.0
            frame_latencies.append(t_frame_ms)
            if len(frame_latencies) > 50:
                frame_latencies.pop(0)

            avg_latency = round(float(np.mean(frame_latencies)), 1) if frame_latencies else 0.0

            # Performance telemetry calculations
            t_elapsed = time.perf_counter() - t_start
            proc_fps = processed_count / t_elapsed if t_elapsed > 0 else 0.0
            overall_fps = frame_num / t_elapsed if t_elapsed > 0 else 0.0
            remaining_frames = max(0, total_frames - frame_num)
            eta_sec = (remaining_frames / proc_fps) if proc_fps > 0 else 0.0
            progress_pct = round(min(100.0, (frame_num / total_frames) * 100.0), 1)

            # Generate lightweight preview thumbnail base64 for live display
            preview_b64 = _frame_to_base64(annotated, max_dim=480, quality=60)

            yield {
                "event": "frame_update",
                "type": "frame",
                "frame_number": frame_num,
                "total_frames": total_frames,
                "progress_pct": progress_pct,
                "timestamp_sec": round(frame_num / fps, 2),
                "fps": round(proc_fps, 1),
                "inference_fps": round(overall_fps, 1),
                "avg_latency_ms": avg_latency,
                "skipped_frames": skipped_frames_count,
                "active_tracks_count": len(tracker.tracks),
                "eta_sec": round(eta_sec, 1),
                "detections": tracked_dets,
                "early_threat": early_threat_triggered,
                "consecutive_threat_frames": max(consecutive_threats["fire"], consecutive_threats["smoke"]),
                "continuous_alarm": (consecutive_threats["fire"] >= 15 or consecutive_threats["smoke"] >= 20),
                "preview_b64": preview_b64,
                "has_detections": len(tracked_dets) > 0,
            }

        cap.release()
        if writer:
            writer.release()

        logger.info(
            f"[VideoStream] Completed job. Processed={processed_count}, Skipped={skipped_frames_count}/{total_frames} "
            f"in {time.perf_counter() - t_start:.1f}s"
        )


    def detect_batch(self, frames: List[np.ndarray], db_settings: dict | None = None) -> List[Tuple[np.ndarray, List[Dict[str, Any]]]]:
        """Batch inference support."""
        results = []
        for frame in frames:
            annotated, detections = self.detect_image(frame, db_settings)
            results.append((annotated, detections))
        return results

    def annotate_frame(self, frame: np.ndarray, detections: List[Dict[str, Any]]) -> np.ndarray:
        """Annotates frame with bounding boxes, labels, and tracking IDs."""
        out = frame.copy()
        colors = {
            "fire": (0, 30, 255),    # BGR Red
            "smoke": (0, 140, 255),  # BGR Orange
        }
        for d in detections:
            bb = d["bbox"]
            color = colors.get(d["detection_type"], (255, 255, 255))
            cv2.rectangle(out, (bb["x1"], bb["y1"]), (bb["x2"], bb["y2"]), color, 2)
            
            tid_str = f" #{d['track_id']}" if "track_id" in d else ""
            label = f"{d['detection_type'].upper()}{tid_str} {d['confidence']:.0%}"
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

    def _print_pipeline_debug_logs(
        self,
        frame_shape: Tuple[int, int, ...],
        t_prep: float,
        t_inf: float,
        t_ver: float,
        t_total: float,
        raw_dets: List[Dict[str, Any]],
        verified_dets: List[Dict[str, Any]],
        camera_id: str | None = None
    ):
        """Single-line compact inference log (replaces verbose multi-line debug block)."""
        cam = camera_id or "UNKNOWN"
        n_raw = len(raw_dets)
        n_ver = len(verified_dets)
        det_summary = ", ".join(
            f"{d['detection_type']}@{d['confidence']:.2f}" for d in verified_dets
        ) if verified_dets else "none"
        logger.info(
            f"[Inference] {cam} | raw={n_raw} verified={n_ver} | "
            f"prep={t_prep:.1f}ms inf={t_inf:.0f}ms ver={t_ver:.1f}ms total={t_total:.0f}ms | "
            f"dets=[{det_summary}]"
        )

