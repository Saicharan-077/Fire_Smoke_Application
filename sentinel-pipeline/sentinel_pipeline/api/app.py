"""
The pipeline's ONLY public surface.

Everything else in ``sentinel_pipeline`` is a private implementation detail.
Nothing outside the pipeline imports Gate, Model, Classifier, Context Engine,
tracking or the scheduler directly -- consumers use this API.

Versioned at /v1 so internal improvements don't break external consumers.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timezone

import cv2
import numpy as np
from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from ..config import settings
from ..contracts import CONTRACT_VERSION
from ..pipeline import Pipeline
from ..scheduler.scheduler import MultiCameraScheduler
from ..storage.alerts import alert_to_dict
from ..storage.models import CameraRecord
from .auth import auth_mode, require_api_key, warn_if_open
from .schemas import CalibrationStart, CameraCreate, ZoneApprove
from .streaming import StreamRegistry

logger = logging.getLogger("sentinel.api")

pipeline: Pipeline | None = None
scheduler: MultiCameraScheduler | None = None
streams = StreamRegistry()
_jobs: dict[str, dict] = {}
# Bounded so a burst of uploads cannot spawn unlimited decoders that all
# contend for the one shared Model.
_job_semaphore = threading.BoundedSemaphore(settings.max_concurrent_jobs)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pipeline, scheduler
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
    )
    logger.info("[API] starting SentinelOS detection pipeline")
    warn_if_open()
    pipeline = Pipeline()
    pipeline.context.load_persisted()
    for cam_id, zone in pipeline.context.zones.by_camera().items():
        if zone.approved:
            pipeline.register_camera(cam_id)
            pipeline.sync_zone_to_gate(cam_id)
    scheduler = MultiCameraScheduler(pipeline, workers=settings.scheduler_workers)
    scheduler.start()
    logger.info("[API] pipeline ready; scheduler running")
    yield
    if scheduler:
        scheduler.stop()
    streams.stop_all()
    logger.info("[API] shutdown complete")


app = FastAPI(
    dependencies=[Depends(require_api_key)],
    title="SentinelOS Detection Pipeline",
    version="1.0.0",
    description=(
        "Standalone fire/smoke detection pipeline. Gate -> Model -> Classifier "
        "-> Context Engine. This API is the only supported integration surface."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_pipeline() -> Pipeline:
    if pipeline is None:
        raise HTTPException(status_code=503, detail="pipeline not ready")
    return pipeline


def get_scheduler() -> MultiCameraScheduler:
    if scheduler is None:
        raise HTTPException(status_code=503, detail="scheduler not ready")
    return scheduler


def _decode(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="could not decode image")
    return frame


# ---------------------------------------------------------------------------
# Health & model info
# ---------------------------------------------------------------------------


@app.get("/v1/health", tags=["status"], dependencies=[])
def health():
    p = get_pipeline()
    h = p.health()
    h["contract_version"] = CONTRACT_VERSION
    h["scheduler_running"] = bool(scheduler and scheduler.running)
    h["scheduler_cameras"] = len(scheduler.registered()) if scheduler else 0
    h["auth"] = auth_mode()
    return h


@app.get("/v1/model/info", tags=["status"])
def model_info():
    """Live model metadata. Consumers must read this, never hardcode a name."""
    return get_pipeline().model.info().as_dict()


@app.get("/v1/contract", tags=["status"])
def contract():
    """The Model -> Classifier contract version and field list."""
    return {
        "contract_version": CONTRACT_VERSION,
        "classifier_input_fields": [
            "track_id", "camera_id", "timestamp", "monotonic_ts", "bbox",
            "cropped_frame_rgb", "cropped_frame_grayscale", "class_raw",
            "confidence_raw", "history", "crop_origin", "crop_padding_ratio",
            "frame_size", "track_age_frames", "track_duration_s",
        ],
        "classifier_output_fields": [
            "track_id", "class", "confidence", "camera_id", "bbox", "timestamp",
        ],
        "raw_classes": ["fire", "smoke", "sparks"],
        "threat_classes": [
            "fire", "white_smoke", "grey_smoke", "black_smoke", "false_positive",
        ],
    }


# ---------------------------------------------------------------------------
# Cameras
# ---------------------------------------------------------------------------


@app.post("/v1/cameras", tags=["cameras"], status_code=201)
def register_camera(body: CameraCreate):
    p = get_pipeline()
    camera_id = str(uuid.uuid4())
    with p.context.alerts.session() as s:
        s.add(
            CameraRecord(
                id=camera_id, name=body.name, source_uri=body.source_uri,
                location=body.location, calibration_state="uncalibrated",
            )
        )
        s.commit()
    p.register_camera(camera_id, forced_override_interval=body.forced_override_interval)
    return {
        "camera_id": camera_id, "name": body.name, "source_uri": body.source_uri,
        "location": body.location, "calibration_state": "uncalibrated",
    }


@app.get("/v1/cameras", tags=["cameras"])
def list_cameras():
    p = get_pipeline()
    with p.context.alerts.session() as s:
        rows = s.query(CameraRecord).all()
        out = []
        for c in rows:
            zone = p.context.zones.get_for_camera(c.id)
            out.append({
                "camera_id": c.id, "name": c.name, "source_uri": c.source_uri,
                "location": c.location, "calibration_state": c.calibration_state,
                "zone_id": zone.zone_id if zone else None,
                "risk_weight": zone.risk_weight if zone else None,
            })
    return out


@app.get("/v1/cameras/{camera_id}/gate", tags=["cameras"])
def gate_stats(camera_id: str):
    """Real Gate telemetry. Never fabricated -- absent means the camera has
    processed no frames yet."""
    s = get_pipeline().gate.stats(camera_id)
    if s is None:
        raise HTTPException(status_code=404, detail="no gate state for this camera yet")
    return s.as_dict()


@app.delete("/v1/cameras/{camera_id}", tags=["cameras"], status_code=204)
def delete_camera(camera_id: str):
    p = get_pipeline()
    if scheduler:
        scheduler.unregister(camera_id)
    streams.stop(camera_id)
    p.gate.reset_camera(camera_id)
    p.tracking.reset_camera(camera_id)
    with p.context.alerts.session() as s:
        rec = s.get(CameraRecord, camera_id)
        if rec:
            s.delete(rec)
            s.commit()
    return None


# ---------------------------------------------------------------------------
# Calibration
# ---------------------------------------------------------------------------


@app.post("/v1/cameras/{camera_id}/calibrate/start", tags=["calibration"])
def calibrate_start(camera_id: str, body: CalibrationStart | None = None):
    p = get_pipeline()
    session = p.context.calibration.start(
        camera_id, window_hours=(body.window_hours if body else None)
    )
    with p.context.alerts.session() as s:
        rec = s.get(CameraRecord, camera_id)
        if rec:
            rec.calibration_state = "calibrating"
            s.commit()
    return {
        "camera_id": camera_id,
        "started_at": session.started_at.isoformat(),
        "window_hours": session.window_hours,
        "note": (
            "Detection and alerting continue normally during calibration. "
            "Only zone-based suppression is unavailable until a zone is approved."
        ),
    }


@app.get("/v1/cameras/{camera_id}/calibrate/suggestion", tags=["calibration"])
def calibrate_suggestion(camera_id: str):
    p = get_pipeline()
    session = p.context.calibration.get(camera_id)
    if session is None:
        raise HTTPException(status_code=404, detail="no calibration session for this camera")
    suggestion = p.context.calibration.suggest(camera_id)
    if suggestion is None:
        return {
            "camera_id": camera_id, "ready": False,
            "observation_count": session.observation_count,
            "elapsed_hours": round(session.elapsed_hours, 3),
            "detail": "not enough observations yet to suggest a containment polygon",
        }
    d = suggestion.as_dict()
    d["ready"] = True
    d["elapsed_hours"] = round(session.elapsed_hours, 3)
    d["window_complete"] = session.is_window_complete
    return d


@app.post("/v1/cameras/{camera_id}/zone", tags=["calibration"])
def approve_zone(camera_id: str, body: ZoneApprove):
    """One-click human approval. The polygon is never applied without this."""
    p = get_pipeline()
    polygon = (
        tuple((int(x), int(y)) for x, y in body.polygon) if body.polygon is not None else None
    )
    zone = p.context.approve_calibration(
        camera_id, body.zone_id,
        risk_weight=body.risk_weight,
        polygon=polygon,
        name=body.name,
        flammable_materials_nearby=body.flammable_materials_nearby,
        designated_activity_allowed=tuple(body.designated_activity_allowed),
        adjacent_camera_ids=tuple(body.adjacent_camera_ids),
    )
    # Propagate the risk tier into the Gate's forced-override interval.
    p.sync_zone_to_gate(camera_id)
    with p.context.alerts.session() as s:
        rec = s.get(CameraRecord, camera_id)
        if rec:
            rec.calibration_state = "calibrated"
            s.commit()
    gate = p.gate.stats(camera_id)
    return {
        "zone": zone.as_dict(),
        "gate_forced_interval_s": gate.forced_interval_s if gate else None,
        "gate_risk_tier": gate.risk_tier if gate else None,
    }


@app.get("/v1/zones", tags=["calibration"])
def list_zones():
    return [z.as_dict() for z in get_pipeline().context.zones.all()]


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------


@app.post("/v1/detect/frame", tags=["detect"])
async def detect_frame(
    camera_id: str = Query(..., description="Registered camera id"),
    apply_gate: bool = Query(
        False, description="Run the Gate. False for one-off images, where motion gating is meaningless."
    ),
    file: UploadFile = File(...),
):
    p = get_pipeline()
    frame = _decode(await file.read())
    outcome = p.process_frame(
        camera_id, frame, source_type="image", bypass_gate=not apply_gate
    )
    return outcome.as_dict()


@app.post("/v1/detect/video", tags=["detect"], status_code=202)
async def detect_video(
    background: BackgroundTasks,
    camera_id: str = Query(...),
    file: UploadFile = File(...),
):
    p = get_pipeline()
    job_id = str(uuid.uuid4())
    data = await file.read()

    tmp = settings.storage.evidence_dir.parent / "uploads"
    tmp.mkdir(parents=True, exist_ok=True)
    path = tmp / f"{job_id}_{file.filename or 'video.mp4'}"
    path.write_bytes(data)

    _jobs[job_id] = {
        "job_id": job_id, "status": "queued", "progress_pct": 0.0,
        "frames_total": 0, "frames_processed": 0, "frames_gated_out": 0,
        "alerts": [], "error": None, "cancel_requested": False,
    }
    background.add_task(_run_video_job, job_id, str(path), camera_id, p)
    return {"job_id": job_id, "status": "queued"}


def _run_video_job(job_id: str, path: str, camera_id: str, p: Pipeline) -> None:
    job = _jobs[job_id]
    if not _job_semaphore.acquire(timeout=300):
        job["status"] = "failed"
        job["error"] = "timed out waiting for a job slot"
        return
    job["status"] = "running"
    try:
        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            raise RuntimeError(f"could not open video: {path}")
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        job["frames_total"] = total
        n = 0
        while True:
            if job.get("cancel_requested"):
                job["status"] = "cancelled"
                cap.release()
                return
            ok, frame = cap.read()
            if not ok:
                break
            n += 1
            outcome = p.process_frame(camera_id, frame, source_type="video")
            job["frames_processed"] = n
            if not outcome.gate_passed:
                job["frames_gated_out"] += 1
            if outcome.alerts:
                job["alerts"].extend(outcome.alerts)
            if total:
                job["progress_pct"] = round(min(100.0, n / total * 100.0), 1)
        cap.release()
        job["status"] = "completed"
        job["progress_pct"] = 100.0
    except Exception as exc:  # noqa: BLE001
        logger.exception("[Job] %s failed", job_id)
        job["status"] = "failed"
        job["error"] = str(exc)
    finally:
        _job_semaphore.release()
        try:
            Path(path).unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass


@app.get("/v1/jobs/{job_id}", tags=["detect"])
def get_job(job_id: str):
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@app.delete("/v1/jobs/{job_id}", tags=["detect"])
def cancel_job(job_id: str):
    """Request cancellation. The worker stops at its next frame boundary."""
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    if job["status"] in ("completed", "failed", "cancelled"):
        return {"job_id": job_id, "status": job["status"], "cancelled": False}
    job["cancel_requested"] = True
    return {"job_id": job_id, "status": job["status"], "cancelled": True}


@app.get("/v1/jobs", tags=["detect"])
def list_jobs():
    return list(_jobs.values())


# ---------------------------------------------------------------------------
# Camera drift
# ---------------------------------------------------------------------------


@app.post("/v1/cameras/{camera_id}/drift/reference", tags=["calibration"])
async def set_drift_reference(camera_id: str, file: UploadFile = File(...)):
    """Store the calibration-time reference frame for drift checks."""
    p = get_pipeline()
    frame = _decode(await file.read())
    ok = p.context.drift.set_reference(camera_id, frame)
    if not ok:
        raise HTTPException(
            status_code=422,
            detail="reference frame has too few distinct features for drift detection",
        )
    return {"camera_id": camera_id, "reference_stored": True}


@app.post("/v1/cameras/{camera_id}/drift/check", tags=["calibration"])
async def check_drift(camera_id: str, file: UploadFile = File(...)):
    """Compare a current frame against the stored reference.

    Never auto-shifts the zone polygon; a detected shift is flagged for human
    review, since it may also indicate tampering.
    """
    p = get_pipeline()
    frame = _decode(await file.read())
    result = p.context.drift.check(camera_id, frame)
    out = result.as_dict()
    zone = p.context.zones.get_for_camera(camera_id)
    if result.drifted and zone and zone.has_containment:
        out["current_polygon"] = [list(pt) for pt in zone.polygon]
        out["suggested_polygon"] = [
            list(pt) for pt in p.context.drift.shifted_polygon(
                zone.polygon, result.dx, result.dy
            )
        ]
        out["action_required"] = (
            "human review: re-approve the zone via POST /v1/cameras/{id}/zone, "
            "or investigate possible tampering"
        )
    return out


# ---------------------------------------------------------------------------
# Live streaming
# ---------------------------------------------------------------------------


@app.post("/v1/cameras/{camera_id}/stream/start", tags=["stream"])
def stream_start(
    camera_id: str,
    source_uri: str = Query(..., description="RTSP URL, file path, or webcam index"),
    inference_fps: float = Query(4.0, gt=0, le=30),
):
    p = get_pipeline()
    sched = get_scheduler()
    stream = streams.start(
        camera_id, source_uri, p, inference_fps_cap=inference_fps, source_type="stream"
    )
    # The stream supplies frames; the SCHEDULER decides when the Model runs, so
    # Model compute is allocated by priority across all cameras rather than by
    # each stream firing independently.
    sched.register(
        camera_id, stream.frame_supplier, source_type="stream",
        sink=stream.note_inference, gate_interval_s=1.0 / max(1.0, inference_fps * 4),
    )
    return {
        "camera_id": camera_id, "running": stream.running,
        "metrics": stream.metrics.as_dict(),
        "scheduled": camera_id in sched.registered(),
    }


@app.delete("/v1/cameras/{camera_id}/stream", tags=["stream"])
def stream_stop(camera_id: str):
    get_scheduler().unregister(camera_id)
    return {"stopped": streams.stop(camera_id)}


@app.get("/v1/cameras/{camera_id}/stream/metrics", tags=["stream"])
def stream_metrics(camera_id: str):
    s = streams.get(camera_id)
    if s is None:
        raise HTTPException(status_code=404, detail="stream not running")
    return s.metrics.as_dict()


@app.get("/v1/cameras/{camera_id}/stream/mjpeg", tags=["stream"])
def stream_mjpeg(camera_id: str):
    """MJPEG display feed. Renders at display rate, never blocked by inference."""
    s = streams.get(camera_id)
    if s is None:
        raise HTTPException(status_code=404, detail="stream not running")

    def generate():
        boundary = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
        interval = 1.0 / 30.0
        import time as _t

        while s.running:
            frame = s.display_frame()
            if frame is None:
                _t.sleep(0.02)
                continue
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if ok:
                yield boundary + buf.tobytes() + b"\r\n"
            _t.sleep(interval)

    return StreamingResponse(
        generate(), media_type="multipart/x-mixed-replace; boundary=frame"
    )


@app.websocket("/v1/stream/{camera_id}")
async def stream_ws(websocket: WebSocket, camera_id: str):
    """Subscribe to live detection results for a registered camera."""
    await websocket.accept()
    s = streams.get(camera_id)
    if s is None:
        await websocket.send_json({"event": "error", "detail": "stream not running"})
        await websocket.close()
        return

    last_sent: dict | None = None
    try:
        while s.running:
            result = s.latest_result()
            payload = {
                "event": "stream_update",
                "camera_id": camera_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "metrics": s.metrics.as_dict(),
                "result": result,
            }
            if payload != last_sent:
                await websocket.send_json(payload)
                last_sent = payload
            await asyncio.sleep(0.25)
    except WebSocketDisconnect:
        logger.info("[WS] client disconnected camera=%s", camera_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[WS] error camera=%s: %s", camera_id, exc)


# ---------------------------------------------------------------------------
# Alerts, incidents, evidence
# ---------------------------------------------------------------------------


@app.get("/v1/scheduler", tags=["scheduler"])
def scheduler_state():
    """Live scheduler + priority-queue telemetry. Real values only."""
    return get_scheduler().as_dict()


@app.get("/v1/scheduler/queue", tags=["scheduler"])
def scheduler_queue():
    """Current queue contents in priority order."""
    sched = get_scheduler()
    return {"stats": sched.queue_stats(), "pending": sched.queue_snapshot()}


@app.get("/v1/alerts", tags=["alerts"])
def list_alerts(
    camera_id: str | None = None,
    severity: str | None = None,
    incident_id: str | None = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    rows = get_pipeline().context.alerts.list(
        camera_id=camera_id, severity=severity, incident_id=incident_id,
        limit=limit, offset=offset,
    )
    return [alert_to_dict(a) for a in rows]


@app.get("/v1/alerts/{alert_id}", tags=["alerts"])
def get_alert(alert_id: str):
    a = get_pipeline().context.alerts.get(alert_id)
    if a is None:
        raise HTTPException(status_code=404, detail="alert not found")
    return alert_to_dict(a)


@app.get("/v1/incidents", tags=["alerts"])
def list_incidents(active_only: bool = True):
    r = get_pipeline().context.incidents
    return [i.as_dict() for i in (r.active() if active_only else r.all())]


@app.get("/v1/evidence/{filename}", tags=["alerts"])
def get_evidence(filename: str):
    path = get_pipeline().context.evidence.resolve(filename)
    if path is None:
        raise HTTPException(status_code=404, detail="evidence not found")
    return FileResponse(str(path), media_type="image/jpeg")


def run() -> None:
    import uvicorn

    uvicorn.run(app, host=settings.api_host, port=settings.api_port)


if __name__ == "__main__":
    run()
