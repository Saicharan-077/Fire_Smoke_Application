"""
Lifecycle management for pipeline-owned alerts.

The detection pipeline owns the alert RECORD (what was detected, where, with
what evidence). The Dashboard owns the alert LIFECYCLE (acknowledged, resolved
with a PIN, escalated, annotated).

This module is the Dashboard half. It never calls pipeline internals -- the
frontend fetches detection data from the pipeline's /v1 API and lifecycle state
from here, then merges the two by `pipeline_alert_id`.

Deliberately additive: no existing route in `alert_routes.py` is modified, so
pre-cutover alerts continue to work exactly as before.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from .auth_routes import get_current_user, require_operator, verify_password

logger = logging.getLogger("fireguard.pipeline_alerts")

router = APIRouter(prefix="/api/v1/pipeline-alerts", tags=["pipeline-alerts"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class AlertSnapshot(BaseModel):
    """Optional detection-data snapshot, supplied by the frontend from the
    pipeline response so a resolved alert stays auditable if the pipeline later
    becomes unreachable. Never used for detection logic."""

    camera_id: str | None = None
    detection_type: str | None = None
    severity: str | None = None
    confidence: float | None = None
    evidence_ref: str | None = None
    timestamp: datetime | None = None


class AcknowledgePayload(BaseModel):
    snapshot: AlertSnapshot | None = None


class ResolvePayload(BaseModel):
    pin: str | None = Field(
        None, description="Resolution PIN. Required when the user has one set."
    )
    notes: str | None = None
    snapshot: AlertSnapshot | None = None


class EscalatePayload(BaseModel):
    target: str = Field(..., description="Person, team or system to escalate to")
    notes: str | None = None
    snapshot: AlertSnapshot | None = None


class NotesPayload(BaseModel):
    notes: str


class LifecycleOut(BaseModel):
    pipeline_alert_id: str
    status: str
    acknowledged_by: str | None = None
    acknowledged_at: datetime | None = None
    resolved_by: str | None = None
    resolved_at: datetime | None = None
    resolution_pin_verified: bool = False
    escalated: bool = False
    escalated_at: datetime | None = None
    escalated_by: str | None = None
    escalation_target: str | None = None
    notes: str | None = None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_or_create(
    db: Session, pipeline_alert_id: str, snapshot: AlertSnapshot | None
) -> models.PipelineAlertLifecycle:
    """Lazily create the lifecycle row on first action.

    Alerts with no row are implicitly active, so the pipeline's alert stream is
    never mirrored into this database.
    """
    row = (
        db.query(models.PipelineAlertLifecycle)
        .filter(models.PipelineAlertLifecycle.pipeline_alert_id == pipeline_alert_id)
        .first()
    )
    if row is None:
        row = models.PipelineAlertLifecycle(pipeline_alert_id=pipeline_alert_id)
        db.add(row)
    if snapshot is not None:
        row.snapshot_camera_id = snapshot.camera_id or row.snapshot_camera_id
        row.snapshot_detection_type = snapshot.detection_type or row.snapshot_detection_type
        row.snapshot_severity = snapshot.severity or row.snapshot_severity
        row.snapshot_confidence = (
            snapshot.confidence if snapshot.confidence is not None else row.snapshot_confidence
        )
        row.snapshot_evidence_ref = snapshot.evidence_ref or row.snapshot_evidence_ref
        row.snapshot_timestamp = snapshot.timestamp or row.snapshot_timestamp
    return row


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/{pipeline_alert_id}", response_model=LifecycleOut)
def get_lifecycle(
    pipeline_alert_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Lifecycle state for one pipeline alert. Absent row == implicitly active."""
    row = (
        db.query(models.PipelineAlertLifecycle)
        .filter(models.PipelineAlertLifecycle.pipeline_alert_id == pipeline_alert_id)
        .first()
    )
    if row is None:
        return LifecycleOut(pipeline_alert_id=pipeline_alert_id, status="active")
    return LifecycleOut.model_validate(row)


