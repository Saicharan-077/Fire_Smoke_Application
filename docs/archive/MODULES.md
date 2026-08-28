# SentinelOS — Module Documentation

Detailed explanation of each application module.

---

## Authentication

**Backend:** `backend/app/routes/auth_routes.py`  
**Frontend:** `frontend/src/pages/Login.tsx`, `Register.tsx`, `ForgotPassword.tsx`

- Session-token based authentication (Bearer token in Authorization header)
- Login, register, logout, change password, forgot password
- Public registration creates **viewer** accounts only
- Deactivated users cannot login
- Audit logging on all auth events

---

## Dashboard (SOC)

**Backend:** `backend/app/routes/dashboard_routes.py`  
**Frontend:** `frontend/src/pages/Dashboard.tsx`

Security Operations Center command center:
- Real-time KPIs (alerts, cameras, model accuracy, system health)
- Threat activity timeline (24h chart)
- Recent alerts feed (merged with WebSocket updates)
- Recent incidents summary
- Quick action links to detection, monitoring, reports

---

## Detection

**Backend:** `backend/app/routes/upload_routes.py`, `detect_routes.py`, `ai/inference_service.py`  
**Frontend:** `frontend/src/pages/Detection.tsx`

- **Image upload:** YOLOv8 inference, bounding boxes, evidence storage, alert creation
- **Video upload:** Frame-by-frame processing with progress
- **Webcam:** Client-side capture with simulated/real-time overlay
- **RTSP/CCTV:** Stream connectivity test via OpenCV
- Requires **operator** or **administrator** role

---

## Live Monitoring

**Backend:** WebSocket alerts, camera routes  
**Frontend:** `frontend/src/pages/LiveMonitoring.tsx`

- Multi-camera grid (1, 2, 4, 9 layouts)
- Webcam live feed with detection overlay
- RTSP stream preview and status
- FPS, latency, confidence display
- Alert sound and popup integration
- Requires **operator** or **administrator** role

---

## Camera Management

**Backend:** `backend/app/routes/camera_routes.py`  
**Frontend:** `frontend/src/pages/SettingsMerged.tsx` (Cameras tab)

- CRUD operations for cameras
- Status: online, offline, maintenance
- Zone assignment, RTSP URL, operator assignment
- Camera activity history
- Mutations require **operator** or **administrator** role

---

## Alerts

**Backend:** `backend/app/routes/alert_routes.py`  
**Frontend:** `frontend/src/pages/AlertsReports.tsx`

- Paginated alert list with search and filters
- Status updates (active/resolved)
- Evidence viewer
- WebSocket push on new detections
- Status changes require **operator** role

---

## Incidents

**Backend:** `backend/app/routes/incident_routes.py`  
**Frontend:** `frontend/src/pages/AlertsReports.tsx`

- Incident ticket CRUD
- Severity levels: critical, high, medium, low
- Link to source alert
- Assignment and notes
- PDF export
- Mutations require **operator** role

---

## Reports & Analytics

**Backend:** `dashboard_routes.py`, `history_routes.py`, analytics endpoints in `main.py`  
**Frontend:** `AnalyticsMerged.tsx`, `AlertsReports.tsx`

- Fire vs smoke distribution charts
- Incident trends, alert frequency, severity distribution
- Camera activity rankings
- CSV and PDF export of detection history
- Available to all authenticated roles (viewer read-only)

---

## Settings

**Backend:** `backend/app/routes/settings_routes.py`  
**Frontend:** `frontend/src/pages/SettingsMerged.tsx`

- General system configuration
- AI model thresholds (fire/smoke confidence)
- Notification preferences
- Camera management
- Theme and appearance
- PATCH requires **administrator** role; GET available to operators

---

## Notifications

**Backend:** `backend/app/websocket/connection_manager.py`  
**Frontend:** `frontend/src/components/SOC/`

- WebSocket channel at `/ws/alerts`
- Real-time alert broadcasts
- Browser notifications, sound alerts, popup overlays
- Notification history in header dropdown

---

## Profile

**Backend:** `backend/app/routes/profile_routes.py`  
**Frontend:** `frontend/src/pages/ProfileMerged.tsx`

- View/edit username and email
- Change password
- View personal audit logs
- Role displayed (read-only)

---

## Evidence

**Backend:** `backend/app/services/storage_service.py`, static `/evidence` mount  
**Frontend:** `frontend/src/components/ui/EvidenceViewer.tsx`

- Annotated detection images stored on disk
- Authenticated access via `/api/v1/evidence/{filename}`
- Linked from alerts and detection results

---

## Admin Panel

**Backend:** `backend/app/routes/admin_routes.py`  
**Frontend:** `frontend/src/pages/AdminPanel.tsx`

- User management (create, edit, delete, activate, deactivate, reset password)
- Audit log viewer
- System log viewer
- Active session management and revocation
- System health and platform statistics
- Requires **administrator** role

---

## RBAC (Role-Based Access Control)

**Frontend:** `frontend/src/utils/permissions.ts`, `frontend/src/components/RequireRole.tsx`  
**Backend:** `require_admin`, `require_operator` in `auth_routes.py`

| Role | Permissions |
|------|-------------|
| Administrator | Full access including admin panel and settings write |
| Operator | Detection, monitoring, camera/incident/alert management |
| Viewer | Dashboard, alerts/reports (read-only), analytics, profile |
