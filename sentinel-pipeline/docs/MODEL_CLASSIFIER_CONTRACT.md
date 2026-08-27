# Model → Classifier Interface Contract — SUPERSEDED

> **This document has been consolidated into [CLASSIFIER_REQUIREMENTS.md](CLASSIFIER_REQUIREMENTS.md),**
> which is the single complete specification handed to the Classifier team.
> Retained for history. The contract itself is unchanged and still LOCKED v1.0.0.
**Contract version 1.0.0 — LOCKED.** Validated field-by-field against the
*Tier 1 Classifier Cascade — Phase Reference* (2026-08-17). All four phases'
declared inputs are
satisfied. Both blocking gaps (G4, G6) are closed and verified by live test.

**Stability promise:** within `1.x`, no field is removed, renamed, or changes
meaning. New optional fields may be added. Build against this document.

Authoritative source: `sentinel_pipeline/contracts.py`
Interface to implement: `sentinel_pipeline/classifier/base.py`
Verification: `tests/test_g4_g6_closure.py`, `tests/test_recall_first_contract.py`

---

## 1. How the Classifier is invoked

**In-process Python plugin.** The pipeline imports your class and calls it
directly; numpy arrays are passed by reference with no serialisation.

```python
from sentinel_pipeline.classifier.base import Classifier
from sentinel_pipeline.contracts import ClassifierInput, ClassifierVerdict, ThreatClass
from sentinel_pipeline.pipeline import Pipeline

class TwoTierClassifier(Classifier):
    name = "tier1-rules+tier2-cnn"
    is_stub = False

    def warmup(self) -> None:
        ...   # load the Tier-2 CNN once

    def classify_batch(self, inputs: list[ClassifierInput]) -> list[ClassifierVerdict]:
        return [self._one(i) for i in inputs]

pipeline = Pipeline(classifier=TwoTierClassifier())
```

`classify_batch` receives all candidates from one frame. Nothing else in the
pipeline changes; the stub and the real classifier are interchangeable.

---

## 2. `ClassifierInput` — complete field reference

### 2.1 Identity and detection

| Field | Type | Description |
|---|---|---|
| `track_id` | `int` | Stable across frames for the same object. **The join key** — echo it on the verdict. |
| `camera_id` | `str` | Pipeline-issued camera id |
| `timestamp` | `datetime` | Frame **capture** time, UTC, timezone-aware |
| `monotonic_ts` | `float` | Monotonic clock at capture. **Use this for all interval maths.** Wall-clock can step (NTP, DST). |
| `bbox` | `BBox` | Tight detection box, **original full-frame** pixel coordinates |
| `class_raw` | `RawClass` | `fire` \| `smoke` \| `sparks`, verbatim from the detector |
| `confidence_raw` | `float` | Detector confidence, 0–1 |
| `contract_version` | `str` | `"1.0.0"` |

### 2.2 Current-frame crops — Phases 1 & 2

| Field | Type | Description |
|---|---|---|
| `cropped_frame_rgb` | `ndarray (h,w,3)` uint8 | **RGB**, **native resolution** |
| `cropped_frame_grayscale` | `ndarray (h,w)` uint8 | Same region, grayscale |
| `crop_origin` | `(int, int)` | Crop's top-left in full-frame coords |
| `crop_scale` | `float` | **Always `1.0`** for these crops. Assert it if you like. |
| `crop_padding_ratio` | `float` | Requested outward padding, default `0.15` |
| `padding_applied` | `(l, t, r, b)` | Padding **actually** applied per side, in pixels |
| `frame_size` | `(w, h)` | Source frame dimensions |

**These crops are never downscaled.** Phases 1 and 2 apply absolute pixel-count
and connected-component blob-size guards and can emit `too_small_escalate`; a
rescaled crop would make those measure the wrong thing. Only *history* crops are
capped (§2.3).

**Locating the tight box inside the crop:**
```python
bx1 = inp.bbox.x1 - inp.crop_origin[0]
by1 = inp.bbox.y1 - inp.crop_origin[1]
bx2, by2 = bx1 + inp.bbox.width, by1 + inp.bbox.height
```

**Border-exclusion strip (Phase 2)** must be sized *per side* from
`padding_applied`. A candidate touching a frame edge has padding clipped on that
side — there the crop boundary *is* a real image edge and will read as hard
structure. A box at `(0,0)` yields `padding_applied == (0, 0, 30, 30)`.

