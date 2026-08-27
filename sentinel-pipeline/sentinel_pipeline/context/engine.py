"""
Stage 4 — Context Engine.

Answers "how much does this matter?" for a confirmed detection, using zone
config, containment geometry, and tracking history. No AI inference; free at
runtime.

Also owns the evidence contract: this stage decides an alert exists, and it is
the only place that calls ``AlertStore.create``.
"""

from __future__ import annotations

import logging

import numpy as np

from ..config import ContextSettings, settings as global_settings
from ..contracts import (
    ClassifierVerdict,
    Severity,
    SeverityAssessment,
    ThreatClass,
)
from ..storage.alerts import AlertStore
from ..storage.evidence import EvidenceStore, annotate
from ..storage.persistence import CalibrationPersistence, ZonePersistence
from ..tracking.tracker import TrackingLayer
from .calibration import BoundaryDriftMonitor, CalibrationManager
from .drift import DriftDetector, DriftResult
from .incidents import IncidentResolver
from .severity import SeverityScorer, growth_rate
from .zones import Zone, ZoneRegistry

logger = logging.getLogger("sentinel.context")


# Which permitted activities excuse which threat classes.
ACTIVITY_FOR_CLASS = {
    ThreatClass.FIRE: ("bonfire", "furnace", "flare", "welding", "controlled_burn"),
    ThreatClass.WHITE_SMOKE: ("bonfire", "chimney", "steam_vent", "controlled_burn"),
    ThreatClass.GREY_SMOKE: ("bonfire", "chimney", "controlled_burn"),
    ThreatClass.BLACK_SMOKE: ("flare", "chimney"),
}


