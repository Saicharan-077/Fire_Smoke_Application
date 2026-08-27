"""
Alert service — create alerts, events, update statuses.
"""
import logging
from sqlalchemy.orm import Session
from .. import models

logger = logging.getLogger("fireguard.alert")


def create_alert(
    db: Session,
    detection_type: str,
    confidence: float,
    source_type: str,
    camera_id: str = None,
    location: str = None,
    file_name: str = None,
    evidence_path: str = None,
    frame_number: int = None,
) -> models.Alert:
    alert = models.Alert(
        detection_type=detection_type,
        camera_id=camera_id,
        location=location,
        confidence=confidence,
        status="active",
        source_type=source_type,
        file_name=file_name,
        evidence_path=evidence_path,
        frame_number=frame_number,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    logger.info(
        f"ALERT_CREATED: id={alert.id} type={detection_type} "
        f"conf={confidence:.4f} source={source_type}"
    )
    return alert


def create_event(
    db: Session,
    alert_id: str,
    det: dict,
    source_type: str,
    camera_id: str = None,
    location: str = None,
    file_name: str = None,
    frame_number: int = None,
    evidence_path: str = None,
) -> models.DetectionEvent:
    bb = det.get("bbox", {})
    event = models.DetectionEvent(
        alert_id=alert_id,
        detection_type=det["detection_type"],
        camera_id=camera_id,
        location=location,
        confidence=det["confidence"],
        bbox_x1=bb.get("x1"),
        bbox_y1=bb.get("y1"),
        bbox_x2=bb.get("x2"),
        bbox_y2=bb.get("y2"),
        source_type=source_type,
        file_name=file_name,
        frame_number=frame_number,
        evidence_path=evidence_path,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    logger.debug(f"Event saved — id={event.id} alert_id={alert_id}")
    return event


def update_alert_status(db: Session, alert_id: str, status: str) -> models.Alert | None:
    alert = db.query(models.Alert).filter(models.Alert.id == alert_id).first()
    if not alert:
        logger.warning(f"update_status: id={alert_id} not found")
        return None
    alert.status = status
    db.commit()
    db.refresh(alert)
    logger.info(f"Status updated — id={alert_id} new_status={status}")
    return alert
