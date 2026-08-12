import asyncio
import cv2
import logging
import numpy as np
import time
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
from concurrent.futures import ThreadPoolExecutor

from ..database import SessionLocal
from ..models import Camera, Setting
from ..services.alert_service import create_alert
from ..websocket.connection_manager import manager

logger = logging.getLogger("fireguard.scheduler")


class CameraState:
    IDLE = "IDLE"
    MOTION = "MOTION"
    SUSPICIOUS = "SUSPICIOUS"
    FIRE = "FIRE"
    CONFIRMED = "CONFIRMED"
    RECOVERY = "RECOVERY"


PRIORITY_BASE_FPS = {
    "HIGH": {"idle": 3.0, "motion": 10.0, "suspicious": 15.0, "fire": 20.0},
    "MEDIUM": {"idle": 2.0, "motion": 8.0, "suspicious": 12.0, "fire": 15.0},
    "LOW": {"idle": 1.0, "motion": 5.0, "suspicious": 8.0, "fire": 10.0},
}


class CameraStreamProcessor:
    def __init__(self, camera_id: str, name: str, stream_url: str, priority: str = "MEDIUM"):
        self.camera_id = camera_id
        self.name = name
        self.stream_url = stream_url
        self.priority = priority.upper() if priority.upper() in PRIORITY_BASE_FPS else "MEDIUM"

        self.current_state = CameraState.IDLE
        self.target_fps = PRIORITY_BASE_FPS[self.priority]["idle"]
        self.actual_fps = 0.0

        # Motion & Pixel Change tracking
        self.prev_frame_gray: Optional[np.ndarray] = None
        self.pixel_change_pct: float = 0.0
        self.motion_score: float = 0.0

        # Timing & Metrics
        self.last_inference_time: float = 0.0
        self.last_frame_time: float = time.time()
        self.inference_latency_ms: float = 0.0
        self.frame_count: int = 0
        self.dropped_frames: int = 0
        self.queue_size: int = 0
        self.consecutive_detections: Dict[str, int] = {"fire": 0, "smoke": 0}
        self.last_detection_conf: float = 0.0
        self.last_detection_type: Optional[str] = None
        self.last_detection_timestamp: Optional[str] = None

        # Hysteresis tracking for suspicious state
        self.suspicious_until: float = 0.0
        self.recovery_until: float = 0.0

        # Persistent stream reader slot (Priority 0 requirement)
        self._frame_lock = threading.Lock()
        self._latest_frame: Optional[np.ndarray] = None
        self._reader_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def start_reader(self):
        if self._reader_thread is not None and self._reader_thread.is_alive():
            return
        self._stop_event.clear()
        self._reader_thread = threading.Thread(target=self._reader_loop, name=f"reader-{self.camera_id}", daemon=True)
        self._reader_thread.start()

    def stop_reader(self):
        self._stop_event.set()
        if self._reader_thread and self._reader_thread.is_alive():
            self._reader_thread.join(timeout=1.5)
        with self._frame_lock:
            self._latest_frame = None

    def _reader_loop(self):
        import cv2, time
        cap = None
        consecutive_errs = 0
        while not self._stop_event.is_set():
            if not self.stream_url:
                time.sleep(1.0)
                continue

            if cap is None or not cap.isOpened():
                cap = cv2.VideoCapture(self.stream_url)
                if not cap.isOpened():
                    time.sleep(2.0)
                    continue

            ret, frame = cap.read()
            if not ret:
                consecutive_errs += 1
                if consecutive_errs > 10 and cap:
                    cap.release()
                    cap = None
                    consecutive_errs = 0
                time.sleep(0.1)
                continue

            consecutive_errs = 0
            with self._frame_lock:
                self._latest_frame = frame  # Single-slot buffer: newest frame overwrites stale frame
            time.sleep(0.01)

        if cap and cap.isOpened():
            cap.release()

    def get_latest_frame(self) -> Optional[np.ndarray]:
        with self._frame_lock:
            if self._latest_frame is None:
                return None
            return self._latest_frame.copy()

    def update_priority(self, new_priority: str):
        if new_priority.upper() in PRIORITY_BASE_FPS:
            self.priority = new_priority.upper()
            self._update_target_fps()
            logger.info(f"[Scheduler] Priority updated for camera {self.camera_id} ({self.name}): {self.priority}")

    def _update_target_fps(self):
        fps_map = PRIORITY_BASE_FPS[self.priority]
        if self.current_state == CameraState.IDLE:
            self.target_fps = fps_map["idle"]
        elif self.current_state == CameraState.MOTION:
            self.target_fps = fps_map["motion"]
        elif self.current_state == CameraState.SUSPICIOUS:
            self.target_fps = fps_map["suspicious"]
        elif self.current_state in (CameraState.FIRE, CameraState.CONFIRMED):
            self.target_fps = fps_map["fire"]
        elif self.current_state == CameraState.RECOVERY:
            self.target_fps = (fps_map["idle"] + fps_map["motion"]) / 2.0

    def set_state(self, new_state: str, reason: str = ""):
        if self.current_state != new_state:
            logger.info(f"[State Machine] Camera {self.camera_id} state transition: {self.current_state} -> {new_state} ({reason})")
            self.current_state = new_state
            self._update_target_fps()

    def analyze_scene(self, frame: np.ndarray, pixel_threshold: float = 8.0, motion_threshold: float = 0.01) -> Tuple[bool, float, float]:
        """Calculates pixel difference % and motion score using OpenCV."""
        h, w = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray_blur = cv2.GaussianBlur(gray, (21, 21), 0)

        if self.prev_frame_gray is None or self.prev_frame_gray.shape != gray_blur.shape:
            self.prev_frame_gray = gray_blur
            self.pixel_change_pct = 0.0
            self.motion_score = 0.0
            return True, 0.0, 0.0  # Force first frame analysis

        # 1. Absolute Difference for Pixel Change %
        diff = cv2.absdiff(self.prev_frame_gray, gray_blur)
        _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
        changed_pixels = np.count_nonzero(thresh)
        total_pixels = h * w
        pixel_change = (changed_pixels / total_pixels) * 100.0

        # 2. Motion Score via Contours
        contours, _ = cv2.findContours(thresh.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        motion_area = sum(cv2.contourArea(c) for c in contours if cv2.contourArea(c) > 100)
        motion = motion_area / float(total_pixels)

        self.prev_frame_gray = gray_blur
        self.pixel_change_pct = round(pixel_change, 2)
        self.motion_score = round(motion, 4)

        significant_change = (pixel_change >= pixel_threshold or motion >= motion_threshold)
        return significant_change, self.pixel_change_pct, self.motion_score

    def to_dict(self) -> Dict[str, Any]:
        return {
            "camera_id": self.camera_id,
            "name": self.name,
            "stream_url": self.stream_url,
            "priority": self.priority,
            "current_state": self.current_state,
            "target_fps": round(self.target_fps, 1),
            "actual_fps": round(self.actual_fps, 1),
            "pixel_change_pct": self.pixel_change_pct,
            "motion_score": self.motion_score,
            "inference_latency_ms": round(self.inference_latency_ms, 2),
            "dropped_frames": self.dropped_frames,
            "queue_size": self.queue_size,
            "last_detection_type": self.last_detection_type,
            "last_detection_conf": round(self.last_detection_conf, 2),
            "last_detection_timestamp": self.last_detection_timestamp,
        }


class CameraScheduler:
    def __init__(self, detection_svc):
        self.svc = detection_svc
        self.processors: Dict[str, CameraStreamProcessor] = {}
        self.executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="cam_scheduler")
        self.is_running = False
        self._tasks: List[asyncio.Task] = []

    def sync_cameras(self, db_cameras: List[Camera]):
        """Synchronizes processor instances with active DB cameras."""
        active_ids = {c.id for c in db_cameras if c.status == "online" and c.stream_url and "webcam" not in c.name.lower() and c.id != "webcam-01"}
        
        # Remove offline processors
        for cid in list(self.processors.keys()):
            if cid not in active_ids:
                logger.info(f"[Scheduler] Removing inactive camera processor: {cid}")
                del self.processors[cid]

        # Add or update processors
        for cam in db_cameras:
            if cam.id in active_ids:
                cam_priority = getattr(cam, "priority", "MEDIUM") or "MEDIUM"
                if cam.id not in self.processors:
                    logger.info(f"[Scheduler] Adding new camera processor: {cam.id} ({cam.name}, priority={cam_priority})")
                    self.processors[cam.id] = CameraStreamProcessor(cam.id, cam.name, cam.stream_url, cam_priority)
                else:
                    self.processors[cam.id].update_priority(cam_priority)

    def get_all_metrics(self) -> List[Dict[str, Any]]:
        return [proc.to_dict() for proc in self.processors.values()]

    async def start(self):
        if self.is_running:
            return
        self.is_running = True
        logger.info("[Scheduler] Starting Intelligent Multi-Camera Scheduler Pipeline...")
        self._tasks.append(asyncio.create_task(self._main_scheduler_loop()))

    async def stop(self):
        self.is_running = False
        for proc in list(self.processors.values()):
            proc.stop_reader()
        for t in self._tasks:
            t.cancel()
        self._tasks.clear()
        self.executor.shutdown(wait=False)
        logger.info("[Scheduler] Pipeline stopped.")

    async def _main_scheduler_loop(self):
        """Main non-blocking async loop regulating per-camera stream capture & inference."""
        while self.is_running:
            try:
                db = SessionLocal()
                try:
                    cameras = db.query(Camera).filter(Camera.status == "online").all()
                    self.sync_cameras(cameras)
                finally:
                    db.close()

                if not self.processors:
                    await asyncio.sleep(2)
                    continue

                # Process all cameras concurrently
                tasks = [self._process_single_camera(proc) for proc in list(self.processors.values())]
                await asyncio.gather(*tasks, return_exceptions=True)

                # Broadcast metrics live every second
                metrics = self.get_all_metrics()
                await manager.broadcast({
                    "event": "camera_metrics_update",
                    "metrics": metrics,
                    "timestamp": datetime.utcnow().isoformat()
                })

                await asyncio.sleep(0.5)

            except Exception as exc:
                logger.error(f"[Scheduler Loop] Exception in main loop: {exc}")
                await asyncio.sleep(2)

    async def _process_single_camera(self, proc: CameraStreamProcessor):
        loop = asyncio.get_running_loop()
        now = time.time()

        # Check target frame interval
        target_interval = 1.0 / max(0.5, proc.target_fps)
        if now - proc.last_frame_time < target_interval:
            return

        proc.last_frame_time = now

        # Ensure persistent reader thread is running (Priority 0 requirement)
        proc.start_reader()
        frame = proc.get_latest_frame()

        if frame is None:
            proc.set_state(CameraState.IDLE, "Stream connection waiting for frame")
            return

        # 1. Pixel Change & Motion Analysis
        pixel_threshold = float(getattr(self.svc.layer.config, "pixel_change_threshold", 8.0))
        motion_threshold = float(getattr(self.svc.layer.config, "motion_threshold", 0.01))
        periodic_interval = float(getattr(self.svc.layer.config, "periodic_inference_interval", 20.0))

        has_significant_motion, pix_pct, m_score = proc.analyze_scene(frame, pixel_threshold, motion_threshold)

        # 2. Decide whether to run YOLO inference
        time_since_last_inf = now - proc.last_inference_time
        is_periodic_forced = (time_since_last_inf >= periodic_interval)

        should_infer = has_significant_motion or is_periodic_forced or proc.current_state in (CameraState.SUSPICIOUS, CameraState.FIRE, CameraState.CONFIRMED)

        if not should_infer:
            # Maintain IDLE state
            if proc.current_state not in (CameraState.IDLE, CameraState.RECOVERY):
                proc.set_state(CameraState.IDLE, "Static scene - skipping YOLO")
            return

        # 3. Perform YOLO Inference
        t_start = time.perf_counter()
        
        def run_inference():
            return self.svc.infer_frame(frame, proc.camera_id)

        annotated, detections, did_infer = await loop.run_in_executor(self.executor, run_inference)
        
        t_inf_ms = (time.perf_counter() - t_start) * 1000.0
        proc.inference_latency_ms = t_inf_ms
        proc.last_inference_time = now

        if not did_infer:
            return

        # 4. State Machine & Suspicious Region Tracking (Hysteresis)
        conf_min = float(getattr(self.svc.layer.config, "suspicious_conf_min", 0.25))
        conf_max = float(getattr(self.svc.layer.config, "suspicious_conf_max", 0.45))

        detected_types = {d["detection_type"] for d in detections}
        max_conf = max((d["confidence"] for d in detections), default=0.0)

        if max_conf > 0:
            proc.last_detection_conf = max_conf
            best_det = max(detections, key=lambda x: x["confidence"])
            proc.last_detection_type = best_det["detection_type"]
            proc.last_detection_timestamp = datetime.utcnow().isoformat()

        # Update State Machine
        if max_conf >= 0.50:
            proc.set_state(CameraState.FIRE, f"Confirmed threat detected (conf={max_conf:.2f})")
            proc.suspicious_until = now + 10.0  # Hold elevated state
        elif conf_min <= max_conf < 0.50:
            proc.set_state(CameraState.SUSPICIOUS, f"Suspicious activity (conf={max_conf:.2f})")
            proc.suspicious_until = now + 8.0   # Hysteresis timer
        elif has_significant_motion:
            if now < proc.suspicious_until:
                proc.set_state(CameraState.SUSPICIOUS, "Hysteresis active - maintaining elevated FPS")
            else:
                proc.set_state(CameraState.MOTION, f"Motion detected (pixel={pix_pct:.1f}%)")
        else:
            if now < proc.suspicious_until:
                proc.set_state(CameraState.SUSPICIOUS, "Hysteresis active")
            elif now < proc.recovery_until:
                proc.set_state(CameraState.RECOVERY, "Cooling down")
            else:
                proc.set_state(CameraState.IDLE, "Scene cleared")

        # 5. Handle Alert Confirmation & Database Records
        confirmed_detections = []
        for cls in ("fire", "smoke"):
            if cls in detected_types:
                proc.consecutive_detections[cls] += 1
            else:
                proc.consecutive_detections[cls] = 0

            if proc.consecutive_detections[cls] >= 2:
                confirmed_detections.extend([d for d in detections if d["detection_type"] == cls])

        if confirmed_detections:
            proc.set_state(CameraState.CONFIRMED, "Multi-frame confirmed threat")
            best_alert_det = max(confirmed_detections, key=lambda d: d["confidence"])
            
            db = SessionLocal()
            try:
                from ..services.storage_service import save_evidence
                evidence_path = save_evidence(annotated, prefix="cctv_scheduler")
                alert = create_alert(
                    db,
                    detection_type=best_alert_det["detection_type"],
                    confidence=best_alert_det["confidence"],
                    source_type="cctv",
                    camera_id=proc.camera_id,
                    location=proc.name,
                    file_name=None,
                    evidence_path=evidence_path
                )
                db.commit()
                
                await manager.broadcast({
                    "event": "new_alert",
                    "alert_id": alert.id,
                    "detection_type": alert.detection_type,
                    "confidence": alert.confidence,
                    "camera_id": alert.camera_id,
                    "location": alert.location,
                    "evidence_path": alert.evidence_path,
                    "timestamp": alert.timestamp.isoformat() + "Z" if alert.timestamp and not alert.timestamp.isoformat().endswith("Z") else (alert.timestamp.isoformat() if alert.timestamp else datetime.utcnow().isoformat() + "Z")
                })
                logger.info(f"[Scheduler Alert] CONFIRMED {alert.detection_type} on camera {proc.name} (conf={alert.confidence:.2f})")
            except Exception as e:
                logger.error(f"[Scheduler Alert] Error generating alert: {e}")
                db.rollback()
            finally:
                db.close()
