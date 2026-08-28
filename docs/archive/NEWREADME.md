# SentinelOS — Fire/Smoke Detection Platform

**Branch:** `main`
**Written:** 2026-08-27, updated 2026-08-28
**Status:** Detection pipeline built and independently verified. Dashboard
migration to consume the pipeline is **complete and live-verified** across
all four pages (Detection, LiveMonitoring, Dashboard, AlertsReports), plus
authorized zone editing, a facility map with geometric adjacency, and
multi-camera calibration. Classifier (Tier-1/Tier-2) is out of scope here —
built separately by another engineer against a locked interface; the
pipeline currently runs a clearly-marked temporary stub.

This document is the single narrative for the project as of this branch: what
exists, why it's built the way it is, what's proven versus assumed, and what's
left. It supersedes any older top-level README for orientation purposes; the
per-module docs under `sentinel-pipeline/docs/` remain the detailed reference
— especially `MIGRATION_DECISIONS_LOG.md` (every decision made during the
dashboard migration, with live evidence), `PIPELINE_VALIDATION_REPORT.md`
(113/113 checks re-run live), and `CONTEXT_ENGINE_REPORT.md` (every
severity/adjacency/calibration algorithm, hand-verified against real data).

---

## 1. What this project is

A fire/smoke detection system with two halves that were deliberately pulled
apart, and are now wired back together the correct way:

1. **`Fire_Smoke_Application-main/`** — the dashboard. A FastAPI backend +
   React frontend handling auth, alert lifecycle, reporting, and — now — a
   thin reverse proxy to the pipeline, rather than doing detection itself.
2. **`sentinel-pipeline/`** — the standalone detection service: its own
   process, its own database, its own versioned HTTP API
   (`Gate → Model → Tracking → Classifier → Context Engine`, plus a
   multi-camera Scheduler and Calibration subsystem).

The dashboard is now a client of the pipeline's API for everything
detection-related, with detection logic living in exactly one place. This was
the stated goal of the rebuild and it is now true in the running system, not
just the design.

---

## 2. Why this rebuild happened

An audit of the original monolith found the same failure pattern recurring in
different clothes, every time detection logic touched something else:

- **Eight separate motion-filtering implementations** across three frontend
  page loops, three spots in the backend detection layer, one in a camera
  scheduler, plus one dead orphaned function — all making independent,
  inconsistent decisions about when to run inference.
- **A confirmed steady-fire blind spot**: a phone held showing an actual fire
  at 55 FPS stayed marked IDLE (Motion Score 0.2%) because pure motion-based
  gating never triggers on a static source.
- **A multi-camera scheduler that had never run.** `camera_scheduler.py`
  referenced `threading.Lock()` but never imported `threading` — every camera
  processor construction raised `NameError`, silently swallowed and retried
  forever. The service reported healthy and did nothing.
- **Dashboard camera tiles were fabricated.** `setMetricsMap` was declared
  and never called; every tile rendered a hardcoded literal regardless of
  actual camera state. (Fixed for real this session — see §6.)
- **One third of the model's output was silently discarded** (`sparks` never
  reached alert logic).
- **The model was mislabeled everywhere** — nine UI locations hardcoded
  "YOLOv8"; the actual checkpoint is **YOLO26s**.
- **PIN-gated alert resolution and escalation were speculative, not real.**
  `users.resolution_pin_hash` existed as a column nobody ever set or checked.
  (Built for real this session — see §6.)

None of these were fixed in place. The decision was to build a new pipeline
with a single enforced entry point per concern, rather than patch the eighth
instance of the same pattern — and then migrate the dashboard onto it.

---

## 3. Architecture

```
                    ┌─────────────────────────────────────────┐
                    │         sentinel-pipeline                │
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
                                            X-API-Key, server-to-server only
                                                            │
                    ┌───────────────────────────────────────▼───┐
                    │      Fire_Smoke_Application-main           │
                    │      dashboard backend :8000 — auth, alert  │
                    │      lifecycle, reporting, AND a reverse    │
                    │      proxy to the pipeline (the browser     │
                    │      never sees the pipeline's key)         │
                    │                     │                       │
                    │      dashboard frontend :5173 (Vite)         │
                    └─────────────────────────────────────────────┘
```

### 3.1 Pipeline stages

| Stage | Job | Cost (real, measured) | Status |
|---|---|---|---|
| **Gate** | Decide if a frame is worth running the model on | p50 1.29ms, flat with camera count (0.57–0.63ms across 1–16 cameras) | Built, verified |
| **Model** | YOLO26s inference — cast a wide net, recall-first | p50 8.35ms (RTX A2000) | Built, verified |
| **Tracking** | Assign stable IDs across frames, maintain crop history | included above | Built, verified |
| **Classifier** | Tier-1 rules + Tier-2 CNN, precision-first | — | **Out of scope** — stub in place (`is_stub: true` on `/v1/health`) |
| **Context Engine** | Zone containment, severity scoring, calibration, adjacency (behavioural + geometric), multi-camera incident correlation | ~10ms downstream | Built, verified, every formula hand-checked against real alerts |
| **Scheduler** | Priority queue across cameras (starvation-fallback at 8s) | — | Built, verified |

