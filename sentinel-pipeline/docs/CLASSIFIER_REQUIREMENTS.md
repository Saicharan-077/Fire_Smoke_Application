# SentinelOS Classifier — Complete Requirements

**Version 1.0.0 — LOCKED**
**Audience:** the engineer building the Tier-1 cascade and Tier-2 CNN.
**Status:** this is the single, complete specification. It consolidates and
supersedes `MODEL_CLASSIFIER_CONTRACT.md`. You should not need another document
to answer "what am I supposed to receive."

Everything here is implemented and verified by live test. Test commands are in
§10.

---

## 1. Where you sit

```
frame → GATE → MODEL → [ YOUR CLASSIFIER ] → CONTEXT ENGINE → alert
                          Tier 1 rules
                          Tier 2 CNN
```

**Upstream is done.** The Gate, Model, tracking layer and Context Engine all
exist, are tested, and will not change under you inside `1.x`.

**Your job is precision.** The Model runs at a deliberately low confidence floor
(0.20) for recall and over-flags on purpose. Measured on 124 real fire images:
**63% of its detections fall below confidence 0.5.** Those are yours to sort
out. Nothing upstream filters them — that was an explicit design decision, and
an earlier post-model filter that silently discarded steady-fire detections was
removed because of it.

**A temporary stub currently stands in for you** at
`sentinel_pipeline/classifier/stub.py`. It implements this exact interface with
crude heuristics. Read it for shape, not for technique.

---

## 2. The interface you implement

```python
from sentinel_pipeline.classifier.base import Classifier
from sentinel_pipeline.contracts import ClassifierInput, ClassifierVerdict, ThreatClass

class TwoTierClassifier(Classifier):
    name = "tier1-rules+tier2-cnn"
    is_stub = False                      # keep False; see §9

    def warmup(self) -> None:
        ...                              # load the Tier-2 CNN once, here

    def classify_batch(self, inputs: list[ClassifierInput]) -> list[ClassifierVerdict]:
        return [self._classify_one(i) for i in inputs]

    def close(self) -> None:
        ...                              # optional
```

Plug in with **one line**, no other pipeline change:

```python
from sentinel_pipeline.pipeline import Pipeline
pipeline = Pipeline(classifier=TwoTierClassifier())
```

You are called **in-process**. Numpy arrays are passed by reference — no
serialisation, no HTTP, no copying. `classify_batch` receives every candidate
from one frame together, so you can batch your Tier-2 CNN across them.

---

## 3. What you receive — `ClassifierInput`

One per candidate, per frame.

### 3.1 Identity and detection

| Field | Type | Guarantee |
|---|---|---|
| `track_id` | `int` | Stable across frames for the same object. **The join key — echo it back.** |
| `camera_id` | `str` | Pipeline-issued camera id |
| `timestamp` | `datetime` | Frame **capture** time, UTC, timezone-aware |
| `monotonic_ts` | `float` | Monotonic clock at capture. **Use this for all interval maths** — wall-clock can step (NTP, DST) |
| `bbox` | `BBox` | Tight detection box, **original full-frame** pixel coordinates |
| `class_raw` | `RawClass` | `fire` \| `smoke` \| `sparks`, verbatim from the detector |
| `confidence_raw` | `float` | Detector confidence, 0–1 |
| `contract_version` | `str` | `"1.0.0"` |

`BBox` exposes `.x1 .y1 .x2 .y2 .width .height .area .centroid .iou(other)`.

### 3.2 Current-frame crops — Phases 1 & 2

| Field | Type | Guarantee |
|---|---|---|
| `cropped_frame_rgb` | `ndarray (h,w,3)` uint8 | **RGB**, **native resolution, never downscaled** |
| `cropped_frame_grayscale` | `ndarray (h,w)` uint8 | Same region, grayscale |
| `crop_origin` | `(int, int)` | Crop's top-left in full-frame coords |
| `crop_scale` | `float` | **Always `1.0`** here |
| `crop_padding_ratio` | `float` | Requested outward padding, default `0.15` |
| `padding_applied` | `(l, t, r, b)` | Padding **actually** applied per side, in pixels |
| `frame_size` | `(w, h)` | Source frame dimensions |

