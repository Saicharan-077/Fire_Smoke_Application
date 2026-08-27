# FireGuard AI — Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Browser                           │
│  React 19 + TypeScript + Tailwind + Zustand + Recharts         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST (HTTP) + WebSocket
┌──────────────────────────▼──────────────────────────────────────┐
│                     FastAPI Backend                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Auth     │ │ Routes   │ │ Services │ │ YOLO Inference   │  │
│  │ RBAC     │ │ CRUD     │ │ Analytics│ │ OpenCV           │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         SQLite/       Evidence/    WebSocket
         PostgreSQL    Files        Clients
```

---

## Frontend Flow

1. User visits app → React Router handles public/protected routes
2. `RequireAuth` checks Zustand auth store (persisted token)
3. `RequireRole` enforces RBAC per route
4. `Layout` renders role-filtered sidebar navigation
5. Pages call `services/api.ts` with Bearer token
6. `NotificationsHub` connects WebSocket for live alerts
7. Theme managed via `ThemeContext` + CSS design tokens

---

## Backend Flow

1. Request hits FastAPI middleware (CORS, rate limit, security headers)
2. Route dependency `get_current_user` validates session token
3. Role dependencies (`require_admin`, `require_operator`) enforce RBAC
4. Business logic in route handlers + services
5. SQLAlchemy ORM queries SQLite/PostgreSQL
6. Detection requests invoke `DetectionService` (YOLOv8)
7. New alerts broadcast via WebSocket `ConnectionManager`

---

## Database Schema

```
users ──────────────┐
  id                │
  username          │
  email             │
  role              │
  is_active         │
  session_token     │
                    │
cameras ────────────┤
  id                │
  name, zone        │
  status            │
  stream_url        │
  assigned_operator_id ──► users.id
                    │
alerts ─────────────┤
  id                │
  detection_type    │
  confidence        │
  camera_id ────────► cameras.id
  evidence_path     │
                    │
detection_events ───┤
  alert_id ─────────► alerts.id
  bbox coordinates  │
                    │
incidents ──────────┤
  alert_id ─────────► alerts.id
  severity, status  │
                    │
settings            │
audit_logs          │
system_logs         │
```

---

## YOLO Integration

1. On startup, `DetectionService` loads `backend/models/best.pt`
2. Model classes validated — must contain `fire` and/or `smoke`
3. Image/video bytes decoded via OpenCV
4. YOLO inference with configurable confidence thresholds
5. Non-fire/smoke classes filtered out
6. Annotated evidence saved to `backend/evidence/`
7. Alert + DetectionEvent records created in database
8. WebSocket broadcast to connected SOC clients

---

## WebSocket Flow

```
Client                    Server
  │                         │
  │── WS connect + token ──►│ Validate session
  │◄── connection accepted ─│
  │                         │
  │◄── alert broadcast ─────│ (on new detection)
  │                         │
  │── ping ────────────────►│ Keep-alive
```

---

## Detection Pipeline

```
Upload/Stream → Decode (OpenCV) → YOLOv8 Inference → Filter classes
     → Apply NMS → Draw bounding boxes → Save evidence
     → Create Alert → Create DetectionEvent → WebSocket push
     → Return JSON response to client
```

---

## Authentication Flow

```
Login → Verify password (PBKDF2) → Generate session token (UUID)
     → Store token + expiry in users table
     → Return token to client
     → Client stores in localStorage + Zustand
     → Subsequent requests: Authorization: Bearer <token>
     → Logout: Clear session_token in database
```

---

## Camera Workflow

```
Admin/Operator creates camera → Stored with zone, RTSP URL, status
     → Dashboard shows online/offline counts
     → Live Monitoring selects camera for preview
     → RTSP test via OpenCV VideoCapture
     → Alerts linked to camera_id for SOC feed
```

---

## Alert Workflow

```
Detection triggered → Alert created (status: active)
     → WebSocket push to all connected clients
     → SOC Dashboard updates KPIs
     → Notification sound/popup in browser
     → Operator resolves alert → status: resolved
     → Optional: Create linked incident ticket
```

---

## Incident Workflow

```
Alert detected OR manual creation → Incident ticket
     → Assign severity, reporter, assigned operator
     → Track status (active/resolved)
     → Export PDF for compliance/audit
```

---

## Deployment Architecture

```
                    ┌─────────────┐
   Users ──────────►│   nginx     │
                    │  (reverse   │
                    │   proxy)    │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼                         ▼
     ┌────────────────┐       ┌────────────────┐
     │ Frontend       │       │ Backend        │
     │ (static/Vite)  │       │ (FastAPI/      │
     │ Port 3000      │       │  uvicorn)      │
     └────────────────┘       │ Port 8000      │
                              └───────┬────────┘
                                      ▼
                              ┌────────────────┐
                              │ SQLite /       │
                              │ PostgreSQL     │
                              └────────────────┘
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for production configuration.
