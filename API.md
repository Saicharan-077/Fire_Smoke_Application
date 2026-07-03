# FireGuard AI — API Reference

Base URL: `http://localhost:8000`  
Authentication: `Authorization: Bearer <session_token>`

Interactive docs: http://localhost:8000/docs

---

## Health

| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| GET | `/api/v1/health` | No | Service health and model status |

**Response:**
```json
{
  "status": "ok",
  "service": "FireGuard AI",
  "version": "1.0.0",
  "model_ready": true,
  "timestamp": "2026-07-03T10:00:00"
}
```

---

## Authentication — `/api/v1/auth`

| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| POST | `/login` | No | Login with email/username + password |
| POST | `/register` | No | Register (creates viewer account) |
| POST | `/forgot-password` | No | Request password reset |
| POST | `/change-password` | Yes | Change own password |
| POST | `/logout` | Yes | Invalidate session |
| GET | `/profile` | Yes | Get current user profile |

**Login Request:**
```json
{ "username_or_email": "admin@fireguard.ai", "password": "Admin@123" }
```

**Login Response:**
```json
{
  "token": "abc123...",
  "user": { "id": "...", "username": "...", "email": "...", "role": "administrator" }
}
```

---

## Detection / Upload — `/api/v1/upload`, `/api/v1/detect`

| Method | URL | Auth | Role | Description |
|--------|-----|------|------|-------------|
| POST | `/upload/image` | Yes | Operator+ | Upload image for YOLO detection |
| POST | `/upload/video` | Yes | Operator+ | Upload video for frame detection |
| POST | `/detect/image` | Yes | Operator+ | Alias for image upload |
| POST | `/detect/video` | Yes | Operator+ | Alias for video upload |
| GET | `/detect/live` | Yes | Any | Webcam inference metadata |
| POST | `/detect/cctv` | Yes | Operator+ | Test RTSP stream connection |

**Image Upload:** `multipart/form-data` with `file` field.

**Image Response:**
```json
{
  "detections": [{ "detection_type": "fire", "confidence": 0.92, "bbox": { "x1": 10, "y1": 20, "x2": 100, "y2": 150 } }],
  "alert_ids": ["alert-id-123"],
  "evidence_path": "/evidence/annotated_abc.jpg",
  "file_name": "test.jpg"
}
```

---

## Dashboard — `/api/v1/dashboard`

| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| GET | `/stats` | Yes | SOC KPI statistics |
| GET | `/analytics?range=24h\|7d\|30d` | Yes | Timeline and zone data |
| GET | `/events` | Yes | Detection events list |

---

## Alerts — `/api/v1/alerts`

| Method | URL | Auth | Role | Description |
|--------|-----|------|------|-------------|
| GET | `/` | Yes | Any | List alerts (paginated, filterable) |
| GET | `/{id}` | Yes | Any | Get single alert |
| GET | `/{id}/events` | Yes | Any | Detection events for alert |
| PATCH | `/{id}/status` | Yes | Operator+ | Update alert status |
| DELETE | `/{id}` | Yes | Operator+ | Delete alert |

**Query params:** `page`, `limit`, `detection_type`, `status`, `search`, `date_from`, `date_to`

---

## Incidents — `/api/v1/incidents`

| Method | URL | Auth | Role | Description |
|--------|-----|------|------|-------------|
| GET | `/` | Yes | Any | List incidents |
| POST | `/` | Yes | Operator+ | Create incident |
| GET | `/{id}` | Yes | Any | Get incident |
| PATCH | `/{id}` | Yes | Operator+ | Update incident |
| DELETE | `/{id}` | Yes | Operator+ | Delete incident |
| GET | `/export/pdf` | Yes | Any | Export incidents PDF |

---

## Cameras — `/api/v1/cameras`

| Method | URL | Auth | Role | Description |
|--------|-----|------|------|-------------|
| GET | `/` | Yes | Any | List all cameras |
| POST | `/` | Yes | Operator+ | Create camera |
| GET | `/count` | Yes | Any | Camera count (total/online) |
| GET | `/{id}` | Yes | Any | Get camera |
| GET | `/{id}/activity` | Yes | Any | Recent alerts for camera |
| PATCH | `/{id}` | Yes | Operator+ | Update camera |
| PATCH | `/{id}/status` | Yes | Operator+ | Update status |
| PATCH | `/{id}/zone` | Yes | Operator+ | Update zone |
| DELETE | `/{id}` | Yes | Operator+ | Delete camera |

---

## History — `/api/v1/history`

| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| GET | `/` | Yes | Paginated alert history |
| GET | `/export/csv` | Yes | Export CSV |
| GET | `/export/pdf` | Yes | Export PDF |

---

## Analytics — `/api/v1/analytics`

| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| GET | `/` | Yes | Full analytics bundle |
| GET | `/incident-trends` | Yes | Weekly incident trends |
| GET | `/fire-smoke-distribution` | Yes | Type breakdown |
| GET | `/alert-frequency` | Yes | Alert frequency timeline |
| GET | `/severity-distribution` | Yes | Confidence-based severity |
| GET | `/camera-activity` | Yes | Per-camera alert counts |

---

## Settings — `/api/v1/settings`

| Method | URL | Auth | Role | Description |
|--------|-----|------|------|-------------|
| GET | `/` | Yes | Any | Get all settings |
| PATCH | `/` | Yes | Admin | Update settings |

---

## Profile — `/api/v1/profile`

| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| GET | `/` | Yes | Get profile |
| PATCH | `/` | Yes | Update profile |
| GET | `/audit-logs` | Yes | Personal audit logs |

---

## Admin — `/api/v1/admin` (Administrator only)

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/users` | List users (paginated) |
| POST | `/users` | Create user |
| GET | `/users/{id}` | Get user |
| PATCH | `/users/{id}` | Update user |
| DELETE | `/users/{id}` | Delete user |
| POST | `/users/{id}/reset-password` | Reset user password |
| PATCH | `/users/{id}/activate` | Activate user |
| PATCH | `/users/{id}/deactivate` | Deactivate user |
| GET | `/audit-logs` | All audit logs |
| GET | `/system-logs` | System logs |
| GET | `/sessions` | Active sessions |
| DELETE | `/sessions/{user_id}` | Revoke session |
| GET | `/health` | Admin system health |
| GET | `/stats` | Admin dashboard stats |

---

## WebSocket

| URL | Auth | Description |
|-----|------|-------------|
| `WS /ws/alerts?token=<token>` | Token query param | Real-time alert broadcasts |

**Message format:**
```json
{
  "type": "alert",
  "alert": { "id": "...", "detection_type": "fire", "confidence": 0.91, ... }
}
```

---

## Evidence

| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| GET | `/evidence/{filename}` | No* | Static evidence files |
| GET | `/api/v1/evidence/{filename}` | Yes | Authenticated evidence access |

---

## Error Responses

| Code | Meaning |
|------|---------|
| 401 | Missing or expired session |
| 403 | Insufficient role permissions |
| 404 | Resource not found |
| 400 | Validation error |
| 500 | Server error |

```json
{ "detail": "Insufficient permissions" }
```
