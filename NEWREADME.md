# SentinelOS — Fire/Smoke Detection Platform

**Branch:** `feature/sentinel-detection-pipeline`
**Written:** 2026-08-27
**Status:** Detection pipeline built and independently verified. Dashboard
migration designed and partially staged, paused for review before touching
live dashboard code. Classifier (Tier-1/Tier-2) is out of scope here — built
separately by another engineer against a locked interface.

This document is the single narrative for the project as of this branch: what
exists, why it's built the way it is, what's proven versus assumed, and what's
left. It supersedes any older top-level README for orientation purposes; the
per-module docs under `sentinel-pipeline/docs/` remain the detailed reference.

---

## 1. What this project is

A fire/smoke detection system with two halves that are deliberately being
pulled apart:

1. **`Fire_Smoke_Application-main/`** — the original monolith. A FastAPI
   backend + React dashboard where detection logic (YOLO inference, motion
   filtering, RTSP handling) was interleaved with dashboard concerns (auth,
   alert lifecycle, reporting) in the same routes and the same database.
2. **`sentinel-pipeline/`** — a new, standalone detection service extracted
   from that monolith's ideas but rebuilt clean: its own process, its own
   database, its own versioned HTTP API. This is the actual deliverable of
   the current phase of work.

The end state is the dashboard as a thin client of the pipeline's API, with
detection logic living in exactly one place.

---

## 2. Why this rebuild happened

An audit of the original application found the same failure pattern
recurring in different clothes, every time detection logic touched something
else:

- **Eight separate motion-filtering implementations** across three frontend
  page loops, three spots in the backend detection layer, one in a camera
  scheduler, plus one dead orphaned function — all making independent,
  inconsistent decisions about when to run inference.
- **A confirmed steady-fire blind spot**: a phone held showing an actual fire
  at 55 FPS stayed marked IDLE (Motion Score 0.2%) because pure motion-based
  gating never triggers on a static source. Even after building a proper
  Gate with forced periodic override, a *separate* post-model filter inside
  the old verification stage would have discarded the same steady-fire
  detection anyway (`MAD < 1.8` rejects low-frame-to-frame-change ROIs) —
  the bug was structural, not a single fixable line.
- **A multi-camera scheduler that had never run.** `camera_scheduler.py`
  referenced `threading.Lock()`, `thread
￼
ing.Thread`, `threading.Event` but
  never imported `threading`. Every camera processor construction raised
  `NameError`, silently swallowed by a broad `except Exception` in the main
  loop, which logged and retried forever. The service reported healthy and
  did nothing.
- **Dashboard camera tiles were fabricated.** `setMetricsMap` was declared
  and never called; every tile rendered a hardcoded literal
  (`pixel_change_pct: 14.2, motion_score: 0.08` when "threat", `0.4 / 0.002`
  otherwise) regardless of actual camera state.
- **One third of the model's output was silently discarded.** The detector
  emits three classes (`fire`, `smoke`, `sparks`); a substring-match class
  mapper only recognized `fire`/`smoke`, so every `sparks` detection vanished
  before reaching any alert logic.
- **The model was mislabeled everywhere.** Nine UI locations hardcoded
  "YOLOv8"; reading the actual checkpoint showed it was trained as
  **YOLO26s** (Ultralytics 8.4.104, trained 2026-07-23).
- **PIN-gated alert resolution and escalation were speculative, not real.**
  `users.resolution_pin_hash` existed as a column nobody ever set or checked;
  no PIN-entry UI existed; "escalation" appeared nowhere except one line of
  marketing copy on the documentation page. Two headline dashboard features
  were column stubs.

None of these were fixed in place. Given the recurrence — the same
"detection logic scattered across independent call sites" failure, at least
four separate times — the decision was to build a new pipeline with a single
enforced entry point per concern, rather than patch the eighth instance of
the pattern.

---

## 3. Architecture

