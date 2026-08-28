# SentinelOS — Project Structure

Complete reference for every folder and major module in the repository.

---

## Root Directory

| File / Folder | Purpose |
|---------------|---------|
| `README.md` | Project overview and documentation index |
| `SETUP.md` | Step-by-step installation guide |
| `DEMO.md` | Demo credentials and presentation script |
| `API.md` | REST API endpoint reference |
| `ARCHITECTURE.md` | System architecture and data flows |
| `MODULES.md` | Feature module documentation |
| `TROUBLESHOOTING.md` | Common issues and fixes |
| `CHANGELOG.md` | Version history |
| `DEPLOYMENT.md` | Production deployment guide |
| `docker-compose.yml` | Multi-container orchestration |
| `.env.example` | Root environment template |
| `LICENSE` | MIT license |

---

## `backend/` — Python API Server

### `backend/app/`

| Path | Purpose |
|------|---------|
| `main.py` | FastAPI app entry, router registration, WebSocket, analytics, seeding |
| `database.py` | SQLAlchemy engine, session factory, `get_db` dependency |
| `models.py` | ORM models: User, Camera, Alert, DetectionEvent, Incident, Setting, AuditLog, SystemLog |
| `schemas.py` | Pydantic request/response schemas |

### `backend/app/ai/`

| Path | Purpose |
|------|---------|
| `inference_service.py` | YOLOv8 model loading, inference, class validation, NMS |

### `backend/app/middleware/`

| Path | Purpose |
|------|---------|
| `security.py` | Security headers middleware |
| `rate_limit.py` | Request rate limiting |

### `backend/app/routes/`

| Path | Purpose |
|------|---------|
| `auth_routes.py` | Login, register, logout, password, RBAC helpers |
| `admin_routes.py` | User management, logs, sessions, system health |
| `upload_routes.py` | Image/video upload and YOLO inference |
| `detect_routes.py` | Detection aliases, live metadata, CCTV test |
| `alert_routes.py` | Alert CRUD and status updates |
| `incident_routes.py` | Incident CRUD and PDF export |
| `camera_routes.py` | Camera CRUD, status, zone, activity |
| `dashboard_routes.py` | SOC stats, analytics, events |
| `history_routes.py` | Historical logs, CSV/PDF export |
| `settings_routes.py` | System settings read/update |
| `profile_routes.py` | Profile update, audit logs |

### `backend/app/services/`

| Path | Purpose |
|------|---------|
| `alert_service.py` | Alert and detection event creation |
| `analytics_service.py` | Timeline, zones, trends, breakdowns |
| `storage_service.py` | Evidence file storage |

### `backend/app/websocket/`

| Path | Purpose |
|------|---------|
| `connection_manager.py` | WebSocket client management and broadcast |

### Other Backend Files

| Path | Purpose |
|------|---------|
| `models/best.pt` | YOLOv8 trained weights |
| `evidence/` | Runtime annotated detection images |
| `sentinelos.db` | SQLite database (auto-generated) |
| `alembic/` | Database migrations |
| `tests/` | pytest test suite |
| `requirements.txt` | Python dependencies |
| `Dockerfile` | Backend container image |

---

## `frontend/` — React SPA

### `frontend/src/pages/`

| Page | Route | Purpose |
|------|-------|---------|
| `Landing.tsx` | `/` | Marketing landing page |
| `Login.tsx` | `/login` | Authentication |
| `Register.tsx` | `/register` | User registration |
| `ForgotPassword.tsx` | `/forgot-password` | Password reset request |
| `Dashboard.tsx` | `/dashboard` | SOC command center |
| `Detection.tsx` | `/detection` | AI detection (image/video/webcam/RTSP) |
| `LiveMonitoring.tsx` | `/live-monitoring` | Live camera matrix |
| `AlertsReports.tsx` | `/alerts-reports` | Alerts, incidents, reports |
| `AnalyticsMerged.tsx` | `/analytics` | Charts and historical logs |
| `SettingsMerged.tsx` | `/settings` | System and camera settings |
| `ProfileMerged.tsx` | `/profile` | User profile and password |
| `AdminPanel.tsx` | `/admin` | Admin control center |
| `Unauthorized.tsx` | `/unauthorized` | 401 error page |
| `Forbidden.tsx` | `/forbidden` | 403 error page |
| `NotFound.tsx` | `*` | 404 error page |
| `ServerError.tsx` | `/server-error` | 500 error page |