Full real benchmark output, capacity estimate, and honest caveats (dev GPU
only, production hardware unconfirmed): `sentinel-pipeline/docs/PIPELINE_VALIDATION_REPORT.md`.

### 3.2 Design principle carried through every stage

Every stage has exactly **one enforced entry point** — `Gate.process_frame()`
is the only frame-skip decision site, `ModelStage.detect()` the only
inference call site, `AlertStore.create()` the only way an alert is written
(evidence is a required, validated argument, not a convention),
`Pipeline.run_after_gate()` the only post-Gate execution path for both direct
submissions and the scheduler.

**The Context Engine itself has zero machine learning** — severity scoring,
containment, envelope checks, calibration clustering (convex hull + MAD
outlier trim, **not DBSCAN** — corrected this session, no `sklearn`
dependency exists anywhere in this repo), and adjacency (both behavioural
correlation and the new geometric FOV-overlap) are all deterministic
arithmetic and geometry. The only trained model in the whole system today is
the YOLO26s detector. Full breakdown with real formulas and hand-verified
proof: `sentinel-pipeline/docs/CONTEXT_ENGINE_REPORT.md`.

### 3.3 The Classifier boundary

Unchanged from the original design: the Classifier is built by a separate
engineer against a locked interface (`sentinel_pipeline/classifier/base.py`,
contract version `1.0.0`). The pipeline currently runs a documented,
clearly-marked temporary stub (`classifier/stub.py`, heuristic HSV
thresholds) implementing the same interface. Swapping in the real classifier
is a one-line change: `Pipeline(classifier=RealClassifier())`.

---

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Pipeline runtime | Python 3.14, FastAPI, Uvicorn | Own venv (`.venv-pipeline`) |
| Detection model | YOLO26s via Ultralytics 8.4.120 | `best.pt`, trained 2026-07-23 |
| Inference device | CUDA (RTX A2000, 6GB) in dev; target hardware **still unconfirmed** | Real, measured ~14x latency swing GPU/CPU per a prior audit — do not size production from dev numbers |
| Tracking / classical CV | OpenCV (MOG2/KNN, ORB drift detection, Farneback optical flow) | No ML outside the Model stage — a deliberate architectural rule, verified again this session (§3.2) |
| Geometry (calibration, adjacency) | Convex hull + MAD outlier trim; Sutherland-Hodgman polygon clipping for FOV overlap | No geometry/clustering library dependency anywhere |
| Pipeline datastore | SQLite (WAL mode) | `PIPELINE_DATABASE_URL` overridable to Postgres |
| Pipeline API auth | Static API key (`X-API-Key`), enforced — confirmed live (`"auth": "enabled"`) | Never reaches the browser (see §3, dashboard proxy) |
| Dashboard media auth | Short-lived (120s) HMAC-signed, resource-scoped tokens for `<img>`/`<video>` (evidence, MJPEG, facility map image) | Resolved the query-string-API-key regression flagged in the previous version of this doc |
| Dashboard backend | Python, FastAPI, SQLAlchemy | Own venv (`.venv-dashboard`) |
| Dashboard frontend | React + TypeScript + Vite | Node via `nodejs-wheel-binaries` PyPI wheel |

---

## 5. Key architectural decisions and why

**Duration-bounded tracking history, not frame-count-bounded (G6).** A
frame-count cap means something different at 4fps than at 30fps. History is
evicted by wall-clock span — verified across 4/15/30/60 fps, a fixed 2.0s
window always spans ≤2.0s regardless of source rate.

**Canonical motion windows, not per-frame crops (G4).** Optical flow needs
two frames of identical dimensions; a fixed-size motion window per track,
re-anchored only when outgrown, fixes this. Verified: a synthetic 24px
displacement recovered as 24.1px.

**Escalate on insufficient evidence, never silently drop (G7).** A candidate
the classifier can't yet decide on escalates to a human, never vanishes —
load-bearing pipeline behavior (`evidence_sufficient` on the contract), not
classifier-side discipline.

**Zone containment as the sole basis for severity, not raw confidence.**
`severity = confidence × zone_risk_weight × growth_factor`, plus containment/
envelope escalation terms — every input already known, the formula
reproducible by hand. Hand-verified against 3 real alerts this session, exact
match. Full derivation: `CONTEXT_ENGINE_REPORT.md`.