**Colour space:** these are RGB. `cv2` expects BGR:
```python
hsv = cv2.cvtColor(inp.cropped_frame_rgb[:, :, ::-1], cv2.COLOR_BGR2HSV)
```

### 2.3 History — Phases 3 & 4

| Field | Type | Description |
|---|---|---|
| `history` | `tuple[CropSnapshot, ...]` | **Oldest first**, current frame last |
| `history_window_s` | `float` | Configured duration bound, default `2.0` |
| `history_span_s` | `float` | **Actual** time spanned by `history` |
| `history_sample_rate_hz` | `float` | **Measured** mean rate over `history` |
| `motion_epoch` | `int` | Motion epoch of the current frame (§2.4) |
| `track_age_frames` | `int` | Frames this track has been matched |
| `track_duration_s` | `float` | Wall duration the track has existed |

**History is bounded by DURATION, not frame count.** Samples are evicted by
timestamp. `len(history)` therefore varies with the source's real delivered
rate, and is not a fixed number:

| Source rate | samples in a 2.0 s window |
|---|---|
| 4 fps | 9 |
| 15 fps | 31 |
| 30 fps | 60 |
| 60 fps | 121 |

Never infer elapsed time from a frame count. Read `history_span_s` and
`history_sample_rate_hz` directly, and use them to decide
`insufficient_history` from real numbers:

```python
if inp.history_sample_rate_hz / 2.0 < 10.0:      # Nyquist vs the 5-10 Hz band
    return verdict(..., evidence_sufficient=False, advisory_phases=("flicker",))
```

**Window bounds:** `history_window_s = 2.0 s` by default
(`TRACK_HISTORY_WINDOW_S`), the upper end of the Phase Reference's "roughly 1–2
seconds", chosen to give Welch the most data within spec. A secondary cap of
300 samples (`TRACK_HISTORY_MAX_SAMPLES`) exists purely as a memory safety
valve for a source far faster than expected; at any plausible rate the duration
bound is what applies.

**`CropSnapshot` fields:**

| Field | Type | Description |
|---|---|---|
| `timestamp` | `datetime` | Capture time, UTC |
| `monotonic_ts` | `float` | Monotonic clock at capture |
| `bbox` | `BBox` | Box at that frame, full-frame coords |
| `crop_rgb` | `ndarray (h,w,3)` | **May be downscaled** — see `crop_scale` |
| `crop_grayscale` | `ndarray (h,w)` | Same |
| `confidence_raw` | `float` | Detector confidence at that frame |
| `crop_scale` | `float` | Downscale applied to **this** snapshot (`1.0` = native) |
| `match_iou` | `float \| None` | IoU against the previous snapshot; `None` on the first |
| `motion_crop` | `ndarray (h,w)` | **Canonical motion window** — see §2.4 |
| `motion_window_origin` | `(int, int)` | Window top-left in full-frame coords |
| `motion_window_size` | `(w, h)` | Window dimensions, post-scale |
| `motion_epoch` | `int` | Epoch id — **never compare across epochs** |
| `motion_scale` | `float` | Constant scale within an epoch |

History crops are capped at 256 px on the long edge
(`TRACK_MAX_CROP_EDGE`). Retaining native-resolution history costs ~7.3 GB
across a 16-camera fleet with large candidates, versus ~566 MB capped. Because
the cap engages only above the threshold, a *growing* candidate produces a mix
of scaled and unscaled entries within one track — so `crop_scale` is recorded
per snapshot, and any measurement in absolute pixels must normalise by it.

`match_iou` lets Phase 3 apply its own stricter tracker-match gate than the
pipeline's internal `TRACK_IOU_THRESH = 0.25`.

### 2.4 Canonical motion window — Phase 3

Phase 3 runs `cv2.calcOpticalFlowFarneback`, which **requires identical
dimensions** between the two frames it compares. Crops cut to each frame's live
bbox do not satisfy that, because the bbox changes size as a fire grows.

The pipeline therefore maintains a **motion epoch** per track: a window whose
**position and size are both frozen** for the epoch's lifetime.

**Guarantees within one `motion_epoch`:**

