# TODO / Action Items — Real-World Blocked

**Date:** 2026-08-17

Everything here requires conditions this development environment does not have:
live cameras, a real observation window, confirmed production hardware, a human
approval step, or data nobody has handed over. **None of it was attempted,
simulated or faked.** Where a partial result exists, it is labelled as partial.

Items that could be finished here have been, and are not listed — see
`PROJECT_STATUS.md`.

---

## A. Blocked on real-world conditions

### A1. Zone containment + camera adjacency calibration
**Owner:** site operator + whoever installs the cameras
**Blocked by:** needs real cameras observing a real scene for a real window

The full calibration machinery is built and tested: observation windows,
DBSCAN/convex-hull clustering with outlier trimming, always-on detection,
normal-envelope statistics, behavioural adjacency correlation, one-click
approval, boundary-drift flagging, and persistence across restart.

**What cannot be done in dev:** the observation itself. A furnace zone is
learned from a furnace actually operating for 24–72 hours. Synthetic frames
would produce a polygon around synthetic data — worse than no polygon, because
it would look configured.

**Required:**
1. Install and register cameras: `POST /v1/cameras`
2. `POST /v1/cameras/{id}/calibrate/start` — 24–72 h, or a few operating cycles
   for cyclical sources (flare stacks)
3. Let the window run. **Detection and alerting continue throughout** — no blind
   spot; only zone-based suppression is unavailable
4. `GET /v1/cameras/{id}/calibrate/suggestion`
5. **Human approves** via `POST /v1/cameras/{id}/zone` — and must set
   `risk_weight` deliberately. The suggestion defaults to 0.5 and says so; risk
   is an operational judgement no clustering can infer
6. `POST /v1/cameras/{id}/drift/reference` — store the reference frame while the
   camera is known-good

**Until done:** cameras run uncalibrated. That is safe by design — no
containment means every detection is treated as a breach, and the forced
override runs at the conservative 17 s uncalibrated interval.

### A2. Camera adjacency map
**Owner:** site operator
**Blocked by:** same window as A1, plus a site layout

Adjacency drives same-fire deduplication across cameras. Two inputs:
- **Geometric seed** — rough camera positions and facing on a site map. *Needs a
  site map that does not exist here.*
- **Behavioural confirmation** — cross-camera trigger correlation during the
  window. Implemented; needs the window.

**Until done:** cameras with no declared overlap produce **separate incidents**.
That is the deliberate safe default — merging two real fires would hide one.

### A3. Held-out real-camera test set
**Owner:** site operator + Classifier team
**Blocked by:** requires footage from the deployed cameras

Public datasets validate benchmark performance, not the deployment. Hold out
**by camera and by day, never by random crop split** — random splits leak
near-duplicate frames and inflate scores substantially.

### A4. Validation video for Motion and Flicker
**Owner:** Classifier team + site operator
**Blocked by:** no video-sequence dataset exists

Per the Phase Reference, Phases 3 and 4 need labelled *video*, not static crops:
real fire/smoke movement, fog/mist drift, rigid moving false positives
(vehicles, flags, birds), flickering flame, and steady light sources.

**Until then both phases ship log-only.** The contract supports this via
`advisory_phases`; verdicts are recorded and excluded from control flow.

---

## B. Blocked on decisions or data from others

### B1. YOLO retrain decision — **PENDING**
**Owner:** dataset owner
**Status at time of writing: unresolved.** Per-class `yolo val` metrics have not
been supplied, so no retrain decision has been made.

**Still required — one command, highest value per unit of effort:**
```bash
yolo val model=best.pt data=/path/to/merged_dataset/data.yaml split=val
```
Plus: the confidence threshold the published recall of 0.793 was measured at.

**Partial progress from the dataset reports supplied 2026-08-17.** These are
dataset-composition facts, *not* val metrics, and do not substitute for B1:

| Class | Annotations | Images | Near-fullframe boxes | Exactly 1×1 |
|---|---|---|---|---|
| fire | 103,135 | 43,572 | 123 (0.12%) | 3 (0.00%) |
| smoke | 68,698 | 53,426 | 1,293 (1.88%) | 314 (0.46%) |
| **sparks** | **21,291** | **7,371** | **2,410 (11.32%)** | **1,205 (5.66%)** |

Totals: 120,542 images, 193,127 annotations, 42,793 explicit background images
(35.5% — good practice for false-positive suppression), 0 corrupted.

**Finding — the `sparks` class is structurally degraded.** Almost all of that
degeneracy comes from one subset: `SparkDetector` has **2,410 of 2,453 boxes
near-fullframe (98.25%)**, and **49.12% are exactly the whole image**. So part
of the sparks class was trained on "sparks = entire frame". Sparks is also the
smallest class (6.1% of images) and carries roughly **94× the fullframe rate of
fire**.

