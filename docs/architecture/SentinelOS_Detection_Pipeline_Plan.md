# SentinelOS — Fire/Smoke Detection Pipeline: Architecture & Planning Document

**Status:** Working plan — Gate and Model stages need deeper detailing (flagged below). Calibration and Context Analysis are the most fleshed-out sections so far.

---

## 1. Why This Redesign

The existing detection setup was doing too much in too few places — a single model/threshold combination was being asked to detect fire, judge severity, and avoid false alarms all at once. This caused specific, observed failures:

- White smoke was missed while black smoke wasn't (thresholds biased toward dark smoke)
- No way to distinguish a genuinely hazardous fire from a harmless one (e.g. a bonfire in a safe outdoor zone vs. a fire near flammable storage) without hardcoding scenario-specific logic
- No clean path to reduce false alarms over time
- Risk of the whole system becoming slow/heavy if every stage tried to be maximally accurate

The redesign splits responsibility into four purpose-built blocks, so each one has **one job**, is independently testable, and only the genuinely expensive part (the AI model) costs real compute.

---

## 2. Pipeline Overview

```
Input Frame → GATE → MODEL → CLASSIFIER → CONTEXT ENGINE → Alert / Log
                                 (Rules → CNN, two-tier)
```

| Stage | Runs on | Cost | Job |
|---|---|---|---|
| **Gate** | Every frame | Very cheap (pixel diff / motion) | Decide if it's worth running the model at all |
| **Model (YOLO)** | Only frames the Gate passes | Expensive — the one real AI cost per frame | Find candidate fire/smoke regions (cast a wide net, recall-focused) |
| **Classifier** | Only candidate boxes the Model found (usually 0–2 per frame) | Near-free (rules) → cheap and rare (CNN) | Verify candidates are real, reject false positives, classify smoke type (precision-focused) |
| **Context Engine** | Only confirmed real detections | Free (lookup + math) | Decide how much this matters — zone risk, containment, growth — and produce a severity/alert decision |

**Design principle carried through every stage:** only Stage 2 (Model) touches pixels with a neural network. Everything else is classical math, rules, or config lookups — this is what keeps the pipeline both fast and cheap to run, even as more logic gets added.

---

## 3. Stage-by-Stage Detail

### 3.1 Gate *(flagged as not yet fully detailed — placeholder based on discussion so far)*

- **Why this stage exists:** Running the AI model on every single frame from every camera is wasteful — most frames show no meaningful change. The Gate exists purely to avoid spending model compute on frames where nothing is happening.
- **What it handles:** Frame-to-frame motion/change detection (pixel diff or similar lightweight technique).
- **Requirements:** A per-camera baseline/previous-frame reference; a tunable sensitivity threshold.
- **Outputs:** Pass/skip decision per frame.
- **Known open issue:** In live testing, a **steady/near-static fire source** (e.g. holding a phone showing fire, or a phone camera held still) can produce a motion score too low to ever cross the Gate threshold — meaning inference may never run even once. This needs a fallback (e.g. forced periodic inference every N seconds regardless of motion) so a stable fire source is never permanently invisible to the system. **This needs to be resolved before the Gate stage is considered done.**
- **Also planned:** extending the Gate concept across multiple cameras — see Section 5 (Multi-Camera Handling).

### 3.2 Model (YOLO) *(also flagged as needing deeper detailing — placeholder based on discussion so far)*

- **Why this stage exists:** This is the only stage that needs to understand raw pixels well enough to say "something here might be fire or smoke." It's the expensive part on purpose — every other stage exists to minimize how often this one has to run, and to clean up after it.
- **What it handles:** Object detection on frames that pass the Gate; outputs candidate bounding boxes with a class guess and confidence score.
- **Tuning philosophy:** Should be tuned for **recall, not precision** — it's fine (expected, even) for it to over-flag. Precision is the Classifier's job downstream. Trying to make this one model both sensitive and precise tends to make it worse at both.
- **Known dependency:** Confirmed that `models/best.pt` needs to be correctly loaded and wired (`self.ready = True`) for this stage to function — this was root-caused as a contributing factor to several downstream symptoms (webcam not detecting, missing evidence, missing alerts) and needs to be verified as genuinely fixed, not just reported as fixed.
- **Still to be decided:** input resolution/frame size trade-offs, batching strategy for multi-camera throughput (see Section 5), and target latency budget per inference call (deferred until benchmarking phase).

