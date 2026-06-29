import hmac
import hashlib
import os
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

SESSION_DURATION_MINUTES = int(os.getenv("SESSION_DURATION_MINUTES", "1440"))


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
    existing = db.query(models.User).filter(
        (models.User.username == body.username) | (models.User.email == body.email)
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username or email already registered",
        )

    # Validate role
    role = body.role.lower() if body.role else "operator"
    if role not in ("administrator", "operator", "viewer", "admin"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid role. Must be one of: administrator, operator, viewer",
        )
    if role == "admin":
        role = "administrator"

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
def forgot_password(body: dict, db: Session = Depends(get_db)):
    email = body.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    
    user = db.query(models.User).filter(models.User.email == email).first()
    if user:
        log_audit(db, user, "PASSWORD_RESET_REQUEST", f"Simulated reset email requested for {email}")
    else:
        log_system(db, "WARNING", "auth", f"Password reset requested for unregistered email: {email}")

    return {"status": "success", "message": "Simulated recovery link sent successfully."}


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