```
                    ┌─────────────────────────────────────────┐
                    │         sentinel-pipeline (NEW)          │
                    │         standalone process, :8100        │
                    │                                           │
  camera / video ──▶│  GATE → MODEL → [CLASSIFIER] → CONTEXT   │
                    │                                    ENGINE │
                    │                                     │     │
                    │                              alerts + evidence
                    │                                     │     │
                    │              versioned /v1 HTTP API │     │
                    └─────────────────────────────────────┼─────┘
                                                            │
                                                    (only interface)
                                                            │
                    ┌───────────────────────────────────────▼───┐
                    │      Fire_Smoke_Application-main (OLD)     │
                    │      dashboard: auth, alert lifecycle,     │
                    │      reporting — being migrated to consume │
                    │      the pipeline instead of doing its own │
                    │      detection                             │
                    └─────────────────────────────────────────────┘
```

### 3.1 Pipeline stages

| Stage | Job | Cost | Status |
|---|---|---|---|
| **Gate** | Decide if a frame is worth running the model on | ~0.74 ms/frame | Built, verified |
| **Model** | YOLO26s inference — cast a wide net, recall-first | ~8.7 ms p50 (GPU) | Built, verified |
| **Tracking** | Assign stable IDs across frames, maintain crop history | included above | Built, verified |
| **Classifier** | Tier-1 rules + Tier-2 CNN, precision-first | — | **Out of scope** — built separately, stub provided |
| **Context Engine** | Zone containment, severity scoring, calibration, multi-camera incident correlation | ~10 ms downstream | Built, verified |
| **Scheduler** | Priority queue across cameras (Gate cheap-and-continuous, Model only for promoted frames) | — | Built, verified |

### 3.2 Design principle carried through every stage

Every stage has exactly **one enforced entry point**. Concretely:

- `Gate.process_frame()` is the only place a frame-skip decision is made.
  Every source (webcam, RTSP, upload, scheduler) routes through it.
- `ModelStage.detect()` is the only inference call site.
- `AlertStore.create()` is the only way an alert record is written, and it
  makes a missing evidence reference structurally impossible — a required
  keyword argument, validated non-empty, checked to resolve to a real file
  on disk, with a `NOT NULL` database column as the final backstop. This
  directly targets a confirmed incident in the old app where the RTSP path
  reached alert-creation without the same evidence-capture call the
  video-upload path used, producing alerts with no supporting image.
- `Pipeline.run_after_gate()` is the only post-Gate execution path — used
  identically by direct submissions and by the scheduler, so there is no
  second, slightly-different code path for "the scheduler's version of
  inference."

### 3.3 The Classifier boundary

The Classifier is being built by a separate engineer against a **locked
interface** (`sentinel_pipeline/classifier/base.py`, contract version
`1.0.0`). The pipeline currently runs a documented, clearly-marked
**temporary stub** (`classifier/stub.py`, heuristic HSV thresholds) that
implements the exact same interface — `is_stub = True` is surfaced on
`/v1/health` so it can never be silently mistaken for production. Swapping
in the real classifier is a one-line change:

```python
pipeline = Pipeline(classifier=RealClassifier())
```

The interface contract went through two full audit passes:
1. An inferred version, before the real Tier-1 phase spec existed.
2. A field-by-field re-validation once the actual **Tier-1 Classifier
   Cascade — Phase Reference** arrived, which surfaced two blocking gaps
   (see §5) that were closed and re-verified before the contract was
   declared locked.

