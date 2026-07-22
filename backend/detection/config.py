import os
import logging
from typing import List, Tuple
from pydantic import BaseModel, Field

logger = logging.getLogger("fireguard.detection.config")

class FireVerificationConfig(BaseModel):
    hsv_ranges: List[Tuple[Tuple[int, int, int], Tuple[int, int, int]]] = Field(
        default=[
            ((0, 30, 50), (25, 255, 255)),      # Red-orange fire (wide saturation & brightness)
            ((150, 30, 50), (180, 255, 255)),    # Deep red wraparound
            ((25, 30, 50), (45, 255, 255)),      # Yellow-orange fire
        ],
        description="List of HSV range bounds (lower_bound, upper_bound) for fire color."
    )
    min_pixel_ratio: float = Field(0.01, description="Minimum ratio of fire pixels in ROI.")
    min_brightness: float = Field(60.0, description="Minimum average V value of fire pixels.")
    min_saturation: float = Field(60.0, description="Minimum average S value of fire pixels.")
    min_component_size: int = Field(2, description="Minimum connected component area to filter out single-pixel noise.")

class SmokeVerificationConfig(BaseModel):
    max_saturation: float = Field(130.0, description="Maximum average S value of smoke ROI (smoke is desaturated).")
    min_brightness: float = Field(30.0, description="Minimum average V value (to reject deep black shadows).")
    max_chroma: float = Field(60.0, description="Maximum average difference between color channels (chroma).")
    min_texture_std: float = Field(2.0, description="Minimum standard deviation of grayscale intensities.")
    max_texture_std: float = Field(80.0, description="Maximum standard deviation of grayscale intensities.")
    max_edge_density: float = Field(0.20, description="Maximum ratio of Canny edge pixels.")
    min_entropy: float = Field(1.5, description="Minimum Shannon entropy of grayscale histogram.")
    max_entropy: float = Field(8.0, description="Maximum Shannon entropy of grayscale histogram.")
    max_contrast: float = Field(80.0, description="Maximum local contrast (std dev).")
    max_laplacian_var: float = Field(500.0, description="Maximum variance of Laplacian (checks for soft blur/diffusion).")
    min_laplacian_var: float = Field(0.5, description="Minimum variance of Laplacian (rejects completely flat/uniform backgrounds).")
    max_gradient_mag: float = Field(40.0, description="Maximum average gradient magnitude.")
    min_gradient_mag: float = Field(0.3, description="Minimum average gradient magnitude (rejects flat gradient drift).")

class DetectionConfig(BaseModel):
    model_path: str = Field(default_factory=lambda: os.getenv("MODEL_PATH", "models/best.pt"), description="Path to fire/smoke YOLOv8 weights file.")
    device: str = Field("cuda", description="Preferred compute device ('cuda' or 'cpu').")
    imgsz: int = Field(640, description="Inference image resolution.")
    conf_threshold: float = Field(0.20, description="Initial Stage 1 YOLO confidence threshold.")
    iou_threshold: float = Field(0.45, description="Stage 1 YOLO IoU threshold.")
    operating_mode: str = Field("Balanced", description="Operational mode: Balanced | High Precision | High Recall.")
    consecutive_frames: int = Field(1, description="Consecutive frames required to confirm detection (1 = immediate).")
    smoothing_alpha: float = Field(0.6, description="Exponential moving average factor for confidence smoothing.")

    # Adaptive Scheduler Parameters
    pixel_change_threshold: float = Field(default_factory=lambda: float(os.getenv("PIXEL_CHANGE_THRESHOLD", "8.0")), description="Pixel difference percentage threshold to trigger inference.")
    motion_threshold: float = Field(default_factory=lambda: float(os.getenv("MOTION_THRESHOLD", "0.01")), description="Motion score threshold.")
    periodic_inference_interval: float = Field(default_factory=lambda: float(os.getenv("PERIODIC_INFERENCE_INTERVAL", "20.0")), description="Interval in seconds for forced periodic YOLO inference.")
    suspicious_conf_min: float = Field(default_factory=lambda: float(os.getenv("SUSPICIOUS_CONF_MIN", "0.25")), description="Min confidence for suspicious region tracking.")
    suspicious_conf_max: float = Field(default_factory=lambda: float(os.getenv("SUSPICIOUS_CONF_MAX", "0.45")), description="Max confidence for suspicious region tracking.")
    min_fps: float = Field(default_factory=lambda: float(os.getenv("MIN_FPS", "2.0")), description="Minimum target FPS.")
    max_fps: float = Field(default_factory=lambda: float(os.getenv("MAX_FPS", "20.0")), description="Maximum target FPS.")
    queue_size: int = Field(default_factory=lambda: int(os.getenv("QUEUE_SIZE", "1")), description="Frame queue size (latest frame processing).")

    # Nested configs
    fire: FireVerificationConfig = Field(default_factory=FireVerificationConfig)
    smoke: SmokeVerificationConfig = Field(default_factory=SmokeVerificationConfig)

    # Logging Config
    enable_logging: bool = Field(True, description="Enable False Positive / Rejection logging.")
    log_dir: str = Field("evidence", description="Base directory to save logs and images.")
    rejected_rois_subfolder: str = Field("rejected_rois", description="Subfolder name for rejected ROIs.")

def get_mode_presets(mode: str) -> dict:
    """Returns overrides for the specified operating mode."""
    mode_lower = mode.lower().strip().replace(" ", "_")
    if mode_lower in ("high_precision", "precision"):
        return {
            "conf_threshold": 0.55,
            "fire": {
                "min_pixel_ratio": 0.06,
                "min_brightness": 125.0,
                "min_saturation": 125.0,
                "min_component_size": 6,
            },
            "smoke": {
                "max_saturation": 80.0,
                "max_edge_density": 0.12,
                "max_laplacian_var": 400.0,
                "max_chroma": 25.0,
            }
        }
    elif mode_lower in ("high_recall", "recall"):
        return {
            "conf_threshold": 0.30,
            "fire": {
                "min_pixel_ratio": 0.01,
                "min_brightness": 80.0,
                "min_saturation": 80.0,
                "min_component_size": 2,
            },
            "smoke": {
                "max_saturation": 130.0,
                "max_edge_density": 0.24,
                "max_laplacian_var": 1200.0,
                "max_chroma": 50.0,
            }
        }
    else:  # Balanced
        return {}
