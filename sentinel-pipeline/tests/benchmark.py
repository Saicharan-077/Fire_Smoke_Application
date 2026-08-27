"""
Per-stage latency benchmark (Master Pipeline Document, Section 9).

Reports PERCENTILES, not averages: for a disaster-detection system the
worst-case frame matters more than the typical one.

    python tests/benchmark.py [--cameras 16] [--frames 120]

NOTE: run on the ACTUAL deployment hardware. Numbers from a dev machine with a
discrete GPU do not transfer to a CPU-only target -- see docs/TODO_ACTION_ITEMS.md.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sentinel_pipeline.gate.gate import Gate  # noqa: E402
from sentinel_pipeline.gate.gate_config import CameraGateConfig  # noqa: E402
from sentinel_pipeline.pipeline import Pipeline  # noqa: E402
from tests.fixtures import frame_paths  # noqa: E402

BUDGETS = {  # Section 9 per-stage budgets, in ms
    "gate": 5.0,
    "context": 1.0,
}


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    k = (len(values) - 1) * (p / 100.0)
    lo, hi = int(k), min(int(k) + 1, len(values) - 1)
    s = sorted(values)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def row(name: str, vals: list[float], budget: float | None = None) -> None:
    if not vals:
        print(f"  {name:<22} no samples")
        return
    p50, p95, p99 = pct(vals, 50), pct(vals, 95), pct(vals, 99)
    verdict = ""
    if budget is not None:
        verdict = "  OK" if p95 <= budget else f"  OVER BUDGET ({budget:.0f}ms)"
    print(
        f"  {name:<22} n={len(vals):<5} "
        f"p50={p50:7.2f}  p95={p95:7.2f}  p99={p99:7.2f}  "
        f"max={max(vals):7.2f} ms{verdict}"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cameras", type=int, default=16)
    ap.add_argument("--frames", type=int, default=120)
    args = ap.parse_args()

    import cv2

    paths = frame_paths()
    frames = [cv2.imread(p) for p in paths]
    frames = [f for f in frames if f is not None]

    print("=" * 78)
    print("PIPELINE LATENCY BENCHMARK")
    print("=" * 78)

    pipe = Pipeline()
    info = pipe.model.info()
    print(f"  device={info.device}  arch={info.architecture}  imgsz={info.imgsz}  "
          f"conf={info.conf_threshold}")
    print(f"  frames={len(frames)} source images, {args.frames} iterations\n")

    # --- Stage 1: Gate ---
    gate = Gate()
    gate.configure_camera(CameraGateConfig(camera_id="bench", forced_override_interval=9999))
    for f in frames:
        gate.process_frame("bench", f)
    gate_ms: list[float] = []
    for i in range(args.frames):
        f = frames[i % len(frames)]
        t = time.perf_counter()
        gate.process_frame("bench", f)
        gate_ms.append((time.perf_counter() - t) * 1000)

    # --- Stage 2+: full post-gate path ---
    pipe.register_camera("bench2")
    for _ in range(3):
        pipe.process_frame("bench2", frames[0], source_type="bench", bypass_gate=True)

    full_ms: list[float] = []
    model_before = len(pipe.model._latency_ms)
    for i in range(args.frames):
        f = frames[i % len(frames)]
        t = time.perf_counter()
        pipe.process_frame("bench2", f, source_type="bench", bypass_gate=True)
        full_ms.append((time.perf_counter() - t) * 1000)
    model_ms = pipe.model._latency_ms[model_before:]

    print("PER-STAGE LATENCY")
    row("Gate", gate_ms, BUDGETS["gate"])
    row("Model (YOLO)", model_ms)
    downstream = [max(0.0, f - m) for f, m in zip(full_ms, model_ms)] if model_ms else []
    row("Track+Classify+Ctx", downstream)
    row("Full post-gate path", full_ms)

    # --- Multi-camera Gate scaling ---
    print("\nMULTI-CAMERA GATE SCALING (the core value proposition)")
    static = np.full((360, 640, 3), 90, dtype=np.uint8)
    rng = np.random.default_rng(1)
    pool = [
        np.clip(static.astype(np.float32) + rng.normal(0, 1.5, static.shape), 0, 255).astype(np.uint8)
        for _ in range(40)
    ]
    for n in (1, 4, 16, args.cameras) if args.cameras not in (1, 4, 16) else (1, 4, 16):
        g = Gate()
        cams = [f"c{i}" for i in range(n)]
        for c in cams:
            g.configure_camera(CameraGateConfig(camera_id=c, forced_override_interval=9999))
            for f in pool[:30]:
                g.process_frame(c, f)
        per: list[float] = []
        for f in pool:
            for c in cams:
                t = time.perf_counter()
                g.process_frame(c, f)
                per.append((time.perf_counter() - t) * 1000)
        row(f"{n:>3} camera(s)", per, BUDGETS["gate"])

    # --- Throughput headroom ---
    print("\nCAPACITY ESTIMATE")
    if model_ms:
        m50 = pct(model_ms, 50)
        g50 = pct(gate_ms, 50)
        print(f"  Gate p50           {g50:.3f} ms  -> one core gates "
              f"~{1000.0 / g50:,.0f} frames/s")
        print(f"  Model p50          {m50:.2f} ms  -> ~{1000.0 / m50:,.1f} inferences/s "
              f"on {info.device}")
        print(f"  At a 10% Gate promotion rate, one Model can serve roughly "
              f"{(1000.0 / m50) / 0.10 / 15:,.0f} cameras at 15 fps.")
        print("  Treat as an upper bound: single-stream, no contention, dev hardware.")

    print("\n" + "=" * 78)
    print("Percentiles, not averages. Re-run on the real deployment target.")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