---

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Pipeline runtime | Python 3.14, FastAPI, Uvicorn | Own venv (`.venv-pipeline`) |
| Detection model | YOLO26s via Ultralytics 8.4.104 | `best.pt`, trained 2026-07-23 |
| Inference device | CUDA (RTX A2000, 6GB) in dev; target hardware **unconfirmed** | See TODO — this is a real open risk, ~14x latency swing between GPU/CPU |
| Tracking / classical CV | OpenCV (MOG2/KNN background subtraction, ORB drift detection, Farneback optical flow) | No ML outside the Model stage — a deliberate architectural rule |
| Pipeline datastore | SQLite (WAL mode) | `PIPELINE_DATABASE_URL` overridable to Postgres if scale demands it |
| Pipeline API auth | Static API key (`X-API-Key` header, in-progress fix for browser-tag use — see §7) | |
| Dashboard backend | Python, FastAPI, SQLAlchemy | Own venv (`.venv-dashboard`) — unchanged except additive lifecycle routes |
| Dashboard frontend | React + TypeScript + Vite | Node 24 (installed via `nodejs-wheel-binaries` PyPI wheel — no system Node was present) |
| Dev dataset tooling | Roboflow-format YOLO datasets (D-Fire-style merges) | Used for functional (not benchmark) verification |

---

## 5. Key architectural decisions and why

**Duration-bounded tracking history, not frame-count-bounded (G6).**
The Classifier's Flicker phase needs "roughly 1–2 seconds" of history. A
frame-count cap (e.g. "60 frames") means something completely different at
4 fps (15 seconds) than at 30 fps (2 seconds) — the same cap silently changes
meaning with camera load. History is now evicted by wall-clock span, not
count, verified across 4/15/30/60 fps: a fixed 2.0s window holds
9/31/60/121 samples respectively, always spanning ≤2.0s regardless of source
rate, including under a simulated stall from 30fps to 1fps.

**Canonical motion windows, not per-frame crops (G4).**
Optical flow (Farneback) requires two frames of **identical dimensions**.
Naively cropping to each frame's live bounding box breaks this the moment an
object grows or shrinks between frames. Fixed by anchoring a fixed-size
motion window per track ("epoch") that only re-anchors when the tracked
object outgrows it, with the resize scale factor exposed to the Classifier so
displacement can be converted back to real-world pixels. Verified: a
synthetic 24px true displacement was recovered as 24.1px through the full
epoch-tracking + Farneback pipeline.

**Escalate on insufficient evidence, never silently drop (G7).**
The Classifier's Tier-1 spec requires "insufficient_history" to be a
first-class outcome distinct from "reject" — a candidate the classifier
couldn't yet decide on should escalate to a human, not vanish. This is now
load-bearing pipeline behavior (`evidence_sufficient` flag on the
`ClassifierVerdict` contract), not classifier-side discipline, so it can't be
silently dropped by a future classifier implementation.

**One shared tracking layer for Motion and Flicker**, rather than each
building its own object-persistence logic — both need "the same candidate,
across N frames," so the pipeli
        configne provides it once.

**Zone containment as the sole basis for severity**, not raw detection
confidence. A camera watching a designated burn pit and a camera watching a
warehouse interior should not alert identically on "fire detected" — the
Context Engine holds per-zone containment polygons (built via a calibration
observation window + one-click human approval, never fully automatic) and
scores severity against zone risk weight, containment breach, and envelope
exceedance.

**Multi-camera incident correlation via calibration-derived adjacency, not
3D triangulation.** Cheaper, matches what the operator actually configures
during setup, and degrades safely (unrelated fires stay unrelated unless
adjacency is explicitly established).

**API key over the query string was flagged as a regression and is being
fixed, not shipped.** See §7 — this document intentionally records an
in-progress fix rather than presenting it as resolved.

---

## 6. Progress so far — what's actually verified

Every claim below has a corresponding live test, run against real output —
not a description of intended behavior. **113/113 checks passing** across 9
test suites at last full run:

