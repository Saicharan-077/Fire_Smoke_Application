"""
Canonical string enums used in events and across the Innovision platform.
"""
from enum import Enum


class FrameProvider(str, Enum):
    minio = "minio"
    redis = "redis"


class AlertSeverity(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class AlertStatus(str, Enum):
    pending = "pending"
    acknowledged = "acknowledged"
    in_progress = "in_progress"
    resolved = "resolved"
    closed = "closed"


class IncidentStatus(str, Enum):
    active = "active"
    acknowledged = "acknowledged"
    in_progress = "in_progress"
    resolved = "resolved"
    closed = "closed"


class SourceUC(str, Enum):
    uc1 = "uc1"
    uc2 = "uc2"
    uc3 = "uc3"
    uc4 = "uc4"


class CameraStatus(str, Enum):
    online = "online"
    offline = "offline"
    reconnecting = "reconnecting"
    disabled = "disabled"


class OperatorRole(str, Enum):
    superadmin = "superadmin"
    admin = "admin"
    operator = "operator"
    viewer = "viewer"
