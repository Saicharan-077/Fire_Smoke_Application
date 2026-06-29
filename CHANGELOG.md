# Changelog — FireGuard AI

All notable changes to the FireGuard AI project are documented in this file.

---

## [1.1.0] — 2026-06-29

### Added
- **Unified Ingest Detection Tab Grid**: Combined Image, Video, Webcam, and RTSP stream ingest controls into a single tabbed [Detection.tsx](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/frontend/src/pages/Detection.tsx) page.
- **Unified Alerts & Reports Dashboard**: Consolidated Alert Queue, Incident Center, and Incident Reports into a tabbed [AlertsReports.tsx](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/frontend/src/pages/AlertsReports.tsx) page with PDF/CSV export triggers.
- **Unified Analytics & History**: Consolidated History log table, date range filters, and Recharts trends/distribution charts into [AnalyticsMerged.tsx](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/frontend/src/pages/AnalyticsMerged.tsx).
- **Consolidated Settings**: Consolidated General, AI model, notification, and Camera CRUD settings into [SettingsMerged.tsx](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/frontend/src/pages/SettingsMerged.tsx).
- **Consolidated Profile**: Combined profile edit, password update, and user audit logs list into [ProfileMerged.tsx](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/frontend/src/pages/ProfileMerged.tsx).
- **Strict YOLOv8 Model Class Validation**: Implemented verification inside `DetectionService` to confirm `model.names` contains `fire` and/or `smoke`, and strictly rejects COCO or unrelated classes.
- **DevOps Assets**: Added `PROJECT_STRUCTURE.md`, `API_DOCUMENTATION.md`, and `DEPLOYMENT.md`.

### Fixed
- **Live Monitoring Ingest**: Fixed loading issues on the live monitoring page (now [LiveMonitoring.tsx](file:///c:/Users/Sai%20Charan/OneDrive/Desktop/Fire_Smoke_Application/frontend/src/pages/LiveMonitoring.tsx)), linking camera device lists and live webcam feeds.
- **APP_CONFIG Import Mismatches**: Fixed imports across multiple pages to point to `src/config/appConfig.ts`.
- **False Positive Detections**: Increased confidence thresholds (Fire to 0.35, Smoke to 0.40) and restricted bounding box drawings to only `fire` and `smoke` classes.

### Removed
- Removed 9 duplicate/consolidated pages: `ImageDetection.tsx`, `VideoDetection.tsx`, `VideoAnalysis.tsx`, `LiveFeed.tsx`, `Alerts.tsx`, `IncidentCenter.tsx`, `IncidentReports.tsx`, `History.tsx`, `DetectionHistory.tsx`.
- Reduced sidebar navigation items to exactly **7 items**: Dashboard, Detection, Live Monitoring, Alerts & Reports, Analytics, Settings, and Profile.