1. Every `motion_crop` has **identical dimensions**.
2. Every `motion_crop` is cut from the **same world coordinates** —
   `motion_window_origin` does not move.
3. `motion_scale` is **constant**, computed once at epoch start.
4. No per-frame rescaling occurs, so displacement is never distorted by an
   unknown frame-varying factor.

**The window deliberately does not follow the object.** A centroid-tracking
window would cancel the linear motion Phase 3 uses to identify rigid objects —
a moving vehicle would read as motionless. Because the window is stationary,
flow measured between two same-epoch crops is **true world displacement**, with
no window-motion compensation needed.

**Recovering velocity:**
```python
a, b = inp.history[-2], inp.history[-1]
if a.motion_epoch != b.motion_epoch:
    return verdict(..., evidence_sufficient=False, advisory_phases=("motion",))

flow = cv2.calcOpticalFlowFarneback(a.motion_crop, b.motion_crop, None,
                                    0.5, 3, 25, 3, 5, 1.2, 0)
dx_in_crop  = float(np.median(flow[..., 0][mask]))
dx_world    = dx_in_crop / b.motion_scale          # undo the epoch scale
velocity_px_s = dx_world / (b.monotonic_ts - a.monotonic_ts)
```

Verified end-to-end: a synthetic 24 px displacement was recovered as **24.1 px**
(0.1 px error) through this exact path, at `motion_scale = 0.7293`.

**Re-anchoring policy — documented, never silent.** When the candidate no longer
fits the frozen window — it grew, or moved out — the pipeline opens a **new
epoch** anchored on the current bbox and increments `motion_epoch`. Snapshots
from the previous epoch remain in `history` with their old epoch id.

Clipping was rejected as the alternative: it would silently truncate a growing
fire, which is the failure mode this pipeline exists to prevent.

> **Hard rule: never flow-compare two snapshots with different `motion_epoch`
> values.** The window was re-anchored between them; the comparison is
> meaningless. Treat an epoch boundary as `insufficient_history`, not as a
> rejection.

Window size at epoch start is the padded bbox × `motion_window_expansion`
(default 1.5), clamped to the frame, giving the object room to move inside a
stationary window before re-anchoring is needed.

---

## 3. `ClassifierVerdict` — what you return

| Field | Type | Default | Description |
|---|---|---|---|
| `track_id` | `int` | — | **Must echo the input's** |
| `camera_id` | `str` | — | Echo |
| `timestamp` | `datetime` | — | Echo |
| `bbox` | `BBox` | — | Echo |
| `threat_class` | `ThreatClass` | — | `fire` \| `white_smoke` \| `grey_smoke` \| `black_smoke` \| `false_positive` |
| `confidence` | `float` | — | 0–1, **calibrated** |
| `monotonic_ts` | `float` | `0.0` | Backfilled if omitted |
| `evidence_sufficient` | `bool` | `True` | **See §3.1** |
| `advisory_phases` | `tuple[str, ...]` | `()` | Phases that ran log-only |
| `reasoning` | `dict` | `{}` | Free-form; logged, never control flow |

`confidence` is multiplied into the Context Engine's severity score, so a
confidently-wrong model distorts severity directly. Calibrate it.

### 3.1 The recall-first guarantee

The Phase Reference states: *"'Insufficient history/data' is always a distinct
outcome from 'reject' across all phases, and defaults to escalation — never
silently drops a candidate lacking evidence."*

The contract enforces this. **A candidate is dropped only on a confident
rejection:**

| `threat_class` | `evidence_sufficient` | Pipeline behaviour |
|---|---|---|
| `FALSE_POSITIVE` | `True` | **Dropped.** The only drop path. |
| `FALSE_POSITIVE` | `False` | **Escalated**, class substituted from `class_raw` + loud warning |
| any positive class | `True` | Confirmed → Context Engine |
| any positive class | `False` | **Escalated**, flagged unconfirmed |
| *verdict omitted* | — | Treated as a confident rejection. **Dropped.** |

Set `evidence_sufficient=False` when the phases that would have decided a
candidate lacked the data to do so: too few frames or too low a sample rate for
Flicker, no tracker match or an epoch boundary for Motion, a crop below the
minimum pixel count for Colour or Texture.