@router.post("/batch", response_model=list[LifecycleOut])
def get_lifecycle_batch(
    ids: list[str],
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Lifecycle for many alerts at once.

    The alerts list needs state for a page of alerts; one request per alert
    would be N round-trips on every render.
    """
    if not ids:
        return []
    rows = (
        db.query(models.PipelineAlertLifecycle)
        .filter(models.PipelineAlertLifecycle.pipeline_alert_id.in_(ids[:500]))
        .all()
    )
    found = {r.pipeline_alert_id: r for r in rows}
    return [
        LifecycleOut.model_validate(found[i])
        if i in found
        else LifecycleOut(pipeline_alert_id=i, status="active")
        for i in ids[:500]
    ]


@router.post("/{pipeline_alert_id}/acknowledge", response_model=LifecycleOut)
def acknowledge(
    pipeline_alert_id: str,
    payload: AcknowledgePayload | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_operator),
):
    row = _get_or_create(db, pipeline_alert_id, payload.snapshot if payload else None)
    row.status = "acknowledged"
    row.acknowledged_by = current_user.username
    row.acknowledged_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    logger.info("PIPELINE_ALERT_ACK id=%s by=%s", pipeline_alert_id, current_user.username)
    return LifecycleOut.model_validate(row)


@router.post("/{pipeline_alert_id}/resolve", response_model=LifecycleOut)
def resolve(
    pipeline_alert_id: str,
    payload: ResolvePayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_operator),
):
    """Resolve a pipeline alert, PIN-gated when the operator has a PIN set.

    NOTE ON PRIOR ART: PIN-gated resolution was scoped but never implemented in
    the pre-cutover app -- ``users.resolution_pin_hash`` exists as a column, but
    nothing ever set or verified it, and no PIN UI exists. This is therefore a
    NEW capability, not a migrated one. It degrades to the old behaviour
    (resolve without a PIN) for any user with no PIN configured, which is
    currently every user.
    """
    pin_verified = False
    if getattr(current_user, "resolution_pin_hash", None):
        if not payload.pin:
            raise HTTPException(status_code=400, detail="Resolution PIN required")
        if not verify_password(payload.pin, current_user.resolution_pin_hash):
            logger.warning(
                "PIPELINE_ALERT_RESOLVE_DENIED id=%s by=%s (bad PIN)",
                pipeline_alert_id, current_user.username,
            )
            raise HTTPException(status_code=403, detail="Invalid resolution PIN")
        pin_verified = True

    row = _get_or_create(db, pipeline_alert_id, payload.snapshot)
    row.status = "resolved"
    row.resolved_by = current_user.username
    row.resolved_at = datetime.utcnow()
    row.resolution_pin_verified = pin_verified
    if payload.notes:
        row.notes = payload.notes
    db.commit()
    db.refresh(row)
    logger.info(
        "PIPELINE_ALERT_RESOLVED id=%s by=%s pin_verified=%s",
        pipeline_alert_id, current_user.username, pin_verified,
    )
    return LifecycleOut.model_validate(row)


@router.post("/{pipeline_alert_id}/escalate", response_model=LifecycleOut)
def escalate(
    pipeline_alert_id: str,
    payload: EscalatePayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_operator),
):
    row = _get_or_create(db, pipeline_alert_id, payload.snapshot)
    row.escalated = True
    row.escalated_at = datetime.utcnow()
    row.escalated_by = current_user.username
    row.escalation_target = payload.target
    if payload.notes:
        row.notes = payload.notes
    db.commit()
    db.refresh(row)
    logger.info(
        "PIPELINE_ALERT_ESCALATED id=%s by=%s target=%s",
        pipeline_alert_id, current_user.username, payload.target,
    )
    return LifecycleOut.model_validate(row)


@router.post("/{pipeline_alert_id}/notes", response_model=LifecycleOut)
def set_notes(
    pipeline_alert_id: str,
    payload: NotesPayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_operator),
):
    row = _get_or_create(db, pipeline_alert_id, None)
    row.notes = payload.notes
    db.commit()
    db.refresh(row)
    return LifecycleOut.model_validate(row)


@router.post("/{pipeline_alert_id}/reopen", response_model=LifecycleOut)
def reopen(
    pipeline_alert_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_operator),
):
    row = _get_or_create(db, pipeline_alert_id, None)
    row.status = "active"
    row.resolved_by = None
    row.resolved_at = None
    row.resolution_pin_verified = False
    db.commit()
    db.refresh(row)
    return LifecycleOut.model_validate(row)
