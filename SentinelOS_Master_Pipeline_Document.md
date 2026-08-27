# SentinelOS Detection Pipeline — Master Architecture & Build Document

**Scope:** This document covers the full detection pipeline — Gate → Model → Classifier → Context Engine — from raw frame input to a final severity/alert decision, plus the system-level architecture (Pipeline as a standalone module vs. Dashboard as a client), calibration, multi-camera handling, and the build plan for each piece.

---

## 1. Purpose & Design Philosophy

The pipeline is split into four purpose-built blocks so each one has a single job, is independently testable, and only the genuinely expensive part (the AI model) costs real compute:

```
Input Frame → GATE → MODEL → CLASSIFIER → CONTEXT ENGINE → Alert / Log
                                 (Rules → CNN, two-tier)
```

| Stage | Runs on | Cost | Job |
|---|---|---|---|
| **Gate** | Every frame | Very cheap (pixel diff / background subtraction) | Decide if it's worth running the Model at all |
| **Model (YOLO)** | Only frames the Gate passes | Expensive — the one real AI cost per frame | Find candidate fire/smoke regions (recall-focused — cast a wide net) |
| **Classifier** | Only candidate boxes the Model found | Near-free (rules) → cheap and rare (CNN) | Verify candidates are real, reject false positives, classify smoke type (precision-focused) |
| **Context Engine** | Only confirmed real detections | Free (lookup + math) | Decide how much this matters — zone risk, containment, growth — and produce a severity/alert decision |

**Core principle carried through every stage:** only the Model stage touches pixels with a neural network. Everything else is classical math, rules, or config lookups — this is what keeps the pipeline fast even as more logic gets added, and it's why we rejected adding extra "stages" for every new idea (smoke-color classes, ignition-source types, etc.) in favor of folding techniques into the existing four blocks.

---

## 2. System-Level Architecture: Pipeline as a Standalone Module

The pipeline is built as its **own service/module with a clean, versioned API** — not embedded inside dashboard route files. The Dashboard is a thin client that consumes this API; it contains no detection logic of its own.

**Why:** every bug audit so far surfaced the same root problem in different clothes — detection/motion logic scattered across multiple frontend and backend files, each with a slightly different implementation. Formalizing this boundary now (before Gate and Context Engine exist yet) prevents that pattern from repeating, and makes the pipeline genuinely portable — it can be handed to any dashboard or camera system, not just this one.

### Proposed structure
```
sentinel-pipeline/          ← standalone service, own deployable process
  gate/
  model/
  classifier/
    rules.py
    cnn_model.py
    taxonomy.py
  context_engine/
  calibration/
  scheduler/                 ← multi-camera priority queue
  api/                        ← the ONLY public surface

dashboard/                   ← separate — consumes the pipeline API only
  frontend/
  backend/                    ← thin orchestration: auth, camera registry UI, calls pipeline API, stores what it needs for reporting/export
```

### Public API contract
| Endpoint | Purpose |
|---|---|
| `POST /v1/cameras` | Register a camera, returns `camera_id` |
| `POST /v1/cameras/{id}/calibrate/start` | Begin the calibration observation window |
| `GET /v1/cameras/{id}/calibrate/suggestion` | Get auto-suggested zone polygon + adjacency after the window closes |
| `POST /v1/cameras/{id}/zone` | Approve/set zone config (polygon, risk_weight, always-on flag) |
| `POST /v1/detect/frame` | Submit a single image → `{detections, classification, severity, evidence}` |
| `POST /v1/detect/video` | Submit a video file → returns `job_id`; poll `GET /v1/jobs/{id}` |
| `WS /v1/stream/{camera_id}` | Subscribe to live detection results for a registered camera — **must decouple display from inference** (see Section 4a) |
| `GET /v1/alerts` (or webhook registration) | Retrieve/subscribe to alerts |
| `GET /v1/health`, `GET /v1/model/info` | Status + real model metadata (dashboard should always read model info from here — never hardcode a model name in UI code) |

