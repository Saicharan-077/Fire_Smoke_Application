import json
import logging
import os
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from .database import engine, Base, SessionLocal, get_db
from . import models
from .ai.inference_service import DetectionService
from .middleware.security import SecurityHeadersMiddleware
from .middleware.rate_limit import RateLimitMiddleware
from .routes import (
    auth_routes, upload_routes, alert_routes, dashboard_routes, camera_routes,
    history_routes, incident_routes, settings_routes, profile_routes, detect_routes
)
from .routes.auth_routes import get_user_by_websocket_token, get_current_user, get_user_by_token
from .services.analytics_service import (
    get_timeline, get_zones, get_weekly_trend,
    get_camera_activity, get_type_breakdown,
    _range_filter,
)


# ── Logging setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("fireguard.main")

# Create DB tables
Base.metadata.create_all(bind=engine)
logger.info("[DB] Tables created / verified")

_detection_svc_instance: DetectionService | None = None


def seed_database():
    from .database import SessionLocal
    from . import models
    from .routes.auth_routes import hash_password
    from .routes.settings_routes import initialize_default_settings
    from datetime import datetime, timedelta
    import random

    db = SessionLocal()
    try:
        # 1. Seed Users (with specific credentials)
        admin = db.query(models.User).filter(models.User.email == "admin@fireguard.ai").first()
        if not admin:
            admin = models.User(
                username="admin@fireguard.ai",
                email="admin@fireguard.ai",
                hashed_password=hash_password("Admin@123"),
                role="administrator"
            )
            db.add(admin)
        elif os.getenv("SEED_RESET_PASSWORDS", "false").lower() == "true":
            admin.hashed_password = hash_password("Admin@123")
            admin.role = "administrator"
            db.add(admin)

        operator = db.query(models.User).filter(models.User.email == "operator@fireguard.ai").first()
        if not operator:
            operator = models.User(
                username="operator@fireguard.ai",
                email="operator@fireguard.ai",
                hashed_password=hash_password("Operator@123"),
                role="operator"
            )
            db.add(operator)

        viewer = db.query(models.User).filter(models.User.email == "viewer@fireguard.ai").first()
        if not viewer:
            viewer = models.User(
                username="viewer@fireguard.ai",
                email="viewer@fireguard.ai",
                hashed_password=hash_password("Viewer@123"),
                role="viewer"
            )
            db.add(viewer)

        db.commit()
        logger.info("[Seed] Default admin/operator/viewer users seeded successfully")

        # 2. Seed Default Settings
        initialize_default_settings(db)

        # 3. Seed Default Cameras
        camera_count = db.query(models.Camera).count()
        if camera_count == 0:
            default_cameras = [
                models.Camera(id="CAM-01", name="CAM-01 Warehouse Entrance", location="Warehouse A Entrance", zone="Zone A", status="online"),
                models.Camera(id="CAM-02", name="CAM-02 Server Room", location="IT Server Room", zone="Zone B", status="online"),
                models.Camera(id="CAM-03", name="CAM-03 Loading Dock", location="Main Loading Dock", zone="Zone C", status="maintenance"),
                models.Camera(id="CAM-04", name="CAM-04 Office Corridor", location="Administrative Office Corridor", zone="Zone D", status="online"),
                models.Camera(id="CAM-05", name="CAM-05 Back Exit Yard", location="Logistics Backyard", zone="Zone E", status="online"),
            ]
            db.add_all(default_cameras)
            db.commit()
            logger.info("[Seed] Default cameras seeded")

        # 4. Seed Alerts & Events if empty
        alert_count = db.query(models.Alert).count()
        if alert_count == 0:
            cams = ["CAM-01", "CAM-02", "CAM-04", "CAM-05"]
            types = ["fire", "smoke"]
            sources = ["image", "video", "stream"]
            
            for i in range(15):
                cam_id = random.choice(cams)
                det_type = random.choice(types)
                src = random.choice(sources)
                conf = round(random.uniform(0.65, 0.98), 2)
                status = "resolved" if i < 11 else "active"
                age_hours = i * 12
                timestamp = datetime.utcnow() - timedelta(hours=age_hours)
                
                alert = models.Alert(
                    id=f"alert-id-{1000+i}",
                    detection_type=det_type,
                    confidence=conf,
                    status=status,
                    source_type=src,
                    camera_id=cam_id,
                    location=f"Zone {random.choice(['A', 'B', 'D', 'E'])}",
                    file_name=f"alert_snapshot_{i}.jpg",
                    evidence_path=f"/evidence/test_red.jpg" if det_type == "fire" else "/evidence/test_gray.jpg",
                    frame_number=random.randint(10, 500) if src != "image" else None,
                    timestamp=timestamp
                )
                db.add(alert)
                db.commit()

                # Add a detection event
                event = models.DetectionEvent(
                    id=f"event-id-{2000+i}",
                    alert_id=alert.id,
                    detection_type=det_type,
                    confidence=conf,
                    bbox_x1=random.randint(50, 200),
                    bbox_y1=random.randint(50, 200),
                    bbox_x2=random.randint(300, 500),
                    bbox_y2=random.randint(300, 500),
                    source_type=src,
                    camera_id=cam_id,
                    location=alert.location,
                    file_name=alert.file_name,
                    evidence_path=alert.evidence_path,
                    timestamp=timestamp
                )
                db.add(event)
                
                # Escalated to incident if it's fire, or randomly for smoke
                if det_type == "fire" or (det_type == "smoke" and random.choice([True, False])):
                    severity = "critical" if det_type == "fire" else "high"
                    incident = models.Incident(
                        id=f"inc-id-{3000+i}",
                        title=f"Uncontrolled {det_type.capitalize()} Detection",
                        description=f"Automated threat detector flagged {det_type} on camera {cam_id} with {conf:.0%} confidence.",
                        severity=severity,
                        status=status,
                        alert_id=alert.id,
                        reporter="AI System Monitor",
                        assigned_user="operator@fireguard.ai" if i % 2 == 0 else "admin@fireguard.ai",
                        notes=f"Automatic escalations generated. Threat status marked as {status}.",
                        created_at=timestamp,
                        updated_at=timestamp
                    )
                    db.add(incident)

            db.commit()
            logger.info("[Seed] Default alerts, incidents and events seeded")

        # 5. Seed Audit Logs & System Logs
        audit_count = db.query(models.AuditLog).count()
        if audit_count == 0:
            actions = [
                ("LOGIN", "User logged in successfully from session: b89f..."),
                ("CAMERA_CREATE", "Created camera stream configuration for CAM-05"),
                ("SETTING_UPDATE", "Modified configuration: fire_min_confidence from 0.20 to 0.15"),
                ("ALERT_RESOLVE", "Incident alert-id-1004 marked as RESOLVED by operator@fireguard.ai"),
            ]
            for action, details in actions:
                log = models.AuditLog(
                    username="admin@fireguard.ai",
                    action=action,
                    details=details,
                    ip_address="127.0.0.1",
                    timestamp=datetime.utcnow() - timedelta(hours=random.randint(1, 24))
                )
                db.add(log)

            sys_logs = [
                ("INFO", "system", "YOLOv8 best.pt weights loaded successfully on CUDA/CPU GPU device"),
                ("INFO", "database", "SQLite DB tables successfully checked and initialized"),
                ("WARNING", "cctv", "RTSP link on camera CAM-03 did not return active feed, retrying..."),
                ("ERROR", "ai.inference", "Memory buffer warning: Frame queue size exceeded, clearing cache"),
            ]
            for level, src, msg in sys_logs:
                syslog = models.SystemLog(
                    level=level,
                    source=src,
                    message=msg,
                    timestamp=datetime.utcnow() - timedelta(hours=random.randint(1, 24))
                )
                db.add(syslog)
            
            db.commit()
            logger.info("[Seed] Default logs seeded successfully")

        db.commit()
    except Exception as e:
        logger.error(f"[Seed] Failed to seed database: {e}")
        db.rollback()
    finally:
        db.close()