**Native resolution is deliberate.** Your Phase 1 and Phase 2 both apply
absolute pixel-count and connected-component blob-size guards and can emit
`too_small_escalate`. A silently downscaled crop would make those measure the
wrong thing, so the current-frame crop is never rescaled. (History crops *are*
capped — §3.3 — because 60 native snapshots per track costs ~7.3 GB across a
16-camera fleet versus ~566 MB capped.)

**Locating the tight box inside the crop:**
```python
bx1 = inp.bbox.x1 - inp.crop_origin[0]
by1 = inp.bbox.y1 - inp.crop_origin[1]
bx2, by2 = bx1 + inp.bbox.width, by1 + inp.bbox.height
```

**Colour space — the one that will bite you.** Crops are RGB; OpenCV expects
BGR. Convert before any `cv2` colour operation:
```python
hsv = cv2.cvtColor(inp.cropped_frame_rgb[:, :, ::-1], cv2.COLOR_BGR2HSV)
```

**Border strip (Phase 2).** Padding is clipped where a candidate touches a frame
edge, so size your border-exclusion strip *per side* from `padding_applied`. A
box at `(0,0)` yields `padding_applied == (0, 0, 30, 30)` — on the clipped sides
the crop boundary is a real image edge and will read as hard structure.

### 3.3 History — Phases 3 & 4

| Field | Type | Guarantee |
|---|---|---|
| `history` | `tuple[CropSnapshot, ...]` | **Oldest first**, current frame last |
| `history_window_s` | `float` | Configured duration bound, default `2.0` |
| `history_span_s` | `float` | **Actual** time spanned |
| `history_sample_rate_hz` | `float` | **Measured** mean rate |
| `motion_epoch` | `int` | Motion epoch of the current frame (§3.4) |
| `track_age_frames` | `int` | Frames this track has been matched |
| `track_duration_s` | `float` | Wall duration the track has existed |

**History is bounded by DURATION, not frame count.** Samples are evicted by
timestamp, so the window means the same thing at any rate — including a variable
or stalling one. Verified:

| Source rate | samples in the 2.0 s window |
|---|---|
| 4 fps | 9 |
| 15 fps | 31 |
| 30 fps | 60 |
| 60 fps | 121 |

A source stalling 30 fps → 1 fps yields **3 samples spanning 2.00 s**, not a
60-second window pretending to be 2 seconds.

> **Never infer elapsed time from `len(history)`.** Read `history_span_s` and
> `history_sample_rate_hz`.

`CropSnapshot` fields:

| Field | Type | Guarantee |
|---|---|---|
| `timestamp` / `monotonic_ts` | `datetime` / `float` | Capture time |
| `bbox` | `BBox` | Box at that frame, full-frame coords |
| `crop_rgb` / `crop_grayscale` | `ndarray` | **May be downscaled** — see `crop_scale` |
| `confidence_raw` | `float` | Detector confidence at that frame |
| `crop_scale` | `float` | Downscale applied to **this** snapshot (`1.0` = native) |
| `match_iou` | `float \| None` | IoU against the previous snapshot; `None` on the first |
| `motion_crop` | `ndarray (h,w)` | **Canonical motion window** — §3.4 |
| `motion_window_origin` | `(int,int)` | Window top-left, full-frame coords |
| `motion_window_size` | `(w,h)` | Window dimensions, post-scale |
| `motion_epoch` | `int` | **Never compare across epochs** |
| `motion_scale` | `float` | Constant within an epoch |

A *growing* candidate produces a mix of scaled and unscaled entries within one
track, so `crop_scale` is per-snapshot. Any measurement in absolute pixels must
normalise by it.

`match_iou` lets you apply a stricter tracker-match gate than the pipeline's
internal `TRACK_IOU_THRESH = 0.25`.

### 3.4 Canonical motion window — Phase 3

`cv2.calcOpticalFlowFarneback` **requires identical dimensions** between the two
frames it compares. Crops cut to each frame's live bbox do not satisfy that,
because the bbox changes size as a fire grows. So each track holds a **motion
epoch**: a window whose position *and* size are frozen for its lifetime.