**Adjacency has three distinct, never-conflated sources**, added
incrementally: (1) **confirmed** — a human declares it at zone-approval time;
(2) **behavioural** — ≥50% of one camera's real detection triggers co-occur
with another's within 3.0s (built earlier); (3) **geometric** — real
field-of-view overlap computed from camera placements on an uploaded facility
map, via exact convex-sector polygon clipping (built this session). None of
the three ever auto-writes a zone's confirmed adjacency — every application
goes through the authorized+reviewed+reasoned+logged zone-edit flow (§6).

---

## 6. Progress so far — what's actually verified

Every claim below has a corresponding live test or live browser session, not
a description of intended behavior.

### 6.1 Pipeline: 113/113 checks, re-run live this session

| Suite | Checks | What it proves |
|---|---|---|
| `test_gate_validation.py` | 9/9 | Gate skip/override/adaptive-threshold behavior |
| `test_forced_override_tiers.py` | 6/6 | Zone-risk-tiered override intervals |
| `test_illumination_vs_fire.py` | 6/6 | Illumination normalization doesn't mask real fire |
| `test_recall_first_contract.py` | 13/13 | Recall-first / escalation contract |
| `test_g4_g6_closure.py` | 12/12 | Motion-window epochs + duration-bounded history |
| `test_scheduler.py` | 9/9 | Priority queue + starvation fallback |
| `test_operations.py` | 13/13 | Zone persistence, camera drift, auth enforcement |
| `test_pipeline_core.py` | 26/26 | End-to-end Gate→Model→Tracking→Classifier→Context→Alert |
| `test_api_integration.py` | 19/19 | Full HTTP surface against the live running server |

Full real output, real benchmark percentiles, and an honest scope discussion
of what 113/113 does and doesn't prove: `sentinel-pipeline/docs/PIPELINE_VALIDATION_REPORT.md`.

### 6.2 Dashboard migration — complete, all four pages, live-verified

Detection, LiveMonitoring, Dashboard, and AlertsReports all consume the
pipeline via the dashboard's own reverse proxy (`pipeline_proxy_routes.py`)
instead of the old embedded detection code, behind per-page feature flags
(all four currently on). Full checklist, real evidence, and every decision
made along the way: `sentinel-pipeline/docs/MIGRATION_DECISIONS_LOG.md`
(15 logged decisions, D1–D15).

Highlights, each independently verified live:
- **Alerts dual-read**: pipeline + legacy alerts merged in one table;
  resolved a real pipeline alert as the logged-in operator, independently
  confirmed via direct SQLite read.
- **Dashboard stat card and CSV export** both used to undercount (pipeline
  alerts weren't included) — fixed, verified exact against direct DB/API
  queries (240 active = 236 pipeline + 4 legacy, etc.).
- **PIN-gated resolution and escalation are now real** (not stubs): a
  dedicated `resolution_pin_hash` field, a real `/set-resolution-pin`
  endpoint, live-verified 11/11 checks including wrong-PIN rejection.
- **Evidence/MJPEG auth regression (flagged in the previous version of this
  doc) is resolved**: short-lived signed tokens, the pipeline's raw API key
  never reaches the browser.

### 6.3 New this session: authorized zone editing, facility map, multi-camera calibration

- **Zone editing**, so a bad calibration result can be corrected: authorized
  accounts only (enforced at three independent layers — route, UI, and
  backend, each confirmed live including a real viewer-account 403), a
  mandatory review-then-confirm step showing the exact diff before anything
  is sent, and every applied change written to the dashboard's audit log
  with username, reason, and field-by-field diff. Required a genuine new
  pipeline capability (`ContextEngine.edit_zone`, `PATCH
  /v1/cameras/{id}/zone`) — reusing the existing approve-zone endpoint would
  have silently wiped envelope/polygon data on every edit.
- **Facility map**: upload a site image, place cameras (position + facing +
  field-of-view cone), and the dashboard computes exact geometric
  field-of-view overlap between every camera pair (Sutherland-Hodgman convex
  polygon clipping — not an approximation). A suggestion only; applying it as
  a confirmed adjacency goes through the same authorized+reviewed+logged
  zone-edit flow. Live-verified: two placed cameras produced a real 43.0%/
  43.0% overlap, independently re-confirmed via a direct API call.
- **Multi-camera calibration**: batch-start calibration on any number of
  cameras with one click (`Promise.allSettled`, partial-failure tolerant);
  a real-time Live Overview tab polls and displays every calibrating
  camera's progress and adjacency state simultaneously. Live-verified:
  batch-started 4 real cameras, confirmed 4 independent
  `POST .../calibrate/start` calls in the network log.

### 6.4 Real mistakes made and disclosed during this work, not hidden

In keeping with this project's own stated standard ("found it, fixed it,
reproved it," applied to new work too):
- A backend restart once lost the pipeline-proxy's auth env vars (not
  exported before `uvicorn` was started) — every dashboard page briefly
  broke; caught immediately and fixed.