### 3.3 Classifier — Two-Tier Design

**Why this stage exists:** The Model is deliberately over-sensitive (recall-focused). The Classifier's whole job is to clean that up — reject false positives and add precision, without slowing down the common case.

**Two-tier internal structure** (this is *one* block, not two extra pipeline stages):

| Tier | What it does | Cost |
|---|---|---|
| **Tier 1 — Rules** | Classical CV checks (HSV/saturation/brightness/texture thresholds) run first, on every candidate box. Rejects obvious false positives (bright clear sky, flat colored surfaces) instantly. | Near-free |
| **Tier 2 — Small CNN** | Only runs on the ambiguous subset the rules aren't confident about. A small trained image classifier (e.g. MobileNetV3-Small or similar lightweight backbone) makes the final call. | Cheap, and rare (only runs on a small fraction of candidates) |

**Class taxonomy — decided:**
```
{ fire, white_smoke, grey_smoke, black_smoke, false_positive }
```
**Decision rationale:** We deliberately did *not* build classes for specific ignition sources (cigarette, lighter, candle, welding spark, structure fire, vehicle fire, etc.). Two reasons:
1. Visually, many small ignition sources are near-indistinguishable at camera resolution/distance — building reliable classes for each would need large, hard-to-collect datasets for little practical benefit.
2. The ignition source doesn't actually change the response protocol as much as **size, duration, growth rate, and zone** do — and those are already handled downstream by the Context Engine. This keeps the taxonomy stable and scalable to new scenarios (furnace, oil field flare, factory chimney, bonfire, etc.) without ever needing to retrain for a new "type" of fire someone thinks of later.

**Training plan:**
- **Positive examples:** cropped patches of real fire and each smoke type, across day/night, distances, camera types (visible + IR if applicable), and environments.
- **Hard negatives (critical):** collected primarily from our own production false positives via a feedback loop — every time a candidate is rejected (by the classifier or by an operator), log the crop as a labeled negative. This tunes the classifier to *our* specific cameras/environments, not just generic data.
- **Bootstrap data sources (before production logs exist):** D-Fire, FASDD, Smoke100k, FIRESENSE, relevant Kaggle wildfire/smoke datasets — used for initial pretraining, then fine-tuned on our own logged data.
- **Confirmed hard-negative categories to include:**
  - Fog, mist, haze
  - Steam (vents, kettles, exhaust pipes, cooling towers, kitchen vents)
  - Vehicle exhaust
  - Dust/sand disturbance
  - Clouds — especially backlit sunset/sunrise (fire-colored) clouds
  - Sun glare / lens flare
  - Reflections (water, glass, polished metal)
  - Artificial lights — red/orange warning lights, brake lights, headlights, neon signage
  - Orange/red fabric, tarps, safety vests, flags
  - Autumn foliage in warm light
  - Welding/grinding sparks (legitimate, different temporal pattern than sustained fire)
  - Fireworks (if relevant to site)
  - Streetlights/stadium lighting at night
  - Backlit dust in sunbeams
  - Specular glints on wet/metal surfaces
  - Insects/birds near the lens at night (motion blobs under IR)
  - (If thermal/IR cameras used) hot engine parts, animal eye-shine, IR illuminator hotspots
- **Test set:** must include held-out real footage from our actual cameras/environments, not just public dataset images — this is what validates real-world generalization rather than benchmark performance.
- **Tuning bias:** favor recall over precision at this stage too, when in doubt — a missed real fire is a far more expensive mistake than an extra false alarm passed downstream.

**Requirements checklist:**
- [ ] Finalize class taxonomy (done — see above)
- [ ] Labeled dataset: bootstrap from public sets, grow from production logs
- [ ] Cropping/preprocessing pipeline from Model stage's bounding box output
- [ ] Held-out real-camera test set
- [ ] Production logging of every classifier decision + operator override (feeds the hard-negative loop)
- [ ] Defined latency budget per crop (deferred to benchmarking phase)

**Outputs:** `{class, confidence, smoke_type (if applicable)}` per candidate box.

### 3.4 Context Engine

**Why this stage exists:** A confirmed real fire/smoke detection isn't automatically an emergency — the same fire can be routine (a permitted bonfire, a furnace operating normally) or hazardous (near flammable storage, spreading, unexpected) depending on *where* and *how* it's behaving. This stage answers "how much does this matter?" using metadata and math, not more AI inference — keeping it essentially free at runtime.

