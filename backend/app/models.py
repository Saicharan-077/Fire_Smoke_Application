import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, Float, Text, Index, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base


def gen_uuid():
    return str(uuid.uuid4())


class Camera(Base):
    __tablename__ = "cameras"
    id                    = Column(String, primary_key=True, default=gen_uuid)
    name                  = Column(String, nullable=False)
    location              = Column(String, nullable=True)
    zone                  = Column(String, nullable=True)
    status                = Column(String, default="online")        # online | offline | maintenance
    stream_url            = Column(String, nullable=True)
    description           = Column(Text, nullable=True)
    assigned_operator_id  = Column(String, ForeignKey("users.id"), nullable=True)
    last_seen             = Column(DateTime, default=datetime.utcnow)
    created_at            = Column(DateTime, default=datetime.utcnow)


    # Relationships
    alerts = relationship("Alert", back_populates="camera_rel", lazy="dynamic")


class Alert(Base):
    __tablename__ = "alerts"
    id             = Column(String,   primary_key=True, default=gen_uuid)
    detection_type = Column(String,   nullable=False)              # "fire" | "smoke"
    confidence     = Column(Float,    nullable=False)
    status         = Column(String,   default="active")            # "active"|"resolved"
    source_type    = Column(String,   nullable=False)              # "image" | "video" | "stream"
    camera_id      = Column(String,   ForeignKey("cameras.id"), nullable=True)

    location       = Column(String,   nullable=True)
    file_name      = Column(String,   nullable=True)
    evidence_path  = Column(String,   nullable=True)
    frame_number   = Column(Integer,  nullable=True)
    timestamp      = Column(DateTime, default=datetime.utcnow)

    # Relationships
    camera_rel = relationship("Camera", back_populates="alerts")
    events     = relationship("DetectionEvent", back_populates="alert_rel",
                              cascade="all, delete-orphan", lazy="dynamic")

    __table_args__ = (
        Index("ix_alert_timestamp", "timestamp"),
        Index("ix_alert_type", "detection_type"),
        Index("ix_alert_status", "status"),
        Index("ix_alert_camera", "camera_id"),
    )


class DetectionEvent(Base):
    __tablename__ = "detection_events"
    id             = Column(String,   primary_key=True, default=gen_uuid)
    alert_id       = Column(String,   ForeignKey("alerts.id"), nullable=True)
    detection_type = Column(String,   nullable=False)
    confidence     = Column(Float,    nullable=False)
    bbox_x1        = Column(Integer,  nullable=True)
    bbox_y1        = Column(Integer,  nullable=True)
    bbox_x2        = Column(Integer,  nullable=True)
    bbox_y2        = Column(Integer,  nullable=True)
    source_type    = Column(String,   nullable=False)
    camera_id      = Column(String,   nullable=True)
    location       = Column(String,   nullable=True)
    file_name      = Column(String,   nullable=True)
    frame_number   = Column(Integer,  nullable=True)
    evidence_path  = Column(String,   nullable=True)
    notes          = Column(Text,     nullable=True)
    timestamp      = Column(DateTime, default=datetime.utcnow)

    # Relationships
    alert_rel = relationship("Alert", back_populates="events")

    __table_args__ = (
        Index("ix_event_timestamp", "timestamp"),
        Index("ix_event_alert", "alert_id"),
    )


class User(Base):
    __tablename__ = "users"
    id              = Column(String, primary_key=True, default=gen_uuid)
    username        = Column(String, unique=True, nullable=False)
    email           = Column(String, unique=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role            = Column(String, default="viewer")  # administrator | operator | viewer
    is_active       = Column(String, default="true")    # "true" | "false" (string for SQLite compat)
    last_login          = Column(DateTime, nullable=True)
    session_token       = Column(String, nullable=True)
    session_expires_at  = Column(DateTime, nullable=True)
    created_at          = Column(DateTime, default=datetime.utcnow)


class Incident(Base):
    __tablename__ = "incidents"
    id             = Column(String, primary_key=True, default=gen_uuid)
    title          = Column(String, nullable=False)
    description    = Column(Text, nullable=True)
    severity       = Column(String, nullable=False, default="medium")  # "critical" | "high" | "medium" | "low"
    status         = Column(String, nullable=False, default="active")   # "active" | "resolved"
    alert_id       = Column(String, ForeignKey("alerts.id"), nullable=True)
    reporter       = Column(String, nullable=True)
    assigned_user  = Column(String, nullable=True)
    notes          = Column(Text, nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    alert = relationship("Alert", backref="incident", uselist=False)

    __table_args__ = (
        Index("ix_incident_status", "status"),
        Index("ix_incident_severity", "severity"),
        Index("ix_incident_created_at", "created_at"),
    )


class Setting(Base):
    __tablename__ = "settings"
    id          = Column(String, primary_key=True)  # unique config key
    value       = Column(String, nullable=False)
    description = Column(String, nullable=True)
    category    = Column(String, nullable=True, default="general")  # "ai" | "notifications" | "general"


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id         = Column(String, primary_key=True, default=gen_uuid)
    user_id    = Column(String, nullable=True)
    username   = Column(String, nullable=True)
    action     = Column(String, nullable=False)  # "LOGIN" | "LOGOUT" | "CAMERA_CREATE" | "ALERT_RESOLVE" etc.
    details    = Column(Text, nullable=True)
    ip_address = Column(String, nullable=True)
    timestamp  = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_audit_log_timestamp", "timestamp"),
        Index("ix_audit_log_action", "action"),
    )


class SystemLog(Base):
    __tablename__ = "system_logs"
    id        = Column(String, primary_key=True, default=gen_uuid)
    level     = Column(String, nullable=False, default="INFO")  # "INFO" | "WARNING" | "ERROR"
    source    = Column(String, nullable=False)  # "inference" | "auth" | "websocket" | "database" etc.
    message   = Column(Text, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_system_log_timestamp", "timestamp"),
        Index("ix_system_log_level", "level"),
    )


