# Gate Module — Reference Document & Build Plan

---

# PART 1 — Reference Document

## 1. Purpose

The Gate is the first stage of the detection pipeline (`Gate → Model → Classifier → Context Engine`). It exists to:

- **Reduce compute cost** — avoid running the expensive Model (YOLO) on frames where nothing meaningful is happening.
- **Enable multi-camera scalability** — since the Gate is cheap enough to run continuously on every camera at once, it's what lets the system monitor many streams without needing to run the Model on all of them simultaneously.
- **Preserve responsiveness** — spending Model compute only on frames that actually changed means faster reaction to real events instead of working through redundant, unchanged frames.
- **Never create a blind spot** — a fire producing a stable, unchanging image (steady flame, minimal visible motion) must still eventually get seen. The Gate filters out *boring* frames — it must never gamble on something dangerous but visually static.

## 2. Responsibilities / Operations

1. **Frame acquisition & lightweight preprocessing** — grayscale conversion, aggressive downsampling, mild blur, optional CLAHE contrast enhancement for low-light/foggy/high-glare footage.
2. **Reference/background maintenance per camera** — a running background model that updates over time so gradual lighting shifts (day → dusk) don't get misread as constant motion.
3. **Change scoring** — a numeric score representing how much the current frame differs from the reference.
4. **Threshold decision with hysteresis** — pass/skip decision with a higher bar to enter "active" state and a lower bar to drop back to "idle," preventing rapid flapping from borderline noise.
5. **Per-camera adaptive threshold** — no single global threshold works across cameras with different noise floors and scene busyness (e.g. outdoor camera with swaying trees vs. static indoor storage room).
6. **Forced periodic override** — regardless of motion score, force a frame through to the Model at a fixed interval. This is the fix for the confirmed bug where a steady/static fire source never crosses a motion threshold and is never seen.
7. **Handoff to the scheduler** — when a frame passes (via motion trigger or forced override), enqueue it with metadata for the Model stage's priority queue.
8. **Stay cheap enough to run on every camera, continuously** — a hard constraint. If the Gate becomes expensive, its entire purpose is defeated.

## 3. Technique Decision

| Technique | Cost | Verdict |
|---|---|---|
| Frame differencing | Extremely cheap | Too sensitive to noise/lighting flicker — not chosen as primary |
| **Background subtraction (MOG2 / KNN)** | Cheap | **Chosen** — robust to gradual lighting drift, standard OpenCV support, real-time capable |
| Optical flow (whole-frame) | Heavier | Overkill for "did something change" — deferred; a scoped version is instead used later inside the *Classifier*, only on small candidate crops, to check motion pattern (chaotic/upward = smoke-like vs. linear = rigid object) |
| Camera-native motion metadata (ONVIF etc.) | Free | Use as a first-pass signal when available; fall back to background subtraction otherwise |
| Tiny learned change-detector | Cheap but non-zero | Rejected — breaks the "no AI outside the Model stage" principle; not needed unless classical methods prove insufficient |

**Chosen approach:** Background subtraction (MOG2 or KNN) on a heavily downsampled, grayscale, optionally CLAHE-enhanced frame, with hysteresis-based state and a forced periodic override.

## 4. State Machine

Two states per camera: **IDLE** and **ACTIVE**.

- Enter ACTIVE when change score exceeds the upper threshold.
- Return to IDLE only when change score drops below a lower threshold (hysteresis gap prevents flapping on borderline noise).
- Independent of state, a **forced override timer** fires on its own schedule and pushes a frame through regardless of current score/state.

This maps to the existing Dashboard tile UI already observed in testing ("IDLE" badge, Pixel Change %, Motion Score %) — the state machine concept is already partially reflected in the UI; what's missing is item 6 above (forced override) and a single consolidated implementation (see Section 7 — Known Issue below).

## 5. Forced Override Interval — Locked Decision

