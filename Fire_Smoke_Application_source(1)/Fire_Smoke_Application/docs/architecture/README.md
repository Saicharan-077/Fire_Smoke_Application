# FireGuard AI — Architecture Report (Phase 1)

> This document captures the **current** architecture after Phase 1 analysis and provides the **target-state blueprint** for the “FireGuard AI” transformation.

## 1. Current repository (as analyzed)

### 1.1 Backend (FastAPI)
**Entry point**: `backend/app/main.py`

Key behaviors:
- Loads YOLOv8 model once at startup via `DetectionService()` in FastAPI `lifespan()`.
- Exposes API under `/api/v1/*`.
- Hosts evidence images at `/evidence/*` via `StaticFiles`.
- WebSocket endpoint: `/ws/alerts` with a simple in-memory connection manager.

**Detection / inference**: `backend/app/ai/pipeline.py`
- `DetectionService` loads `models/best.pt` using `ultralytics.YOLO`.
- Device selection: CUDA if available else CPU.
- Frame inference:
  - Runs YOLO with `conf=0.10` then applies per-class thresholding:
    - fire: `CONF_FIRE` (default 0.15)
    - smoke: `CONF_SMOKE` (default 0.25)
- Maps YOLO class names into `fire` and `smoke`.
- Video inference confirms detections after `consecutive=3` frames.

**Upload + alert creation**: `backend/app/routes/upload_routes.py`
- `POST /api/v1/upload/image`
- `POST /api/v1/upload/video`
- Saves:
  - Original + annotated evidence images
- Creates:
  - `alerts` (one per class best-confidence per upload)
  - `detection_events` (stores every accepted bounding box)
- WebSocket broadcast on new alert:
  - payload includes `{event:'new_alert', alert_id, type, confidence, camera_id, location}`

**Routing modules**:
- `backend/app/routes/alert_routes.py` (list/patch/get/delete alerts + events)
- `backend/app/routes/dashboard_routes.py` (dashboard stats + analytics endpoints)
- `backend/app/routes/camera_routes.py` (camera CRUD + activity)

**Analytics**: `backend/app/services/analytics_service.py`
- Timeline aggregation by hour (24h) or day (7d/30d)
- Zone aggregation by `Alert.location`
- Weekly trend using day-of-week aggregation
- Camera activity uses `Alert.camera_id` aggregation

**Persistence layer**: `backend/app/database.py` + `backend/app/models.py`
- DB: SQLite by default; Postgres enabled via `POSTGRES_URL`.
- Tables:
  - `cameras`
  - `alerts`
  - `detection_events`

### 1.2 Frontend (React + TS)
**Canonical frontend (currently inspected)**: `fireguard-ai/frontend/src/`

Observations:
- Dashboard:
  - Uses `getDashboardStats()` and `getDashboardAnalytics()`
  - Refetches dashboard on WebSocket event (potential performance concern)
  - Charts in `Dashboard.tsx` still include mock arrays.
- Live feed:
  - Uses WebSocket messages (`new_alert`) to show overlay per “camera id”.
  - Uses mock camera data and unsafely default camera mapping when WS payload lacks camera id.
- API client: `fireguard-ai/frontend/src/services/api.ts`
  - Provides REST calls + `connectAlertSocket()` helper.

### 1.3 Duplication/misalignment
The repo contains duplicate trees (e.g. `src/` and `fireguard-ai/`), meaning the transformation must start with **consolidation** to avoid partial migrations.

---

## 2. Target-state blueprint (your requested production design)

### 2.1 Final folder structure (target)
```
root/
├── frontend/
├── backend/
├── deployment/
├── docs/
└── README.md
```

Within:
- `frontend/src/`: `app/`, `pages/`, `components/`, `services/`, `api/`, `store/`, `context/`, `types/`, `utils/`, `assets/`
- `backend/app/`: `api/`, `services/`, `models/`, `schemas/`, `database/`, `websocket/`, `middleware/`, `config/`, `utils/`

### 2.2 API standardization goals
- Consistent endpoints:
  - `/api/v1/dashboard`
  - `/api/v1/incidents`
  - `/api/v1/history`
  - `/api/v1/analytics`
  - `/api/v1/cameras`
  - `/api/v1/uploads`
- Standard response envelope for success and errors.
- Validation:
  - request schemas using Pydantic
  - upload constraints enforced centrally
- Pagination:
  - all list endpoints accept page/limit (or cursor-based pagination)

### 2.3 WebSockets goals
- Event-driven model (no full dashboard refetch per alert).
- Throttling / batching of WS events.
- Typed event schema.

---

## 3. Architectural diagram (text)

### 3.1 Components
```
[Frontend]
   | REST (/api/v1/*) --------------------->
   | WS  (/ws/alerts, /ws/stream-events) --> [Backend FastAPI]

[Backend FastAPI]
   | calls
   v
[Services]
  - inference_service (YOLO)
  - alert_service (incidents)
  - evidence_service (storage)
  - analytics_service
  - websocket_service

   | reads/writes
   v
[Database: PostgreSQL]
  - cameras
  - incidents (alerts)
  - detection_events
  - evidence
```

---

## 4. DB documentation (current schema + target evolutions)

### 4.1 Current tables
- `cameras`: metadata + status
- `alerts`: incident summary (fire/smoke) with status
- `detection_events`: bounding box-level details mapped to an alert

### 4.2 Target additions
Your request specifies:
- `incidents`
- `detection_events`
- `evidence`
- `cameras`
- `zones`

Plan:
- Introduce `zones` with foreign keys from cameras.
- Split evidence from alert/event tables.
- Add constraints and foreign keys for referential integrity.
- Add indexes for time-range queries used by analytics and history.

---

## 5. Known technical debt / risks
- Model + thresholds exist but modular boundaries are not fully aligned with target structure.
- SQLite default may not be acceptable for production: migration + Postgres-first.
- Dashboard refetch on every WS event may cause performance degradation.
- Frontend still contains mock data and incomplete SaaS-grade UX patterns.
- Duplicate directory trees create migration risk.

---

## 6. Next actions (from TODO.md)
- Complete Phase 1 deliverable by finishing this report series (API map + DB diagrams).
- Proceed with Phase 2 consolidation and then backend/frontend rebuild.

