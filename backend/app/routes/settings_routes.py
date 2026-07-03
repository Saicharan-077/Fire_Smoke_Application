"""
Settings routes — /api/v1/settings and /settings
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict

from ..database import get_db
from ..routes.auth_routes import get_current_user, log_audit, require_admin
from .. import models, schemas

router = APIRouter(prefix="/api/v1/settings", tags=["settings"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger("fireguard.settings")


def initialize_default_settings(db: Session):
    defaults = {
        "enable_sound_alerts": ("true", "Play audible warning sirens when a threat is identified", "notifications"),
        "enable_email_alerts": ("false", "Send high-priority email alerts to operations teams", "notifications"),
        "fire_min_confidence": ("0.15", "Minimum match confidence threshold for fire detections", "ai"),
        "smoke_min_confidence": ("0.25", "Minimum match confidence threshold for smoke detections", "ai"),
        "enable_motion_filtering": ("false", "Filter out static frames to speed up stream processing", "ai"),
        "retention_days": ("30", "Duration in days to store alert images and database events", "general"),
    }
    for key, (val, desc, cat) in defaults.items():
        existing = db.query(models.Setting).filter(models.Setting.id == key).first()
        if not existing:
            setting = models.Setting(id=key, value=val, description=desc, category=cat)
            db.add(setting)
    db.commit()


@router.get("", response_model=List[schemas.SettingOut])
def get_settings(db: Session = Depends(get_db)):
    initialize_default_settings(db)
    return db.query(models.Setting).all()


@router.patch("", response_model=List[schemas.SettingOut], dependencies=[Depends(require_admin)])
def update_settings(
    body: Dict[str, str],
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    for key, val in body.items():
        setting = db.query(models.Setting).filter(models.Setting.id == key).first()
        if setting:
            old_val = setting.value
            setting.value = str(val)
            log_audit(db, current_user, "SETTING_UPDATE", f"Modified configuration: {key} from '{old_val}' to '{val}'")
        else:
            # Create if doesn't exist
            setting = models.Setting(id=key, value=str(val), category="general")
            db.add(setting)
            log_audit(db, current_user, "SETTING_CREATE", f"Created configuration: {key} = '{val}'")

    db.commit()
    return db.query(models.Setting).all()