**When setting it False, supply your best-guess positive `threat_class`, not
`FALSE_POSITIVE`.** If `FALSE_POSITIVE` arrives with `evidence_sufficient=False`
the pipeline must substitute a class to escalate at all; it does so from
`class_raw` (`fire`/`sparks` → `FIRE`, `smoke` → `GREY_SMOKE`), logs a warning,
and records `pipeline_class_substituted: true`. Correct, but blunt.

List log-only phases in `advisory_phases`. They are promoted to the top level of
the alert's `reasoning` for operator audit and never gate control flow.

### 3.2 Behavioural rules

- Return verdicts in **any order**; matched by `track_id`.
- Returning **fewer** verdicts than inputs is allowed — see the table above.
- **Never raise.** Return a `FALSE_POSITIVE` verdict instead; an exception fails
  the entire frame rather than one candidate.
- Input arrays are shared and marked read-only where numpy permits. **Copy
  before modifying.**

`as_public_dict()` emits the six-field shape the Context Engine consumes:
```json
{ "track_id": 7, "class": "grey_smoke", "confidence": 0.83,
  "camera_id": "cam-1", "bbox": {"x1":100,"y1":100,"x2":200,"y2":200},
  "timestamp": "2026-08-17T06:11:43+00:00" }
```

---

## 4. Phase-by-phase coverage — verified

### Phase 1 — Colour (HSV)
| Declared need | Provided | Status |
|---|---|---|
| Single cropped candidate (BGR/RGB) → HSV | `cropped_frame_rgb` | ✅ |
| No history or tracking required | Standalone | ✅ |
| Minimum pixel-count threshold | Native-resolution crop; `crop_scale == 1.0` | ✅ |
| Connected-component blob-size check | Native resolution | ✅ |
| `too_small_escalate` outcome | `evidence_sufficient=False` | ✅ |

### Phase 2 — Texture
| Declared need | Provided | Status |
|---|---|---|
| Same crop, grayscale | `cropped_frame_grayscale` | ✅ |
| No history required | Standalone | ✅ |
| Exclude a thin border strip | `padding_applied` per side | ✅ |
| Light Gaussian blur before Canny/Laplacian | Classifier-side, unimpeded | ✅ |

### Phase 3 — Motion (Farneback)
| Declared need | Provided | Status |
|---|---|---|
| Two grayscale crops of the same tracked candidate | `history[i].motion_crop` | ✅ |
| **Identical dimensions** for Farneback | Guaranteed within a `motion_epoch` | ✅ **G4 closed** |
| Per-frame capture timestamps | `monotonic_ts` per snapshot | ✅ |
| Displacement normalised by real elapsed time | `monotonic_ts` deltas; timing not assumed constant | ✅ |
| Object-tracking infrastructure | Shared tracking layer, stable `track_id` | ✅ |
| IoU-gated match quality | `match_iou` per snapshot | ✅ |
| Rolling buffer of last 3 comparisons | Duration window holds ≥3 at any usable rate | ✅ |
| True displacement, not window-relative | Stationary window; verified 24 px → 24.1 px | ✅ |

### Phase 4 — Flicker (Welch)
| Declared need | Provided | Status |
|---|---|---|
| Time series of mean brightness with timestamps | Derivable per `history` entry | ✅ |
| ~30–60 consecutive frames | 60 at 30 fps within the window | ✅ |
| **Spanning roughly 1–2 seconds** | Duration-bounded at 2.0 s | ✅ **G6 closed** |
| Flame candidates only | `class_raw` | ✅ |
| Consistent timestamps; may need resampling | `monotonic_ts`; `history_sample_rate_hz` | ✅ |
| Same tracking infrastructure as Motion | Shared layer | ✅ |
| `insufficient_history` distinct from reject | `evidence_sufficient=False` | ✅ **G7 closed** |

### Cross-cutting
| Declared need | Provided | Status |
|---|---|---|
| Minimum-sample-size guard per phase | `track_age_frames`, `len(history)`, `history_span_s`, `history_sample_rate_hz` | ✅ |
| "Insufficient" distinct from "reject", defaults to escalation | `evidence_sufficient` | ✅ |
| Log-only mode for Motion and Flicker | `advisory_phases` | ✅ |
| Tracking is a prerequisite, not optional | Shared layer, always on | ✅ |

---

## 5. Known limitation: flicker sample rate

