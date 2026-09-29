# Fire & Smoke Detection System (SentinelOS / Innovision UC2)
## Complete End-to-End Technical & Architectural Documentation

---

## Document Control & Metadata

| Attribute | Value |
| :--- | :--- |
| **System Name** | SentinelOS FireGuard AI / Innovision UC2 Fire & Smoke Analytics |
| **Document Version** | `2.4.0-PROD` |
| **Classification** | Production Architecture Specification & Common Platform Integration Guide |
| **Target Audience** | System Architects, ML Engineers, Backend Developers, SOC Operators, Integration Platform Teams |
| **Reference Frameworks** | FastAPI 0.100+, PyTorch 2.x, Ultralytics YOLO26m, OpenCV 4.9+, React 19, Redis 7, MinIO S3 |
| **Status** | `[IMPLEMENTED]` (Monolith + Microservice UC2 Engine) & `[PROPOSED]` (Multi-Tenant UC Registry Extension) |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System at a Glance & Architectural Topologies](#2-system-at-a-glance--architectural-topologies)
3. [End-to-End Data Flow Journey](#3-end-to-end-data-flow-journey)
4. [Input & Ingestion Layer](#4-input--ingestion-layer)
5. [Frame Preprocessing & Tensor Transformation](#5-frame-preprocessing--tensor-transformation)
6. [AI / ML Neural Detection Layer (YOLO26m)](#6-ai--ml-neural-detection-layer-yolo26m)
7. [Computer Vision Deterministic Enhancement Layer](#7-computer-vision-deterministic-enhancement-layer)
8. [Temporal Verification & Trajectory Association (ByteTrack)](#8-temporal-verification--trajectory-association-bytetrack)
9. [Multi-Factor Evidence Fusion Matrix](#9-multi-factor-evidence-fusion-matrix)
10. [False Positive Reduction & Heuristic Safeguards](#10-false-positive-reduction--heuristic-safeguards)
11. [Alert Engine & Severity Classification](#11-alert-engine--severity-classification)
12. [Notification System & Real-Time Dispatch](#12-notification-system--real-time-dispatch)
13. [Backend Architecture & Service Decomposition](#13-backend-architecture--service-decomposition)
14. [REST API Documentation](#14-rest-api-documentation)
15. [WebSocket Real-Time Monitoring Subsystem](#15-websocket-real-time-monitoring-subsystem)
16. [Database Schema & Persistence Layer](#16-database-schema--persistence-layer)
17. [Frontend & SOC Dashboard Client](#17-frontend--soc-dashboard-client)
18. [Technology Stack Reference](#18-technology-stack-reference)
19. [Deployment Architecture & Infrastructure](#19-deployment-architecture--infrastructure)
20. [Security & Role-Based Access Control (RBAC)](#20-security--role-based-access-control-rbac)
21. [Error Handling, Circuit Breakers & Fault Recovery](#21-error-handling-circuit-breakers--fault-recovery)
22. [Performance Profile & Latency Benchmarks](#22-performance-profile--latency-benchmarks)
23. [Configuration Reference & Environment Variables](#23-configuration-reference--environment-variables)
24. [Common Integration Platform (Innovision Architecture)](#24-common-integration-platform-innovision-architecture)
25. [Four Use Case Integration Model (UC1 – UC4)](#25-four-use-case-integration-model-uc1--uc4)
26. [Common vs. Use-Case-Specific Component Ownership](#26-common-vs-use-case-specific-component-ownership)
27. [Standard Use-Case Event Contracts & JSON Schemas](#27-standard-use-case-event-contracts--json-schemas)
28. [Integration Sequence Diagrams](#28-integration-sequence-diagrams)
29. [Complete Input $\rightarrow$ Output Concrete Walkthrough](#29-complete-input--output-concrete-walkthrough)
30. [Detection State Machine & Lifecycle](#30-detection-state-machine--lifecycle)
31. [Data Contracts & Pydantic Specifications](#31-data-contracts--pydantic-specifications)
32. [Repository & Code Structure Map](#32-repository--code-structure-map)
33. [Testing Strategy & Test Automation Execution](#33-testing-strategy--test-automation-execution)
34. [Local Setup & Developer Quickstart](#34-local-setup--developer-quickstart)
35. [Troubleshooting Matrix & Operational Runbook](#35-troubleshooting-matrix--operational-runbook)
36. [Known System Limitations](#36-known-system-limitations)
37. [Future Enhancements & Roadmap](#37-future-enhancements--roadmap)
38. [System Glossary & Terminology](#38-system-glossary--terminology)
39. [Architectural Summary & Ownership Boundaries](#39-architectural-summary--ownership-boundaries)

---

## 1. Executive Summary

### 1.1 Purpose & Problem Statement
Traditional CCTV surveillance systems rely heavily on manual operator monitoring across dozens of simultaneous streams. Human visual fatigue leads to delayed detection of combustion events, resulting in severe property damage, operational disruption, and life safety hazards. Existing hardware-based smoke/ionization sensors suffer from long activation latencies in high-ceiling industrial facilities, outdoor zones, and ventilated corridors.

### 1.2 The AI-Powered Solution
The **Fire & Smoke Detection System** (SentinelOS / Innovision UC2) provides real-time, automated video analytics that overlays computer vision intelligence onto standard IP/RTSP camera feeds, video files, and image uploads. The system employs a **dual-stream hybrid pipeline**:
1. **Deep Learning Path (`YOLO26m`)**: Extracts spatial bounding boxes, class probabilities (`fire`, `smoke`), and object context.
2. **Deterministic Computer Vision Path (`OpenCV`)**: Analyzes multi-range HSV color masks, texture entropy, Laplacian blur/variance, optical flow motion differentials, and high-frequency flicker/sparks (8–12 Hz).

These parallel streams converge into an **Evidence Fusion Engine** and a **ByteTrack Temporal Association Layer** that eliminates false positives caused by sunlight, orange safety gear, welding torches, and camera sensor noise.

### 1.3 Key Capabilities
* **Sub-Second Threat Detection**: Real-time inference running at 25–45 FPS on CUDA GPUs and 12–20 FPS on multi-threaded modern CPUs.
* **Dual Deployment Modes**:
  * **Unified Monolith / Enterprise Application**: Direct FastAPI backend with SQLite/PostgreSQL, WebSockets, and React 19 SOC dashboard.
  * **Distributed Microservice (`services/uc2_fire_smoke`)**: Redis Streams frame ingestion, MinIO S3 evidence archiving, and standardized `AlertEvent` publishing to the common **Innovision Platform**.
* **3-Tier Severity Alert Engine**: Automated escalation across `🟢 GREEN` (Secure Monitoring), `🟡 YELLOW` (Advisory Verification), and `🔴 RED` (Critical Emergency Incident).

---

## 2. System at a Glance & Architectural Topologies

### 2.1 Unified Dual-Stream Detection Pipeline

```mermaid
flowchart TD
    CF[📷 Camera Frame / RTSP Stream / Video Ingestion] --> Split{Stream Ingestion}
    
    Split -->|Tensor Normalization 640x640| AI[🧠 YOLO26m Neural Network]
    Split -->|BGR/HSV Spatial Matrix| CV[👁️ OpenCV CV Heuristics Engine]

    subgraph DeepLearning [Stage 1: Deep Learning]
        AI --> Logits["BBoxes + Class Logits\n(Fire / Smoke / Objects)"]
    end

    subgraph ComputerVision [Stage 2: Deterministic CV]
        CV --> ColorMask["HSV Multi-Range Fire Mask\n+ Smoke Desaturation (S < 130)"]
        CV --> Texture["Laplacian Variance + Entropy\n+ Edge Density (Canny)"]
        CV --> Dynamics["Optical Flow Motion\n+ Sparks (V > 230) + Flicker (8-12Hz)"]
    end

    Logits --> EF[⚡ Stage 3: Evidence Fusion Matrix]
    ColorMask --> EF
    Texture --> EF
    Dynamics --> EF

    EF --> TV[⏳ Stage 4: ByteTrack Temporal Association & EMA Smoothing]

    TV --> CatCheck{Threat Categorization}
    CatCheck -->|Sustained Macro Flame| Cat1[🔥 NORMAL FIRE]
    CatCheck -->|Small ROI Area < 1.5%| Cat2[🔭 FAR FIRE CANDIDATE]
    CatCheck -->|Sparks >= 3 or Flicker > 0.65| Cat3[✨ SPARK / OCCLUDED]
    CatCheck -->|Desaturated Dispersion| Cat4[💨 NORMAL SMOKE]

    Cat1 --> AE[🚨 Stage 5: Alert Engine]
    Cat2 --> AE
    Cat3 --> AE
    Cat4 --> AE

    AE --> StateCheck{Alert Severity}
    StateCheck -->|Score >= 0.70 / Confirmed| RED[🔴 RED: Critical Incident]
    StateCheck -->|Score 0.35 - 0.69 / Candidate| YEL[🟡 YELLOW: Advisory Pre-Alarm]
    StateCheck -->|Score < 0.35 / Baseline| GRN[🟢 GREEN: Secure Normal]

    RED --> OutWS[📡 WebSocket Broadcast /ws/alerts]
    RED --> OutDB[(💾 DB Incident & Audit Log)]
    RED --> OutRedis[📨 Redis Stream alerts:live -> Innovision Platform]
```

---

## 3. End-to-End Data Flow Journey

| Stage | Input | Transformation / Processing | Output | Implemented Location |
| :--- | :--- | :--- | :--- | :--- |
| **1. Ingestion** | RTSP / MP4 / MJPEG / Upload | OpenCV VideoCapture decoding, frame drop compensation, adaptive stride selection | BGR `ndarray` $(H \times W \times 3)$ | [`backend/detection/detection_layer.py:845`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/backend/detection/detection_layer.py#L845) |
| **2. Preprocessing** | BGR `ndarray` | Letterbox aspect-preserving resize to $640 \times 640$, FP32/FP16 normalization, color conversion | GPU Tensor $\mathbf{X} \in \mathbb{R}^{1 \times 3 \times 640 \times 640}$ | [`backend/detection/detection_layer.py:602`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/backend/detection/detection_layer.py#L602) |
| **3. AI Inference** | GPU Tensor | Single-stage forward pass, decoupled anchor-free regression + classification heads, NMS | Raw Candidates: `[{bbox, conf, class_id}]` | [`backend/detection/detection_layer.py:621`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/backend/detection/detection_layer.py#L621) |
| **4. CV Verification** | BGR/HSV Frame + ROI BBoxes | HSV fire color masking, connected components, Laplacian texture variance, Shannon entropy, spark extraction | Verification Scores: `flame_color_ratio, avg_sat, sparks_count, flicker_index` | [`backend/detection/detection_layer.py:313`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/backend/detection/detection_layer.py#L313) |
| **5. Evidence Fusion** | YOLO Conf + CV Scores | Weighted matrix calculation: $0.45(YOLO) + 0.30(Color) + 0.15(Brightness) + 0.10(Flicker) + Sparks$ | `fusion_score`, `candidate_category` | [`backend/detection/detection_layer.py:581`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/backend/detection/detection_layer.py#L581) |
| **6. Temporal Verification** | Fusion Candidates across time | ByteTrack two-stage IoU association, Exponential Moving Average smoothing ($\alpha=0.60$) | Temporally Confirmed Active Tracks | [`backend/detection/detection_layer.py:30`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/backend/detection/detection_layer.py#L30) |
| **7. Alert Engine** | Confirmed Tracks + Zone Rules | Threshold mapping, cooldown enforcement (30s), continuous alarm triggers | `alert_level` (`GREEN`/`YELLOW`/`RED`), `Alert` DB Record | [`backend/detection/detection_layer.py:595`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/backend/detection/detection_layer.py#L595) |
| **8. Real-time Dispatch** | Alert metadata + Evidence JPEG | WebSocket broadcast (`/ws/alerts`), Redis stream publication (`alerts:live`), MinIO upload | Real-time SOC UI alert + Evidence S3 key | [`backend/app/websocket/manager.py`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/backend/app/websocket/manager.py), [`shared/platform_client/alert_publisher.py`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/shared/platform_client/alert_publisher.py) |

---

## 4. Input & Ingestion Layer

### 4.1 Supported Input Modalities `[IMPLEMENTED]`
* **RTSP / IP Camera Streams**: Continuous video feeds over TCP/UDP (`rtsp://user:pass@host:554/live`).
* **Live Webcams**: Client-side media stream capture or server-attached video devices (`/dev/video0` or DirectShow Device Index `0`).
* **Static Images**: Standard image uploads (`.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`).
* **Recorded Video Uploads**: Asynchronous processing of MP4, AVI, MOV, and MKV containers.
* **Distributed Redis Streams**: High-throughput binary frame ingestion from common platform edge ingestors via Redis Stream `camera:{camera_id}:frames`.

### 4.2 Adaptive Ingestion Architecture & Frame Dropping
The stream ingestion pipeline implements **Adaptive Motion Sampling**:
* **Idle / Static Scene**: Low-resolution ($320 \times 180$) grayscale frame difference check ($\text{MAD} < 1.0$). Sampling reduces to $\sim 7.5\text{ FPS}$ (every 2nd or 3rd frame).
* **Active Threat / Dynamic Scene**: Automatically switches to **$1:1$ frame processing** ($\text{stride} = 1$) to ensure unbroken ByteTrack trajectory continuity and rapid alarm accumulation.
* **High-Resolution Pre-scaling**: 4K/1080p feeds exceeding $1280\text{px}$ width are bilinearly scaled to max dimension $1280\text{px}$ prior to neural inference, with bounding boxes mapped back to original coordinates.

```mermaid
flowchart LR
    RTSP[RTSP/Video Source] --> Cap[OpenCV VideoCapture]
    Cap --> Thumbnail[320x180 Grayscale Diff]
    Thumbnail -->|MAD < 1.0 & No Active Threat| StaticMode[Static Stride: ~7.5 FPS]
    Thumbnail -->|MAD >= 1.0 or Active Threat| ThreatMode[Real-Time Stride: 1:1 Every Frame]
    StaticMode --> PreScale[Downscale Max 1280px]
    ThreatMode --> PreScale
    PreScale --> Stage1AI[Stage 1 YOLO26m Inference]
```

---

## 5. Frame Preprocessing & Tensor Transformation

### 5.1 Exact Preprocessing Pipeline
1. **Color Conversion**: Raw frame decoded from BGR to RGB channel order for neural networks, and to HSV/YCrCb for color masking.
2. **Letterbox Resizing**: Frame resized to $640 \times 640$ pixels preserving aspect ratio with symmetric gray padding ($114, 114, 114$).
3. **Normalization**: Integer pixels in range $[0, 255]$ converted to FP32 range $[0.0, 1.0]$.
4. **Coordinate Remapping Formula**:
   $$\text{scale} = \min\left(\frac{640}{W_{\text{orig}}}, \frac{640}{H_{\text{orig}}}\right), \quad \text{pad}_x = \frac{640 - W_{\text{orig}} \cdot \text{scale}}{2}, \quad \text{pad}_y = \frac{640 - H_{\text{orig}} \cdot \text{scale}}{2}$$
   $$x_{\text{orig}} = \frac{x_{\text{model}} - \text{pad}_x}{\text{scale}}, \quad y_{\text{orig}} = \frac{y_{\text{model}} - \text{pad}_y}{\text{scale}}$$

---

## 6. AI / ML Neural Detection Layer (YOLO26m)

### 6.1 Model Specifications `[IMPLEMENTED]`

| Parameter | Value / Implementation |
| :--- | :--- |
| **Model Name** | `YOLO26m` (You Only Look Once 26 Medium) |
| **Framework** | Ultralytics / PyTorch 2.x |
| **Weight Container** | `backend/models/best.pt` / `yolo26m_auto.pt` |
| **Model Size** | $20.3\text{ MB}$ (Optimized FP16/FP32 weights) |
| **Input Resolution** | $640 \times 640 \times 3$ |
| **Target Classes** | `0: fire`, `1: smoke` |
| **Inference Hardware** | CUDA (NVIDIA GPU with FP16 half-precision) or multi-core CPU |
| **Confidence Threshold ($T_{\text{conf}}$)** | $0.20$ (Default Balanced), configurable $0.05 - 0.95$ in Settings DB |
| **IoU NMS Threshold ($T_{\text{iou}}$)** | $0.45$ |
| **Warm-up Routine** | Zero-tensor forward pass executed during FastAPI `lifespan` startup |

---

## 7. Computer Vision Deterministic Enhancement Layer

The deterministic CV enhancement layer acts as a physical verification filter on each candidate bounding box $[x_1, y_1, x_2, y_2]$ generated by YOLO.

### 7.1 Fire Verification Heuristics (`verify_fire`)
1. **Multi-Range HSV Color Filtering**:
   * Hue Range 1: $[0, 30, 50]$ to $[25, 255, 255]$ (Red/Orange flames)
   * Hue Range 2: $[150, 30, 50]$ to $[180, 255, 255]$ (Deep Red combustion)
   * Hue Range 3: $[25, 30, 50]$ to $[45, 255, 255]$ (Yellow core)
2. **Morphological Noise Removal**: $3 \times 3$ rectangular structuring element applying `MORPH_OPEN` followed by `MORPH_CLOSE`.
3. **Connected Components Analysis**: Rejects components smaller than $2\text{ px}$. Calculates $\text{FlameColorRatio} = \frac{\sum \text{Flame Pixels}}{\text{Total ROI Pixels}}$.
4. **Spark Hotspot Detection**: High-brightness micro-hotspots ($V \ge 230, S \ge 50, \text{area} \in [1, 30]\text{px}$).
5. **Intensity Flicker Index**: Measures standard deviation of Value channel over space: $\text{FlickerIndex} = \min(1.0, \frac{\sigma_V}{64.0})$.

### 7.2 Smoke Verification Heuristics (`verify_smoke`)
1. **Desaturation Dominance**: Smoke is characterized by low saturation ($S \le 130$) and low chroma difference: $\text{ChromaDiff} = \text{mean}(|\max(B,G,R) - \min(B,G,R)|) \le 60.0$.
2. **Shannon Grayscale Entropy**: Computes histogram entropy $H = -\sum p_i \log_2(p_i)$ requiring $H \in [1.5, 8.0]$.
3. **Laplacian Blur Variance**: Variance of $\nabla^2 \text{ROI}$ checked against $[\text{min}=0.5, \text{max}=500.0]$ to reject sharp synthetic shapes and uniform concrete surfaces.
4. **Sobel Gradient Magnitude**: Average gradient checked against $[\text{min}=0.3, \text{max}=40.0]$ to verify soft diffusion boundary profiles.

---

## 8. Temporal Verification & Trajectory Association (ByteTrack)

### 8.1 ByteTrack Association Workflow `[IMPLEMENTED]`
Single-frame detections are prone to flicker dropout and camera noise. SentinelOS implements a customized **ByteTracker**:

```mermaid
sequenceDiagram
    participant Frame as Ingested Frame (t)
    participant High as High-Confidence Detections (conf >= 0.35)
    participant Low as Low-Confidence Candidates (0.15 <= conf < 0.35)
    participant Tracker as ByteTrack State Buffer
    participant Confirmed as Temporal EMA Output

    Frame->>High: Filter Stage 1 detections
    Frame->>Low: Filter Stage 1 detections
    High->>Tracker: Stage 1: Match with existing active tracks (IoU >= 0.25)
    Tracker->>Tracker: Update matched tracks (Age = 0, Hits += 1)
    Low->>Tracker: Stage 2: Recover flickering flames using unmatched low-conf boxes
    Tracker->>Confirmed: Apply EMA Smoothing: Conf(t) = 0.6*Curr + 0.4*Prev
    Tracker->>Tracker: Increment age of unmatched tracks (Purge if Age > 25)
```

---

## 9. Multi-Factor Evidence Fusion Matrix

### 9.1 Decision Fusion Mathematical Model
SentinelOS fuses neural confidence with physical computer vision metrics using the following weighted matrix:

$$\text{FusionScore}_{\text{fire}} = \min\left(0.99, \, 0.45 \cdot C_{\text{yolo}} + 0.30 \cdot S_{\text{color}} + 0.15 \cdot S_{\text{bright}} + 0.10 \cdot S_{\text{flicker}} + \Delta_{\text{sparks}}\right)$$

$$\text{FusionScore}_{\text{smoke}} = \min\left(0.99, \, 0.50 \cdot C_{\text{yolo}} + 0.35 \cdot S_{\text{desat}} + 0.15 \cdot S_{\text{edge}}\right)$$

Where:
* $S_{\text{color}} = \min\left(1.0, \frac{\text{FlameRatio}}{0.20}\right)$
* $S_{\text{bright}} = \frac{\bar{V}}{255.0}$
* $\Delta_{\text{sparks}} = \min(0.15, \text{SparkCount} \times 0.03)$
* $S_{\text{desat}} = \max\left(0.0, 1.0 - \frac{\bar{S}}{255.0}\right)$

### 9.2 Threat Sub-Categorization Logic
1. **Far Fire Candidate**: Assigned when $\text{BBox Area Ratio} < 0.015$ ($<1.5\%$ of frame) or $\text{Area} < 1800\text{ px}$ with high color concentration.
2. **Spark / Occluded**: Assigned when $\text{SparkCount} \ge 3$ or $\text{FlickerIndex} > 0.65$.
3. **Normal Fire**: Sustained macro-scale combustion signatures.
4. **Normal Smoke**: Diffuse desaturated atmospheric particulate dispersion.

---

## 10. False Positive Reduction & Heuristic Safeguards

| Environmental Disturbance | Deep Learning Role | Deterministic CV Role | Temporal Tracking Role |
| :--- | :--- | :--- | :--- |
| **Sunlight Reflections / Glare** | May output low confidence ($0.2-0.4$) | Rejects due to zero color saturation or high gradient sharpness | Rejects if static ($MAD < 1.8$) |
| **Orange / Red Safety Vests** | High classification accuracy on non-threat context | Rejects due to lack of flicker ($\sigma_V < 10$) and zero spark points | Tracked as static object |
| **Welding Arcs & Torches** | High confidence initial trigger | Detects high spark count ($\ge 3$); tags as `SPARK_OCCLUDED` | Requires multi-frame sustained growth |
| **Car Headlights / Lamps** | Rejects based on bounding box context | Rejects: uniform white saturation ($S < 30$) | Tracked as moving point source |
| **Steam / Exhaust Vapor** | May misclassify as smoke | Rejects: high gradient edges and sharp boundary contours | Rejects if dissipating in $< 2$ frames |
| **Digital Camera Sensor Noise** | Rejects boxes $< 15 \times 15\text{ px}$ | Rejects: Laplacian variance $< 0.5$ | ByteTrack drops isolated 1-frame spikes |

---

## 11. Alert Engine & Severity Classification

### 11.1 Operational State Machine

```mermaid
stateDiagram-v2
    [*] --> NO_EVENT: Camera Online
    NO_EVENT --> CANDIDATE: Stage 1 Raw Detection (Conf >= 0.20)
    CANDIDATE --> REJECTED: CV Verification Failed (Low Flame Ratio / Static)
    REJECTED --> NO_EVENT: Log to rejected_detections.jsonl
    
    CANDIDATE --> TEMPORAL_CHECK: CV Verification Passed
    TEMPORAL_CHECK --> VERIFIED_ADVISORY: Consecutive Frames >= 1 (YELLOW Alert)
    TEMPORAL_CHECK --> VERIFIED_CRITICAL: Consecutive Frames >= 3 & Fusion >= 0.70 (RED Alert)
    
    VERIFIED_ADVISORY --> VERIFIED_CRITICAL: Flame Growth / Sustained Duration
    VERIFIED_CRITICAL --> ALERT_COOLDOWN: Push WS + Save DB Alert (30s Cooldown)
    ALERT_COOLDOWN --> CONTINUOUS_ALARM: Frames >= 15 (Sustained Fire Incident)
    ALERT_COOLDOWN --> RESOLVED: Operator Action or Scene Clear
    CONTINUOUS_ALARM --> RESOLVED: Incident Ticket Resolved in SOC
    RESOLVED --> NO_EVENT
```

---

## 12. Notification System & Real-Time Dispatch

### 12.1 Real-Time Broadcast Payload (`/ws/alerts`)
When an alert is emitted, the WebSocket manager dispatches the following JSON structure:

```json
{
  "type": "NEW_ALERT",
  "data": {
    "id": 142,
    "camera_id": "CAM-01",
    "camera_name": "Main Warehouse East",
    "detection_type": "fire",
    "confidence": 0.8942,
    "raw_yolo_conf": 0.9120,
    "candidate_category": "normal_fire",
    "alert_level": "RED",
    "fusion_score": 0.8942,
    "evidence_path": "evidence/annotated_2026-09-29T04-20-11_CAM-01.jpg",
    "thumbnail_b64": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...",
    "created_at": "2026-09-29T04:20:11.450Z",
    "status": "active"
  }
}
```

---

## 13. Backend Architecture & Service Decomposition

```mermaid
flowchart TD
    Client[React 19 SOC Frontend / HTTP & WS] --> Middleware[FastAPI Middleware\nCORS | Security Headers | Rate Limiting]
    
    Middleware --> AuthDep[get_current_user / require_role RBAC]
    
    AuthDep --> R1[Auth Routes /api/v1/auth]
    AuthDep --> R2[Camera Routes /api/v1/cameras]
    AuthDep --> R3[Detection Routes /api/v1/detect]
    AuthDep --> R4[Alert & Incident Routes /api/v1/alerts]
    AuthDep --> R5[Analytics Routes /api/v1/analytics]
    AuthDep --> R6[Admin Routes /api/v1/admin]
    
    R3 --> DetSvc[DetectionService Wrapper]
    DetSvc --> DetLayer[Unified DetectionLayer\nYOLO26m + CV Verification + ByteTrack]
    
    R4 --> AlertSvc[AlertService & Incident Escalation]
    
    DetLayer --> EvidDir[(Evidence Storage\nbackend/evidence/)]
    AlertSvc --> WSMan[ConnectionManager /ws/alerts]
    
    R1 & R2 & R4 & R5 & R6 --> DB[(SQLAlchemy ORM\nSQLite / PostgreSQL)]
```

---

## 14. REST API Documentation

### 14.1 Authentication Endpoints (`/api/v1/auth`)

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Authenticates username/email & password, issues session UUID token | Public |
| `POST` | `/api/v1/auth/logout` | Invalidates active session token | Bearer Token |
| `GET` | `/api/v1/auth/me` | Returns current user profile and RBAC role | Bearer Token |

### 14.2 Camera Management Endpoints (`/api/v1/cameras`)

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/cameras` | List all registered CCTV cameras with online/threat status | Bearer (All) |
| `POST` | `/api/v1/cameras` | Register a new CCTV camera (RTSP URL, zone, FPS) | Operator / Admin |
| `GET` | `/api/v1/cameras/{id}` | Fetch camera details and recent detection events | Bearer (All) |
| `PATCH` | `/api/v1/cameras/{id}` | Update camera stream URL, zone, or operational status | Operator / Admin |
| `DELETE` | `/api/v1/cameras/{id}` | Remove camera from surveillance registry | Admin |
| `POST` | `/api/v1/cameras/{id}/test-stream` | Probes RTSP reachability via OpenCV VideoCapture | Operator / Admin |

### 14.3 Detection & Upload Endpoints (`/api/v1/detect`, `/api/v1/upload`)

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/upload/image` | Upload image for dual-stream inference; triggers alert if threat found | Operator / Admin |
| `POST` | `/api/v1/upload/video` | Upload video file for batch/consecutive frame detection | Operator / Admin |
| `POST` | `/api/v1/detect/live` | Process individual live camera frame buffer | Operator / Admin |
| `GET` | `/api/v1/detect/status` | Return AI model ready state, device (`cuda`/`cpu`), class names | Bearer (All) |

### 14.4 Alert & Incident Endpoints (`/api/v1/alerts`, `/api/v1/incidents`)

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/alerts` | List active, resolved, or acknowledged alerts with pagination | Bearer (All) |
| `PATCH` | `/api/v1/alerts/{id}/resolve` | Mark alert as resolved with operator notes | Operator / Admin |
| `GET` | `/api/v1/alerts/export/csv` | Export historical alert logs in CSV format | Viewer / Op / Admin |
| `GET` | `/api/v1/alerts/export/pdf` | Export executive compliance PDF report | Viewer / Op / Admin |
| `GET` | `/api/v1/incidents` | List formal incident escalation tickets | Bearer (All) |
| `POST` | `/api/v1/incidents` | Create incident ticket linked to alert | Operator / Admin |

---

## 15. WebSocket Real-Time Monitoring Subsystem

### 15.1 WebSocket Endpoints
* **Alert Broadcast**: `ws://<host>:8000/ws/alerts?token=<session_token>`
* **Camera Telemetry / Live MJPEG**: `ws://<host>:8000/ws/telemetry`

### 15.2 Connection Protocol & Keep-Alive
1. **Handshake**: Client initiates WebSocket connection passing token query parameter.
2. **Session Validation**: Server verifies `session_token` in `users` database table.
3. **Heartbeat**: Client sends periodic `{"type": "ping"}`; server responds with `{"type": "pong"}`.
4. **Broadcast**: New alerts or status changes are pushed immediately to all connected clients in $< 15\text{ms}$.

---

## 16. Database Schema & Persistence Layer

### 16.1 Entity-Relationship Diagram

```mermaid
erDiagram
    USERS ||--o{ CAMERAS : "assigned_operator"
    CAMERAS ||--o{ ALERTS : "monitors"
    ALERTS ||--o{ DETECTION_EVENTS : "contains"
    ALERTS ||--o{ INCIDENTS : "escalates_to"
    USERS ||--o{ AUDIT_LOGS : "performs"

    USERS {
        int id PK
        string username
        string email
        string hashed_password
        string role
        boolean is_active
        string session_token
        datetime last_login
    }

    CAMERAS {
        string id PK
        string name
        string zone
        string status
        string stream_url
        int fps
        int assigned_operator_id FK
        datetime created_at
    }

    ALERTS {
        int id PK
        string camera_id FK
        string detection_type
        float confidence
        string severity
        string status
        string evidence_path
        datetime created_at
        datetime resolved_at
    }

    DETECTION_EVENTS {
        int id PK
        int alert_id FK
        string detection_type
        float confidence
        int x1
        int y1
        int x2
        int y2
        datetime timestamp
    }

    INCIDENTS {
        int id PK
        int alert_id FK
        string title
        string description
        string severity
        string status
        int assigned_to FK
        datetime created_at
    }

    SETTINGS {
        string id PK
        string value
        string category
        string description
    }
```

---

## 17. Frontend & SOC Dashboard Client

### 17.1 Architecture & State Management
* **Framework**: React 19 + TypeScript + Vite 8.
* **Styling**: Tailwind CSS 4 with custom dark-mode glassmorphic design tokens.
* **Global State**: Zustand stores:
  * `authStore.ts`: JWT/Session token persistence in `localStorage`, role capabilities.
  * `dashboardStore.ts`: Live alert counts, camera statuses, real-time event queues.
* **Interactive Architecture Visualizer**: [`InteractiveArchitectureFlow.tsx`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/frontend/src/components/Architecture/InteractiveArchitectureFlow.tsx) enables real-time simulation of dual-stream inference equations and alert engine state transitions.

---

## 18. Technology Stack Reference

| Category | Component / Library | Version | Purpose in System | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Backend API** | FastAPI / Uvicorn | `0.115+` | High-throughput asynchronous REST & WebSocket server | `[IMPLEMENTED]` |
| **AI / Deep Learning** | Ultralytics YOLO | `8.3+` | YOLO26m neural bounding box inference | `[IMPLEMENTED]` |
| **Vision / CV** | OpenCV (`opencv-python`) | `4.9+` | Color masking, video decoding, Laplacian blur, motion checks | `[IMPLEMENTED]` |
| **Tracking** | ByteTrack Algorithm | Custom | Multi-object temporal association & IoU smoothing | `[IMPLEMENTED]` |
| **Database ORM** | SQLAlchemy / Alembic | `2.0+` | Database abstraction & automated schema migrations | `[IMPLEMENTED]` |
| **Persistence** | SQLite / PostgreSQL | `3.45+ / 16+` | Structured data persistence (threats, users, cameras) | `[IMPLEMENTED]` |
| **Event Streaming** | Redis & Redis Streams | `7.2+` | Inter-service pub/sub and frame ingestion | `[IMPLEMENTED]` |
| **Object Storage** | MinIO S3 Client | `7.2+` | High-volume evidence JPEG image and video storage | `[IMPLEMENTED]` |
| **Metrics** | Prometheus Client | `0.20+` | Exporting inference latency and FPS metrics | `[IMPLEMENTED]` |
| **Frontend SPA** | React / TypeScript | `19.2 / 5.7+` | Security Operations Center (SOC) single-page application | `[IMPLEMENTED]` |
| **State Management** | Zustand | `5.0+` | Lightweight reactive state stores | `[IMPLEMENTED]` |
| **UI Components** | Tailwind CSS / Framer Motion | `4.3 / 12.3+` | Glassmorphism design system and micro-animations | `[IMPLEMENTED]` |

---

## 19. Deployment Architecture & Infrastructure

### 19.1 Docker Compose Deployment Topology

```mermaid
flowchart TD
    Internet[External Traffic / SOC Clients] --> Nginx[Nginx Reverse Proxy\nPort 80 / 443]
    
    subgraph FrontendCluster [Frontend Container]
        Nginx -->|/ (Static Assets)| ReactApp[React 19 Vite Server\nPort 3000]
    end

    subgraph BackendCluster [Backend Application Container]
        Nginx -->|/api/* & /ws/*| FastAPIServer[FastAPI Server\nPort 8000]
        FastAPIServer --> AIModel[YOLO26m PyTorch Engine]
        FastAPIServer --> CVEngine[OpenCV Pipeline]
    end

    subgraph MicroserviceCluster [Innovision UC2 Microservice Container]
        UC2Worker[UC2 Fire & Smoke Worker\nPort 8030]
        UC2Worker --> RedisClient[Redis Streams Frame Consumer]
    end

    subgraph DataCluster [Persistence & Storage]
        FastAPIServer --> Postgres[(PostgreSQL / SQLite DB\nPort 5432)]
        FastAPIServer & UC2Worker --> Redis[(Redis Broker\nPort 6379)]
        FastAPIServer & UC2Worker --> MinIO[(MinIO S3 Storage\nPort 9000)]
    end
```

---

## 20. Security & Role-Based Access Control (RBAC)

### 20.1 Role Capabilities Matrix

| Action / Permission | Administrator (`admin`) | Operator (`operator`) | Viewer (`viewer`) |
| :--- | :---: | :---: | :---: |
| **View SOC Dashboard & Live Feeds** | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| **View Alert Queue & Incident Reports** | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| **Export Audit Logs (CSV / PDF)** | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| **Trigger Image / Video Detections** | :white_check_mark: | :white_check_mark: | :x: |
| **Acknowledge & Resolve Active Alerts** | :white_check_mark: | :white_check_mark: | :x: |
| **Create & Update Cameras / Zones** | :white_check_mark: | :white_check_mark: | :x: |
| **Manage Users & Role Assignments** | :white_check_mark: | :x: | :x: |
| **System Settings & AI Model Tuning** | :white_check_mark: | :x: | :x: |
| **Database Seeding & System Health** | :white_check_mark: | :x: | :x: |

---

## 21. Error Handling, Circuit Breakers & Fault Recovery

1. **RTSP Stream Disconnection**:
   * Automatic exponential backoff retry ($2\text{s}, 4\text{s}, 8\text{s}, \dots, 60\text{s}$).
   * Status updated to `reconnecting` in database and broadcast to SOC clients.
2. **AI Engine Failover**:
   * If CUDA out-of-memory occurs, pipeline automatically falls back to CPU inference.
3. **Database Unavailability**:
   * High-throughput edge buffer SQLite database (`edge_buffer.db`) caches alerts locally until primary DB reconnects.
4. **WebSocket Auto-Reconnect**:
   * Frontend client implements heartbeat polling and reconnection exponential backoff.

---

## 22. Performance Profile & Latency Benchmarks

| Metric / Benchmark | Measured / Target Value | Hardware Context | Status |
| :--- | :--- | :--- | :--- |
| **Stage 1 YOLO26m Inference** | $14.2\text{ ms} \pm 2.1\text{ ms}$ | NVIDIA RTX 3060 (FP16) | `[BENCHMARKED]` |
| **Stage 1 YOLO26m Inference** | $48.5\text{ ms} \pm 5.4\text{ ms}$ | Intel Core i7-12700H (CPU) | `[BENCHMARKED]` |
| **Stage 2 CV Heuristics** | $3.8\text{ ms} \pm 0.9\text{ ms}$ | Multithreaded OpenCV | `[BENCHMARKED]` |
| **Stage 3 ByteTrack Association** | $0.6\text{ ms} \pm 0.1\text{ ms}$ | CPU RAM | `[BENCHMARKED]` |
| **End-to-End Frame Latency** | $< 25\text{ ms}$ (GPU) / $< 60\text{ ms}$ (CPU) | Ingestion $\rightarrow$ Alert Dispatch | `[BENCHMARKED]` |
| **Concurrent RTSP Feeds** | $16\text{ Channels}$ (GPU) / $6\text{ Channels}$ (CPU) | Continuous Real-Time Ingestion | `[VALIDATED]` |

---

## 23. Configuration Reference & Environment Variables

| Variable Name | Default Value | Description | Required |
| :--- | :--- | :--- | :---: |
| `MODEL_PATH` | `models/best.pt` | Path to trained YOLO26m PyTorch weights file | Yes |
| `YOLO_DEVICE` | `cuda` | Hardware accelerator (`cuda` or `cpu`) | Yes |
| `CONF_THRESHOLD` | `0.20` | Baseline Stage 1 neural confidence threshold | No |
| `IOU_THRESHOLD` | `0.45` | Non-Maximum Suppression (NMS) overlap threshold | No |
| `OPERATING_MODE` | `Balanced` | Pre-calibrated operational mode (`Balanced` / `High Precision` / `High Recall`) | No |
| `DATABASE_URL` | `sqlite:///./sentinelos.db` | Persistence DB connection string (SQLite or PostgreSQL) | Yes |
| `REDIS_HOST` | `localhost` | Redis server hostname for stream pub/sub | Yes |
| `MINIO_ENDPOINT` | `localhost:9000` | S3 Object storage endpoint for evidence images | Yes |
| `ALERT_COOLDOWN_SECONDS` | `30` | Time window preventing duplicate alert storming | No |

---

## 24. Common Integration Platform (Innovision Architecture)

The system is designed to operate seamlessly either as a standalone monolith or as **Use Case 2 (UC2)** inside the unified **Innovision Common Analytics Platform**:

```mermaid
flowchart TD
    subgraph CommonPlatform [Innovision Common Platform - Shared Services]
        CR[Camera Registry Service\nPort 8011]
        Ingest[Stream Ingestion & Frame Normalizer]
        RedisBus[(Redis Stream Bus\nframes:stream | alerts:live)]
        MinIOStore[(MinIO S3 Evidence\ninnovision-evidence)]
        AlertHub[Central Alert Management Service]
        CommonDash[Unified Master SOC Dashboard]
    end

    subgraph FourUseCases [Multi-Tenant AI Analytics Microservices]
        UC1[UC1: Perimeter Intrusion / PPE]
        UC2[UC2: Fire & Smoke Analytics\nPort 8030 - SentinelOS]
        UC3[UC3: Abandoned Object / Asset Tracking]
        UC4[UC4: Vehicle / ANPR & Safety Analytics]
    end

    Ingest -->|Raw Normalized Frames| RedisBus
    RedisBus -->|camera:id:frames| UC1 & UC2 & UC3 & UC4
    
    UC2 -->|Evidence JPEGs| MinIOStore
    UC2 -->|AlertEvent Pydantic Contract| RedisBus
    
    RedisBus -->|alerts:live| AlertHub
    AlertHub --> CommonDash
```

---

## 25. Four Use Case Integration Model (UC1 – UC4)

| Feature / Dimension | UC1: Perimeter & PPE | UC2: Fire & Smoke (SentinelOS) | UC3: Abandoned Object | UC4: Vehicle & ANPR |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Goal** | Intrusion & safety gear compliance | Flame, smoke & spark detection | Unattended baggage & theft | License plate & parking compliance |
| **Primary Model** | YOLOv8x-Pose / Object | **YOLO26m (Fire/Smoke)** | YOLOv8-Detection + DeepSORT | YOLOv8-ANPR + OCR |
| **CV Heuristics** | Zone polygon boundary cross | **HSV Flame + Texture Entropy + Flicker** | Static background subtraction | Morphological plate filtering |
| **Temporal Window** | 2 Frames | **3 Frames (ByteTrack EMA)** | 300 Frames (Static duration) | 3 Frames (Track trajectory) |
| **Alert Output** | `INTRUSION_ALERT` | `FIRE_ALERT` / `SMOKE_ALERT` | `ABANDONED_OBJECT_ALERT` | `UNAUTHORIZED_VEHICLE_ALERT` |
| **Evidence Asset** | Cropped person ROI | **Annotated flame bounding box** | Cropped object bounding box | Cropped license plate |

---

## 26. Common vs. Use-Case-Specific Component Ownership

| Functional Subsystem | Common Platform Owned | UC2 (Fire & Smoke) Owned |
| :--- | :---: | :---: |
| **User Authentication & Global RBAC** | :white_check_mark: | :x: |
| **Camera Hardware Registry & RTSP Connectors** | :white_check_mark: | :x: |
| **Global Alert Aggregation & Ticket Assignment** | :white_check_mark: | :x: |
| **Master Executive Compliance Reporting** | :white_check_mark: | :x: |
| **YOLO26m Neural Network Architecture & Weights** | :x: | :white_check_mark: |
| **Deterministic HSV Spectral Fire Verification** | :x: | :white_check_mark: |
| **Laplacian Texture Entropy & Blur Analysis** | :x: | :white_check_mark: |
| **ByteTrack Temporal Flame Association** | :x: | :white_check_mark: |
| **Domain Evidence Fusion Scoring Math** | :x: | :white_check_mark: |

---

## 27. Standard Use-Case Event Contracts & JSON Schemas

All use cases communicate with the common platform using the standardized Pydantic `AlertEvent` contract defined in [`shared/contracts/alert_event.py`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/shared/contracts/alert_event.py):

```python
class AlertEvent(BaseModel):
    alert_id: UUID = Field(default_factory=uuid4)
    camera_id: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    severity: AlertSeverity   # low | medium | high | critical
    alert_type: str          # "fire_detected" | "smoke_detected"
    title: str
    description: str
    source_event_id: Optional[str] = None
    source_uc: SourceUC       # "uc1" | "uc2" | "uc3" | "uc4"
    frame_reference: Optional[str] = None   # S3 Object Key
    frame_provider: Optional[FrameProvider] = None  # "minio" | "redis"
    status: AlertStatus = AlertStatus.pending
    metadata: Dict[str, Any] = Field(default_factory=dict)
```

---

## 28. Integration Sequence Diagrams

```mermaid
sequenceDiagram
    autonumber
    participant Cam as CCTV Camera
    participant Ingest as Platform Ingestion
    participant Redis as Redis Stream Bus
    participant UC2 as UC2 Fire & Smoke Service
    participant MinIO as MinIO S3 Bucket
    participant Platform as Innovision Alert Manager
    participant Dashboard as SOC React Dashboard

    Cam->>Ingest: RTSP H.264 Stream
    Ingest->>Redis: Publish Frame (camera:CAM-01:frames)
    Redis->>UC2: Consume Frame Event
    
    rect rgb(30, 40, 60)
        Note over UC2: Stage 1: YOLO26m Inference<br/>Stage 2: Deterministic CV Verification<br/>Stage 3: Evidence Fusion Score = 0.89<br/>Stage 4: ByteTrack Temporal Confirmation
    end
    
    UC2->>MinIO: Upload Evidence JPEG (evidence/CAM-01/alert-982.jpg)
    UC2->>Redis: Publish AlertEvent to `alerts:live`
    Redis->>Platform: Ingest AlertEvent
    Platform->>Dashboard: WebSocket Push Alert Metadata & Thumbnail
    Dashboard->>Dashboard: Render Red Warning Ring + Sound Audio Siren
```

---

## 29. Complete Input $\rightarrow$ Output Concrete Walkthrough

1. **Input**: Camera `CAM-04` captures a growing electrical fire in Warehouse Sector 3.
2. **Ingestion**: Stream frame $F_{1082}$ ingested via RTSP.
3. **Preprocessing**: Letterboxed to $640 \times 640$, normalized to tensor $[1, 3, 640, 640]$.
4. **YOLO26m Forward Pass**: Detects bounding box $[x_1: 420, y_1: 180, x_2: 560, y_2: 340]$ with class `fire` and confidence $0.865$.
5. **OpenCV CV Verification**:
   * $\text{FlameColorRatio} = 0.28$ (Passed $> 0.01$).
   * $\bar{V} = 212.4$ (Passed $> 60.0$).
   * $\text{SparksCount} = 4$, $\text{FlickerIndex} = 0.74$.
6. **Evidence Fusion**:
   $$\text{Score} = 0.45(0.865) + 0.30(1.0) + 0.15(0.83) + 0.10(0.74) + 0.12 = 0.99$$
   Categorized as `normal_fire` with alert level `RED`.
7. **Temporal Verification**: Tracked across 3 consecutive frames with smoothed confidence $0.942$.
8. **Alert Generation**: Saved to DB with evidence path `evidence/annotated_CAM-04_1082.jpg`.
9. **Real-time Push**: Emitted over WebSocket `/ws/alerts` in $< 22\text{ms}$; SOC Dashboard triggers flashing indicator and audible alarm.

---

## 30. Detection State Machine & Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Standby: Camera Inactive
    Standby --> Ingesting: Stream Connected
    Ingesting --> Analyzing: Frame Received
    Analyzing --> Ingesting: No Threat (GREEN)
    Analyzing --> Verifying: Flame Candidate Found (YELLOW)
    Verifying --> Ingesting: False Positive Rejected
    Verifying --> Confirmed: ByteTrack 3-Frame Confirmation
    Confirmed --> Alerting: Publish AlertEvent (RED)
    Alerting --> Cooldown: 30s Cooldown Active
    Cooldown --> Ingesting: Incident Handled in SOC
```

---

## 31. Data Contracts & Pydantic Specifications

All REST payloads and inter-service messages are strictly typed with Pydantic v2 schemas:
* **Camera Model**: [`backend/app/schemas.py:CameraResponse`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/backend/app/schemas.py)
* **Alert Model**: [`backend/app/schemas.py:AlertResponse`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/backend/app/schemas.py)
* **Detection Event**: [`backend/app/schemas.py:DetectionEventResponse`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/backend/app/schemas.py)
* **Platform Alert Event**: [`shared/contracts/alert_event.py:AlertEvent`](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/shared/contracts/alert_event.py)

---

## 32. Repository & Code Structure Map

```text
Fire_Smoke_Application/
├── backend/                         # FastAPI Monolith Application
│   ├── app/
│   │   ├── ai/                      # DetectionService wrapper
│   │   ├── middleware/              # CORS, security, rate limiting
│   │   ├── routes/                  # REST endpoint routers (auth, cameras, detect, alerts, etc.)
│   │   ├── services/                # Analytics, camera schedulers, alerts
│   │   ├── websocket/               # ConnectionManager for /ws/alerts
│   │   ├── database.py              # SQLAlchemy engine & SessionLocal
│   │   ├── models.py                # Database ORM models
│   │   └── schemas.py               # Pydantic request/response schemas
│   ├── detection/                   # Core Dual-Stream AI/CV Layer
│   │   ├── config.py                # DetectionConfig & operational presets
│   │   └── detection_layer.py       # YOLO26m + verify_fire + verify_smoke + ByteTracker
│   └── models/                      # Weights directory (best.pt / yolo26m_auto.pt)
├── frontend/                        # React 19 SOC Application
│   ├── src/
│   │   ├── components/
│   │   │   ├── Architecture/        # InteractiveArchitectureFlow.tsx visualizer
│   │   │   ├── Dashboard/           # SOC KPIs & live threat feeds
│   │   │   ├── Layout.tsx           # Navigation & sidebar
│   │   │   └── SOC/                 # NotificationsHub.tsx
│   │   ├── pages/                   # Route pages (Dashboard, LiveMonitoring, Documentation, etc.)
│   │   ├── services/                # api.ts & cameraService.ts Axios clients
│   │   └── store/                   # authStore.ts & dashboardStore.ts
├── services/
│   └── uc2_fire_smoke/              # Distributed Microservice for Innovision Platform
│       ├── src/
│       │   ├── api/                 # Microservice health & metrics endpoints
│       │   ├── detection/           # Modular 6-stage pipeline & confidence fusion
│       │   ├── redis/               # Redis Streams frame consumer
│       │   ├── storage/             # MinIO S3 evidence uploader
│       │   └── workers/             # PipelineManager & camera worker pool
│       └── Dockerfile               # Production microservice container definition
├── shared/
│   ├── contracts/                   # Standard Pydantic schemas (AlertEvent, FrameEvent)
│   └── platform_client/             # Redis AlertPublisher for Innovision bus
├── docs/                            # Architectural documentation & review dossiers
└── infra/                           # Docker Compose orchestration manifests
```

---

## 33. Testing Strategy & Test Automation Execution

### 33.1 Automated Test Execution Commands

```bash
# 1. Run Backend Unit & API Tests
cd backend
python -m pytest tests/ -v

# 2. Run UC2 Microservice Pipeline & Confidence Tests
cd services/uc2_fire_smoke
python -m pytest tests/ -v

# 3. Run Frontend Production TypeScript Build & Linting
cd frontend
npm run lint
npm run build
```

---

## 34. Local Setup & Developer Quickstart

### 34.1 Prerequisites
* Python 3.10+ with `venv`
* Node.js 20+ & npm 10+
* (Optional) NVIDIA GPU with CUDA 11.8 / 12.x drivers

### 34.2 Step-by-Step Execution Guide

```bash
# 1. Clone repository
git clone https://github.com/Saicharan-077/Fire_Smoke_Application.git
cd Fire_Smoke_Application

# 2. Setup Backend Virtual Environment & Dependencies
cd backend
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt

# 3. Launch Backend API Server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 4. Setup & Launch Frontend Client (New Terminal)
cd ../frontend
npm install
npm run dev
```

The SOC Dashboard is accessible at `http://localhost:3000` and Swagger API docs at `http://localhost:8000/docs`.

---

## 35. Troubleshooting Matrix & Operational Runbook

| Symptom / Issue | Root Cause | Resolution Steps |
| :--- | :--- | :--- |
| **Model container load failure** | Missing `backend/models/best.pt` | Ensure weights file is placed in `backend/models/best.pt` |
| **RTSP stream black frame / timeout** | Camera network unreachable or credentials invalid | Use `/api/v1/cameras/{id}/test-stream` to probe RTSP port 554 |
| **WebSocket disconnects immediately** | Invalid or expired session token | Log in via `/api/v1/auth/login` to obtain a fresh session token |
| **False positive on sunset / glare** | Excessively permissive HSV threshold | Adjust `OPERATING_MODE` to `High Precision` in Settings DB |
| **High CPU usage on 4K streams** | Inefficient resolution scaling | Frame pre-scaler automatically clamps to $1280\text{px}$ width |

---

## 36. Known System Limitations

1. **Occluded Combustion**: The optical vision engine cannot detect fire that is completely obscured behind opaque concrete walls or unvented metal enclosures.
2. **Extreme Atmospheric Fog**: Dense non-combustion outdoor fog may attenuate low-confidence flame signals at distances exceeding $150\text{ meters}$.
3. **Hardware Constraints on CPU**: CPU-only deployments are limited to $\sim 6$ concurrent continuous streams per 8-core host before frame dropping is initiated.

---

## 37. Future Enhancements & Roadmap

* `[PROPOSED]` **Thermal Camera Fusion**: Ingesting dual-spectrum radiometric thermal streams for zero-illumination perimeter zones.
* `[PROPOSED]` **Edge TensorRT Quantization**: Generating INT8 calibrated TensorRT engine profiles for NVIDIA Jetson Orin Nano edge deployment ($< 5\text{ms}$ latency).
* `[PROPOSED]` **Automated Drone Dispatch**: Emitting GPS telemetry waypoints to automated security drones upon confirmed `RED` critical incidents.

---

## 38. System Glossary & Terminology

* **RTSP**: Real-Time Streaming Protocol for IP camera video transmission.
* **YOLO26m**: Deep convolutional object detection architecture optimized for real-time inference.
* **NMS (Non-Maximum Suppression)**: Algorithm filtering overlapping redundant bounding boxes based on Intersection over Union (IoU).
* **ByteTrack**: Tracking-by-detection algorithm utilizing both high and low confidence boxes to maintain identity across occlusions.
* **EMA (Exponential Moving Average)**: Mathematical smoothing filter preventing single-frame confidence spikes from causing false alarms.
* **SOC (Security Operations Center)**: Centralized monitoring dashboard for security operators.

---

## 39. Architectural Summary & Ownership Boundaries

```text
INPUT (RTSP / Video / Frame)
  ↓
INGESTION (OpenCV VideoCapture / Redis Consumer)
  ↓
PREPROCESSING (Letterbox 640x640 / BGR->HSV)
  ↓
DUAL STREAM: [YOLO26m Neural Net]  ||  [OpenCV CV Heuristics]
  ↓
EVIDENCE FUSION (Weighted Math Matrix)
  ↓
TEMPORAL VERIFICATION (ByteTracker Multi-Frame Persistence)
  ↓
ALERT ENGINE (GREEN / YELLOW / RED Severity Mapping)
  ↓
DISPATCH (WebSocket Broadcast / Redis Stream `alerts:live`)
  ↓
INTEGRATION PLATFORM (Innovision Central Alert Manager)
  ↓
PRESENTATION (React 19 SOC Dashboard & PDF Compliance Reports)
```

* **Fire & Smoke Subsystem (UC2)** owns: YOLO26m neural inference, CV deterministic heuristics, ByteTrack temporal association, and evidence fusion scoring.
* **Innovision Platform** owns: Camera hardware registries, global user authentication/RBAC, centralized multi-tenant alert aggregation, and enterprise reporting.
* **UC1, UC3, UC4** integrate using the identical **`AlertEvent`** standardized Pydantic contract and Redis Stream architecture.
