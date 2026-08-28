import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, Float, Text, Index, ForeignKey, Boolean
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
    priority              = Column(String, default="MEDIUM")       # HIGH | MEDIUM | LOW
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
    acknowledged_by = Column(String,  nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)
    resolved_by    = Column(String,   nullable=True)
    # Escalation fields (Issue 5)
    escalated      = Column(Boolean,  default=False)
    escalated_at   = Column(DateTime, nullable=True)
    escalated_by   = Column(String,   nullable=True)
    escalation_target = Column(Text,  nullable=True)     # free-text: person/team/system
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
        Index("ix_alert_escalated", "escalated"),
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
    google_id       = Column(String, unique=True, nullable=True)
    google_linked   = Column(String, default="false")
    last_login          = Column(DateTime, nullable=True)
    session_token       = Column(String, nullable=True)
    session_expires_at  = Column(DateTime, nullable=True)
    resolution_pin_hash = Column(String, nullable=True)   # bcrypt hash of optional resolution PIN (Issue 4)
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


class PipelineAlertLifecycle(Base):
    """Alert LIFECYCLE state for alerts owned by the detection pipeline.

    Why this table exists
    ---------------------
    Detection alerts now live in the pipeline's own database. Lifecycle state --
    acknowledgement, PIN-gated resolution, escalation, operator notes -- is a
    Dashboard concern and must NOT be pushed into the pipeline, which is
    deliberately detection-only and portable to any dashboard.

    So lifecycle lives here, keyed by the pipeline's alert id.

    Design notes
    ------------
    * ``pipeline_alert_id`` is a plain indexed string, NOT a foreign key. The
      referenced row is in a different database; a cross-database FK is not
      possible and pretending otherwise would be misleading.
    * Rows are created LAZILY, on the first lifecycle action. The pipeline's
      alert stream is not mirrored here -- an alert with no row is implicitly
      "active", which is the correct default and avoids duplicating detection
      data into the dashboard DB.
    * The ``snapshot_*`` columns are a deliberate, narrow denormalisation so a
      resolved alert can still be listed and audited if the pipeline is
      unreachable or has pruned the alert. **The pipeline remains the source of
      truth for detection data**; these are a cache for audit continuity only,
      never for detection logic.
    * Rows are never auto-deleted when the pipeline alert disappears. A
      PIN-verified resolution is an audit record; orphans surface in the UI as
      "alert data unavailable" rather than vanishing.
    * PIN verification itself is unchanged -- it still checks
      ``User.resolution_pin_hash`` on this side.

    Pre-cutover alerts keep using the lifecycle columns on ``alerts``. During
    dual-read the UI selects the lifecycle source by the alert's origin.
    """

    __tablename__ = "pipeline_alert_lifecycle"

    id                = Column(String, primary_key=True, default=gen_uuid)
    pipeline_alert_id = Column(String, nullable=False, unique=True, index=True)

    # --- lifecycle state (the reason this table exists) ---
    status            = Column(String,  nullable=False, default="active")  # active|acknowledged|resolved
    acknowledged_by   = Column(String,  nullable=True)
    acknowledged_at   = Column(DateTime, nullable=True)
    resolved_by       = Column(String,  nullable=True)
    resolved_at       = Column(DateTime, nullable=True)
    # True only when a resolution PIN was actually verified for this resolution.
    resolution_pin_verified = Column(Boolean, default=False, nullable=False)

    escalated         = Column(Boolean, default=False, nullable=False)
    escalated_at      = Column(DateTime, nullable=True)
    escalated_by      = Column(String,  nullable=True)
    escalation_target = Column(Text,    nullable=True)

    notes             = Column(Text,    nullable=True)

    # --- audit-continuity snapshot (cache; pipeline is source of truth) ---
    snapshot_camera_id      = Column(String,   nullable=True)
    snapshot_detection_type = Column(String,   nullable=True)
    snapshot_severity       = Column(String,   nullable=True)
    snapshot_confidence     = Column(Float,    nullable=True)
    snapshot_evidence_ref   = Column(String,   nullable=True)
    snapshot_timestamp      = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_pal_pipeline_alert_id", "pipeline_alert_id"),
        Index("ix_pal_status", "status"),
        Index("ix_pal_escalated", "escalated"),
    )


class FacilityMap(Base):
    """One uploaded site/floor plan image. Single active map at a time --
    re-uploading replaces the active one rather than accumulating a history,
    since camera placements are keyed to a specific map's pixel geometry and
    a stale second map would just be confusing, not useful."""
    __tablename__ = "facility_maps"
    id          = Column(String, primary_key=True, default=gen_uuid)
    name        = Column(String, nullable=False)
    filename    = Column(String, nullable=False)  # relative to FACILITY_MAP_DIR
    width_px    = Column(Integer, nullable=False)
    height_px   = Column(Integer, nullable=False)
    uploaded_by = Column(String, nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)


class CameraPlacement(Base):
    """Where one pipeline camera sits on the active facility map, and the
    field-of-view cone it covers (facing direction + angular width + range).
    This is the geometric input the FOV-overlap computation
    (facility_map_routes.py) uses to *suggest* adjacency -- distinct from,
    and never auto-applied over, an approved zone's human-confirmed
    adjacent_camera_ids."""
    __tablename__ = "camera_placements"
    id         = Column(String, primary_key=True, default=gen_uuid)
    map_id     = Column(String, nullable=False)
    camera_id  = Column(String, nullable=False)
    camera_name = Column(String, nullable=True)
    x_pct      = Column(Float, nullable=False)
    y_pct      = Column(Float, nullable=False)
    facing_deg = Column(Float, nullable=False, default=0.0)
    fov_deg    = Column(Float, nullable=False, default=90.0)
    range_pct  = Column(Float, nullable=False, default=25.0)
    updated_by = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_camera_placement_map", "map_id"),
        Index("ix_camera_placement_camera", "camera_id"),
    )