**Core mechanism — generalized containment pattern:**
Rather than writing separate logic per scenario type (furnace vs. flare vs. chimney vs. bonfire), every zone is defined by:
1. **A containment boundary** — where fire/smoke is expected to exist for this zone.
2. **A normal envelope** — expected size range, and whether the source is always-on (furnace, flare, chimney) or occasional (bonfire).

At runtime, two universal checks apply regardless of what's actually producing the fire:
1. **Is the detection inside the containment boundary?** → inside = normal, no alert. Outside = containment breach, escalate.
2. **Is size/duration/growth within the normal envelope?** → stable = normal. Growing/spreading = escalate, regardless of zone risk level.

**Severity scoring (illustrative formula):**
```
severity = base_confidence × zone_risk_weight × growth_rate_factor − controlled_activity_discount
```
All inputs here are values already produced by earlier stages or simple frame-to-frame tracking — no additional model inference required.

**Zone config example:**
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

**Applied scenario examples:**

| Scenario | Containment | Behavior |
|---|---|---|
| Furnace | Furnace mouth/chamber polygon | Alert only if flame/smoke appears **outside** the opening |
| Oil field flare stack | Flare tip polygon, always-on flag | Alert on abnormal height/spread, or fire on nearby equipment (not the flare itself) |
| Factory chimney/smoke outlet | Chimney stack polygon, continuous-smoke flag | Alert if smoke appears outside the stack, or color/density changes abnormally |
| Bonfire in break area | Loosely-bounded outdoor polygon | Alert if it spreads beyond the marked area or duration/growth exceeds a normal bonfire pattern |
| Any accidental fire | No containment defined, or containment breached | Always alert |

---

## 4. Calibration Mode (Automating Zone & Adjacency Setup)

**Problem it solves:** Manually drawing containment polygons for every camera doesn't scale, and hand-drawn boundaries are error-prone (a mistake can sit unnoticed for months). Calibration mode makes this **auto-suggested, human-approved** rather than either fully manual or fully automatic.

**Process:**
1. **Trigger:** a new camera enters "calibration" state for a defined observation window (e.g. 24–72 hours, or a few operating cycles for cyclical sources like a flare stack).
2. **During calibration:** the full pipeline (Gate → Model → Classifier) still runs normally and still alerts on anything unusual — calibration never creates a blind spot. What's missing is just the zone-based suppression, since no zone is defined yet.
3. **Data collection:** every confirmed-normal detection (operator-confirmed, or consistently repeating in the same location) logs its position, size, and timestamp.
4. **Auto-generate the polygon:** after the window closes, cluster the logged positions (density clustering / convex hull with outlier trimming) into a suggested containment polygon, plus statistics (mean/std of size) for the normal envelope.
5. **One-click human approval:** the suggested polygon is shown overlaid on a reference frame; the operator approves or drags to adjust — seconds of work, not manual drawing from scratch.
6. **Always-on detection:** if detections were continuous through the observation window, the zone is automatically flagged `always_on = true` (relevant for furnace/flare/chimney-type sources).

**No blind auto-expansion, ever:** if detections later start consistently landing just outside an approved polygon, the system flags this to a human for review rather than silently widening the boundary. This matters specifically because a slowly-growing real fire is exactly the kind of thing that must never get auto-learned as "normal."

**Anchoring to fixed physical structures (furnace, flare tip, chimney):**
No separate structure-detection model is needed in most cases — since these sources are always-on, the clustering step in calibration (Step 4) already anchors to the physical hardware implicitly, because the fire/smoke signature itself marks the structure's location throughout the observation window.

For robustness against camera drift after calibration (bumped, re-mounted, adjusted):
- Keep a reference frame from calibration time.
- Periodically (e.g. daily, low-cost background job) run classical feature matching (ORB/SIFT — fast, no training required) between the current frame and the reference frame.
- If a consistent shift is detected, either auto-shift the polygon by the computed transform, or (safer) flag it to a human — an unexpected camera shift may also indicate tampering, which is itself worth surfacing.

