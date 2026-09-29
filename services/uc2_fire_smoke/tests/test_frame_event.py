"""
Tests for FrameEvent contract validation.
"""
from uuid import uuid4
import pytest
from pydantic import ValidationError

from shared.contracts.enums import FrameProvider
from shared.contracts.frame_event import FrameEvent, FrameEventSchema


def test_frame_event_creation():
    event = FrameEvent(
        camera_id="cam-001",
        frame_seq=42,
        frame_provider=FrameProvider.redis,
        frame_reference="frame:cam-001:42",
        frame_shape=(1080, 1920),
    )
    assert event.camera_id == "cam-001"
    assert event.frame_seq == 42
    assert event.frame_provider == FrameProvider.redis
    assert event.frame_shape == (1080, 1920)
    assert len(FrameEventSchema.validated_reference_format(event)) == 0


def test_frame_event_invalid_reference():
    event = FrameEvent(
        camera_id="cam-001",
        frame_seq=1,
        frame_provider=FrameProvider.minio,
        frame_reference="invalid_path.jpg",
        frame_shape=(1080, 1920),
    )
    errors = FrameEventSchema.validated_reference_format(event)
    assert len(errors) > 0
    assert "MinIO frame reference must start with 'frames/'" in errors[0]


def test_frame_event_json_roundtrip():
    event = FrameEvent(
        camera_id="cam-002",
        frame_seq=100,
        frame_provider=FrameProvider.minio,
        frame_reference="frames/cam-002/00000100.jpg",
        frame_shape=(720, 1280),
    )
    json_str = event.model_dump_json()
    loaded = FrameEvent.model_validate_json(json_str)
    assert loaded.camera_id == event.camera_id
    assert loaded.frame_seq == event.frame_seq
    assert loaded.frame_reference == event.frame_reference
