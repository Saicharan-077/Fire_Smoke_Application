"""
Gate orchestrator — the single entry point for every frame source.

    gate.process_frame(camera_id, raw_frame) -> GateResult | None

``None`` means skip the frame. A ``GateResult`` means send it to the Model.

This module REPLACES the eight separate motion-filter implementations found in
the existing application (three frontend page loops, three inside
DetectionLayer, one in CameraScheduler, one post-model ROI filter). Every frame
source -- webcam, RTSP, video upload, image upload, dashboard tiles -- routes
through here. Nothing else in the pipeline may implement frame skipping.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field

import numpy as np

from ..config import GateSettings, Settings, settings as global_settings
from ..contracts import GateResult, TriggerReason, utc_now
from .change_scorer import ChangeScorer
from .forced_override import ForcedOverrideTimer
from .gate_config import CameraGateConfig, GateConfigStore
from .hysteresis import GateState, HysteresisStateMachine
from .preprocessing import Preprocessor

logger = logging.getLogger("sentinel.gate")


@dataclass
class CameraGateStats:
    """Observability for one camera. Surfaced by the API; never fabricated."""

    camera_id: str
    state: GateState = GateState.IDLE
    change_score: float = 0.0
    effective_threshold: float = 0.0
    frames_seen: int = 0
    frames_passed: int = 0
    frames_skipped: int = 0
    forced_overrides: int = 0
    motion_passes: int = 0
    state_transitions: int = 0
    warm: bool = False
    last_pass_ts: float | None = None
    zone_id: str | None = None
    risk_weight: float | None = None
    forced_interval_s: float = 0.0
    risk_tier: str = "uncalibrated"
    avg_process_ms: float = 0.0

    def as_dict(self) -> dict:
        d = self.__dict__.copy()
        d["state"] = self.state.value
        return d


class _CameraGate:
    """All Gate state for one camera. Not thread-safe on its own; the owning
    ``Gate`` serialises access per camera."""

    __slots__ = ("cfg", "pre", "scorer", "hysteresis", "override", "stats", "_ms_window")

    def __init__(self, camera_cfg: CameraGateConfig, gate_cfg: GateSettings, ctx_cfg):
        interval, tier = camera_cfg.resolve_interval(ctx_cfg)
        enter = camera_cfg.resolve_enter_threshold(gate_cfg)
        # Preserve the configured hysteresis ratio when the camera overrides
        # the enter threshold.
        ratio = (
            gate_cfg.exit_active_threshold / gate_cfg.enter_active_threshold
            if gate_cfg.enter_active_threshold > 0
            else 0.4
        )

        self.cfg = camera_cfg
        self.pre = Preprocessor(gate_cfg)
        self.scorer = ChangeScorer(gate_cfg)
        self.hysteresis = HysteresisStateMachine(
            enter_threshold=enter,
            exit_threshold=enter * ratio,
            enter_confirm_frames=gate_cfg.enter_confirm_frames,
            exit_confirm_frames=gate_cfg.exit_confirm_frames,
        )
        self.override = ForcedOverrideTimer(interval, tier)
        self.stats = CameraGateStats(
            camera_id=camera_cfg.camera_id,
            zone_id=camera_cfg.zone_id,
            risk_weight=camera_cfg.risk_weight,
            forced_interval_s=interval,
            risk_tier=tier,
        )
        self._ms_window: list[float] = []

    def record_ms(self, ms: float) -> None:
        self._ms_window.append(ms)
        if len(self._ms_window) > 200:
            self._ms_window.pop(0)
        self.stats.avg_process_ms = round(sum(self._ms_window) / len(self._ms_window), 4)


class Gate:
    """Stage 1 of the pipeline. Cheap enough to run on every camera continuously."""

    def __init__(self, settings: Settings | None = None, config_store: GateConfigStore | None = None):
        self._settings = settings or global_settings
        self._gate_cfg = self._settings.gate
        self._ctx_cfg = self._settings.context
        self._store = config_store or GateConfigStore()
        self._cameras: dict[str, _CameraGate] = {}
        self._lock = threading.RLock()

    # -- configuration -----------------------------------------------------

    @property
    def config_store(self) -> GateConfigStore:
        return self._store

    def configure_camera(self, cfg: CameraGateConfig) -> None:
        """Register or reconfigure a camera. Rebuilds its Gate state.

        Builds the camera's Gate eagerly rather than lazily on first frame, so
        telemetry and forced-override configuration are observable from the
        moment a camera is registered -- including for cameras that only ever
        submit single images and never exercise the motion path.
        """
        with self._lock:
            self._store.set(cfg)
            self._cameras.pop(cfg.camera_id, None)
            self._camera(cfg.camera_id)

    def update_zone(
        self, camera_id: str, zone_id: str | None, risk_weight: float | None
    ) -> None:
        """Called by the Context Engine when calibration assigns a zone.

        Updates the forced-override interval in place, preserving the background
        model -- rebuilding it would discard a warmed-up scene and cause a
        false-positive storm right after calibration.
        """
        with self._lock:
            cfg = self._store.update_zone(camera_id, zone_id, risk_weight)
            # Create the camera's Gate if it doesn't exist yet: a zone can be
            # approved before the camera has ever submitted a gated frame.
            cam = self._camera(camera_id)
            interval, tier = cfg.resolve_interval(self._ctx_cfg)
            cam.cfg = cfg
            cam.override.set_interval(interval, tier)
            cam.stats.zone_id = zone_id
            cam.stats.risk_weight = risk_weight
            cam.stats.forced_interval_s = interval
            cam.stats.risk_tier = tier
            logger.info(
                "[Gate] camera=%s zone=%s risk=%s -> forced interval %.1fs (%s)",
                camera_id, zone_id, risk_weight, interval, tier,
            )

    def _camera(self, camera_id: str) -> _CameraGate:
        cam = self._cameras.get(camera_id)
        if cam is None:
            cam = _CameraGate(self._store.get(camera_id), self._gate_cfg, self._ctx_cfg)
            self._cameras[camera_id] = cam
            logger.info(
                "[Gate] initialised camera=%s tier=%s forced=%.1fs",
                camera_id, cam.override.tier, cam.override.interval,
            )
        return cam

    # -- the single entry point -------------------------------------------

    def process_frame(self, camera_id: str, raw_frame: np.ndarray) -> GateResult | None:
        """Decide whether this frame is worth running the Model on.

        Returns ``None`` to skip, or a ``GateResult`` to proceed.
        """
        t0 = time.perf_counter()
        with self._lock:
            cam = self._camera(camera_id)

        if not cam.cfg.enabled:
            return None

        stats = cam.stats
        stats.frames_seen += 1

        processed = cam.pre.process(raw_frame)
        score = cam.scorer.score(processed)
        stats.change_score = round(score, 6)
        stats.warm = cam.scorer.warm

        base_threshold = cam.cfg.resolve_enter_threshold(self._gate_cfg)
        effective = cam.scorer.adaptive_threshold(base_threshold)
        stats.effective_threshold = round(effective, 6)

        # While the background model warms up, MOG2 reports most of the frame as
        # foreground. Suppress the motion path but keep the forced override
        # live, so a camera is never blind even during warmup.
        motion_active = False
        if cam.scorer.warm:
            state = cam.hysteresis.update(score, enter_threshold=effective)
            motion_active = state is GateState.ACTIVE
            stats.state = state
            stats.state_transitions = cam.hysteresis.transition_count

        forced = cam.override.should_fire()

        if not motion_active and not forced:
            stats.frames_skipped += 1
            cam.record_ms((time.perf_counter() - t0) * 1000.0)
            return None

        # Forced override wins the label when both are true: it is the stronger
        # guarantee, and the Model stage uses it to bypass downstream
        # static-scene rejection.
        if forced:
            cam.override.fire()
            reason = TriggerReason.FORCED_OVERRIDE
            stats.forced_overrides += 1
        else:
            cam.override.notify_inference_ran()
            reason = TriggerReason.MOTION
            stats.motion_passes += 1

        stats.frames_passed += 1
        stats.last_pass_ts = time.time()
        cam.record_ms((time.perf_counter() - t0) * 1000.0)

        return GateResult(
            camera_id=camera_id,
            timestamp=utc_now(),
            frame=raw_frame,
            trigger_reason=reason,
            change_score=float(score),
            zone_risk_weight=cam.cfg.risk_weight,
            monotonic_ts=time.monotonic(),
        )

    # -- observability -----------------------------------------------------

    def stats(self, camera_id: str) -> CameraGateStats | None:
        cam = self._cameras.get(camera_id)
        return cam.stats if cam else None

    def all_stats(self) -> list[CameraGateStats]:
        return [c.stats for c in self._cameras.values()]

    def reset_camera(self, camera_id: str) -> None:
        with self._lock:
            self._cameras.pop(camera_id, None)