| Suite | Checks | What it proves |
|---|---|---|
| `test_gate_validation.py` | 9/9 | Gate correctly skips static frames, forces periodic override, per-camera adaptive threshold |
| `test_forced_override_tiers.py` | 6/6 | Zone-risk-tiered override intervals fire on schedule |
| `test_illumination_vs_fire.py` | 6/6 | Illumination normalization doesn't mask real fire signal |
| `test_recall_first_contract.py` | 13/13 | Classifier interface honors recall-first / escalation contract |
| `test_g4_g6_closure.py` | 12/12 | Motion-window epochs + duration-bounded history, including the 24px→24.1px Farneback proof |
| `test_scheduler.py` | 9/9 | Priority queue correctly orders promoted frames across cameras |
| `test_operations.py` | 13/13 | Zone persistence, camera drift (ORB) detection, auth mode reporting |
| `test_pipeline_core.py` | 26/26 | End-to-end Gate→Model→Tracking→Classifier(stub)→Context→Alert |
| `test_api_integration.py` | 19/19 | Full HTTP surface: camera registration, calibration, zone approval, detection, alert retrieval, evidence fetch, auth enforcement |

Also independently confirmed:
- **Live model identity read from the actual checkpoint**: `yolo26s`,
  classes `{fire, smoke, sparks}`, CUDA device, conf threshold 0.2 — not
  hardcoded anywhere.
- **123/124 real fire images correctly triggered detection** in a functional
  (not benchmark-accuracy) swee
        configp of a real dataset.
- **Frontend toolchain actually runs**: `tsc --noEmit` clean against the real
  `tsconfig.app.json`, and `vite build` succeeds, for every new
  dashboard-integration file — checked by installing a real Node runtime
  (none was present on this machine) rather than assumed.
- **Dashboard backend actually imports and serves** the new lifecycle routes
  over live HTTP (not just `ast.parse` syntax checking) — 7 new endpoints
  confirmed present in the live OpenAPI schema and exercised with real
  requests (escalate → resolve → read-back → batch-fetch), including a live
  PIN-gate proof (400 no-PIN → 403 wrong-PIN → 200 correct-PIN).
- **Auth is genuinely enforced, not just configured**: live 401 without a
  key, live 200 with the correct key, on a running server — checked after
  discovering and fixing an app-level FastAPI dependency-exemption bug where
  the health endpoint's route-level `dependencies=[]` didn't actually
  override the app-level auth dependency.

### Bugs found in this project's own new code, and fixed before being reported done

Documented deliberately, because "found it, fixed it, reproved it" is the
standard being held throughout, applied to this work too, not just the
inherited codebase:
- The FastAPI app-level-dependency override bug above.
- The initial evidence/MJPEG auth design (static key in query string) — see
  §7, currently mid-fix rather than shipped.
- A test suite (`test_api_integration.py`) that silently stopped exercising
  real behavior once auth was enabled, because its request helper never
  attached the key — found by re-running after the auth fix, not assumed
  fine.
- PIN verification was initially wired against a nonexistent
  `verify_resolution_pin` helper (an orphaned-import crash risk, the same
  failure class the project has already been burned by once); corrected to
  use the app's real PBKDF2 `verify_password` helper against the dedicated
  `resolution_pin_hash` field.

---

## 7. Open items and known gaps (honest, as of this branch)

**Dashboard migration is designed, partially built, and deliberately paused.**
`sentinel-pipeline/docs/DASHBOARD_MIGRATION_PLAN.md` lays out per-page
feature flags, a rollback plan, and a functional-equivalence checklist. Work
in progress (staged, not committed to this branch) includes a
`PipelineAlertLifecycle` dashboard-side table and API routes for
acknowledge/resolve/escalate/notes on pipeline-originated alerts, and a
typed pipeline API client for the frontend. This is intentionally **not**
folded into this branch's history yet, pending resolution of:

1. **Scope confirmation**: the old app's PIN-gated resolution and escalation
   turned out to be unimplemented stubs, not working features to preserve.
   Building them for real is net-new feature work riding on the migration's
   authority, and is being confirmed explicitly rather than assumed in
   scope.
2. **PIN secret provenance**: confirming the resolution PIN is checked
   against its own dedicated hash field (`resolution_pin_hash`), not the
   operator's login password — same hashing primitive, deliberately
   different secret. No PIN-*setting* endpoint exists yet; it was tested by
   writing the hash directly.