**Module boundary rule, confirmed via real testing:** alert-lifecycle features that don't touch pixels or detection logic — e.g. PIN-gated resolution, escalation flags, audit notes — belong entirely in the **Dashboard's** alert-management layer, not inside the pipeline module. If a feature doesn't need Gate/Model/Classifier/Context Engine to do its job, it doesn't belong in `sentinel-pipeline/`. (This distinction became concrete once PIN-gated resolution and escalation were scoped as real features — both are pure Dashboard/alert-lifecycle work.)

**Decisions to finalize:** whether this is a genuinely separate deployable service (own process/port, HTTP/WebSocket boundary) vs. an internally-separated package in the same process — leaning toward a true separate service given the goal of handing this off as an integratable product. API should be versioned (`/v1/...`) so internal pipeline improvements don't break external consumers.

---

## 3. Stage 1 — Gate

### Purpose
- Reduce compute cost — avoid running the expensive Model on frames where nothing meaningful is happening.
- Enable multi-camera scalability — cheap enough to run continuously on every camera at once.
- Preserve responsiveness — spend Model compute only on frames that changed.
- **Never create a blind spot** — a steady/unchanging fire source must still eventually get seen.

### Input
Raw frame from any source (webcam, RTSP, video file frame, uploaded image sequence) via a consistent frame-source abstraction.

