"""
Admin routes — /api/v1/admin
Full admin panel: user management, logs, sessions, system health.
"""
import math
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..database import get_db
from ..routes.auth_routes import (
    require_admin, get_current_user, hash_password, log_audit, log_system,
)
from .. import models, schemas

router = APIRouter(
    prefix="/api/v1/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


def _paginate(query, page: int, limit: int):
    total = query.count()
    items = query.offset((page - 1) * limit).limit(limit).all()
    pages = max(1, math.ceil(total / limit)) if limit else 1
    return items, total, pages


# ── User Management ───────────────────────────────────────────────────────────

@router.get("/users", response_model=schemas.PaginatedUsers)
def list_users(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str = Query("", alias="q"),
    role: str = Query("", alias="role"),
    db: Session = Depends(get_db),
):
    q = db.query(models.User)
    if search:
        like = f"%{search}%"
        q = q.filter(
            (models.User.username.ilike(like)) | (models.User.email.ilike(like))
        )
    if role:
        q = q.filter(models.User.role == role)
    q = q.order_by(models.User.created_at.desc())
    items, total, pages = _paginate(q, page, limit)
    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": pages,
    }


@router.post("/users", response_model=schemas.UserOut, status_code=201)
def create_user(
    body: schemas.UserCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = db.query(models.User).filter(
        (models.User.username == body.username) | (models.User.email == body.email)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username or email already exists")

    user = models.User(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(body.password),
        role=body.role,
        is_active="true",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_audit(db, current_user, "USER_CREATE", f"Created user {user.email} with role {user.role}")
    return user


@router.get("/users/{user_id}", response_model=schemas.UserOut)
def get_user(user_id: str, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/users/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: str,
    body: schemas.UserUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.username is not None:
        user.username = body.username
    if body.email is not None:
        user.email = body.email
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active

    db.commit()
    db.refresh(user)
    log_audit(db, current_user, "USER_UPDATE", f"Updated user {user.email}")
    return user


@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    email = user.email
    db.delete(user)
    db.commit()
    log_audit(db, current_user, "USER_DELETE", f"Deleted user {email}")
    return {"status": "success", "message": "User deleted"}


@router.post("/users/{user_id}/reset-password")
def reset_user_password(
    user_id: str,
    body: schemas.AdminResetPassword,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.hashed_password = hash_password(body.new_password)
    user.session_token = None
    user.session_expires_at = None
    db.commit()
    log_audit(db, current_user, "PASSWORD_RESET", f"Admin reset password for {user.email}")
    return {"status": "success", "message": "Password reset successfully"}


@router.patch("/users/{user_id}/activate", response_model=schemas.UserOut)
def activate_user(
    user_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = "true"
    db.commit()
    db.refresh(user)
    log_audit(db, current_user, "USER_ACTIVATE", f"Activated user {user.email}")
    return user


@router.patch("/users/{user_id}/deactivate", response_model=schemas.UserOut)
def deactivate_user(
    user_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = "false"
    user.session_token = None
    user.session_expires_at = None
    db.commit()
    db.refresh(user)
    log_audit(db, current_user, "USER_DEACTIVATE", f"Deactivated user {user.email}")
    return user


# ── Audit & System Logs ─────────────────────────────────────────────────────

@router.get("/audit-logs")
def list_audit_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    action: str = Query(""),
    db: Session = Depends(get_db),
):
    q = db.query(models.AuditLog).order_by(models.AuditLog.timestamp.desc())
    if action:
        q = q.filter(models.AuditLog.action.ilike(f"%{action}%"))
    items, total, pages = _paginate(q, page, limit)
    return {
        "items": [schemas.AuditLogOut.model_validate(i) for i in items],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": pages,
    }


@router.get("/system-logs")
def list_system_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    level: str = Query(""),
    source: str = Query(""),
    db: Session = Depends(get_db),
):
    q = db.query(models.SystemLog).order_by(models.SystemLog.timestamp.desc())
    if level:
        q = q.filter(models.SystemLog.level == level.upper())
    if source:
        q = q.filter(models.SystemLog.source.ilike(f"%{source}%"))
    items, total, pages = _paginate(q, page, limit)
    return {
        "items": [schemas.SystemLogOut.model_validate(i) for i in items],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": pages,
    }


# ── Active Sessions ───────────────────────────────────────────────────────────

@router.get("/sessions")
def list_active_sessions(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    users = (
        db.query(models.User)
        .filter(models.User.session_token.isnot(None))
        .filter(models.User.session_expires_at >= now)
        .filter(models.User.is_active == "true")
        .all()
    )
    return {
        "sessions": [
            {
                "user_id": u.id,
                "username": u.username,
                "email": u.email,
                "role": u.role,
                "last_login": u.last_login.isoformat() if u.last_login else None,
                "expires_at": u.session_expires_at.isoformat() if u.session_expires_at else None,
            }
            for u in users
        ],
        "count": len(users),
    }


@router.delete("/sessions/{user_id}")
def revoke_session(
    user_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.session_token = None
    user.session_expires_at = None
    db.commit()
    log_audit(db, current_user, "SESSION_REVOKE", f"Revoked session for {user.email}")
    return {"status": "success", "message": "Session revoked"}


# ── System Health & Stats ─────────────────────────────────────────────────────

@router.get("/health")
def admin_system_health(db: Session = Depends(get_db)):
    from ..routes import upload_routes
    svc = upload_routes._detection_svc
    model_ready = svc.ready if svc else False
    active_users = (
        db.query(func.count(models.User.id))
        .filter(models.User.is_active == "true")
        .scalar()
    ) or 0
    total_cameras = db.query(func.count(models.Camera.id)).scalar() or 0
    online_cameras = (
        db.query(func.count(models.Camera.id))
        .filter(models.Camera.status == "online")
        .scalar()
    ) or 0
    active_alerts = (
        db.query(func.count(models.Alert.id))
        .filter(models.Alert.status == "active")
        .scalar()
    ) or 0
    total_alerts = db.query(func.count(models.Alert.id)).scalar() or 0

    now = datetime.utcnow()
    active_sessions = (
        db.query(func.count(models.User.id))
        .filter(models.User.session_token.isnot(None))
        .filter(models.User.session_expires_at >= now)
        .scalar()
    ) or 0

    recent_errors = (
        db.query(func.count(models.SystemLog.id))
        .filter(models.SystemLog.level == "ERROR")
        .scalar()
    ) or 0

    model_ready = svc.ready if svc else False

    total_users = db.query(func.count(models.User.id)).scalar() or 0

    return {
        "status": "healthy" if model_ready else "degraded",
        "model_ready": model_ready,
        "database": "connected",
        "users": {"total": total_users, "active": active_users},
        "cameras": {"total": total_cameras, "online": online_cameras},
        "alerts": {"total": total_alerts, "active": active_alerts},
        "sessions": active_sessions,
        "recent_errors": recent_errors,
        "uptime": os.environ.get("SERVICE_START", datetime.utcnow().isoformat()),
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/stats")
def admin_dashboard_stats(db: Session = Depends(get_db)):
    """Aggregated stats for admin dashboard analytics."""
    total_incidents = db.query(func.count(models.Incident.id)).scalar() or 0
    active_incidents = (
        db.query(func.count(models.Incident.id))
        .filter(models.Incident.status == "active")
        .scalar()
    ) or 0

    role_counts = {}
    for role in ("administrator", "operator", "viewer"):
        role_counts[role] = (
            db.query(func.count(models.User.id))
            .filter(models.User.role == role)
            .scalar()
        ) or 0

    return {
        "users_by_role": role_counts,
        "incidents": {"total": total_incidents, "active": active_incidents},
        "audit_log_count": db.query(func.count(models.AuditLog.id)).scalar() or 0,
        "system_log_count": db.query(func.count(models.SystemLog.id)).scalar() or 0,
    }