**Guarantees within one `motion_epoch`:**

1. Every `motion_crop` has **identical dimensions**.
2. Every `motion_crop` is cut from the **same world coordinates** — the origin
   does not move.
3. `motion_scale` is **constant**, computed once at epoch start.
4. No per-frame rescaling, so displacement is never distorted by an unknown
   frame-varying factor.

**The window deliberately does not follow the object.** A centroid-tracking
window would cancel exactly the linear motion you use to identify rigid objects
— a moving vehicle would read as motionless. Because the window is stationary,
flow between two same-epoch crops is **true world displacement**.

```python
a, b = inp.history[-2], inp.history[-1]
if a.motion_epoch != b.motion_epoch:
    return verdict(..., evidence_sufficient=False, advisory_phases=("motion",))

flow = cv2.calcOpticalFlowFarneback(a.motion_crop, b.motion_crop, None,
                                    0.5, 3, 25, 3, 5, 1.2, 0)
dx_world      = float(np.median(flow[..., 0][mask])) / b.motion_scale
velocity_px_s = dx_world / (b.monotonic_ts - a.monotonic_ts)
```

Verified end-to-end: a synthetic **24 px** displacement was recovered as
**24.1 px** (0.1 px error) through this exact path at `motion_scale = 0.7293`.

**Re-anchoring — documented, never silent.** When the candidate no longer fits
the frozen window (it grew, or moved out), a **new epoch** opens around the
current bbox and `motion_epoch` increments. Older snapshots stay in `history`
with their old epoch id. Clipping was rejected as the alternative: it would
silently truncate a growing fire.

> **Hard rule: never flow-compare snapshots with different `motion_epoch`
> values.** Treat an epoch boundary as `insufficient_history`, not as a
> rejection.

---

## 4. What you return — `ClassifierVerdict`

| Field | Type | Default | Notes |
|---|---|---|---|
| `track_id` | `int` | — | **Must echo the input's** |
| `camera_id` | `str` | — | Echo |
| `timestamp` | `datetime` | — | Echo |
| `bbox` | `BBox` | — | Echo |
| `threat_class` | `ThreatClass` | — | See §4.1 |
| `confidence` | `float` | — | 0–1, **calibrated** |
| `monotonic_ts` | `float` | `0.0` | Backfilled if omitted |
| `evidence_sufficient` | `bool` | `True` | See §4.2 |
| `advisory_phases` | `tuple[str,...]` | `()` | Phases that ran log-only |
| `reasoning` | `dict` | `{}` | Free-form; logged, never control flow |

`confidence` is multiplied directly into the Context Engine's severity score:

```
severity = confidence × zone_risk_weight × growth_factor − controlled_discount
```

A confidently-wrong model distorts severity, and severity decides whether a
human is woken up. **Calibrate it** (temperature scaling or equivalent).

### 4.1 Taxonomy — locked

```
fire | white_smoke | grey_smoke | black_smoke | false_positive
```

Locked by the project Decisions Log. **Do not add per-ignition-source classes**
(cigarette, candle, welding, vehicle fire). Two reasons, both deliberate:

1. Many small ignition sources are visually near-indistinguishable at camera
   resolution — reliable classes would need data that cannot practically be
   collected.
2. The ignition source matters far less than **size, duration, growth and
   zone**, which the Context Engine already handles.

This keeps the taxonomy stable as new scenarios (furnace, flare, chimney,
bonfire) appear, with no retraining for a new "type".

The Context Engine only ever sees the four positive classes — `false_positive`
verdicts are dropped by the pipeline before it.

### 4.2 Recall-first: the drop rule

Your Phase Reference states: *"'Insufficient history/data' is always a distinct
outcome from 'reject' across all phases, and defaults to escalation — never
silently drops a candidate lacking evidence."* The contract enforces that.

**A candidate is dropped only on a confident rejection:**

| `threat_class` | `evidence_sufficient` | Pipeline behaviour |
|---|---|---|
| `FALSE_POSITIVE` | `True` | **Dropped.** The only drop path. |
| `FALSE_POSITIVE` | `False` | **Escalated**; class substituted from `class_raw` + loud warning |
| any positive class | `True` | Confirmed → Context Engine |
| any positive class | `False` | **Escalated**, flagged unconfirmed |
| *verdict omitted* | — | Treated as a confident rejection. **Dropped.** |

