# FireGuard AI - Refactor Strategy

## Technical Modifications

### Frontend Strategy
- **Zustand Adoption**: Replace decentralized `useState` with strict Zustand stores (`dashboardStore`, `incidentStore`, `monitoringStore`, etc.).
- **Component Reusability**: Extract buttons, inputs, tables, and dialogs into a centralized `/components/Common` directory, styling them cohesively with Tailwind CSS tokens.
- **WebSocket Client**: Implement a robust React context or Zustand store to manage the WebSocket connection, auto-reconnect, and global state hydration upon incoming alert events.

### Backend Strategy
- **Model Singleton**: Implement an `inference_service` class that loads the YOLOv8 model once during application startup using FastAPI's `@asynccontextmanager` lifespan event.
- **Asynchronous Processing**: Refactor `/upload` routes and video processing pipelines to ensure model inference tasks do not block the main event loop.
- **Standardized API Responses**: Wrap all API responses in a unified `{ success: bool, message: str, data: dict, meta: dict }` payload structure.
- **Configuration Management**: Extract all hardcoded strings (e.g., CORS origins, model paths, db URIs) into environment variables handled by `pydantic-settings`.