**Camera adjacency map — also handled via calibration, decided:**
Adjacency (which cameras have overlapping fields of view) is set up the same way, combining two signals into the same one-click approval step:
1. **Geometric seed:** rough camera position + facing direction placed on a site map at setup, used to auto-suggest which cameras likely overlap — doesn't require waiting for a real event.
2. **Behavioral confirmation:** during the calibration window, cross-camera timing correlation (do two cameras' gates/detections repeatedly fire at the same moments?) confirms or catches adjacency the geometric estimate missed.
3. Suggested adjacency pairs are presented alongside the zone polygon suggestions at the end of calibration for the same one-click approval — no separate workflow.

---

## 5. Multi-Camera Handling & Scenario Resolution

**Problem:** compute cannot run the full pipeline at max frame rate on every camera simultaneously.

**Solution — extend the Gate concept across cameras, not just across frames:**
- The cheap Gate (motion diff) runs on **every camera, continuously** — this is nearly free, so there's no reason not to monitor all cameras at all times at this level.
- Only a camera whose Gate signals activity gets **promoted** into a priority queue feeding the (expensive, shared) Model stage.
- This means compute is spent only where something is actually happening — most cameras most of the time never reach the GPU at all.

**Priority ordering (used when multiple cameras trigger simultaneously and model throughput can't serve all at once):**

| Priority factor | Why |
|---|---|
| Active/unresolved alert already on that camera | Needs continuous high-frequency processing to track fire growth — must not get starved by a new low-priority trigger elsewhere |
| Zone risk weight | High-risk zones (e.g. chemical storage) bump ahead of low-risk zones (e.g. break area) when both trigger at once |
| Recency/strength of gate signal | Stronger motion signal suggests more urgency |
| Round-robin fallback | Ensures no camera is starved indefinitely under sustained load |

**Scenario: same fire seen by two or more cameras**
Reuses the calibration-derived adjacency map (Section 4) rather than requiring new geometry/triangulation work:
- If detections land in the **same zone**, or in zones flagged as **adjacent/overlapping**, within a short time window (e.g. a few seconds) → treated as **one incident**, with multiple camera evidence sources attached to the same record.

**Scenario: different, unrelated fires detected simultaneously**
- If detections come from cameras/zones with **no defined overlap** → treated as **fully independent incidents**, each gets its own alert and tracking, processed concurrently. One incident must never mask or delay the other.

---

## 6. Decisions Log (Confirmed So Far)

| Topic | Decision |
|---|---|
| Overall pipeline | Gate → Model → Classifier (Rules → CNN two-tier) → Context Engine |
| Classifier taxonomy | `{fire, white_smoke, grey_smoke, black_smoke, false_positive}` — no per-ignition-source classes |
| Severity handling | Delegated to Context Engine (zone, size, duration, growth) rather than expanding classifier classes |
| Hard negative mining | Production false positives logged and fed back into periodic classifier retraining |
| Zone containment | Generalized "boundary + normal envelope" pattern, applies uniformly to furnace/flare/chimney/bonfire/etc. |
| Zone setup | Automated via Calibration Mode — auto-suggested, human one-click approved, never silently auto-expanded |
| Structure anchoring | No separate detector needed for always-on sources (implicit via calibration clustering); camera drift handled via classical feature matching, not a trained model |
| Camera adjacency | Also handled via Calibration Mode (geometric seed + behavioral correlation), same approval flow as zones |
| Multi-camera scheduling | Gate runs continuously on all cameras (cheap); Model stage only serves cameras the Gate promotes, via a priority queue |
| Same-fire deduplication | Based on zone/adjacency map + time window, not 3D triangulation |
| Benchmarking | Deferred until pipeline blocks are built |

---

## 7. Open Items — Not Yet Fully Detailed

- **Gate stage:** exact motion-detection technique, threshold tuning methodology, and the fallback needed for steady/static fire sources that may never cross a motion threshold (open bug observed in live testing).
- **Model stage:** input resolution decisions, multi-camera batching strategy, target per-inference latency (deferred to benchmarking).
- **Latency benchmarking:** target frame rate/budget definition, per-stage measurement methodology (p50/p95/p99, not just average), target hardware selection, concurrency load testing. Deferred until the pipeline is functionally built.
- **Known live bugs to resolve independently of this architecture work** (from separate ongoing testing):
  - RTSP "Connect" currently only verifies reachability — no actual live stream is decoded/displayed or fed into the pipeline.
  - Video upload processing is severely slow (sub-1 FPS, most frames skipped) — root cause not yet identified.
  - Dashboard "AI Engine Status" and "Active Alerts" figures show inconsistencies suggesting possible placeholder/mock data rather than live values — needs verification.
