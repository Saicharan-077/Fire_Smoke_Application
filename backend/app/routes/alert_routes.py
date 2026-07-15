"""
Alert routes — /api/v1/alerts
"""
import os
import logging
import math
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional, List
from datetime import datetime

from ..database import get_db
from ..routes.auth_routes import get_current_user, require_operator
from .. import models, schemas
from ..services.alert_service import update_alert_status

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger("fireguard.alerts")


@router.get("", response_model=schemas.PaginatedAlerts)
def list_alerts(
    detection_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    q = db.query(models.Alert)
    if detection_type:
        q = q.filter(models.Alert.detection_type == detection_type)
    if status:
        q = q.filter(models.Alert.status == status)
    if date_from:
        q = q.filter(models.Alert.timestamp >= date_from)
    if date_to:
        q = q.filter(models.Alert.timestamp <= date_to)
    if search:
        term = f"%{search}%"
        q = q.filter(
            or_(
                models.Alert.file_name.ilike(term),
                models.Alert.location.ilike(term),
                models.Alert.camera_id.ilike(term),
            )
        )

    total = q.count()
    pages = max(1, math.ceil(total / limit))
    items = (
        q.order_by(models.Alert.timestamp.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    return schemas.PaginatedAlerts(
        items=items, total=total, page=page, limit=limit, pages=pages
    )


@router.patch("/{alert_id}/status", response_model=schemas.AlertOut, dependencies=[Depends(require_operator)])
def patch_status(
    alert_id: str,
    body: schemas.AlertStatusUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    alert = update_alert_status(db, alert_id, body.status, resolved_by=current_user.username)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@router.get("/{alert_id}", response_model=schemas.AlertOut)
def get_alert(alert_id: str, db: Session = Depends(get_db)):
    alert = db.query(models.Alert).filter(models.Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@router.get("/{alert_id}/events", response_model=List[schemas.DetectionEventOut])
def alert_events(alert_id: str, db: Session = Depends(get_db)):
    """Get all detection events under a specific alert."""
    alert = db.query(models.Alert).filter(models.Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return (
        db.query(models.DetectionEvent)
        .filter(models.DetectionEvent.alert_id == alert_id)
        .order_by(models.DetectionEvent.timestamp.desc())
        .all()
    )


@router.delete("/{alert_id}", dependencies=[Depends(require_operator)])
def delete_alert(alert_id: str, db: Session = Depends(get_db)):
    alert = db.query(models.Alert).filter(models.Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    # Cascading delete of associated events
    db.query(models.DetectionEvent).filter(
        models.DetectionEvent.alert_id == alert_id
    ).delete()

    # Try to delete associated evidence files
    if alert.evidence_path:
        ev_dir = os.path.join(os.path.dirname(__file__), "..", "..", "evidence")
        filename = os.path.basename(alert.evidence_path)
        full_path = os.path.join(ev_dir, filename)
        try:
            if os.path.exists(full_path):
                os.remove(full_path)
        except Exception:
            logger.warning(f"Failed to remove evidence file: {full_path}")

    db.delete(alert)
    db.commit()
    logger.info(f"Alert deleted: id={alert_id}")
    return {"status": "success", "message": f"Alert {alert_id} deleted."}
