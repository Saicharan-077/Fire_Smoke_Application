import asyncio
import cv2
import logging
from datetime import datetime
from ..database import SessionLocal
from ..models import Camera, Setting
from ..services.alert_service import create_alert
from ..websocket.connection_manager import manager

logger = logging.getLogger("fireguard.camera_monitor")

# Track consecutive detections per camera to reduce false positives
_consecutive_detections: dict[str, dict[str, int]] = {}
REQUIRED_CONSECUTIVE = 2  # Require 2+ consecutive detections before alerting


async def monitor_cameras_loop(svc):
    logger.info("[Monitor] Starting continuous camera monitoring task")
    while True:
        try:
            loop = asyncio.get_event_loop()
            
            def check_all_cameras():
                global _consecutive_detections
                db = SessionLocal()
                active_alerts_to_send = []
                try:
                    # 1. Fetch settings
                    settings = {s.id: s.value for s in db.query(Setting).all()}
                    
                    # 2. Get active cameras
                    cameras = db.query(Camera).filter(Camera.status == "online").all()
                    
                    for cam in cameras:
                        if not cam.stream_url or "webcam" in cam.name.lower() or cam.id == "webcam-01":
                            continue
                        
                        # Initialize consecutive tracker for this camera
                        if cam.id not in _consecutive_detections:
                            _consecutive_detections[cam.id] = {"fire": 0, "smoke": 0}
                            
                        # Extract single frame
                        cap = cv2.VideoCapture(cam.stream_url)
                        if not cap.isOpened():
                            cap.release()
                            # Reset counters when camera disconnects
                            _consecutive_detections[cam.id] = {"fire": 0, "smoke": 0}
                            continue
                        ret, frame = cap.read()
                        cap.release()
                        
                        if not ret or frame is None:
                            _consecutive_detections[cam.id] = {"fire": 0, "smoke": 0}
                            continue
                            
                        # Run inference
                        annotated, detections, did_infer = svc.infer_frame(frame, cam.id)
                        if not did_infer:
                            continue

                        detected_types = {d["detection_type"] for d in detections}
                        
                        # Update consecutive counters
                        for cls in ("fire", "smoke"):
                            if cls in detected_types:
                                _consecutive_detections[cam.id][cls] += 1
                            else:
                                _consecutive_detections[cam.id][cls] = 0
                        
                        # Only alert if we have enough consecutive detections
                        confirmed_detections = []
                        for d in detections:
                            cls = d["detection_type"]
                            if _consecutive_detections[cam.id].get(cls, 0) >= REQUIRED_CONSECUTIVE:
                                confirmed_detections.append(d)
                        
                        if confirmed_detections:
                            from ..services.storage_service import save_evidence
                            evidence_path = save_evidence(annotated, prefix="cctv")
                            
                            best = sorted(confirmed_detections, key=lambda d: d["confidence"], reverse=True)[0]
                            alert = create_alert(
                                db,
                                detection_type=best["detection_type"],
                                confidence=best["confidence"],
                                source_type="cctv",
                                camera_id=cam.id,
                                location=cam.name,
                                file_name=None,
                                evidence_path=evidence_path
                            )
                            active_alerts_to_send.append({
                                "id": alert.id,
                                "detection_type": alert.detection_type,
                                "confidence": alert.confidence,
                                "camera_id": alert.camera_id,
                                "location": alert.location,
                                "evidence_path": alert.evidence_path,
                                "timestamp": alert.timestamp.isoformat()
                            })
                            logger.info(
                                f"[Monitor] CONFIRMED {best['detection_type']} on {cam.name} "
                                f"(conf={best['confidence']:.2f}, consecutive={_consecutive_detections[cam.id][best['detection_type']]})"
                            )
                            
                    db.commit()
                except Exception as e:
                    logger.error(f"[Monitor] Error querying cameras: {e}")
                    db.rollback()
                finally:
                    db.close()
                return active_alerts_to_send

            alerts = await loop.run_in_executor(None, check_all_cameras)
            
            for alert in alerts:
                await manager.broadcast({
                    "event": "new_alert",
                    "alert_id": alert["id"],
                    "detection_type": alert["detection_type"],
                    "confidence": alert["confidence"],
                    "camera_id": alert["camera_id"],
                    "location": alert["location"],
                    "evidence_path": alert["evidence_path"],
                    "timestamp": alert["timestamp"]
                })
                
        except Exception as e:
            logger.error(f"[Monitor] Error in background monitoring loop: {e}")
            
        await asyncio.sleep(5)  # Scan interval
