"""
Stage 2 — Model. The single YOLO inference service.

Tuned for RECALL (confidence floor 0.20). Over-flagging is expected and correct
at this stage; rejecting false positives is the Classifier's job downstream.

Two properties this deliberately does NOT share with the existing application's
detection layer:

1. **No database access.** The old service reloaded settings from the DB on
   every inference call. Config is resolved once at construction.
2. **No verification, no filtering, no class remapping.** This stage emits raw
   candidates verbatim, including ``sparks``. Anything that rejects a detection
   belongs in the Classifier, not here -- the old layer silently dropped every
   sparks detection and rejected static ROIs post-inference, which is how a
   steady fire could survive the Gate and still never produce an alert.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass

import numpy as np

from ..config import ModelSettings, settings as global_settings
from ..contracts import BBox, GateResult, ModelCandidate, RawClass

logger = logging.getLogger("sentinel.model")


@dataclass(frozen=True)
class ModelInfo:
    """Live model metadata. The dashboard must read this, never hardcode it.

    The existing UI hardcodes 'YOLOv8' in nine places while the actual weights
    are YOLO26s.
    """

    architecture: str
    weights_path: str
    device: str
    classes: dict[int, str]
    imgsz: int
    conf_threshold: float
    iou_threshold: float
    ultralytics_version: str
    trained_date: str | None
    ready: bool

    def as_dict(self) -> dict:
        return {
            "architecture": self.architecture,
            "weights_path": self.weights_path,
            "device": self.device,
            "classes": {str(k): v for k, v in self.classes.items()},
            "imgsz": self.imgsz,
            "conf_threshold": self.conf_threshold,
            "iou_threshold": self.iou_threshold,
            "ultralytics_version": self.ultralytics_version,
            "trained_date": self.trained_date,
            "ready": self.ready,
        }


class ModelStage:
    """Wraps the trained detector. One instance per process."""

    def __init__(self, cfg: ModelSettings | None = None):
        self._cfg = cfg or global_settings.model
        self._model = None
        self._class_names: dict[int, str] = {}
        self._ready = False
        self._device = "cpu"
        self._arch = "unknown"
        self._trained_date: str | None = None
        self._ul_version = "unknown"
        self._lock = threading.Lock()
        self._latency_ms: list[float] = []
        self._load()

    # -- lifecycle ---------------------------------------------------------

    def _resolve_device(self) -> str:
        want = self._cfg.device.lower()
        if want == "cpu":
            return "cpu"
        try:
            import torch

            if torch.cuda.is_available():
                return "cuda"
            if want == "cuda":
                logger.warning("[Model] cuda requested but unavailable; falling back to cpu")
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Model] torch probe failed (%s); using cpu", exc)
        return "cpu"

    def _load(self) -> None:
        import ultralytics
        from ultralytics import YOLO

        self._ul_version = getattr(ultralytics, "__version__", "unknown")
        self._device = self._resolve_device()

        path = self._cfg.weights_path
        logger.info("[Model] loading weights: %s (device=%s)", path, self._device)

        self._model = YOLO(path, task="detect")
        self._model.to(self._device)
        self._class_names = dict(self._model.names)

        # Read real architecture + provenance out of the checkpoint rather than
        # asserting a model name anywhere in code or UI.
        try:
            import torch

            ckpt = torch.load(path, map_location="cpu", weights_only=False)
            self._trained_date = ckpt.get("date")
            args = ckpt.get("train_args") or {}
            base = args.get("model")
            if base:
                self._arch = str(base).replace(".pt", "")
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Model] could not read checkpoint provenance: %s", exc)

        self._warmup()
        self._ready = True
        logger.info(
            "[Model] ready: arch=%s device=%s classes=%s",
            self._arch, self._device, self._class_names,
        )

    def _warmup(self) -> None:
        dummy = np.zeros((self._cfg.imgsz, self._cfg.imgsz, 3), dtype=np.uint8)
        try:
            self._model(dummy, verbose=False, conf=self._cfg.conf_threshold, device=self._device)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Model] warmup failed: %s", exc)

    # -- introspection -----------------------------------------------------

    @property
    def ready(self) -> bool:
        return self._ready

    def info(self) -> ModelInfo:
        return ModelInfo(
            architecture=self._arch,
            weights_path=self._cfg.weights_path,
            device=self._device,
            classes=self._class_names,
            imgsz=self._cfg.imgsz,
            conf_threshold=self._cfg.conf_threshold,
            iou_threshold=self._cfg.iou_threshold,
            ultralytics_version=self._ul_version,
            trained_date=self._trained_date,
            ready=self._ready,
        )

    def latency_stats(self) -> dict[str, float]:
        if not self._latency_ms:
            return {"count": 0, "p50_ms": 0.0, "p95_ms": 0.0, "mean_ms": 0.0}
        arr = np.array(self._latency_ms)
        return {
            "count": int(arr.size),
            "p50_ms": round(float(np.percentile(arr, 50)), 2),
            "p95_ms": round(float(np.percentile(arr, 95)), 2),
            "mean_ms": round(float(arr.mean()), 2),
        }

    # -- inference ---------------------------------------------------------

    def detect(self, gate_result: GateResult) -> list[ModelCandidate]:
        """Run the detector on a Gate-approved frame.

        Returns raw candidates in ORIGINAL frame coordinates. Never filters.
        """
        if not self._ready:
            raise RuntimeError("Model stage is not ready")

        frame = gate_result.frame
        h, w = frame.shape[:2]

        # Downscale very large frames for inference speed, then map boxes back
        # so callers only ever see original-resolution coordinates.
        infer_frame = frame
        scale = 1.0
        longest = max(h, w)
        if longest > self._cfg.max_inference_width:
            scale = self._cfg.max_inference_width / float(longest)
            infer_frame = cv2_resize(frame, scale)

        t0 = time.perf_counter()
        with self._lock:
            results = self._model(
                infer_frame,
                imgsz=self._cfg.imgsz,
                conf=self._cfg.conf_threshold,
                iou=self._cfg.iou_threshold,
                device=self._device,
                verbose=False,
            )
        elapsed = (time.perf_counter() - t0) * 1000.0
        self._latency_ms.append(elapsed)
        if len(self._latency_ms) > 500:
            self._latency_ms.pop(0)

        inv = 1.0 / scale if scale != 1.0 else 1.0
        candidates: list[ModelCandidate] = []

        for r in results:
            boxes = getattr(r, "boxes", None)
            if boxes is None or len(boxes) == 0:
                continue
            for box in boxes:
                cls_id = int(box.cls[0])
                raw_name = str(self._class_names.get(cls_id, cls_id)).lower().strip()
                try:
                    raw_class = RawClass(raw_name)
                except ValueError:
                    # An unmodelled class name would silently vanish if ignored.
                    logger.warning(
                        "[Model] class '%s' (id=%s) is not in the RawClass contract; "
                        "detection dropped. Update contracts.RawClass.", raw_name, cls_id,
                    )
                    continue

                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
                bbox = BBox(
                    x1=int(round(x1 * inv)),
                    y1=int(round(y1 * inv)),
                    x2=int(round(x2 * inv)),
                    y2=int(round(y2 * inv)),
                ).clamped(w, h)

                if bbox.width <= 0 or bbox.height <= 0:
                    continue

                candidates.append(
                    ModelCandidate(
                        camera_id=gate_result.camera_id,
                        timestamp=gate_result.timestamp,
                        monotonic_ts=gate_result.monotonic_ts,
                        bbox=bbox,
                        class_raw=raw_class,
                        confidence_raw=round(float(box.conf[0]), 4),
                    )
                )

        logger.debug(
            "[Model] camera=%s trigger=%s -> %d candidate(s) in %.0fms",
            gate_result.camera_id, gate_result.trigger_reason.value, len(candidates), elapsed,
        )
        return candidates


def cv2_resize(frame: np.ndarray, scale: float) -> np.ndarray:
    import cv2

    h, w = frame.shape[:2]
    return cv2.resize(
        frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA
    )