Set `evidence_sufficient=False` whenever the phases that would have decided a
candidate lacked the data to do so:

- too few frames, or too low a sample rate, for Flicker
- no tracker match, or a `motion_epoch` boundary, for Motion
- a crop below the minimum pixel count for Colour or Texture

**When you set it False, supply your best-guess positive `threat_class`, not
`FALSE_POSITIVE`.** If `FALSE_POSITIVE` arrives with `evidence_sufficient=False`
the pipeline must substitute a class to escalate at all; it does so from
`class_raw` (`fire`/`sparks` → `FIRE`, `smoke` → `GREY_SMOKE`), logs a warning,
and records `pipeline_class_substituted: true`. Correct, but blunt.

### 4.3 Log-only mode

Motion and Flicker ship **log-only until validation video exists**. List them in
`advisory_phases`. They are promoted to the top level of the alert's `reasoning`
for operator audit and never gate control flow:

```python
ClassifierVerdict(..., threat_class=ThreatClass.FIRE, confidence=0.81,
                  advisory_phases=("motion", "flicker"))
```

An operator can then see exactly which phases were advisory when the alert
fired.

### 4.4 Behavioural rules

- Return verdicts in **any order** — matched by `track_id`.
- Returning **fewer** verdicts than inputs is allowed; see the table in §4.2.
- **Never raise.** Return a `FALSE_POSITIVE` verdict instead — an exception
  fails the entire frame, not one candidate.
- Input arrays are shared and marked read-only where numpy permits. **Copy
  before modifying.**
- Tune toward **recall** here too. A missed fire costs far more than an extra
  false alarm passed to the Context Engine, which has zone and growth context
  you do not.

---

## 5. Per-phase input mapping — verified

Checked field-by-field against the Tier-1 Cascade Phase Reference.

### Phase 1 — Colour (HSV)
| You need | You get | |
|---|---|---|
| Single cropped candidate (BGR/RGB) → HSV | `cropped_frame_rgb` | ✅ |
| No history or tracking | Works standalone | ✅ |
| Minimum pixel-count threshold | Native resolution, `crop_scale == 1.0` | ✅ |
| Connected-component blob-size check | Native resolution | ✅ |
| `too_small_escalate` | `evidence_sufficient=False` | ✅ |

### Phase 2 — Texture
| You need | You get | |
|---|---|---|
| Same crop, grayscale | `cropped_frame_grayscale` | ✅ |
| No history | Works standalone | ✅ |
| Exclude a thin border strip | `padding_applied` per side | ✅ |
| Blur before Canny/Laplacian | Yours to apply, unimpeded | ✅ |

### Phase 3 — Motion (Farneback)
| You need | You get | |
|---|---|---|
| Two grayscale crops of the same tracked candidate | `history[i].motion_crop` | ✅ |
| **Identical dimensions** | Guaranteed within a `motion_epoch` | ✅ |
| Per-frame capture timestamps | `monotonic_ts` per snapshot | ✅ |
| Displacement ÷ real elapsed time | `monotonic_ts` deltas; timing not assumed constant | ✅ |
| Object tracking (ByteTrack or IoU/centroid) | Shared layer, stable `track_id` | ✅ |
| IoU-gated match quality | `match_iou` per snapshot | ✅ |
| Rolling buffer of last 3 comparisons | Duration window holds ≥3 at any usable rate | ✅ |
| True displacement, not window-relative | Stationary window; 24 px → 24.1 px verified | ✅ |

### Phase 4 — Flicker (Welch)
| You need | You get | |
|---|---|---|
| Time series of mean brightness + timestamps | Derivable per `history` entry | ✅ |
| ~30–60 consecutive frames | 60 at 30 fps within the window | ✅ |
| **Spanning roughly 1–2 seconds** | Duration-bounded at 2.0 s | ✅ |
| Flame candidates only | `class_raw` | ✅ |
| Consistent timestamps, may need resampling | `monotonic_ts`, `history_sample_rate_hz` | ✅ |
| `insufficient_history` distinct from reject | `evidence_sufficient=False` | ✅ |

