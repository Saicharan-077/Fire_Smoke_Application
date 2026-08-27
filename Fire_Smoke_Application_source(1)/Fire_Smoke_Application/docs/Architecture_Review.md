# FireGuard AI - Architecture Review

## Current State Analysis

The legacy repository was originally designed as a PPE (Personal Protective Equipment) Detection System and underwent a partial migration. The state prior to refactor revealed several architectural anomalies:
1. **Repository Duplication**: The workspace contained nested duplication of frontend and backend applications within a `fireguard-ai/` subdirectory.
2. **Framework Selection**: 
   - **Frontend**: React + Vite + Tailwind CSS.
   - **Backend**: FastAPI + SQLAlchemy (SQLite) + YOLOv8 (ultralytics).
3. **Data Management**: State management on the frontend was fragmented, relying on local React state (`useState`) without a centralized state manager like Zustand or Redux.
4. **WebSocket Architecture**: A basic WebSocket connection manager was present but lacked structured event typing and robust broadcasting mechanisms for scale.
5. **Inference Pipeline**: The YOLOv8 model was tightly coupled with route handlers in some areas, risking redundant model loading and memory leaks.

## Target Architecture

The application will be refactored into a scalable, production-ready SaaS platform:
- **Frontend Architecture**: Strict separation of concerns using React, Zustand for state management, and an isolated API client layer.
- **Backend Architecture**: A modular FastAPI structure with dedicated services for database operations, inference (`inference_service`), and WebSockets (`connection_manager`).
- **Database**: Migrating from SQLite to PostgreSQL, utilizing Alembic for schema migrations.
- **Inference Strategy**: Singleton YOLOv8 model manager with asynchronous inference queues to prevent blocking operations.
