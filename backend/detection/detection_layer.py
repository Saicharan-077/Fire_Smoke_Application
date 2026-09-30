import os
import sys

scripts_dir = os.path.abspath(os.path.join(sys.prefix, 'Scripts'))
if os.path.exists(scripts_dir):
    os.environ['PATH'] = scripts_dir + os.path.pathsep + os.environ.get('PATH', '')
    if hasattr(os, 'add_dll_directory'):
        try:
            os.add_dll_directory(scripts_dir)
        except Exception:
            pass

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

        container_pt = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "models", "yolo26m_auto.pt"))
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
            # Stage 1 proposal generator threshold should not starve candidate extraction (allows faint smoke & fire)
            user_conf = float(db_settings["fire_min_confidence"])
            cfg_dict["conf_threshold"] = min(0.14, user_conf)
        if "smoke_min_confidence" in db_settings:
            user_s_conf = float(db_settings["smoke_min_confidence"])
            cfg_dict["conf_threshold"] = min(cfg_dict["conf_threshold"], min(0.14, user_s_conf))
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
        flame_color_ratio = float(valid_pixels / total_pixels) if total_pixels > 0 else 0.0

        # 5. Brightness (V) & Saturation (S)
        if valid_pixels > 0:
            active_hsv = roi_hsv[fire_mask > 0]
            avg_sat = float(np.mean(active_hsv[:, 1]))
            avg_val = float(np.mean(active_hsv[:, 2]))
        else:
            avg_sat = 0.0
            avg_val = 0.0

        # 6. Spark Detection & High-Intensity Hotspots (CV Heuristics)
        # Sparks: localized, ultra-bright, high-temperature micro-regions
        spark_mask = cv2.inRange(roi_hsv, np.array([0, 50, 230]), np.array([180, 255, 255]))
        num_spark_labels, _, spark_stats, _ = cv2.connectedComponentsWithStats(spark_mask)
        sparks_count = 0
        for i in range(1, num_spark_labels):
            area = int(spark_stats[i, cv2.CC_STAT_AREA])
            if 1 <= area <= 30:
                sparks_count += 1

        # 7. Intensity Variance / Flicker Metric
        v_channel = roi_hsv[:, :, 2]
        intensity_std = float(np.std(v_channel))
        flicker_index = min(1.0, intensity_std / 64.0)

        scores = {
            "flame_color_ratio": round(float(flame_color_ratio), 4),
            "avg_brightness": round(float(avg_val), 2),
            "avg_saturation": round(float(avg_sat), 2),
            "components_count": int(max(0, num_labels - 1)),
            "sparks_count": int(sparks_count),
            "flicker_index": round(float(flicker_index), 3),
        }

        # 8. Verification Checks
        sat_threshold = config.min_saturation
        # If flame has bright white/yellow core (common with webcams and lighters), relax saturation
        if avg_val >= 120.0:
            sat_threshold = max(5.0, config.min_saturation * 0.3)

        if flame_color_ratio < config.min_pixel_ratio and sparks_count == 0:
            return False, f"low_flame_ratio (ratio={flame_color_ratio:.4f} < threshold={config.min_pixel_ratio})", scores
        if avg_val < config.min_brightness:
            return False, f"low_brightness (brightness={avg_val:.1f} < threshold={config.min_brightness})", scores
        if avg_sat < sat_threshold:
            return False, f"low_saturation (saturation={avg_sat:.1f} < threshold={sat_threshold:.1f})", scores

        return True, "passed", scores

    def verify_sparks(self, roi_bgr: np.ndarray, roi_hsv: np.ndarray) -> Tuple[bool, str, dict]:
        """Sparks verification checking high-intensity hotspot particles and rejecting uniform sky/daylight."""
        if roi_bgr.size == 0 or roi_bgr.shape[0] == 0 or roi_bgr.shape[1] == 0:
            return False, "empty_roi", {}

        total_pixels = roi_bgr.shape[0] * roi_bgr.shape[1]

        # 0. Particle Size Check: Sparks are small localized particles, never huge bounding boxes
        if total_pixels > 15000 or roi_bgr.shape[0] > 180 or roi_bgr.shape[1] > 180:
            return False, f"spark_box_too_large ({roi_bgr.shape[1]}x{roi_bgr.shape[0]}, area={total_pixels} > 15000)", {"area": total_pixels}

        roi_gray = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2GRAY)
        v_channel = roi_hsv[:, :, 2]
        max_val = float(np.max(v_channel))
        avg_val = float(np.mean(v_channel))
        std_val = float(np.std(roi_gray))

        # 1. Reject smooth daylight sky, clouds, and uniform walls
        if avg_val > 140.0 and std_val < 20.0:
            return False, f"uniform_daylight_or_sky (avg={avg_val:.1f}, std={std_val:.1f})", {"avg_brightness": avg_val, "std": std_val}

        # 1b. Reject sky blue / cyan background in or around spark ROI
        blue_mask = cv2.inRange(roi_hsv, np.array([85, 15, 40]), np.array([140, 255, 255]))
        blue_ratio = float(np.count_nonzero(blue_mask) / float(total_pixels)) if total_pixels > 0 else 0.0
        if blue_ratio > 0.02:
            return False, f"sky_blue_in_roi (blue_ratio={blue_ratio:.2f})", {"blue_ratio": round(blue_ratio, 3)}

        # 1c. Reject daylight white/gray cloud patches (high brightness + low saturation without golden spark core)
        gold_mask = cv2.inRange(roi_hsv, np.array([10, 100, 200]), np.array([35, 255, 255]))
        gold_ratio = float(np.count_nonzero(gold_mask) / float(total_pixels)) if total_pixels > 0 else 0.0
        avg_sat = float(np.mean(roi_hsv[:, :, 1]))
        if avg_val > 150.0 and gold_ratio < 0.005 and avg_sat < 45.0:
            return False, f"daylight_cloud_patch (avg_b={avg_val:.1f}, avg_sat={avg_sat:.1f})", {"avg_brightness": avg_val, "avg_sat": avg_sat}

        # 1d. Reject stationary artificial lamps, LED light bulbs, and housing fixtures at night
        aspect_ratio = float(roi_bgr.shape[1]) / float(roi_bgr.shape[0]) if roi_bgr.shape[0] > 0 else 1.0
        if 0.55 <= aspect_ratio <= 1.75 and total_pixels > 120:
            spark_mask_temp = cv2.inRange(roi_hsv, np.array([0, 0, 220]), np.array([180, 255, 255]))
            num_spk_labels, _, spk_stats, _ = cv2.connectedComponentsWithStats(spark_mask_temp)
            if len(spk_stats) > 1:
                max_comp_area = int(np.max(spk_stats[1:, cv2.CC_STAT_AREA]))
                if max_comp_area > 80 and avg_sat < 75.0:
                    return False, f"lamp_or_light_fixture (comp_area={max_comp_area}, sat={avg_sat:.1f})", {"comp_area": max_comp_area}

        # 2. Spark particles mask (high brightness and distinct contrast)
        spark_mask = cv2.inRange(roi_hsv, np.array([0, 20, 220]), np.array([180, 255, 255]))
        spark_pixels = int(np.count_nonzero(spark_mask))
        spark_ratio = spark_pixels / float(total_pixels) if total_pixels > 0 else 0.0

        scores = {
            "max_brightness": round(max_val, 1),
            "avg_brightness": round(avg_val, 1),
            "std_brightness": round(std_val, 1),
            "spark_pixels": spark_pixels,
            "spark_ratio": round(spark_ratio, 4)
        }

        # Sparks must have intense local brightness and point contrast over background
        if max_val < 220.0:
            return False, f"low_spark_intensity (max_val={max_val:.1f} < 220)", scores

        if (max_val - avg_val) < 35.0:
            return False, f"low_local_contrast (max={max_val:.1f}, avg={avg_val:.1f})", scores

        # If it's a solid uniform field of high brightness (like sun or bright sky patch)
        if spark_ratio > 0.60:
            return False, f"broad_light_field (spark_ratio={spark_ratio:.2f})", scores

        return True, "passed", scores

    def verify_smoke(self, roi_bgr: np.ndarray, roi_hsv: np.ndarray, roi_gray: np.ndarray, config: SmokeVerificationConfig, raw_conf: float = 0.0) -> Tuple[bool, str, dict]:
        """Smoke verification checking texture, desaturation, edges, entropy, and blur.
        Tolerant of thin, dense, gray, white, dark, turbulent, and low-contrast smoke.
        """
        if roi_bgr.size == 0 or roi_bgr.shape[0] == 0 or roi_bgr.shape[1] == 0:
            return False, "empty_roi", {}

        total_pixels = roi_gray.size

        # 0. Sky & Cloud Background Rejection
        blue_mask = cv2.inRange(roi_hsv, np.array([85, 25, 40]), np.array([140, 255, 255]))
        blue_ratio = float(np.count_nonzero(blue_mask) / total_pixels) if total_pixels > 0 else 0.0
        avg_val_full = float(np.mean(roi_hsv[:, :, 2]))
        avg_sat_full = float(np.mean(roi_hsv[:, :, 1]))
        texture_std_full = float(np.std(roi_gray))

        # A. Blue Sky Rejection (Cyan/Blue/Sky Blue saturated background)
        # Protect genuine YOLO smoke detections (raw_conf >= 0.35) from being rejected by sky in the background of smoke plumes.
        if raw_conf < 0.35:
            if blue_ratio > 0.75 and avg_sat_full > 50.0 and texture_std_full < 12.0:
                return False, f"sky_blue_background (blue_ratio={blue_ratio:.2f} > 0.75)", {"blue_ratio": round(blue_ratio, 2)}

            # B. Bright Overcast Daylight Sky / Cloud Rejection (high brightness + low saturation / blue tint)
            if avg_val_full > 175.0 and texture_std_full < 8.0 and (blue_ratio > 0.05 or avg_sat_full < 20.0):
                return False, f"bright_overcast_sky (brightness={avg_val_full:.1f}, texture_std={texture_std_full:.1f})", {"avg_brightness": round(avg_val_full, 1), "texture_std": round(texture_std_full, 1)}

            # C. High Brightness Uniform Gradient (Daylight Sky Horizon)
            laplacian_var_full = float(cv2.Laplacian(roi_gray, cv2.CV_64F).var())
            if avg_val_full > 195.0 and laplacian_var_full < 30.0 and (blue_ratio > 0.05 or avg_sat_full < 15.0):
                return False, f"daylight_sky_cloud (brightness={avg_val_full:.1f}, laplacian_var={laplacian_var_full:.1f})", {"avg_brightness": round(avg_val_full, 1), "laplacian_var": round(laplacian_var_full, 1)}

        # 1. Saturation distribution (smoke is typically desaturated gray/neutral, but illuminated wildfire smoke can be saturated orange/red)
        avg_sat = float(np.mean(roi_hsv[:, :, 1]))
        max_sat_limit = config.max_saturation
        if raw_conf >= 0.35 or avg_val_full > 100.0:
            max_sat_limit = max(max_sat_limit, 185.0)

        if avg_sat > max_sat_limit:
            return False, f"highly_saturated (sat={avg_sat:.1f} > max={max_sat_limit:.1f})", {"avg_saturation": round(avg_sat, 2)}

        # 2. Brightness minimum: Allow dark/black smoke and low-light night forest smoke if desaturated
        avg_val = float(np.mean(roi_hsv[:, :, 2]))
        min_b_limit = config.min_brightness
        if raw_conf >= 0.12 or avg_sat < 40.0:
            min_b_limit = 3.0

        if avg_val < min_b_limit:
            # If it has neutral chroma and low saturation, it is legitimate dark smoke
            if avg_sat > 50.0 or avg_val < 3.0:
                return False, f"too_dark (brightness={avg_val:.1f} < min={min_b_limit:.1f})", {"avg_brightness": round(avg_val, 2)}

        # 3. Gray/White dominance (Neutral chroma check: max(BGR) - min(BGR) should be low)
        b, g, r = cv2.split(roi_bgr)
        chroma_diff = cv2.absdiff(cv2.max(cv2.max(b, g), r), cv2.min(cv2.min(b, g), r))
        avg_chroma = float(np.mean(chroma_diff))
        max_chroma_limit = config.max_chroma
        if raw_conf >= 0.35:
            max_chroma_limit = max(max_chroma_limit, 110.0)

        if avg_chroma > max_chroma_limit:
            return False, f"high_chroma (chroma={avg_chroma:.1f} > max={max_chroma_limit:.1f})", {"avg_chroma": round(avg_chroma, 2)}

        # 4. Local texture variance (std dev)
        texture_std = float(np.std(roi_gray))
        if texture_std < config.min_texture_std:
            return False, f"bad_texture_variance (std={texture_std:.2f} < {config.min_texture_std})", {"texture_std": round(texture_std, 2)}

        # 5. Local contrast (max contrast check - only reject extreme non-smoke anomalies)
        if texture_std > 110.0:
            return False, f"high_contrast (contrast={texture_std:.1f} > 110)", {"texture_std": round(texture_std, 2)}

        # 6. Edge density
        edges = cv2.Canny(roi_gray, 50, 150)
        edge_density = float(np.count_nonzero(edges) / total_pixels) if total_pixels > 0 else 0.0

        # 7. Color/grayscale entropy
        hist = cv2.calcHist([roi_gray], [0], None, [256], [0, 256])
        hist = hist.ravel() / (hist.sum() + 1e-7)
        entropy = float(-np.sum(hist * np.log2(hist + 1e-7)))
        if entropy < config.min_entropy:
            return False, f"bad_entropy (entropy={entropy:.2f} < {config.min_entropy})", {"entropy": round(entropy, 2)}

        # 8. Blur characteristics (Variance of Laplacian) - supporting feature, not rigid blocker
        laplacian_var = float(cv2.Laplacian(roi_gray, cv2.CV_64F).var())

        # 9. Diffusion patterns (Sobel magnitude check)
        sobelx = cv2.Sobel(roi_gray, cv2.CV_64F, 1, 0, ksize=3)
        sobely = cv2.Sobel(roi_gray, cv2.CV_64F, 0, 1, ksize=3)
        grad_mag = cv2.magnitude(sobelx, sobely)
        avg_grad = float(np.mean(grad_mag))

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
                logger.debug(f"[Stage 2 Reject] {det['detection_type']} conf={det['confidence']:.4f} rejected: box_too_small ({w_roi}x{h_roi})")
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
                is_valid, reason, scores = self.verify_smoke(roi_bgr, roi_hsv, roi_gray, active_cfg.smoke, raw_conf=det.get("confidence", 0.0))
            elif det_type in ("sparks", "spark"):
                is_valid, reason, scores = self.verify_sparks(roi_bgr, roi_hsv)
            else:
                is_valid, reason, scores = True, "passed_raw_yolo", {}

            # 2. Local Temporal Variance Check to ignore static backgrounds (walls, concrete floors, stationary shadows)
            # Skip MAD rejection for webcams, images, or high confidence detections
            is_live_stream = bool(camera_id and (camera_id.startswith("webcam") or camera_id.startswith("CAM-") or camera_id == "IMAGE-UPLOAD"))
            if is_valid and not is_live_stream and det["confidence"] < 0.35 and camera_id and camera_id in self.prev_frames and self.prev_frames[camera_id] is not None:
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
                            if mad < 1.0:
                                is_valid = False
                                reason = f"static_background (MAD={mad:.2f} < 1.0)"
                                scores["temporal_mad"] = round(mad, 2)

            # Cache verification details for debug logging
            det["rejection_reason"] = reason
            det["verification_scores"] = scores

            if is_valid:
                # Phase 4 - Evidence Fusion & Candidate Categorization
                raw_yolo_conf = float(det["confidence"])
                box_area = (cx2 - cx1) * (cy2 - cy1)
                frame_area = max(1, h * w)
                area_ratio = box_area / frame_area

                candidate_cat = "normal_fire"
                fusion_score = raw_yolo_conf

                if det_type == "fire":
                    flame_ratio = scores.get("flame_color_ratio", 0.0)
                    brightness = scores.get("avg_brightness", 0.0) / 255.0
                    sparks = scores.get("sparks_count", 0)
                    components = scores.get("components_count", 0)
                    flicker = scores.get("flicker_index", 0.0)
                    color_score = min(1.0, flame_ratio / 0.08)

                    # Fusion Weights for continuous flame / wildfire / gas fire / bonfire
                    spark_boost = min(0.08, sparks * 0.02)
                    fusion_score = (0.55 * raw_yolo_conf) + (0.25 * color_score) + (0.12 * brightness) + (0.08 * flicker) + spark_boost
                    fusion_score = min(0.99, max(0.20, fusion_score))

                    # Sub-categorization
                    if area_ratio < 0.015 or box_area < 1800:
                        candidate_cat = "far_fire_candidate"
                    elif flicker > 0.65:
                        candidate_cat = "flickering_fire"
                    else:
                        candidate_cat = "normal_fire"

                elif det_type == "smoke":
                    sat = scores.get("avg_saturation", 0.0) / 255.0
                    chroma = scores.get("avg_chroma", 0.0) / 70.0
                    entropy = scores.get("entropy", 0.0) / 6.5
                    desat_score = max(0.0, 1.0 - sat)
                    chroma_score = max(0.0, 1.0 - min(1.0, chroma))
                    entropy_score = min(1.0, entropy)
                    lap_score = min(1.0, max(0.2, 1.0 - abs(scores.get("laplacian_var", 150.0) - 150.0) / 1200.0))
                    cv_score = (0.35 * desat_score) + (0.25 * chroma_score) + (0.20 * entropy_score) + (0.20 * lap_score)
                    fusion_score = (0.60 * raw_yolo_conf) + (0.40 * cv_score)
                    candidate_cat = "normal_smoke"

                elif det_type in ("sparks", "spark"):
                    max_b = scores.get("max_brightness", 160.0) / 255.0
                    std_b = scores.get("std_brightness", 20.0) / 50.0
                    fusion_score = min(0.99, max(0.30, (0.55 * raw_yolo_conf) + (0.30 * min(1.0, max_b)) + (0.15 * min(1.0, std_b))))
                    candidate_cat = "spark_occluded"

                # Phase 5 - Alert Engine Severity Mapping
                final_conf = round(float(fusion_score), 4)
                if final_conf >= 0.65 or (det_type == "fire" and candidate_cat == "normal_fire" and final_conf >= 0.50):
                    alert_level = "RED"
                elif final_conf >= 0.30 or candidate_cat in ("far_fire_candidate", "spark_occluded") or det_type in ("sparks", "spark"):
                    alert_level = "YELLOW"
                else:
                    alert_level = "GREEN"

                det["confidence"] = final_conf
                det["raw_yolo_conf"] = raw_yolo_conf
                det["candidate_category"] = candidate_cat
                det["alert_level"] = alert_level
                det["fusion_score"] = final_conf
                verified_detections.append(det)
            else:
                logger.info(f"[Stage 2 Reject] {det_type} conf={det['confidence']:.4f} rejected: {reason}")
                self._log_rejection(det["confidence"], det_type, reason, scores, roi_bgr, camera_id)

        return verified_detections

    def _map_class(self, cls_id: int, raw_name: str) -> str | None:
        """Map YOLO class ID/name to detection type. Returns None for non-threat classes."""
        low = str(raw_name).lower().strip()
        # Direct fire/smoke/sparks model class names
        if "fire" in low or "flame" in low:
            return "fire"
        if "smoke" in low:
            return "smoke"
        if "spark" in low:
            return "sparks"
        # Background/neutral class - explicitly skip
        if low in ("other", "background", "neutral", "none", "negative"):
            return None
        # Legacy numeric class codes (0=fire, 1=smoke, 2=sparks)
        if low.isdigit():
            if int(low) == 0: return "fire"
            if int(low) == 1: return "smoke"
            if int(low) == 2: return "sparks"
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
        """Single entry point for image inference with full YOLO + CV Spark/Flame fusion and NMS."""
        t_start = time.perf_counter()
        active_cfg = self._merge_db_settings(db_settings)

        # Stage 1: AI model inference
        raw_dets = self._run_stage1_ai(frame, active_cfg)

        # Stage 2: CV Spark & Hotspot Candidate Extraction
        cv_candidates = self.detect_cv_candidates(frame)

        all_candidates = list(raw_dets)
        for cv_c in cv_candidates:
            c_bb = cv_c["bbox"]
            c_area = max(1, (c_bb["x2"] - c_bb["x1"]) * (c_bb["y2"] - c_bb["y1"]))
            # Reject CV sparks that are inside or overlap with any real YOLO detection (e.g. smoke plume or flame)
            inside_yolo = any(
                (max(0, min(c_bb["x2"], yd["bbox"]["x2"]) - max(c_bb["x1"], yd["bbox"]["x1"])) *
                 max(0, min(c_bb["y2"], yd["bbox"]["y2"]) - max(c_bb["y1"], yd["bbox"]["y1"]))) / float(c_area) > 0.15
                for yd in raw_dets
            )
            if not inside_yolo and cv_c["confidence"] >= 0.60:
                all_candidates.append(cv_c)

        if not all_candidates:
            t_total = (time.perf_counter() - t_start) * 1000.0
            logger.info(f"[Inference] IMAGE-UPLOAD — 0 det(s) in {t_total:.0f}ms")
            return frame, []

        # Stage 3: Verification & Fusion
        verified_dets = self._run_stage2_verification(frame, all_candidates, active_cfg, camera_id="IMAGE-UPLOAD")

        # Stage 4: Box Enclosure & Overlap Clustering (clean, uncluttered presentation)
        final_dets = []
        for d in sorted(verified_dets, key=lambda x: (x["bbox"]["x2"] - x["bbox"]["x1"]) * (x["bbox"]["y2"] - x["bbox"]["y1"]), reverse=True):
            bb = d["bbox"]
            box_area = max(1, (bb["x2"] - bb["x1"]) * (bb["y2"] - bb["y1"]))
            
            # Check if this box is largely enclosed within an existing larger kept box
            is_enclosed = False
            for kept in final_dets:
                kbb = kept["bbox"]
                ix1, iy1 = max(bb["x1"], kbb["x1"]), max(bb["y1"], kbb["y1"])
                ix2, iy2 = min(bb["x2"], kbb["x2"]), min(bb["y2"], kbb["y2"])
                if ix2 > ix1 and iy2 > iy1:
                    inter_area = (ix2 - ix1) * (iy2 - iy1)
                    # If this box is sparks and inside/overlapping a larger fire box, suppress it to prevent bonfire clutter
                    if d["detection_type"] in ("sparks", "spark") and kept["detection_type"] == "fire" and (inter_area / float(box_area)) > 0.15:
                        is_enclosed = True
                        break
                    # Only suppress redundant sub-boxes of the SAME class (e.g. smaller flame inside larger flame)
                    # Never allow smoke to suppress fire or fire to suppress smoke!
                    if d["detection_type"] == kept["detection_type"] and (inter_area / float(box_area)) > 0.35:
                        is_enclosed = True
                        break
            
            if not is_enclosed:
                final_dets.append(d)
            if len(final_dets) >= 20:
                break

        # Sort by confidence for display
        final_dets.sort(key=lambda x: x["confidence"], reverse=True)
        annotated = self.annotate_frame(frame, final_dets)

        t_total = (time.perf_counter() - t_start) * 1000.0
        logger.info(f"[Inference] IMAGE-UPLOAD — {len(final_dets)} det(s) in {t_total:.0f}ms (candidates={len(all_candidates)})")
        return annotated, final_dets

    def temporal_verify(self, source_id: str, detections: List[Dict[str, Any]], active_cfg: DetectionConfig) -> List[Dict[str, Any]]:
        """Filters detections to ensure temporal consistency and performs confidence smoothing."""
        if source_id not in self.consecutive_tracker:
            self.consecutive_tracker[source_id] = {"fire": 0, "smoke": 0, "sparks": 0}
        if source_id not in self.smoothed_confidence:
            self.smoothed_confidence[source_id] = {"fire": 0.0, "smoke": 0.0, "sparks": 0.0}

        detected_types = {d["detection_type"] for d in detections}
        consecutive_req = active_cfg.consecutive_frames
        alpha = active_cfg.smoothing_alpha

        # For webcam / live continuous testing, respond instantly
        is_webcam = bool(str(source_id).startswith("webcam") or str(source_id) == "IMAGE-UPLOAD")
        if is_webcam:
            consecutive_req = 1

        # Update trackers
        for cls in ("fire", "smoke", "sparks"):
            if cls in detected_types:
                self.consecutive_tracker[source_id][cls] = self.consecutive_tracker[source_id].get(cls, 0) + 1
                class_conf = max(d["confidence"] for d in detections if d["detection_type"] == cls)
                prev_conf = self.smoothed_confidence[source_id].get(cls, 0.0)
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
            if self.consecutive_tracker[source_id].get(cls, 0) >= consecutive_req:
                d["confidence"] = self.smoothed_confidence[source_id].get(cls, d["confidence"])
                temporally_verified.append(d)

        return temporally_verified

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
            fourcc = cv2.VideoWriter_fourcc(*"avc1")
            writer = cv2.VideoWriter(output_video_path, fourcc, fps, (w, h))
            if not writer.isOpened():
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
                for cls in ("fire", "smoke", "sparks"):
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

            for cls in ("fire", "smoke", "sparks"):
                if cls in detected_types:
                    counters[cls] = counters.get(cls, 0) + 1
                else:
                    counters[cls] = 0
                    triggered[cls] = False

                if counters[cls] >= consecutive and not triggered.get(cls, False):
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

    @staticmethod
    def extract_video_metadata(video_path: str) -> dict:
        """Extracts deterministic video metadata (width, height, fps, total_frames, duration, codec)."""
        if not os.path.exists(video_path):
            return {"error": "File not found", "width": 0, "height": 0, "fps": 0, "frame_count": 0, "duration": 0}
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return {"error": "Could not decode video file", "width": 0, "height": 0, "fps": 0, "frame_count": 0, "duration": 0}
            
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        if fps <= 0 or np.isnan(fps):
            fps = 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = round(float(total_frames / fps), 2) if total_frames > 0 else 0.0
        fourcc_int = int(cap.get(cv2.CAP_PROP_FOURCC))
        codec = "".join([chr((fourcc_int >> 8 * i) & 0xFF) for i in range(4)])
        file_size_mb = round(os.path.getsize(video_path) / (1024 * 1024), 2)
        cap.release()
        
        return {
            "width": w,
            "height": h,
            "fps": round(fps, 2),
            "frame_count": total_frames,
            "total_frames": total_frames,
            "duration": duration,
            "duration_sec": duration,
            "codec": codec.strip() or "mp4",
            "file_size_mb": file_size_mb,
        }

    def detect_cv_candidates(self, frame: np.ndarray, prev_gray: np.ndarray | None = None) -> List[Dict[str, Any]]:
        """Lightweight CV layer to detect cohesive spark burst envelopes (sparklers, fireworks, welding sparks)."""
        candidates = []
        h, w = frame.shape[:2]
        frame_area = max(1, h * w)
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # 1. Spark mask: ultra-bright incandescent hotspot pixels (white incandescent core or golden spark lines)
        spark_mask_white = cv2.inRange(hsv, np.array([0, 0, 248]), np.array([180, 50, 255]))
        spark_mask_gold = cv2.inRange(hsv, np.array([10, 140, 235]), np.array([35, 255, 255]))
        spark_mask = cv2.bitwise_or(spark_mask_white, spark_mask_gold)
        
        # 2. Cohesive Spark Envelopes
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        dilated = cv2.dilate(spark_mask, kernel, iterations=1)
        contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for c in contours:
            x, y, cw, ch = cv2.boundingRect(c)
            area = cw * ch
            # Sparks are small localized particles: area <= 5000 px, cw <= 120, ch <= 120
            # Enforce minimum 15px width AND height to match Stage-2 box_too_small gate
            # (avoids generating thin-sliver boxes that are guaranteed rejected)
            if 25 <= area <= 5000 and cw >= 15 and ch >= 15 and cw <= 120 and ch <= 120:
                pad = 4
                bx1, by1 = max(0, x - pad), max(0, y - pad)
                bx2, by2 = min(w, x + cw + pad), min(h, y + ch + pad)
                roi_gray = gray[by1:by2, bx1:bx2]
                if roi_gray.size == 0:
                    continue
                std_val = float(np.std(roi_gray))
                max_val = float(np.max(roi_gray))
                avg_val = float(np.mean(roi_gray))
                
                # Sparks must have intense local peak and sharp contrast over local ambient
                if max_val >= 245.0 and (max_val - avg_val) >= 40.0:
                    roi_hsv = hsv[by1:by2, bx1:bx2]
                    # Check if candidate ROI touches blue sky or cyan background
                    roi_blue = cv2.inRange(roi_hsv, np.array([85, 15, 40]), np.array([140, 255, 255]))
                    if np.count_nonzero(roi_blue) > 0.02 * roi_gray.size:
                        continue # Skip! It's in the sky or next to sky!

                    # Check if candidate ROI is a white cloud patch (low saturation + high brightness, lacking golden spark core)
                    roi_gold = cv2.inRange(roi_hsv, np.array([10, 100, 200]), np.array([35, 255, 255]))
                    roi_sat = float(np.mean(roi_hsv[:, :, 1]))
                    if roi_sat < 45.0 and np.count_nonzero(roi_gold) < 2:
                        continue # Skip white cloud patch!

                    # Check if candidate ROI is a solid artificial lamp / LED light bulb housing at night
                    aspect_ratio = float(cw) / float(ch) if ch > 0 else 1.0
                    c_area = cv2.contourArea(c)
                    solidity = c_area / float(area) if area > 0 else 0.0
                    if 0.55 <= aspect_ratio <= 1.75 and solidity > 0.55 and area > 100 and roi_sat < 75.0:
                        continue # Skip outdoor garden lamp fixture / LED light bulb!

                    conf = round(min(0.90, max(0.55, 0.50 + (std_val / 50.0) * 0.30)), 4)
                    candidates.append({
                        "detection_type": "sparks",
                        "confidence": conf,
                        "bbox": {"x1": bx1, "y1": by1, "x2": bx2, "y2": by2},
                        "source": "cv",
                        "candidate_category": "spark_occluded",
                        "alert_level": "YELLOW",
                        "verified": True,
                        "verification_scores": {"spark_area": area, "std": round(std_val, 1), "max_b": max_val}
                    })
        return candidates

    def detect_video_stream(
        self,
        video_path: str,
        db_settings: dict | None = None,
        output_video_path: str | None = None,
        cancel_check_func = None,
        mode: str = "Real-Time",
    ) -> Generator[Dict[str, Any], None, None]:
        """Real-time streaming video decoder & detector.
        Supports sequential frame extraction, ByteTrack IoU persistence, CV small-object enhancement,
        deterministic timestamps, telemetry profiling, and MJPEG + preview encoding.
        """
        active_cfg = self._merge_db_settings(db_settings)
        mode_lower = str(mode or active_cfg.operating_mode or "Real-Time").lower()
        is_accuracy_mode = "accuracy" in mode_lower or "precision" in mode_lower
        is_debug_mode = "debug" in mode_lower

        tracker = ByteTracker(high_thresh=0.30, low_thresh=0.15, iou_thresh=0.20, max_age=30)

        meta = self.extract_video_metadata(video_path)
        fps = meta.get("fps", 25.0) or 25.0
        total_frames = meta.get("total_frames", 1) or 1
        w = meta.get("width", 640) or 640
        h = meta.get("height", 480) or 480

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error(f"[VideoStream] Could not open video file: {video_path}")
            return

        writer = None
        if output_video_path:
            try:
                fourcc = cv2.VideoWriter_fourcc(*"avc1")
                writer = cv2.VideoWriter(output_video_path, fourcc, fps, (w, h))
                if not writer.isOpened():
                    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                    writer = cv2.VideoWriter(output_video_path, fourcc, fps, (w, h))
            except Exception:
                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                writer = cv2.VideoWriter(output_video_path, fourcc, fps, (w, h))

        frame_num = 0
        processed_count = 0
        skipped_frames_count = 0
        consecutive_threats = {"fire": 0, "smoke": 0, "sparks": 0}
        early_alert_sent = {"fire": False, "smoke": False, "sparks": False}
        prev_gray = None
        t_start = time.perf_counter()
        user_frame_skip = int(db_settings.get("frame_skip", 0)) if db_settings else 0
        base_skip = max(1, user_frame_skip + 1)

        frame_latencies: list = []
        carried_dets: list = []

        # In Accuracy mode, evaluate every single frame (stride=1) for exhaustive hazard capture.
        # In Real-Time mode, sample 2-3 keyframes per second for low latency.
        if is_accuracy_mode:
            normal_stride = 1
        else:
            normal_stride = max(1, int(round(fps / 2.5)))

        while cap.isOpened():
            if cancel_check_func and cancel_check_func():
                logger.info(f"[VideoStream] Stream job cancelled by user at frame {frame_num}")
                break

            t_dec_start = time.perf_counter()
            ret, frame = cap.read()
            if not ret:
                break

            frame_num += 1
            t_decode_ms = (time.perf_counter() - t_dec_start) * 1000.0

            curr_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            has_active_threat = any(c > 0 for c in consecutive_threats.values())

            # Maintain fast real-time stride across stream
            current_stride = normal_stride
            if user_frame_skip > 0:
                current_stride = max(current_stride, base_skip)

            run_inference = (frame_num % current_stride == 1) or (frame_num == 1)

            t_infer_ms = 0.0
            t_cv_ms = 0.0

            if run_inference:
                processed_count += 1
                t_frame_start = time.perf_counter()

                # Pre-scale high-res input frames (e.g. 4K) if needed, but preserve aspect ratio
                infer_frame = frame
                h_f, w_f = frame.shape[:2]
                if max(h_f, w_f) > 1280:
                    scale_f = 1280.0 / float(max(h_f, w_f))
                    infer_frame = cv2.resize(frame, (int(w_f * scale_f), int(h_f * scale_f)), interpolation=cv2.INTER_AREA)

                # 1. Stage 1 YOLO Inference
                t_yolo_start = time.perf_counter()
                raw_dets = self._run_stage1_ai(infer_frame, active_cfg)
                t_infer_ms = (time.perf_counter() - t_yolo_start) * 1000.0

                if raw_dets and max(h_f, w_f) > 1280:
                    inv_scale = float(max(h_f, w_f)) / 1280.0
                    for d in raw_dets:
                        bb = d["bbox"]
                        bb["x1"] = int(bb["x1"] * inv_scale)
                        bb["y1"] = int(bb["y1"] * inv_scale)
                        bb["x2"] = int(bb["x2"] * inv_scale)
                        bb["y2"] = int(bb["y2"] * inv_scale)

                # 2. CV Enhancement Layer (Sparks & Distant Fire)
                t_cv_start = time.perf_counter()
                cv_candidates = self.detect_cv_candidates(frame, prev_gray)
                t_cv_ms = (time.perf_counter() - t_cv_start) * 1000.0

                # Merge CV candidates if not covered by or inside ANY YOLO detection
                all_raw = list(raw_dets)
                for cv_c in cv_candidates:
                    c_bb = cv_c["bbox"]
                    c_area = max(1, (c_bb["x2"] - c_bb["x1"]) * (c_bb["y2"] - c_bb["y1"]))
                    # Candidate is inside or significantly overlapping ANY YOLO detection (smoke plume or fire flame)
                    inside_yolo = any(
                        (max(0, min(c_bb["x2"], yd["bbox"]["x2"]) - max(c_bb["x1"], yd["bbox"]["x1"])) *
                         max(0, min(c_bb["y2"], yd["bbox"]["y2"]) - max(c_bb["y1"], yd["bbox"]["y1"]))) / float(c_area) > 0.15
                        for yd in raw_dets
                    )
                    if not inside_yolo and cv_c["confidence"] >= 0.60:
                        all_raw.append(cv_c)

                # 3. Stage 2 Verification & Fusion
                if all_raw:
                    verified_dets = self._run_stage2_verification(frame, all_raw, active_cfg, camera_id="VIDEO-STREAM")
                else:
                    verified_dets = []

                # 4. ByteTrack Multi-Object Association
                tracked_dets = tracker.update(verified_dets) if (all_raw or tracker.tracks) else []

                # 5. Check Early Threat Alerts
                detected_types = {d["detection_type"] for d in tracked_dets}
                early_threat_triggered = None

                for cls in ("fire", "smoke", "sparks"):
                    if cls in detected_types:
                        consecutive_threats[cls] += 1
                        if consecutive_threats[cls] >= 3 and not early_alert_sent[cls]:
                            early_alert_sent[cls] = True
                            early_threat_triggered = cls
                    else:
                        consecutive_threats[cls] = max(0, consecutive_threats[cls] - 1)

                active_threat_type = None
                if "fire" in detected_types:
                    active_threat_type = "fire"
                elif "smoke" in detected_types:
                    active_threat_type = "smoke"
                elif "sparks" in detected_types or "spark" in detected_types:
                    active_threat_type = "sparks"
                elif max(consecutive_threats.values()) > 0:
                    active_threat_type = max(consecutive_threats, key=consecutive_threats.get)

                carried_dets = tracked_dets

                t_frame_ms = (time.perf_counter() - t_frame_start) * 1000.0
                frame_latencies.append(t_frame_ms)
                if len(frame_latencies) > 50:
                    frame_latencies.pop(0)
            else:
                skipped_frames_count += 1
                tracked_dets = carried_dets
                early_threat_triggered = None
                active_threat_type = None
                if carried_dets:
                    c_types = {d["detection_type"] for d in carried_dets}
                    for priority_cls in ("fire", "smoke", "sparks"):
                        if priority_cls in c_types:
                            active_threat_type = priority_cls
                            break

            prev_gray = curr_gray

            # 6. Annotate EVERY frame for smooth playback
            t_ren_start = time.perf_counter()
            annotated = self.annotate_frame(frame, tracked_dets) if tracked_dets else frame.copy()

            # In Debug mode, add HUD overlay
            if is_debug_mode:
                hud_text = f"F:{frame_num}/{total_frames} | T:{frame_num/fps:.2f}s | Dets:{len(tracked_dets)} | Inf:{t_infer_ms:.0f}ms | Mode:{mode}"
                cv2.putText(annotated, hud_text, (12, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)

            t_render_ms = (time.perf_counter() - t_ren_start) * 1000.0

            # 7. Encode annotated frame as raw JPEG bytes for MJPEG streaming
            encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), 75]
            ok, jpeg_buf = cv2.imencode(".jpg", annotated, encode_params)
            annotated_jpeg = jpeg_buf.tobytes() if ok else None

            # 8. Write annotated frame to output video
            if writer:
                writer.write(annotated)

            # 9. Telemetry & Progress
            avg_latency = round(float(np.mean(frame_latencies)), 1) if frame_latencies else round(t_infer_ms, 1)
            t_elapsed = time.perf_counter() - t_start
            proc_fps = processed_count / t_elapsed if t_elapsed > 0 else 0.0
            overall_fps = frame_num / t_elapsed if t_elapsed > 0 else 0.0
            progress_pct = round(min(100.0, (frame_num / float(total_frames)) * 100.0), 1) if total_frames > 0 else 0.0
            remaining_frames = max(0, total_frames - frame_num)
            eta_sec = (remaining_frames / overall_fps) if overall_fps > 0 else 0.0

            # 10. High-quality preview frame base64 for real-time visualization
            preview_b64 = _frame_to_base64(annotated, max_dim=720, quality=75)

            if run_inference or frame_num == total_frames:
                yield {
                    "event": "frame_update",
                    "type": "frame",
                    "frame_number": frame_num,
                    "total_frames": total_frames,
                    "progress_pct": progress_pct,
                    "timestamp_sec": round((frame_num - 1) / fps, 3),
                    "fps": round(proc_fps, 1),
                    "source_fps": round(fps, 1),
                    "inference_fps": round(overall_fps, 1),
                    "avg_latency_ms": avg_latency,
                    "decode_time_ms": round(t_decode_ms, 1),
                    "inference_time_ms": round(t_infer_ms, 1),
                    "cv_time_ms": round(t_cv_ms, 1),
                    "render_time_ms": round(t_render_ms, 1),
                    "skipped_frames": skipped_frames_count,
                    "active_tracks_count": len(tracker.tracks),
                    "eta_sec": round(eta_sec, 1),
                    "detections": tracked_dets,
                    "early_threat": early_threat_triggered,
                    "active_threat": active_threat_type,
                    "consecutive_threat_frames": max(consecutive_threats.values()),
                    "continuous_alarm": (consecutive_threats["fire"] >= 12 or consecutive_threats["smoke"] >= 15 or consecutive_threats["sparks"] >= 15),
                    "preview_b64": preview_b64,
                    "annotated_jpeg": annotated_jpeg,
                    "has_detections": len(tracked_dets) > 0,
                    "run_inference": run_inference,
                    "mode": mode,
                    "metadata": meta,
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
        """Annotates frame with clean, modern bounding boxes and badges."""
        out = frame.copy()
        colors = {
            "fire": (0, 30, 255),       # BGR Red
            "smoke": (235, 160, 14),    # BGR Sky Blue / Cyan (distinct from Fire & Sparks)
            "sparks": (0, 215, 255),    # BGR Gold / Amber
            "spark": (0, 215, 255),     # BGR Gold / Amber
        }
        for d in detections:
            bb = d["bbox"]
            color = colors.get(d["detection_type"], (255, 255, 255))
            cv2.rectangle(out, (bb["x1"], bb["y1"]), (bb["x2"], bb["y2"]), color, 2)
            
            tid_str = f" #{d['track_id']}" if "track_id" in d else ""
            label = f"{d['detection_type'].upper()}{tid_str} {d['confidence']:.0%}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)

            if bb["y1"] - th - 10 >= 0:
                rect_y1 = bb["y1"] - th - 10
                rect_y2 = bb["y1"]
                text_y = bb["y1"] - 4
            else:
                rect_y1 = bb["y1"]
                rect_y2 = bb["y1"] + th + 10
                text_y = bb["y1"] + th + 6

            cv2.rectangle(out, (bb["x1"], rect_y1), (bb["x1"] + tw + 10, rect_y2), color, -1)
            cv2.putText(out, label, (bb["x1"] + 5, text_y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
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

