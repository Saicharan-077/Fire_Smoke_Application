"""
Detection routes — /api/v1/detect and /detect
"""
import logging
import re
import threading
import socket
import cv2
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query, Header
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..routes.auth_routes import get_current_user, log_audit, require_operator, get_user_by_token
from ..routes.upload_routes import upload_image, upload_video, get_detection_svc
from .. import schemas, models
from ..services.alert_service import create_alert, create_event
from ..services.storage_service import save_evidence
import asyncio
import json
import time

# ── RTSP state ────────────────────────────────────────────────────────────────
# Shared dict: url → {fps, latency, active_detections, inference_fps}
# Written by the MJPEG capture loop; read by the SSE telemetry endpoint.
# One cv2.VideoCapture per URL — the telemetry endpoint does NOT open its own.
rtsp_streams: dict = {}

# Debounce: (url, detection_class) → last DB-write timestamp
# Keyed by (camera_source, class) so different cameras never suppress each other.
last_rtsp_alert_time: dict = {}

# Active capture guard: tracks which URLs currently have a running capture loop.
# Prevents a second simultaneous cv2.VideoCapture when "Connect" is clicked
# again while the old MJPEG stream is still running.
_active_rtsp_captures: set = set()

RTSP_DEBOUNCE_SEC = 10.0  # seconds between DB alert writes per (url, class)

router = APIRouter(prefix="/api/v1/detect", tags=["detect"])

logger = logging.getLogger("fireguard.detect")


def _require_stream_auth(
    token: str = Query(None),
    authorization: str = Header(None),
    db: Session = Depends(get_db),
) -> models.User:
    """
    Auth dependency for streaming endpoints (MJPEG img + SSE EventSource).
    Browser img tags and EventSource cannot send Authorization headers, so
    we accept the session token as a ?token= query param as a fallback.
    Priority: Authorization header > ?token query param.
    """
    raw_token = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization.split(" ", 1)[1]
    elif token:
        raw_token = token

    if not raw_token:
        raise HTTPException(status_code=401, detail="Authentication required for stream access")

    user = get_user_by_token(raw_token, db)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session token")
    return user


# ── Helpers ───────────────────────────────────────────────────────────────────

_VALID_RTSP_SCHEMES = {"rtsp", "rtsps", "http", "https"}

# Basic URL pattern: must start with a supported scheme and have a host
_URL_RE = re.compile(
    r"^(rtsp|rtsps|http|https)://"   # scheme
    r"([a-zA-Z0-9._\-]+|\[[\da-fA-F:]+\])"  # host or IPv6
    r"(:\d{1,5})?"                    # optional port
    r"(/.*)?$",                        # optional path
    re.IGNORECASE,
)


def _validate_stream_url(url: str) -> str:
    """
    Validates a camera stream URL.

    Accepts rtsp://, rtsps://, http://, https:// URLs with a non-empty host.
    Raises HTTPException(400) on any validation failure.

    NOTE: This app is intended for LAN use. If ever exposed beyond LAN, add
    an allowlist of permitted IP ranges/hostnames before calling this function.
    """
    url = url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Stream URL must not be empty")

    parsed = urlparse(url)
    scheme = (parsed.scheme or "").lower()

    if scheme not in _VALID_RTSP_SCHEMES:
        raise HTTPException(
            status_code=400,
            detail="Invalid URL scheme '{}'. Expected one of: rtsp, rtsps, http, https".format(scheme),
        )

    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="Stream URL must contain a hostname or IP address")

    if not _URL_RE.match(url):
        raise HTTPException(status_code=400, detail="Malformed stream URL")

    return url


class CctvTestRequest(BaseModel):
    stream_url: str


# ── Image / Video detection ───────────────────────────────────────────────────

@router.post("/image", response_model=schemas.ImageUploadResponse, dependencies=[Depends(require_operator)])
async def detect_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    svc=Depends(get_detection_svc),
    current_user: models.User = Depends(get_current_user),
):
    res = await upload_image(file=file, db=db, svc=svc)
    log_audit(db, current_user, "DETECTION_IMAGE", "Processed image file: {}".format(file.filename))
    return res


@router.post("/video", response_model=schemas.VideoUploadResponse, dependencies=[Depends(require_operator)])
async def detect_video(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    svc=Depends(get_detection_svc),
    current_user: models.User = Depends(get_current_user),
):
    res = await upload_video(file=file, db=db, svc=svc)
    log_audit(db, current_user, "DETECTION_VIDEO", "Processed video file: {}".format(file.filename))
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


# ── CCTV reachability probe ────────────────────────────────────────────────────

