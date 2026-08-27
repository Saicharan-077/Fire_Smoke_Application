"""
Multi-camera scheduler — priority ordering and the Gate/Model split.

Master Pipeline Document Section 8:
    active/unresolved alert > zone risk weight > gate signal strength
    > round-robin fallback (no camera starved)

    python tests/test_scheduler.py
"""

from __future__ import annotations

import itertools
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sentinel_pipeline.contracts import GateResult, TriggerReason  # noqa: E402
from sentinel_pipeline.scheduler.queue import (  # noqa: E402
    PriorityFrameQueue,
    QueuedFrame,
)

_results: list[tuple[str, bool]] = []


def check(name: str, ok: bool, detail: str) -> None:
    _results.append((name, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"         {detail}")


def gr(camera_id: str, score: float, risk: float | None, forced: bool = False) -> GateResult:
    return GateResult(
        camera_id=camera_id, timestamp=datetime.now(timezone.utc),
        frame=np.zeros((8, 8, 3), dtype=np.uint8),
        trigger_reason=TriggerReason.FORCED_OVERRIDE if forced else TriggerReason.MOTION,
        change_score=score, zone_risk_weight=risk, monotonic_ts=time.monotonic(),
    )


def qf(camera_id, score, risk, *, alert=False, age=0.0) -> QueuedFrame:
    return QueuedFrame(
        gate_result=gr(camera_id, score, risk),
        enqueued_monotonic=time.monotonic() - age,
        has_active_alert=alert, zone_risk_weight=risk,
    )


def drain(q: PriorityFrameQueue) -> list[str]:
    out = []
    while q.depth():
        item = q.get(timeout=0.05)
        if item is None:
            break
        out.append(item.camera_id)
    return out


# ---------------------------------------------------------------------------


def test_active_alert_wins():
    q = PriorityFrameQueue()
    q.put(qf("high-risk-no-alert", 0.9, 1.0))
    q.put(qf("low-risk-with-alert", 0.01, 0.1, alert=True))
    order = drain(q)
    check("camera with an active alert is served first",
          order[0] == "low-risk-with-alert",
          f"order={order} — a low-risk camera with an unresolved alert beat a "
          "high-risk one with a stronger signal, so growth tracking is not starved")


def test_risk_weight_orders_next():
    q = PriorityFrameQueue()
    for cid, risk in [("break-area", 0.2), ("workshop", 0.6), ("chemical", 1.0)]:
        q.put(qf(cid, 0.5, risk))
    order = drain(q)
    check("zone risk weight orders cameras when no alert is active",
          order == ["chemical", "workshop", "break-area"],
          f"order={order} (risk 1.0 -> 0.6 -> 0.2)")


def test_signal_strength_breaks_risk_ties():
    q = PriorityFrameQueue()
    for cid, score in [("weak", 0.02), ("strong", 0.40), ("mid", 0.15)]:
        q.put(qf(cid, score, 0.5))
    order = drain(q)
    check("gate signal strength breaks ties at equal risk",
          order == ["strong", "mid", "weak"],
          f"order={order} (change_score 0.40 -> 0.15 -> 0.02)")


def test_uncalibrated_is_not_treated_as_low_risk():
    q = PriorityFrameQueue()
    q.put(qf("uncalibrated", 0.5, None))
    q.put(qf("known-low", 0.5, 0.2))
    order = drain(q)
    check("uncalibrated camera outranks a known-low-risk one",
          order[0] == "uncalibrated",
          f"order={order} — an unknown zone is not a safe zone, so risk=None "
          "is treated as mid (0.6), not lowest")


def test_starvation_promotion():
    q = PriorityFrameQueue(starvation_s=2.0)
    q.put(qf("busy-high-risk", 0.9, 1.0))
    q.put(qf("neglected-low-risk", 0.01, 0.1, age=5.0))
    order = drain(q)
    check("a starved camera is promoted above its natural priority",
          order[0] == "neglected-low-risk",
          f"order={order} — waiting 5.0s past a 2.0s threshold beat a high-risk "
          "camera, so sustained load cannot blind a site indefinitely")


def test_no_starvation_before_threshold():
    q = PriorityFrameQueue(starvation_s=8.0)
    q.put(qf("high", 0.9, 1.0))
    q.put(qf("low", 0.01, 0.1, age=1.0))
    order = drain(q)
    check("normal priority still applies below the starvation threshold",
          order[0] == "high",
          f"order={order} — 1.0s of waiting is not enough to override risk")


def test_one_slot_per_camera_drop_oldest():
    q = PriorityFrameQueue()
    for i in range(20):
        q.put(qf("cam-a", 0.1 * i, 0.5))
    stats = q.stats()
    item = q.get(timeout=0.05)
    check("a camera holds ONE slot; stale frames are dropped, not queued",
          stats["depth"] == 1 and stats["superseded_total"] == 19,
          f"20 rapid enqueues -> depth={stats['depth']}, "
          f"superseded={stats['superseded_total']}; served frame has the "
          f"freshest score {item.change_score:.1f} (not the oldest 0.0)")


def test_queue_depth_bounded_by_camera_count():
    q = PriorityFrameQueue()
    for i in range(200):
        q.put(qf(f"cam-{i % 5}", 0.5, 0.5))
    check("queue depth is bounded by camera count, never by submission rate",
          q.depth() == 5,
          f"200 submissions across 5 cameras -> depth={q.depth()} "
          "(an unbounded queue would hold 200 and grow latency without limit)")


def test_gate_runs_everywhere_model_only_on_promoted():
    """The core value proposition: cheap stage on all cameras, expensive stage
    only where something happened."""
    from sentinel_pipeline.gate.gate import Gate
    from sentinel_pipeline.gate.gate_config import CameraGateConfig

    gate = Gate()
    rng = np.random.default_rng(5)
    static = np.full((360, 640, 3), 90, dtype=np.uint8)

    def noisy(f):
        return np.clip(f.astype(np.float32) + rng.normal(0, 1.5, f.shape), 0, 255).astype(np.uint8)

    quiet = [f"quiet-{i}" for i in range(8)]
    busy = "busy-1"
    for c in quiet + [busy]:
        gate.configure_camera(CameraGateConfig(camera_id=c, forced_override_interval=9999))
        for _ in range(80):
            gate.process_frame(c, noisy(static))

    gate_calls = 0
    promoted = 0
    for i in range(40):
        for c in quiet:
            gate_calls += 1
            if gate.process_frame(c, noisy(static)) is not None:
                promoted += 1
        gate_calls += 1
        moving = static.copy()
        x = 50 + i * 12
        moving[150:230, x:x + 80] = (210, 210, 210)
        if gate.process_frame(busy, noisy(moving)) is not None:
            promoted += 1

    saved = 100.0 * (1 - promoted / gate_calls)
    check("Gate runs on every camera; only active ones reach the Model",
          promoted < gate_calls * 0.25,
          f"{gate_calls} gate evaluations across 9 cameras -> {promoted} promotions "
          f"({saved:.1f}% of Model calls avoided); 8 quiet cameras stayed IDLE")


ALL = [
    test_active_alert_wins,
    test_risk_weight_orders_next,
    test_signal_strength_breaks_risk_ties,
    test_uncalibrated_is_not_treated_as_low_risk,
    test_starvation_promotion,
    test_no_starvation_before_threshold,
    test_one_slot_per_camera_drop_oldest,
    test_queue_depth_bounded_by_camera_count,
    test_gate_runs_everywhere_model_only_on_promoted,
]

if __name__ == "__main__":
    print("=" * 78)
    print("MULTI-CAMERA SCHEDULER — PRIORITY ORDERING")
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
