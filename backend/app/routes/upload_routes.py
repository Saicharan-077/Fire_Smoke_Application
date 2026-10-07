"""
Upload routes — /api/v1/upload
"""
import cv2
import logging
import numpy as np
import tempfile
import os
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..routes.auth_routes import get_current_user, require_operator
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
    if not _detection_svc.ready:
        raise HTTPException(
            status_code=503,
            detail="Detection model not loaded. Place fire/smoke YOLO weights at models/best.pt",
        )
    return _detection_svc


async def _read_upload_with_limit(file: UploadFile, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=413, detail=f"File too large. Max {max_bytes // (1024 * 1024)}MB.")
        chunks.append(chunk)
    return b"".join(chunks)


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
                "timestamp": (alert.timestamp.isoformat() + "Z") if alert.timestamp and not alert.timestamp.isoformat().endswith("Z") else (alert.timestamp.isoformat() if alert.timestamp else None),
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


MAX_IMAGE_SIZE = 20 * 1024 * 1024
MAX_VIDEO_SIZE = 200 * 1024 * 1024


# ── Image upload ──────────────────────────────────────────────────────────────
@router.post("/image", response_model=schemas.ImageUploadResponse, dependencies=[Depends(require_operator)])
async def upload_image(
    file: UploadFile = File(...),
    source_id: str | None = None,
    db: Session = Depends(get_db),
    svc: DetectionService = Depends(get_detection_svc),
):
    logger.info(f"Image received: {file.filename} (source: {source_id})")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".bmp", ".webp"]:
        raise HTTPException(
            status_code=400,
            detail="Unsupported image format. Allowed: JPG, JPEG, PNG, BMP, WEBP.",
        )

    data = await _read_upload_with_limit(file, MAX_IMAGE_SIZE)

    arr = np.frombuffer(data, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image file")

    logger.debug(f"Decoded shape: {frame.shape}")
    if source_id:
        annotated, detections, did_infer = svc.infer_frame(frame, source_id)
        if not did_infer:
            return schemas.ImageUploadResponse(
                detections=[], alert_ids=[], evidence_path=None, file_name=file.filename
            )
    else:
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
@router.post("/video", response_model=schemas.VideoUploadResponse, dependencies=[Depends(require_operator)])
async def upload_video(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    svc: DetectionService = Depends(get_detection_svc),
):
    logger.info(f"Video received: {file.filename}")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".mp4", ".avi", ".mov", ".mkv", ".webm"]:
        raise HTTPException(
            status_code=400,
            detail="Unsupported video format. Allowed: MP4, AVI, MOV, MKV, WEBM.",
        )

    video_data = await _read_upload_with_limit(file, MAX_VIDEO_SIZE)

    suffix = ext or ".mp4"
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

    # Prepare annotated output video path
    import uuid as _uuid
    from datetime import datetime as _dt
    ts = _dt.utcnow().strftime("%Y%m%d_%H%M%S")
    uid = _uuid.uuid4().hex[:6]
    evidence_dir = os.path.join(os.path.dirname(__file__), "..", "..", "evidence")
    os.makedirs(evidence_dir, exist_ok=True)
    out_video_filename = f"vid_annotated_{ts}_{uid}.mp4"
    out_video_path = os.path.join(evidence_dir, out_video_filename)
    out_video_rel = f"/evidence/{out_video_filename}"

    events_out = []
    video_info = None
    detection_summary = None
    event_statistics = None
    timeline = []
    best_frames: dict = {}
    all_detections = []

    try:
        db_settings = svc._load_db_settings()
        for update in svc.layer.detect_video_stream(
            tmp_path,
            db_settings=db_settings,
            output_video_path=out_video_path,
            mode="Real-Time",
        ):
            if update.get("event") == "video_analysis_completed":
                video_info = update.get("video_info")
                detection_summary = update.get("detection_summary")
                event_statistics = update.get("event_statistics")
                timeline = update.get("timeline")
                continue

            dets = update.get("detections", [])
            f_num = update.get("frame_number", 0)
            preview_b64 = update.get("preview_b64")

            if not dets:
                continue

            for d in dets:
                cls_type = d["detection_type"]
                conf = d["confidence"]

                if cls_type not in best_frames or conf > max(bd["confidence"] for bd in best_frames[cls_type]["detections"]):
                    best_frames[cls_type] = {
                        "frame_num": f_num,
                        "detections": dets,
                        "preview_b64": preview_b64,
                    }

            all_detections.append({
                "frame_num": f_num,
                "timestamp_sec": update.get("timestamp_sec", 0.0),
                "detections": dets,
            })

        created_alerts: dict = {}
        for cls_type, best_info in best_frames.items():
            ev_img_bytes = base64.b64decode(best_info["preview_b64"]) if best_info.get("preview_b64") else None
            evidence_path = None
            if ev_img_bytes:
                ev_name = f"vid_{cls_type}_best_{uid}.jpg"
                ev_abs = os.path.join(evidence_dir, ev_name)
                with open(ev_abs, "wb") as f:
                    f.write(ev_img_bytes)
                evidence_path = f"/evidence/{ev_name}"

            best_conf = max(d["confidence"] for d in best_info["detections"] if d["detection_type"] == cls_type)
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
            f_num = item["frame_num"]
            for d in item["detections"]:
                c_type = d["detection_type"]
                assoc_alert = created_alerts.get(c_type)
                if not assoc_alert:
                    continue

                is_peak = (f_num == best_frames.get(c_type, {}).get("frame_num"))
                ev_path = assoc_alert.evidence_path if is_peak else None

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
                    "confidence":     d["confidence"],
                    "evidence_path":  ev_path,
                })

    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    annotated_path = out_video_rel if (os.path.exists(out_video_path) and os.path.getsize(out_video_path) > 0) else None

    logger.info(f"Video done — {len(events_out)} event(s), annotated_video={annotated_path}")
    return schemas.VideoUploadResponse(
        total_events=len(events_out),
        events=events_out,
        file_name=file.filename,
        annotated_video_path=annotated_path,
        has_detections=len(events_out) > 0,
        detection_summary=detection_summary if detection_summary else {
            cls: len([e for e in events_out if e["detection_type"] == cls])
            for cls in set(e["detection_type"] for e in events_out)
        },
        video_info=video_info,
        event_statistics=event_statistics,
        timeline=timeline,
    )


