"""
Detection routes — /api/v1/detect and /detect
"""
import logging
import cv2
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..routes.auth_routes import get_current_user, log_audit
from ..routes.upload_routes import upload_image, upload_video, get_detection_svc
from .. import schemas, models

router = APIRouter(prefix="/api/v1/detect", tags=["detect"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger("fireguard.detect")


class CctvTestRequest(BaseModel):
    stream_url: str


@router.post("/image", response_model=schemas.ImageUploadResponse)
async def detect_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    svc=Depends(get_detection_svc),
    current_user: models.User = Depends(get_current_user),
):
    res = await upload_image(file, db, svc)
    log_audit(db, current_user, "DETECTION_IMAGE", f"Processed image file: {file.filename}")
    return res


@router.post("/video", response_model=schemas.VideoUploadResponse)
async def detect_video(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    svc=Depends(get_detection_svc),
    current_user: models.User = Depends(get_current_user),
):
    res = await upload_video(file, db, svc)
    log_audit(db, current_user, "DETECTION_VIDEO", f"Processed video file: {file.filename}")
    return res


@router.get("/live")
def get_live_webcam_details(current_user: models.User = Depends(get_current_user)):
    from ..routes.upload_routes import _detection_svc
    svc = _detection_svc
    return {
        "status": "active",
        "webcam_feed": "client_side",
        "inference_engine": "YOLOv8",
        "model_ready": bool(svc and svc.ready),
        "device": svc.device if svc else "cpu",
        "description": "Client-side webcam capture with server-side inference on uploaded frames.",
    }


@router.post("/cctv")
def test_cctv_connection(
    body: CctvTestRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    stream_url = body.stream_url.strip()
    if not stream_url.startswith(("rtsp://", "http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid RTSP or HTTP stream URL format")

    is_online = False
    cap = cv2.VideoCapture(stream_url)
    try:
        is_online = cap.isOpened() and cap.read()[0]
    except Exception:
        is_online = False
    finally:
        cap.release()

    log_audit(
        db,
        current_user,
        "CCTV_TEST",
        f"Tested CCTV connection: {stream_url} - Success: {is_online}",
    )

    if not is_online:
        raise HTTPException(status_code=400, detail="Unable to connect to stream URL")

    return {
        "status": "online",
        "message": "CCTV stream connection successful",
        "url": stream_url,
    }
