# SentinelOS Pipeline — Architecture Walkthrough (Demo Build)

**Status: matches what is actually running for this demo, not the aspirational full design.** Every stubbed or demo-shortcut piece is called out explicitly, in place, not in a footnote.

---

## 0. Demo-build disclosures — read this section first

| Component | Demo-build status |
|---|---|
| **Classifier** | Teammate's code was expected as an attachment; **it did not arrive in this environment** (checked disk, no new file). Running the **stub classifier** (`classifier/stub.py` — HSV/brightness heuristics, `is_stub=True`) unless it is supplied and integrated before the demo. This is being escalated back to you live, not discovered by you on stage. |
| **Model (YOLO26s)** | Real, trained weights (`best.pt`), not a placeholder. No substitution was needed here. |
| **Gate, Tracking, Context Engine, Scheduler** | Real production code, same as verified in prior sessions (113/113 automated checks). Nothing swapped for the demo. |
| **Calibration "skip ahead"** | Uses the calibration window's own real `window_hours` parameter set to a short value (minutes, not hours) for the demo. This is **not a fake progress bar** — it is the same production code path (`CalibrationManager`, real observation logging, real clustering) with a shorter real clock. Labeled in the UI as a demo-shortened window. |
| **Auth** | `PIPELINE_API_KEY` is set in `sentinel-pipeline/.env` (confirmed present; live enforcement re-verified during this session, see status update). |

---

## 1. One frame's journey, stage by stage

```
Camera/webcam frame
      │
      ▼
 ┌─────────┐   cheap, runs on EVERY frame, EVERY camera
 │  GATE   │   MOG2 background subtraction + hysteresis + forced override
 └────┬────┘
      │ passes ~1-15% of frames (motion or forced timer)
      ▼
 ┌─────────┐   the only stage that touches raw pixels with a neural net
 │  MODEL  │   YOLO26s, recall-tuned (conf floor 0.20)
 └────┬────┘
      │ raw candidate boxes: {class_raw, confidence_raw, bbox}
      ▼
 ┌──────────┐  assigns stable track_id, builds crop history + motion window
 │ TRACKING │
 └────┬─────┘
      │ ClassifierInput per candidate (crop, history, motion window)
      ▼
 ┌────────────┐  precision pass — confirms/rejects, types the smoke colour
 │ CLASSIFIER │  (STUB in this demo build unless real one is integrated)
 └─────┬──────┘
       │ ClassifierVerdict: {class, confidence, evidence_sufficient}
       ▼
 ┌────────────────┐  zone containment + severity scoring, NO AI, pure math
 │ CONTEXT ENGINE  │
 └────────┬────────┘
          │ if should_alert: writes evidence + alert (never one without the other)
          ▼
   Alert in the pipeline's DB, evidence image on disk
          │
          ▼
   Dashboard: WebSocket/poll → pop-up + alert log + beep
```

### Stage roles, one paragraph each

**Gate.** Decides whether a frame is worth the Model's cost at all. Runs continuously on every camera because it is nearly free (~0.7ms/frame). Uses background subtraction (MOG2) with hysteresis to avoid flapping on noise, plus a forced-override timer so a steady, non-moving fire is never permanently invisible just because nothing is "moving." Input: one raw frame + per-camera background model state. Output: pass/skip + a change score. Why here: this is what makes watching many cameras affordable — the expensive stage below only runs on the small fraction of frames the Gate promotes.

**Model.** The one neural-network inference in the whole pipeline. YOLO26s, tuned deliberately for recall (low confidence floor) rather than precision — it is supposed to over-flag; the Classifier's job is to clean that up. Input: a Gate-approved frame. Output: raw candidate boxes with class and confidence. Why here: keeping "detect something" and "decide if it's really a threat" as separate stages means the expensive model doesn't also have to be conservative, which would cost recall.

**Tracking.** Turns a sequence of independent per-frame detections into one continuous object with an identity. Assigns a `track_id`, maintains a duration-bounded (not frame-count-bounded) crop history, and maintains a fixed-size "motion window" so optical flow has two frames of identical dimensions to compare. Input: raw Model candidates + the current frame. Output: `ClassifierInput` per candidate, carrying the crop, the history, and motion-window metadata. Why here: the Classifier's Motion and Flicker checks need to look at the SAME object across several frames, not one frame in isolation — this is where that continuity is built, once, rather than reinvented per check.

**Classifier.** Precision pass. Confirms or rejects each candidate and, for confirmed smoke, assigns a colour (white/grey/black). Two-tier design in the real spec (fast rules, then a small CNN only for ambiguous cases); **this demo runs the placeholder stub** unless the real one was integrated in time (see §0). Input: `ClassifierInput` (crop, grayscale, history, motion window). Output: `ClassifierVerdict` (`class`, `confidence`, `evidence_sufficient`). Why here: the Model is deliberately over-sensitive; something has to separate real fire/smoke from false alarms without slowing down the fast path, and this is that filter.

