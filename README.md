# FireGuard AI — Enterprise Fire & Smoke Detection Platform

<p align="center">
  <strong>🔥 AI-Powered Real-Time Fire & Smoke Detection for Enterprise Security Operations</strong>
</p>

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-red.svg" />
  <img alt="Python" src="https://img.shields.io/badge/python-3.10+-blue.svg" />
  <img alt="React" src="https://img.shields.io/badge/react-18+-61DAFB.svg" />
  <img alt="FastAPI" src="https://img.shields.io/badge/fastapi-0.100+-009688.svg" />
  <img alt="YOLOv8" src="https://img.shields.io/badge/YOLOv8-ultralytics-purple.svg" />
</p>

---

## Overview

FireGuard AI is a full-stack, enterprise-grade web application that transforms standard CCTV surveillance networks into intelligent fire and smoke detection systems. It uses a custom-trained **YOLOv8** computer vision model to identify flame and smoke threats in real time from images, videos, webcam feeds, and RTSP camera streams.

---

## Key Features & Consolidated Pages

The application has been refactored into exactly **7 core pages** in the sidebar:

1. **Dashboard** — Centralized Security Operations Center (SOC) containing:
   - Key Performance Indicators (KPIs): active threats, cameras online, model accuracy.
   - Recent Activity logs feed.
   - Live system health status.
2. **Detection** — Consolidated tabbed interface for:
   - **Image**: Upload, preview, detect, and download annotated results.
   - **Video**: Upload, frame-by-frame progress, and download processed clips.
   - **Webcam**: Start, stop, pause, and resume browser webcam streams with live bounding boxes.
   - **RTSP**: Connect, disconnect, and test live RTSP stream connections.
3. **Live Monitoring** — Real-time security matrix:
   - Embeds live webcam and RTSP camera feeds side-by-side.
   - Displays current detection classes, confidence rates, latency, and FPS.
   - Real-time warning alert sirens.
4. **Alerts & Reports** — Consolidated threat management:
   - **Live Alerts**: Queue sorted by priority (Fire > Smoke > Confidence) with quick resolve buttons.
   - **Incident History**: Searchable, filterable incident tickets with severity levels.
   - **Reports**: Quick triggers to export certified PDF and CSV reports.
5. **Analytics** — Data-driven operational charts:
   - Timelines of fire vs. smoke incidents.
   - Weekly/monthly trend lines, detection sources distribution, and model accuracy.
   - Paginated historical logs table with advanced filters and exports.
6. **Settings** — Infrastructure and configuration:
   - General system modes.
   - Camera Management CRUD (add, edit, delete, enable/disable camera streams).
   - AI Model thresholds (adjust confidence sliders for fire and smoke classes).
   - Notification dispatch and theme settings.
7. **Profile** — Account management:
   - Edit user profile details.
   - Change account password.
   - Retrieve security audit logs.

---

## Strict YOLOv8 Model Validation

To ensure high reliability and zero false positives from unrelated classes, the backend implements strict validation:
* **Model Class Check**: At startup, the model's classes (`model.names`) are verified. The model must contain `fire` and/or `smoke` classes. COCO or other generic models are rejected with an error: `"Invalid Fire/Smoke model selected. Do NOT use COCO pretrained model."`
* **Filtering**: Bounding boxes are only drawn for exact matches of `fire` and `smoke` classes.
* **Confidence Tuning**: High default confidence thresholds (Fire >= 0.35, Smoke >= 0.40) and Non-Maximum Suppression (NMS) are applied.

---

## Tech Stack

### Frontend
- **React 18** + **TypeScript** — Component framework
- **Vite** — Build tooling
- **TailwindCSS** — Utility-first styling
- **Framer Motion** — Smooth animations
- **React Router v6** — Client-side routing
- **Zustand** — State management
- **Recharts** — Data visualization

### Backend
- **FastAPI** — Async REST API framework
- **Python 3.10+** — Runtime
- **SQLAlchemy** + **SQLite** — ORM & database
- **Ultralytics YOLOv8** — Computer vision model
- **OpenCV** — Image/video processing
- **ReportLab** — PDF report generation

---

## Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+

### 1. Backend Setup
```bash
cd backend
python -m venv .venv
# Activate virtualenv:
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

### 3. Demo Credentials
| Role | Email | Password |
|---|---|---|
| Administrator | `admin@fireguard.ai` | `Admin@123` |
| Operator | `operator@fireguard.ai` | `Operator@123` |
| Viewer | `viewer@fireguard.ai` | `Viewer@123` |

---

## License
This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
