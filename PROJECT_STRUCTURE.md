# Project Structure — FireGuard AI

This document maps out the layout and structural organization of the FireGuard AI enterprise codebase.

```
Fire_Smoke_Application/
├── backend/
│   ├── app/
│   │   ├── ai/
│   │   │   └── inference_service.py # YOLOv8 model loading & strict fire/smoke class verification
│   │   ├── routes/
│   │   │   ├── auth_routes.py       # JWT Login, Register, Forgot Password, and audit loggers
│   │   │   ├── detect_routes.py     # Image, Video, Webcam, and CCTV RTSP connection endpoints
│   │   │   ├── incident_routes.py   # Incident CRUD, status transitions, and PDF exports
│   │   │   ├── profile_routes.py    # User profile, password changes, and audit trail retrievals
│   │   │   └── settings_routes.py   # Global system configuration key-value storage
│   │   ├── services/
│   │   │   ├── alert_service.py     # Alert and event database insertions
│   │   │   └── storage_service.py   # Local image/video storage for threat evidence
│   │   ├── database.py              # SQLite database session and engine setup
│   │   ├── main.py                  # FastAPI application startup, seeding, and routing
│   │   ├── models.py                # SQLAlchemy database models
│   │   └── schemas.py               # Pydantic validation schemas
│   ├── models/
│   │   └── best.pt                  # Pre-trained YOLOv8 fire/smoke weights
│   ├── requirements.txt             # Python dependencies
│   └── fireguard.db                 # SQLite database file (auto-generated)
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Common/              # Reusable UI elements (Card, Button, Input, Modal, Table)
│   │   │   ├── SOC/                 # Security Operations Center widgets (NotificationsHub)
│   │   │   ├── ui/                  # Toast and Theme providers
│   │   │   └── Layout.tsx           # Global sidebar shell with exactly 7 navigation links
│   │   ├── config/
│   │   │   └── appConfig.ts         # Base URLs and WebSocket configuration
│   │   ├── pages/                   # Consolidated 7-page interface
│   │   │   ├── Dashboard.tsx        # KPIs, system health, and recent operations feed
│   │   │   ├── Detection.tsx        # Tabbed image/video uploads, webcam, and RTSP stream tests
│   │   │   ├── LiveMonitoring.tsx   # Live workstation webcam & RTSP CCTV feeds with sirens
│   │   │   ├── AlertsReports.tsx    # Tabbed alert queues, incident tickets, and report downloads
│   │   │   ├── AnalyticsMerged.tsx  # Tabbed metrics charts and paginated historical log tables
│   │   │   ├── SettingsMerged.tsx   # General, AI model, notification, and camera device CRUD settings
│   │   │   ├── ProfileMerged.tsx    # Account info, password change, and audit log list
│   │   │   ├── Landing.tsx          # Public animated product overview landing page
│   │   │   ├── Login.tsx            # Access credentials login
│   │   │   ├── Register.tsx         # Operator registration
│   │   │   ├── ForgotPassword.tsx   # Password recovery
│   │   │   └── [ErrorPages].tsx     # Custom 401, 403, 404, and 500 error pages
│   │   ├── services/
│   │   │   ├── api.ts               # Core API fetch client wrappers
│   │   │   ├── cameraService.ts     # CRUD endpoints for camera devices
│   │   │   └── historyService.ts    # History logs query and CSV/PDF exporters
│   │   ├── store/
│   │   │   └── authStore.ts         # User authentication state
│   │   ├── App.tsx                  # Main router config mapping 7 consolidated routes
│   │   └── index.css                # Global design system styling
│   ├── package.json                 # Node dependencies
│   └── vite.config.ts               # Vite bundler configuration
├── Dockerfile                       # Multi-stage Docker container builder
├── docker-compose.yml               # Multi-container orchestration
├── nginx.conf                       # Reverse proxy configuration
└── README.md                        # Project overview, setup, and specifications
```
