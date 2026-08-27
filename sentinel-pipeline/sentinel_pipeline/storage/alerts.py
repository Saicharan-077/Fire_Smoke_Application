"""
Alert store — THE single point where alerts are created.

This is the central enforcement of the evidence guarantee (Master Pipeline
Document Section 4b). Every confirmed alert, from every entry point -- webcam,
RTSP, uploaded video, uploaded image -- goes through ``AlertStore.create``,
which refuses to write an alert without a non-null evidence reference.

The bug this prevents already happened once in this project: the video-upload
path captured evidence, a separate live-RTSP path independently reached alert
creation without calling the same capture logic, and produced confirmed alerts
with no supporting image. That was possible because each entry point was
responsible for remembering to attach evidence.

Here it is structurally impossible:

  1. ``evidence_ref`` is a REQUIRED positional argument -- omitting it is a
     TypeError, not a None.
  2. It is validated non-empty and confirmed to exist on disk before insert.
  3. The database column is NOT NULL as a final backstop.

No other module in the pipeline may insert into ``pipeline_alerts``.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from sqlalchemy import create_engine, desc
from sqlalchemy.orm import Session, sessionmaker

from ..config import StorageSettings, settings as global_settings
from ..contracts import BBox, Severity, ThreatClass
from .evidence import EvidenceStore
from .models import AlertRecord, Base, IncidentRecord

logger = logging.getLogger("sentinel.alerts")


class MissingEvidenceError(ValueError):
    """Raised when alert creation is attempted without valid evidence."""


class AlertStore:
    def __init__(
        self,
        cfg: StorageSettings | None = None,
        evidence_store: EvidenceStore | None = None,
    ):
        self._cfg = cfg or global_settings.storage
        self._evidence = evidence_store or EvidenceStore(self._cfg)
        connect_args = (
            {"check_same_thread": False} if self._cfg.database_url.startswith("sqlite") else {}
        )
        self._engine = create_engine(
            self._cfg.database_url, connect_args=connect_args, future=True
        )
        if self._cfg.database_url.startswith("sqlite"):
            self._enable_wal()
        Base.metadata.create_all(self._engine)
        self._Session = sessionmaker(bind=self._engine, expire_on_commit=False, future=True)

    def _enable_wal(self) -> None:
        """Write-ahead logging + relaxed sync.

        Alert creation commits per alert to keep the evidence guarantee simple
        and atomic. In rollback-journal mode each commit is an fsync, which
        measured at roughly 3 ms and dominated the post-gate path during an
        active fire -- exactly when alert volume is highest. WAL removes the
        per-commit fsync while keeping crash-safety at the transaction level.
        """
        from sqlalchemy import event

        @event.listens_for(self._engine, "connect")
        def _set_pragmas(dbapi_conn, _rec):  # noqa: ANN001
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.close()

    def session(self) -> Session:
        return self._Session()

    # -- the guarded creation path ----------------------------------------

    def create(
        self,
        *,
        evidence_ref: str,
        camera_id: str,
        threat_class: ThreatClass,
        confidence: float,
        severity: Severity,
        severity_score: float,
        source_type: str,
        bbox: BBox | None = None,
        track_id: int | None = None,
        incident_id: str | None = None,
        zone_id: str | None = None,
        containment_breached: bool = False,
        envelope_exceeded: bool = False,
        growth_rate: float = 0.0,
        duration_s: float = 0.0,
        trigger_reason: str | None = None,
        reasoning: dict[str, Any] | None = None,
        timestamp: datetime | None = None,
    ) -> AlertRecord:
        """Create an alert. ``evidence_ref`` is mandatory and validated."""
        self._require_evidence(evidence_ref, camera_id)

        record = AlertRecord(
            incident_id=incident_id,
            camera_id=camera_id,
            track_id=track_id,
            threat_class=threat_class.value,
            confidence=round(float(confidence), 4),
            severity=severity.value,
            severity_score=round(float(severity_score), 4),
            bbox_x1=bbox.x1 if bbox else None,
            bbox_y1=bbox.y1 if bbox else None,
            bbox_x2=bbox.x2 if bbox else None,
            bbox_y2=bbox.y2 if bbox else None,
            zone_id=zone_id,
            containment_breached=containment_breached,
            envelope_exceeded=envelope_exceeded,
            growth_rate=round(float(growth_rate), 5),
            duration_s=round(float(duration_s), 3),
            evidence_ref=evidence_ref,
            source_type=source_type,
            trigger_reason=trigger_reason,
            reasoning_json=json.dumps(reasoning or {}, default=str),
        )
        if timestamp is not None:
            record.timestamp = timestamp

        with self.session() as s:
            s.add(record)
            s.commit()
            s.refresh(record)

        logger.info(
            "ALERT_CREATED id=%s class=%s severity=%s conf=%.3f camera=%s evidence=%s",
            record.id, record.threat_class, record.severity,
            record.confidence, record.camera_id, record.evidence_ref,
        )
        return record

    def _require_evidence(self, evidence_ref: str, camera_id: str) -> None:
        if not evidence_ref or not str(evidence_ref).strip():
            raise MissingEvidenceError(
                f"alert creation refused for camera {camera_id}: evidence_ref is "
                "empty. Every confirmed alert must carry evidence."
            )
        if self._evidence.resolve(evidence_ref) is None:
            raise MissingEvidenceError(
                f"alert creation refused for camera {camera_id}: evidence_ref "
                f"{evidence_ref!r} does not resolve to a stored file."
            )

    # -- reads -------------------------------------------------------------

    def get(self, alert_id: str) -> AlertRecord | None:
        with self.session() as s:
            return s.get(AlertRecord, alert_id)

    def list(
        self,
        *,
        camera_id: str | None = None,
        severity: str | None = None,
        incident_id: str | None = None,
        since: datetime | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AlertRecord]:
        with self.session() as s:
            q = s.query(AlertRecord)
            if camera_id:
                q = q.filter(AlertRecord.camera_id == camera_id)
            if severity:
                q = q.filter(AlertRecord.severity == severity)
            if incident_id:
                q = q.filter(AlertRecord.incident_id == incident_id)
            if since:
                q = q.filter(AlertRecord.timestamp >= since)
            return q.order_by(desc(AlertRecord.timestamp)).limit(limit).offset(offset).all()

    def count(self) -> int:
        with self.session() as s:
            return s.query(AlertRecord).count()

    def count_missing_evidence(self) -> int:
        """Audit helper. Must always be 0; the API exposes it on /v1/health."""
        with self.session() as s:
            return (
                s.query(AlertRecord)
                .filter((AlertRecord.evidence_ref.is_(None)) | (AlertRecord.evidence_ref == ""))
                .count()
            )

    def upsert_incident(
        self, *, incident_id: str, threat_class: str, severity: str,
        peak_score: float, camera_ids: list[str], resolved: bool,
    ) -> None:
        with self.session() as s:
            rec = s.get(IncidentRecord, incident_id)
            if rec is None:
                rec = IncidentRecord(id=incident_id)
                s.add(rec)
            rec.threat_class = threat_class
            rec.severity = severity
            rec.peak_score = peak_score
            rec.camera_ids_json = json.dumps(camera_ids)
            rec.resolved = resolved
            s.commit()


def alert_to_dict(a: AlertRecord) -> dict[str, Any]:
    return {
        "id": a.id,
        "incident_id": a.incident_id,
        "camera_id": a.camera_id,
        "track_id": a.track_id,
        "class": a.threat_class,
        "confidence": a.confidence,
        "severity": a.severity,
        "severity_score": a.severity_score,
        "bbox": (
            {"x1": a.bbox_x1, "y1": a.bbox_y1, "x2": a.bbox_x2, "y2": a.bbox_y2}
            if a.bbox_x1 is not None else None
        ),
        "zone_id": a.zone_id,
        "containment_breached": a.containment_breached,
        "envelope_exceeded": a.envelope_exceeded,
        "growth_rate": a.growth_rate,
        "duration_s": a.duration_s,
        "evidence_ref": a.evidence_ref,
        "source_type": a.source_type,
        "trigger_reason": a.trigger_reason,
        "reasoning": json.loads(a.reasoning_json) if a.reasoning_json else {},
        "timestamp": a.timestamp.isoformat() if a.timestamp else None,
    }
