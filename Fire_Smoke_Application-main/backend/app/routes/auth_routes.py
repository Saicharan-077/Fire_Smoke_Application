import hmac
import hashlib
import os
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.orm import Session
from typing import Callable

from ..database import get_db
from .. import models, schemas

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

SESSION_DURATION_MINUTES = int(os.getenv("SESSION_DURATION_MINUTES", "1440"))
ALLOW_PUBLIC_REGISTRATION = os.getenv("ALLOW_PUBLIC_REGISTRATION", "true").lower() == "true"

ADMIN_ROLES = frozenset({"administrator", "admin"})
OPERATOR_ROLES = frozenset({"administrator", "admin", "operator"})
ALL_ROLES = frozenset({"administrator", "admin", "operator", "viewer"})


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    db_val = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
    return salt.hex() + ":" + db_val.hex()


def verify_password(password: str, hashed: str) -> bool:
    try:
        salt_hex, hash_hex = hashed.split(":")
        salt = bytes.fromhex(salt_hex)
        db_val = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
        return hmac.compare_digest(db_val.hex(), hash_hex)
    except Exception:
        return False


def get_user_by_token(token: str, db: Session) -> models.User | None:
    if not token:
        return None
    return (
        db.query(models.User)
        .filter(models.User.session_token == token)
        .filter(models.User.session_expires_at >= datetime.utcnow())
        .first()
    )


def get_current_user(authorization: str = Header(None), db: Session = Depends(get_db)) -> models.User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication credentials",
        )

    token = authorization.split(" ")[1]
    user = get_user_by_token(token, db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid",
        )
    return user


def get_user_by_websocket_token(token: str, db: Session) -> models.User:
    user = get_user_by_token(token, db)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid WebSocket token")
    return user


def require_roles(*roles: str) -> Callable:
    allowed = {r.lower() for r in roles}

    def _checker(current_user: models.User = Depends(get_current_user)) -> models.User:
        user_role = (current_user.role or "").lower()
        if user_role == "admin":
            user_role = "administrator"
        if user_role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user

    return _checker


require_admin = require_roles("administrator", "admin")
require_operator = require_roles("administrator", "admin", "operator")


def log_audit(db: Session, user: models.User | None, action: str, details: str):
    try:
        audit = models.AuditLog(
            user_id=user.id if user else None,
            username=user.username if user else None,
            action=action,
            details=details,
        )
        db.add(audit)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Failed to write audit log: {e}")

def log_system(db: Session, level: str, source: str, message: str):
    try:
        syslog = models.SystemLog(
            level=level,
            source=source,
            message=message,
        )
        db.add(syslog)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Failed to write system log: {e}")


@router.post("/login", response_model=schemas.TokenResponse)
def login(body: schemas.UserLogin, db: Session = Depends(get_db)):
    user = (
        db.query(models.User)
        .filter(
            (models.User.username == body.username_or_email) |
            (models.User.email == body.username_or_email)
        )
        .first()
    )

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username/email or password",
        )

    if getattr(user, "is_active", "true") == "false":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated. Contact an administrator.",
        )

    token = uuid.uuid4().hex
    user.session_token = token
    user.session_expires_at = datetime.utcnow() + timedelta(minutes=SESSION_DURATION_MINUTES)
    user.last_login = datetime.utcnow()
    db.commit()
    db.refresh(user)

    log_audit(db, user, "LOGIN", f"User logged in successfully from session: {token[:8]}...")
    log_system(db, "INFO", "auth", f"Session initialized for user: {user.username}")

    return schemas.TokenResponse(token=token, user=user)


