"""
Are the per-tier forced-override intervals ACTUALLY wired per-tier?

Closes a real gap in the original Gate suite: every test there passed an
explicit `forced_override_interval` (9999 to disable it, or 1.0 for the
steady-fire case), so it exercised operator overrides rather than the
zone-risk-tier lookup. Only the pure mapping function was covered for all
tiers, and only `high` and `low` were verified end-to-end through the API.

This verifies, for EVERY tier:
  1. the risk weight maps to the right interval,
  2. the Gate's timer is actually constructed with that interval,
  3. the timer fires at that cadence (deterministic, injected clock),
  4. changing a zone's risk weight retunes a live Gate.

    python tests/test_forced_override_tiers.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sentinel_pipeline.config import ContextSettings  # noqa: E402
from sentinel_pipeline.contracts import TriggerReason  # noqa: E402
from sentinel_pipeline.gate.forced_override import (  # noqa: E402
    ForcedOverrideTimer,
    interval_for_risk_weight,
)
from sentinel_pipeline.gate.gate import Gate  # noqa: E402
from sentinel_pipeline.gate.gate_config import CameraGateConfig  # noqa: E402

_results: list[tuple[str, bool]] = []
CFG = ContextSettings()

# Master Pipeline Document Section 3 / Gate Reference Section 5.
# The document specifies RANGES; the pipeline uses a single value per tier.
TIERS = [
    ("high",         1.00, CFG.forced_interval_high,          "5-10 sec"),
    ("high",         0.80, CFG.forced_interval_high,          "5-10 sec"),
    ("medium",       0.60, CFG.forced_interval_medium,        "20-30 sec"),
    ("medium",       0.40, CFG.forced_interval_medium,        "20-30 sec"),
    ("low",          0.20, CFG.forced_interval_low,           "60 sec"),
    ("low",          0.00, CFG.forced_interval_low,           "60 sec"),
    ("uncalibrated", None, CFG.forced_interval_uncalibrated,  "15-20 sec"),
]

SPEC_RANGES = {
    "high": (5.0, 10.0),
    "medium": (20.0, 30.0),
    "low": (60.0, 60.0),
    "uncalibrated": (15.0, 20.0),
}


def check(name: str, ok: bool, detail: str) -> None:
    _results.append((name, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"         {detail}")


def test_configured_values_sit_inside_the_spec_ranges():
    print("\n-- Configured interval vs documented range --")
    rows, ok = [], True
    for tier, (lo, hi) in SPEC_RANGES.items():
        actual = {
            "high": CFG.forced_interval_high,
            "medium": CFG.forced_interval_medium,
            "low": CFG.forced_interval_low,
            "uncalibrated": CFG.forced_interval_uncalibrated,
        }[tier]
        good = lo <= actual <= hi
        ok &= good
        rows.append(f"{tier}={actual:.0f}s in [{lo:.0f},{hi:.0f}] {'ok' if good else 'OUT OF RANGE'}")
    check("each configured interval falls inside its documented range", ok, "; ".join(rows))


def test_gate_builds_the_right_timer_per_tier():
    print("\n-- Gate timer construction, per tier (no operator override) --")
    rows, ok = [], True
    for tier, weight, expected, _spec in TIERS:
        gate = Gate()
        cam = f"cam_{tier}_{weight}"
        # Deliberately NO forced_override_interval -> must be derived from risk.
        gate.configure_camera(CameraGateConfig(camera_id=cam, risk_weight=weight))
        stats = gate.stats(cam)
        good = (
            stats is not None
            and abs(stats.forced_interval_s - expected) < 1e-9
            and stats.risk_tier == tier
        )
        ok &= good
        rows.append(
            f"risk={weight} -> tier={stats.risk_tier}/{stats.forced_interval_s:.0f}s"
            f"{'' if good else ' WRONG'}"
        )
    check("Gate derives each tier's interval from risk weight alone", ok, "; ".join(rows))


def test_timer_actually_fires_at_each_tier_cadence():
    """Deterministic clock: proves cadence at the REAL configured intervals
    without waiting 60 real seconds for the low tier."""
    print("\n-- Firing cadence at each tier's real interval (injected clock) --")
    rows, ok = [], True
    for tier, weight, expected, _spec in TIERS:
        if any(r.startswith(tier) for r in rows):
            continue  # one representative weight per tier
        now = [0.0]
        interval, resolved_tier = interval_for_risk_weight(weight, CFG)
        timer = ForcedOverrideTimer(interval, resolved_tier, clock=lambda: now[0])

        fires = 0
        # Simulate 3 full intervals in 0.1s steps.
        steps = int((interval * 3) / 0.1)
        for _ in range(steps):
            if timer.should_fire():
                timer.fire()
                fires += 1
            now[0] += 0.1

        # First fire is immediate (camera never looked at), then one per interval.
        expected_fires = 3
        good = fires == expected_fires and abs(interval - expected) < 1e-9
        ok &= good
        rows.append(
            f"{tier}: {fires} fires over {interval*3:.0f}s at {interval:.0f}s interval"
            f"{'' if good else f' (expected {expected_fires})'}"
        )
    check("timer fires exactly once per interval at every tier", ok, "; ".join(rows))


def test_cadence_against_a_real_wall_clock():
    """One real-time check, so the whole thing isn't only proven against a fake
    clock. Uses a short operator override; the tier maths is covered above."""
    print("\n-- Real wall-clock cadence --")
    gate = Gate()
    gate.configure_camera(CameraGateConfig(camera_id="wall", forced_override_interval=0.5))
    frame = np.full((240, 320, 3), 100, dtype=np.uint8)
    for _ in range(40):  # warm the background model
        gate.process_frame("wall", frame)

    fires, t0 = 0, time.monotonic()
    while time.monotonic() - t0 < 2.2:
        r = gate.process_frame("wall", frame)
        if r is not None and r.trigger_reason is TriggerReason.FORCED_OVERRIDE:
            fires += 1
        time.sleep(0.02)
    # 2.2s at 0.5s spacing -> 4 or 5 depending on phase.
    check("forced override fires on a real clock at the configured cadence",
          4 <= fires <= 5,
          f"{fires} forced overrides in 2.2s at a 0.5s interval (expected 4-5)")


def test_zone_change_retunes_a_live_gate():
    print("\n-- Retuning a live camera when its zone changes --")
    gate = Gate()
    gate.configure_camera(CameraGateConfig(camera_id="retune"))
    before = gate.stats("retune")

    transitions = []
    for zone_id, weight, want_tier in [
        ("chemical_storage", 1.0, "high"),
        ("workshop", 0.5, "medium"),
        ("break_area", 0.1, "low"),
        (None, None, "uncalibrated"),
    ]:
        gate.update_zone("retune", zone_id, weight)
        s = gate.stats("retune")
        transitions.append((want_tier, s.risk_tier, s.forced_interval_s))

    ok = all(want == got for want, got, _ in transitions)
    check("changing zone risk retunes the live Gate's interval",
          ok,
          f"start={before.risk_tier}/{before.forced_interval_s:.0f}s then "
          + " -> ".join(f"{got}/{iv:.0f}s" for _, got, iv in transitions))


def test_override_beats_tier():
    print("\n-- Operator override precedence --")
    gate = Gate()
    gate.configure_camera(
        CameraGateConfig(camera_id="ov", risk_weight=1.0, forced_override_interval=3.0)
    )
    s = gate.stats("ov")
    check("an explicit operator override wins over the zone-derived tier",
          abs(s.forced_interval_s - 3.0) < 1e-9 and s.risk_tier == "operator_override",
          f"risk_weight=1.0 (high tier = {CFG.forced_interval_high:.0f}s) but "
          f"override=3s -> applied {s.forced_interval_s:.0f}s, tier={s.risk_tier}")


ALL = [
    test_configured_values_sit_inside_the_spec_ranges,
    test_gate_builds_the_right_timer_per_tier,
    test_timer_actually_fires_at_each_tier_cadence,
    test_cadence_against_a_real_wall_clock,
    test_zone_change_retunes_a_live_gate,
    test_override_beats_tier,
]

if __name__ == "__main__":
    print("=" * 78)
    print("FORCED-OVERRIDE TIER WIRING")
    print("=" * 78)
    for fn in ALL:
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            _results.append((fn.__name__, False))
            print(f"  [ERROR] {fn.__name__}: {type(exc).__name__}: {exc}")
    passed = sum(1 for _, ok in _results if ok)
    print("\n" + "=" * 78)
    print(f"RESULT: {passed}/{len(_results)} checks passed")
    print("=" * 78)
    sys.exit(0 if passed == len(_results) else 1)
