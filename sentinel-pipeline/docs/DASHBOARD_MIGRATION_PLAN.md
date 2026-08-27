# Dashboard Migration Plan — FOR REVIEW, NOT EXECUTED

**Status: awaiting approval. No dashboard file has been modified.**
Verified: `find Fire_Smoke_Application-main -newermt <build start>` returns 0 files.

This project has already had two real incidents from unreviewed live-code
changes — a `git checkout` that wiped finished work, and an orphaned function
call that crashed the app. This plan is written to be reviewed line-by-line
before anything runs.

---

## 1. What is actually changing

The dashboard stops running detection and starts *consuming* it.

| Concern | Today | After |
|---|---|---|
| Webcam frames | 3 page loops POST to `/api/v1/upload/image` | 3 page loops POST to pipeline `/v1/detect/frame` |
| Frame skipping | `tick % frameSkip` in each page | Pipeline Gate decides; pages send at a fixed rate |
| Video upload | `/api/v1/upload/video_async` + WS | pipeline `/v1/detect/video` + `/v1/jobs/{id}` |
| RTSP | `/api/v1/detect/rtsp/stream` (embedded pipeline) | pipeline `/v1/cameras/{id}/stream/*` |
| Alerts list | dashboard `alerts` table | pipeline `/v1/alerts` |
| Evidence images | dashboard `/evidence/...` | pipeline `/v1/evidence/{filename}` |
| Model name in UI | hardcoded "YOLOv8" ×9 | `/v1/model/info` |
| Camera tile metrics | hardcoded `14.2 / 0.4` | `/v1/cameras/{id}/gate` |
| **Alert lifecycle** | dashboard | **dashboard — unchanged** |

**Explicitly NOT migrating.** PIN-gated resolution, escalation flags, operator
notes, report/PDF/CSV export, auth, user management, audit logs. These are
alert-*lifecycle* and UI concerns. They stay dashboard-side and key off the
alert IDs the pipeline issues.

---

## 2. The identity problem — read this before approving

**The dashboard's `alerts.id` and the pipeline's `pipeline_alerts.id` are
different UUID spaces.** Existing dashboard rows — including resolved ones with
PINs, escalation flags and operator notes — reference dashboard alert IDs that
the pipeline has never seen.

Three options. **This is the main decision I need from you.**

| Option | What happens to history | Risk |
|---|---|---|
| **A. Dual-read (recommended)** | Alerts & Reports reads pipeline `/v1/alerts` for new alerts and the existing dashboard table for historical ones, merged by timestamp. Old alerts keep their lifecycle state. | Two sources during transition; needs a clear cutover timestamp in the UI |
| **B. Backfill** | Copy existing dashboard alerts into the pipeline DB, remapping IDs | Rewrites live history; the ID remap must also update `incidents.alert_id` and every lifecycle row. Highest blast radius. |
| **C. Clean break** | Pipeline serves only new alerts; old alerts remain visible in a separate "Archive" view | Simplest and safest, but operators lose the unified list |

I recommend **A**. It is reversible, touches no existing rows, and the merge is
a frontend concern rather than a data migration.

---

## 3. Files that change

### 3.1 New files (additive, zero risk)

| File | Purpose |
|---|---|
| `frontend/src/services/pipelineApi.ts` | **New** client for `/v1`. Separate from `api.ts` so the old client is untouched and the boundary is visible in imports. |
| `frontend/src/config/pipelineConfig.ts` | Base URL + optional `X-API-Key`, from env |
| `frontend/src/hooks/usePipelineHealth.ts` | Polls `/v1/health`; drives the fallback flag in §6 |

### 3.2 Modified files

| File | Change | Lines affected (current) |
|---|---|---|
| `pages/Detection.tsx` | Replace `uploadImage(file,'webcam-01')` → `pipelineDetectFrame`; delete `frameSkip` state/ref and the `tick % frameSkipRef.current` gate; replace video-upload flow; read model name from `/v1/model/info` | 4, 72, 183, 326, 359-360, 422, 431, 718 |
| `pages/LiveMonitoring.tsx` | Same webcam-loop swap; delete `frameSkip` | 7, 33, 221-222, 288, 297 |
| `pages/Dashboard.tsx` | Same webcam-loop swap; delete `frameSkip`; **replace the hardcoded `metricsMap` fallback with real `/v1/cameras/{id}/gate` data** | 6, 308, 380, 471-472, 541, 551, 837-855 |
| `pages/AlertsReports.tsx` | `getAlerts` → merged pipeline + dashboard source (§2 option A); `evidenceUrl` → pipeline evidence URL for pipeline-sourced alerts | 9, 11, 52, 379, 462 |
| `components/Common/RtspStreamPlayer.tsx` | Point at pipeline stream endpoints | 13, 32, 35, 73 |
| `components/Dashboard/CameraMetricsOverlay.tsx` | Accept real gate fields; no shape change needed | — |
| `pages/Settings.tsx`, `Documentation.tsx`, `Landing.tsx`, `AdminPanel.tsx` | Replace hardcoded "YOLOv8" strings with a value from `/v1/model/info` | 9 sites total |

**`simulationMode` stays.** It is a demo toggle, not detection logic, and
removing it is scope creep.

### 3.3 Backend code retired — **Phase 3 only, after cutover is confirmed**

| Path | Why |
|---|---|
| `app/routes/upload_routes.py` | `/image`, `/video`, `/video_async`, `/video_job/*` superseded |
| `app/routes/detect_routes.py` | `/rtsp/*`, `/cctv`, `/live` superseded |
| `app/services/camera_scheduler.py` | Superseded by the pipeline scheduler. **Has never run** (`threading` never imported) |
| `app/services/camera_monitor.py` | Dead code — `monitor_cameras_loop` is never called |
| `app/ai/inference_service.py`, `detection/` | Superseded by the pipeline Model stage |
| `legacy/inference_service_backup.py` | Already dead |

