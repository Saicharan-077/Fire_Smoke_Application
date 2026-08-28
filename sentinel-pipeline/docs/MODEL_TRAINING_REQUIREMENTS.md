# SentinelOS — Model Training Register & Requirements Sheet

**Status: ALL TRAINING HELD.** Nothing in this document has been started. No
training run has been launched on this project by the pipeline build.
This register exists so training can be executed elsewhere, by another team,
against a fixed specification.

**Date:** 2026-08-17
**Scope:** every component of the Gate → Model → Classifier → Context Engine
pipeline that requires a *trained* artifact.

---

## 1. Summary — what actually needs training

The pipeline is deliberately designed so that **only one stage uses a neural
network on raw pixels**. That keeps the training surface small. Full inventory:

| # | Component | Needs training? | Exists today? | Priority |
|---|---|---|---|---|
| A | Classifier **Tier-2 CNN** | **YES — required** | No | Blocking for full Classifier |
| B | **Model stage** YOLO detector (recall retrain) | Optional — open decision | Yes (`best.pt`) | Deferred decision |
| C | Gate (background subtraction) | No — classical MOG2/KNN | Being built | — |
| D | Classifier **Tier-1 rules** | No — HSV/texture thresholds | Partially exists | — |
| E | Tracking layer | No — IoU/centroid association | Being built | — |
| F | Context Engine | No — lookup + arithmetic | Being built | — |
| G | Calibration (zone clustering) | No — convex hull + MAD outlier trim (no DBSCAN; `sklearn` isn't even a dependency) | Built (`context/calibration.py`) | — |
| H | Camera drift detection | No — ORB/SIFT feature matching | Designed | — |

**So: one required training (A), one optional (B). Everything else is
classical CV or arithmetic and needs no data collection at all.**

This is by design, per the Master Pipeline Document's core principle: *only the
Model stage touches pixels with a neural network.*

---

## 2. Model A — Classifier Tier-2 CNN  **(REQUIRED, does not exist)**

### 2.1 Purpose

The Model stage is tuned for recall and deliberately over-flags. Tier-1 rules
reject the obvious false positives for free. Tier-2 is the small CNN that
adjudicates the **ambiguous remainder** that Tier-1 cannot confidently call, and
supplies the smoke-colour distinction the detector has no concept of.

### 2.2 Task specification

| Property | Value |
|---|---|
| Task type | Single-label image classification (not detection, not segmentation) |
| Input | One cropped candidate region, already localised by the Model stage |
| Output | Class + calibrated confidence |
| Classes (5) | `fire`, `white_smoke`, `grey_smoke`, `black_smoke`, `false_positive` |
| Suggested backbone | MobileNetV3-Small, or equivalent ≤ 5M params |
| Runtime target | CPU-capable; **< 10 ms per crop** at p95 |

**Class list is locked** (Master Pipeline Document §5, Decisions Log). Do **not**
add per-ignition-source classes (cigarette, candle, welding, vehicle fire, …) —
that was explicitly rejected, because ignition source is visually
indistinguishable at camera distance and because severity is the Context
Engine's job, not the taxonomy's.

### 2.3 Input format — must match the pipeline's live contract

The crop the model receives in production is defined by
`ClassifierInput` in `sentinel_pipeline/contracts.py`. Training preprocessing
**must match this or the model will silently underperform in deployment:**

| Property | Production value |
|---|---|
| Colour space | **RGB** (not BGR) |
| Source | Crop of the full-resolution frame, not a resized frame |
| Padding | Bounding box expanded outward by a configurable ratio (default 0.15) so texture/flow phases see context |
| Crop size | **Variable** — must be resized by the model's own preprocessing |
| Bit depth | uint8, 0–255 |
| Grayscale variant | Supplied alongside RGB, single channel |

**Decision needed from the training team:** the target input resolution
(e.g. 96×96, 128×128, 224×224). Smaller is faster but loses smoke texture, which
is the main signal separating grey from black smoke. Recommend **128×128** as
the starting point. Whatever is chosen must be **documented and baked into the
delivered artifact's preprocessing**, not left implicit.

### 2.4 Training data requirements

#### Positive classes

For each of `fire`, `white_smoke`, `grey_smoke`, `black_smoke`:

| Requirement | Target |
|---|---|
| Minimum crops per class | 3,000 (absolute floor 1,500) |
| Preferred crops per class | 8,000–10,000 |
| Lighting coverage | day, dusk, night, artificial light |
| Distance coverage | near (box > 25% frame) through far (box < 3% frame) |
| Camera coverage | multiple camera models, resolutions, compression levels |
| Environment coverage | indoor, outdoor, industrial, vegetation |

Crops must be extracted the same way production extracts them: tight detection
box + the same padding ratio. Crops cut differently will not transfer.

#### `false_positive` class — the critical one

This class needs **more data than any positive class**, and its composition
matters more than its size. Target **15,000+ crops**, weighted toward whatever
the site's cameras actually produce.

Confirmed hard-negative categories to cover (Master Pipeline Document §5):

- Fog, mist, haze
- Steam — vents, kettles, exhaust pipes, cooling towers, kitchen vents
- Vehicle exhaust
- Dust / sand disturbance
- Clouds, **especially backlit sunset/sunrise (fire-coloured) clouds**
- Sun glare, lens flare
- Reflections — water, glass, polished metal
- Artificial lights — red/orange warning lights, brake lights, headlights, neon
- Orange/red fabric, tarps, safety vests, flags
- Autumn foliage in warm light
- Welding / grinding sparks
- Fireworks (if relevant to site)
- Streetlights / stadium lighting at night
- Backlit dust in sunbeams
- Specular glints on wet or metal surfaces
- Insects / birds near the lens at night
- If thermal/IR cameras used: hot engine parts, animal eye-shine, IR illuminator hotspots

#### Bootstrap datasets (before production logs exist)

D-Fire · FASDD · Smoke100k · FIRESENSE · relevant Kaggle wildfire/smoke sets.

Use for **initial pretraining only**, then fine-tune on site data. Public sets
skew toward large, obvious, well-lit fires and under-represent the far-away,
low-contrast, partially-occluded cases that matter operationally.

#### Test set — non-negotiable

Must include **held-out real footage from the deployment's actual cameras**, not
just public dataset images. A model validated only on public data will report
strong numbers and fail in production. Hold out by **camera and by day**, never
by random crop split — random splits leak near-duplicate frames across the
split and inflate scores substantially.

### 2.5 Success criteria

| Metric | Target | Notes |
|---|---|---|
| Recall on all positive classes (combined) | **≥ 0.95** | A missed fire is the expensive failure |
| `false_positive` recall | ≥ 0.80 | This is the whole point of the tier |
| Smoke sub-type accuracy | ≥ 0.75 | Given the sub-types, not overall |
| p95 latency per crop | < 10 ms | CPU |
| Model size | < 20 MB | Loaded in-process alongside YOLO |

**Tuning bias: favour recall over precision.** When uncertain between a positive
class and `false_positive`, prefer the positive. Report the full confusion
matrix and per-class precision/recall — not just aggregate accuracy.

Confidence must be **calibrated** (temperature scaling or equivalent). The
Context Engine multiplies this confidence into its severity score, so a model
that is confidently wrong distorts severity directly.

### 2.6 Deliverable format

1. Weights file — TorchScript or ONNX preferred, `.pt` acceptable.
2. **Exact preprocessing spec**: input size, normalisation constants, resize
   interpolation, colour space, padding assumption.
3. Class index → label mapping, explicitly.
4. Confusion matrix + per-class precision/recall on the held-out real-camera set.
5. The held-out test set itself, retained for regression testing.

The artifact plugs into the pipeline by implementing the `Classifier` interface
(`sentinel_pipeline/classifier/base.py`). It is loaded **in-process** and
receives numpy arrays directly — no serialisation, no HTTP.

### 2.7 Open questions blocking full specification

1. **The Tier-1 cascade reference document has not been supplied.** Without it I
   cannot specify the confidence band at which Tier-1 defers to Tier-2 — which
   directly determines what slice of the data distribution Tier-2 must be
   trained on. Training Tier-2 on all candidates when it will only ever see the
   ambiguous middle produces a miscalibrated model.
2. Should `sparks` (a real class the detector emits) map to `fire`, to
   `false_positive`, or to its own handling? See §3.3 — currently the existing
   application discards it entirely.
3. Target input resolution (see §2.3).

---

## 3. Model B — YOLO detector retrain  **(OPTIONAL — open decision)**

### 3.1 Current artifact — verified directly from the checkpoint

Read out of `models/best.pt` (not quoted from documentation):

| Property | Value |
|---|---|
| Base architecture | `yolo26s.pt` / `yolo26s.yaml` |
| Ultralytics version | 8.4.104 |
| Trained | 2026-07-23 |
| Classes | `{0: fire, 1: smoke, 2: sparks}` |
| Epochs / imgsz / batch | 100 / 640 / 10 |
| Optimizer / lr0 / patience | auto / 0.01 / 30 |
| Augmentation | mosaic 1.0, fliplr 0.5, `augment=False` |
| Training dataset path | `/home/innovision-limited/usecase2/Datasets/NewDataset/merged_dataset/data.yaml` |

Validation metrics stored in the checkpoint:

| Metric | Value |
|---|---|
| precision(B) | 0.8634 |
| recall(B) | 0.79324 |
| mAP50(B) | 0.85134 |
| mAP50-95(B) | 0.67868 |

### 3.2 Why a retrain is on the table

**Recall 0.793 is low for a system where a missed fire is the costly failure.**
Roughly one in five ground-truth objects is not detected at the threshold that
number was measured at. Since the Classifier can only reject false positives —
it can never recover something the detector never boxed — this recall figure is
a hard ceiling on total system sensitivity.

### 3.3 Blocking input needed before the decision can be made

**Per-class metrics do not exist in the checkpoint.** I confirmed this directly:
`train_metrics` contains only aggregate `(B)` values, with no per-class
breakdown and no confusion matrix. This matters because the original design doc
records the symptom *"white smoke was missed while black smoke wasn't"* — an
aggregate recall of 0.793 could be masking a much worse smoke-specific recall.

**To recover this, someone with the dataset must run:**

```bash
yolo val model=best.pt data=/path/to/merged_dataset/data.yaml split=val
```

That produces per-class P/R/mAP and the confusion matrix. It requires the
dataset, which is not on this machine. **This is the single highest-value input
you can supply**, and it costs one command — it determines whether a retrain is
needed at all, or whether the existing model is fine and the real gap is
downstream.

Also needed: **the confidence threshold those metrics were measured at**, versus
the deployed threshold. The pipeline runs the detector at a deliberately low
floor (0.20) for recall; if 0.793 was measured at 0.25 or 0.5 the comparison is
not like-for-like.

### 3.4 If a retrain proceeds — requirements

| Requirement | Detail |
|---|---|
| Keep class names | `fire`, `smoke`, `sparks` — **exactly these strings** |
| Keep task | Detection, 640 imgsz |
| Optimise for | **Recall**, accepting precision loss — precision is the Classifier's job |
| Target | recall ≥ 0.90 at the deployed confidence floor |
| Additional data | Weighted toward whichever class the per-class validation shows weakest |
| Deliverable | `.pt`, plus per-class metrics and confusion matrix |

Changing the class names or their order is a **breaking change** to the
pipeline's `RawClass` contract and would require a contract version bump. If new
classes are genuinely needed, raise it before training, not after.

### 3.5 The `sparks` question — needs an operational decision

The existing application's class mapping matches on the substrings `"fire"`,
`"flame"` and `"smoke"`. `"sparks"` matches none of them, so **every sparks
detection is silently discarded** — one third of the model's trained output is
thrown away at runtime.

The master document describes this as "sparks remapped to fire", which is not
what the code does. Either way this needs a deliberate decision:

- **Discard** — current behaviour; risks missing a genuine ignition source.
- **Map to `fire`** — a welding spark could raise a full fire-severity alert.
- **Pass through to the Classifier** — the pipeline's chosen default: emit
  `sparks` as `class_raw` and let the Classifier and Context Engine decide.
  Requires the Tier-2 CNN to have seen spark crops in training.

The third option is what the new pipeline implements. **It requires welding and
grinding spark crops in the Tier-2 training data**, labelled deliberately —
either as `false_positive` (routine industrial activity) or `fire`. That
labelling decision should be made by whoever owns the operational response, not
by the training team by default.

---

## 4. What we need from you — consolidated input checklist

Ordered by value per unit of effort:

| # | Input | Effort | Why it matters |
|---|---|---|---|
| 1 | `yolo val` per-class metrics + confusion matrix for `best.pt` | One command | Decides whether Model B retrain is needed at all |
| 2 | The **Tier-1 cascade reference document** | Send a file | Unblocks the Tier-2 training spec *and* the Classifier interface contract |
| 3 | Confidence threshold the 0.793 recall was measured at | One lookup | Makes the recall number interpretable |
| 4 | Decision: `sparks` → discard / fire / pass-through | Operational call | Changes Tier-2 labelling |
| 5 | Decision: Tier-2 input resolution | Technical call | Must be fixed before data prep |
| 6 | Access to real deployment camera footage | Ongoing | The only thing that validates real-world generalisation |
| 7 | Whether the original merged_dataset is still available | One lookup | Without it, Model B retrain restarts from scratch |

---

## 5. What is NOT blocked by any of this

The pipeline build continues without any trained artifact, because:

- Gate, tracking, Context Engine, and calibration are entirely classical — no
  model, no data.
- The Model stage uses the **existing** `best.pt` as-is.
- The Classifier is represented by a **documented temporary stub** implementing
  the exact final output contract, so the Context Engine can be built and tested
  end-to-end now. The real Classifier drops in later with no pipeline changes.

Training being held does not block anything currently in progress.
