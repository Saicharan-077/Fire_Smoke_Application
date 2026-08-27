"""
Profile routes — /api/v1/profile and /profile
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..routes.auth_routes import get_current_user, log_audit, hash_password
from .. import models, schemas

router = APIRouter(prefix="/api/v1/profile", tags=["profile"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger("fireguard.profile")


@router.get("", response_model=schemas.UserOut)
def read_profile(current_user: models.User = Depends(get_current_user)):
    return current_user


@router.patch("", response_model=schemas.UserOut)
def update_profile(
    body: dict,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    username = body.get("username")
    email = body.get("email")
    password = body.get("password")

    if username:
        # Check uniqueness
        dup = db.query(models.User).filter(models.User.username == username, models.User.id != current_user.id).first()
        if dup:
            raise HTTPException(status_code=400, detail="Username already in use")
        current_user.username = username
    
    if email:
        dup = db.query(models.User).filter(models.User.email == email, models.User.id != current_user.id).first()
        if dup:
            raise HTTPException(status_code=400, detail="Email already in use")
        current_user.email = email

    if password:
        current_user.hashed_password = hash_password(password)
        log_audit(db, current_user, "PROFILE_PASSWORD_CHANGE", "User updated password")

    db.commit()
    db.refresh(current_user)
    log_audit(db, current_user, "PROFILE_UPDATE", f"User profile details updated: username={username}, email={email}")
    return current_user


@router.get("/audit-logs", response_model=List[schemas.AuditLogOut])
def get_user_audit_logs(
    limit: int = 50,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Viewer role can see logs too
    return (
        db.query(models.AuditLog)
        .filter(models.AuditLog.user_id == current_user.id)
        .order_by(models.AuditLog.timestamp.desc())
        .limit(limit)
        .all()
    )
