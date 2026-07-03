from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime


# ── Camera ────────────────────────────────────────────────────────────────────
class CameraCreate(BaseModel):
    name: str
    location: Optional[str] = None
    zone: Optional[str] = None
    stream_url: Optional[str] = None


class CameraUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    zone: Optional[str] = None
    status: Optional[str] = None
    stream_url: Optional[str] = None
    description: Optional[str] = None


class CameraStatusUpdate(BaseModel):
    status: str  # online | offline | maintenance


class CameraZoneUpdate(BaseModel):
    zone: Optional[str] = None


class CameraOut(BaseModel):
    id: str
    name: str
    location: Optional[str]
    zone: Optional[str]
    status: str
    stream_url: Optional[str]
    description: Optional[str] = None
    last_seen: Optional[datetime]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Alert ─────────────────────────────────────────────────────────────────────
class AlertOut(BaseModel):
    id: str
    detection_type: str
    confidence: float
    status: str
    source_type: str
    camera_id: Optional[str]
    location: Optional[str]
    file_name: Optional[str]
    evidence_path: Optional[str]
    frame_number: Optional[int]
    timestamp: datetime

    class Config:
        from_attributes = True


class AlertStatusUpdate(BaseModel):
    status: str  # active | resolved

    @field_validator('status')
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in ('active', 'resolved'):
            raise ValueError("status must be 'active' or 'resolved'")
        return v


# ── Detection Event ──────────────────────────────────────────────────────────
class DetectionEventOut(BaseModel):
    id: str
    alert_id: Optional[str]
    detection_type: str
    confidence: float
    bbox_x1: Optional[int]
    bbox_y1: Optional[int]
    bbox_x2: Optional[int]
    bbox_y2: Optional[int]
    source_type: str
    camera_id: Optional[str]
    location: Optional[str]
    file_name: Optional[str]
    frame_number: Optional[int]
    evidence_path: Optional[str]
    timestamp: datetime

    class Config:
        from_attributes = True


# ── Dashboard ────────────────────────────────────────────────────────────────
class DashboardStats(BaseModel):
    total_alerts: int
    active_alerts: int
    fire_alerts: int
    smoke_alerts: int
    connected_cameras: int
    recent_alerts: List[AlertOut]


# ── Pagination ────────────────────────────────────────────────────────────────
class PaginatedAlerts(BaseModel):
    items: List[AlertOut]
    total: int
    page: int
    limit: int
    pages: int


# ── Upload Responses ─────────────────────────────────────────────────────────
class ImageUploadResponse(BaseModel):
    detections: List[dict]
    alert_ids: List[str]
    evidence_path: Optional[str]
    file_name: Optional[str]


class VideoUploadResponse(BaseModel):
    total_events: int
    events: List[dict]
    file_name: Optional[str]


# ── User Authentication ───────────────────────────────────────────────────────
class UserLogin(BaseModel):
    username_or_email: str
    password: str
    remember_me: Optional[bool] = False


class UserOut(BaseModel):
    id: str
    username: str
    email: str
    role: str
    last_login: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    token: str
    user: UserOut


class UserRegister(BaseModel):
    username: str
    email: str
    password: str
    role: Optional[str] = "operator"


class ForgotPasswordRequest(BaseModel):
    email: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


class IncidentCreate(BaseModel):
    title: str
    description: Optional[str] = None
    severity: Optional[str] = "medium"
    status: Optional[str] = "active"
    alert_id: Optional[str] = None
    reporter: Optional[str] = None
    assigned_user: Optional[str] = None
    notes: Optional[str] = None


class IncidentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    assigned_user: Optional[str] = None
    notes: Optional[str] = None


class IncidentOut(BaseModel):
    id: str
    title: str
    description: Optional[str]
    severity: str
    status: str
    alert_id: Optional[str]
    reporter: Optional[str]
    assigned_user: Optional[str]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SettingOut(BaseModel):
    id: str
    value: str
    description: Optional[str]
    category: Optional[str]

    class Config:
        from_attributes = True


class SettingUpdate(BaseModel):
    value: str
    description: Optional[str] = None


class AuditLogOut(BaseModel):
    id: str
    user_id: Optional[str]
    username: Optional[str]
    action: str
    details: Optional[str]
    ip_address: Optional[str]
    timestamp: datetime

    class Config:
        from_attributes = True


class SystemLogOut(BaseModel):
    id: str
    level: str
    source: str
    message: str
    timestamp: datetime

    class Config:
        from_attributes = True



