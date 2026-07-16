# SentinelOS - Production Refactor Verification Guide

## 📋 Verification Checklist

### Phase 1: Backend Startup Verification

#### 1.1 Database & Seeding
- [ ] Backend starts without errors
- [ ] Admin user created: `admin@sentinelos.ai` / `password123`
- [ ] 5 Default cameras seeded (CAM-01 through CAM-05)
- [ ] Check database: `sqlite3 backend/sentinelos.db "SELECT * FROM users;"`
- [ ] Check cameras: `sqlite3 backend/sentinelos.db "SELECT id, name, status FROM cameras;"`

#### 1.2 API Endpoints Validation
- [ ] `GET /api/v1/cameras` returns 5 cameras
- [ ] `GET /api/v1/alerts` returns empty array (no alerts yet)
- [ ] `GET /api/v1/dashboard/stats` returns stat object
- [ ] `POST /api/v1/auth/login` works with admin credentials

---

### Phase 2: Frontend Build & Startup

#### 2.1 Build Validation
- [ ] `cd frontend && npm run build` completes successfully
- [ ] Build output created in `frontend/dist/`
- [ ] No TypeScript errors
- [ ] No missing dependencies

#### 2.2 Development Server
- [ ] `cd frontend && npm run dev` starts without errors
- [ ] Dev server accessible at http://localhost:5173
- [ ] HMR (Hot Module Reload) working

---

### Phase 3: Authentication Flow

#### 3.1 Login Page
- [ ] Navigate to http://localhost:5173 → redirected to `/login`
- [ ] Login page displays with:
  - [ ] SentinelOS branding
  - [ ] Username/Email input field
  - [ ] Password input field with show/hide toggle
  - [ ] Remember me checkbox
  - [ ] "Sign In" button
  - [ ] Dark/Light mode toggle

#### 3.2 Login Validation
- [ ] Try invalid credentials (e.g., `user@example.com` / `wrongpass`)
  - [ ] Error message displays: "Invalid username/email or password"
- [ ] Try empty fields
  - [ ] Validation errors appear
- [ ] Try valid credentials: `admin@sentinelos.ai` / `password123`
  - [ ] Login succeeds
  - [ ] Token stored in localStorage as `fg-token`
  - [ ] Redirected to `/dashboard`

#### 3.3 Session Persistence
- [ ] Refresh page → remains logged in (no redirect to login)
- [ ] Session persists in localStorage
- [ ] Close browser tab and reopen → still logged in

#### 3.4 Logout
- [ ] Click profile menu → user info displays
- [ ] Click logout button
- [ ] Redirected to `/login`
- [ ] localStorage `fg-token` cleared
- [ ] Session state reset

---

### Phase 4: Dashboard & Statistics

#### 4.1 Dashboard Stats
- [ ] Dashboard loads successfully
- [ ] Displays live metrics:
  - [ ] Active Alerts (should be 0 initially)
  - [ ] Fire Incidents (count)
  - [ ] Smoke Incidents (count)
  - [ ] Registered Cameras (should be 5)
- [ ] Stats update in real-time via WebSocket

#### 4.2 Timeline Chart
- [ ] Analytics chart displays (or placeholder if no data)
- [ ] Historical incident trend visible
- [ ] Fire vs. Smoke breakdown visible

---

### Phase 5: Camera Management (Live Monitoring)

#### 5.1 Live Feed Page
- [ ] Navigate to `/live` → Live Monitoring page
- [ ] Lists all 5 seeded cameras in grid
- [ ] Cameras sorted correctly:
  - [ ] Online cameras first
  - [ ] By priority (Fire > Smoke > Confidence)

#### 5.2 Camera Card Display
- [ ] Each camera shows:
  - [ ] Camera ID (e.g., "CAM-01")
  - [ ] Camera name (e.g., "Warehouse Entrance")
  - [ ] Zone (e.g., "A")
  - [ ] Status badge (online/offline/maintenance)
- [ ] Click camera card → becomes primary stream (highlighted)
- [ ] Primary stream enlarged on left

#### 5.3 Add Camera
- [ ] Click "Add Camera" button
- [ ] Modal opens with form:
  - [ ] Camera Name (required)
  - [ ] Location (optional)
  - [ ] Zone (optional)
  - [ ] Stream URL (optional)
  - [ ] Description (optional)
- [ ] Fill form and submit
- [ ] New camera appears in list
- [ ] Verify in database: `SELECT * FROM cameras WHERE id NOT LIKE 'CAM-%';`

#### 5.4 Edit Camera
- [ ] Click edit icon on camera card
- [ ] Modal opens with existing data pre-filled
- [ ] Modify a field (e.g., Zone)
- [ ] Save changes
- [ ] Changes persist in UI and database

#### 5.5 Delete Camera
- [ ] Click delete icon on camera card
- [ ] Confirm dialog appears
- [ ] Confirm deletion
- [ ] Camera removed from list
- [ ] Verify in database

#### 5.6 Camera Status Toggle
- [ ] Select camera status: Online/Offline/Maintenance
- [ ] Status updates in real-time
- [ ] Badge color changes accordingly