# ── Asynchronous Streaming Video Upload & Control ──────────────────────────────
import asyncio
import uuid as _uuid
import base64
from datetime import datetime as _dt

active_video_jobs: dict = {}
job_subscribers: dict = {}
mjpeg_queues: dict = {}  # job_id -> asyncio.Queue of raw JPEG bytes for MJPEG streaming
job_semaphore = asyncio.Semaphore(2)  # Max 2 concurrent heavy video inference workers


def register_job_subscriber(job_id: str, ws):
    if job_id not in job_subscribers:
        job_subscribers[job_id] = []
    if ws not in job_subscribers[job_id]:
        job_subscribers[job_id].append(ws)


def unregister_job_subscriber(job_id: str, ws):
    if job_id in job_subscribers and ws in job_subscribers[job_id]:
        job_subscribers[job_id].remove(ws)


async def notify_job_subscribers(job_id: str, message: dict):
    if job_id in job_subscribers:
        import json
        subscribers = list(job_subscribers[job_id])
        msg_str = json.dumps(message)
        for ws in subscribers:
            try:
                await ws.send_text(msg_str)
            except Exception:
                unregister_job_subscriber(job_id, ws)


async def _run_video_job_task(job_id: str, tmp_path: str, filename: str, mode: str = "Real-Time"):
    from ..database import SessionLocal
    db = SessionLocal()
    
    # Acquire concurrency semaphore
    async with job_semaphore:
        try:
            svc = get_detection_svc()
            evidence_dir = os.path.join(os.path.dirname(__file__), "..", "..", "evidence")
            thumb_dir = os.path.join(evidence_dir, "thumbnails")
            os.makedirs(evidence_dir, exist_ok=True)
            os.makedirs(thumb_dir, exist_ok=True)

            out_video_filename = f"vid_async_{job_id}.mp4"
            out_video_path = os.path.join(evidence_dir, out_video_filename)
            out_video_rel = f"/evidence/{out_video_filename}"

            thumb_filename = f"thumb_{job_id}.jpg"
            thumb_path = os.path.join(thumb_dir, thumb_filename)
            thumb_rel = f"/evidence/thumbnails/{thumb_filename}"

            job = active_video_jobs.get(job_id)
            if not job:
                return

            # Create per-job MJPEG queue (maxsize=8 to cap memory, oldest frames dropped if slow consumer)
            mjpeg_q: asyncio.Queue = asyncio.Queue(maxsize=8)
            mjpeg_queues[job_id] = mjpeg_q

            job["status"] = "processing"
            job["mode"] = mode
            all_detections = []
            best_confidence = 0.0
            best_frame_b64 = None
            final_summary_stats = None
            final_timeline = []
            final_video_info = None
            final_detection_summary = None

            def is_cancelled():
                j = active_video_jobs.get(job_id)
                return j.get("cancelled", False) if j else False

            loop = asyncio.get_running_loop()
            async_queue = asyncio.Queue()

            def sync_video_worker():
                try:
                    for update in svc.layer.detect_video_stream(
                        tmp_path,
                        db_settings=svc._load_db_settings(),
                        output_video_path=out_video_path,
                        cancel_check_func=is_cancelled,
                        mode=mode,
                    ):
                        if is_cancelled():
                            break
                        loop.call_soon_threadsafe(async_queue.put_nowait, update)
                except Exception as exc:
                    logger.error(f"[SyncVideoWorker] Error: {exc}")
                finally:
                    loop.call_soon_threadsafe(async_queue.put_nowait, {"__done__": True})

            # Run heavy CPU OpenCV/YOLO inference in separate background thread
            asyncio.create_task(asyncio.to_thread(sync_video_worker))

            while True:
                update = await async_queue.get()
                if update.get("__done__"):
                    break

                if is_cancelled():
                    job["status"] = "cancelled"
                    await notify_job_subscribers(job_id, {"event": "cancelled", "type": "cancelled", "job_id": job_id})
                    break

                if update.get("event") == "video_analysis_completed":
                    final_summary_stats = update.get("event_statistics")
                    final_timeline = update.get("timeline")
                    final_video_info = update.get("video_info")
                    final_detection_summary = update.get("detection_summary")
                    continue

                job["progress_pct"] = update["progress_pct"]
                job["fps"] = update["fps"]
                job["source_fps"] = update.get("source_fps", 25.0)
                job["inference_fps"] = update.get("inference_fps", update["fps"])
                job["avg_latency_ms"] = update.get("avg_latency_ms", 0.0)
                job["skipped_frames"] = update.get("skipped_frames", 0)
                job["active_tracks_count"] = update.get("active_tracks_count", 0)
                job["eta_sec"] = update["eta_sec"]
                job["current_frame"] = update["frame_number"]
                job["total_frames"] = update["total_frames"]
                job["latest_preview"] = update["preview_b64"]
                job["composite_state"] = update.get("composite_state", "NORMAL")

                # Enqueue annotated JPEG frame for MJPEG stream (non-blocking, drop if queue full)
                raw_jpeg = update.pop("annotated_jpeg", None)
                if raw_jpeg:
                    try:
                        mjpeg_q.put_nowait(raw_jpeg)
                    except asyncio.QueueFull:
                        pass  # Drop frame if consumer is slow

                dets = update.get("detections", [])
                if dets:
                    job["has_detections"] = True
                    cls_type = dets[0]["detection_type"]
                    max_conf = max(d["confidence"] for d in dets)

                    if max_conf > best_confidence and update.get("preview_b64"):
                        best_confidence = max_conf
                        best_frame_b64 = update["preview_b64"]

                    all_detections.append({
                        "frame_number": update["frame_number"],
                        "timestamp_sec": update["timestamp_sec"],
                        "detection_type": cls_type,
                        "confidence": max_conf,
                        "detections": dets
                    })

                if update.get("early_threat"):
                    threat_type = update["early_threat"]
                    alert = create_alert(
                        db,
                        detection_type=threat_type,
                        confidence=max(d["confidence"] for d in dets) if dets else 0.85,
                        source_type="video_stream",
                        camera_id="CAM-STREAM",
                        location="Video Stream",
                        file_name=filename,
                        frame_number=update["frame_number"],
                    )
                    await _broadcast(db, alert.id, threat_type, alert.confidence, camera_id="CAM-STREAM", location="Video Stream")

                await notify_job_subscribers(job_id, update)
                await asyncio.sleep(0.001)

            if job["status"] != "cancelled":
                # Write snapshot thumbnail if available
                thumbnail_path = None
                if best_frame_b64:
                    try:
                        img_bytes = base64.b64decode(best_frame_b64)
                        with open(thumb_path, "wb") as f:
                            f.write(img_bytes)
                        thumbnail_path = thumb_rel
                    except Exception as e:
                        logger.warning(f"[AsyncVideoJob] Failed to write thumbnail: {e}")

                job["status"] = "completed"
                job["progress_pct"] = 100.0
                job["eta_sec"] = 0.0
                job["events"] = all_detections
                job["thumbnail_path"] = thumbnail_path
                job["annotated_video_path"] = out_video_rel if (os.path.exists(out_video_path) and os.path.getsize(out_video_path) > 0) else None

                summary = {}
                for d in all_detections:
                    c = d["detection_type"]
                    summary[c] = summary.get(c, 0) + 1
                job["summary"] = final_detection_summary or summary
                job["video_info"] = final_video_info or job.get("metadata")
                job["detection_summary"] = final_detection_summary or summary
                job["event_statistics"] = final_summary_stats
                job["timeline"] = final_timeline

                completion_msg = {
                    "event": "completed",
                    "type": "completed",
                    "job_id": job_id,
                    "status": "completed",
                    "progress_pct": 100.0,
                    "has_detections": job["has_detections"],
                    "summary": job["summary"],
                    "events": all_detections,
                    "thumbnail_path": thumbnail_path,
                    "annotated_video_path": job["annotated_video_path"],
                    "video_info": job["video_info"],
                    "detection_summary": job["detection_summary"],
                    "event_statistics": final_summary_stats,
                    "timeline": final_timeline,
                }
                await notify_job_subscribers(job_id, completion_msg)

        except Exception as exc:
            logger.error(f"[AsyncVideoJob] Job {job_id} error: {exc}")
            if job_id in active_video_jobs:
                active_video_jobs[job_id]["status"] = "failed"
                active_video_jobs[job_id]["error"] = str(exc)
            await notify_job_subscribers(job_id, {"event": "error", "type": "error", "job_id": job_id, "error": str(exc)})
        finally:
            q = mjpeg_queues.get(job_id)
            if q:
                try:
                    await q.put(None)
                except Exception:
                    pass
            db.close()
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