@router.post("/cctv", dependencies=[Depends(require_operator)])
def test_cctv_connection(
    body: CctvTestRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    stream_url = _validate_stream_url(body.stream_url)

    is_online = False
    
    # TODO: Real RTSP camera support (via system ffmpeg) is deferred.
    # OpenCV's bundled FFmpeg fails on IP Webcam RTSP/SDP streams natively.
    # We are currently using HTTP MJPEG endpoints (http://.../video) as a fallback,
    # which works perfectly with the existing cv2.VideoCapture pipeline.
    # Pre-check reachability via socket to avoid OpenCV indefinite hang
    parsed_url = urlparse(stream_url)
    host = parsed_url.hostname
    port = parsed_url.port or (443 if parsed_url.scheme in ('https', 'rtsps') else (554 if parsed_url.scheme == 'rtsp' else 80))
    
    # Check if the host is reachable within a short timeout
    try:
        with socket.create_connection((host, port), timeout=3.0):
            pass # Socket connected successfully
    except (socket.timeout, ConnectionRefusedError, OSError) as e:
        logger.error(f"[RTSP] Socket pre-check failed for {stream_url}: {e}")
        log_audit(
            db,
            current_user,
            "CCTV_TEST",
            "Tested CCTV connection: {} - Success: False".format(stream_url),
        )
        raise HTTPException(status_code=400, detail="Stream URL is unreachable (connection timeout/refused)")

    # If reachable, proceed with OpenCV frame read to verify valid media stream
    cap = cv2.VideoCapture(stream_url)
    try:
        is_online = cap.isOpened() and cap.read()[0]
        if not is_online:
            logger.error(f"[RTSP] Probe failed for {stream_url}. cap.isOpened(): {cap.isOpened()}")
    except Exception as e:
        logger.error(f"[RTSP] Probe exception for {stream_url}: {e}", exc_info=True)
        is_online = False
    finally:
        cap.release()

    log_audit(
        db,
        current_user,
        "CCTV_TEST",
        "Tested CCTV connection: {} - Success: {}".format(stream_url, is_online),
    )

    if not is_online:
        raise HTTPException(status_code=400, detail="Unable to connect to stream URL")

    return {
        "status": "online",
        "message": "CCTV stream connection successful",
        "url": stream_url,
    }


# ── RTSP MJPEG streaming endpoint ─────────────────────────────────────────────

@router.get("/rtsp/stream", dependencies=[])
async def rtsp_stream(
    url: str,
    db: Session = Depends(get_db),
    svc=Depends(get_detection_svc),
    _user: models.User = Depends(_require_stream_auth),
):
    """
    Streams annotated RTSP/IP-camera frames as MJPEG.

    Architecture notes
    ------------------
    - ONE cv2.VideoCapture per URL.  If a stream for this URL is already
      running (client double-clicked Connect), the old one is torn down
      first via the _active_rtsp_captures guard, then a fresh capture is
      opened.  This prevents orphaned connections piling up on the camera.
    - The rtsp_streams dict is updated on EVERY inference cycle so the
      /rtsp/telemetry SSE can read real-time values without a separate
      capture.  Debounce ONLY gates DB writes.
    - On client disconnect or StreamingResponse cancellation the finally
      block releases the capture and removes the URL from all tracking dicts.

    LAN security note: RTSP URLs are validated before reaching cv2. If this
    app is ever exposed beyond LAN, add an IP-range allowlist to
    _validate_stream_url().
    """
    validated_url = _validate_stream_url(url)

    # Orphan guard: if there is already a live capture for this URL,
    # signal it to stop by removing it from the active set.  The old
    # generator's finally block will clean up within one frame cycle.
    if validated_url in _active_rtsp_captures:
        logger.warning(
            "[RTSP] A capture loop for %s is already active. "
            "Removing from registry so the old loop self-terminates on its next frame.",
            validated_url,
        )
        _active_rtsp_captures.discard(validated_url)
        # Give the old loop one event-loop iteration to notice and release
        await asyncio.sleep(0.15)

    async def generate():
        """
        Decoupled three-component RTSP streaming architecture
        -------------------------------------------------------
        1. _reader_thread: Reads frames from cap.read() at the native camera
           rate and stores ONLY the latest frame in a shared slot.  Old frames
           are silently dropped — no queue buildup, no latency drift.

        2. _inference_thread: Samples the shared frame slot at ≤3fps.  Always
           operates on the most recent frame; stale frames are never processed.
           Writes annotated frames and detections to a second shared slot.

        3. async MJPEG yielder (this coroutine): Runs at ≤30fps, picking up
           the annotated frame when available (falls back to raw frame).
           Stream FPS and Infer FPS are tracked as completely independent
           metrics.
        """
        logger.info(f"[RTSP] Attempting to open VideoCapture for {validated_url}")
        cap = cv2.VideoCapture(validated_url)
        if not cap.isOpened():
            logger.error("[RTSP] Failed to open stream: %s", validated_url)
            return

        logger.info(f"[RTSP] cap.isOpened() = True for {validated_url}")
        _active_rtsp_captures.add(validated_url)
        rtsp_streams[validated_url] = {
            "fps": 0.0,
            "latency": 0.0,
            "active_detections": [],
            "inference_fps": 0.0,
        }

        # ── Shared state ─────────────────────────────────────────────────────
        # Each slot is a single-element list so threads can replace contents
        # without re-binding the reference (avoids a lock on every read).
        _frame_lock = threading.Lock()
        _raw_slot = [None]          # latest raw frame from cap.read()
        _ann_lock = threading.Lock()
        _ann_slot = [None]          # latest annotated frame from inference
        _det_slot = [[]]            # latest detections list
        _stop = threading.Event()   # signals both threads to exit
        _failures = [0]
        MAX_FAILURES = 30
        INFER_TARGET_FPS = 3.0      # max inference rate

        # ── Thread 1: native-rate frame reader ───────────────────────────────
        def _reader_thread():
            first = True
            while not _stop.is_set() and validated_url in _active_rtsp_captures:
                ret, frame = cap.read()
                if not ret:
                    _failures[0] += 1
                    if _failures[0] >= MAX_FAILURES:
                        logger.info("[RTSP] Reader: %d consecutive failures, giving up: %s",
                                    MAX_FAILURES, validated_url)
                        _stop.set()
                        break
                    time.sleep(0.05)
                    continue
                _failures[0] = 0
                if first:
                    logger.info("[RTSP] First frame: shape=%s dtype=%s", frame.shape, frame.dtype)
                    first = False
                with _frame_lock:
                    _raw_slot[0] = frame   # always replace — never queue

        # ── Thread 2: capped-rate inference ──────────────────────────────────
        def _inference_thread():
            infer_interval = 1.0 / INFER_TARGET_FPS
            last_infer_ts = 0.0
            infer_count = 0
            infer_fps_window_ts = time.time()
            last_latency_ms = 0.0

            while not _stop.is_set() and validated_url in _active_rtsp_captures:
                now = time.time()
                if now - last_infer_ts < infer_interval:
                    time.sleep(0.01)
                    continue

                with _frame_lock:
                    frame = _raw_slot[0]
                if frame is None:
                    time.sleep(0.05)
                    continue

                last_infer_ts = now
                t0 = time.time()
                try:
                    annotated, detections, _ = svc.infer_frame(frame.copy(), validated_url)
                except Exception as infer_err:
                    logger.error("[RTSP] Inference error: %s", infer_err)
                    continue
                last_latency_ms = (time.time() - t0) * 1000

                with _ann_lock:
                    _ann_slot[0] = annotated
                    _det_slot[0] = detections

                infer_count += 1
                elapsed = time.time() - infer_fps_window_ts
                if elapsed >= 1.0:
                    infer_fps = infer_count / elapsed
                    infer_count = 0
                    infer_fps_window_ts = time.time()
                    # Update telemetry — separate from stream FPS
                    if validated_url in rtsp_streams:
                        rtsp_streams[validated_url]["inference_fps"] = round(infer_fps, 1)
                        rtsp_streams[validated_url]["latency"] = round(last_latency_ms, 1)

                # ── DB alert + evidence writes (debounced) ────────────────
                if detections:
                    db_settings = svc._load_db_settings()
                    alert_ts = time.time()
                    for det in detections:
                        cls_type = det["detection_type"]
                        conf = det["confidence"]
                        min_conf = db_settings.get("{}_min_confidence".format(cls_type), 0.5)
                        if conf < min_conf:
                            continue

                        debounce_key = (validated_url, cls_type)
                        last_time = last_rtsp_alert_time.get(debounce_key, 0)

                        if alert_ts - last_time >= RTSP_DEBOUNCE_SEC:
                            last_rtsp_alert_time[debounce_key] = alert_ts
                            try:
                                # Save evidence snapshot (Issue 2)
                                evidence_path = None
                                try:
                                    evidence_path = save_evidence(annotated, prefix="rtsp")
                                except Exception as ev_err:
                                    logger.warning("[RTSP] Evidence save failed: %s", ev_err)

                                alert = create_alert(
                                    db,
                                    detection_type=cls_type,
                                    confidence=conf,
                                    source_type="stream",
                                    camera_id=validated_url,
                                    location="RTSP Stream",
                                    file_name=evidence_path or validated_url,
                                )
                                create_event(
                                    db,
                                    alert.id,
                                    det,
                                    source_type="stream",
                                    camera_id=validated_url,
                                    location="RTSP Stream",
                                    file_name=evidence_path or validated_url,
                                )
                            except Exception as db_err:
                                logger.error("[RTSP] DB alert write failed: %s", db_err)

                # Update active_detections in telemetry dict
                if validated_url in rtsp_streams:
                    rtsp_streams[validated_url]["active_detections"] = detections

        # ── Start background threads ──────────────────────────────────────────
        reader_t = threading.Thread(target=_reader_thread, name="rtsp-reader", daemon=True)
        infer_t = threading.Thread(target=_inference_thread, name="rtsp-infer", daemon=True)
        reader_t.start()
        infer_t.start()

        # ── Async MJPEG yielder (30fps display) ───────────────────────────────
        boundary = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
        TARGET_DISPLAY_FPS = 30.0
        display_interval = 1.0 / TARGET_DISPLAY_FPS
        last_fps_ts = time.time()
        frame_count = 0
        stream_fps = 0.0

        try:
            while validated_url in _active_rtsp_captures and not _stop.is_set():
                # Grab the best available display frame
                with _ann_lock:
                    display = _ann_slot[0]
                if display is None:
                    with _frame_lock:
                        display = _raw_slot[0]
                if display is None:
                    await asyncio.sleep(0.02)
                    continue

                ok, buffer = cv2.imencode(".jpg", display, [cv2.IMWRITE_JPEG_QUALITY, 85])
                if ok:
                    yield boundary + buffer.tobytes() + b"\r\n"

                frame_count += 1
                now = time.time()
                if now - last_fps_ts >= 1.0:
                    stream_fps = frame_count / (now - last_fps_ts)
                    frame_count = 0
                    last_fps_ts = now
                    if validated_url in rtsp_streams:
                        rtsp_streams[validated_url]["fps"] = round(stream_fps, 1)

                # Pace the yielder to TARGET_DISPLAY_FPS
                await asyncio.sleep(display_interval)

        except asyncio.CancelledError:
            logger.info("[RTSP] Client disconnected: %s", validated_url)
        finally:
            _stop.set()
            cap.release()
            _active_rtsp_captures.discard(validated_url)
            rtsp_streams.pop(validated_url, None)
            reader_t.join(timeout=2.0)
            infer_t.join(timeout=2.0)
            logger.info("[RTSP] Cleaned up all resources for: %s", validated_url)

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Access-Control-Allow-Origin": "*",
        },
    )


