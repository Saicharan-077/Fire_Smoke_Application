"""
Analytics service — reusable by both dashboard and analytics endpoints.
"""
import logging
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
from .. import models

logger = logging.getLogger("fireguard.analytics")


def _range_filter(range_str: str) -> datetime:
    """Convert range string to a datetime cutoff."""
    now = datetime.utcnow()
    mapping = {"24h": 1, "7d": 7, "30d": 30}
    days = mapping.get(range_str, 7)
    return now - timedelta(days=days)


def get_timeline(db: Session, range_str: str = "24h") -> list:
    """Group alerts by hour (24h) or by date (7d/30d)."""
    cutoff = _range_filter(range_str)
    now = datetime.utcnow()

    if range_str == "24h":
        fmt = "%H:00"
        timeline_q = (
            db.query(
                func.strftime(fmt, models.Alert.timestamp).label("period"),
                models.Alert.detection_type.label("type"),
                func.count(models.Alert.id).label("count"),
            )
            .filter(models.Alert.timestamp >= cutoff)
            .group_by("period", "type")
            .all()
        )
        # Build 24-hour slot map
        period_map = {}
        for i in range(24):
            h_str = (now - timedelta(hours=i)).strftime(fmt)
            period_map[h_str] = {"time": h_str, "fire": 0, "smoke": 0}
    else:
        fmt = "%Y-%m-%d"
        timeline_q = (
            db.query(
                func.strftime(fmt, models.Alert.timestamp).label("period"),
                models.Alert.detection_type.label("type"),
                func.count(models.Alert.id).label("count"),
            )
            .filter(models.Alert.timestamp >= cutoff)
            .group_by("period", "type")
            .all()
        )
        days = 7 if range_str == "7d" else 30
        period_map = {}
        for i in range(days):
            d_str = (now - timedelta(days=i)).strftime(fmt)
            period_map[d_str] = {"time": d_str, "fire": 0, "smoke": 0}

    for period, dtype, count in timeline_q:
        if period in period_map:
            if dtype in ("fire", "smoke"):
                period_map[period][dtype] += count

    return sorted(period_map.values(), key=lambda x: x["time"])


def get_zones(db: Session) -> list:
    """Incident distribution by location/zone."""
    zone_q = (
        db.query(
            models.Alert.location.label("zone"),
            func.count(models.Alert.id).label("incidents"),
        )
        .group_by(models.Alert.location)
        .all()
    )
    zone_data = [{"zone": z or "Unknown", "incidents": c} for z, c in zone_q]
    if not zone_data:
        zone_data = [{"zone": "No Data", "incidents": 0}]
    return zone_data


def get_weekly_trend(db: Session) -> list:
    """Alerts per day-of-week (0=Mon...6=Sun)."""
    cutoff = datetime.utcnow() - timedelta(days=30)
    rows = (
        db.query(
            func.strftime("%w", models.Alert.timestamp).label("dow"),
            func.count(models.Alert.id).label("count"),
        )
        .filter(models.Alert.timestamp >= cutoff)
        .group_by("dow")
        .all()
    )
    day_names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    result = {str(i): {"day": day_names[i], "alerts": 0} for i in range(7)}
    for dow, count in rows:
        if dow in result:
            result[dow]["alerts"] = count
    return [result[str(i)] for i in range(7)]


def get_camera_activity(db: Session, limit: int = 10) -> list:
    """Top cameras ranked by incident count."""
    rows = (
        db.query(
            models.Alert.camera_id.label("camera_id"),
            func.count(models.Alert.id).label("incidents"),
        )
        .filter(models.Alert.camera_id.isnot(None))
        .group_by(models.Alert.camera_id)
        .order_by(func.count(models.Alert.id).desc())
        .limit(limit)
        .all()
    )
    return [{"camera_id": cid or "Unknown", "incidents": cnt} for cid, cnt in rows]


def get_type_breakdown(db: Session, range_str: str = "7d") -> dict:
    """Fire vs Smoke ratio."""
    cutoff = _range_filter(range_str)
    fire = (
        db.query(func.count(models.Alert.id))
        .filter(models.Alert.timestamp >= cutoff, models.Alert.detection_type == "fire")
        .scalar()
    ) or 0
    smoke = (
        db.query(func.count(models.Alert.id))
        .filter(models.Alert.timestamp >= cutoff, models.Alert.detection_type == "smoke")
        .scalar()
    ) or 0
    return {"fire": fire, "smoke": smoke, "total": fire + smoke}
