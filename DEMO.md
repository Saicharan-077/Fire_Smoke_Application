# SentinelOS — Demo Guide

Use this guide for college presentations, hackathons, portfolio demos, and client walkthroughs.

---

## Demo Credentials

| Role | Email | Password | Access Level |
|------|-------|----------|--------------|
| **Administrator** | `admin@sentinelos.ai` | `Admin@123` | Full platform + Admin Panel |
| **Operator** | `operator@sentinelos.ai` | `Operator@123` | Detection, monitoring, incidents |
| **Viewer** | `viewer@sentinelos.ai` | `Viewer@123` | Read-only dashboard, reports, analytics |

---

## Presentation Order (Recommended)

### Act 1 — Landing & Login (2 min)
1. Open the landing page — highlight premium UI and value proposition
2. Login as **Administrator**
3. Mention session-based auth and RBAC

### Act 2 — Security Operations Center (3 min)
1. Navigate to **Dashboard**
2. Show live KPIs: fire/smoke counts, cameras online, model accuracy, system health
3. Point out the threat activity timeline chart
4. Show recent alerts feed (WebSocket real-time updates if detection is triggered)

### Act 3 — AI Detection (4 min)
1. Open **Detection** → Image tab
2. Upload a fire/smoke test image
3. Show bounding boxes, confidence scores, evidence saved
4. Switch to Video tab — upload a short clip
5. Briefly show Webcam tab (live browser capture)

### Act 4 — Live Monitoring (2 min)
1. Open **Live Monitoring**
2. Show camera grid layout options (1/2/4/9)
3. Demonstrate webcam feed with detection overlay
4. Test RTSP connection (if stream available)

### Act 5 — Alerts & Incidents (3 min)
1. Open **Alerts & Reports**
2. Show alert queue sorted by severity
3. Resolve an alert
4. Create an incident ticket
5. Export PDF report

### Act 6 — Analytics (2 min)
1. Open **Analytics**
2. Show fire vs smoke charts, trends, camera activity
3. Export CSV/PDF history

### Act 7 — Admin Panel (3 min)
1. Login as Admin (or stay logged in)
2. Open **Admin Panel**
3. Show system health overview
4. Demonstrate user management (create/deactivate user)
5. Show audit logs and active sessions

### Act 8 — RBAC Demo (2 min)
1. Logout, login as **Viewer**
2. Show restricted navigation (no Detection, Live Monitoring, Settings, Admin)
3. Attempt restricted route → Forbidden page
4. Login as **Operator** — show operational access without admin features

---

## Demo Script (Elevator Pitch)

> "SentinelOS transforms any CCTV network into an intelligent fire and smoke detection system. Our custom YOLO26m model analyzes images, videos, and live streams in real time. When a threat is detected, alerts are pushed instantly via WebSocket to the Security Operations Center. Operators can manage incidents, export compliance reports, and monitor camera health — all from a single premium dashboard. Role-based access control ensures admins, operators, and viewers see exactly what they need."

---

## Demo Workflow Checklist

- [ ] Backend running (`uvicorn app.main:app --reload`)
- [ ] Frontend running (`npm run dev`)
- [ ] Model weights at `backend/models/best.pt`
- [ ] Test images prepared (fire/smoke samples)
- [ ] Browser notifications enabled (optional)
- [ ] All three role accounts tested before presentation

---

## Tips for Evaluators

- **College projects**: Emphasize YOLO integration, full-stack architecture, RBAC, and SOC dashboard
- **Hackathons**: Lead with live detection demo — upload image, show instant alert
- **Portfolio**: Screenshot Dashboard, Detection overlay, Admin Panel
- **Startup demo**: Focus on scalability (Docker, PostgreSQL), multi-camera support, incident workflow