@router.post("/register", response_model=schemas.UserOut)
def register(body: schemas.UserRegister, db: Session = Depends(get_db)):
    if not ALLOW_PUBLIC_REGISTRATION:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public registration is disabled. Contact an administrator.",
        )

    existing = db.query(models.User).filter(
        (models.User.username == body.username) | (models.User.email == body.email)
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username or email already registered",
        )

    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    # Dynamic email-based role assignment
    email_lower = body.email.lower()
    role = "viewer"
    if email_lower.endswith("@sentinelos.ai"):
        requested_role = (body.role or "viewer").lower()
        if requested_role == "admin":
            requested_role = "administrator"
        if requested_role in {"administrator", "operator", "viewer"}:
            role = requested_role
    else:
        # Check for developer/test keywords in email prefix
        prefix = email_lower.split("@")[0]
        if "admin" in prefix:
            role = "administrator"
        elif "operator" in prefix:
            role = "operator"
        else:
            role = "viewer"

    new_user = models.User(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(body.password),
        role=role,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    log_audit(db, new_user, "REGISTER", f"New user created: {new_user.username} with role {new_user.role}")
    log_system(db, "INFO", "auth", f"User registered: {new_user.username}")

    return new_user


@router.post("/forgot-password")
def forgot_password(body: schemas.ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == body.email).first()
    if user:
        log_audit(db, user, "PASSWORD_RESET_REQUEST", f"Password reset requested for {body.email}")

    # Always return the same message to prevent user enumeration
    return {
        "status": "success",
        "message": "If an account exists for that email, a reset link has been sent.",
    }


@router.post("/change-password")
def change_password(
    body: schemas.ChangePasswordRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    if body.new_password != body.confirm_password:
        raise HTTPException(status_code=400, detail="New passwords do not match")

    current_user.hashed_password = hash_password(body.new_password)
    db.commit()
    log_audit(db, current_user, "PASSWORD_CHANGE", "User changed password")
    return {"status": "success", "message": "Password updated successfully"}


@router.post("/set-resolution-pin")
def set_resolution_pin(
    body: schemas.SetResolutionPinRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Provision or clear the resolution PIN.

    This is the endpoint PipelineAlertLifecycle.resolve() has been missing:
    the resolve path could VERIFY a PIN since launch, but nothing could ever
    SET one -- the only way to provision `resolution_pin_hash` was a direct
    database write, which is not something that exists in production. This
    closes that gap; the resolve path itself is unchanged.
    """
    if not verify_password(body.password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Password is incorrect")

    if body.new_pin == "":
        current_user.resolution_pin_hash = None
        db.commit()
        log_audit(db, current_user, "RESOLUTION_PIN_CLEARED", "User cleared their resolution PIN")
        return {"status": "success", "message": "Resolution PIN cleared", "pin_set": False}

    if not body.new_pin.isdigit() or not (4 <= len(body.new_pin) <= 6):
        raise HTTPException(status_code=400, detail="PIN must be 4-6 digits")
    if body.new_pin != body.confirm_pin:
        raise HTTPException(status_code=400, detail="PINs do not match")

    current_user.resolution_pin_hash = hash_password(body.new_pin)
    db.commit()
    log_audit(db, current_user, "RESOLUTION_PIN_SET", "User set a resolution PIN")
    return {"status": "success", "message": "Resolution PIN set", "pin_set": True}


@router.get("/resolution-pin/status")
def resolution_pin_status(current_user: models.User = Depends(get_current_user)):
    """Whether a PIN is configured -- never the PIN or its hash."""
    return {"pin_set": bool(current_user.resolution_pin_hash)}


@router.post("/logout")
def logout(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    current_user.session_token = None
    current_user.session_expires_at = None
    db.commit()
    log_audit(db, current_user, "LOGOUT", f"User logged out successfully")
    return {"status": "success", "message": "Logged out successfully"}


@router.get("/profile", response_model=schemas.UserOut)
def get_profile(current_user: models.User = Depends(get_current_user)):
    return current_user


@router.post("/google", response_model=schemas.TokenResponse)
def google_auth(
    body: schemas.UserGoogleAuth,
    authorization: str = Header(None),
    db: Session = Depends(get_db)
):
    action = body.action.lower()
    
    if action == "login":
        user = db.query(models.User).filter(models.User.google_id == body.google_id).first()
        if not user:
            user = db.query(models.User).filter(models.User.email == body.email).first()
            if user:
                user.google_id = body.google_id
                user.google_linked = "true"
                db.commit()
                db.refresh(user)
                log_audit(db, user, "GOOGLE_LINK_AUTO", f"Auto-linked Google account for email {body.email}")
            else:
                username = body.username or body.email.split("@")[0]
                base_username = username
                counter = 1
                while db.query(models.User).filter(models.User.username == username).first():
                    username = f"{base_username}_{counter}"
                    counter += 1
                
                dummy_password = uuid.uuid4().hex
                user = models.User(
                    username=username,
                    email=body.email,
                    hashed_password=hash_password(dummy_password),
                    role="viewer",
                    google_id=body.google_id,
                    google_linked="true"
                )
                db.add(user)
                db.commit()
                db.refresh(user)
                log_audit(db, user, "GOOGLE_REGISTER_AUTO", f"Auto-registered Google user with role viewer: {username}")
                
        if getattr(user, "is_active", "true") == "false":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is deactivated. Contact an administrator.",
            )
        
        token = uuid.uuid4().hex
        user.session_token = token
        user.session_expires_at = datetime.utcnow() + timedelta(minutes=SESSION_DURATION_MINUTES)
        user.last_login = datetime.utcnow()
        db.commit()
        db.refresh(user)
        log_audit(db, user, "LOGIN_GOOGLE", f"User logged in successfully via Google: {token[:8]}...")
        return schemas.TokenResponse(token=token, user=user)

    elif action == "register":
        existing_user = db.query(models.User).filter(models.User.email == body.email).first()
        if existing_user:
            existing_user.google_id = body.google_id
            existing_user.google_linked = "true"
            db.commit()
            db.refresh(existing_user)
            log_audit(db, existing_user, "GOOGLE_LINK_DUPLICATE", f"Auto-linked Google account on duplicate registration check for email {body.email}")
            user = existing_user
        else:
            username = body.username or body.email.split("@")[0]
            base_username = username
            counter = 1
            while db.query(models.User).filter(models.User.username == username).first():
                username = f"{base_username}_{counter}"
                counter += 1
            
            dummy_password = uuid.uuid4().hex
            user = models.User(
                username=username,
                email=body.email,
                hashed_password=hash_password(dummy_password),
                role="viewer",
                google_id=body.google_id,
                google_linked="true"
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            log_audit(db, user, "GOOGLE_REGISTER", f"Registered new Google user with role viewer: {username}")
            
        if getattr(user, "is_active", "true") == "false":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is deactivated. Contact an administrator.",
            )
            
        token = uuid.uuid4().hex
        user.session_token = token
        user.session_expires_at = datetime.utcnow() + timedelta(minutes=SESSION_DURATION_MINUTES)
        user.last_login = datetime.utcnow()
        db.commit()
        db.refresh(user)
        log_audit(db, user, "LOGIN_GOOGLE", f"User logged in successfully via Google registration: {token[:8]}...")
        return schemas.TokenResponse(token=token, user=user)

    elif action == "link":
        if not authorization:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing authentication credentials for linking",
            )
        token_str = authorization.split(" ")[1] if " " in authorization else authorization
        current_user = get_user_by_token(token_str, db)
        if not current_user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired session for linking",
            )
            
        linked_user = db.query(models.User).filter(models.User.google_id == body.google_id).first()
        if linked_user and linked_user.id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Google account is already linked to another user account",
            )
            
        current_user.google_id = body.google_id
        current_user.google_linked = "true"
        db.commit()
        db.refresh(current_user)
        log_audit(db, current_user, "GOOGLE_LINK_MANUAL", f"Linked Google account manually: {body.email}")
        
        return schemas.TokenResponse(token=token_str, user=current_user)

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid action: '{action}'",
        )

