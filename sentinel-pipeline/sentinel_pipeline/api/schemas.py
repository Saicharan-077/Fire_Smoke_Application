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