### Cross-cutting
| You need | You get | |
|---|---|---|
| Minimum-sample-size guard per phase | `track_age_frames`, `len(history)`, `history_span_s`, `history_sample_rate_hz` | ✅ |
| "Insufficient" ≠ "reject", defaults to escalation | `evidence_sufficient` | ✅ |
| Log-only mode for Motion and Flicker | `advisory_phases` | ✅ |
| Tracking as a prerequisite | Shared layer, always on | ✅ |

---

## 6. The flicker sampling constraint — read before building Phase 4

**Physics, not a contract gap.**

Flame flicker is 5–10 Hz, needing >20 Hz sampling. The pipeline's default
live-stream inference rate is 4 fps → a **2 Hz Nyquist ceiling**. At that rate a
5–10 Hz signal aliases into the low-frequency band and becomes indistinguishable
from slow brightness drift. Phase 4 would not be merely weak — it could be
confidently wrong in either direction.

The contract makes this **detectable rather than silent**:

```python
if inp.history_sample_rate_hz / 2.0 < 10.0:
    return verdict(..., evidence_sufficient=False, advisory_phases=("flicker",))
```

Raising the real sample rate is a pipeline decision under joint review — see
`FLICKER_SAMPLING_TRADEOFFS.md`. The recommendation is **Option D**: a
native-rate brightness tap on the reader thread (~10 µs/sample, no extra Model
compute, no second frame path), since your Phase 4 input is a *brightness time
series*, not images.

**Not adopted — awaiting your sign-off with the project owner.** Phase 4 stays
log-only until then, so nothing is gated on it.

Questions we need from you to close it:
1. Is brightness-only genuinely sufficient? (Load-bearing assumption for D.)
2. Does your Welch implementation want a **uniform grid** (pipeline resamples)
   or **raw irregular samples** (you resample)?
3. What minimum sample count does Welch need for a usable spectrum? That sets
   the `insufficient_history` boundary from your implementation, not our guess.

---

## 7. `sparks` — decision required, with evidence

The detector emits three classes. **The pipeline passes `sparks` through
untouched** as `class_raw="sparks"` — a deliberate change from the old
application, which silently discarded every sparks detection via a substring
match, throwing away a third of the model's trained output.

Your Phase Reference covers `fire` and the three smoke types. **`sparks` appears
in none of the four phases**, including Phase 1's HSV mask set. You will receive
candidates you have no specified handling for.

**Training-data evidence that bears on this.** From the merged dataset reports:

| Class | Annotations | Near-fullframe boxes | Exactly 1×1 (whole image) |
|---|---|---|---|
| fire | 103,135 | 123 (0.12%) | 3 (0.00%) |
| smoke | 68,698 | 1,293 (1.88%) | 314 (0.46%) |
| **sparks** | **21,291** | **2,410 (11.32%)** | **1,205 (5.66%)** |

Nearly all of that degeneracy comes from one source: the `SparkDetector` subset
has **2,410 of 2,453 boxes near-fullframe (98.25%)** and **49.12% exactly the
entire image**. The sparks class is both the smallest (7,371 images, 6.1% of the
dataset) and by far the most label-degraded — roughly **94× the fullframe rate
of fire**.

So the detector's sparks output is trained partly on "sparks = whole frame". Any
Tier-1 rule keyed to spark geometry should not be trusted without re-validation,
and this argues against auto-escalating `sparks → fire`.

**Options, needing a joint decision:**
- **(a)** Tier 1 handles `sparks` explicitly with its own rules.
- **(b)** Pipeline maps `sparks` before handoff (needs a target class from you).
- **(c)** Treat `sparks` as `false_positive` unless sustained — what the stub
  currently does, purely to exercise the path.

If Tier-2 is to judge sparks, it needs welding and grinding spark crops in
training, labelled deliberately — see `MODEL_TRAINING_REQUIREMENTS.md` §3.5.

---

## 8. Tier-2 CNN training requirements — summary