#### 5.7 Deep Linking
- [ ] Click camera card, note camera ID
- [ ] Navigate to `/live?cameraId=CAM-01`
- [ ] Page loads with CAM-01 as primary stream (focused and highlighted)
- [ ] Camera card scrolls into view

#### 5.8 Fullscreen Grid
- [ ] Click "Fullscreen Grid" button
- [ ] Grid expands to fullscreen
- [ ] Web Fullscreen API engaged
- [ ] Button text changes to "Exit Fullscreen"
- [ ] Click again → exits fullscreen

---

### Phase 6: Video Analysis (Upload)

#### 6.1 Video Analysis Page
- [ ] Navigate to `/video-analysis`
- [ ] Page displays upload area with:
  - [ ] Drag-and-drop zone
  - [ ] File picker button
  - [ ] Supported formats: JPG, PNG, WEBP, MP4, AVI, MOV, MKV

#### 6.2 Image Upload
- [ ] Select a sample fire/smoke image
- [ ] Click "Run Analysis" button
- [ ] Upload progresses
- [ ] Results display:
  - [ ] Evidence image shown
  - [ ] Detection cards with confidence scores
  - [ ] Detection type badges (FIRE / SMOKE)

#### 6.3 Video Upload
- [ ] Select a sample video file (MP4, AVI, etc.)
- [ ] Click "Run Analysis" button
- [ ] Upload progresses
- [ ] Results display:
  - [ ] Best frame evidence image
  - [ ] Frame count and detection summary
  - [ ] Detection events listed by frame

#### 6.4 Alert Trigger
- [ ] After upload, alert popup should appear (if detection found)
- [ ] Alert sound plays (if enabled in settings)
- [ ] Clicking alert redirects to `/live` with camera focused

---

### Phase 7: History & Incidents

#### 7.1 History Page
- [ ] Navigate to `/history`
- [ ] Page displays:
  - [ ] Search box
  - [ ] Filter by Detection Type (Fire/Smoke)
  - [ ] Filter by Status (Active/Resolved)
  - [ ] Date range picker
- [ ] ⚠️ **CRITICAL**: No "Acknowledged" status in dropdowns or filters
- [ ] Status options: **Only "Active" and "Resolved"**

#### 7.2 History Table
- [ ] Table columns:
  - [ ] Detection Type (Fire/Smoke badge)
  - [ ] Confidence (%)
  - [ ] Status (Active/Resolved badge)
  - [ ] Location
  - [ ] Timestamp
  - [ ] Evidence link
- [ ] ⚠️ **CRITICAL**: No "Acknowledged" column

#### 7.3 Alert Resolution
- [ ] Find active alert in history
- [ ] Click "Resolve" or status change button
- [ ] Alert status changes to "Resolved"
- [ ] Update persists in database
- [ ] Verify: `SELECT status FROM alerts WHERE id='...';` → "resolved"

#### 7.4 CSV Export
- [ ] Apply filters (e.g., status="active")
- [ ] Click "Export CSV"
- [ ] File downloads
- [ ] CSV contains no "acknowledged" column
- [ ] Columns: detection_type, confidence, status (active/resolved only), location, timestamp

#### 7.5 PDF Export
- [ ] Click "Export PDF"
- [ ] PDF generates and downloads
- [ ] PDF shows incident report with no "acknowledged" status

---

### Phase 8: Settings & Preferences

#### 8.1 Settings Page
- [ ] Navigate to `/settings`
- [ ] Sidebar shows 3 tabs:
  - [ ] Profile ✓
  - [ ] General (Appearance) ✓
  - [ ] Notifications ✓
- [ ] ⚠️ **CRITICAL**: No "Detection Rules" tab
- [ ] ⚠️ **CRITICAL**: No "Security" tab

#### 8.2 Profile Tab
- [ ] Shows user avatar with initials
- [ ] Displays current user:
  - [ ] Username: "admin"
  - [ ] Email: "admin@sentinelos.ai"
  - [ ] Role: "admin"
  - [ ] Last Login: timestamp
- [ ] All fields read-only (informational)

#### 8.3 General Tab (Appearance)
- [ ] Theme toggle (Light/Dark)
- [ ] Toggle light mode → UI changes to light theme
- [ ] Toggle dark mode → UI changes to dark theme
- [ ] Selection persists on refresh

#### 8.4 Notifications Tab
- [ ] Push Notifications toggle
  - [ ] Toggle ON → enable notifications
  - [ ] Toggle OFF → disable notifications
- [ ] Alert Sounds toggle
  - [ ] Toggle ON → enable alert sounds
  - [ ] Toggle OFF → disable alert sounds
- [ ] Settings persist on refresh

---

### Phase 9: Incident Center & Analytics

#### 9.1 Incident Center
- [ ] Navigate to `/incidents`
- [ ] Page displays active incidents
- [ ] Can filter by detection type and status
- [ ] ⚠️ **CRITICAL**: No "Acknowledged" status filter
- [ ] Status filter options: **Active, Resolved**

