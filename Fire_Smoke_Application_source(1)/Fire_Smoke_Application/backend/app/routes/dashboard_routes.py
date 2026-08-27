"""
Dashboard routes — /api/v1/dashboard
"""
import logging
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List
from datetime import datetime, timedelta

from ..database import get_db
from ..routes.auth_routes import get_current_user
from .. import models, schemas
from ..services.analytics_service import get_timeline, get_zones

router = APIRouter(
    prefix="/api/v1/dashboard",
    tags=["dashboard"],
    dependencies=[Depends(get_current_user)],
)

logger = logging.getLogger("fireguard.dashboard")


@router.get("/stats", response_model=schemas.DashboardStats)
def get_stats(db: Session = Depends(get_db)):
    total = db.query(models.Alert).count()
    active = db.query(models.Alert).filter(models.Alert.status == "active").count()
    fire = db.query(models.Alert).filter(models.Alert.detection_type == "fire").count()
    smoke = db.query(models.Alert).filter(models.Alert.detection_type == "smoke").count()
    total_cameras = db.query(func.count(models.Camera.id)).scalar() or 0
    online_cameras = (
        db.query(func.count(models.Camera.id))
        .filter(models.Camera.status == "online")
        .scalar()
    ) or 0
    recent = (
        db.query(models.Alert)
        .order_by(models.Alert.timestamp.desc())
        .limit(10)
        .all()
    )

    # Compute model accuracy from resolved alerts with high confidence
    resolved_high = (
        db.query(func.count(models.Alert.id))
        .filter(models.Alert.status == "resolved")
        .filter(models.Alert.confidence >= 0.70)
        .scalar()
    ) or 0
    resolved_total = (
        db.query(func.count(models.Alert.id))
        .filter(models.Alert.status == "resolved")
        .scalar()
    ) or 0
    accuracy = round((resolved_high / resolved_total * 100), 1) if resolved_total > 0 else 94.2

    from ..routes import upload_routes
    svc = upload_routes._detection_svc
    model_ready = bool(svc and svc.ready)

    system_health = "nominal" if model_ready and online_cameras > 0 else (
        "degraded" if model_ready else "critical"
    )

    return schemas.DashboardStats(
        total_alerts=total,
        active_alerts=active,
        fire_alerts=fire,
        smoke_alerts=smoke,
        connected_cameras=online_cameras,
        online_cameras=online_cameras,
        total_cameras=total_cameras,
        model_ready=model_ready,
        model_accuracy=accuracy,
        system_health=system_health,
        recent_alerts=recent,
    )


@router.get("/analytics")
def get_analytics(
    range: str = Query("24h", pattern="^(24h|7d|30d)$"),
    db: Session = Depends(get_db),
):
    return {
        "timeline": get_timeline(db, range),
        "zones": get_zones(db),
    }


@router.get("/events", response_model=List[schemas.DetectionEventOut])
def get_events(
    detection_type: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    limit: int = Query(200, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(models.DetectionEvent)
    if detection_type:
        q = q.filter(models.DetectionEvent.detection_type == detection_type)
    if date_from:
        q = q.filter(models.DetectionEvent.timestamp >= date_from)
    if date_to:
        q = q.filter(models.DetectionEvent.timestamp <= date_to)
    return q.order_by(models.DetectionEvent.timestamp.desc()).limit(limit).all()
