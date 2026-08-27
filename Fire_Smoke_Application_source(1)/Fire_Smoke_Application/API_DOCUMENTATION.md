# API Documentation — FireGuard AI

FireGuard AI exposes a RESTful API built on **FastAPI** using JWT Bearer Token authentication.

## Base URL
All API requests should be sent to:
```
http://localhost:8000/api/v1
```

---

## Authentication & Access Control

Endpoints marked with 🔒 require a valid JWT token in the request headers:
```http
Authorization: Bearer <your_jwt_token>
```

### 1. User Login
* **Method**: `POST`
* **Path**: `/auth/login`
* **Payload**:
  ```json
  {
    "email": "operator@fireguard.ai",
    "password": "Operator@123"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "access_token": "eyJhbGciOi...",
    "token_type": "bearer",
    "user": {
      "id": "8cfed8bf...",
      "username": "operator@fireguard.ai",
      "role": "operator"
    }
  }
  ```

### 2. User Registration
* **Method**: `POST`
* **Path**: `/auth/register`
* **Payload**:
  ```json
  {
    "username": "new_ops@fireguard.ai",
    "password": "Password@123",
    "role": "operator"
  }
  ```

---

## Threat Detection & Ingest

### 3. Image Inference 🔒
* **Method**: `POST`
* **Path**: `/detect/image`
* **Payload**: `multipart/form-data` with `file` key containing the image.
* **Response (200 OK)**:
  ```json
  {
    "detections": [
      {
        "detection_type": "fire",
        "confidence": 0.89,
        "bbox": { "x1": 100, "y1": 150, "x2": 250, "y2": 300 }
      }
    ],
    "alert_ids": ["alert_89ad31..."],
    "evidence_path": "/evidence/img_annotated_123.jpg",
    "file_name": "surveillance_snapshot.jpg"
  }
  ```

### 4. Video Inference 🔒
* **Method**: `POST`
* **Path**: `/detect/video`
* **Payload**: `multipart/form-data` with `file` key containing the video clip.

### 5. CCTV RTSP Connection Test 🔒
* **Method**: `POST`
* **Path**: `/detect/cctv`
* **Payload**:
  ```json
  {
    "stream_url": "rtsp://192.168.1.100:554/live"
  }
  ```

---

## Alerts & Incident Tickets

### 6. List Alerts 🔒
* **Method**: `GET`
* **Path**: `/alerts`
* **Parameters**:
  * `detection_type` (optional): `fire` or `smoke`
  * `status` (optional): `active` or `resolved`

### 7. Resolve Alert 🔒
* **Method**: `PATCH`
* **Path**: `/alerts/{alert_id}/status`
* **Payload**:
  ```json
  {
    "status": "resolved"
  }
  ```

### 8. List Incidents 🔒
* **Method**: `GET`
* **Path**: `/incidents`

### 9. Export Incidents PDF 🔒
* **Method**: `GET`
* **Path**: `/incidents/export/pdf`
* **Response**: Binary PDF attachment (`incidents_report.pdf`).

---

## System Configuration

### 10. Get Settings 🔒
* **Method**: `GET`
* **Path**: `/settings`

### 11. Update Settings 🔒
* **Method**: `PATCH`
* **Path**: `/settings`
* **Payload**:
  ```json
  {
    "conf_fire": "0.35",
    "conf_smoke": "0.40"
  }
  ```