Full detail in `MODEL_TRAINING_REQUIREMENTS.md`. **All training is currently
held**; nothing has been started.

| Property | Value |
|---|---|
| Task | Single-label image classification on crops |
| Classes | The five in §4.1 |
| Suggested backbone | MobileNetV3-Small or ≤5M params |
| Input | RGB, padded 15%, **variable size** — resize in your own preprocessing |
| Latency target | **< 10 ms per crop, p95, CPU** |
| Size target | < 20 MB |
| Recall target | **≥ 0.95** on positive classes combined |
| `false_positive` recall | ≥ 0.80 |
| Smoke sub-type accuracy | ≥ 0.75 |

**Training preprocessing must match §3.2 exactly** — RGB, 15% padding, crops cut
the same way — or the model will silently underperform in deployment.

**Open decision:** target input resolution (96/128/224). Recommend **128×128**;
whatever you pick must be documented and baked into the delivered artifact.

**Hold out by camera and by day, never by random crop split** — random splits
leak near-duplicate frames and inflate scores substantially.

---

## 9. Swapping the stub for the real thing

The stub sets `is_stub = True`, which makes the pipeline log a startup warning
and report `"classifier_is_stub": true` on `GET /v1/health`. **Your class must
leave `is_stub` at `False`**, so a deployment cannot silently run on the
placeholder.

Drop-in replacement means exactly this — nothing else in the pipeline changes:

```python
- pipeline = Pipeline()                                   # uses StubClassifier
+ pipeline = Pipeline(classifier=TwoTierClassifier())
```

Verify the swap took:
```bash
curl -s localhost:8100/v1/health | grep classifier
# "classifier": "tier1-rules+tier2-cnn", "classifier_is_stub": false
```

---

## 10. Verifying the contract yourself

```bash
cd sentinel-pipeline
../.venv-pipeline/bin/python tests/test_g4_g6_closure.py         # 12/12 motion window + duration window
../.venv-pipeline/bin/python tests/test_recall_first_contract.py # 13/13 drop-vs-escalate + crop resolution
```

`GET /v1/contract` returns the live version and field list at runtime.

| Suite | Checks | Covers |
|---|---|---|
| `test_g4_g6_closure.py` | 12/12 | Equal-size pairs, real Farneback, stationary window, duration bounding 4–60 fps, stalling source |
| `test_recall_first_contract.py` | 13/13 | Drop vs escalate, class substitution, audit fields, native crop, per-side padding, `match_iou` |

---

## 11. Configuration you may care about

| Variable | Default | Effect on you |
|---|---|---|
| `TRACK_HISTORY_WINDOW_S` | `2.0` | History duration bound |
| `TRACK_CROP_PADDING` | `0.15` | Outward crop padding |
| `TRACK_MAX_CROP_EDGE` | `256` | History crop cap (current-frame crop unaffected) |
| `TRACK_MOTION_EXPANSION` | `1.5` | Motion window size vs padded bbox |
| `TRACK_MOTION_MAX_EDGE` | `256` | Motion crop cap (constant per epoch) |
| `TRACK_IOU_THRESH` | `0.25` | Internal association gate |
| `PIPELINE_CONF_THRESHOLD` | `0.20` | Detector recall floor |

---

## 12. Stability

| Guarantee | Scope |
|---|---|
| No field removed, renamed, or changed in meaning | within `1.x` |
| New **optional** fields may be added | minor bump, non-breaking |
| Field removal / semantic change | major bump, coordinated with you |
| `ThreatClass` values fixed | locked by the Decisions Log |
| `RawClass` values follow the weights | changing detector classes bumps major |

## 13. Open items — none block you starting

| # | Item | Needs |
|---|---|---|
| 1 | Flicker sampling (Option D) | Your answers to §6, then joint sign-off |
| 2 | `sparks` handling | Joint decision per §7 |
| 3 | Tier-2 input resolution | Your call per §8 |
| 4 | Per-class `yolo val` metrics | Dataset owner; may change the detector under you, not the contract |

Phases 1 and 2 can be built and validated against existing static-crop datasets
today. Phases 3 and 4 require validation video that does not yet exist, and ship
log-only until it does.
