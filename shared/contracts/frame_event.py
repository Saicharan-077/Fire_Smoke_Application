"""
FrameEvent Pydantic contract published by Ingestion and consumed by UC analytics.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import List, Tuple
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

from shared.contracts.enums import FrameProvider


class FrameEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    event_id: UUID = Field(default_factory=uuid4)
    camera_id: str
    frame_seq: int
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    frame_provider: FrameProvider
    frame_reference: str
    frame_shape: Tuple[int, int]  # (height, width)


class FrameEventSchema:
    @staticmethod
    def validated_reference_format(event: FrameEvent) -> List[str]:
        errors: List[str] = []
        if event.frame_provider == FrameProvider.minio:
            if not event.frame_reference.startswith("frames/"):
                errors.append("MinIO frame reference must start with 'frames/'")
        elif event.frame_provider == FrameProvider.redis:
            if not event.frame_reference.startswith("frame:"):
                errors.append("Redis frame reference must start with 'frame:'")

        h, w = event.frame_shape
        if h <= 0 or w <= 0:
            errors.append(f"Frame shape must be positive, got {event.frame_shape}")

        return errors
