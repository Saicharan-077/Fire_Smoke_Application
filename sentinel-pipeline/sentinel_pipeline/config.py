"""
Pipeline-wide configuration.

Deliberately environment-driven and read ONCE at import. The existing
application reloaded settings from a database on every single inference call,
which dominated per-frame latency. Nothing in this pipeline may read config
from a database on a hot path.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Load `.env` from the package root, without adding a dependency.

    Real environment variables always win, so a deployment can override the
    file. Kept deliberately small: this runs once at import, and config must
    never be read from anywhere on a hot path.
    """
    env_file = _ROOT / ".env"
    if not env_file.is_file():
        return
    for raw in env_file.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv()


def _env_f(key: str, default: float) -> float:
    try:
        return float(os.getenv(key, default))
    except (TypeError, ValueError):
        return default


def _env_i(key: str, default: int) -> int:
    try:
        return int(os.getenv(key, default))
    except (TypeError, ValueError):
        return default


def _env_b(key: str, default: bool) -> bool:
    return os.getenv(key, str(default)).strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class GateSettings:
    # Preprocessing
    score_width: int = _env_i("GATE_SCORE_WIDTH", 160)
    score_height: int = _env_i("GATE_SCORE_HEIGHT", 90)
    blur_kernel: int = _env_i("GATE_BLUR_KERNEL", 3)
    clahe_enabled: bool = _env_b("GATE_CLAHE", True)
    clahe_clip_limit: float = _env_f("GATE_CLAHE_CLIP", 2.0)
    clahe_grid: int = _env_i("GATE_CLAHE_GRID", 8)
    # Pin frame mean to a fixed level so global lighting drift (day->dusk)
    # does not read as whole-frame motion. See preprocessing.py step 4.
    illumination_normalize: bool = _env_b("GATE_ILLUM_NORMALIZE", True)
    illumination_reference: float = _env_f("GATE_ILLUM_REFERENCE", 128.0)

    # Background subtraction
    algorithm: str = os.getenv("GATE_ALGORITHM", "MOG2")  # MOG2 | KNN
    history: int = _env_i("GATE_BG_HISTORY", 500)
    var_threshold: float = _env_f("GATE_BG_VAR_THRESHOLD", 16.0)
    detect_shadows: bool = _env_b("GATE_BG_SHADOWS", False)
    learning_rate: float = _env_f("GATE_BG_LEARNING_RATE", -1.0)  # -1 = auto

    # Hysteresis thresholds, as a fraction of foreground pixels (0..1)
    enter_active_threshold: float = _env_f("GATE_ENTER_ACTIVE", 0.010)
    exit_active_threshold: float = _env_f("GATE_EXIT_ACTIVE", 0.004)
    # Consecutive frames required to confirm a transition (anti-flap)
    enter_confirm_frames: int = _env_i("GATE_ENTER_CONFIRM", 2)
    exit_confirm_frames: int = _env_i("GATE_EXIT_CONFIRM", 5)

    # Adaptive per-camera threshold
    adaptive_enabled: bool = _env_b("GATE_ADAPTIVE", True)
    adaptive_window: int = _env_i("GATE_ADAPTIVE_WINDOW", 300)
    adaptive_sigma: float = _env_f("GATE_ADAPTIVE_SIGMA", 3.0)
    adaptive_min_samples: int = _env_i("GATE_ADAPTIVE_MIN_SAMPLES", 60)

    # Warmup: frames to let the background model settle before scoring counts
    warmup_frames: int = _env_i("GATE_WARMUP_FRAMES", 15)


@dataclass(frozen=True)
class ModelSettings:
    weights_path: str = os.getenv("PIPELINE_MODEL_PATH", str(_ROOT / "models" / "best.pt"))
    device: str = os.getenv("PIPELINE_DEVICE", "auto")  # auto | cuda | cpu
    imgsz: int = _env_i("PIPELINE_IMGSZ", 640)
    # Recall-focused floor. Precision is the Classifier's job, not this stage's.
    conf_threshold: float = _env_f("PIPELINE_CONF_THRESHOLD", 0.20)
    iou_threshold: float = _env_f("PIPELINE_IOU_THRESHOLD", 0.45)
    max_inference_width: int = _env_i("PIPELINE_MAX_INFER_WIDTH", 1280)


