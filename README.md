# SentinelOS — Enterprise Fire & Smoke Detection Platform

<p align="center">
  <strong>AI-Powered Real-Time Fire & Smoke Detection for Enterprise Security Operations</strong>
</p>

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-red.svg" />
  <img alt="Python" src="https://img.shields.io/badge/python-3.10+-blue.svg" />
  <img alt="React" src="https://img.shields.io/badge/react-19-61DAFB.svg" />
  <img alt="FastAPI" src="https://img.shields.io/badge/fastapi-0.100+-009688.svg" />
  <img alt="YOLO26m" src="https://img.shields.io/badge/YOLO26m-ultralytics-purple.svg" />
</p>

> 📖 **Comprehensive End-to-End System Documentation**: For complete production architectural specifications, mathematical evidence fusion matrices, common platform integration contracts, and multi-use-case workflows, see [**FIRE_SMOKE_SYSTEM_DOCUMENTATION.md**](docs/FIRE_SMOKE_SYSTEM_DOCUMENTATION.md).

---

## Project Overview

SentinelOS is a premium, full-stack AI surveillance platform that transforms standard CCTV networks into intelligent fire and smoke detection systems. Built with a custom-trained **YOLO26m** model, it delivers real-time threat detection, a Security Operations Center (SOC) dashboard, incident management, and role-based access control — suitable for college projects, hackathons, portfolio showcases, startup demos, and client presentations.

---

## Problem Statement

Traditional surveillance systems rely on human operators to visually monitor dozens of camera feeds 24/7. Fire and smoke events are often detected too late, leading to property damage, injuries, and fatalities. Existing solutions are expensive, require proprietary hardware, and lack integrated incident workflows.

---

## Solution

SentinelOS overlays computer vision intelligence onto existing camera infrastructure:

- **Automated detection** of fire and smoke using YOLO26m
- **Real-time SOC dashboard** with KPIs, timelines, and alert feeds
- **Multi-source input**: images, videos, webcams, RTSP/IP cameras
- **Incident workflow** with severity tracking, assignment, and PDF export
- **Role-based access** for administrators, operators, and viewers
- **Admin control panel** for user management, logs, and system health

---

## Features

| Module | Capabilities |
|--------|-------------|
| **Dashboard (SOC)** | Live KPIs, threat timeline, recent alerts, incident summary, system health |
| **Detection** | Image/video upload, webcam capture, RTSP testing with YOLO inference |
| **Live Monitoring** | Multi-camera grid (1/2/4/9), detection overlay, alert sounds |
| **Alerts & Reports** | Alert queue, incident tickets, PDF/CSV export |
| **Analytics** | Fire/smoke charts, trends, camera activity, historical logs |
| **Settings** | Camera CRUD, AI thresholds, notifications, appearance |
| **Admin Panel** | User management, audit logs, system logs, sessions, health |
| **Profile** | Account settings, password change, audit history |
| **RBAC** | Administrator, Operator, Viewer roles with route + API protection |

---

## Technology Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand, Recharts, Framer Motion, Lucide |
| **Backend** | FastAPI, Python 3.10+, SQLAlchemy 2, Pydantic 2, Alembic |
| **AI/CV** | Ultralytics YOLO26m, OpenCV, custom `best.pt` weights |
| **Database** | SQLite (dev) / PostgreSQL (production) |
| **Real-time** | WebSocket (`/ws/alerts`) |
| **Reports** | ReportLab (PDF) |
| **DevOps** | Docker, docker-compose, nginx |

---

## AI Model Information

- **Architecture:** YOLO26m (Ultralytics)
- **Classes:** `fire`, `smoke` (strict validation — COCO models rejected)
- **Weights:** `backend/models/best.pt`
- **Thresholds:** Fire ≥ 0.35, Smoke ≥ 0.40 (configurable in Settings)
- **Pipeline:** Upload → OpenCV decode → YOLO inference → NMS → Evidence save → Alert create → WebSocket push

---

## Folder Structure

```
Fire_Smoke_Application/
├── backend/                 # FastAPI API server
│   ├── app/
│   │   ├── ai/              # YOLO inference service
│   │   ├── middleware/      # Security, rate limiting
│   │   ├── routes/          # REST API endpoints
│   │   ├── services/        # Business logic
│   │   └── websocket/       # Real-time alert manager
│   ├── models/              # YOLO weights (best.pt)
│   └── tests/
├── frontend/                # React SPA
│   └── src/
│       ├── components/      # UI components + Layout
│       ├── pages/           # Route pages
│       ├── hooks/           # Custom React hooks
│       ├── store/           # Zustand state
│       ├── services/        # API clients
│       └── utils/           # Permissions, helpers
├── docs/                    # Architecture reviews
├── SETUP.md                 # Installation guide
├── DEMO.md                  # Demo credentials & script
├── API.md                   # API reference
├── ARCHITECTURE.md          # System architecture
├── MODULES.md               # Module documentation
├── PROJECT_STRUCTURE.md     # Detailed folder map
└── TROUBLESHOOTING.md       # Common issues
```

See [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) for complete folder documentation.

---

## Architecture Diagram

```
Browser (React) ──REST/WS──► FastAPI ──► YOLO26m + OpenCV
                                │
                                ├── SQLite / PostgreSQL
                                └── Evidence Files
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed flow diagrams.

---

## Application Flow

1. User authenticates → session token issued
2. RBAC filters navigation and API access by role
3. Operator uploads image/video → YOLO detects fire/smoke
4. Alert created → WebSocket pushes to SOC dashboard
5. Operator resolves alert or creates incident ticket
6. Admin manages users, views logs, monitors system health

---

## Database Structure

| Table | Purpose |
|-------|---------|
| `users` | Accounts, roles, sessions |
| `cameras` | CCTV registry with zones and status |
| `alerts` | Detection alerts with evidence |
| `detection_events` | Individual bounding box events |
| `incidents` | Incident tickets linked to alerts |
| `settings` | Key-value configuration |
| `audit_logs` | User action audit trail |
| `system_logs` | Application system logs |

---

## Authentication Flow

Session-token based (not JWT). Login generates a UUID token stored in the database with expiry. All API requests include `Authorization: Bearer <token>`. Logout clears the session.

---

## Role Management & RBAC

| Role | Access |
|------|--------|
| **Administrator** | Full access + Admin Panel + settings write |
| **Operator** | Detection, monitoring, cameras, alerts, incidents |
| **Viewer** | Dashboard, alerts/reports (read-only), analytics, profile |

Enforced on both frontend (route guards, navigation) and backend (API dependencies).

---

## Quick Start

```bash
# Backend
cd backend && python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm install && npm run dev
```

See [SETUP.md](SETUP.md) for complete instructions.

---

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Administrator | `admin@sentinelos.ai` | `Admin@123` |
| Operator | `operator@sentinelos.ai` | `Operator@123` |
| Viewer | `viewer@sentinelos.ai` | `Viewer@123` |

See [DEMO.md](DEMO.md) for presentation script.

---

## Documentation Index

| Document | Description |
|----------|-------------|
| [SETUP.md](SETUP.md) | Installation and environment setup |
| [DEMO.md](DEMO.md) | Demo credentials and presentation guide |
| [API.md](API.md) | Complete API endpoint reference |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture and data flows |
| [MODULES.md](MODULES.md) | Module-by-module documentation |
| [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) | Folder and file reference |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common errors and solutions |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production deployment |

---

## License

MIT License — see [LICENSE](LICENSE).