### Operations
1. Lightweight preprocessing: downsample (e.g. ~160×90 for scoring), grayscale, mild blur, optional CLAHE (contrast enhancement for low-light/foggy/high-glare conditions).
2. Maintain a per-camera background model that adapts gradually (so day→dusk lighting drift doesn't trigger false motion).
3. Compute a change score against that background model.
4. Hysteresis-based **IDLE / ACTIVE** state machine — higher bar to enter ACTIVE, lower bar to drop to IDLE, preventing flapping on borderline noise.
5. Per-camera adaptive threshold (no single global threshold works across all cameras/environments).
6. **Forced periodic override** — regardless of motion score, force a frame through at a fixed interval. This is the confirmed fix for a steady/static fire source that never crosses a motion threshold.
7. Hand off passing frames (with metadata) to the scheduler for the Model stage.
8. Stay cheap enough to run on every camera, continuously — a hard constraint.

### Technique decision
**Background subtraction (MOG2 or KNN)** chosen over raw frame differencing (too noise-sensitive) and optical flow (too heavy for whole-frame use at this stage — a scoped version is instead used later, inside the Classifier, only on small candidate crops). Camera-native motion metadata (ONVIF etc.) used as a free first-pass signal where available.

### Forced override interval — locked decision
| Zone risk tier | Forced check interval |
|---|---|
| High risk (risk_weight ≥ 0.8) | Every 5–10 sec |
| Medium risk (0.4–0.8) | Every 20–30 sec |
| Low risk (< 0.4) | Every 60 sec |
| Uncalibrated (no zone yet) | 15–20 sec default fallback |

Operator can override the zone-derived default per camera. Not adaptive for the MVP — fixed interval per tier.

### Output
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

### Build plan (summary — see full Gate build document for step-by-step detail)
1. Build preprocessing pipeline standalone, test visually.
2. Build change scorer (background subtraction), log scores against real footage.
3. Build hysteresis state machine, unit test with synthetic score sequences.
4. Build forced-override timer, unit test independent of motion.
5. Build per-camera config schema + risk-tier interval lookup.
6. **Consolidate existing scattered motion-filter logic** (confirmed duplicated across multiple frontend/backend entry points) into this one shared module — replace, don't add a fifth parallel implementation.
7. Confirm the Gate scales cheaply across multiple concurrent cameras.
8. Validate against the full test checklist (static scene, steady fire via forced override, moving object, flickering light, day-night drift, multi-camera load).

---

## 4. Stage 2 — Model

### Purpose
The only stage that needs to understand raw pixels well enough to say "something here might be fire or smoke." Deliberately the expensive part — every other stage exists to minimize how often this runs and to clean up after it.

### Input
Frames that passed the Gate.

### Operations
Object detection producing candidate bounding boxes with a class guess and confidence score. **Tuned for recall, not precision** — over-flagging is acceptable and expected; precision is the Classifier's job.

### Current real-world state (confirmed via direct audit — evidence, not assumption)
- **Architecture:** YOLO26s (Ultralytics 8.4.104) — not YOLOv8, despite an earlier hardcoded UI label claiming otherwise. Any UI display of model name/version must read from a live model-info endpoint, never a hardcoded string.
- **Classes:** 3 — `fire`, `smoke`, `sparks`. `sparks` is currently remapped to the `fire` alert type. **Open decision:** whether this remapping is operationally correct, since a minor spark source could trigger a full "fire" severity alert — worth deliberate review rather than accepting silently.
- **No smoke-color distinction exists in the Model at all** — this confirms (doesn't newly reveal) that smoke-type classification must happen downstream, in the Classifier, not by retraining this base model.
- **Validation metrics from the training checkpoint:** precision 0.863, recall 0.793, mAP50 0.851, mAP50-95 0.679. No per-class breakdown or confusion matrix currently exists. Recall of 0.793 is on the low side for a system where a missed detection is the costlier failure mode — worth requesting per-class metrics (especially for smoke) and confirming what confidence threshold that number was measured at vs. the deployed threshold.
- **Device:** CPU-only in the current environment (~123ms raw inference per frame — reasonable for CPU).
- **Code path:** confirmed as a single clean singleton service used by all entry points — no fragmentation at this layer (unlike the Gate/motion-filtering situation).
- **Batching:** a `detect_batch()` function exists but is a sequential loop, not true GPU batching — relevant if/when multi-camera throughput needs it later.

### Known cross-cutting performance issue
A significant per-frame overhead (measured around ~580ms) was traced to settings being reloaded from the database on every single inference call, rather than cached in memory. This affects every entry point that calls the Model, since they all converge on the same service. **This should be fixed early** — it's a large, low-risk, high-value win independent of any other pipeline work, since actual YOLO inference itself (~123ms) is a small fraction of the total time currently being spent per frame.

### Output
Candidate bounding boxes: `{class, confidence, bbox}` per detection.

### Open decision
Whether to retrain/fine-tune the existing model (particularly to improve recall) as part of this build, or treat the current model as fixed and do all remaining improvement work downstream in Classifier/Context Engine. Affects how the Model-stage build plan is scoped.

---

## 4a. Cross-Cutting Requirement: Live Stream Display Must Be Decoupled From Inference

**Confirmed via live RTSP testing:** a real implementation exhibited display FPS exactly equal to inference FPS on every test (e.g. 3.5/3.5, 2.2/2.2, 5.2/5.2) — proof that the video display was being throttled to inference speed rather than rendering independently. Root cause: the frame-serving loop was blocking on a full Model inference call before yielding each frame to the client, so one frame was sent to the browser per inference cycle, not per camera frame. This produced choppy video with latency that grew over the session (consistent with an unbounded frame backlog rather than a bounded, drop-oldest queue).

**This must be treated as a hard architectural requirement for every live-stream entry point (webcam, RTSP), not a one-off bug fix:**
- A dedicated frame-reader thread/process reads raw frames from the source at its native rate and pushes them into a bounded queue (`maxsize=1`, drop-oldest) — never an unbounded queue that can build a backlog.
- The stream-serving loop always renders the **latest available frame** to the client, independent of inference status — display is never blocked waiting on the Model.
- Inference runs on a **sampled** subset of frames (every Nth frame, or on an elapsed-time interval) — not on every single frame — and always operates on the freshest frame available, discarding stale ones rather than working through a backlog.
- `stream_fps` (native camera/display rate) and `inference_fps` (Model throughput) must be tracked and reported as genuinely separate values — if a UI ever shows them as identical, that's a signal this decoupling isn't actually implemented, not a coincidence.

This requirement applies to the pipeline's `WS /v1/stream/{camera_id}` endpoint (Section 2) and to the Gate's per-camera frame handling (Section 3) alike.

## 4b. Cross-Cutting Requirement: Evidence Capture Must Be Guaranteed for Every Entry Point

**Confirmed via testing:** evidence capture (snapshot image + DB `evidence_path` + a logged detection event) was implemented for the video-upload job path, but a separate live-RTSP entry point independently reached the alert-creation step without ever calling the same evidence-capture logic — resulting in confirmed alerts with no supporting image.

**This must be specified as an output contract of the Context Engine (Section 6), not an implementation detail left to each entry point to remember individually:** any confirmed alert, regardless of which source produced it (webcam, RTSP, uploaded video, uploaded image), must carry a non-null evidence reference before being written to the alert store. This should be enforced at the single shared point where alerts are created (matching the "one singleton" pattern already confirmed for the Model stage — see Section 4), not re-implemented per entry point.

## 5. Stage 3 — Classifier

### Purpose
The Model is deliberately over-sensitive. The Classifier's whole job is precision — reject false positives and add the nuance (like smoke color) the Model doesn't provide, without slowing down the common case.

### Input
Cropped candidate patches (bounding box regions) from the Model stage — not full frames.

### Two-tier internal design
| Tier | What it does | Cost |
|---|---|---|
| **Tier 1 — Rules** | Classical CV checks (HSV/saturation/brightness/texture) on every candidate. Rejects obvious false positives instantly. Note: an existing "Stage 2 HSV verification" step already present in the current codebase effectively is this tier — it needs extending (smoke-color logic, additional signals below) rather than building from scratch. | Near-free |
| **Tier 2 — Small CNN** | Only runs on the ambiguous subset Tier 1 isn't confident about. A small trained image classifier (e.g. MobileNetV3-Small or similar) makes the final call. Does not currently exist — needs to be built. | Cheap, and rare |

### Additional Tier-1 signals worth folding in (from industrial-pipeline research review)
- **Optical flow motion pattern**, scoped only to the small candidate crop (cheap): smoke moves chaotically upward/outward; a rigid moving object (e.g. a vehicle) moves linearly. A useful extra rejection signal beyond color/texture alone.
- **Flicker-frequency analysis (FFT)**: real flame flickers at roughly 5–10Hz; a steady light source (streetlight, warning light, glare) does not. This requires a short history of frames for the *same* candidate region, not a single frame — which means it depends on lightweight object tracking (see below).

### Tracking — shared infrastructure, not a new pipeline stage
Both the flicker check above and the Context Engine's growth-rate check (Section 6) need to follow the same candidate region across multiple frames. This requires lightweight tracking (matching boxes frame-to-frame by IoU/centroid). The existing app already references ByteTrack in its UI — worth confirming whether that infrastructure already exists and can be wired to feed both the Classifier's temporal checks and the Context Engine's growth tracking, rather than building tracking twice.

### Class taxonomy — decided
```
{ fire, white_smoke, grey_smoke, black_smoke, false_positive }
```
**Deliberately excludes** per-ignition-source classes (cigarette, lighter, candle, welding spark, structure fire, vehicle fire, etc.). Two reasons: (1) many small ignition sources are visually near-indistinguishable at camera resolution, making reliable classes impractical to collect data for; (2) the ignition source matters less than size/duration/growth/zone — which the Context Engine already handles. This keeps the taxonomy stable across new scenarios without ever needing retraining for a new "type" someone thinks of later.

### Training plan
- **Positive examples:** cropped patches of real fire and each smoke type, across day/night, distances, camera types, environments.
- **Hard negatives — the critical part:** collected primarily from production false positives via a continuous feedback loop — every rejected candidate (by the classifier or an operator) gets logged as a labeled negative, tuning the classifier to this system's specific cameras/environments rather than generic data.
- **Bootstrap datasets** (before production logs exist): D-Fire, FASDD, Smoke100k, FIRESENSE, relevant Kaggle wildfire/smoke sets — used for initial pretraining, then fine-tuned on production data.
- **Confirmed hard-negative categories to include:** fog/mist/haze; steam (vents, kettles, exhaust, cooling towers, kitchen vents); vehicle exhaust; dust/sand disturbance; backlit sunset/sunrise clouds; sun glare/lens flare; reflections (water, glass, metal); artificial warning/brake/headlights, neon signage; orange/red fabric, tarps, safety vests, flags; autumn foliage in warm light; welding/grinding sparks; fireworks; streetlights/stadium lighting at night; backlit dust in sunbeams; specular glints; insects/birds near the lens at night; (if thermal/IR) hot engine parts, animal eye-shine, IR illuminator hotspots.
- **Test set:** must include held-out real footage from the system's actual cameras/environments, not just public dataset images.
- **Tuning bias:** favor recall over precision here too — a missed real fire is far more costly than an extra false alarm passed downstream.

### Requirements checklist
- [ ] Finalize class taxonomy (done)
- [ ] Labeled dataset: bootstrap from public sets, grow from production logs
- [ ] Cropping/preprocessing pipeline from Model stage's bounding box output
- [ ] Held-out real-camera test set
- [ ] Production logging of every classifier decision + operator override
- [ ] Latency budget per crop (deferred to benchmarking phase)

### Output
`{class, confidence, smoke_type (if applicable)}` per candidate box.

---

## 6. Stage 4 — Context Engine

### Purpose
A confirmed real fire/smoke detection isn't automatically an emergency — the same fire can be routine (permitted bonfire, furnace operating normally) or hazardous (near flammable storage, spreading, unexpected) depending on where and how it's behaving. This stage answers "how much does this matter?" using metadata and math — no additional AI inference, keeping it essentially free at runtime.

### Input
Confirmed real detections from the Classifier, plus zone config and detection history (tracked over time).

### Core mechanism — generalized containment pattern
Rather than separate logic per scenario type, every zone is defined by:
1. **A containment boundary** — where fire/smoke is expected to exist for this zone.
2. **A normal envelope** — expected size range, and whether the source is always-on (furnace, flare, chimney) or occasional (bonfire).

Two universal runtime checks apply regardless of what's actually producing the fire:
1. Is the detection inside the containment boundary? → inside = normal. Outside = breach, escalate.
2. Is size/duration/growth within the normal envelope? → stable = normal. Growing/spreading = escalate, regardless of zone risk level.

### Severity scoring (illustrative)
```
severity = base_confidence × zone_risk_weight × growth_rate_factor − controlled_activity_discount
```

### Zone config example
```
zone_id: "outdoor_break_area"
flammable_materials_nearby: false
designated_activity_allowed: ["bonfire", "smoking_area"]
risk_weight: 0.2

zone_id: "chemical_storage"
flammable_materials_nearby: true
designated_activity_allowed: []
risk_weight: 1.0
```

### Applied scenario examples
| Scenario | Containment | Behavior |
|---|---|---|
| Furnace | Furnace mouth/chamber polygon | Alert only if flame/smoke appears outside the opening |
| Oil field flare stack | Flare tip polygon, always-on flag | Alert on abnormal height/spread, or fire on nearby equipment |
| Factory chimney/smoke outlet | Chimney stack polygon, continuous-smoke flag | Alert if smoke appears outside the stack, or color/density changes abnormally |
| Bonfire in break area | Loosely-bounded outdoor polygon | Alert if it spreads beyond the marked area or growth exceeds a normal bonfire pattern |
| Any accidental fire | No containment defined, or containment breached | Always alert |

### Output
A severity/alert decision, with the evidence and reasoning (zone, growth, confidence) attached for the Dashboard/operator to review.

---

## 7. Calibration Mode (feeds both Gate and Context Engine)

Solves the problem of manually configuring every camera by making setup **auto-suggested, human-approved** rather than fully manual or fully automatic.

### Process
1. New camera enters a calibration observation window (e.g. 24–72 hours, or a few operating cycles for cyclical sources).
2. During calibration, the full pipeline still runs and still alerts on anything unusual — no blind spot is created; only zone-based suppression is unavailable until a zone exists.
3. Every confirmed-normal detection logs its position, size, and timestamp.
4. After the window, cluster the logged positions (density clustering / convex hull with outlier trimming) into a suggested containment polygon, plus size statistics for the normal envelope.
5. **One-click human approval** — operator approves or adjusts the suggested polygon; seconds of work, not manual drawing.
6. If detections were continuous through the window, the zone is auto-flagged `always_on = true`.

### Safety principle — never silently auto-expand
If detections later start consistently landing just outside an approved polygon, the system flags this to a human rather than silently widening the boundary — critical because a slowly-growing real fire is exactly the kind of thing that must never get auto-learned as "normal."

### Anchoring to fixed physical structures (furnace, flare tip, chimney)
No separate structure-detection model needed in most cases — since these sources are always-on, the calibration clustering step already anchors to the physical hardware implicitly (the fire/smoke signature marks the structure's location throughout the window).

For camera drift after calibration (bumped, re-mounted, adjusted): keep a reference frame from calibration time, periodically run classical feature matching (ORB/SIFT — fast, no training needed) against the current frame, and either auto-shift the polygon by the computed transform or (safer) flag a human — an unexpected shift may also indicate tampering.

### Camera adjacency map — same calibration flow
Combines two signals into the same one-click approval:
1. **Geometric seed:** rough camera position + facing direction placed on a site map at setup, used to auto-suggest overlapping coverage without waiting for a real event.
2. **Behavioral confirmation:** cross-camera timing correlation during the calibration window (do two cameras' triggers repeatedly fire at the same moments?) confirms or catches adjacency the geometric estimate missed.
3. Suggested adjacency pairs are presented alongside zone polygon suggestions for the same approval step.

---

## 8. Multi-Camera Handling

### Scheduling
The Gate concept extends across cameras, not just across frames: the cheap Gate runs on **every camera, continuously** (near-free), and only promotes a camera's frame into a priority queue feeding the (expensive, shared) Model stage when its Gate signals activity. This means compute is spent only where something is actually happening.

**Priority ordering** (used when multiple cameras trigger simultaneously and Model throughput can't serve all at once):
| Priority factor | Why |
|---|---|
| Active/unresolved alert already on that camera | Needs continuous processing to track fire growth |
| Zone risk weight | High-risk zones bump ahead of low-risk zones |
| Recency/strength of gate signal | Stronger motion suggests more urgency |
| Round-robin fallback | Ensures no camera is starved indefinitely |

### Same fire, multiple cameras vs. different fires
Reuses the calibration-derived adjacency map rather than requiring new geometry/triangulation work:
- Detections in the **same zone**, or zones flagged **adjacent/overlapping**, within a short time window → treated as **one incident**, multiple camera evidence sources attached to the same record.
- Detections with **no defined overlap** → treated as **fully independent incidents**, each tracked and alerted separately; one must never mask or delay the other.

---

## 9. Benchmarking Plan (methodology — execution deferred until pipeline is built)

1. Define target frame rate/budget first (e.g. 15–30 FPS sources → ~33–66ms total per-frame budget).
2. Break the budget down per stage and measure independently (Gate <5ms, Model per current hardware findings, Classifier Tier 1 <1ms / Tier 2 <10ms on the ambiguous subset only, Context Engine <1ms).
3. Measure **percentiles (p50/p95/p99), not just averages** — worst-case latency matters more than typical case for a disaster-detection system.
4. Benchmark on actual target deployment hardware, not a dev machine.
5. Load-test under multi-camera concurrency to see how per-camera latency degrades as more streams are added simultaneously.

---

## 10. Build Roadmap

| Block | Status | Notes |
|---|---|---|
| Gate | Spec complete, build plan written, not yet implemented | See dedicated Gate build document for step-by-step detail |
| Model | Substantially exists and works (single clean code path, real trained weights) | Needs: DB-overhead fix (high priority, cross-cutting), decision on retraining, per-class metric review |
| Classifier | Tier 1 partially exists (as "Stage 2 verification"); Tier 2 CNN, smoke-color logic, taxonomy, and hard-negative pipeline all need building | Currently in progress — being rebuilt inside the pipeline module boundary |
| Context Engine | Not built yet | Depends on Calibration Mode for zone/adjacency setup |
| Calibration Mode | Designed, not yet implemented | Feeds both Gate (per-camera thresholds — future refinement) and Context Engine (zones, adjacency) |
| Multi-camera scheduler | Designed, not yet implemented | Depends on Gate being complete first |
| Pipeline/Dashboard API separation | Structure decided, not yet implemented | Ideally established before too much new code is written inside either module, to avoid the same fragmentation pattern recurring |

**Recommended build order:** Gate → fix Model's DB-overhead issue (independent, quick win) → Classifier (in progress) → Context Engine + Calibration Mode together (Context Engine depends on calibration output) → Multi-camera scheduler → formalize the Pipeline/Dashboard API boundary around all of it.

---

## 11. Consolidated Decisions Log

| Topic | Decision |
|---|---|
| Overall pipeline | Gate → Model → Classifier (Rules → CNN two-tier) → Context Engine |
| System architecture | Detection Pipeline built as its own module/service with a versioned public API; Dashboard is a thin client with no detection logic |
| Classifier taxonomy | `{fire, white_smoke, grey_smoke, black_smoke, false_positive}` — no per-ignition-source classes |
| Severity handling | Delegated to Context Engine (zone, size, duration, growth), not the classifier taxonomy |
| Hard negative mining | Production false positives logged and fed back into periodic classifier retraining |
| Zone containment | Generalized "boundary + normal envelope" pattern, uniform across furnace/flare/chimney/bonfire/etc. |
| Zone & adjacency setup | Automated via Calibration Mode — auto-suggested, human one-click approved, never silently auto-expanded |
| Structure anchoring | No separate detector needed for always-on sources (implicit via calibration clustering); drift handled via classical feature matching |
| Multi-camera scheduling | Gate runs continuously on all cameras; Model stage only serves cameras the Gate promotes, via a priority queue |
| Same-fire deduplication | Based on zone/adjacency map + time window, not 3D triangulation |
| Model architecture (current) | YOLO26s, 3 classes (fire/smoke/sparks), CPU inference, single clean code path |
| Benchmarking | Deferred until pipeline blocks are built; percentile-based methodology defined |

---

## 11a. Confirmed From Live Testing (New Findings)

- **Display/inference coupling bug** — confirmed via real RTSP testing across multiple sessions (display FPS = inference FPS every time). See Section 4a for the required fix — this is now a hard requirement, not just an observed bug.
- **Evidence capture gap** — confirmed one entry point (live RTSP) reached alert creation without the shared evidence-capture step used by the video-upload path. See Section 4b — now specified as a Context Engine output contract.
- **A third, independently broken camera-display implementation was found** (Live Monitoring page) — hardcoded fake FPS value and a static placeholder image, not a real stream at all — separate from the (also broken, now being fixed) implementation on the Detection page. This is concrete, real evidence for why Section 2's "one shared component, no fragmented implementations" rule matters — this exact failure mode has now recurred at least three times across different pages/entry points in this codebase.
- **Open follow-up:** whether the Dashboard's multi-camera grid tiles (separate from the single-stream RTSP connect flow) share any of this same pattern has not yet been audited — worth checking before considering camera-display consolidation complete.

## 12. Open Items

- **Gate forced-override interval** — locked at the tier level (Section 3); still needs implementation and validation against real footage.
- **Model retraining decision** — whether to improve the base model (particularly recall) or treat it as fixed and do all remaining work downstream.
- **"Sparks → fire" remapping** — needs a deliberate operational review, not silent acceptance.
- **Per-class model metrics** (especially for smoke) and the confidence threshold they were measured at — not yet available, worth requesting explicitly.
- **Tracking infrastructure** — confirm whether existing tracking (referenced in the current UI) can be reused for both Classifier temporal checks and Context Engine growth tracking, or needs to be built fresh.
- **Pipeline/Dashboard service separation** — decide: fully separate deployable service vs. internally separated package: leaning toward a true separate service given the goal of this being handed off as an integratable product.
