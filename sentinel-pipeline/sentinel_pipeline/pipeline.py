"""
Pipeline orchestrator — Gate -> Model -> Tracking -> Classifier -> Context.

This is the only object the API layer talks to. Every frame entering the
pipeline, from any source, goes through ``process_frame``. There is no second
path to the Model and no second place that decides to skip a frame.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field

import numpy as np

from .classifier.base import Classifier
from .classifier.stub import StubClassifier
from .config import Settings, settings as global_settings
from .context.engine import ContextEngine
from .contracts import GateResult, RawClass, ThreatClass
from .gate.gate import Gate
from .gate.gate_config import CameraGateConfig
from .model.detector import ModelStage
from .storage.alerts import AlertStore
from .storage.evidence import EvidenceStore
from .tracking.tracker import TrackingLayer

logger = logging.getLogger("sentinel.pipeline")

# Last-resort mapping used ONLY when a verdict arrives as FALSE_POSITIVE with
# evidence_sufficient=False, so the candidate can be escalated rather than
# dropped. Deliberately blunt; the Classifier should supply a best-guess
# class instead of relying on this.
_ESCALATION_CLASS = {
    RawClass.FIRE: ThreatClass.FIRE,
    RawClass.SPARKS: ThreatClass.FIRE,
    RawClass.SMOKE: ThreatClass.GREY_SMOKE,
}


@dataclass
class FrameOutcome:
    """What happened to one submitted frame."""

    camera_id: str
    gate_passed: bool
    trigger_reason: str | None = None
    change_score: float = 0.0
    candidates: int = 0
    tracked: int = 0
    confirmed: int = 0
    rejected_false_positive: int = 0
    escalated_unconfirmed: int = 0
    alerts: list[dict] = field(default_factory=list)
    detections: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "camera_id": self.camera_id,
            "gate_passed": self.gate_passed,
            "trigger_reason": self.trigger_reason,
            "change_score": round(self.change_score, 6),
            "candidates": self.candidates,
            "tracked": self.tracked,
            "confirmed": self.confirmed,
            "rejected_false_positive": self.rejected_false_positive,
            "escalated_unconfirmed": self.escalated_unconfirmed,
            "detections": self.detections,
            "alerts": self.alerts,
        }


class Pipeline:
    """The full detection pipeline as a single object."""

    def __init__(
        self,
        *,
        classifier: Classifier | None = None,
        settings: Settings | None = None,
        model: ModelStage | None = None,
    ):
        self._settings = settings or global_settings
        self.gate = Gate(self._settings)
        self.model = model or ModelStage(self._settings.model)
        self.tracking = TrackingLayer(self._settings.tracking)

        self.classifier = classifier or StubClassifier()
        self.classifier.warmup()
        if getattr(self.classifier, "is_stub", False):
            logger.warning(
                "Pipeline is running the STUB classifier (%s). This is a "
                "placeholder, not the real two-tier Classifier. Not for production.",
                self.classifier.name,
            )

        evidence = EvidenceStore(self._settings.storage)
        self.context = ContextEngine(
            tracking=self.tracking,
            alert_store=AlertStore(self._settings.storage, evidence_store=evidence),
            evidence_store=evidence,
            cfg=self._settings.context,
        )
        self._lock = threading.RLock()

    # -- camera lifecycle --------------------------------------------------

    def register_camera(
        self, camera_id: str, *, zone_id: str | None = None,
        risk_weight: float | None = None,
        forced_override_interval: float | None = None,
    ) -> None:
        self.gate.configure_camera(
            CameraGateConfig(
                camera_id=camera_id, zone_id=zone_id, risk_weight=risk_weight,
                forced_override_interval=forced_override_interval,
            )
        )

    def sync_zone_to_gate(self, camera_id: str) -> None:
        """Push an approved zone's risk tier into the Gate's override timer."""
        zone = self.context.zones.get_for_camera(camera_id)
        if zone and zone.approved:
            self.gate.update_zone(camera_id, zone.zone_id, zone.risk_weight)
        else:
            self.gate.update_zone(camera_id, None, None)

    # -- the single frame path ---------------------------------------------

    def process_frame(
        self, camera_id: str, frame: np.ndarray, *, source_type: str = "stream",
        bypass_gate: bool = False,
    ) -> FrameOutcome:
        """Run one frame through the whole pipeline.

        ``bypass_gate`` is for single-image submissions, where the caller has
        already decided this frame matters and a motion gate is meaningless.
        It skips the Gate DECISION only -- every later stage is identical.
        """
        if frame is None or frame.size == 0:
            raise ValueError("empty frame submitted")

        if bypass_gate:
            from .contracts import TriggerReason, utc_now
            import time as _time

            gate_result = GateResult(
                camera_id=camera_id, timestamp=utc_now(), frame=frame,
                trigger_reason=TriggerReason.FORCED_OVERRIDE, change_score=0.0,
                zone_risk_weight=self.context.zones.risk_weight_for(camera_id),
                monotonic_ts=_time.monotonic(),
            )
        else:
            gate_result = self.gate.process_frame(camera_id, frame)

        if gate_result is None:
            stats = self.gate.stats(camera_id)
            return FrameOutcome(
                camera_id=camera_id, gate_passed=False,
                change_score=stats.change_score if stats else 0.0,
            )

        return self.run_after_gate(gate_result, source_type=source_type)


    def gate_only(self, camera_id: str, frame: np.ndarray) -> GateResult | None:
        """Stage 1 ONLY. Cheap enough to run on every camera continuously.

        The multi-camera scheduler calls this on all cameras, then promotes
        only the passing ones into its priority queue. Splitting the decision
        from the work is what lets the expensive stages be scheduled rather
        than run wherever a frame happens to arrive.
        """
        if frame is None or frame.size == 0:
            raise ValueError("empty frame submitted")
        return self.gate.process_frame(camera_id, frame)

    def run_after_gate(
        self, gate_result: GateResult, *, source_type: str = "stream"
    ) -> FrameOutcome:
        """Stages 2-4 for a frame the Gate already approved.

        The ONLY implementation of the post-gate path. ``process_frame`` and the
        scheduler both route through here; neither has its own copy.
        """
        camera_id = gate_result.camera_id
        frame = gate_result.frame

        outcome = FrameOutcome(
            camera_id=camera_id,
            gate_passed=True,
            trigger_reason=gate_result.trigger_reason.value,
            change_score=gate_result.change_score,
        )

        # Stage 2 — Model.
        candidates = self.model.detect(gate_result)
        outcome.candidates = len(candidates)
        if not candidates:
            return outcome

        # Stage 2.5 — shared tracking. Assigns track_id and builds crop history.
        with self._lock:
            classifier_inputs = self.tracking.update(camera_id, frame, candidates)
        outcome.tracked = len(classifier_inputs)
        if not classifier_inputs:
            return outcome

        # Stage 3 — Classifier.
        verdicts = self.classifier.classify_batch(classifier_inputs)

        by_track = {v.track_id: v for v in verdicts}
        confirmed = []
        for inp in classifier_inputs:
            v = by_track.get(inp.track_id)

            # An omitted verdict is an explicit rejection, per contract.
            if v is None:
                outcome.rejected_false_positive += 1
                continue

            # Recall-first guarantee: a candidate the Classifier could not
            # DECIDE is escalated, never dropped. Only a confident rejection
            # (FALSE_POSITIVE with sufficient evidence) drops a candidate.
            if v.is_rejection:
                outcome.rejected_false_positive += 1
                continue

            if not v.monotonic_ts:
                v.monotonic_ts = inp.monotonic_ts

            if not v.evidence_sufficient:
                outcome.escalated_unconfirmed += 1
                if v.threat_class is ThreatClass.FALSE_POSITIVE:
                    # Nothing to escalate under. Substitute from the detector's
                    # own class so the candidate survives, and make the
                    # substitution loud -- it is blunt, and the Classifier is
                    # meant to supply a best-guess class instead.
                    substituted = _ESCALATION_CLASS.get(inp.class_raw, ThreatClass.FIRE)
                    logger.warning(
                        "[Pipeline] track=%s returned FALSE_POSITIVE with "
                        "evidence_sufficient=False; substituting %s from "
                        "class_raw=%s to escalate rather than drop",
                        v.track_id, substituted.value, inp.class_raw.value,
                    )
                    v.threat_class = substituted
                    v.reasoning = {
                        **v.reasoning,
                        "pipeline_class_substituted": True,
                        "substituted_from": inp.class_raw.value,
                    }
                v.reasoning = {
                    **v.reasoning,
                    "evidence_sufficient": False,
                    "escalated_unconfirmed": True,
                    "advisory_phases": list(v.advisory_phases),
                }
            elif v.advisory_phases:
                v.reasoning = {
                    **v.reasoning,
                    "advisory_phases": list(v.advisory_phases),
                }

            confirmed.append(v)

        outcome.confirmed = len(confirmed)
        outcome.detections = [v.as_public_dict() for v in confirmed]
        if not confirmed:
            return outcome

        # Stage 4 — Context Engine (and the only alert-creation path).
        outcome.alerts = self.context.process(
            confirmed, frame=frame, source_type=source_type,
            trigger_reason=gate_result.trigger_reason.value,
        )
        return outcome

    # -- introspection -----------------------------------------------------

    def health(self) -> dict:
        return {
            "status": "ok" if self.model.ready else "degraded",
            "model": self.model.info().as_dict(),
            "model_latency": self.model.latency_stats(),
            "classifier": self.classifier.name,
            "classifier_is_stub": bool(getattr(self.classifier, "is_stub", False)),
            "cameras_gated": len(self.gate.all_stats()),
            "active_tracks": self.tracking.track_count(),
            "alerts_total": self.context.alerts.count(),
            "alerts_missing_evidence": self.context.alerts.count_missing_evidence(),
            "active_incidents": len(self.context.incidents.active()),
            "boundary_drift_flagged": self.context.drift_flagged_cameras(),
        }
