"""
The pipeline's OWN database schema.

Deliberately separate from the Dashboard's tables. The pipeline never reads or
writes the Dashboard's database, and the Dashboard gets pipeline data by
calling the pipeline's API -- not by querying these tables directly.

Note what is ABSENT here, on purpose: no ``acknowledged_by``, ``resolved_by``,
``escalated``, ``escalation_target``, operator notes, or PIN hashes. Those are
alert-LIFECYCLE concerns and belong entirely to the Dashboard's own alert
management layer, keyed by the ``id`` values this table issues.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import declarative_base

Base = declarative_base()


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CameraRecord(Base):
    """A camera registered with the pipeline."""

    __tablename__ = "pipeline_cameras"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False)
    source_uri = Column(String, nullable=True)
    location = Column(String, nullable=True)
    enabled = Column(Boolean, default=True, nullable=False)
    calibration_state = Column(String, default="uncalibrated", nullable=False)
    created_at = Column(DateTime, default=_now, nullable=False)


class ZoneRecord(Base):
    """Zone / containment configuration, owned by the pipeline."""

    __tablename__ = "pipeline_zones"

    id = Column(String, primary_key=True, default=_uuid)
    zone_id = Column(String, nullable=False)
    camera_id = Column(String, ForeignKey("pipeline_cameras.id"), nullable=False)
    name = Column(String, nullable=True)
    polygon_json = Column(Text, nullable=False, default="[]")
    risk_weight = Column(Float, nullable=False, default=0.5)
    flammable_materials_nearby = Column(Boolean, default=False, nullable=False)
    designated_activity_json = Column(Text, nullable=False, default="[]")
    envelope_json = Column(Text, nullable=False, default="{}")
    adjacent_cameras_json = Column(Text, nullable=False, default="[]")
    approved = Column(Boolean, default=False, nullable=False)
    updated_at = Column(DateTime, default=_now, onupdate=_now, nullable=False)

    __table_args__ = (Index("ix_zone_camera", "camera_id"),)


class AlertRecord(Base):
    """A confirmed alert produced by the pipeline.

    ``evidence_ref`` is NOT NULL by design. This is the schema-level half of
    the evidence guarantee: even if application code were bypassed, the
    database refuses an alert with no supporting evidence.
    """

    __tablename__ = "pipeline_alerts"

    id = Column(String, primary_key=True, default=_uuid)
    incident_id = Column(String, nullable=True)
    camera_id = Column(String, nullable=False)
    track_id = Column(Integer, nullable=True)

    threat_class = Column(String, nullable=False)
    confidence = Column(Float, nullable=False)
    severity = Column(String, nullable=False)
    severity_score = Column(Float, nullable=False)

    bbox_x1 = Column(Integer, nullable=True)
    bbox_y1 = Column(Integer, nullable=True)
    bbox_x2 = Column(Integer, nullable=True)
    bbox_y2 = Column(Integer, nullable=True)

    zone_id = Column(String, nullable=True)
    containment_breached = Column(Boolean, default=False, nullable=False)
    envelope_exceeded = Column(Boolean, default=False, nullable=False)
    growth_rate = Column(Float, default=0.0, nullable=False)
    duration_s = Column(Float, default=0.0, nullable=False)

    # --- the evidence guarantee ---
    evidence_ref = Column(String, nullable=False)

    source_type = Column(String, nullable=False)
    trigger_reason = Column(String, nullable=True)
    reasoning_json = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=_now, nullable=False)

    __table_args__ = (
        Index("ix_alert_timestamp", "timestamp"),
        Index("ix_alert_camera", "camera_id"),
        Index("ix_alert_incident", "incident_id"),
        Index("ix_alert_severity", "severity"),
    )


class IncidentRecord(Base):
    """A correlated incident, possibly spanning multiple cameras."""

    __tablename__ = "pipeline_incidents"

    id = Column(String, primary_key=True)
    threat_class = Column(String, nullable=False)
    severity = Column(String, nullable=False)
    peak_score = Column(Float, default=0.0, nullable=False)
    camera_ids_json = Column(Text, nullable=False, default="[]")
    resolved = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=_now, nullable=False)
    updated_at = Column(DateTime, default=_now, onupdate=_now, nullable=False)


class CalibrationRecord(Base):
    """Persisted calibration observations, so a restart doesn't lose a window."""

    __tablename__ = "pipeline_calibration_observations"

    id = Column(String, primary_key=True, default=_uuid)
    camera_id = Column(String, nullable=False)
    bbox_x1 = Column(Integer, nullable=False)
    bbox_y1 = Column(Integer, nullable=False)
    bbox_x2 = Column(Integer, nullable=False)
    bbox_y2 = Column(Integer, nullable=False)
    threat_class = Column(String, nullable=False)
    confidence = Column(Float, nullable=False)
    timestamp = Column(DateTime, default=_now, nullable=False)

    __table_args__ = (Index("ix_calib_camera", "camera_id"),)
