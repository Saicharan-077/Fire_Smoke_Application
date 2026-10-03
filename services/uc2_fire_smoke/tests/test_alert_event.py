"""
Tests for AlertEvent contract and validation.
"""
from uuid import uuid4
import pytest

from shared.contracts.enums import AlertSeverity, AlertStatus, FrameProvider, SourceUC
from shared.contracts.alert_event import AlertEvent, AlertEventValidator


def test_alert_event_valid():
    alert = AlertEvent(
        camera_id="cam-002",
        severity=AlertSeverity.critical,
        alert_type="fire_detected",
        title="Critical Fire Detected in Sector 1",
        description="Fire detected with high confidence.",
        source_uc=SourceUC.uc2,
        frame_reference="evidence/cam-002/snapshot.jpg",
        frame_provider=FrameProvider.minio,
        metadata={"confidence": 0.95, "zone_id": "zone-1"},
    )
    assert alert.severity == AlertSeverity.critical
    assert alert.source_uc == SourceUC.uc2
    errors = AlertEventValidator.validate(alert, known_cam_ids=["cam-001", "cam-002"])
    assert len(errors) == 0


def test_alert_event_validation_errors():
    alert = AlertEvent(
        camera_id="cam-unknown",
        severity=AlertSeverity.high,
        alert_type="smoke_detected",
        title="  ",  # Whitespace title
        description="   ",  # Whitespace description
        source_uc=SourceUC.uc2,
    )

    errors = AlertEventValidator.validate(alert, known_cam_ids=["cam-001"])
    assert len(errors) >= 3
    assert any("Title cannot be empty" in e for e in errors)
    assert any("Description cannot be empty" in e for e in errors)
    assert any("Camera ID" in e for e in errors)
