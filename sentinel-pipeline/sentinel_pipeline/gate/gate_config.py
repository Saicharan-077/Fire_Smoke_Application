"""
Gate Step 5 — per-camera configuration.

Sane defaults for uncalibrated cameras, upgradeable once Calibration Mode
assigns a real zone and risk tier. Operators may override any derived value
per camera.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from ..config import ContextSettings, GateSettings, settings
from .forced_override import interval_for_risk_weight


@dataclass(frozen=True, slots=True)
class CameraGateConfig:
    """Resolved Gate configuration for one camera."""

    camera_id: str
    zone_id: str | None = None
    risk_weight: float | None = None

    # Derived from risk tier unless explicitly overridden by an operator.
    forced_override_interval: float | None = None
    # Overrides the global enter-ACTIVE threshold for this camera.
    threshold_override: float | None = None

    enabled: bool = True

    def resolve_interval(self, cfg: ContextSettings | None = None) -> tuple[float, str]:
        cfg = cfg or settings.context
        if self.forced_override_interval is not None:
            return self.forced_override_interval, "operator_override"
        return interval_for_risk_weight(self.risk_weight, cfg)

    def resolve_enter_threshold(self, cfg: GateSettings | None = None) -> float:
        cfg = cfg or settings.gate
        if self.threshold_override is not None:
            return self.threshold_override
        return cfg.enter_active_threshold

    def with_zone(self, zone_id: str | None, risk_weight: float | None) -> "CameraGateConfig":
        return replace(self, zone_id=zone_id, risk_weight=risk_weight)


class GateConfigStore:
    """In-memory per-camera Gate config, with defaults for unknown cameras.

    Zone assignment is pushed in by the Context Engine when calibration
    completes, rather than the Gate querying a database on a hot path.
    """

    def __init__(self) -> None:
        self._configs: dict[str, CameraGateConfig] = {}

    def get(self, camera_id: str) -> CameraGateConfig:
        cfg = self._configs.get(camera_id)
        if cfg is None:
            cfg = CameraGateConfig(camera_id=camera_id)
            self._configs[camera_id] = cfg
        return cfg

    def set(self, cfg: CameraGateConfig) -> CameraGateConfig:
        self._configs[cfg.camera_id] = cfg
        return cfg

    def update_zone(
        self, camera_id: str, zone_id: str | None, risk_weight: float | None
    ) -> CameraGateConfig:
        return self.set(self.get(camera_id).with_zone(zone_id, risk_weight))

    def remove(self, camera_id: str) -> None:
        self._configs.pop(camera_id, None)

    def all(self) -> dict[str, CameraGateConfig]:
        return dict(self._configs)
