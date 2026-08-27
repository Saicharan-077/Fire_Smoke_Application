"""
Camera routes — /api/v1/cameras
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List

from ..database import get_db
from ..routes.auth_routes import get_current_user, require_operator
from .. import models, schemas

router = APIRouter(prefix="/api/v1/cameras", tags=["cameras"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger("fireguard.cameras")


@router.get("", response_model=List[schemas.CameraOut])
def list_cameras(db: Session = Depends(get_db)):
    """List all registered cameras."""
    return db.query(models.Camera).order_by(models.Camera.name).all()


@router.post("", response_model=schemas.CameraOut, status_code=201, dependencies=[Depends(require_operator)])
def create_camera(body: schemas.CameraCreate, db: Session = Depends(get_db)):
    """Register a new camera."""
    cam = models.Camera(
        name=body.name,
        location=body.location,
        zone=body.zone,
        stream_url=body.stream_url,
        status="online",
    )
    db.add(cam)
    db.commit()
    db.refresh(cam)
    logger.info(f"Camera created: id={cam.id} name={cam.name}")
    return cam


@router.get("/count")
def camera_count(db: Session = Depends(get_db)):
    """Return the number of registered cameras."""
    total = db.query(func.count(models.Camera.id)).scalar() or 0
    online = (
        db.query(func.count(models.Camera.id))
        .filter(models.Camera.status == "online")
        .scalar()
    ) or 0
    return {"total": total, "online": online}


@router.get("/{camera_id}", response_model=schemas.CameraOut)
def get_camera(camera_id: str, db: Session = Depends(get_db)):
    cam = db.query(models.Camera).filter(models.Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    return cam


@router.get("/{camera_id}/activity")
def camera_activity(
    camera_id: str,
    limit: int = Query(20, le=100),
    db: Session = Depends(get_db),
):
    """Recent alerts for a specific camera."""
    cam = db.query(models.Camera).filter(models.Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    alerts = (
        db.query(models.Alert)
        .filter(models.Alert.camera_id == camera_id)
        .order_by(models.Alert.timestamp.desc())
        .limit(limit)
        .all()
    )
    return {
        "camera": schemas.CameraOut.model_validate(cam),
        "alerts": [schemas.AlertOut.model_validate(a) for a in alerts],
    }


def _get_camera_or_404(camera_id: str, db: Session) -> models.Camera:
    cam = db.query(models.Camera).filter(models.Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    return cam


@router.patch("/{camera_id}", response_model=schemas.CameraOut, dependencies=[Depends(require_operator)])
def patch_camera(
    camera_id: str,
    body: schemas.CameraUpdate,
    db: Session = Depends(get_db),
):
    """Update camera details."""
    cam = _get_camera_or_404(camera_id, db)

    data = body.model_dump(exclude_unset=True)

    if "status" in data and data["status"] is not None:
        if data["status"] not in {"online", "offline", "maintenance"}:
            raise HTTPException(status_code=400, detail="Invalid status")

    for k, v in data.items():
        setattr(cam, k, v)

    db.add(cam)
    db.commit()
    db.refresh(cam)
    return cam


@router.patch("/{camera_id}/status", response_model=schemas.CameraOut, dependencies=[Depends(require_operator)])
def patch_camera_status(
    camera_id: str,
    body: schemas.CameraStatusUpdate,
    db: Session = Depends(get_db),
):
    """Update camera status."""
    cam = _get_camera_or_404(camera_id, db)

    if body.status not in {"online", "offline", "maintenance"}:
        raise HTTPException(status_code=400, detail="Invalid status")

    cam.status = body.status
    db.add(cam)
    db.commit()
    db.refresh(cam)
    return cam


@router.patch("/{camera_id}/zone", response_model=schemas.CameraOut, dependencies=[Depends(require_operator)])
def patch_camera_zone(
    camera_id: str,
    body: schemas.CameraZoneUpdate,
    db: Session = Depends(get_db),
):
    """Update camera zone assignment."""
    cam = _get_camera_or_404(camera_id, db)
    cam.zone = body.zone
    db.add(cam)
    db.commit()
    db.refresh(cam)
    return cam


@router.delete("/{camera_id}", dependencies=[Depends(require_operator)])
def delete_camera(camera_id: str, db: Session = Depends(get_db)):
    cam = db.query(models.Camera).filter(models.Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    db.delete(cam)
    db.commit()
    logger.info(f"Camera deleted: id={camera_id}")
    return {"status": "success", "message": f"Camera {camera_id} deleted."}

