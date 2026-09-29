"""
AlertEvent Pydantic contract published by UCs to alerts:live and consumed by Alert Management.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

from shared.contracts.enums import AlertSeverity, AlertStatus, FrameProvider, SourceUC


class AlertEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    alert_id: UUID = Field(default_factory=uuid4)
    camera_id: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    severity: AlertSeverity
    alert_type: str
    title: str
    description: str
    source_event_id: Optional[str] = None
    source_uc: SourceUC
    frame_reference: Optional[str] = None
    frame_provider: Optional[FrameProvider] = None
    status: AlertStatus = AlertStatus.pending
    metadata: Dict[str, Any] = Field(default_factory=dict)


class AlertEventValidator:
    @staticmethod
    def validate(event: AlertEvent, known_cam_ids: Optional[List[str]] = None) -> List[str]:
        errors: List[str] = []
        if not event.title or not event.title.strip():
            errors.append("Title cannot be empty or whitespace only")
        if not event.description or not event.description.strip():
            errors.append("Description cannot be empty or whitespace only")
        if (event.frame_reference is not None and event.frame_provider is None) or (
            event.frame_reference is None and event.frame_provider is not None
        ):
            errors.append("frame_reference and frame_provider must both be provided or both be None")
        if known_cam_ids is not None and event.camera_id not in known_cam_ids:
            errors.append(f"Camera ID {event.camera_id} is not in known camera IDs")
        return errors