- An attempt to pause-then-resume the pipeline process via `SIGSTOP` instead
  killed it (the harness was independently tracking it as a background task)
  — restarted immediately, no data lost (confirmed via the pipeline's own
  alert count and a lifecycle write surviving the restart).
- A `curl` login used to independently verify an API response silently
  invalidated the browser's own session token (this app allows one session
  per user) — caused a real, visible `401` failure that looked like a bug in
  new code; re-authenticating in the browser reproduced success cleanly.

Full accounts of all three, plus everything else: `MIGRATION_DECISIONS_LOG.md`.

---

## 7. Open items and known gaps (honest, as of this branch)

**Classifier is still the stub.** No change from the original design — the
real Tier-1/Tier-2 classifier is built separately and has not arrived in this
environment. `classifier_is_stub: true` remains visible on live `/v1/health`.

**Deployment hardware is unconfirmed.** Every pipeline latency number in
`PIPELINE_VALIDATION_REPORT.md` is this dev machine's RTX A2000. A prior
audit's CPU-only figure would change the capacity estimate by roughly 14x —
confirm the real target before sizing anything.

**Facility map has only been exercised with synthetic test data.** The
geometric-adjacency mechanism (§6.3) is real and verified, but no actual site
map or real camera placements have been entered yet — that's still needed
from whoever operates the real deployment.

**Zone data has no Acknowledge/Escalate UI on pipeline alerts, and Resolve's
PIN path falls back to a plain browser prompt rather than a dedicated modal**
— both deliberately deferred (see `TODO_ACTION_ITEMS.md` D6) since no
operator has set a PIN yet.

**Stale duplicate test zones/cameras exist in the pipeline's own store** from
earlier `test_api_integration.py` runs, now visible in the new Zone Data /
Live Overview tabs since those UIs didn't exist before. No cleanup endpoint
exists yet (`DELETE /v1/zones/{id}` is absent) — tracked in
`TODO_ACTION_ITEMS.md`.

**Classifier training data quality issue found, not yet acted on.** The
`sparks` class carries a disproportionate fullframe-box rate (~94x fire's
rate) — flagged for the classifier engineer, not silently worked around.

**Flicker sampling strategy needs a decision** — see
`sentinel-pipeline/docs/FLICKER_SAMPLING_TRADEOFFS.md`.

---

## 8. What's next

1. Get real production hardware confirmed and re-benchmark.
2. Real classifier engineer builds Tier-1/Tier-2 against the locked contract;
   swap out the stub — a one-line change on the pipeline side.
3. Enter real facility map data and real camera placements once a real site
   is available.
4. Decide the flicker sampling strategy.
5. Address the `sparks` label-quality flag before it's used for classifier
   training.
6. Clean up the stale duplicate test zones/cameras (needs a new pipeline
   `DELETE /v1/zones/{id}` endpoint, or direct DB access).

---

## 9. Where to look for more detail

| Document | Covers |
|---|---|
| `sentinel-pipeline/docs/MIGRATION_DECISIONS_LOG.md` | Every decision made during the dashboard migration and this session's new features (D1–D15), each with live evidence |
| `sentinel-pipeline/docs/PIPELINE_VALIDATION_REPORT.md` | Full pipeline validation — 113/113 checks, real benchmarks, honest scope caveats |
| `sentinel-pipeline/docs/CONTEXT_ENGINE_REPORT.md` | Every severity/containment/calibration/adjacency algorithm, real formulas, hand-verified against real alert data |
| `sentinel-pipeline/docs/DEMO_ARCHITECTURE_WALKTHROUGH.md` | Stage-by-stage frame journey, written for the live demo |
| `sentinel-pipeline/docs/PROJECT_STATUS.md` | Fuller status table, same spirit as this doc |
| `sentinel-pipeline/docs/CLASSIFIER_REQUIREMENTS.md` | The locked interface contract for the classifier engineer |
| `sentinel-pipeline/docs/MODEL_CLASSIFIER_CONTRACT.md` | Field-by-field contract spec and audit history |
| `sentinel-pipeline/docs/DASHBOARD_MIGRATION_PLAN.md` | The original per-page flags, rollback plan, functional-equivalence checklist |
| `sentinel-pipeline/docs/TODO_ACTION_ITEMS.md` | Full open-items list |
| `sentinel-pipeline/docs/FLICKER_SAMPLING_TRADEOFFS.md` | Undecided flicker-detection sampling strategies |
| `sentinel-pipeline/docs/MODEL_TRAINING_REQUIREMENTS.md` | Data/training requirements handed to the classifier engineer |
