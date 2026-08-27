"""
Gate Step 4 — forced periodic override.

The confirmed fix for the steady-fire bug: a fire producing a stable image
never crosses a motion threshold, so a purely motion-driven gate never runs the
Model on it and the fire stays permanently invisible.

This timer fires on its own schedule, completely independent of change score
and of IDLE/ACTIVE state. Interval comes from the zone's risk tier.

Uses a monotonic clock — wall-clock can step backwards (NTP correction, DST)
and would stall or spuriously fire the override.
"""

from __future__ import annotations

import time

from ..config import ContextSettings


# Risk tier boundaries, per Gate Module Reference Section 5.
HIGH_RISK_MIN = 0.8
MEDIUM_RISK_MIN = 0.4


def interval_for_risk_weight(
    risk_weight: float | None, cfg: ContextSettings
) -> tuple[float, str]:
    """Map a zone risk weight to its forced-check interval.

    Returns ``(interval_seconds, tier_name)``. ``None`` means the camera has no
    zone assigned yet, which gets the conservative uncalibrated fallback rather
    than the low-risk interval.
    """
    if risk_weight is None:
        return cfg.forced_interval_uncalibrated, "uncalibrated"
    if risk_weight >= HIGH_RISK_MIN:
        return cfg.forced_interval_high, "high"
    if risk_weight >= MEDIUM_RISK_MIN:
        return cfg.forced_interval_medium, "medium"
    return cfg.forced_interval_low, "low"


class ForcedOverrideTimer:
    """Per-camera periodic override timer.

    Deliberately fires on the FIRST call: a camera that has just come online has
    never been looked at, and waiting a full interval before the first
    inference is its own blind spot.
    """

    __slots__ = ("_interval", "_tier", "_last_fired", "_fire_count", "_clock")

    def __init__(self, interval_s: float, tier: str = "uncalibrated", clock=time.monotonic):
        self._interval = float(interval_s)
        self._tier = tier
        self._clock = clock
        self._last_fired: float | None = None
        self._fire_count = 0

    @property
    def interval(self) -> float:
        return self._interval

    @property
    def tier(self) -> str:
        return self._tier

    @property
    def fire_count(self) -> int:
        return self._fire_count

    def set_interval(self, interval_s: float, tier: str) -> None:
        """Update the interval, e.g. after calibration assigns a real risk tier."""
        self._interval = float(interval_s)
        self._tier = tier

    def seconds_until_next(self) -> float:
        if self._last_fired is None:
            return 0.0
        return max(0.0, self._interval - (self._clock() - self._last_fired))

    def should_fire(self) -> bool:
        """True if the override is due. Does not consume — call ``fire()`` to consume."""
        if self._last_fired is None:
            return True
        return (self._clock() - self._last_fired) >= self._interval

    def fire(self) -> None:
        """Record that an override just happened, restarting the interval."""
        self._last_fired = self._clock()
        self._fire_count += 1

    def notify_inference_ran(self) -> None:
        """Reset the timer because the Model ran for some other reason.

        Avoids a forced override immediately after a motion-triggered inference,
        which would waste a Model call on a frame we just looked at.
        """
        self._last_fired = self._clock()