3. **API key transport for `<img>`/`<video>` tags.** Evidence images and the
   MJPEG stream can't attach a request header, so the initial design put
   the raw static API key in the URL query string (`?api_key=...`) — flagged
   as a real regression (browser history, proxy/server access logs,
   screenshots) against the entire reason the key was introduced. Being
   replaced with either short-lived signed per-request tokens minted by the
   dashboard backend, or proxying evidence/MJPEG through the dashboard so
   the raw pipeline key never reaches the browser. **Not resolved in this
   branch — flagged rather than shipped.**

**Deployment hardware is unconfirmed.** Dev measurements are on an RTX A2000
(6GB); CPU-only inference has not been benchmar
￼
ked and prior-audit numbers
suggest roughly a 14x latency difference. s production-representative.

**Classifier training data quality issue found, not yet acted on.**
Dataset composition analysis found the `sparks` class carrying a
disproportionate fullframe-box rate (roughly 94x the fire class's rate),
suggesting label quality issues specific to that class. Flagged in
`sentinel-pipeline/docs/TODO_ACTION_ITEMS.md` for the classifier engineer
rather than silently worked around.

**Flicker sampling strategy needs a decision**, documented with tradeoffs in
`sentinel-pipeline/docs/FLICKER_SAMPLING_TRADEOFFS.md` — not yet chosen.

---

## 8. What's next

1. Resolve the three checkpoint items aboThis materially affects
multi-camera scheduling assumptions and is called out rather than papered
over with a dev-machine number presented as production-representative.

**Classifier training data quality issue found, not yet acted on.**
Dataset composition analysis found the `sparks` class carrying a
disproportionate fullframe-box rate (roughly 94x the fire class's rate),
suggesting label quality issues specific to that class. Flagged in
`sentinel-pipeline/docs/TODO_ACTION_ITEMS.md` for the classifier engineer
rather than silently worked around.

**Flicker sampling strategy needs a decision**, documented with tradeoffs in
`sentinel-pipeline/docs/FLICKER_SAMPLING_TRADEOFFS.md` — not yet chosen.

---

## 8. What's next

1. Resolve the three checkpoint items above (scope confirmation, PIN
   provenance sign-off, evidence/MJPEG auth fix) before any dashboard-file
   commit lands.
2. Execute the dashboard migration's steps 3–9: repoint Detection,
   LiveMonitoring, Dashboard, and AlertsReports pages behind their
   individual feature flags, running the full functional-equivalence
   checklist per page, verified live at each step — not flipped on by
   default until the checklist passes end to end.
3. Confirm production inference hardware and re-benchmark scheduler
   assumptions against it.
4. Classifier engineer builds Tier-1/Tier-2 against the locked
   `sentinel_pipeline/classifier/base.py` contract; swap out the stub.
5. Decide and implement the flicker sampling strategy.
6. Address the `sparks` class label-quality flag before it's used for
   classifier training.

---

## 9. Where to look for more detail

| Document | Covers |
|---|---|
| `sentinel-pipeline/docs/PROJECT_STATUS.md` | Fuller status table, same spirit as this doc |
| `sentinel-pipeline/docs/CLASSIFIER_REQUIREMENTS.md` | The locked interface contract for the classifier engineer |
| `sentinel-pipeline/docs/MODEL_CLASSIFIER_CONTRACT.md` | Field-by-field contract spec and audit history |
| `sentinel-pipeline/docs/DASHBOARD_MIGRATION_PLAN.md` | Per-page flags, rollback plan, functional-equivalence checklist |
| `sentinel-pipeline/docs/TODO_ACTION_ITEMS.md` | Full open-items list including the sparks label-quality finding |
| `sentinel-pipeline/docs/FLICKER_SAMPLING_TRADEOFFS.md` | Undecided flicker-detection sampling strategies |
| `sentinel-pipeline/docs/MODEL_TRAINING_REQUIREMENTS.md` | Data/training requirements handed to the classifier engineer |
