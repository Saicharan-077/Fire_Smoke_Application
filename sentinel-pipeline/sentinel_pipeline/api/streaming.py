"""
Live stream handling — display decoupled from inference.

Hard architectural requirement (Master Pipeline Document Section 4a), not a bug
fix. A previous implementation showed display FPS exactly equal to inference
FPS on every test, because the frame-serving loop blocked on a full inference
call before yielding each frame.

The rules enforced here:

  * a dedicated reader thread pulls frames at the source's native rate into a
    SINGLE-SLOT buffer (newest wins, oldest dropped) -- never an unbounded
    queue that can build a backlog;
  * the display path always renders the latest available frame and is never
    blocked by inference;
  * inference runs on a sampled subset, always on the freshest frame, never
    working through a backlog;
  * ``stream_fps`` and ``inference_fps`` are measured and reported as genuinely
    independent values. If they are ever identical, the decoupling is broken.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field

import cv2
import numpy as np

logger = logging.getLogger("sentinel.streaming")


@dataclass
class StreamMetrics:
    stream_fps: float = 0.0
    inference_fps: float = 0.0
    inference_latency_ms: float = 0.0
    frames_read: int = 0
    frames_dropped: int = 0
    frames_inferred: int = 0
    connected: bool = False
    last_error: str | None = None

    def as_dict(self) -> dict:
        return {
            "stream_fps": round(self.stream_fps, 2),
            "inference_fps": round(self.inference_fps, 2),
            "inference_latency_ms": round(self.inference_latency_ms, 1),
            "frames_read": self.frames_read,
            "frames_dropped": self.frames_dropped,
            "frames_inferred": self.frames_inferred,
            "connected": self.connected,
            "last_error": self.last_error,
            # Self-check: these being equal indicates broken decoupling.
            "decoupled": abs(self.stream_fps - self.inference_fps) > 0.01
            or self.frames_inferred == 0,
        }


class LatestFrameBuffer:
    """Single-slot, drop-oldest frame buffer. Bounded by construction."""

    __slots__ = ("_lock", "_frame", "_seq", "_dropped")

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._frame: np.ndarray | None = None
        self._seq = 0
        self._dropped = 0

    def put(self, frame: np.ndarray) -> None:
        with self._lock:
            if self._frame is not None:
                # The previous frame was never consumed -- it is dropped, by
                # design. A backlog would grow latency without bound.
                self._dropped += 1
            self._frame = frame
            self._seq += 1

    def get(self) -> tuple[np.ndarray | None, int]:
        with self._lock:
            return self._frame, self._seq

    def take(self) -> tuple[np.ndarray | None, int]:
        with self._lock:
            f, s = self._frame, self._seq
            self._frame = None
            return f, s

    @property
    def dropped(self) -> int:
        with self._lock:
            return self._dropped


class CameraStream:
    """One live source: reader thread + sampled inference thread."""

    def __init__(
        self,
        camera_id: str,
        source_uri: str,
        pipeline,
        *,
        inference_fps_cap: float = 4.0,
        source_type: str = "stream",
    ):
        self.camera_id = camera_id
        self.source_uri = source_uri
        self._pipeline = pipeline
        self._cap_fps = inference_fps_cap
        self._source_type = source_type

        self.metrics = StreamMetrics()
        self._buffer = LatestFrameBuffer()
        self._annotated: np.ndarray | None = None
        self._latest_result: dict | None = None
        self._ann_lock = threading.Lock()

        self._stop = threading.Event()
        self._reader: threading.Thread | None = None
        self._infer_window_start = time.monotonic()
        self._infer_window_count = 0

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        if self._reader and self._reader.is_alive():
            return
        self._stop.clear()
        self._reader = threading.Thread(
            target=self._read_loop, name=f"reader-{self.camera_id}", daemon=True
        )
        self._reader.start()
        logger.info("[Stream] started camera=%s source=%s", self.camera_id, self.source_uri)

    def stop(self) -> None:
        self._stop.set()
        if self._reader and self._reader.is_alive():
            self._reader.join(timeout=2.0)
        self.metrics.connected = False
        logger.info("[Stream] stopped camera=%s", self.camera_id)

    @property
    def running(self) -> bool:
        return bool(self._reader and self._reader.is_alive() and not self._stop.is_set())

    # -- threads -----------------------------------------------------------

    def _open(self):
        src: object = self.source_uri
        # A bare integer means a local device index (webcam).
        if isinstance(src, str) and src.isdigit():
            src = int(src)
        return cv2.VideoCapture(src)

    def _read_loop(self) -> None:
        cap = self._open()
        if not cap.isOpened():
            self.metrics.last_error = f"could not open source: {self.source_uri}"
            self.metrics.connected = False
            logger.error("[Stream] %s", self.metrics.last_error)
            return

        self.metrics.connected = True
        failures = 0
        window_start = time.monotonic()
        window_count = 0

        while not self._stop.is_set():
            ok, frame = cap.read()
            if not ok:
                failures += 1
                if failures > 60:
                    self.metrics.last_error = "stream ended or unreadable"
                    break
                time.sleep(0.03)
                continue
            failures = 0

            self._buffer.put(frame)
            self.metrics.frames_read += 1
            window_count += 1

            elapsed = time.monotonic() - window_start
            if elapsed >= 1.0:
                self.metrics.stream_fps = window_count / elapsed
                self.metrics.frames_dropped = self._buffer.dropped
                window_count = 0
                window_start = time.monotonic()

        cap.release()
        self.metrics.connected = False

    # -- frame supply (pulled by the scheduler) ----------------------------

    def frame_supplier(self) -> np.ndarray | None:
        """Latest frame, or None. Never blocks; stale frames are never queued."""
        frame, _seq = self._buffer.get()
        return frame

    def note_inference(self, camera_id: str, outcome) -> None:
        """Scheduler result sink: record telemetry and refresh the display frame."""
        self.metrics.frames_inferred += 1
        self._infer_window_count += 1
        elapsed = time.monotonic() - self._infer_window_start
        if elapsed >= 1.0:
            self.metrics.inference_fps = self._infer_window_count / elapsed
            self._infer_window_count = 0
            self._infer_window_start = time.monotonic()

        frame, _ = self._buffer.get()
        if frame is None:
            return

        if outcome.detections:
            from ..storage.evidence import annotate

            with self._ann_lock:
                self._annotated = annotate(
                    frame,
                    [
                        {
                            "bbox": d["bbox"],
                            "class": d["class"],
                            "confidence": d["confidence"],
                            "track_id": d["track_id"],
                        }
                        for d in outcome.detections
                    ],
                )
                self._latest_result = outcome.as_dict()
        else:
            with self._ann_lock:
                self._annotated = None
                self._latest_result = outcome.as_dict()

    # -- display path (never blocked by inference) -------------------------

    def display_frame(self) -> np.ndarray | None:
        """Latest frame for display: annotated if available, else raw."""
        with self._ann_lock:
            if self._annotated is not None:
                return self._annotated
        frame, _ = self._buffer.get()
        return frame

    def latest_result(self) -> dict | None:
        with self._ann_lock:
            return self._latest_result


class StreamRegistry:
    def __init__(self) -> None:
        self._streams: dict[str, CameraStream] = {}
        self._lock = threading.Lock()

    def start(self, camera_id: str, source_uri: str, pipeline, **kw) -> CameraStream:
        with self._lock:
            existing = self._streams.get(camera_id)
            if existing and existing.running:
                return existing
            stream = CameraStream(camera_id, source_uri, pipeline, **kw)
            self._streams[camera_id] = stream
            stream.start()
            return stream

    def get(self, camera_id: str) -> CameraStream | None:
        return self._streams.get(camera_id)

    def stop(self, camera_id: str) -> bool:
        with self._lock:
            s = self._streams.pop(camera_id, None)
        if s:
            s.stop()
            return True
        return False

    def stop_all(self) -> None:
        for cid in list(self._streams):
            self.stop(cid)

    def all(self) -> dict[str, CameraStream]:
        return dict(self._streams)
