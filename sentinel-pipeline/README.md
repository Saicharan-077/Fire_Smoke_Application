# SentinelOS Detection Pipeline

Standalone fire/smoke detection service. **Gate → Model → Classifier → Context Engine.**

Self-contained: its own process, its own database, its own evidence storage, and
one versioned HTTP/WebSocket API. It has no dependency on the Dashboard's
database, models, or routes, and can be pointed at any dashboard or camera
system.

---

## Quick start

```bash
python -m venv .venv && ./.venv/bin/pip install -r requirements.txt
```

```bash
./.venv/bin/python -m uvicorn sentinel_pipeline.api.app:app --port 8100
```

Weights live at `models/best.pt` (override with `PIPELINE_MODEL_PATH`).

---

## Boundary rules

**Inside this package** — Gate, Model, tracking, Classifier, Context Engine,
calibration, scheduler, zone/alert/evidence storage. All private.

**Outside** — the Dashboard consumes `/v1/...` only. It must never import
pipeline internals or read these tables directly.

**Explicitly NOT here** — alert lifecycle and UI concerns: PIN-gated
resolution, escalation flags, operator notes, report formatting. Those are
Dashboard responsibilities, keyed by the alert IDs this pipeline issues. If a
feature doesn't need Gate/Model/Classifier/Context Engine to do its job, it
doesn't belong in this package.

---

## API

| Endpoint | Purpose |
|---|---|
| `POST /v1/cameras` | Register a camera → `camera_id` |
| `GET /v1/cameras` | List cameras |
| `DELETE /v1/cameras/{id}` | Deregister |
| `GET /v1/cameras/{id}/gate` | Real Gate telemetry (404 if no state — never fabricated) |
| `POST /v1/cameras/{id}/calibrate/start` | Begin observation window |
| `GET /v1/cameras/{id}/calibrate/suggestion` | Auto-suggested polygon + adjacency |
| `POST /v1/cameras/{id}/zone` | One-click human approval of a zone |
| `GET /v1/zones` | List zones |
| `POST /v1/detect/frame` | Submit one image |
| `POST /v1/detect/video` | Submit a video → `job_id` |
| `GET /v1/jobs/{id}` | Poll a video job |
| `POST /v1/cameras/{id}/stream/start` | Start a live source |
| `GET /v1/cameras/{id}/stream/metrics` | `stream_fps` vs `inference_fps`, separately |
| `GET /v1/cameras/{id}/stream/mjpeg` | Display feed (never blocked by inference) |
| `WS /v1/stream/{camera_id}` | Live detection results |
| `GET /v1/alerts`, `GET /v1/alerts/{id}` | Alert retrieval |
| `GET /v1/incidents` | Correlated multi-camera incidents |
| `GET /v1/evidence/{filename}` | Evidence image |
| `GET /v1/health` | Status, incl. `alerts_missing_evidence` and `classifier_is_stub` |
| `GET /v1/model/info` | **Live** model identity — never hardcode a model name |
| `GET /v1/contract` | Model→Classifier contract version and fields |

---

## Design guarantees

**One Gate, no parallel frame-skipping.** The existing application had eight
separate motion-filter implementations. `Gate.process_frame` is the only place
in this pipeline that decides to skip a frame.

**Steady fire is never invisible.** A forced-override timer fires on its own
schedule regardless of motion score or state, at an interval derived from zone
risk tier (high 7s / medium 25s / low 60s / uncalibrated 17s).

**Evidence is guaranteed centrally.** `AlertStore.create` takes `evidence_ref`
as a required keyword-only argument, validates the file exists, and the column
is `NOT NULL`. No entry point can write an alert without evidence.

**Display is decoupled from inference.** Single-slot drop-oldest frame buffer,
separate reader and inference threads, `stream_fps` and `inference_fps`
reported independently.

**Nothing is fabricated.** Telemetry endpoints 404 rather than invent values.

---

## Configuration

Environment variables, read once at import — never from a database on a hot
path. See `sentinel_pipeline/config.py`. Notable:

| Variable | Default | Meaning |
|---|---|---|
| `PIPELINE_PORT` | `8100` | API port |
| `PIPELINE_MODEL_PATH` | `models/best.pt` | Weights |
| `PIPELINE_DEVICE` | `auto` | `auto` \| `cuda` \| `cpu` |
| `PIPELINE_CONF_THRESHOLD` | `0.20` | Recall-focused detector floor |
| `GATE_FORCE_HIGH` / `_MEDIUM` / `_LOW` / `_UNCAL` | `7` / `25` / `60` / `17` | Forced-override seconds |
| `TRACK_HISTORY_LENGTH` | `60` | Crop history depth for Flicker |
| `PIPELINE_DATABASE_URL` | `sqlite:///data/pipeline.db` | Pipeline's own DB |

---

## Tests

```bash
./.venv/bin/python tests/test_gate_validation.py
```

```bash
./.venv/bin/python tests/test_pipeline_core.py
```

```bash
./.venv/bin/python tests/test_api_integration.py http://127.0.0.1:8100
```

---

## Current status

The Classifier is a **temporary stub** (`classifier/stub.py`) — a heuristic
placeholder, not the two-tier design. The pipeline warns at startup and reports
`classifier_is_stub: true`. Replace via `Pipeline(classifier=...)`; see
[docs/MODEL_CLASSIFIER_CONTRACT.md](docs/MODEL_CLASSIFIER_CONTRACT.md).

Model training requirements: [docs/MODEL_TRAINING_REQUIREMENTS.md](docs/MODEL_TRAINING_REQUIREMENTS.md).
