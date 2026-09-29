"""
Base class for all UC-internal analytics events.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class BaseAnalyticsEvent(BaseModel):
    event_id: UUID = Field(default_factory=uuid4)
    camera_id: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    source_uc: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
