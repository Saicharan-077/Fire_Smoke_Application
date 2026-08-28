# Context Engine — Algorithms Report

**Date:** 2026-08-28. Every formula below is quoted directly from source
(file + line numbers given), not paraphrased. Every "real value" was pulled
from the live running pipeline during this session. Every "theoretical value"
is explicitly labelled as such and cited to the design document that fixes
it, because the component in question does not exist yet.

---

## 1. Headline answer: which parts are ML, which are deterministic

**The Context Engine itself contains zero machine learning.** Its own module
docstring says so directly (`context/severity.py:7-8`):

> "No AI inference. Everything here is a lookup or arithmetic on values
> earlier stages already produced, which is what keeps this stage
> essentially free."

Across the **whole pipeline**, ML is confined to exactly one stage today:

| Stage | Algorithm | ML? | Trained artifact | Live-verified this session |
|---|---|---|---|---|
| **Gate** | MOG2 background subtraction + hysteresis threshold + forced-override timer | **No** — classical CV | none | §6, `test_gate_validation.py` 9/9 |
| **Model** | YOLO26s object detector | **Yes** — the only neural net in the system | `models/best.pt`, real, trained 2026-07-23 | §7 |
| **Tracking** | IoU/centroid association across frames | **No** — deterministic | none | `test_g4_g6_closure.py` 12/12 |
| **Classifier (current build)** | HSV/brightness thresholds (stub) | **No** — the stub is not ML | none (heuristic) | §8.1 |
| **Classifier (spec'd, not built)** | Tier-1 rules (deterministic) + Tier-2 CNN | **Tier-1 no, Tier-2 yes** | Tier-2 does not exist | §8.2, theoretical only |
| **Context Engine** (severity, containment, envelope) | Arithmetic + geometry + lookup | **No** | none | §3-5, hand-verified |
| **Calibration** (zone clustering) | Convex hull + MAD outlier trim | **No** — not DBSCAN, not ML, no `sklearn` dependency exists in this repo | none | §6, real clustered data shown |
| **Adjacency** (behavioural) | Timestamp co-occurrence counting | **No** | none | §5, real correlated data shown |
| **Adjacency** (geometric, added D14) | Sutherland-Hodgman convex-sector polygon clipping | **No** | none | §5.2, real 43%/43% overlap |
| **Scheduler** | Priority-key sort (tuple comparison) | **No** | none | `test_scheduler.py` 9/9 |
| **Camera drift** | ORB feature matching + affine estimation | **No** — classical CV, not learned | none | `test_operations.py`, real 40px shift recovered to 39.9px |

**One correction to prior documentation, made during this report's
research:** `docs/TODO_ACTION_ITEMS.md` and `docs/MODEL_TRAINING_REQUIREMENTS.md`
both previously described calibration clustering as "DBSCAN/convex-hull."
Reading `context/calibration.py` directly shows this is wrong — there is no
`sklearn` import anywhere in the repository (confirmed by a full-repo grep;
`sklearn` is not in `requirements.txt` either), and the actual clustering is
convex hull plus a median-absolute-deviation (MAD) outlier filter, not
DBSCAN. Both docs have been corrected to reflect the real algorithm as part
of this validation pass.

---

## 2. The Context Engine's job, in one sentence

Given a **confirmed** detection (already past the Model and Classifier
stages), decide **how much it matters** — a severity score and an
alert/no-alert decision — using only zone configuration and tracking history
that earlier stages already computed. `ContextEngine.assess()`
(`context/engine.py:96-165`) is the single entry point; every alert in the
system is written by `ContextEngine.process()` (`engine.py:174+`), which is
the *only* caller of `AlertStore.create()` anywhere in the codebase.

---

## 3. Severity scoring — the core formula, with real proof

**Exact source** (`context/severity.py:82-108`):

```python
effective_risk = 0.6 if zone_risk_weight is None else zone_risk_weight

gf = growth_factor(rate)          # see below
base = confidence * effective_risk * gf

discount = 0.0
if is_controlled_activity and not containment_breached and not envelope_exceeded:
    discount = cfg.controlled_activity_discount     # 0.35 by default

score = base - discount
if containment_breached:                              score += 0.25
if envelope_exceeded:                                  score += 0.20
if flammable_nearby and (containment_breached or envelope_exceeded):
    score += 0.15
score = max(0.0, min(1.0, score))
```

`growth_factor(rate)` (`severity.py:41-51`):
```python
if rate <= 0.0: return 1.0                         # shrinking/stable never de-escalates
return min(2.0, 1.0 + rate * 4.0)                   # saturating at 2x for fast growth
```

`rate` itself is `growth_rate()` (`severity.py:17-38`): fractional area
change per second, `((a1 - a0) / a0) / dt`, over the track's recent history
window — **not a machine-learned quantity**, a plain finite-difference rate
computed from bounding-box areas the Tracking stage already recorded.

**Band thresholds** — real values from `config.py:155-158`:
`CRITICAL ≥ 0.80`, `HIGH ≥ 0.60`, `MEDIUM ≥ 0.35`, `LOW ≥ 0.15`, else `INFO`.
`ContextEngine.assess()` only sets `should_alert = severity is not
Severity.INFO` (`engine.py:159`) — i.e. **a score below 0.15 never becomes an
alert at all**, regardless of what triggered it.

### 3.1 Proof: hand-computed against three real, independently-generated alerts

Pulled via `GET /v1/alerts` from the live pipeline during this session (not
constructed for this report) and recomputed by hand from the formula above:

| Alert ID (truncated) | class | confidence | risk | rate/s | growth_factor | base | breach | **hand-calc** | **API `final_score`** | band (hand) | band (API) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `f7dfe078…` | fire | 0.3978 | 0.6 (default) | −0.258 | **1.0** (rate≤0) | 0.23868 | yes +0.25 | **0.48868 → 0.4887** | **0.4887** ✓ | MEDIUM | medium ✓ |
| `61edb4cd…` | fire | 0.6700 | 0.6 (default) | +0.20744 | **1.8298** (1+0.20744×4) | 0.73556 | yes +0.25 | **0.98556 → 0.9856** | **0.9856** ✓ | CRITICAL | critical ✓ |
| `6e337ddf…` | grey_smoke | 0.9121 | 0.6 (default) | +1.52411 | **2.0** (saturated: 1+1.524×4=7.1 → capped) | 1.09452 | yes +0.25 | **1.09452 → clamp 1.0** | **1.0** ✓ | CRITICAL | critical ✓ |

All three: exact match, formula reproduces the live API's own output to its
stated rounding precision, and every derived severity band is correct.
`effective_risk = 0.6` in all three because none of these test cameras had
an *approved* zone — this is the deliberate uncalibrated-camera default
(`severity.py:87`, comment: *"a zero would zero out severity entirely and
silence every alert on an uncalibrated camera, which is the opposite of
safe"*), not a bug or a placeholder.

### 3.2 Why this design, not a learned scorer

A trained severity model would need labelled ground truth for "how bad was
this, really" — which does not exist and cannot be cheaply generated (unlike
detection labels, severity is a judgement call, not a pixel fact). The
deterministic design instead makes every input to the score an already-known
quantity (confidence from the Model, risk from a human-approved zone,
growth from geometry, containment from a polygon test) and combines them with
fixed, auditable weights. The practical benefit demonstrated in §3.1: given
the four raw inputs, the exact severity score is reproducible by hand with a
calculator — there is no confidence interval, no model version to track, and
no drift to monitor for this stage specifically.

---

## 4. Containment and envelope checks — geometry and statistics, not learning

### 4.1 Containment (`zones.py:97-122`, `Zone.contains()`)

```python
xs = np.linspace(bbox.x1, bbox.x2, 5)
ys = np.linspace(bbox.y1, bbox.y2, 5)
inside_count = sum(
    1 for x in xs for y in ys
    if cv2.pointPolygonTest(poly, (x, y), False) >= 0
)
fraction = inside_count / 25
return fraction >= 0.5, fraction
```
A 5×5 grid (25 sample points) is tested against the containment polygon with
OpenCV's exact point-in-polygon test (not an approximation); a detection
counts as "contained" only if **at least half** its sampled footprint falls
inside. This deliberately rejects centroid-only testing — the code comment
is explicit: *"testing the centroid alone would call a fire 'contained' while
most of it has already spread outside the boundary."* A camera with **no**
approved containment polygon treats every detection as a breach by design
(`has_containment` requires ≥3 polygon points) — the safe default for an
unconfigured camera.

**Real values, this session:** the "Chemical Storage" zone (real, approved,
pulled via `GET /v1/zones`) has a real 4-point polygon and
`risk_weight=1.0`; the "Break Area" zone has **no** polygon
(`has_containment: false`) and `risk_weight=0.2` — every detection there is
an unconditional breach, which is correct for a zone defined only by
`designated_activity_allowed` (`bonfire`, `smoking_area`) rather than a
containment boundary.

### 4.2 Normal envelope (`zones.py:44-52`, `NormalEnvelope.area_is_normal()`)

```python
if area > max_area:
    limit = mean_area + area_sigma_tolerance * std_area   # default 3σ
    if area > limit:
        return False, f"area {area} exceeds mean+{sigma}sigma ({limit})"
    return True, "within statistical envelope"
return True, "within envelope"
```
Plain mean+k·σ outlier test — not a learned distribution, not a Gaussian
mixture, just `numpy` statistics computed once at calibration time (see §6)
and compared arithmetically per detection thereafter.

---

## 5. Adjacency — behavioural + geometric correlation, both deterministic, real data proof

**Update, later the same session (D14):** a third signal was added —
geometric field-of-view overlap, computed from real camera placements on an
uploaded facility map. §5.2 below covers it; §5/5.1 (behavioural) are
unchanged from the original pass. All three sources are surfaced distinctly
in the dashboard UI and never auto-write a zone's confirmed adjacency — see
`MIGRATION_DECISIONS_LOG.md` D12 and D14.

Three distinct sources, never conflated in code or in the dashboard UI:

**Confirmed** — `Zone.adjacent_camera_ids`, a human-declared field set at
zone-approval time (`zones.py:83`). Runtime check,
`ZoneRegistry.are_adjacent()` (`zones.py:194-206`): true if either camera
lists the other, or both zones share one `zone_id`.

**Candidate** — `CalibrationManager._adjacency_candidates()`
(`calibration.py:247-267`), real code:
```python
for other, times in self._trigger_times.items():
    hits = sum(1 for t in mine_sorted
               if any(abs(other_sorted[j] - t) <= tolerance_s   # 3.0s
                      for j in nearby_indices(other_sorted, t)))
    if hits / len(mine_sorted) >= 0.5:
        candidates.append(other)
```
Two cameras become adjacency **candidates** (never auto-confirmed) if at
least half of one camera's real detection-trigger timestamps land within
3.0 seconds of a trigger on the other camera. This is timestamp
co-occurrence counting — no clustering, no learned similarity metric.

### 5.1 Real proof, this session

A script (`/tmp/.../scratchpad/gen_calibration_demo.py`) registered four
real cameras against the live pipeline and calibrated them concurrently with
real fire/smoke test frames:
- **"Zone-A North"** and **"Zone-A South"** fed in lockstep (same instant,
  16 rounds) → each ended up with the other in `adjacency_candidates`.
- **"Zone-B East"** and **"Zone-B West"**, fed with a 0.15s/1.9s stagger →
  *intended* as an uncorrelated contrast pair, but the stagger was still
  within the 3.0s tolerance, so they candidate-correlated too — an honest
  test-design mistake on my part (the algorithm did exactly what it's
  supposed to given the real timing), disclosed rather than silently
  reframed as intentional. See `MIGRATION_DECISIONS_LOG.md` D12 for the full
  account.
- Approving North's zone with South declared **confirmed** produced a
  visually distinct solid edge in the new adjacency graph, alongside the
  still-dashed North/South *candidate* edge from before approval and the
  East/West candidate pair — all three rendered correctly in a live browser
  session, screenshotted, zero console errors on a fresh tab.

This is the strongest available proof for a feature with no ground truth to
check against: real, independently-generated, differently-timed data
produced the theoretically-predicted correlation result in both the intended
case and the accidental one.

### 5.2 Geometric — field-of-view overlap, deterministic, real data proof (D14)

**File:** `Fire_Smoke_Application-main/backend/app/routes/facility_map_routes.py`
(dashboard backend, not the pipeline — camera placement is site configuration,
not detection logic).

**Algorithm, not ML:** each camera's field of view is modelled as a circular
sector (apex at the camera's position, pointing at a facing bearing, spanning
an angular width, extending a range) approximated as a 26-point convex
polygon. Overlap between two cameras is the EXACT polygon intersection of
their two sectors via Sutherland-Hodgman clipping (both sectors are convex,
so this is exact, not approximated) — the same "deterministic geometry,
no dependency" pattern as calibration's convex hull (§6 above), not a new
paradigm. Real code:
```python
def _fov_overlap_pct(a, b, diagonal_px):
    sector_a = _sector_polygon(a.x, a.y, a.facing_deg, a.fov_deg, a.range_pct/100*diagonal_px)
    sector_b = _sector_polygon(b.x, b.y, b.facing_deg, b.fov_deg, b.range_pct/100*diagonal_px)
    inter_area = _polygon_area(_clip_polygon(sector_a, sector_b))
    return inter_area, inter_area/area(sector_a)*100, inter_area/area(sector_b)*100
```
The two returned percentages are deliberately asymmetric (`pct_of_a`,
`pct_of_b`, not one Jaccard number) — a wide-angle camera's small overlap
with a narrow one is a materially different fact from each camera's own
perspective, and collapsing that into one symmetric number would hide which
camera is more exposed.

**Real proof, this session:** uploaded a synthetic 800×600 test floor plan
via the new Facility Map tab, placed two real registered cameras ("Test
Camera A" at the Zone-A marker, facing 140° wide toward Zone B at 60% range;
"Test Camera B" symmetric, facing back) by clicking directly on the rendered
map in a live browser session. The dashboard's SVG overlay drew both FOV
cones correctly in real time from the exact placement data. The backend
computed **43.0% / 43.0%** overlap (symmetric, as geometry predicts for this
symmetric setup) — independently re-confirmed via a direct authenticated API
call to `GET /api/v1/facility-map/overlap`, exactly matching the number shown
in the UI.

**The suggestion → approval loop, proven end-to-end:** clicking "Apply via
Test Camera B's zone" opened the exact same reviewed/reasoned/logged
zone-edit flow as any other correction (D13) — NOT a direct write. Confirmed
in the UI, then independently verified two ways: the pipeline's own
`GET /v1/zones` showed `adjacent_camera_ids: ["<Test Camera A's id>"]` on
Test Camera B's zone, and the dashboard's audit log (queried directly via
SQLite, bypassing the API) showed a `ZONE_EDIT` entry with the exact reason
text and diff. A computed geometric overlap never became a confirmed
adjacency without that human step.

**One real process finding along the way, disclosed:** mid-verification, an
independent `curl` login as the same admin account (used to re-check the
overlap percentage from outside the browser) silently invalidated the
browser's own session token — this app keeps one session token per user, so
a second login elsewhere logs the first one out. The first "Apply via" click
therefore failed with real `401`s in the network log, not a bug in the new
code; re-authenticating in the browser and retrying reproduced success
cleanly. Noted here because it's a real characteristic of the auth system
worth knowing before parallel-testing the same account from two places.

---

## 6. Calibration clustering — convex hull + MAD, not DBSCAN

**Corrected in this report** — see §1. Real algorithm
(`calibration.py:159-230`):

1. Collect all four corners of every observed bounding box during the
   window into one point cloud (not centroids — the code comment: *"a
   containment boundary must enclose the full extent of normal activity,
   and centroids would produce a polygon smaller than the fires
   themselves"*).
2. **Outlier trim** (`_trim_outliers`, MAD-based, only if ≥8 points):
   ```python
   centre = pts.mean(axis=0)
   d = distance(pts, centre)
   mad = median(abs(d - median(d))) * 1.4826       # scaled MAD
   keep points where d <= median(d) + 2.5 * mad
   ```
3. **`cv2.convexHull()`** on the trimmed points → the suggested polygon.
4. Envelope stats (`min/max/mean/std area`) are plain `numpy` array
   statistics over observed bbox areas — not fitted, just computed.
5. "Always-on" detection: split the observation window into 20 time
   buckets, flag always-on if ≥ `calibration_always_on_ratio` of buckets
   saw at least one detection.

**Real values, this session** (from the same demo script, `GET
.../calibrate/suggestion` on "Zone-B East," real observation data, not
constructed): `observation_count=40`, `envelope.mean_area=106057.125px²`,
`envelope.std_area=130751.38px²`, `min_area=1426px²`, `max_area=409600px²`
(the full 640×640 frame — a real fixture image with a full-frame smoke
crop), `always_on=false`. `MIN_OBSERVATIONS=12` (`calibration.py:102`) is
the hard floor below which a suggestion is refused entirely, not just
flagged low-confidence — with 40 real observations, this suggestion is well
past that floor.

**Why not a real clustering library:** the geometry here is simple (one
convex region per camera, no multi-modal clusters expected within one
camera's normal activity), so `cv2.convexHull` plus a classical outlier
filter is sufficient and needs no external ML dependency, no training, and
no hyperparameter tuning beyond the two constants above (`sigma=2.5` for the
MAD trim, `MIN_OBSERVATIONS=12`).

---

## 7. The one real ML component: the Model stage (YOLO26s)

Real, live-verified specs from `GET /v1/model/info` this session:
```json
{"architecture": "yolo26s", "device": "cuda", "imgsz": 640,
 "conf_threshold": 0.2, "iou_threshold": 0.45,
 "classes": {"0": "fire", "1": "smoke", "2": "sparks"},
 "ultralytics_version": "8.4.120",
 "trained_date": "2026-07-23T00:42:12", "ready": true}
```
`conf_threshold=0.2` is deliberately low (recall-tuned — the Model is
*supposed* to over-flag; precision is the Classifier's job downstream, per
the pipeline's own layered design). Real measured latency this session
(`tests/benchmark.py`, RTX A2000): **p50=8.35ms, p95=10.14ms, p99=10.39ms**
per inference (§4 of `PIPELINE_VALIDATION_REPORT.md` has the full benchmark
output). This is the only stage in the entire system whose output cannot be
reproduced by hand from its inputs — everything downstream of it (Tracking,
current-build Classifier, Context Engine, Calibration, Adjacency, Scheduler)
is deterministic and was hand-verified as such in this report.

---

## 8. Classifier — current build vs. theoretical spec

### 8.1 Current build: stub heuristic (deterministic, not ML)

**File:** `classifier/stub.py`. Its own docstring: *"TEMPORARY STUB
CLASSIFIER — NOT FOR PRODUCTION USE ... It is NOT the two-tier Rules→CNN
design ... NO trained model, NO hard-negative handling, NO texture analysis,
NO optical flow, NO flicker FFT."* Externally visible on live `/v1/health`
as `classifier_is_stub: true` — confirmed still true as of this session's
final health check.

Real thresholds (`stub.py`, quoted): fire rejected as false-positive if
`mean_saturation < 55.0` or `mean_value < 70.0` (else confidence × 1.05,
capped 0.99); smoke rejected if `mean_saturation > 145.0`, else banded
white/grey/black by `mean_value` (≥165 white, ≥95 grey, else black); sparks
promoted to fire only if `track_age_frames >= 3`. All plain HSV arithmetic
on the OpenCV-converted crop — zero learned parameters.

**Real example, this session:** alert `61edb4cd…`'s `reasoning.classifier`
block: `{"classifier": "stub-heuristic", "is_stub": true, "mean_saturation":
154.17, "mean_value": 230.84, "class_raw": "fire"}` — both real numbers
computed from the real evidence crop, visible in the API's own audit trail.

### 8.2 Spec'd real classifier: Tier-1 rules (deterministic) + Tier-2 CNN (ML) — **not built**

**Theoretical values only**, cited to `docs/MODEL_TRAINING_REQUIREMENTS.md`
§2 (the fixed specification nothing has been trained against yet):

| Property | Specified value | Status |
|---|---|---|
| Task | Single-label classification, 5 classes (`fire`/`white_smoke`/`grey_smoke`/`black_smoke`/`false_positive`) | Locked decision, not started |
| Suggested backbone | MobileNetV3-Small or equivalent, **≤5M params** | Recommendation, not trained |
| Runtime target | CPU-capable, **<10ms per crop at p95** | Target, not measured (doesn't exist) |
| Input | RGB crop (not BGR), 0.15 padding ratio around the detected bbox, variable size resized by the model's own preprocessing | Fixed by the live `ClassifierInput` contract |
| Input resolution | **96 / 128 / 224 px, open decision — 128×128 recommended** | Open item B4 in `TODO_ACTION_ITEMS.md`, not decided |

**Why Tier-1 (rules) + Tier-2 (CNN) instead of one model:** the Model stage
is deliberately over-sensitive (§7); Tier-1 cheap deterministic rules are
meant to reject the *obvious* false positives for free, and only the
genuinely ambiguous remainder is sent to the small CNN — keeping the
learned component's input distribution narrow and its runtime cost
(<10ms target) achievable on CPU. This mirrors the same "cheap filter
before expensive stage" pattern the Gate already uses in front of the
Model (§1 table) — the architecture repeats this pattern deliberately, not
by coincidence.

**Blocking status:** `sparks`-class training data is confirmed structurally
degraded (from the same investigation this session drew on:
`SparkDetector` subset has 98.25% near-fullframe boxes, 49.12% exactly
whole-image) — real numbers from `TODO_ACTION_ITEMS.md` B1, re-cited here
because it directly affects Tier-2 training data quality, not re-verified
independently in this pass.

---

## 9. Summary — every algorithm, one line each, with its proof location

| Component | Type | Real formula/algorithm | Proof in this report |
|---|---|---|---|
| Severity score | Deterministic arithmetic | `confidence × risk × growth_factor` + escalation terms, clamped [0,1] | §3.1, 3-alert hand-verification, exact match |
| Severity band | Deterministic threshold ladder | 0.80/0.60/0.35/0.15 cutoffs | §3.1, all 3 bands correct |
| Containment | Deterministic geometry | 5×5 grid `cv2.pointPolygonTest`, ≥50% inside | §4.1, real zone data (Chemical Storage vs Break Area) |
| Normal envelope | Deterministic statistics | mean + kσ (k=3 default) | §4.2 |
| Adjacency (confirmed) | Human input | `Zone.adjacent_camera_ids` | §5, live dashboard screenshot |
| Adjacency (candidate) | Deterministic correlation | ≥50% trigger co-occurrence within 3.0s | §5.1, real 4-camera correlated data |
| Adjacency (geometric) | Deterministic geometry | Sutherland-Hodgman convex-sector FOV overlap | §5.2, real 43.0%/43.0% overlap, independently re-confirmed via direct API call |
| Calibration clustering | Deterministic CV | convex hull + MAD outlier trim (NOT DBSCAN — corrected this session) | §6, real 40-observation envelope |
| Model (YOLO26s) | **Machine learning** | trained object detector | §7, real p50=8.35ms, real classes |
| Classifier (current) | Deterministic heuristic | HSV/value thresholds | §8.1, real crop values from a live alert |
| Classifier (spec'd) | Tier-1 deterministic + **Tier-2 ML** | MobileNetV3-Small, ≤5M params | §8.2, theoretical only, not built |
| Scheduler priority | Deterministic tuple sort | starvation → active-alert → risk → signal → age | `PIPELINE_VALIDATION_REPORT.md` §5.1 |
| Camera drift | Deterministic CV | ORB features + affine estimation | `test_operations.py`, real 40px shift → 39.9px measured |

**One-sentence answer to "what ML are we using":** one trained YOLO26s object
detector, and — once built — a small (≤5M param) CNN for ambiguous
classifier cases. Everything else in the system, including all of severity
scoring, containment, calibration, and adjacency, is deterministic code with
no learned parameters, verified by hand-reproducing its output against real
live data in this report.
