# SentinelOS — Dashboard loading speed fixes (frontend)
- [x] Update `frontend/src/pages/Dashboard.tsx` to fetch stats + analytics in parallel and render metrics/chart skeletons sooner.
- [x] Update `frontend/src/components/Layout.tsx` + `frontend/src/components/SOC/NotificationsHub.tsx` to defer websocket connect and avoid requesting browser notification permission immediately on mount.
- [x] Verify dashboard loads faster and does not break instant alert popups.
