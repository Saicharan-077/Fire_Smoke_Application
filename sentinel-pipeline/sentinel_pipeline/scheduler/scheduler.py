"""
Multi-camera scheduler.

Extends the Gate concept across cameras, not just across frames:

    every camera  ->  Gate (continuous, ~0.74 ms/frame)  ->  promoted?
                                                              |
                                          PriorityFrameQueue  v
                                                              |
                              worker pool  ->  Model + Classifier + Context

The Gate runs on all cameras all the time because it is nearly free. The Model
serves only promoted cameras, ordered by the Section 8 priority rules.

This is the ONLY driver of inference for continuous sources. Live streams
supply frames; they do not run their own inference loops. Single-image and
video-upload submissions still call ``Pipeline.process_frame`` directly, and
both paths converge on ``Pipeline.run_after_gate`` -- there is no second copy
of the post-gate path.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from ..contracts import GateResult
from ..pipeline import FrameOutcome, Pipeline
from .queue import DEFAULT_STARVATION_S, PriorityFrameQueue, QueuedFrame

logger = logging.getLogger("sentinel.scheduler")

FrameSupplier = Callable[[], "np.ndarray | None"]
ResultSink = Callable[[str, FrameOutcome], None]


@dataclass
class CameraRegistration:
    camera_id: str
    supplier: FrameSupplier
    source_type: str = "stream"
    sink: ResultSink | None = None
    # Gate polling interval. The Gate is cheap, so this can be near the source
    # rate; it exists to stop a fast source burning CPU on redundant gating.
    gate_interval_s: float = 1.0 / 15.0
    last_gated_monotonic: float = 0.0
    gate_polls: int = 0
    promotions: int = 0


@dataclass
class SchedulerStats:
    running: bool = False
    cameras: int = 0
    workers: int = 0
    gate_polls_total: int = 0
    promotions_total: int = 0
    processed_total: int = 0
    errors_total: int = 0
    last_error: str | None = None

    def as_dict(self) -> dict:
        return dict(self.__dict__)


class MultiCameraScheduler:
    """Runs the Gate on all cameras and feeds promoted frames to the Model."""

    def __init__(
        self,
        pipeline: Pipeline,
        *,
        workers: int = 1,
        starvation_s: float = DEFAULT_STARVATION_S,
    ):
        self._pipeline = pipeline
        self._queue = PriorityFrameQueue(starvation_s=starvation_s)
        self._cameras: dict[str, CameraRegistration] = {}
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._gate_thread: threading.Thread | None = None
        self._workers: list[threading.Thread] = []
        # One shared Model means more workers do not multiply throughput; the
        # default of 1 keeps ordering strict and avoids GPU contention.
        self._worker_count = max(1, workers)
        self.stats = SchedulerStats(workers=self._worker_count)

    # -- registration ------------------------------------------------------

    def register(
        self, camera_id: str, supplier: FrameSupplier, *,
        source_type: str = "stream", sink: ResultSink | None = None,
        gate_interval_s: float | None = None,
    ) -> None:
        with self._lock:
            self._cameras[camera_id] = CameraRegistration(
                camera_id=camera_id, supplier=supplier, source_type=source_type,
                sink=sink,
                gate_interval_s=gate_interval_s or (1.0 / 15.0),
            )
            self.stats.cameras = len(self._cameras)
        logger.info("[Scheduler] registered camera=%s (%d total)", camera_id, len(self._cameras))

    def unregister(self, camera_id: str) -> bool:
        with self._lock:
            removed = self._cameras.pop(camera_id, None) is not None
            self.stats.cameras = len(self._cameras)
        if removed:
            logger.info("[Scheduler] unregistered camera=%s", camera_id)
        return removed

    def registered(self) -> list[str]:
        with self._lock:
            return sorted(self._cameras)

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        if self._gate_thread and self._gate_thread.is_alive():
            return
        self._stop.clear()
        self._gate_thread = threading.Thread(
            target=self._gate_loop, name="sched-gate", daemon=True
        )
        self._gate_thread.start()
        self._workers = [
            threading.Thread(target=self._worker_loop, name=f"sched-worker-{i}", daemon=True)
            for i in range(self._worker_count)
        ]
        for w in self._workers:
            w.start()
        self.stats.running = True
        logger.info(
            "[Scheduler] started: 1 gate loop + %d worker(s)", self._worker_count
        )

    def stop(self) -> None:
        self._stop.set()
        for t in [self._gate_thread, *self._workers]:
            if t and t.is_alive():
                t.join(timeout=3.0)
        self._workers.clear()
        self._queue.clear()
        self.stats.running = False
        logger.info("[Scheduler] stopped")

    @property
    def running(self) -> bool:
        return bool(self._gate_thread and self._gate_thread.is_alive() and not self._stop.is_set())

    # -- the cheap pass: Gate every camera, continuously --------------------

    def _gate_loop(self) -> None:
        while not self._stop.is_set():
            now = time.monotonic()
            with self._lock:
                regs = list(self._cameras.values())

            if not regs:
                time.sleep(0.05)
                continue

            for reg in regs:
                if self._stop.is_set():
                    break
                if now - reg.last_gated_monotonic < reg.gate_interval_s:
                    continue
                reg.last_gated_monotonic = now
                try:
                    frame = reg.supplier()
                except Exception as exc:  # noqa: BLE001
                    self._record_error(f"supplier {reg.camera_id}: {exc}")
                    continue
                if frame is None or getattr(frame, "size", 0) == 0:
                    continue

                reg.gate_polls += 1
                self.stats.gate_polls_total += 1
                try:
                    gate_result = self._pipeline.gate_only(reg.camera_id, frame)
                except Exception as exc:  # noqa: BLE001
                    self._record_error(f"gate {reg.camera_id}: {exc}")
                    continue

                if gate_result is None:
                    continue  # nothing happening; the Model is never touched

                self._promote(gate_result, reg)

            time.sleep(0.005)

    def _promote(self, gate_result: GateResult, reg: CameraRegistration) -> None:
        """Push a Gate-approved frame into the priority queue."""
        item = QueuedFrame(
            gate_result=gate_result,
            enqueued_monotonic=time.monotonic(),
            has_active_alert=self._has_active_alert(reg.camera_id),
            zone_risk_weight=gate_result.zone_risk_weight,
            source_type=reg.source_type,
        )
        self._queue.put(item)
        reg.promotions += 1
        self.stats.promotions_total += 1

    def _has_active_alert(self, camera_id: str) -> bool:
        """Is there an unresolved incident on this camera right now?

        Read from the Context Engine's in-memory incident resolver rather than
        querying the alert store per frame -- this runs on the gate loop and
        must stay cheap.
        """
        try:
            for inc in self._pipeline.context.incidents.active():
                if camera_id in inc.sources:
                    return True
        except Exception:  # noqa: BLE001
            return False
        return False

    # -- the expensive pass: Model and downstream --------------------------

    def _worker_loop(self) -> None:
        while not self._stop.is_set():
            item = self._queue.get(timeout=0.25)
            if item is None:
                continue
            try:
                outcome = self._pipeline.run_after_gate(
                    item.gate_result, source_type=item.source_type
                )
                self.stats.processed_total += 1
            except Exception as exc:  # noqa: BLE001
                self._record_error(f"inference {item.camera_id}: {exc}")
                logger.exception("[Scheduler] inference failed for %s", item.camera_id)
                continue

            with self._lock:
                reg = self._cameras.get(item.camera_id)
            if reg is not None and reg.sink is not None:
                try:
                    reg.sink(item.camera_id, outcome)
                except Exception as exc:  # noqa: BLE001
                    self._record_error(f"sink {item.camera_id}: {exc}")

    def _record_error(self, msg: str) -> None:
        self.stats.errors_total += 1
        self.stats.last_error = msg
        logger.warning("[Scheduler] %s", msg)

    # -- observability -----------------------------------------------------

    def queue_stats(self) -> dict:
        return self._queue.stats()

    def queue_snapshot(self) -> list[dict]:
        now = time.monotonic()
        return [
            {
                "camera_id": i.camera_id,
                "change_score": round(i.change_score, 6),
                "trigger_reason": i.gate_result.trigger_reason.value,
                "zone_risk_weight": i.zone_risk_weight,
                "has_active_alert": i.has_active_alert,
                "waiting_s": round(i.age_s(now), 3),
            }
            for i in self._queue.snapshot()
        ]

    def camera_stats(self) -> list[dict]:
        with self._lock:
            regs = list(self._cameras.values())
        out = []
        for r in regs:
            gate = self._pipeline.gate.stats(r.camera_id)
            out.append({
                "camera_id": r.camera_id,
                "gate_polls": r.gate_polls,
                "promotions": r.promotions,
                "promotion_rate": (
                    round(r.promotions / r.gate_polls, 4) if r.gate_polls else 0.0
                ),
                "gate_state": gate.state.value if gate else None,
                "risk_tier": gate.risk_tier if gate else None,
            })
        return out

    def as_dict(self) -> dict:
        return {
            "scheduler": self.stats.as_dict(),
            "queue": self.queue_stats(),
            "cameras": self.camera_stats(),
        }