### `frontend/src/components/`

| Path | Purpose |
|------|---------|
| `Layout.tsx` | App shell: sidebar, header, notifications, theme toggle |
| `RequireRole.tsx` | RBAC route guard component |
| `Common/Button.tsx` | Button with variants and loading state |
| `Common/Card.tsx` | Card, CardHeader, CardTitle, CardContent |
| `Common/Input.tsx` | Input and Select form controls |
| `Common/Modal.tsx` | Dialog/modal overlay |
| `Common/Table.tsx` | Data table component |
| `Common/Badge.tsx` | Status badges |
| `Common/Drawer.tsx` | Slide-out drawer |
| `Common/ErrorBoundary.tsx` | React error boundary |
| `SOC/NotificationsHub.tsx` | WebSocket alert listener |
| `SOC/InstantAlertPopup.tsx` | Alert popup overlay |
| `SOC/AlertSound.tsx` | Alert audio notification |
| `ui/Toast.tsx` | Toast notification provider |
| `ui/EvidenceViewer.tsx` | Evidence image viewer |

### `frontend/src/store/`

| Store | Purpose |
|-------|---------|
| `authStore.ts` | Authentication state (user, token) |
| `dashboardStore.ts` | Dashboard metrics and recent alerts |
| `notificationsStore.ts` | Notification history and unread count |
| `appSettingsStore.ts` | Theme and app preferences |
| `camerasStore.ts` | Camera list state |
| `incidentStore.ts` | Incident management state |
| `liveMonitoringStore.ts` | Live monitoring state |

### `frontend/src/services/`

| Service | Purpose |
|---------|---------|
| `api.ts` | Main REST API client (all endpoints) |
| `cameraService.ts` | Camera CRUD operations |
| `historyService.ts` | History export operations |

### `frontend/src/hooks/`

| Hook | Purpose |
|------|---------|
| `usePermissions.ts` | RBAC permission checks |

### `frontend/src/utils/`

| File | Purpose |
|------|---------|
| `permissions.ts` | Role definitions, permission maps, nav items |

### `frontend/src/config/`

| File | Purpose |
|------|---------|
| `appConfig.ts` | API base URL, WebSocket URL |
| `endpoints.ts` | Endpoint path constants |

### `frontend/src/context/`

| Context | Purpose |
|---------|---------|
| `ThemeContext.tsx` | Light/dark theme provider |

### Other Frontend Files

| Path | Purpose |
|------|---------|
| `App.tsx` | Router configuration and lazy loading |
| `main.tsx` | React entry point |
| `index.css` | Tailwind + design tokens |
| `tailwind.config.js` | Tailwind configuration |
| `vite.config.ts` | Vite build configuration |
| `nginx.conf` | Production nginx config |
| `Dockerfile` | Frontend container image |

---

## `docs/` — Internal Documentation

| Path | Purpose |
|------|---------|
| `architecture/` | Phase 1 architecture reports and API map |
| `Architecture_Review.md` | Architecture review notes |
| `Migration_Plan.md` | Database migration plan |
| `Refactor_Strategy.md` | Refactoring strategy |
| `Weakness_Report.md` | Technical debt report |

---

## Data Flow Summary

```
Pages → services/api.ts → FastAPI routes → services/ → models.py → Database
                                              ↓
                                         YOLO inference → evidence/
                                              ↓
                                    WebSocket → NotificationsHub → UI
```
