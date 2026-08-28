"""Request/response models for the public v1 API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CameraCreate(BaseModel):
    name: str
    source_uri: str | None = None
    location: str | None = None
    forced_override_interval: float | None = Field(
        None, description="Operator override, in seconds. Omit to derive from zone risk tier."
    )


class CameraOut(BaseModel):
    camera_id: str
    name: str
    source_uri: str | None
    location: str | None
    calibration_state: str
    zone_id: str | None = None
    risk_weight: float | None = None


class CalibrationStart(BaseModel):
    window_hours: float | None = Field(
        None, description="Observation window. Defaults to the configured value."
    )


class ZoneApprove(BaseModel):
    zone_id: str
    risk_weight: float = Field(..., ge=0.0, le=1.0)
    name: str = ""
    polygon: list[list[int]] | None = Field(
        None, description="Operator-adjusted polygon. Omit to accept the suggestion as-is."
    )
    flammable_materials_nearby: bool = False
    designated_activity_allowed: list[str] = Field(default_factory=list)
    adjacent_camera_ids: list[str] = Field(default_factory=list)


class EnvelopeEdit(BaseModel):
    """Partial override of a zone's normal-behaviour envelope. Every field is
    optional -- an omitted field keeps its current calibrated value, so a
    human correcting one wrong number (e.g. max_area) never has to
    re-supply the rest of a stats block they didn't mean to touch."""

    min_area: int | None = None
    max_area: int | None = None
    mean_area: float | None = None
    std_area: float | None = None
    always_on: bool | None = None
    area_sigma_tolerance: float | None = Field(None, ge=0.1)


class ZoneEdit(BaseModel):
    """Human correction to an ALREADY-APPROVED zone -- not a re-calibration.

    Every field is optional; only supplied fields are changed. Requires an
    existing approved zone (404 otherwise) -- this is deliberately not a
    backdoor to skip calibration, only a way to fix a wrong value calibration
    or a prior approval produced.
    """

    risk_weight: float | None = Field(None, ge=0.0, le=1.0)
    polygon: list[list[int]] | None = None
    flammable_materials_nearby: bool | None = None
    designated_activity_allowed: list[str] | None = None
    adjacent_camera_ids: list[str] | None = None
    envelope: EnvelopeEdit | None = None


class DetectionOut(BaseModel):
    track_id: int
    camera_id: str
    timestamp: str
    bbox: dict
    threat_class: str = Field(..., alias="class")
    confidence: float

    model_config = {"populate_by_name": True}


class FrameResultOut(BaseModel):
    camera_id: str
    gate_passed: bool
    trigger_reason: str | None
    change_score: float
    candidates: int
    tracked: int
    confirmed: int
    rejected_false_positive: int
    detections: list[dict]
    alerts: list[dict]


class JobOut(BaseModel):
    job_id: str
    status: str
    progress_pct: float = 0.0
    frames_total: int = 0
    frames_processed: int = 0
    frames_gated_out: int = 0
    alerts: list[dict] = Field(default_factory=list)
    error: str | None = None
