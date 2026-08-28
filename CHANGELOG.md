# Changelog

All notable changes to SentinelOS.

---

## [2.0.0] — 2026-07-03

### Added
- **Admin Panel** — Full admin control center with user management, audit logs, system logs, active sessions, and system health
- **RBAC enforcement** — Role-based access on backend routes and frontend navigation
- **User management API** — Create, update, delete, activate, deactivate, reset password
- **Session management** — View and revoke active user sessions
- **Frontend route guards** — `RequireRole` component protects all routes by permission
- **Role-based navigation** — Sidebar shows only accessible pages per role
- **Responsive layout** — Mobile sidebar drawer, improved spacing for all screen sizes
- **Real dashboard metrics** — Camera online/total, model accuracy, system health from API (removed hardcoded values)
- **User `is_active` field** — Account activation/deactivation support
- **Camera operator assignment** — `assigned_operator_id` field on cameras
- **Automatic schema migration** — New DB columns added on startup for existing databases
- **Complete documentation** — SETUP.md, DEMO.md, MODULES.md, API.md, ARCHITECTURE.md, TROUBLESHOOTING.md

### Changed
- Dashboard KPIs now pull live data (model accuracy, camera counts, system health)
- Settings PATCH restricted to administrators (was already backend-enforced, now documented)
- Upload/detection endpoints require operator or administrator role
- Camera/incident/alert mutations require operator or administrator role
- Premium UI refresh for Layout, loading states, and design tokens
- Login blocks deactivated accounts

### Fixed
- Camera count showing X/X instead of online/total
- Hardcoded 99.4% accuracy replaced with computed value
- Register page role selector no longer misleading (backend always creates viewer)
- TypeScript build errors in permission hooks

---

## [1.0.0] — Initial Release

### Added
- YOLOv8 fire/smoke detection (image + video upload)
- Security Operations Center dashboard
- Live Monitoring with webcam and RTSP support
- Alerts & Reports with incident management
- Analytics with charts and CSV/PDF export
- Settings with camera CRUD and AI thresholds
- Profile management with audit logs
- WebSocket real-time alert notifications
- Session-based authentication
- Docker deployment support
- Demo seed data (users, cameras, alerts)
