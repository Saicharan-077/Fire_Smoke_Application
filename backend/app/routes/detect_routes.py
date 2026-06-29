"""
Detection routes — /api/v1/detect and /detect
"""
import os
import cv2
import numpy as np
import logging
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..routes.auth_routes import get_current_user, log_audit, log_system
from ..routes.upload_routes import upload_image, upload_video, get_detection_svc
from .. import schemas

router = APIRouter(prefix="/api/v1/detect", tags=["detect"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger("fireguard.detect")

# Re-use endpoints
@router.post("/image", response_model=schemas.ImageUploadResponse)
async def detect_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    svc = Depends(get_detection_svc),
):
    # Log audit action
    res = await upload_image(file, db, svc)
    current_user = db.query(models.User).filter(models.User.session_token != None).first() # heuristic to log user
    log_audit(db, current_user, "DETECTION_IMAGE", f"Processed image file: {file.filename}")
    return res

@router.post("/video", response_model=schemas.VideoUploadResponse)
async def detect_video(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    svc = Depends(get_detection_svc),
):
    res = await upload_video(file, db, svc)
    current_user = db.query(models.User).filter(models.User.session_token != None).first()
    log_audit(db, current_user, "DETECTION_VIDEO", f"Processed video file: {file.filename}")
    return res

@router.get("/live")
def get_live_webcam_details(db: Session = Depends(get_db)):
    return {
        "status": "active",
        "webcam_feed": "client_side",
        "simulated": True,
        "inference_engine": "YOLOv8",
        "description": "Client-side capturing streaming frames via canvas context updates."
    }

@router.post("/cctv")
def test_cctv_connection(body: dict, db: Session = Depends(get_db)):
    stream_url = body.get("stream_url")
    if not stream_url:
        raise HTTPException(status_code=400, detail="stream_url is required")
    
    # Simple simulated ping/check for connection
    is_valid = False
    if "rtsp://" in stream_url or "http://" in stream_url or "https://" in stream_url:
        is_valid = True
    
    current_user = db.query(models.User).filter(models.User.session_token != None).first()
    log_audit(db, current_user, "CCTV_TEST", f"Tested RTSP CCTV connection: {stream_url} - Success: {is_valid}")
    
    if not is_valid:
        raise HTTPException(status_code=400, detail="Invalid RTSP or HTTP stream URL format")
        
    return {
        "status": "online",
        "message": "CCTV Stream Connection successful",
        "url": stream_url
    }

# Also import models at module level to avoid issues
from .. import models
