from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime


# ── Camera ────────────────────────────────────────────────────────────────────
class CameraCreate(BaseModel):
    name: str
    location: Optional[str] = None
    zone: Optional[str] = None
    stream_url: Optional[str] = None
    priority: Optional[str] = "MEDIUM"


class CameraUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    zone: Optional[str] = None
    status: Optional[str] = None
    stream_url: Optional[str] = None
    description: Optional[str] = None
    assigned_operator_id: Optional[str] = None
    priority: Optional[str] = None


class CameraStatusUpdate(BaseModel):
    status: str  # online | offline | maintenance


class CameraPriorityUpdate(BaseModel):
    priority: str  # HIGH | MEDIUM | LOW


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
    assigned_operator_id: Optional[str] = None
    priority: Optional[str] = "MEDIUM"
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
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    resolved_by: Optional[str] = None
    # Escalation fields (Issue 5)
    escalated: Optional[bool] = False
    escalated_at: Optional[datetime] = None
    escalated_by: Optional[str] = None
    escalation_target: Optional[str] = None
    timestamp: datetime

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat() + "Z" if not v.isoformat().endswith("Z") else v.isoformat()
        }


class EscalateRequest(BaseModel):
    target: str  # free-text: person, team, system, phone number, etc.


class AlertStatusUpdate(BaseModel):
    status: str  # active | resolved
    reason: Optional[str] = None          # Human-entered resolution reason
    acknowledged: Optional[bool] = False  # Operator confirmation flag
    pin: Optional[str] = None             # Resolution PIN (Issue 4); falls back to account password if not set

    @field_validator('status')
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in ('active', 'resolved', 'acknowledged'):
            raise ValueError("status must be 'active', 'resolved', or 'acknowledged'")
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
    # Active-only breakdown (operators need these, not all-time totals)
    active_fire_alerts: int = 0
    active_smoke_alerts: int = 0
    connected_cameras: int
    online_cameras: int = 0
    total_cameras: int = 0
    model_ready: bool = False
    model_accuracy: float = 0.0
    model_name: str = "Custom YOLO Model"
    system_health: str = "unknown"
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
    annotated_video_path: Optional[str] = None
    has_detections: bool = False
    detection_summary: Optional[dict] = None


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
    is_active: Optional[str] = "true"
    google_id: Optional[str] = None
    google_linked: Optional[str] = "false"
    last_login: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    role: str = "viewer"

    @field_validator('role')
    @classmethod
    def validate_role(cls, v: str) -> str:
        allowed = {'administrator', 'admin', 'operator', 'viewer'}
        if v.lower() not in allowed:
            raise ValueError(f"role must be one of: {', '.join(sorted(allowed))}")
        return 'administrator' if v.lower() == 'admin' else v.lower()


class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[str] = None

    @field_validator('role')
    @classmethod
    def validate_role(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {'administrator', 'admin', 'operator', 'viewer'}
        if v.lower() not in allowed:
            raise ValueError(f"role must be one of: {', '.join(sorted(allowed))}")
        return 'administrator' if v.lower() == 'admin' else v.lower()


class AdminResetPassword(BaseModel):
    new_password: str

    @field_validator('new_password')
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class PaginatedUsers(BaseModel):
    items: List[UserOut]
    total: int
    page: int
    limit: int
    pages: int


class TokenResponse(BaseModel):
    token: str
    user: UserOut


class UserRegister(BaseModel):
    username: str
    email: str
    password: str
    role: Optional[str] = "operator"
    google_id: Optional[str] = None
    google_linked: Optional[str] = "false"


class UserGoogleAuth(BaseModel):
    email: str
    google_id: str
    username: Optional[str] = None
    action: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


class SetResolutionPinRequest(BaseModel):
    """Provision or clear the resolution PIN used to gate pipeline alert
    resolution (see PipelineAlertLifecycle). The login PASSWORD, not any
    existing PIN, is the proof of identity here -- there is no "current PIN"
    to check on first set, and requiring the account password for a
    security-relevant change mirrors change-password's own pattern.

    An empty `new_pin` clears the PIN (resolution reverts to unrestricted).
    A non-empty `new_pin` must be 4-6 digits -- a deliberately short,
    kiosk-style code, not a second password.
    """
    password: str
    new_pin: str = ""
    confirm_pin: str = ""


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
    resolve_reason: Optional[str] = None  # Auditable resolution reason (Issue #10)


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


class PaginatedIncidents(BaseModel):
    items: List[IncidentOut]
    total: int
    page: int
    limit: int
    pages: int


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



