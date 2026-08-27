# SentinelOS Detection Pipeline — Progress & TODO

**Date:** 2026-08-17
**Scope:** Gate, Model, shared tracking, Context Engine, evidence guarantee,
public API, and the Model→Classifier contract.
**Not in scope (built separately):** the Tier-1/Tier-2 Classifier itself.

---

## 1. Where things stand

A standalone detection pipeline exists at `sentinel-pipeline/` — its own
process, its own database, its own evidence store, one versioned API. It has no
dependency on the Dashboard's database, models, or routes.

| | |
|---|---|
| Pipeline code | 5,171 lines |
| Test code | 1,942 lines |
| **Live checks passing** | **88 / 88** across 7 suites |
| Existing dashboard app | **0 files modified** |
| Contract status | **LOCKED v1.0.0** |

The Classifier is currently a **documented temporary stub**. The pipeline warns
at startup and reports `classifier_is_stub: true` on `/v1/health`, so it cannot
silently reach production.

---

## 2. Completed and verified

Every item below was verified by a live test with real output, not by code
review.

### Investigation (pre-build)

| Finding | Evidence |
|---|---|
| Detection logic is entangled with the dashboard | Alert table carries PIN/escalation columns; RTSP pipeline lives inside a route file; settings read from DB per inference call |
| Model invocation is a single singleton | Confirmed — all five call sites converge on one `DetectionLayer` |
| **8 separate motion-filter implementations** (docs predicted 5) | 3 frontend loops, 3 in `DetectionLayer`, 1 in `CameraScheduler`, 1 post-model ROI filter, + 1 dead orphan |
| Post-model MAD filter would defeat the Gate | `detection_layer.py:542-558` discards steady-fire detections *after* the model |
| ByteTrack is real but 1/8 wired | `detection_layer.py:30-134`, used only in the video-upload path, no crop history |
| **Multi-camera scheduler has never run** | `threading` never imported; `NameError` reproduced in isolation |
| **Dashboard camera tiles are fabricated** | `setMetricsMap` never called; tiles render hardcoded `14.2 / 0.4` |
| `sparks` is silently discarded, not remapped | `_map_class` substring match drops 1 of 3 model classes |
| Model is YOLO26s, not YOLOv8 | Read from checkpoint; "YOLOv8" hardcoded in 9 UI locations |

### Build

| Component | Verification |
|---|---|
| **Gate** — MOG2/KNN, hysteresis, forced override, adaptive threshold, CLAHE | 9/9 — steady fire reaches Model via override; 0.74 ms/frame flat from 1→16 cameras |
| **Illumination normalisation** | 6/6 — A/B proves it removes only the global component; drift storm 69→1 frames |
| **Forced-override tiers** | 6/6 — all four tiers derive, fire at cadence, retune live, override wins |
| **Model** — single YOLO service, recall floor 0.20, no DB on hot path | 123/124 real fire images detected; **63% of detections below conf 0.5**; 7.8 ms p50 |
| **Shared tracking** — promoted ByteTracker + crop history | Single `track_id` across 40 frames; 17/17 candidates reach Classifier |
| **Canonical motion window (G4)** | 12/12 — real Farneback recovered 24 px as **24.1 px** |
| **Duration-bounded history (G6)** | Same suite — 2.0 s window holds 9/31/60/121 samples at 4/15/30/60 fps |
| **Recall-first escalation (G7)** | 13/13 — insufficient evidence escalates, never drops |
| **Context Engine** — zones, containment, severity, calibration, incidents | 26/26 — adjacent cameras merge, non-overlapping stay separate |
| **Evidence guarantee** | 3 refusal paths proven; 95 evidence files, **0 alerts missing evidence** |
| **Public API** `/v1` | 16/16 over HTTP — telemetry 404s rather than inventing values |

### Documents delivered

| Document | Purpose |
|---|---|
| `MODEL_CLASSIFIER_CONTRACT.md` | **LOCKED v1.0.0** — hand to the Classifier team |
| `FLICKER_SAMPLING_TRADEOFFS.md` | 4-option comparison, for joint review |
| `MODEL_TRAINING_REQUIREMENTS.md` | Training register — all training held |
| `README.md` | Boundary rules, API surface, configuration |

### Bugs found in my own work, mid-build

Recorded because the corrections matter more than the claims:

1. **Tracker silently dropped candidates.** Textbook ByteTrack opens new tracks
   only from high-confidence detections — with a 0.20 recall floor that
   discarded every 0.20–0.35 candidate not already tracked, reinstating a
   recall filter upstream of the Classifier. Fixed: 17/17 now reach it.
2. **Benchmarked numpy noise generation, not the Gate.** 9.9 ms of the measured
   10.9 ms was the test harness. True cost is 0.74 ms.
