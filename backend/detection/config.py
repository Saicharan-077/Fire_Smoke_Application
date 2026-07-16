import os
import logging
from typing import List, Tuple
from pydantic import BaseModel, Field

logger = logging.getLogger("fireguard.detection.config")

class FireVerificationConfig(BaseModel):
    hsv_ranges: List[Tuple[Tuple[int, int, int], Tuple[int, int, int]]] = Field(
        default=[
            ((0, 80, 100), (25, 255, 255)),     # Red-orange fire
            ((160, 80, 100), (180, 255, 255)),   # Deep red wraparound
            ((25, 80, 130), (45, 255, 255)),     # Yellow-orange fire
        ],
        description="List of HSV range bounds (lower_bound, upper_bound) for fire color."
    )
    min_pixel_ratio: float = Field(0.06, description="Minimum ratio of fire pixels in ROI.")
    min_brightness: float = Field(110.0, description="Minimum average V value of fire pixels.")
    min_saturation: float = Field(70.0, description="Minimum average S value of fire pixels.")
    min_component_size: int = Field(5, description="Minimum connected component area to filter out single-pixel noise.")

class SmokeVerificationConfig(BaseModel):
    max_saturation: float = Field(100.0, description="Maximum average S value of smoke ROI (smoke is desaturated).")
    min_brightness: float = Field(55.0, description="Minimum average V value (to reject deep black shadows).")
    max_chroma: float = Field(35.0, description="Maximum average difference between color channels (chroma).")
    min_texture_std: float = Field(3.0, description="Minimum standard deviation of grayscale intensities.")
    max_texture_std: float = Field(55.0, description="Maximum standard deviation of grayscale intensities.")
    max_edge_density: float = Field(0.18, description="Maximum ratio of Canny edge pixels.")
    min_entropy: float = Field(3.2, description="Minimum Shannon entropy of grayscale histogram.")
    max_entropy: float = Field(7.8, description="Maximum Shannon entropy of grayscale histogram.")
    max_contrast: float = Field(50.0, description="Maximum local contrast (std dev).")
    max_laplacian_var: float = Field(750.0, description="Maximum variance of Laplacian (checks for soft blur/diffusion).")
    min_laplacian_var: float = Field(1.4, description="Minimum variance of Laplacian (rejects completely flat/uniform backgrounds).")
    max_gradient_mag: float = Field(16.0, description="Maximum average gradient magnitude.")
    min_gradient_mag: float = Field(1.2, description="Minimum average gradient magnitude (rejects flat gradient drift).")

class DetectionConfig(BaseModel):
    model_path: str = Field("models/best.pt", description="Path to YOLOv8 weights.")
    device: str = Field("cuda", description="Preferred compute device ('cuda' or 'cpu').")
    imgsz: int = Field(640, description="Inference image resolution.")
    conf_threshold: float = Field(0.45, description="Initial Stage 1 YOLO confidence threshold.")
    iou_threshold: float = Field(0.50, description="Stage 1 YOLO IoU threshold.")
    operating_mode: str = Field("Balanced", description="Operational mode: Balanced | High Precision | High Recall.")
    consecutive_frames: int = Field(2, description="Number of consecutive frames required to confirm detection.")
    smoothing_alpha: float = Field(0.6, description="Exponential moving average factor for confidence smoothing.")
    
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
                "min_pixel_ratio": 0.10,
                "min_brightness": 130.0,
                "min_saturation": 85.0,
                "min_component_size": 8,
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
                "min_pixel_ratio": 0.03,
                "min_brightness": 90.0,
                "min_saturation": 50.0,
                "min_component_size": 3,
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