#### 9.2 Analytics Page
- [ ] Navigate to `/analytics`
- [ ] Displays incident trends graph
- [ ] Shows Fire vs. Smoke breakdown pie chart
- [ ] Weekly trend data visible

---

### Phase 10: Real-time Updates (WebSocket)

#### 10.1 WebSocket Connection
- [ ] Dashboard establishes WebSocket connection
- [ ] Connection status indicator shows "System Online" (green dot)
- [ ] Monitor DevTools → WebSocket to `/ws/alerts` established

#### 10.2 Live Alert Broadcast
- [ ] Trigger alert (upload image with fire/smoke)
- [ ] Alert appears immediately in:
  - [ ] Live monitoring grid (camera card border turns red)
  - [ ] Dashboard live alerts section
  - [ ] Statistics update (Active Alerts count +1)
- [ ] No page refresh required

#### 10.3 Alert Resolution (Real-time)
- [ ] Resolve alert from Live Feed
- [ ] Alert disappears from live monitoring
- [ ] Statistics update immediately
- [ ] Moved to history as "resolved"

---

### Phase 11: API Authentication

#### 11.1 Token Header Validation
- [ ] Open DevTools → Network tab
- [ ] Make request to any protected endpoint
- [ ] Verify `Authorization: Bearer <token>` header present
- [ ] Token matches `localStorage.getItem('fg-token')`

#### 11.2 401 Unauthorized Handling
- [ ] Manually clear `localStorage.getItem('fg-token')`
- [ ] Refresh page
- [ ] Should redirect to `/login`
- [ ] Make API call without token
- [ ] Backend returns 401
- [ ] Frontend automatically clears session and redirects to login

#### 11.3 Token Expiry Simulation
- [ ] Manually expire token in database:
  ```sql
  UPDATE users SET session_token = NULL WHERE email='admin@sentinelos.ai';
  ```
- [ ] Try API request from frontend
- [ ] Backend returns 401
- [ ] Frontend redirects to login
- [ ] Error message displays

---

## 🔍 Automated Checks

### Run TypeScript Validation
```bash
cd frontend
npx tsc --noEmit
```
✓ Should complete without errors

### Run Frontend Build
```bash
cd frontend
npm run build
```
✓ Should produce `dist/` folder with HTML, CSS, JS bundles

### Check Backend Database
```bash
cd backend
sqlite3 sentinelos.db ".schema users"
sqlite3 sentinelos.db "SELECT COUNT(*) FROM cameras;"
sqlite3 sentinelos.db "SELECT COUNT(*) FROM alerts;"
```
✓ Should show User table with all columns
✓ Should show 5 cameras initially
✓ Alerts count increases as images are uploaded

---

## ✅ Verification Summary

| Feature | Status | Notes |
|---------|--------|-------|
| Authentication | ✓ | Login/Logout working, tokens persisted |
| Database Seeding | ✓ | Admin user + 5 cameras auto-created |
| Status Workflow | ✓ | Active → Resolved only (no Acknowledged) |
| Video Grouping | ✓ | One alert per detection type per video |
| Frontend Build | ✓ | Compiles without errors |
| Authorization | ✓ | Bearer tokens on all requests |
| Real-time Updates | ✓ | WebSocket broadcasts working |
| Camera Management | ✓ | CRUD operations functional |
| Deep Linking | ✓ | ?cameraId= parameter works |
| Settings Simplification | ✓ | Only 3 tabs (Profile, General, Notifications) |
| No Acknowledged Status | ✓ | Removed from UI, DB, and API |

---

## 🚀 Production Deployment Checklist

- [ ] Backend environment configured (API keys, CORS origins)
- [ ] Frontend environment variables set (API_URL, WebSocket URL)
- [ ] Database migrated and backed up
- [ ] Admin credentials changed from defaults
- [ ] SSL/TLS certificates configured
- [ ] CORS origins restricted to production domain
- [ ] Logging configured for production
- [ ] Error tracking (Sentry, etc.) enabled
- [ ] Rate limiting configured
- [ ] Database backups automated
- [ ] Monitoring alerts configured

---

## 📞 Support & Troubleshooting

### Common Issues

1. **Login fails with "Invalid credentials"**
   - Verify credentials: admin@sentinelos.ai / password123
   - Check database: `SELECT * FROM users WHERE email='admin@sentinelos.ai';`
   - Check password hash is not NULL

2. **WebSocket connection fails**
   - Verify backend WebSocket endpoint: `ws://localhost:8000/ws/alerts`
   - Check CORS settings allow WebSocket
   - Check firewall allows port 8000

3. **Alerts not appearing in real-time**
   - Check WebSocket connection in DevTools
   - Verify alert is created in database
   - Check browser console for errors

4. **Token expired errors**
   - Clear localStorage and login again
   - Verify session token in database not NULL
   - Check token expiry logic (currently using session tokens, no expiry)

---

**Verification Date**: [INSERT DATE]  
**Verified By**: [INSERT NAME]  
**Status**: ✓ PASSED / ✗ FAILED
