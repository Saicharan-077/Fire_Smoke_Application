"""
G4 (equal-size motion pairs) and G6 (duration-bounded history) — closure tests.

The G4 tests do not merely inspect shapes: they run the actual
`cv2.calcOpticalFlowFarneback` call Phase 3 specifies, on real pipeline output,
and check that a KNOWN synthetic displacement is recovered correctly. A shape
assertion alone would not catch the distortion this gap was about.

    python tests/test_g4_g6_closure.py
"""

from __future__ import annotations

import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sentinel_pipeline.config import TrackingSettings  # noqa: E402
from sentinel_pipeline.contracts import BBox, ModelCandidate, RawClass  # noqa: E402
from sentinel_pipeline.tracking.tracker import TrackingLayer  # noqa: E402

_results: list[tuple[str, bool]] = []
RNG = np.random.default_rng(11)


def check(name: str, ok: bool, detail: str) -> None:
    _results.append((name, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"         {detail}")


def textured_frame(w: int = 1280, h: int = 720) -> np.ndarray:
    """Textured background — Farneback needs gradients to track."""
    base = RNG.integers(40, 200, (h, w, 3), dtype=np.uint8)
    return cv2.GaussianBlur(base, (7, 7), 0)


def place_object(frame: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    """Paste a distinctive textured patch so flow has something to lock onto."""
    out = frame.copy()
    patch = RNG.integers(180, 255, (h, w, 3), dtype=np.uint8)
    patch = cv2.GaussianBlur(patch, (5, 5), 0)
    hh, ww = out.shape[:2]
    x, y = max(0, min(x, ww - w)), max(0, min(y, hh - h))
    out[y:y + h, x:x + w] = patch
    return out


def cand(bbox: BBox, ts: float) -> ModelCandidate:
    return ModelCandidate(
        camera_id="c", timestamp=datetime.now(timezone.utc), monotonic_ts=ts,
        bbox=bbox, class_raw=RawClass.FIRE, confidence_raw=0.8,
    )


# ---------------------------------------------------------------------------
# G4
# ---------------------------------------------------------------------------


def test_motion_crops_are_dimensionally_identical():
    print("\n-- G4: equal-size crop pairs --")
    tracking = TrackingLayer(TrackingSettings())
    bg = textured_frame()

    # A GROWING candidate — the exact case that produced mismatched sizes.
    sizes, epochs = [], []
    for i in range(12):
        side = 200 + i * 12          # 200 -> 332 px, grows every frame
        frame = place_object(bg, 500, 300, side, side)
        out = tracking.update("c", frame, [cand(BBox(500, 300, 500 + side, 300 + side), 100.0 + i * 0.1)])
        snap = out[0].history[-1]
        sizes.append(snap.motion_crop.shape)
        epochs.append(snap.motion_epoch)

    per_epoch: dict[int, set] = {}
    for shp, ep in zip(sizes, epochs):
        per_epoch.setdefault(ep, set()).add(shp)
    consistent = all(len(v) == 1 for v in per_epoch.values())

    check("motion crops are identical in size within each epoch",
          consistent,
          "; ".join(f"epoch {e}: {len(s)} distinct shape(s) {s}" for e, s in per_epoch.items())
          + f"  (bbox grew 200px -> 332px across {len(sizes)} frames)")

    check("bbox outgrowing the window re-anchors into a new epoch (never silent)",
          len(per_epoch) > 1,
          f"epochs observed: {sorted(per_epoch)} — growth forced "
          f"{len(per_epoch) - 1} documented re-anchor(s)")


def test_farneback_actually_runs_and_recovers_displacement():
    """The real check: run Phase 3's actual algorithm on pipeline output and
    confirm a known displacement comes back correct."""
    print("\n-- G4: Farneback on real pipeline output --")
    tracking = TrackingLayer(TrackingSettings())
    bg = textured_frame()

    TRUE_DX = 24  # world pixels of movement between the two frames
    box_w = box_h = 180

    f1 = place_object(bg, 400, 300, box_w, box_h)
    tracking.update("c", f1, [cand(BBox(400, 300, 400 + box_w, 300 + box_h), 200.0)])

    f2 = place_object(bg, 400 + TRUE_DX, 300, box_w, box_h)
    out = tracking.update(
        "c", f2, [cand(BBox(400 + TRUE_DX, 300, 400 + TRUE_DX + box_w, 300 + box_h), 200.1)]
    )

    tr = tracking.get_track("c", out[0].track_id)
    a, b = tr.history[-2], tr.history[-1]

    same_epoch = a.motion_epoch == b.motion_epoch
    same_shape = a.motion_crop.shape == b.motion_crop.shape

    if not (same_epoch and same_shape):
        check("Farneback precondition holds", False,
              f"epochs {a.motion_epoch}/{b.motion_epoch}, "
              f"shapes {a.motion_crop.shape}/{b.motion_crop.shape}")
        return

    # This is the call Phase 3 specifies. It raises if dimensions differ.
    flow = cv2.calcOpticalFlowFarneback(
        a.motion_crop, b.motion_crop, None,
        pyr_scale=0.5, levels=3, winsize=25, iterations=3,
        poly_n=5, poly_sigma=1.2, flags=0,
    )
    check("cv2.calcOpticalFlowFarneback accepts the crop pair unmodified",
          True,
          f"both {a.motion_crop.shape}, epoch {a.motion_epoch}, "
          f"flow field {flow.shape}")

    # Recover displacement from the moving region, then undo the epoch scale.
    mag = np.linalg.norm(flow, axis=2)
    moving = mag > np.percentile(mag, 92)
    measured_dx_scaled = float(np.median(flow[..., 0][moving])) if moving.any() else 0.0
    measured_dx_world = measured_dx_scaled / b.motion_scale

    err = abs(measured_dx_world - TRUE_DX)
    check("measured displacement matches TRUE world displacement",
          err <= 6.0,
          f"true dx={TRUE_DX}px, measured={measured_dx_world:.1f}px world "
          f"(={measured_dx_scaled:.1f}px in-crop / motion_scale={b.motion_scale:.4f}), "
          f"error={err:.1f}px")

    dt = b.monotonic_ts - a.monotonic_ts
    check("velocity is derivable from displacement and real elapsed time",
          dt > 0 and abs((measured_dx_world / dt) - (TRUE_DX / dt)) <= 60.0,
          f"dt={dt:.3f}s -> measured {measured_dx_world / dt:.0f} px/s "
          f"vs true {TRUE_DX / dt:.0f} px/s")


def test_window_does_not_follow_the_object():
    """A centroid-following window would cancel linear motion and make a moving
    vehicle read as motionless — destroying the signal Phase 3 relies on."""
    print("\n-- G4: window is stationary within an epoch --")
    tracking = TrackingLayer(TrackingSettings())
    bg = textured_frame()
    origins = []
    for i in range(6):
        x = 400 + i * 10
        frame = place_object(bg, x, 300, 160, 160)
        out = tracking.update("c", frame, [cand(BBox(x, 300, x + 160, 460), 300.0 + i * 0.1)])
        s = out[0].history[-1]
        origins.append((s.motion_epoch, s.motion_window_origin))

    first_epoch = origins[0][0]
    same_epoch_origins = {o for e, o in origins if e == first_epoch}
    check("window origin is frozen while the object moves inside it",
          len(same_epoch_origins) == 1,
          f"object translated 50px; window origin(s) within epoch {first_epoch}: "
          f"{same_epoch_origins} (a following window would have moved with it)")


# ---------------------------------------------------------------------------
# G6
# ---------------------------------------------------------------------------


def test_history_is_duration_bounded_not_frame_bounded():
    print("\n-- G6: duration-bounded history --")
    cfg = TrackingSettings(history_window_s=2.0)
    bg = textured_frame(640, 480)
    frame = place_object(bg, 200, 150, 120, 120)
    box = BBox(200, 150, 320, 270)

    rows = []
    for rate in (4.0, 15.0, 30.0, 60.0):
        tracking = TrackingLayer(cfg)
        t = 500.0
        # Feed 6 seconds of frames at this rate.
        for _ in range(int(6.0 * rate)):
            out = tracking.update("c", frame, [cand(box, t)])
            t += 1.0 / rate
        tr = tracking.get_track("c", out[0].track_id)
        span = tr.history_span_s()
        rows.append((rate, len(tr.history), span, tr.history_rate_hz()))
        print(f"         {rate:5.1f} fps -> {len(tr.history):4d} samples, "
              f"span={span:.3f}s, measured_rate={tr.history_rate_hz():.1f} Hz")

    all_in_window = all(s <= 2.0 + 1e-6 for _, _, s, _ in rows)
    check("history span stays within the configured window at every frame rate",
          all_in_window,
          f"window=2.0s; spans observed: {[round(s, 3) for _, _, s, _ in rows]} "
          "(a frame-count cap would give 15s at 4fps and 2s at 30fps)")

    counts = [n for _, n, _, _ in rows]
    check("sample COUNT varies with rate while DURATION stays fixed",
          len(set(counts)) > 1,
          f"counts {counts} across 4/15/30/60 fps — the buffer holds a fixed "
          "amount of TIME, not a fixed number of frames")

    rate_ok = all(abs(measured - rate) / rate < 0.15 for rate, _, _, measured in rows)
    check("measured sample rate is reported accurately for insufficient_history checks",
          rate_ok,
          "; ".join(f"{r:.0f}fps->{m:.1f}Hz" for r, _, _, m in rows))


def test_dropped_frames_do_not_stretch_the_window():
    """The failure a frame-count cap hides: if a source stalls, 60 frames can
    span half a minute and the 'window' silently becomes meaningless."""
    print("\n-- G6: behaviour under a stalling source --")
    tracking = TrackingLayer(TrackingSettings(history_window_s=2.0))
    bg = textured_frame(640, 480)
    frame = place_object(bg, 200, 150, 120, 120)
    box = BBox(200, 150, 320, 270)

    t = 900.0
    for _ in range(60):  # healthy 30fps
        out = tracking.update("c", frame, [cand(box, t)])
        t += 1 / 30.0
    tr = tracking.get_track("c", out[0].track_id)
    healthy = (len(tr.history), tr.history_span_s())

    for _ in range(10):  # source stalls to 1fps
        out = tracking.update("c", frame, [cand(box, t)])
        t += 1.0
    stalled = (len(tr.history), tr.history_span_s())

    check("a stalling source shrinks the sample count, not the window duration",
          stalled[1] <= 2.0 + 1e-6 and stalled[0] < healthy[0],
          f"30fps: {healthy[0]} samples/{healthy[1]:.2f}s  ->  "
          f"1fps: {stalled[0]} samples/{stalled[1]:.2f}s "
          "(frame-count cap would have reported a 60s 'window')")


def test_contract_exposes_window_characteristics():
    print("\n-- G6: what Phase 4 needs to judge sufficiency --")
    tracking = TrackingLayer(TrackingSettings(history_window_s=2.0))
    bg = textured_frame(640, 480)
    frame = place_object(bg, 200, 150, 120, 120)
    box = BBox(200, 150, 320, 270)
    t = 700.0
    for _ in range(45):
        out = tracking.update("c", frame, [cand(box, t)])
        t += 1 / 30.0
    ci = out[0]
    check("ClassifierInput reports window, span and measured rate",
          ci.history_window_s == 2.0 and ci.history_span_s > 0 and ci.history_sample_rate_hz > 0,
          f"history_window_s={ci.history_window_s} "
          f"history_span_s={ci.history_span_s:.3f} "
          f"history_sample_rate_hz={ci.history_sample_rate_hz:.1f} "
          f"len(history)={len(ci.history)} motion_epoch={ci.motion_epoch}")

    nyquist = ci.history_sample_rate_hz / 2.0
    check("Phase 4 can detect the Nyquist shortfall from the contract alone",
          nyquist > 0,
          f"measured {ci.history_sample_rate_hz:.1f} Hz -> Nyquist "
          f"{nyquist:.1f} Hz vs the 5-10 Hz band: "
          f"{'ADEQUATE' if nyquist >= 10 else 'INSUFFICIENT -> insufficient_history'}")


ALL = [
    test_motion_crops_are_dimensionally_identical,
    test_farneback_actually_runs_and_recovers_displacement,
    test_window_does_not_follow_the_object,
    test_history_is_duration_bounded_not_frame_bounded,
    test_dropped_frames_do_not_stretch_the_window,
    test_contract_exposes_window_characteristics,
]

if __name__ == "__main__":
    print("=" * 78)
    print("G4 / G6 CLOSURE")
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
