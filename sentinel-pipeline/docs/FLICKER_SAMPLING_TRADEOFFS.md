# Flicker Sampling — Options Comparison

**For joint review: pipeline owner + Classifier team.**
**Nothing here is implemented. No option has been chosen.**

This is a *pipeline sampling-rate* decision, not classifier logic — but it
determines what data Phase 4 actually receives, so it needs both parties.

---

## 1. The problem, stated precisely

Phase 4 looks for the ~5–10 Hz oscillation characteristic of flame combustion,
using Welch's method over "~30–60 frames" spanning "roughly 1–2 seconds".

That phrasing implies **~30 fps**. The pipeline does not deliver that.

| | Value |
|---|---|
| Signal band of interest | 5–10 Hz |
| Nyquist minimum to represent 10 Hz | **> 20 Hz** |
| Practical minimum for Welch with usable resolution | **~25–30 Hz** |
| Pipeline default live-stream inference rate | **4 fps** (`inference_fps` cap) |
| Nyquist ceiling at 4 fps | **2 Hz** |

At 4 fps, a 5–10 Hz signal is aliased. It does not appear as attenuated or
noisy — it folds down into the low-frequency band and is **indistinguishable
from slow brightness drift**. A steady streetlight and a flickering flame can
produce similar spectra. The check would not merely be weak; it could be
confidently wrong in either direction.

The 60-frame history therefore satisfies the phase's stated *frame count* while
failing its stated *duration*: 60 frames at 4 fps is **15 seconds**, not 1–2.
Handing it over unchanged looks compliant and is not.

**Two facts that materially reduce the stakes:**

1. Phase 4 ships **log-only from day one** — no validation data exists. Nothing
   is gated on it today, so this can be solved before it goes live rather than
   before it ships.
2. Phase 4 is **flame-only** ("smoke does not flicker"). It applies to a subset
   of candidates on a subset of frames, not to everything.

---

## 2. The insight that reframes the cost

**Phase 4's declared input is "a time series of mean brightness values with
timestamps" — not images.**

That matters enormously, because brightness sampling does **not** require
running YOLO. To extend a track's brightness series we need only the track's
last known bbox and the raw frame — one crop and one `mean()`.

So the high sample rate is needed on **frame capture**, not on **inference**.
Those are separate rates in this pipeline, and the reader thread already runs
at the source's native rate (typically 25–30 fps) — it simply drops the frames
inference doesn't consume.

That drop is currently free. Tapping it is nearly free too.

Cost of a brightness sample: a 128×128 crop plus `mean()` ≈ **~10 µs**.
At 30 fps that is **0.3 ms per second per track**. For 16 cameras × 3 active
tracks: **~15 ms per second total**, against 16,000 ms of wall time.

---

## 3. The options

### Option A — Burst-rate sampling (raise inference rate temporarily)

Raise the camera's *inference* rate to ~30 fps for a short window when a flame
candidate appears.

- **Trigger:** Model emits `class_raw == fire` above a confidence floor on a
  track with no flicker verdict yet. Ideally after Phases 1–2 pass, so bursts
  aren't spent on candidates Colour already rejected.
- **Duration:** ~2 s (60 frames at 30 fps), then back to baseline. One burst
  per track; re-armed only if the track is lost and reacquired.
- **Cost while active:** inference goes 4 → 30 fps, a **7.5× increase** on that
  camera. At the measured 7.8 ms p50 GPU latency, 30 fps costs ~234 ms of GPU
  per second — sustainable for one camera, but concurrent bursts across many
  cameras contend for one GPU. On CPU (~123 ms/frame per the earlier audit)
  30 fps is **not achievable at all** — a burst would silently under-deliver.
- **Latency impact:** other cameras' scheduling is delayed while a burst runs;
  the multi-camera priority queue (not yet built) would need to account for it.
- **Fidelity:** full — a true 30 fps uniformly-ish sampled series.
- **Verdict:** delivers the right data, but pays in the most expensive currency
  the pipeline has (Model compute) for something that needs no Model at all.
  Hardware-dependent in a way that makes behaviour differ between dev and
  deployment.

### Option B — Raw-frame callback (Classifier pulls frames itself)

Give the Classifier a handle to pull raw frames at native rate for a track.

- **Does it bypass the Gate's decimation?** **Yes, entirely** — that is the
  point, and the main objection. The Gate exists as the single place deciding
  which frames get processed; a second path around it re-creates exactly the
  fragmentation this rebuild removed. It would become a ninth frame path.
- **Cost on candidates that never need Flicker:** depends on trigger
  discipline. Pulled lazily (only for flame candidates that reached Phase 4),
  wasted work is near zero. But the interface *permits* pulling for anything,
  and the pipeline cannot enforce restraint — the cost becomes a property of
  classifier code rather than pipeline policy.
- **Additional cost:** requires retaining raw frames for a window (a ring
  buffer of full frames, ~2 MB each at 720p → ~120 MB per camera for 2 s at
  30 fps), versus discarding them as now.
- **Fidelity:** full.
- **Verdict:** most flexible, worst boundary. Also inverts control: the
  Classifier would drive capture, which the architecture deliberately keeps on
  the pipeline side.