@router.post("/video_async", dependencies=[Depends(require_operator)])
async def upload_video_async(
    file: UploadFile = File(...),
    mode: str = Query("Real-Time", description="Processing mode: Real-Time | Accuracy | Debug"),
    svc: DetectionService = Depends(get_detection_svc),
):
    """Starts immediate background video prediction job and returns Job ID and Video Metadata immediately."""
    logger.info(f"Async Video Upload received: {file.filename} (mode={mode})")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".mp4", ".avi", ".mov", ".mkv", ".webm"]:
        raise HTTPException(
            status_code=400,
            detail="Unsupported video format. Allowed: MP4, AVI, MOV, MKV, WEBM.",
        )

    video_data = await _read_upload_with_limit(file, MAX_VIDEO_SIZE)

    job_id = _uuid.uuid4().hex[:10]
    suffix = ext or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(video_data)
        tmp_path = tmp.name

    # Extract deterministic video metadata immediately
    meta = svc.layer.extract_video_metadata(tmp_path)

    active_video_jobs[job_id] = {
        "job_id": job_id,
        "filename": file.filename,
        "status": "pending",
        "mode": mode,
        "metadata": meta,
        "video_info": meta,
        "detection_summary": None,
        "event_statistics": None,
        "timeline": [],
        "progress_pct": 0.0,
        "fps": 0.0,
        "source_fps": meta.get("fps", 25.0),
        "inference_fps": 0.0,
        "avg_latency_ms": 0.0,
        "skipped_frames": 0,
        "active_tracks_count": 0,
        "eta_sec": 0.0,
        "current_frame": 0,
        "total_frames": meta.get("total_frames", 0),
        "has_detections": False,
        "cancelled": False,
        "events": [],
        "latest_preview": None,
        "thumbnail_path": None,
        "annotated_video_path": None,
        "summary": None,
        "created_at": _dt.utcnow().isoformat(),
    }

    # Launch background task
    asyncio.create_task(_run_video_job_task(job_id, tmp_path, file.filename, mode=mode))

    return {
        "job_id": job_id,
        "status": "processing",
        "file_name": file.filename,
        "mode": mode,
        "metadata": meta,
        "message": f"Video analysis started ({meta.get('width', 0)}x{meta.get('height', 0)} @ {meta.get('fps', 0)} FPS, {meta.get('total_frames', 0)} frames).",
    }


@router.get("/video_job/{job_id}")
def get_video_job_status(job_id: str):
    """Retrieves current job processing status."""
    job = active_video_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job ID not found")
    return job


@router.delete("/video_job/{job_id}", dependencies=[Depends(require_operator)])
def cancel_video_job(job_id: str):
    """Cancels an ongoing asynchronous video processing job."""
    job = active_video_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job ID not found")

    job["cancelled"] = True
    job["status"] = "cancelled"
    logger.info(f"[VideoJob] Cancel requested for job {job_id}")
    return {"job_id": job_id, "status": "cancelled", "message": "Job cancellation requested successfully."}