@dataclass(frozen=True)
class TrackingSettings:
    high_threshold: float = _env_f("TRACK_HIGH_THRESH", 0.35)
    low_threshold: float = _env_f("TRACK_LOW_THRESH", 0.15)
    iou_threshold: float = _env_f("TRACK_IOU_THRESH", 0.25)
    max_age: int = _env_i("TRACK_MAX_AGE", 25)
    crop_padding_ratio: float = _env_f("TRACK_CROP_PADDING", 0.15)
    # Cap stored history crop edge length to bound memory. 0 disables.
    # The CURRENT-frame crop handed to Phases 1-2 is never downscaled.
    max_crop_edge: int = _env_i("TRACK_MAX_CROP_EDGE", 256)

    # --- G6: history is DURATION-bounded, not frame-count-bounded -----------
    # The Flicker phase specifies a window of "roughly 1-2 seconds". A frame
    # count cannot express that: 60 frames spans 2s at 30fps but 15s at 4fps.
    # Samples are evicted by timestamp, so the window means the same thing at
    # any frame rate, including a variable or dropping one.
    history_window_s: float = _env_f("TRACK_HISTORY_WINDOW_S", 2.0)
    # Memory safety valve only -- NOT the primary bound. At a plausible 30fps a
    # 2s window holds ~60 samples; this only engages if a source delivers far
    # faster than expected.
    history_max_samples: int = _env_i("TRACK_HISTORY_MAX_SAMPLES", 300)

    # --- G4: canonical motion window ----------------------------------------
    # Farneback requires identical dimensions between the frames it compares.
    # Each track holds a fixed-size, fixed-position window for the duration of
    # a motion "epoch", so compared frames share both size AND world position
    # and no per-frame rescaling distorts displacement.
    motion_window_enabled: bool = _env_b("TRACK_MOTION_WINDOW", True)
    # How much larger than the padded bbox the window is at epoch start. Gives
    # the object room to move before the window has to re-anchor.
    motion_window_expansion: float = _env_f("TRACK_MOTION_EXPANSION", 1.5)
    # Long-edge cap for the stored motion crop. Any downscale is computed ONCE
    # per epoch and held constant, so displacement scales by a single known
    # factor (exposed as `motion_scale`) rather than a frame-varying one.
    motion_window_max_edge: int = _env_i("TRACK_MOTION_MAX_EDGE", 256)


@dataclass(frozen=True)
class ContextSettings:
    # Forced-override intervals by zone risk tier (seconds).
    forced_interval_high: float = _env_f("GATE_FORCE_HIGH", 7.0)
    forced_interval_medium: float = _env_f("GATE_FORCE_MEDIUM", 25.0)
    forced_interval_low: float = _env_f("GATE_FORCE_LOW", 60.0)
    forced_interval_uncalibrated: float = _env_f("GATE_FORCE_UNCAL", 17.0)

    # Severity banding on the computed score.
    severity_critical: float = _env_f("SEVERITY_CRITICAL", 0.80)
    severity_high: float = _env_f("SEVERITY_HIGH", 0.60)
    severity_medium: float = _env_f("SEVERITY_MEDIUM", 0.35)
    severity_low: float = _env_f("SEVERITY_LOW", 0.15)

    # Growth-rate window and the discount applied to permitted activity.
    growth_window_s: float = _env_f("GROWTH_WINDOW_S", 10.0)
    controlled_activity_discount: float = _env_f("CONTROLLED_DISCOUNT", 0.35)

    # Multi-camera incident correlation window (seconds).
    incident_correlation_window_s: float = _env_f("INCIDENT_WINDOW_S", 20.0)

    # Calibration observation window default (hours).
    calibration_window_hours: float = _env_f("CALIBRATION_WINDOW_H", 24.0)
    calibration_always_on_ratio: float = _env_f("CALIBRATION_ALWAYS_ON_RATIO", 0.85)


@dataclass(frozen=True)
class StorageSettings:
    database_url: str = os.getenv(
        "PIPELINE_DATABASE_URL", f"sqlite:///{_ROOT / 'data' / 'pipeline.db'}"
    )
    evidence_dir: Path = Path(os.getenv("PIPELINE_EVIDENCE_DIR", str(_ROOT / "data" / "evidence")))
    evidence_jpeg_quality: int = _env_i("PIPELINE_EVIDENCE_QUALITY", 85)


@dataclass(frozen=True)
class Settings:
    gate: GateSettings = field(default_factory=GateSettings)
    model: ModelSettings = field(default_factory=ModelSettings)
    tracking: TrackingSettings = field(default_factory=TrackingSettings)
    context: ContextSettings = field(default_factory=ContextSettings)
    storage: StorageSettings = field(default_factory=StorageSettings)

    # One shared Model means extra workers do not multiply throughput; more
    # than one only helps when the GPU is idle during crop/annotate work.
    scheduler_workers: int = _env_i("PIPELINE_SCHEDULER_WORKERS", 1)
    # Bounds concurrent video-decode jobs; they all contend for one Model.
    max_concurrent_jobs: int = _env_i("PIPELINE_MAX_CONCURRENT_JOBS", 2)

    api_host: str = os.getenv("PIPELINE_HOST", "0.0.0.0")
    api_port: int = _env_i("PIPELINE_PORT", 8100)


settings = Settings()

settings.storage.evidence_dir.mkdir(parents=True, exist_ok=True)
(_ROOT / "data").mkdir(parents=True, exist_ok=True)
