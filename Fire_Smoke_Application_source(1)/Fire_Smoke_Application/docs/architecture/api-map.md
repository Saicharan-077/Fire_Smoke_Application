# FireGuard AI — API Map (Phase 1)

> Current API discovered from backend routes.

## Base
- `GET /api/health` and `GET /api/v1/health`
- Evidence: `GET /evidence/{filename}` (static)

## Uploads
- `POST /api/v1/upload/image`
  - form-data: `file`
  - response: `ImageUploadResponse`
- `POST /api/v1/upload/video`
  - form-data: `file`
  - response: `VideoUploadResponse`

## Incidents / Alerts
- `GET /api/v1/alerts`
  - query: `detection_type`, `status`, `date_from`, `date_to`, `search`, `page`, `limit`
- `GET /api/v1/alerts/{alert_id}`
- `PATCH /api/v1/alerts/{alert_id}/status`
- `GET /api/v1/alerts/{alert_id}/events`
- `DELETE /api/v1/alerts/{alert_id}`

## Dashboard
- `GET /api/v1/dashboard/stats`
- `GET /api/v1/dashboard/analytics?range=24h|7d|30d`
- `GET /api/v1/dashboard/events?detection_type&date_from&date_to&limit`

## Cameras
- `GET /api/v1/cameras`
- `POST /api/v1/cameras`
- `GET /api/v1/cameras/count`
- `GET /api/v1/cameras/{camera_id}`
- `GET /api/v1/cameras/{camera_id}/activity`
- `DELETE /api/v1/cameras/{camera_id}`

## Analytics (standalone)
- `GET /api/v1/analytics?range=24h|7d|30d`

## WebSockets
- `WS /ws/alerts`
  - server broadcasts: `{ event:'new_alert', alert_id, type, confidence, camera_id, location }`