class ContextEngine:
    """Turns confirmed detections into severity decisions and alerts."""

    def __init__(
        self,
        *,
        tracking: TrackingLayer,
        alert_store: AlertStore | None = None,
        evidence_store: EvidenceStore | None = None,
        zones: ZoneRegistry | None = None,
        cfg: ContextSettings | None = None,
    ):
        self._cfg = cfg or global_settings.context
        self._tracking = tracking
        self._zones = zones or ZoneRegistry()
        self._evidence = evidence_store or EvidenceStore()
        self._alerts = alert_store or AlertStore(evidence_store=self._evidence)
        self._scorer = SeverityScorer(self._cfg)
        self._incidents = IncidentResolver(self._zones, self._cfg)
        self.calibration = CalibrationManager(self._cfg)
        self._drift = BoundaryDriftMonitor()
        self._drift_flagged: set[str] = set()
        self._zone_store = ZonePersistence(self._alerts)
        self._calib_store = CalibrationPersistence(self._alerts)
        self.drift = DriftDetector()

    # -- accessors ---------------------------------------------------------

    @property
    def zones(self) -> ZoneRegistry:
        return self._zones

    @property
    def incidents(self) -> IncidentResolver:
        return self._incidents

    @property
    def alerts(self) -> AlertStore:
        return self._alerts

    @property
    def evidence(self) -> EvidenceStore:
        return self._evidence

    def drift_flagged_cameras(self) -> list[str]:
        return sorted(self._drift_flagged)

    # -- assessment --------------------------------------------------------

    def assess(self, verdict: ClassifierVerdict) -> SeverityAssessment:
        """Score one confirmed detection. No side effects."""
        zone = self._zones.get_for_camera(verdict.camera_id)
        active_zone = zone if (zone and zone.approved) else None

        # Containment.
        if active_zone is None or not active_zone.has_containment:
            # No containment defined -> always alert (Master Doc Section 6).
            breached = True
            containment_fraction = 0.0
        else:
            inside, containment_fraction = active_zone.contains(verdict.bbox)
            breached = not inside

        # Normal envelope.
        envelope_exceeded = False
        envelope_reason = "no envelope configured"
        if active_zone is not None:
            ok, envelope_reason = active_zone.envelope.area_is_normal(verdict.bbox.area)
            envelope_exceeded = not ok

        # Growth and duration, from the shared tracking layer.
        track = self._tracking.get_track(verdict.camera_id, verdict.track_id)
        rate = 0.0
        duration = 0.0
        if track is not None:
            rate = growth_rate(track.area_series(), self._cfg.growth_window_s)
            duration = track.duration_s

        # Controlled-activity discount.
        is_controlled = False
        if active_zone is not None and not breached:
            permitted = ACTIVITY_FOR_CLASS.get(verdict.threat_class, ())
            is_controlled = any(active_zone.allows_activity(a) for a in permitted)
            if active_zone.envelope.always_on and not envelope_exceeded:
                is_controlled = True

        score, reasoning = self._scorer.score(
            confidence=verdict.confidence,
            threat_class=verdict.threat_class,
            zone_risk_weight=active_zone.risk_weight if active_zone else None,
            rate=rate,
            containment_breached=breached,
            envelope_exceeded=envelope_exceeded,
            is_controlled_activity=is_controlled,
            flammable_nearby=bool(active_zone and active_zone.flammable_materials_nearby),
        )

        severity = self._scorer.band(score)
        reasoning["containment_fraction"] = round(containment_fraction, 3)
        reasoning["envelope_check"] = envelope_reason
        reasoning["zone_approved"] = bool(active_zone)
        reasoning["is_controlled_activity"] = is_controlled
        reasoning["track_duration_s"] = round(duration, 2)

        # Boundary drift: are detections landing outside an approved polygon
        # consistently? Flag a human; never widen the boundary.
        if active_zone is not None and active_zone.has_containment:
            if self._drift.record(verdict.camera_id, breached):
                self._drift_flagged.add(verdict.camera_id)
                reasoning["boundary_drift_flagged"] = True

        should_alert = severity is not Severity.INFO

        return SeverityAssessment(
            severity=severity,
            score=score,
            should_alert=should_alert,
            zone_id=active_zone.zone_id if active_zone else None,
            containment_breached=breached,
            envelope_exceeded=envelope_exceeded,
            growth_rate=rate,
            duration_s=duration,
            reasoning=reasoning,
        )

    # -- alerting ----------------------------------------------------------

    def process(
        self,
        verdicts: list[ClassifierVerdict],
        *,
        frame: np.ndarray,
        source_type: str,
        trigger_reason: str | None = None,
    ) -> list[dict]:
        """Assess verdicts, correlate incidents, and write alerts with evidence.

        Evidence is captured ONCE per frame and shared by every alert from that
        frame, so a multi-detection frame doesn't write duplicate images.
        """
        if not verdicts:
            return []

        assessments: list[tuple[ClassifierVerdict, SeverityAssessment]] = []
        for v in verdicts:
            a = self.assess(v)

            # During calibration, log confirmed-normal detections for the zone
            # suggestion. Detection and alerting continue regardless -- the
            # window never creates a blind spot.
            if self.calibration.is_calibrating(v.camera_id):
                self.calibration.observe(
                    v.camera_id, v.bbox, v.threat_class.value,
                    v.confidence, v.monotonic_ts,
                )
                # Persist immediately: a 24-72h observation window that does not
                # survive a restart is worse than useless, because the operator
                # believes it is still running.
                self._calib_store.record(
                    v.camera_id, v.bbox, v.threat_class.value, v.confidence
                )
            assessments.append((v, a))

        alerting = [(v, a) for v, a in assessments if a.should_alert]
        if not alerting:
            return []

        # One evidence image per frame, captured BEFORE any alert is written.
        # If this raises, no alert is written -- which is the intended
        # behaviour, not a regression.
        annotated = annotate(
            frame,
            [
                {
                    "bbox": v.bbox.as_dict(),
                    "class": v.threat_class.value,
                    "confidence": v.confidence,
                    "track_id": v.track_id,
                }
                for v, _ in alerting
            ],
        )
        evidence_ref = self._evidence.save_frame(
            annotated, camera_id=alerting[0][0].camera_id, prefix=source_type
        )

        out: list[dict] = []
        for v, a in alerting:
            incident, is_new = self._incidents.resolve(
                camera_id=v.camera_id,
                track_id=v.track_id,
                threat_class=v.threat_class,
                severity=a.severity,
                score=a.score,
                monotonic_ts=v.monotonic_ts or None,
            )

            record = self._alerts.create(
                evidence_ref=evidence_ref,
                camera_id=v.camera_id,
                threat_class=v.threat_class,
                confidence=v.confidence,
                severity=a.severity,
                severity_score=a.score,
                source_type=source_type,
                bbox=v.bbox,
                track_id=v.track_id,
                incident_id=incident.incident_id,
                zone_id=a.zone_id,
                containment_breached=a.containment_breached,
                envelope_exceeded=a.envelope_exceeded,
                growth_rate=a.growth_rate,
                duration_s=a.duration_s,
                trigger_reason=trigger_reason,
                # evidence_sufficient / advisory_phases are promoted to the top
                # level rather than left inside the classifier's free-form
                # notes: whether an alert was ESCALATED on insufficient
                # evidence, and which phases were advisory-only, are
                # audit-critical facts an operator must see without digging
                # into a nested blob.
                reasoning={
                    **a.reasoning,
                    "evidence_sufficient": v.evidence_sufficient,
                    "escalated_unconfirmed": not v.evidence_sufficient,
                    "advisory_phases": list(v.advisory_phases),
                    "classifier": v.reasoning,
                },
                timestamp=v.timestamp,
            )
            incident.sources[v.camera_id].alert_ids.append(record.id)

            self._alerts.upsert_incident(
                incident_id=incident.incident_id,
                threat_class=incident.threat_class.value,
                severity=incident.severity.value,
                peak_score=incident.peak_score,
                camera_ids=incident.camera_ids,
                resolved=incident.resolved,
            )

            from ..storage.alerts import alert_to_dict

            d = alert_to_dict(record)
            d["incident_is_new"] = is_new
            d["incident_is_multi_camera"] = incident.is_multi_camera
            out.append(d)

        return out

    # -- zone management ---------------------------------------------------

    def set_zone(self, zone: Zone, *, persist: bool = True) -> Zone:
        z = self._zones.set(zone)
        if persist:
            self._zone_store.save(z)
        return z

    def approve_calibration(self, camera_id: str, zone_id: str, **kwargs) -> Zone:
        zone = self.calibration.approve(camera_id, zone_id, **kwargs)
        self._zones.set(zone)
        self._zone_store.save(zone)
        self._drift_flagged.discard(camera_id)
        return zone

    def load_persisted(self) -> dict:
        """Restore zones and in-flight calibration windows after a restart.

        Without this a restart silently downgrades a calibrated camera back to
        "uncalibrated" -- losing its containment boundary, normal envelope and
        risk tier, and with them its forced-override interval.
        """
        zones = self._zone_store.load_all()
        for z in zones:
            self._zones.set(z)

        restored_obs = 0
        for cam in self._calib_store.camera_ids():
            # Only reopen a window for a camera with no approved zone yet;
            # an approved zone means calibration already completed.
            existing = self._zones.get_for_camera(cam)
            if existing is not None and existing.approved:
                continue
            obs = self._calib_store.load_for(cam)
            if not obs:
                continue
            session = self.calibration.start(cam)
            session.observations.extend(obs)
            restored_obs += len(obs)

        logger.info(
            "[Context] restored %d zone(s) and %d calibration observation(s) from disk",
            len(zones), restored_obs,
        )
        return {"zones": len(zones), "calibration_observations": restored_obs}
