"""
Gate validation — the full checklist from Gate Module Reference Section D.

Run directly for a human-readable report:
    python tests/test_gate_validation.py
Or under pytest:
    pytest tests/test_gate_validation.py -v
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
from sentinel_pipeline.gate.hysteresis import GateState, HysteresisStateMachine  # noqa: E402

RNG = np.random.default_rng(1234)
H, W = 360, 640


def static_scene(brightness: int = 90) -> np.ndarray:
    """A fixed scene with fixed sensor noise baked in (not re-randomised)."""
    base = np.full((H, W, 3), brightness, dtype=np.uint8)
    base[:120, :] = brightness + 25          # sky band
    base[240:, :] = brightness - 30          # ground band
    return base


def with_noise(frame: np.ndarray, sigma: float = 1.5) -> np.ndarray:
    noise = RNG.normal(0, sigma, frame.shape)
    return np.clip(frame.astype(np.float32) + noise, 0, 255).astype(np.uint8)


def add_fire_blob(frame: np.ndarray, cx: int = 320, cy: int = 200, r: int = 28) -> np.ndarray:
    """A bright static 'fire' patch. Deliberately does NOT move between frames."""
    out = frame.copy()
    yy, xx = np.ogrid[:H, :W]
    mask = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    out[mask] = (30, 110, 245)
    return out


def add_moving_box(frame: np.ndarray, x: int, size: int = 70) -> np.ndarray:
    out = frame.copy()
    x = max(0, min(x, W - size))
    out[150:150 + size, x:x + size] = (200, 200, 200)
    return out


def _report(name: str, passed: bool, detail: str) -> bool:
    print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
    print(f"         {detail}")
    return passed


# ---------------------------------------------------------------------------


def test_static_scene_stays_idle():
    """Static scene -> IDLE, no frames pass except forced-override ticks."""
    gate = Gate()
    gate.configure_camera(CameraGateConfig(camera_id="static", forced_override_interval=9999))
    base = static_scene()
    passes = 0
    for _ in range(200):
        if gate.process_frame("static", with_noise(base)) is not None:
            passes += 1
    s = gate.stats("static")
    # The very first frame always fires the override (camera never looked at).
    ok = passes <= 1 and s.state is GateState.IDLE
    assert _report(
        "static scene stays IDLE",
        ok,
        f"200 frames -> {passes} passed (expect <=1 first-frame override), "
        f"state={s.state.value}, score={s.change_score:.6f}, thr={s.effective_threshold:.6f}",
    )


def test_steady_fire_passes_via_forced_override():
    """THE confirmed bug case: a static fire with zero motion must still be seen."""
    gate = Gate()
    gate.configure_camera(CameraGateConfig(camera_id="steadyfire", forced_override_interval=1.0))
    scene = add_fire_blob(static_scene())

    # Burn the fire into the background model so it produces no motion at all.
    for _ in range(120):
        gate.process_frame("steadyfire", with_noise(scene))

    before = gate.stats("steadyfire").forced_overrides
    motion_before = gate.stats("steadyfire").motion_passes

    t0 = time.monotonic()
    forced_hits, elapsed = 0, 0.0
    while time.monotonic() - t0 < 3.2:
        r = gate.process_frame("steadyfire", with_noise(scene))
        if r is not None and r.trigger_reason is TriggerReason.FORCED_OVERRIDE:
            forced_hits += 1
            elapsed = time.monotonic() - t0
        time.sleep(0.02)

    s = gate.stats("steadyfire")
    motion_added = s.motion_passes - motion_before
    ok = forced_hits >= 2
    assert _report(
        "steady fire reaches Model via forced override",
        ok,
        f"zero-motion fire held 3.2s at 1.0s interval -> {forced_hits} forced passes "
        f"(last at {elapsed:.2f}s), motion passes in same period={motion_added}, "
        f"state={s.state.value}, score={s.change_score:.6f}",
    )


def test_moving_object_triggers_motion_path():
    gate = Gate()
    gate.configure_camera(CameraGateConfig(camera_id="moving", forced_override_interval=9999))
    base = static_scene()
    for _ in range(80):
        gate.process_frame("moving", with_noise(base))

    motion_passes = 0
    for i in range(60):
        frame = add_moving_box(with_noise(base), x=40 + i * 9)
        r = gate.process_frame("moving", frame)
        if r is not None and r.trigger_reason is TriggerReason.MOTION:
            motion_passes += 1

    s = gate.stats("moving")
    ok = motion_passes >= 20
    assert _report(
        "moving object triggers ACTIVE + motion path",
        ok,
        f"60 frames with a translating box -> {motion_passes} motion passes, "
        f"state={s.state.value}, score={s.change_score:.6f}",
    )


def test_hysteresis_does_not_flap():
    """Borderline oscillating score must not flip state every frame."""
    hy = HysteresisStateMachine(
        enter_threshold=0.010, exit_threshold=0.004,
        enter_confirm_frames=2, exit_confirm_frames=5,
    )
    # Oscillate tightly around the enter threshold.
    scores = [0.0102 if i % 2 == 0 else 0.0098 for i in range(200)]
    for sc in scores:
        hy.update(sc)
    naive_flips = sum(
        1 for i in range(1, len(scores))
        if (scores[i] >= 0.010) != (scores[i - 1] >= 0.010)
    )
    ok = hy.transition_count <= 2
    assert _report(
        "hysteresis suppresses flapping",
        ok,
        f"200 frames oscillating across the threshold -> {hy.transition_count} real "
        f"transitions (a naive threshold would flip {naive_flips} times)",
    )


def test_hysteresis_responds_to_real_step():
    hy = HysteresisStateMachine(0.010, 0.004, 2, 5)
    for _ in range(20):
        hy.update(0.0001)
    assert hy.state is GateState.IDLE
    for _ in range(3):
        hy.update(0.25)
    entered = hy.state is GateState.ACTIVE
    for _ in range(8):
        hy.update(0.0001)
    exited = hy.state is GateState.IDLE
    assert _report(
        "hysteresis still responds to a genuine step change",
        entered and exited,
        f"quiet->loud entered ACTIVE={entered}, loud->quiet returned IDLE={exited}",
    )


def test_day_night_drift_no_false_positive_storm():
    """Gradual global brightness drift must not read as sustained motion."""
    gate = Gate()
    gate.configure_camera(CameraGateConfig(camera_id="drift", forced_override_interval=9999))
    passes = 0
    for i in range(400):
        brightness = int(150 - (i / 400.0) * 110)  # day -> dusk
        frame = with_noise(static_scene(brightness))
        if gate.process_frame("drift", frame) is not None:
            passes += 1
    s = gate.stats("drift")
    ok = passes <= 20
    assert _report(
        "day->night drift does not storm",
        ok,
        f"400 frames drifting brightness 150->40 -> {passes} passes "
        f"({passes / 4.0:.1f}% of frames), transitions={s.state_transitions}",
    )


def test_forced_interval_matches_risk_tier():
    cfg = ContextSettings()
    cases = [
        (1.0, "high", cfg.forced_interval_high),
        (0.85, "high", cfg.forced_interval_high),
        (0.6, "medium", cfg.forced_interval_medium),
        (0.4, "medium", cfg.forced_interval_medium),
        (0.2, "low", cfg.forced_interval_low),
        (None, "uncalibrated", cfg.forced_interval_uncalibrated),
    ]
    rows, ok = [], True
    for weight, want_tier, want_interval in cases:
        interval, tier = interval_for_risk_weight(weight, cfg)
        good = tier == want_tier and interval == want_interval
        ok &= good
        rows.append(f"risk={weight} -> {tier}/{interval:.0f}s {'ok' if good else 'WRONG'}")
    assert _report("forced-override interval per risk tier", ok, "; ".join(rows))


def test_forced_timer_independent_of_state():
    """The timer must fire regardless of IDLE/ACTIVE — it has no view of state."""
    now = [0.0]
    t = ForcedOverrideTimer(5.0, "medium", clock=lambda: now[0])
    fired_first = t.should_fire()
    t.fire()
    now[0] = 4.9
    not_yet = not t.should_fire()
    now[0] = 5.1
    fired_again = t.should_fire()
    assert _report(
        "forced timer fires on schedule, independent of motion state",
        fired_first and not_yet and fired_again,
        f"fires at t=0: {fired_first}; suppressed at t=4.9: {not_yet}; "
        f"fires at t=5.1: {fired_again}",
    )


def test_multi_camera_cost_stays_flat():
    """Core value proposition: per-camera Gate cost must not grow with camera count."""
    base = static_scene()
    # Pre-generate frames. Generating them inside the timed loop measures numpy
    # noise synthesis (~10ms/frame), which swamps the Gate by an order of
    # magnitude and makes the result meaningless.
    pool = [with_noise(base) for _ in range(40)]

    def per_frame_median(n_cams: int) -> float:
        """Median per-frame Gate cost. Median, not mean, and repeated trials:
        this runs on a shared machine, and a single OS scheduling stall in one
        trial otherwise dominates the result. The property under test is that
        per-camera cost does not GROW with camera count."""
        trials = []
        for _ in range(3):
            gate = Gate()
            cams = [f"cam{i}" for i in range(n_cams)]
            for c in cams:
                gate.configure_camera(
                    CameraGateConfig(camera_id=c, forced_override_interval=9999)
                )
                for f in pool[:30]:
                    gate.process_frame(c, f)
            samples = []
            for f in pool:
                for c in cams:
                    t0 = time.perf_counter()
                    gate.process_frame(c, f)
                    samples.append((time.perf_counter() - t0) * 1000.0)
            samples.sort()
            trials.append(samples[len(samples) // 2])
        trials.sort()
        return trials[1]

    timings = {n: per_frame_median(n) for n in (1, 4, 16)}

    # The requirement is that per-camera cost stays within budget as camera
    # count grows -- i.e. O(1) per camera, not O(N). A tight ratio bound is not
    # a usable instrument on a loaded shared machine, so the budget is the
    # primary assertion and the ratio carries a generous tolerance.
    within_budget = all(ms < 5.0 for ms in timings.values())
    not_superlinear = timings[16] < timings[1] * 3.0
    assert _report(
        "multi-camera cost stays flat per frame",
        within_budget and not_superlinear,
        " | ".join(f"{n} cam(s): {ms:.3f} ms/frame" for n, ms in timings.items())
        + f"  (budget <5ms/frame: {within_budget}; "
        f"16v1 ratio={timings[16] / timings[1]:.2f}x, tolerance 3.0x)",
    )


ALL = [
    test_static_scene_stays_idle,
    test_steady_fire_passes_via_forced_override,
    test_moving_object_triggers_motion_path,
    test_hysteresis_does_not_flap,
    test_hysteresis_responds_to_real_step,
    test_day_night_drift_no_false_positive_storm,
    test_forced_interval_matches_risk_tier,
    test_forced_timer_independent_of_state,
    test_multi_camera_cost_stays_flat,
]

if __name__ == "__main__":
    print("=" * 78)
    print("GATE VALIDATION — Gate Module Reference & Build Plan, Section D")
    print("=" * 78)
    failures = 0
    for fn in ALL:
        try:
            fn()
        except AssertionError:
            failures += 1
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"  [ERROR] {fn.__name__}: {type(exc).__name__}: {exc}")
    print("=" * 78)
    print(f"RESULT: {len(ALL) - failures}/{len(ALL)} checks passed")
    print("=" * 78)
    sys.exit(1 if failures else 0)