**Retire in this order:** stop importing → confirm one week of clean operation →
delete. Do not delete in the same change that repoints the frontend.

---

## 4. Execution order

Each step is independently revertible. **Stop at any step if a check fails.**

| # | Step | Touches live code? | Revert |
|---|---|---|---|
| 0 | `git init` + commit current state | No (additive) | — |
| 1 | Add `pipelineApi.ts`, `pipelineConfig.ts`, health hook | No | Delete files |
| 2 | Add feature flag `VITE_USE_PIPELINE` (default **off**) | No | — |
| 3 | Repoint **Detection.tsx** behind the flag | Yes | Flag off |
| 4 | Verify §5 checklist on Detection | — | — |
| 5 | Repoint **LiveMonitoring.tsx** | Yes | Flag off |
| 6 | Repoint **Dashboard.tsx** incl. real gate metrics | Yes | Flag off |
| 7 | Repoint **AlertsReports.tsx** (§2 option A) | Yes | Flag off |
| 8 | Replace 9 hardcoded "YOLOv8" strings | Yes | Revert commit |
| 9 | Run full §5 checklist with flag ON | — | — |
| 10 | Default flag ON, monitor | Yes | Flag off |
| 11 | **Separate approval** → delete §3.3 backend code | Yes | Revert commit |

**Step 0 is not optional.** Neither `Fire&Smoke/` nor
`Fire_Smoke_Application-main/` is a git repository today. There is no revert
without it, and one of this project's prior incidents was exactly a lost-work
event. I will not start step 1 until step 0 exists.

**The feature flag is the rollback mechanism.** Every step 3–10 is a runtime
toggle, not a code revert.

---

## 5. Cutover checklist — functional equivalence

Each row is a manual check against the CURRENT app first (record the result),
then the migrated one. Equivalence means *the migrated column is no worse*.

### Detection page
| # | Check | Current | Migrated | Pass condition |
|---|---|---|---|---|
| D1 | Upload a fire image → detection boxes drawn | | | Same or more detections |
| D2 | Upload a non-fire image → no alert | | | No false alert |
| D3 | Webcam → live boxes appear | | | Boxes within 2s |
| D4 | Upload a video → job progresses to 100% | | | Completes |
| D5 | Cancel a running video job | | | Stops within 2s (**new capability**) |
| D6 | Model name shown in UI | "YOLOv8" | "yolo26s" | Reads from API |

### Live Monitoring
| # | Check | Pass condition |
|---|---|---|
| L1 | RTSP connect → video renders | Renders |
| L2 | `stream_fps` ≠ `inference_fps` | **Must differ** — equal values mean the decoupling regressed |
| L3 | Detections overlay on the stream | Boxes appear |
| L4 | Disconnect releases the capture | No orphan process |

### Dashboard
| # | Check | Pass condition |
|---|---|---|
| B1 | Camera tiles show gate metrics | **Real values, and they change.** Today they are hardcoded `14.2/0.4` |
| B2 | Tile for a camera with no gate state | Shows "no data", not invented numbers |
| B3 | Active alert count matches `/v1/alerts` | Counts agree |

### Alerts & Reports
| # | Check | Pass condition |
|---|---|---|
| A1 | New alerts appear | Within 5s |
| A2 | Evidence image loads for a pipeline alert | Image renders |
| A3 | **Historical alerts still visible** | Pre-cutover alerts present |
| A4 | **PIN-gated resolution still works** | Unchanged behaviour |
| A5 | **Escalation flag still works** | Unchanged behaviour |
| A6 | CSV/PDF export still works | File downloads |
| A7 | Resolving a pipeline alert persists | State survives refresh |

**A3–A6 are the highest-risk rows.** They are the lifecycle features that must
survive untouched, and they are why §2 needs a decision before step 7.

### Cross-cutting
| # | Check | Pass condition |
|---|---|---|
| X1 | Pipeline down → dashboard degrades gracefully | Error banner, no white screen |
| X2 | Every new alert has evidence | `/v1/health` → `alerts_missing_evidence: 0` |
| X3 | Auth still gates the dashboard | Unchanged |
| X4 | No console errors on any page | Clean |

---

## 6. Rollback plan

| Trigger | Action | Recovery time |
|---|---|---|
| Any §5 check fails | Set `VITE_USE_PIPELINE=false`, rebuild frontend | ~2 min |
| Pipeline unreachable in production | Health hook auto-falls back to the old path for the session | Automatic |
| Data problem in Alerts | Flag off; dashboard table is untouched under option A | ~2 min |
| Something worse | `git revert` the step's commit | ~5 min |

**Automatic fallback (X1).** `usePipelineHealth` polls `/v1/health`; on failure
the client falls back to the legacy endpoints for that session and shows a
banner. This is why §3.3 deletion must NOT happen in the same phase — the
fallback needs the old code to still exist.

**Explicit non-goal:** no automatic failover *back* to the pipeline mid-session.
Recovery is a deliberate reload, so a flapping pipeline cannot flip the
dashboard between two detection backends unpredictably.

---

## 7. What I need from you before executing

1. **Approve or amend §2** — dual-read (A), backfill (B), or clean break (C).
2. **Confirm step 0** — may I `git init` and commit the current state?
3. **Confirm scope** — is `simulationMode` staying? (I assume yes.)
4. **Confirm §3.3 stays out of this phase** — repoint now, delete later, under
   separate approval.
5. **Where does the pipeline run in production?** Same host (`localhost:8100`)
   or separate? Determines CORS and whether `PIPELINE_API_KEY` is required.

I will not touch a dashboard file until these are answered.