**Context Engine.** Decides how much a confirmed detection actually matters. No AI — pure geometry and arithmetic. Checks whether the detection is inside an approved containment zone, whether its size is within the zone's learned "normal envelope," and scores severity from confidence × zone risk weight × growth rate. This is also where the evidence guarantee lives: no alert is ever written without a real evidence image attached, enforced as a required argument at the code level, not a convention. Input: confirmed `ClassifierVerdict` + zone config + track history. Output: a severity score and, if warranted, a written alert with evidence. Why here: the same "fire detected" means something very different in a designated burn pit versus a warehouse aisle — this is where that context gets applied.

**Multi-camera Scheduler.** Extends the Gate's cheap-continuous-check idea across cameras. The Gate runs on every registered camera all the time; only frames it promotes get queued for the (shared, expensive) Model. When multiple cameras compete for that shared Model, a priority queue orders them: active/unresolved alert first, then zone risk weight, then motion-signal strength, then a **starvation fallback** — any camera waiting past 8 seconds gets promoted regardless of its tier, so a busy high-risk camera can never permanently starve a quiet one. Confirmed live in this session (see status update), not rebuilt. Input: per-camera Gate results. Output: an ordered queue feeding the shared Model worker. Why here: one GPU, many cameras — this is what keeps that fair and responsive rather than first-come-first-served.

**Calibration.** Turns "draw a containment polygon by hand" into "watch normal activity for a while, then approve a suggestion." Real detections during the observation window are logged (position, size, timestamp); once the window closes (or is interrupted), the logged points are clustered into a suggested polygon plus size statistics, and a human approves or adjusts it before it becomes an enforced zone. **Demo shortcut**: the window length is a real, exposed parameter (`window_hours`), set short for the demo instead of the production 24–72h — same code path, same clustering, same approval step, just a shorter real clock. Input: a stream of confirmed detections during the window. Output: a suggested zone (polygon + normal-size envelope), pending human approval. Why here: zone quality directly drives Context Engine severity scoring, and hand-drawing polygons for every camera doesn't scale.

---

## 2. Exact input/output per stage

| Stage | Input | Output | Why this data, here |
|---|---|---|---|
| Gate | Raw frame + per-camera background model | `GateResult \| None` (pass/skip, change_score) | Only the Gate has the per-camera temporal state needed to tell "changed" from "noise" |
| Model | Gate-approved frame | List of `{class_raw, confidence_raw, bbox}` | Raw pixels only need to reach the one stage that has a trained network |
| Tracking | Raw candidates + current frame | `ClassifierInput` (crop, grayscale, history, motion window, `track_id`) | The Classifier's temporal checks (Motion, Flicker) need continuity across frames that no single frame carries alone |
| Classifier | `ClassifierInput` | `ClassifierVerdict` (`class`, `confidence`, `evidence_sufficient`) | This is the only stage whose whole job is "is this real," so its output is the only thing downstream needs — not raw pixels again |
| Context Engine | Confirmed `ClassifierVerdict` + zone config + track history | Severity score + (if warranted) a written alert with evidence | Severity depends on *where* and *how*, which only zone config and track history carry — the Classifier verdict alone can't answer that |
| Scheduler | Per-camera `GateResult`s | An ordered queue of frames for the shared Model | Fair allocation of one expensive resource across many cheap, continuously-checked cameras |
| Calibration | Confirmed detections during an observation window | A suggested zone (polygon + envelope), pending approval | Zones need real observed behaviour, not a guess, to set a normal-size envelope accurately |

---

## 3. The MLOps loop — how data flows back toward retraining

```
Live camera → Gate/Model/Classifier → Alert + evidence written to disk/DB
                                              │
                                              ▼
                                   Evidence images + verdicts
                                   accumulate as labeled(-ish) data
                                              │
                                              ▼
                          (not yet automated) periodic export of
                          confirmed alerts + operator corrections
                                              │
                                              ▼
                    Retraining set for Model (YOLO) and/or Classifier
                    (Tier-2 CNN), weighted toward false positives/negatives
                                              │
                                              ▼
                         New weights swapped in — same interface,
                         zero pipeline code changes required
```

**What's real today:** every confirmed alert already writes its evidence image plus the full detection context (class, confidence, bbox, camera, timestamp, severity reasoning) to the pipeline's own database — this *is* the raw material a retraining loop would consume.

**What's not built yet, stated plainly:** there is no automated export/retrain trigger. An operator would currently pull evidence + alert records manually. Closing that loop (scheduled export, a labeling/correction step, an actual retraining job) is listed as a TODO item, not simulated for this demo.

---

## 4. What a live demo should show, mapped to this doc

1. Point a camera at something fire-like → **Gate** promotes the frame (visible as detection latency, not a visible UI element) → **Model** boxes it → **Classifier** confirms it → **Context Engine** writes an alert with evidence.
2. Dashboard shows: pop-up notification, an entry in the alert log (camera, time, type, confidence), the evidence frame, and an audible beep.
3. Calibration tab: start on a camera, watch the observation counter move in real time as real detections occur, then either let the short window close or hit interrupt, review the suggested zone, approve it — which writes to the same zones table a 72-hour production calibration would.
4. If asked "is this the real classifier or a placeholder" — the honest answer, live, is whichever `/v1/health`'s `classifier_is_stub` field says at that moment. That field is deliberately not something either of us can misrepresent, because the pipeline itself reports it.