# ── RTSP telemetry SSE endpoint ───────────────────────────────────────────────

@router.get("/rtsp/telemetry", dependencies=[])
async def rtsp_telemetry(
    url: str,
    _user: models.User = Depends(_require_stream_auth),
):
    """
    Server-Sent Events stream of live telemetry for the given RTSP URL.

    This endpoint reads from the rtsp_streams dict that is populated by the
    MJPEG capture loop — it does NOT open a second cv2.VideoCapture.
    One "Connect" action -> one capture loop -> one SSE consumer.

    The SSE updates every 250 ms so the UI always shows real-time fps /
    latency / active_detections even between DB alert writes (debounce only
    affects DB writes, not this stream).
    """
    validated_url = _validate_stream_url(url)

    async def generate_telemetry():
        while True:
            data = rtsp_streams.get(validated_url)
            if data:
                payload = {
                    "fps": data.get("fps", 0),
                    "inference_fps": data.get("inference_fps", 0),
                    "latency": data.get("latency", 0),
                    "active_detections": data.get("active_detections", []),
                }
            else:
                payload = {
                    "fps": 0,
                    "inference_fps": 0,
                    "latency": 0,
                    "active_detections": [],
                }
            yield "data: {}\n\n".format(json.dumps(payload))
            # 4 Hz — fast enough to feel live, low server overhead
            await asyncio.sleep(0.25)

    return StreamingResponse(
        generate_telemetry(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        },
    )


# ── RTSP disconnect endpoint ───────────────────────────────────────────────────

@router.delete("/rtsp/stream", dependencies=[])
async def rtsp_disconnect(
    url: str,
    _user: models.User = Depends(_require_stream_auth),
):
    """
    Instructs the server to tear down the active capture loop for the given URL.

    Call this when the user navigates away from the Detection page or clicks
    Disconnect.  The capture generator will self-terminate within one frame
    cycle when it notices its URL is no longer in _active_rtsp_captures.
    """
    validated_url = _validate_stream_url(url)
    was_active = validated_url in _active_rtsp_captures
    _active_rtsp_captures.discard(validated_url)
    rtsp_streams.pop(validated_url, None)
    logger.info("[RTSP] Disconnect requested for %s (was_active=%s)", validated_url, was_active)
    return {"status": "disconnected", "url": validated_url, "was_active": was_active}