### Option C — Rate-agnostic variance proxy (abandon true frequency)

Drop frequency analysis; use a statistic computable at any rate.

- **What it actually measures:** temporal variability of brightness — e.g.
  coefficient of variation, or mean absolute successive difference, over the
  available history. It answers *"is this region's brightness unsteady?"*, not
  *"does it oscillate at 5–10 Hz?"*
- **Fidelity lost — concretely.** It cannot distinguish:
  - flame (5–10 Hz) from a **flapping flag or foliage** (~1–3 Hz) — both
    unsteady, and the flag is a confirmed hard-negative category;
  - flame from **any aliased high-frequency source** sampled at 4 fps;
  - flame from brightness change caused by the **tracker's own box jitter**,
    since the crop region moves between samples.
  It retains only the ability to separate *steady* sources (streetlight, glare)
  from *unsteady* ones. That is a real but much weaker signal, and steady-light
  rejection is partly covered by Phase 1 and Phase 3 already.
- **Cost:** zero — works on existing history.
- **Verdict:** cheapest and honest if labelled as a different check. The risk is
  presenting it as "flicker analysis" when it cannot do what the name implies —
  and Phase 4's thresholds ("flicker-band power ratio") assume a spectrum.

### Option D — Brightness tap on the reader thread *(not one of the three; proposed)*

Compute mean brightness of each active track's bbox on **every natively-read
frame**, in the reader thread, without running the Model. Maintain a per-track
`(monotonic_ts, mean_brightness)` ring buffer and hand it over as
`brightness_series` (gap G5).

- **Trigger:** none needed. It runs continuously for active tracks at a cost low
  enough not to require gating (~15 ms/s across 16 cameras × 3 tracks).
- **Sample rate:** the source's native rate — typically **25–30 fps**, which is
  what Phase 4 asks for. Independent of the inference rate entirely.
- **Does it bypass the Gate?** No. The Gate decides which frames reach the
  *Model*. This adds no Model work and creates no second inference path — the
  frames are already being read and discarded. It is a measurement tap, not a
  processing path.
- **Cost on candidates that never need Flicker:** bounded and tiny; only active
  tracks are sampled, and a track only exists because the Model already found
  something.
- **Fidelity:** full spectral fidelity for the brightness signal, at native
  rate, with real timestamps for the resampling Phase 4 already plans.
- **Limitation — the honest one:** between Model runs the bbox is *stale*. The
  brightness series samples the last known box, so a fast-moving flame drifts
  out of its own box within the window. For flame candidates this is usually
  acceptable (flames are spatially anchored; it is smoke that travels, and
  smoke is out of scope here), but it is a genuine approximation and should be
  validated. Mitigation if needed: mildly enlarge the sampling box, or mark
  samples taken more than N ms after the last box update.
- **Also unresolved by this option:** it provides brightness only. If Phase 4
  later wants per-frame *images* at 30 fps, D does not supply them.

---

## 4. Side-by-side

| | A: Burst | B: Callback | C: Variance proxy | D: Brightness tap |
|---|---|---|---|---|
| Achieves ≥25 Hz sampling | Yes | Yes | N/A | **Yes** |
| True 5–10 Hz discrimination | Yes | Yes | **No** | Yes |
| Extra Model compute | **7.5× during burst** | None | None | **None** |
| Extra memory | None | **~120 MB/camera** | None | ~1 KB/track |
| Keeps one frame-decision point | Yes | **No** | Yes | Yes |
| Works on CPU-only deployment | **No** | Yes | Yes | **Yes** |
| Classifier-side change needed | None | New pull API | Rewrite the check | Consume a new field |
| Fails if bbox is stale | No | No | Partly | **Yes — see D** |

---

## 5. Recommendation, and what I'd want before committing

**D, with C as the degraded fallback when a track has too little history.**

D delivers what Phase 4 declares it needs, at a cost that does not require
gating, without a second frame path, and without hardware-dependent behaviour.
Its weakness — bbox staleness between Model runs — is measurable and bounded,
and matters least for exactly the candidate type Phase 4 targets.

A is defensible if per-frame *images* turn out to be needed at rate. B I'd
argue against on boundary grounds regardless of its flexibility.

**Before committing, I'd want from your teammate:**

1. Confirmation that brightness-only is genuinely sufficient — the Phase
   Reference says so, but it is the load-bearing assumption for D.
2. Whether their Welch implementation wants a **uniform grid** (pipeline
   resamples) or **raw irregular samples** (they resample). The spec says
   "may require resampling" without saying who does it.
3. The minimum sample count Welch needs to return a usable spectrum, so the
   `insufficient_history` boundary is set from their implementation rather than
   guessed here.
4. Whether the fallback in C is wanted at all, or whether
   `insufficient_history` is the preferred answer when rate is inadequate —
   which, given the recall-first default, may well be the safer choice.

**Note on sequencing:** because Phase 4 is log-only from day one, this does not
block anything shipping. It should be settled before Flicker moves out of
log-only, not before it goes in.