**Not a contract gap — a physical constraint, disclosed.**

Phase 4 targets a 5–10 Hz band, which needs >20 Hz sampling. The pipeline's
default live-stream **inference** rate is 4 fps, giving a 2 Hz Nyquist ceiling.
At that rate a 5–10 Hz signal aliases into the low-frequency band and becomes
indistinguishable from slow brightness drift.

The contract now makes this **detectable rather than silent**:
`history_sample_rate_hz` reports the measured rate, so Phase 4 can return
`evidence_sufficient=False` instead of a confidently wrong verdict.

Raising the actual sample rate is a pipeline sampling-rate decision under joint
review — see `FLICKER_SAMPLING_TRADEOFFS.md` (recommended: Option D, a
native-rate brightness tap). **Not adopted; awaiting sign-off.** Phase 4 ships
log-only until then, so nothing is gated on it.

Note that the duration-bounded window built for G6 carries over cleanly to
Option D: the buffer is already bounded in seconds, so a higher-rate source
simply fills it with more samples over the same span.

---

## 6. Configuration reference

| Variable | Default | Effect |
|---|---|---|
| `TRACK_HISTORY_WINDOW_S` | `2.0` | History duration bound |
| `TRACK_HISTORY_MAX_SAMPLES` | `300` | Memory safety valve only |
| `TRACK_CROP_PADDING` | `0.15` | Outward crop padding ratio |
| `TRACK_MAX_CROP_EDGE` | `256` | History crop cap (current-frame crop unaffected) |
| `TRACK_MOTION_WINDOW` | `true` | Emit canonical motion crops |
| `TRACK_MOTION_EXPANSION` | `1.5` | Window size vs padded bbox at epoch start |
| `TRACK_MOTION_MAX_EDGE` | `256` | Motion crop cap (per-epoch constant scale) |
| `TRACK_IOU_THRESH` | `0.25` | Internal association gate |
| `PIPELINE_CONF_THRESHOLD` | `0.20` | Detector recall floor |

`GET /v1/contract` returns the live version and field list at runtime.

---

## 7. Reference implementation

`sentinel_pipeline/classifier/stub.py` implements this interface end to end. It
is a **temporary heuristic placeholder** (`is_stub = True`); the pipeline logs a
warning and reports `classifier_is_stub: true` on `/v1/health` while it is
active. Read it as a shape reference only — not as guidance on classification
technique.

---

## 8. Remaining decisions — none block building against this contract

| # | Item | Status |
|---|---|---|
| G4 | Equal-size motion pairs | **Closed** — canonical epoch window |
| G6 | Duration-bounded history | **Closed** — 2.0 s window |
| G7 | Insufficient-evidence escalation | **Closed** — `evidence_sufficient` |
| G1 | Crop resolution for pixel guards | **Closed** — native current-frame crop |
| G2 | Per-side padding | **Closed** — `padding_applied` |
| G3 | Tracker match quality | **Closed** — `match_iou` |
| G5 | Brightness-series pre-computation | **Held** — resolves under Option D; current crop history already satisfies Phase 4 |
| G8 | `sparks` handling | **Open, non-blocking** — reaches you as `class_raw="sparks"`; decide whether Tier 1 handles it or the pipeline maps it first |

G5 and G8 are additive if adopted and cannot invalidate anything above.

---

## 9. Verification

| Suite | Checks | Covers |
|---|---|---|
| `tests/test_g4_g6_closure.py` | 12/12 | Equal-size pairs, real Farneback, stationary window, duration bounding across 4–60 fps, stalling source, exposed window metrics |
| `tests/test_recall_first_contract.py` | 13/13 | Drop vs escalate paths, class substitution, audit fields, native crop, per-side padding, `match_iou` |
| `tests/test_pipeline_core.py` | 26/26 | Tracking identity, evidence guarantee, Context Engine |
| `tests/test_gate_validation.py` | 9/9 | Gate behaviour |
| `tests/test_forced_override_tiers.py` | 6/6 | Per-tier override wiring |
| `tests/test_illumination_vs_fire.py` | 6/6 | Illumination normalisation vs real fire |

```bash
for t in g4_g6_closure recall_first_contract pipeline_core gate_validation forced_override_tiers illumination_vs_fire; do python tests/test_$t.py; done
```