**Actions this implies, independent of B1:**
- Remove or re-annotate the `SparkDetector` fullframe boxes before any retrain
- Delete the 3 degenerate zero-area boxes:
  `FASDD_bothFireAndSmoke_CV001979.txt:3` (w=0),
  `FASDD_bothFireAndSmoke_CV018145.txt:1` (w=0),
  `FASDD_bothFireAndSmoke_CV010851.txt:3` (h=0)
- Do not trust any spark-geometry heuristic without re-validation

### B2. `sparks` operational decision
**Owner:** project owner + Classifier team
The pipeline passes `sparks` through untouched as `class_raw="sparks"`. No
Tier-1 phase covers it. Options and evidence: `CLASSIFIER_REQUIREMENTS.md` §7.
**Do not auto-escalate `sparks → fire` without deciding deliberately** — B1's
label evidence argues against it.

### B3. Flicker sampling — Option D sign-off
**Owner:** project owner + Classifier team
**Status: awaiting joint review. Not implemented, per instruction.**
Full comparison: `FLICKER_SAMPLING_TRADEOFFS.md`. Flicker remains log-only.
Three questions needed from the Classifier team are listed in
`CLASSIFIER_REQUIREMENTS.md` §6.

### B4. Tier-2 CNN input resolution
**Owner:** Classifier team
96 / 128 / 224. Recommend 128×128. Must be fixed before data prep and baked into
the delivered artifact's preprocessing.

### B5. Tier-2 CNN training
**Owner:** whoever trains it — **explicitly held**
Full spec: `MODEL_TRAINING_REQUIREMENTS.md`. Nothing started.

---

## C. Blocked on deployment facts

### C1. Production hardware — GPU or CPU
**Owner:** project owner
**Status: still unconfirmed.**

This dev machine has an RTX A2000 (6 GB, CUDA 13.2). The project's own audit
recorded the prior environment as CPU-only. Measured here:

| | GPU (measured) | CPU (from prior audit) |
|---|---|---|
| Model p50 | **8.66 ms** | ~123 ms |
| Ratio | — | **~14× slower** |

Consequences if the target is CPU-only:
- Single-camera capacity drops sharply; the ~77-camera estimate in
  `tests/benchmark.py` is a GPU number and does **not** transfer
- Burst-rate flicker sampling (Option A in B3) becomes impossible — 30 fps
  inference is unreachable at 123 ms/frame
- `scheduler_workers` and gate intervals need re-tuning

**Mitigation in place:** `PIPELINE_DEVICE=auto` degrades gracefully, and every
benchmark states the device it ran on. **Nothing is blocked on this** — it
affects sizing, not correctness.

**Action:** confirm the target, then re-run
`python tests/benchmark.py` **on that hardware**. Do not size from the numbers
in this repo.

### C2. Production deployment topology
**Owner:** project owner
Needed before dashboard cutover (`DASHBOARD_MIGRATION_PLAN.md` §7.5): same host
or separate? Determines CORS config and whether `PIPELINE_API_KEY` is mandatory.

### C3. API key for production
**Owner:** whoever deploys
`PIPELINE_API_KEY` is **unset**, so the API is currently unauthenticated. That
is fine on localhost and visible on `/v1/health` as `"auth": "DISABLED"` — it
cannot be confused with a secured deployment. **Set it before exposing the
service.**

### C4. Version control
**Owner:** project owner
Neither `Fire&Smoke/` nor `Fire_Smoke_Application-main/` is a git repository.
Given this project has already lost work to an unversioned `git checkout`
incident, `git init` is a prerequisite for the dashboard migration
(`DASHBOARD_MIGRATION_PLAN.md` step 0), not an optional nicety.

---

## D. Deferred by instruction

| # | Item | Notes |
|---|---|---|
| D1 | Dashboard migration execution | Plan written, awaiting approval |
| D2 | Deleting superseded dashboard/backend detection code | Phase 3, separate approval |
| D3 | The Classifier itself | Built separately by teammate |

---

## E. Not blocked — smaller items I judged out of scope

| Item | Why left |
|---|---|
| Postgres support | SQLite+WAL is sufficient at current scale; `PIPELINE_DATABASE_URL` already accepts a Postgres URL |
| Evidence retention/pruning | Needs a retention policy decision (how long must evidence be kept?) — a compliance question, not a technical one |
| Prometheus/OpenTelemetry export | `/v1/health` and `/v1/scheduler` expose the data; no monitoring stack confirmed |
| Multi-worker scaling | One shared Model means extra workers don't multiply throughput; revisit if C1 says GPU and multi-GPU |

---

## Priority

| Rank | Item | Why |
|---|---|---|
| 1 | **B1** — `yolo val` per-class metrics | One command; decides whether a retrain is needed at all |
| 2 | **C4** — `git init` | Blocks the dashboard migration entirely |
| 3 | **C1** — hardware target | Blocks realistic sizing |
| 4 | **B3** — flicker sign-off | Blocks the Classifier team's Phase 4 |
| 5 | **A1** — calibration | Needs installed cameras; longest lead time, start early |