Tied to zone risk weight (from the Context Engine's zone config) rather than one global constant:

| Zone risk tier | Forced check interval | Reasoning |
|---|---|---|
| High risk (risk_weight ≥ 0.8) — e.g. chemical storage | Every 5–10 sec | Can't afford a long blind window in a high-consequence area |
| Medium risk (0.4–0.8) | Every 20–30 sec | Balanced — most real fires don't stay perfectly static that long anyway |
| Low risk (< 0.4) — e.g. outdoor break area | Every 60 sec | Minimizes unnecessary Model calls in low-consequence zones |
| Uncalibrated (no zone assigned yet) | 15–20 sec default | Conservative fallback until calibration assigns a real risk tier |

- Operator can override the zone-derived default per camera.
- Not adaptive for the MVP — fixed interval per tier. Adaptive shortening after nearby activity is a future refinement, not required now.

## 6. Preprocessing Pipeline (shared, borrowed from industrial reference research)

Applied before both the Gate and the Model consume a frame:
- Downsample aggressively (e.g. to ~160×90 for Gate scoring — full resolution isn't needed to detect "did something change")
- Grayscale conversion
- Mild Gaussian blur (suppresses sensor noise)
- CLAHE (Contrast Limited Adaptive Histogram Equalization) for low-light/foggy/high-glare conditions — directly relevant since night footage is a real deployment scenario for fire/smoke detection

## 7. Known Issue This Module Must Fix

**Confirmed via testing:** a phone camera showing an actual, visible fire at 55 FPS stayed marked **IDLE** with Motion Score 0.2% / Pixel Change 0.4% — meaning inference likely never ran even once on a steady fire source.

**Also confirmed via code audit:** motion-filtering / frame-skip logic currently exists in **multiple separate, inconsistent places**:
- `LiveMonitoring.tsx` — hardcoded `frameSkip = 15`
- `Detection.tsx` — its own frame-skip logic
- `upload_routes.py` — separate `mad < 1.0` static-detection threshold for video jobs
- Dashboard camera tiles — apparently compute their own Motion Score/IDLE badge independently (traced but not yet fully confirmed which code path owns this)
- DB setting `enable_motion_filtering` — a global on/off flag, not per-camera

**This is a required part of the build, not optional cleanup:** the new Gate module should **replace and consolidate** these scattered implementations into one shared module used by every entry point (webcam, RTSP, video upload, Dashboard tiles) — not exist alongside them as a fifth parallel system.

## 8. Output Interface (Gate → Scheduler → Model)

Each time the Gate passes a frame, it should hand off:
```
{
  camera_id: string,
  timestamp: datetime,
  frame: <preprocessed frame reference>,
  trigger_reason: "motion" | "forced_override",
  change_score: float,
  zone_risk_weight: float   // for scheduler priority use
}
```

## 9. Relationship to Multi-Camera Scheduling (downstream, not built in this module)

The Gate runs independently and continuously per camera. When multiple cameras pass frames at once and Model throughput can't serve all simultaneously, a **priority queue** (separate component, downstream of the Gate) orders them by: active/unresolved alert on that camera > zone risk weight > recency/strength of trigger > round-robin fallback. The Gate itself does not need to implement this — it only needs to emit the metadata (`zone_risk_weight`, `trigger_reason`) the scheduler will consume.

---

# PART 2 — Build Plan

## A. Requirements Checklist (before writing code)

- [ ] **Audit existing motion-filtering code** across `LiveMonitoring.tsx`, `Detection.tsx`, `upload_routes.py`, and Dashboard camera tiles — confirm exactly what each currently does, so the new module can replace all of them rather than becoming a 5th parallel implementation.
- [ ] **Per-camera config schema** — needs: `camera_id`, `zone_id` (if assigned), `risk_weight` (from zone config, or null if uncalibrated), `forced_override_interval` (derived default + optional manual override), `threshold` (default + optional per-camera override).
- [ ] **Library decision** — OpenCV (`cv2.createBackgroundSubtractorMOG2` or `.createBackgroundSubtractorKNN`) for background subtraction; already likely available given the existing detection stack.
- [ ] **Frame source abstraction** — the Gate needs a consistent frame input interface regardless of source (webcam canvas frame, RTSP `VideoCapture` frame, uploaded video frame) — this doesn't yet exist cleanly per the RTSP audit findings (RTSP currently has no real frame pipeline at all).
- [ ] **Storage/config location for per-camera thresholds** — piggyback on the `cameras` table / zone config being built for the Context Engine, rather than a separate config store.
- [ ] **Decide MVP defaults** before calibration mode is fully built — since calibration mode (auto-learned per-camera thresholds) is a separate, not-yet-built feature, the Gate needs sane hardcoded defaults to launch with, upgradeable later.

## B. Module Structure (proposed)

```
gate/
  preprocessing.py       # downsample, grayscale, blur, CLAHE
  change_scorer.py       # background subtraction wrapper, per-camera state
  hysteresis.py          # IDLE/ACTIVE state machine
  forced_override.py     # per-camera timer, interval lookup by risk tier
  gate_config.py         # per-camera config schema + loader/defaults
  gate.py                # orchestrator — combines the above, exposes single entry point
```

**Single entry point contract:**
```
gate.process_frame(camera_id, raw_frame) -> GateResult | None
```
Returns `None` if the frame should be skipped; returns a `GateResult` (see Section 8 above) if it should proceed to the Model.

## C. Step-by-Step Build Order

Each step should be independently testable before moving to the next.

**Step 1 — Preprocessing pipeline**
Build downsample + grayscale + blur + CLAHE as a standalone function. Test on a few sample frames (day, night, foggy if available) and visually confirm output looks reasonable.

**Step 2 — Change scorer**
Wrap `cv2.createBackgroundSubtractorMOG2` (or KNN) per camera. Feed a short recorded clip or live webcam frames through it and log the raw change score over time — confirm it responds to real motion and stays low on a static scene.

**Step 3 — Hysteresis state machine**
Build the IDLE/ACTIVE transition logic as a pure function/class taking a stream of scores. Unit test with synthetic score sequences: confirm it doesn't flap on noise near the threshold, and correctly transitions on a clear step-change in score.

**Step 4 — Forced override timer**
Build the per-camera timer independent of motion score. Unit test: confirm it fires at the correct interval and is unaffected by whether the Gate is currently IDLE or ACTIVE.

**Step 5 — Per-camera config**
Build the config schema/loader with defaults for uncalibrated cameras, and the risk-tier-to-interval lookup table from Section 5.

**Step 6 — Integration: consolidate existing logic**
Replace the scattered motion-filtering code (per the audit in Section 7) in `LiveMonitoring.tsx`, `Detection.tsx`, `upload_routes.py`, and the Dashboard tile logic with calls into this new shared Gate module. This is the step most likely to surface the Dashboard-tile contradiction flagged earlier — confirm during this step exactly what code path the Dashboard tiles use and route it through the same Gate.

**Step 7 — Multi-camera readiness**
Confirm the Gate can run per-camera independently and cheaply with several cameras active at once (doesn't need the full priority-queue scheduler yet — that's a separate downstream component — just needs to confirm the Gate itself doesn't become a bottleneck as camera count grows).

**Step 8 — Testing & validation** (see checklist below)

## D. Testing & Validation Checklist

- [ ] **Static scene, no motion** → Gate stays IDLE, no frames passed except forced-override ticks
- [ ] **Steady/static fire held in frame (the confirmed bug case)** → must eventually pass via forced override even with zero motion score — verify against the actual interval for that camera's zone tier
- [ ] **Moving object passes through frame** → Gate transitions to ACTIVE and passes frames via the motion path
- [ ] **Flickering/noisy light source near threshold** → hysteresis prevents rapid IDLE/ACTIVE flapping
- [ ] **Day-to-night lighting drift over time** → background subtractor adapts gradually without triggering a false-positive storm
- [ ] **Multiple cameras running concurrently** → confirm total Gate compute stays low/flat as camera count increases (this is the core value proposition — verify it holds)
- [ ] **Forced override interval correctness per zone tier** → confirm actual fire time-to-forced-check matches the table in Section 5 for each risk tier
- [ ] **Consolidation check** → confirm the old scattered motion-filter code paths are actually removed/replaced, not left running alongside the new module

## E. Deliverable / Definition of Done

- One shared Gate module used by every frame source (webcam, RTSP, video upload, Dashboard tiles) — no parallel/duplicate motion-filtering logic remaining elsewhere in the codebase.
- Confirmed fix for the steady-fire-never-detected bug, demonstrated with the same held-fire test case that originally surfaced it.
- Per-camera config with sane defaults for uncalibrated cameras, ready to be upgraded once Calibration Mode is built.
- Gate output schema (Section 8) ready to be consumed by the downstream Model stage and (later) the multi-camera priority queue scheduler.