if os.getenv("SEED_DATABASE", "true").lower() == "true":
    seed_database()
else:
    logger.info("[Seed] Skipped — SEED_DATABASE is not enabled")


# ── App lifespan ──────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _detection_svc_instance
    logger.info("[Startup] Loading YOLOv8 model...")
    svc = DetectionService()
    _detection_svc_instance = svc
    upload_routes._detection_svc = svc
    detect_routes._detection_svc = svc
    
    from .websocket.connection_manager import manager
    upload_routes._ws_manager = manager
    detect_routes._ws_manager = manager

    logger.info("[Startup] Ready — model loaded, routes configured")
    yield
    logger.info("[Shutdown] Cleaning up")


app = FastAPI(title="FireGuard AI API", version="1.0.0", lifespan=lifespan)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)

# CORS — configurable via env
_origins = [origin.strip() for origin in os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve evidence images as static files
EVIDENCE_DIR = os.path.join(os.path.dirname(__file__), "..", "evidence")
os.makedirs(EVIDENCE_DIR, exist_ok=True)
app.mount("/evidence", StaticFiles(directory=EVIDENCE_DIR), name="evidence")


@app.get("/api/v1/evidence/{filename:path}", dependencies=[Depends(get_current_user)])
def get_evidence_file(filename: str):
    safe_name = os.path.basename(filename)
    file_path = os.path.join(EVIDENCE_DIR, safe_name)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Evidence file not found")
    return FileResponse(file_path)

# ── Include Routers ───────────────────────────────────────────────────────────
app.include_router(auth_routes.router)
app.include_router(upload_routes.router)
app.include_router(alert_routes.router)
app.include_router(dashboard_routes.router)
app.include_router(camera_routes.router)
app.include_router(history_routes.router)
app.include_router(incident_routes.router)
app.include_router(settings_routes.router)
app.include_router(profile_routes.router)
app.include_router(detect_routes.router)


# ── Dynamic router aliasing for spec compatibility ───────────────────────────
def register_aliases():
    routers_to_alias = [
        (auth_routes.router, "/api/v1/auth", "/auth"),
        (detect_routes.router, "/api/v1/detect", "/detect"),
        (history_routes.router, "/api/v1/history", "/history"),
        (alert_routes.router, "/api/v1/alerts", "/alerts"),
        (incident_routes.router, "/api/v1/incidents", "/incidents"),
        (settings_routes.router, "/api/v1/settings", "/settings"),
        (profile_routes.router, "/api/v1/profile", "/profile"),
        (camera_routes.router, "/api/v1/cameras", "/cameras"),
    ]
    for router_obj, old_prefix, new_prefix in routers_to_alias:
        for route in router_obj.routes:
            path = route.path
            if path.startswith(old_prefix):
                alias_path = path.replace(old_prefix, new_prefix, 1)
                try:
                    app.add_api_route(
                        alias_path,
                        route.endpoint,
                        methods=route.methods,
                        response_model=route.response_model,
                        dependencies=route.dependencies,
                        tags=route.tags,
                        summary=route.summary,
                        description=route.description,
                    )
                except Exception as e:
                    # Logging warning is fine
                    pass

register_aliases()


# ── Analytics routes (v1 + Root level) ─────────────────────────────────────────

# Full analytics
@app.get("/api/v1/analytics", dependencies=[Depends(get_current_user)])
@app.get("/analytics", dependencies=[Depends(get_current_user)])
def analytics_full(
    range: str = Query("7d", regex="^(24h|7d|30d)$"),
    db: Session = Depends(get_db),
):
    return {
        "timeline": get_timeline(db, range),
        "zones": get_zones(db),
        "weekly_trend": get_weekly_trend(db),
        "camera_activity": get_camera_activity(db),
        "type_breakdown": get_type_breakdown(db, range),
    }


@app.get("/api/v1/analytics/incident-trends", dependencies=[Depends(get_current_user)])
@app.get("/analytics/incident-trends", dependencies=[Depends(get_current_user)])
def analytics_incident_trends(
    db: Session = Depends(get_db),
):
    rows = get_weekly_trend(db)
    return {
        "timeline": [
            {"day": r["day"], "fire": 0, "smoke": int(r["alerts"])}
            for r in rows
        ]
    }


@app.get("/api/v1/analytics/fire-smoke-distribution", dependencies=[Depends(get_current_user)])
@app.get("/analytics/fire-smoke-distribution", dependencies=[Depends(get_current_user)])
def analytics_fire_smoke_distribution(
    range: str = Query("7d", regex="^(24h|7d|30d)$"),
    db: Session = Depends(get_db),
):
    fb = get_type_breakdown(db, range)
    return {
        "breakdown": [
            {"name": "Fire", "value": fb["fire"], "color": "#ef4444"},
            {"name": "Smoke", "value": fb["smoke"], "color": "#f97316"},
        ]
    }


@app.get("/api/v1/analytics/alert-frequency", dependencies=[Depends(get_current_user)])
@app.get("/analytics/alert-frequency", dependencies=[Depends(get_current_user)])
def analytics_alert_frequency(
    range: str = Query("24h", regex="^(24h|7d|30d)$"),
    db: Session = Depends(get_db),
):
    return {"timeline": get_timeline(db, range)}


@app.get("/api/v1/analytics/severity-distribution", dependencies=[Depends(get_current_user)])
@app.get("/analytics/severity-distribution", dependencies=[Depends(get_current_user)])
def analytics_severity_distribution(
    range: str = Query("7d", regex="^(24h|7d|30d)$"),
    db: Session = Depends(get_db),
):
    cutoff = _range_filter(range)

    critical = db.query(func.count(models.Alert.id)).filter(
        models.Alert.timestamp >= cutoff,
        models.Alert.confidence >= 0.90,
    ).scalar() or 0

    high = db.query(func.count(models.Alert.id)).filter(
        models.Alert.timestamp >= cutoff,
        models.Alert.confidence >= 0.80,
        models.Alert.confidence < 0.90,
    ).scalar() or 0

    medium = db.query(func.count(models.Alert.id)).filter(
        models.Alert.timestamp >= cutoff,
        models.Alert.confidence >= 0.70,
        models.Alert.confidence < 0.80,
    ).scalar() or 0

    low = db.query(func.count(models.Alert.id)).filter(
        models.Alert.timestamp >= cutoff,
        models.Alert.confidence < 0.70,
    ).scalar() or 0

    return {
        "zones": [
            {"name": "Critical", "value": critical, "color": "#ef4444"},
            {"name": "High", "value": high, "color": "#f97316"},
            {"name": "Medium", "value": medium, "color": "#f59e0b"},
            {"name": "Low", "value": low, "color": "#22c55e"},
        ]
    }


@app.get("/api/v1/analytics/camera-activity", dependencies=[Depends(get_current_user)])
@app.get("/analytics/camera-activity", dependencies=[Depends(get_current_user)])
def analytics_camera_activity(
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    return {"camera_activity": get_camera_activity(db, limit=limit)}


# ── WebSocket endpoint ────────────────────────────────────────────────────────
@app.websocket("/ws/alerts")
async def alert_ws(websocket: WebSocket):
    token = websocket.query_params.get("token") or ""
    auth_header = websocket.headers.get("authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1]

    db = SessionLocal()
    try:
        try:
            get_user_by_websocket_token(token, db)
        except HTTPException:
            await websocket.close(code=1008)
            return

        from .websocket.connection_manager import manager
        await manager.connect(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            manager.disconnect(websocket)
    finally:
        db.close()


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/api/health")
@app.get("/api/v1/health")
def health():
    model_ready = _detection_svc_instance.ready if _detection_svc_instance else False
    return {
        "status":    "ok",
        "service":   "FireGuard AI",
        "version":   "1.0.0",
        "model_ready": model_ready,
        "timestamp": datetime.utcnow().isoformat(),
    }

