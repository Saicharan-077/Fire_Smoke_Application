"""
Upload routes — /api/v1/upload
"""
import cv2
import logging
import numpy as np
import tempfile
import os
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..routes.auth_routes import get_current_user
from ..ai.inference_service import DetectionService
from ..services.storage_service import save_evidence
from ..services.alert_service import create_alert, create_event
from .. import schemas

router = APIRouter(prefix="/api/v1/upload", tags=["upload"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger("fireguard.upload")

_detection_svc: DetectionService = None
_ws_manager = None


def get_detection_svc() -> DetectionService:
    if _detection_svc is None:
        raise HTTPException(status_code=503, detail="Detection service not ready")
    return _detection_svc


async def _broadcast(
    db: Session,
    alert_id: str,
    detection_type: str,
    confidence: float,
    camera_id: str | None = None,
    location: str | None = None,
):
    if _ws_manager:
        from .. import models
        alert = db.query(models.Alert).filter(models.Alert.id == alert_id).first()
        alert_data = None
        if alert:
            alert_data = {
                "id": alert.id,
                "detection_type": alert.detection_type,
                "confidence": alert.confidence,
                "status": alert.status,
                "source_type": alert.source_type,
                "camera_id": alert.camera_id,
                "location": alert.location,
                "file_name": alert.file_name,
                "evidence_path": alert.evidence_path,
                "frame_number": alert.frame_number,
                "timestamp": alert.timestamp.isoformat() if alert.timestamp else None,
            }
        await _ws_manager.broadcast({
            "event":        "new_alert",
            "alert_id":     alert_id,
            "type":         detection_type,
            "confidence":   confidence,
            "camera_id":    camera_id,
            "location":     location,
            "alert":        alert_data,
        })


# ── Image upload ──────────────────────────────────────────────────────────────
@router.post("/image", response_model=schemas.ImageUploadResponse)
async def upload_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    svc: DetectionService = Depends(get_detection_svc),
):
    logger.info(f"Image received: {file.filename}")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".bmp", ".webp"]:
        raise HTTPException(
            status_code=400,
            detail="Unsupported image format. Allowed: JPG, JPEG, PNG, BMP, WEBP.",
        )

    data = await file.read()
    MAX_IMAGE_SIZE = 20 * 1024 * 1024
    if len(data) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=413, detail="Image too large. Max 20MB.")

    arr = np.frombuffer(data, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image file")

    logger.debug(f"Decoded shape: {frame.shape}")
    annotated, detections = svc.infer_image(frame)
    logger.info(f"Detections: {len(detections)}")

    if not detections:
        return schemas.ImageUploadResponse(
            detections=[], alert_ids=[], evidence_path=None, file_name=file.filename
        )

    # Save original + annotated evidence
    save_evidence(frame, prefix="img_orig")
    evidence_path = save_evidence(annotated, prefix="img")

    # One alert per unique class (best confidence)
    best: dict[str, dict] = {}
    for det in detections:
        t = det["detection_type"]
        if t not in best or det["confidence"] > best[t]["confidence"]:
            best[t] = det

    alerts_created = []
    for cls_type, det in best.items():
        alert = create_alert(
            db,
            detection_type=cls_type,
            confidence=det["confidence"],
            source_type="image",
            camera_id="CAM-UPLOAD",
            location="Upload",
            file_name=file.filename,
            evidence_path=evidence_path,
        )
        alerts_created.append(alert.id)
        logger.info(f"Alert created: id={alert.id} type={cls_type} conf={det['confidence']:.4f}")
        await _broadcast(
            db,
            alert.id,
            cls_type,
            det["confidence"],
            camera_id="CAM-UPLOAD",
            location="Upload",
        )


    # Store every bounding box as an event
    for det in detections:
        alert_id = next(
            (aid for aid, (ct, _) in zip(alerts_created, best.items()) if ct == det["detection_type"]),
            alerts_created[0] if alerts_created else None,
        )
        create_event(
            db, alert_id, det, "image",
            camera_id="CAM-UPLOAD", location="Upload",
            file_name=file.filename, evidence_path=evidence_path,
        )

    logger.info(f"Upload complete — {len(alerts_created)} alert(s)")

    return schemas.ImageUploadResponse(
        detections=detections,
        alert_ids=alerts_created,
        evidence_path=evidence_path,
        file_name=file.filename,
    )


# ── Video upload ──────────────────────────────────────────────────────────────
@router.post("/video", response_model=schemas.VideoUploadResponse)
async def upload_video(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    svc: DetectionService = Depends(get_detection_svc),
):
    logger.info(f"Video received: {file.filename}")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".mp4", ".avi", ".mov", ".mkv"]:
        raise HTTPException(
            status_code=400,
            detail="Unsupported video format. Allowed: MP4, AVI, MOV, MKV.",
        )

    video_data = await file.read()
    MAX_VIDEO_SIZE = 100 * 1024 * 1024
    if len(video_data) > MAX_VIDEO_SIZE:
        raise HTTPException(status_code=413, detail="Video too large. Max 100MB.")

    suffix = os.path.splitext(file.filename)[1] or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(video_data)
        tmp_path = tmp.name

    cap = cv2.VideoCapture(tmp_path)
    if not cap.isOpened():
        cap.release()
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail="Could not decode video file.")
    cap.release()

    events_out = []
    try:
        best_frames = {}
        all_detections = []

        for frame_num, detections, annotated in svc.infer_video(tmp_path):
            if not detections:
                continue
            cls_type = detections[0]["detection_type"]
            max_conf = max(d["confidence"] for d in detections)

            if cls_type not in best_frames or max_conf > max(d["confidence"] for d in best_frames[cls_type]["detections"]):
                best_frames[cls_type] = {
                    "frame_num": frame_num,
                    "detections": detections,
                    "annotated": annotated,
                }

            all_detections.append({
                "frame_num": frame_num,
                "cls_type": cls_type,
                "detections": detections,
            })

        created_alerts = {}
        for cls_type, best_info in best_frames.items():
            evidence_path = save_evidence(best_info["annotated"], prefix=f"vid_{cls_type}_best")
            best_conf = max(d["confidence"] for d in best_info["detections"])
            alert = create_alert(
                db,
                detection_type=cls_type,
                confidence=best_conf,
                source_type="video",
                camera_id="CAM-UPLOAD",
                location="Upload",
                file_name=file.filename,
                evidence_path=evidence_path,
                frame_number=best_info["frame_num"],
            )
            created_alerts[cls_type] = alert
            await _broadcast(
                db,
                alert.id,
                cls_type,
                best_conf,
                camera_id="CAM-UPLOAD",
                location="Upload",
            )

        for item in all_detections:
            c_type = item["cls_type"]
            f_num = item["frame_num"]
            assoc_alert = created_alerts.get(c_type)
            if not assoc_alert:
                continue

            is_peak = (f_num == best_frames[c_type]["frame_num"])
            ev_path = assoc_alert.evidence_path if is_peak else None

            for d in item["detections"]:
                create_event(
                    db, assoc_alert.id, d, "video",
                    camera_id="CAM-UPLOAD", location="Upload",
                    file_name=file.filename, frame_number=f_num,
                    evidence_path=ev_path,
                )

            events_out.append({
                "alert_id":       assoc_alert.id,
                "frame_number":   f_num,
                "detection_type": c_type,
                "confidence":     max(d["confidence"] for d in item["detections"]),
                "evidence_path":  ev_path,
            })

    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    logger.info(f"Video done — {len(events_out)} event(s)")
    return schemas.VideoUploadResponse(
        total_events=len(events_out), events=events_out, file_name=file.filename
    )


# Debug endpoints have been removed from production.