3. **Asserted illumination normalisation "never suppresses" fire.** Wrong in
   direction — at ≥10% coverage it *amplifies*. Assertion corrected to the
   detection-relevant invariant.
4. **Overstated tier coverage.** The original 9/9 used a single hardcoded
   override throughout; only the mapping function covered all tiers. Closed
   with a dedicated 6/6 suite.

---

## 3. TODO

### 3.1 Blocked on you

| # | Item | Why it's blocked | Impact |
|---|---|---|---|
| T1 | **Option D sign-off** (native brightness tap for flicker) | Awaiting joint review with Classifier teammate | Flicker stays log-only. Nothing else blocked. |
| T2 | **`yolo val` per-class metrics** for `best.pt` | Needs the training dataset, not on this machine | Decides whether a Model retrain is needed at all. One command. |
| T3 | **Deployment GPU vs CPU** | Target environment unconfirmed | ~16× throughput difference. Affects scheduler sizing, not correctness. |
| T4 | **`sparks` handling (G8)** | Operational decision | Currently passes through as `class_raw="sparks"`; no Tier-1 phase covers it |
| T5 | **Confidence threshold** the 0.793 recall was measured at | One lookup | Makes the recall figure interpretable |

### 3.2 Deferred by your instruction

| # | Item | Notes |
|---|---|---|
| T6 | **Multi-camera scheduler** | Priority queue: active alert > zone risk > gate signal > round-robin. Gate already emits the required metadata. |
| T7 | **Dashboard integration (Phase 2)** | Repoint Detection / Live Monitoring / Alerts pages at `/v1`. Proposal only — not executed. |
| T8 | **Delete superseded code paths (Phase 3)** | The 8 motion filters + embedded RTSP pipeline. Cutover is not done until these are *removed*. |

### 3.3 Not started — pipeline-side

| # | Item | Priority |
|---|---|---|
| T9 | **Video-job cancellation + concurrency limits** | Medium — `/v1/detect/video` runs unbounded background jobs |
| T10 | **Calibration persistence across restart** | Medium — `CalibrationRecord` table exists; observations are currently in-memory only |
| T11 | **Zone persistence to the pipeline DB** | Medium — `ZoneRecord` table exists but `ZoneRegistry` is in-memory |
| T12 | **Camera drift detection (ORB/SIFT)** | Low — designed in Section 7, not implemented |
| T13 | **Benchmarking suite** (p50/p95/p99, multi-camera load) | Low — deferred by the master doc until the pipeline is built |
| T14 | **API authentication** | **Flagged** — `/v1` is currently unauthenticated. Fine for localhost; must be resolved before any non-local deployment. |
| T15 | **Model DB-overhead fix in the *existing* app** | Not applicable to the pipeline (already avoided); still live in the old app |

### 3.4 Known issues in the existing app — documented, not fixed

Left alone by your instruction. All are superseded by the pipeline at cutover.

| Issue | Location |
|---|---|
| Scheduler `NameError` — never processed a frame | `camera_scheduler.py:67` |
| Dashboard tiles show hardcoded fake metrics | `Dashboard.tsx:842-846` |
| `smoke_min_confidence` loaded but never applied | `detection_layer.py:300-309` |
| "High Recall" preset *raises* the confidence floor (0.20→0.30) | `config.py:85-100` |
| `sparks` detections silently discarded | `detection_layer.py:584-600` |
| "YOLOv8" hardcoded in 9 UI locations | Frontend + `detect_routes.py:156` |
| RTSP alert can write `evidence_path=None` | `detect_routes.py:399-413` |
| `monitor_cameras_loop` is dead code | `camera_monitor.py:17` |

---

## 4. Suggested next step

**T1 and T2 are the two that unblock the most.** T1 lets the Classifier team
finalise Phase 4; T2 decides whether any model retraining is needed at all and
costs one command.

On the pipeline side, **T10 + T11 (persistence)** are the most valuable
unblocked work: zones and calibration currently live in memory, so a restart
loses an approved zone — which matters as soon as this runs anywhere real.

**T14 (API auth)** should be settled before the Dashboard integration in T7,
not after.

---

## 5. How to verify any of this yourself

```bash
cd sentinel-pipeline
for t in gate_validation forced_override_tiers illumination_vs_fire \
         recall_first_contract g4_g6_closure pipeline_core; do
  ../.venv-pipeline/bin/python tests/test_$t.py
done
```

```bash
../.venv-pipeline/bin/python -m uvicorn sentinel_pipeline.api.app:app --port 8100
```

```bash
../.venv-pipeline/bin/python tests/test_api_integration.py http://127.0.0.1:8100
```
