# Dashboard Migration — Decisions Log

Running log of decisions made autonomously while executing steps 3–9 of
`DASHBOARD_MIGRATION_PLAN.md`, per standing instruction to log and continue
rather than pause for confirmation on each one. Each entry: what was decided,
why, and what would need to change if the call was wrong.

---

## D1 — Video-upload stays on the legacy path (pre-demo)

**Decision:** Detection.tsx's video-upload flow (`uploadVideoAsync`,
live WS preview/telemetry) is NOT migrated to the pipeline in this pass.

**Why:** the pipeline's `/v1/detect/video` job has no equivalent to the
legacy path's annotated-output-video assembly, thumbnail, or live per-frame
WS telemetry (fps/inference_fps/skipped_frames/active_tracks/eta_sec) — these
require new pipeline-side capability that doesn't exist. Forcing it now would
mean either a half-working results panel or reading fields that don't exist.

**Tracked as a separate item** in `TODO_ACTION_ITEMS.md` (added below).

**If wrong:** revisit once the pipeline gains annotated-video assembly and/or
a WS progress stream for video jobs — until then this is a hard capability
gap, not a preference.

---

## D2 — Per-page feature flags, not one global flag

**Decision:** `PIPELINE_FLAGS.{detection,liveMonitoring,dashboard,alerts}`,
each independently settable, `VITE_USE_PIPELINE` as a fallback only.

**Why:** flipping one flag to test one page must not silently move
not-yet-verified pages onto the new backend.

**Status:** implemented, unchanged.

---

## D3 — Demo: Dashboard/LiveMonitoring stayed on legacy path; only Detection's flag flipped

**Decision (made under 30-minute demo time pressure):** kept
`VITE_USE_PIPELINE_DASHBOARD` and `VITE_USE_PIPELINE_LIVE_MONITORING` off so
the Alert Log page's pop-up/log/evidence/beep flow (proven, pre-existing)
wasn't put at risk by `AlertsReports.tsx` not yet reading pipeline alerts.
Flipped only `VITE_USE_PIPELINE_DETECTION` on, and pointed Calibration +
Detection's pipeline branch at one hardcoded demo camera UUID.

**Now that the demo is over, this needs revisiting** — see D6 below.

---

## D4 — Hardcoded `DEMO_PIPELINE_CAMERA_ID` in Detection.tsx

**Decision (demo-time):** a literal UUID constant, registered once by hand,
so Detection's webcam loop and the Calibration tab observed the same camera.

**Why it was necessary then:** the pipeline requires a real registered
`camera_id` (server-generates a UUID via `POST /v1/cameras`); the legacy path's
literal string `'webcam-01'` doesn't correspond to any registered camera on
the pipeline side, so calibration would have silently logged zero observations
forever — a real bug that was caught live before it broke the demo.

**Revisited now — see D6.**

---

## D5 — Cleaned up stale test cameras/zones from earlier `test_api_integration.py` runs

**Decision:** deleted 12 leftover "Test Camera A/B" registrations that were
cluttering the Calibration camera dropdown. Left the equally-stale test zones
(`chemical_storage`/`break_area`, ~12 duplicates) alone — no UI currently lists
all zones, so they're inert clutter in a table, not a demo-visible problem.

**If revisited:** a zone-list admin view would need the same cleanup, or a
`DELETE /v1/zones/{id}` endpoint (doesn't exist yet) to do it properly instead
of via direct DB access.

---
## D6 — Replaced hardcoded demo camera UUID with self-registering-by-name

**Decision:** removed `DEMO_PIPELINE_CAMERA_ID` (the hand-registered UUID
baked into Detection.tsx for the demo). Added
`getOrRegisterPipelineCamera(name)` to `pipelineApi.ts` — looks up a pipeline
camera by name, registers it once if missing, caches the resolved id
in-memory. Applied to all three pages' webcam loops, each under its own
stable name (`Detection Page Webcam`, `Live Monitoring Webcam`,
`Dashboard CAM-01 Webcam`), so each keeps distinct Gate/tracking/calibration
state on the pipeline side rather than colliding on one shared identity.

**Why the demo shortcut was wrong to keep:** a single hardcoded UUID means
every browser session/page shares literally the same pipeline camera —
correct for a one-machine demo, wrong the moment there's more than one
operator or page active at once.

**Verified live:** typecheck clean, brace-balance clean, browser-tested —
Detection page's pipeline path and the Calibration tab both resolve to the
same real camera without any hardcoded id in source.

---

## D7 — Finished Dashboard.tsx's fabricated-metrics fix (step 6, completed)

**Decision:** replaced the two remaining fabricated/hardcoded spots in
Dashboard.tsx, flag-gated so the legacy (flag-off) path is byte-identical to
before:

1. **"AI Core Status" widget** — `Model Name`/`Engine Hardware` now read live
   from `pipelineModelInfo()` when `PIPELINE_FLAGS.dashboard` is on, falling
   back to the old static "YOLOv8s Fire-Smoke"/"CPU Core" strings otherwise.
2. **Per-camera metrics overlay** — polls real `pipelineGateStats()` for the
   one camera actually wired to the pipeline (CAM-01, via
   `getOrRegisterPipelineCamera`). `pixel_change_pct`/`motion_score` are both
   derived from the Gate's one real `change_score` signal (two unit
   conventions of the same number, not two invented numbers).
   `target_fps`/`actual_fps`/`dropped_frames`/`queue_size` are concepts the
   real Gate doesn't track (they belonged to the old scheduler's fictional
   6-state model, confirmed dead code in the original investigation) — set to
   `0`, not guessed at. Cameras with no pipeline presence (CAM-02 through
   CAM-05, seeded mock data only) show **"No pipeline data for this
   camera"**, not a plausible-looking fake number.

**Verified live in browser**, flag on: `MODEL NAME: yolo26s
(fire/smoke/sparks)`, `ENGINE HARDWARE: CUDA` (both real, both previously
hardcoded and wrong — the checkpoint is YOLO26s, this dev machine has a real
GPU). CAM-01 tile shows real (near-zero, correctly) telemetry; CAM-02/03/04/05
correctly show "No pipeline data for this camera". Zero console errors.

**This closes the original investigation's headline Dashboard finding**
(`setMetricsMap` was declared and never called; every tile rendered a
hardcoded literal regardless of real camera state) for the flag-on path.

---
## Checklist run — Detection.tsx (D1–D6, `DASHBOARD_MIGRATION_PLAN.md` §5)

Requested retroactively before trusting the same repoint pattern on
LiveMonitoring/Dashboard. Real results below, not "should work" — each row
cites what was actually observed.

| # | Check | Result | Evidence |
|---|---|---|---|
| D1 | Upload a fire image → detection boxes drawn | **N/A for this pass** | Single-image upload tab uses `uploadImage` unconditionally (legacy) — never branched; only the continuous-webcam loop was migrated. Not a regression: unchanged behavior. |
| D2 | Upload a non-fire image → no alert | **N/A**, same reason as D1 | — |
| D3 | Webcam → live boxes appear | **PARTIAL PASS** | No physical camera in this environment to drive real `getUserMedia` capture. Verified the underlying call path directly instead: submitted 8 real fire frames via script under the exact `camera_id` the webcam loop resolves to (`getOrRegisterPipelineCamera('Detection Page Webcam')`) — pipeline processed them (18 confirmed detections), proving the code path Detection.tsx's webcam loop calls is real and functioning. Did not observe the canvas box-drawing itself render, since no live frames were ever captured by a browser camera. |
| D4 | Upload a video → job progresses to 100% | **Not attempted** — out of scope, see TODO D4 | Video-upload intentionally stays on legacy path this pass |
| D5 | Cancel a running video job | **Not attempted**, same reason | — |
| D6 | Model name shown in UI reads from API | **PASS for Dashboard**, not yet done on Detection | Dashboard.tsx's "AI Core Status" widget verified live: `yolo26s (fire/smoke/sparks)` / `CUDA`, replacing hardcoded "YOLOv8s"/"CPU Core". Detection.tsx has no equivalent model-name display element to wire — checked, none exists on this page. |

**Honest summary:** D1/D2/D4/D5 don't apply to what was actually migrated
(image-upload and video-upload stayed legacy by design). D3 is proven at the
API-call level but not observed rendering in a real browser webcam feed,
because no camera hardware exists in this environment — that gap is disclosed,
not silently assumed passing. D6 is fully verified, on Dashboard rather than
Detection specifically (Detection has no such UI element).

**What this means for trusting the "same pattern" on LiveMonitoring/Dashboard:**
the shared code (`toLegacyDetectionShape`, `getOrRegisterPipelineCamera`,
the branching structure itself) is now proven three ways: end-to-end through
a real browser for Calibration + Dashboard's metrics/model-name display, and
at the API-call level for Detection's webcam loop. The one thing genuinely
unverified across all three pages is real `getUserMedia` webcam capture
feeding a live canvas loop — that requires physical camera hardware this
environment doesn't have, and is the same limitation for all three pages
equally, not something LiveMonitoring/Dashboard add on top of Detection.

---
## Checklist run — LiveMonitoring.tsx (L1–L4)

| # | Check | Result | Evidence |
|---|---|---|---|
| L1 | RTSP connect → video renders | **Not touched, not tested** | RTSP path untouched by this migration — legacy `RtspStreamPlayer` unchanged |
| L2 | `stream_fps` ≠ `inference_fps` | **N/A** | Same reason — RTSP decoupling is pipeline-side production behavior, unrelated to this page's webcam-loop migration |
| L3 | Detections overlay on the stream | **Same status as Detection D3** | Code path verified: 4 real frames submitted under this page's exact resolved camera identity (`Live Monitoring Webcam` → real pipeline camera_id), 9 confirmed detections returned. Canvas rendering itself unverified — no camera hardware in this environment. |
| L4 | Disconnect releases the capture | **Not touched** | RTSP disconnect path untouched |
| — | Page loads, no crash | **PASS** | Live browser check: renders cleanly, zero console errors, static-text fix ("Global AI vision core...") confirmed live |

---

## D8 — AlertsReports.tsx: dual-read (Option A), step 7 completed

**Decision:** merged pipeline alerts into the existing `alerts` array rather
than a second table/tab. `fetchAlerts()` now fetches legacy (`getAlerts`) and,
when `PIPELINE_FLAGS.alerts` is on, pipeline alerts (`pipelineListAlerts` +
`pipelineAlertLifecycleBatch`) in parallel, tags each row `source: 'legacy' |
'pipeline'`, and concatenates. This was the Option A design approved earlier
("reversible and lowest blast radius") — now implemented, not just planned.

**Key implementation choices, and why:**
1. **Evidence resolved once, at fetch time, not in JSX.** Pipeline evidence
   needs an async signed-token mint (`pipelineEvidenceUrl`); the existing
   render path calls the legacy `evidenceUrl()` synchronously in three JSX
   spots. Rather than making those three call sites async-aware, the merge
   step resolves the URL once per pipeline alert and stores the finished
   absolute URL directly in `evidence_path` — then a one-line change to
   `evidenceUrl()` in `services/api.ts` (pass an already-absolute URL through
   unchanged instead of prefixing it with `BASE`) means all three existing
   JSX call sites work unmodified for both sources. Smaller, safer diff than
   restructuring the render path.
2. **Lifecycle actions (acknowledge/resolve/escalate) call the dashboard's
   own `/api/v1/pipeline-alerts/*` routes directly** (new `callLifecycle()` in
   `pipelineApi.ts`), NOT through the pipeline-proxy — this state is the
   dashboard's, per `pipeline_alert_routes.py`'s own module docstring ("the
   pipeline owns the alert RECORD, the Dashboard owns the LIFECYCLE").
3. **Resolve PIN handling:** `resolve()` only requires a PIN when the
   operator has `resolution_pin_hash` set (nobody does yet, via the
   `/set-resolution-pin` endpoint built earlier). Rather than building a
   dedicated PIN modal for a currently-empty case, `handleResolveAlert`
   catches the specific 400 "PIN required" response and falls back to
   `window.prompt()`, matching this file's existing lightweight pattern
   (`window.confirm` for delete). **Flagged as a real UX gap once PINs are
   actually adopted** — added to TODO doc.
4. **No delete for pipeline-sourced alerts.** `pipeline_alert_routes.py` has
   no delete endpoint by design (pipeline owns the record). The delete button
   is hidden for `source === 'pipeline'` rows rather than left visible and
   erroring.
5. **Acknowledge/escalate/notes endpoints exist server-side but have no UI
   wired to them in this pass** — the pre-existing UI only ever exposed
   Resolve + Delete for legacy alerts, so this keeps exact feature parity
   rather than adding new UI surface under time pressure. Tracked as a
   follow-up in TODO doc, not a silent gap.

**Verified live** (Claude Browser, real logged-in operator session, real
pipeline data — 237 real alerts in the pipeline's store from this session's
earlier testing):
- Alerts page went from 4 (legacy only) to **104** rows the moment
  `VITE_USE_PIPELINE_ALERTS=true` took effect — legacy and pipeline rows
  correctly interleaved by timestamp, "Source" column reading `Pipeline` vs
  `Stream`/`Image`/`Video` correctly.
- Network tab: every pipeline evidence thumbnail resolved to a real signed
  token URL and returned **200 OK** (checked ~9 requests directly). Two
  unrelated **pre-existing** legacy fixture images (`test_red.jpg`,
  `test_gray.jpg`) fail with `ERR_BLOCKED_BY_ORB` — not caused by this
  change, not touched by this change; noted for the record, not fixed
  (out of scope, pre-existing legacy test data).
- Clicked a real Resolve button on a pipeline-sourced row (JS `.click()`
  used only because the browser-pane's coordinate/viewport tooling was
  unreliable at this screen size, not to fake the interaction — the DOM
  click fires the exact same React handler a mouse click would):
  `POST /api/v1/pipeline-alerts/8eecb5c8.../resolve` → 200, response showed
  `resolved_by: "operator@sentinelos.ai"` (the real logged-in session user),
  `resolution_pin_verified: false` (correct — no PIN set). **Independently
  confirmed by querying the dashboard's own SQLite file directly**
  (`sentinelos.db`, `pipeline_alert_lifecycle` table), bypassing the API
  entirely — row present, `status='resolved'`, same `resolved_by`/timestamp.
  Switching the status filter to "Resolved Alerts" showed the same alert at
  the top of the resolved list in the UI, correctly interleaved with
  legacy resolved alerts.
- Delete button correctly absent on all pipeline-sourced rows (`103` active
  rows after the resolve, `103` Resolve buttons, only `4` Delete buttons —
  matching the 4 legacy seed alerts).
- Zero console errors throughout.

---

## D9 — X1 (graceful degradation) verified with a real, brief pipeline outage

**What happened:** to genuinely test "pipeline unreachable → dashboard
degrades gracefully" rather than just trust the `try/catch` in
`fetchAlerts()`, sent `SIGSTOP` to the pipeline's uvicorn process (PID 13179)
intending a reversible pause-and-resume.

**Real mistake, disclosed:** the harness was independently tracking that same
process as a background task from earlier in the session. `SIGSTOP` caused
its supervisor to treat the process as failed and reap it — `SIGCONT`
afterward found no process to resume; the pipeline was actually down, not
paused. **Immediately restarted it** the normal way
(`uvicorn sentinel_pipeline.api.app:app`, same command as the original
launch). Confirmed fully recovered: `/v1/health` reports `alerts_total: 237`
(no data loss — the pipeline's alert store is persisted, not in-memory-only),
and the Alerts page reloaded to **103** rows (104 minus the one resolved
alert from D8) — also proving the D8 resolve write survived the restart.

**What the outage window itself proved (the actual point of the test):**
while genuinely down, the Alerts page showed **4 warnings logged** — the
legacy-only fallback, not a crash or blank page. Console showed two expected
`502` network-layer log lines (the browser logging the failed fetch
responses) and no uncaught exceptions. This is `fetchPipelineAlertsMerged()`'s
`try/catch` in `fetchAlerts()` (AlertsReports.tsx) working as designed: a
pipeline failure degrades to dashboard-native alerts only, with a toast, not
a broken page.

**Why log this as its own entry rather than folding it into D8:** the
process-management mistake is a genuine incident worth a clear record,
separate from whether the actual migration code being tested passed (it did).

---

## Checklist — AlertsReports.tsx (A1–A7, `DASHBOARD_MIGRATION_PLAN.md` §5) and cross-cutting (B3, X1–X4)

| # | Check | Result | Evidence |
|---|---|---|---|
| A1 | Historical (legacy) alerts still visible | **PASS** | 4 legacy alerts present and correctly tagged `source: 'legacy'` throughout all live checks above |
| A2 | Pipeline alerts now visible, dual-read | **PASS** | 99 real pipeline alerts merged in live; verified filter/sort/search all operate correctly across both sources (see D8) |
| A3 | PIN-gated resolution still works | **PASS for pipeline alerts (new)**; **N/A for legacy** | Pipeline: verified live end-to-end (D8). Legacy: `updateAlertStatus` path unchanged, was never PIN-gated before this migration and still isn't — out of scope to add now, not a regression |
| A4 | Escalation still works | **Server-side only, no UI in this pass** | `pipelineEscalateAlert()` exists and calls a live-tested endpoint (11/11 checks during checkpoint work), but no Escalate button was added to this table — pre-existing UI never had one either. Added to TODO doc as a real gap, not silently dropped |
| A5 | CSV/PDF export still works | **UI presence confirmed live; download itself not triggered** | Reports tab renders correctly (both buttons present, correct copy). Confirmed via source read that both call dashboard-native endpoints (`/api/v1/incidents/export/pdf`, `/api/v1/history/export/csv`) entirely untouched by D8 — not clicked through to an actual file download in this pass (a live download wasn't necessary to confirm no regression, and triggering one wasn't asked for). **Known, disclosed gap:** these exports do NOT include pipeline-sourced alerts — they read only the dashboard's own history/incidents tables, so an export taken today would undercount the same way the B3 stat card does. Not fixed in this pass; same root cause as D5/B3. |
| A6 | Resolving a pipeline alert persists | **PASS** | See D8 — independently confirmed via direct SQLite query, and via D9's restart-survival check |
| A7 | Deleting a pipeline alert is refused, not broken | **PASS** | Delete button hidden for pipeline rows; handler also guards defensively if somehow called (toast explaining why, no request sent) |
| B3 | Dashboard's "Active Alerts" stat count matches `/v1/alerts` | **FAIL — known gap, now disclosed** | Dashboard.tsx's top-level "Active Alerts" stat card reads only `/api/v1/dashboard/stats` (legacy-only) — it was never touched to include the pipeline's alert count. It undercounts by up to 99 alerts on this data. This was NOT part of D7's scope (D7 fixed the AI Core Status widget and per-camera Gate metrics, not this stat card). Added to TODO doc. |
| X1 | Pipeline down → graceful degradation | **PASS**, verified with a real outage | See D9 |
| X2 | Every new alert has evidence | **PASS (pipeline-side guarantee, not re-verified here)** | Enforced server-side in the pipeline's Context Engine per the architecture doc ("no alert is ever written without a real evidence image"); this pass didn't add new alert-writing code, so not re-tested |
| X3 | Auth still gates the dashboard | **PASS** | Every lifecycle/proxy call this pass used the real logged-in session's `fg-token`; `resolved_by` in D8 correctly shows the actual operator username, not a bypass |
| X4 | No console errors across pages | **PASS**, with one disclosed exception | Zero errors on Detection/LiveMonitoring/Dashboard/AlertsReports under normal operation. During the deliberate X1 outage test, two expected `502` network-log lines appeared (not uncaught exceptions) — see D9 |

**Honest summary:** the core migration (A1, A2, A3-pipeline, A6, A7, B3-disclosure,
X1, X3, X4) is verified live with real evidence, including one independently
DB-confirmed write and one genuine (if accidentally harder-mode-than-planned)
outage test. A4/A5/X2 are not regressions but are also not freshly verified
in this pass — disclosed as such rather than assumed passing. B3 is a real,
now-documented gap, not a pass.

---

## D10 — `.env.local`: all four page flags now ON

**Decision:** `VITE_USE_PIPELINE_DETECTION`, `VITE_USE_PIPELINE_DASHBOARD`,
`VITE_USE_PIPELINE_ALERTS`, and `VITE_USE_PIPELINE_LIVE_MONITORING` are all
`true`.

**Why LiveMonitoring was held back, then flipped:** at the time D8/D9 were
written, LiveMonitoring had only been verified at the API-call level (L1-L4
checklist — real frames submitted under its resolved camera identity, real
detections returned), never through an actual browser render with its flag
on. Flipping it on without that check would have been exactly the kind of
"should work since it's the same pattern" claim the user explicitly asked not
to be told. Closed the gap immediately after: restarted Vite with the flag
on, navigated to `/live-monitoring` in a real browser session, confirmed the
page renders cleanly (webcam/RTSP panels, telemetry, recent-warnings list all
present) and checked live network traffic during the load — zero failed
requests, no 502s. (An earlier `onlyErrors` console read showed two 502
lines; cross-checking the network log at the same moment showed only the
pre-existing, unrelated `ERR_BLOCKED_BY_ORB` failures on `test_red.jpg`/
`test_gray.jpg` — the console tool appears to retain messages across
navigations in the same tab, and those two 502s were leftover from the
deliberate D9 outage test on a different page earlier in this same tab's
session, not a fresh failure on this page. Noted so this isn't quietly
asserted as a clean pass without explaining the discrepancy.)

**Still not verified for any page, all four:** real `getUserMedia` webcam
capture feeding a live canvas render loop — no camera hardware in this
environment. Every "webcam path verified" claim in this doc is at the
API-call level, disclosed consistently since the D1-D6 Detection checklist.

---

## D11 — Fixed the D5/D6 undercount gaps (Dashboard stat card, CSV export)

**Decision:** built real fixes rather than leaving both as disclosed-only
gaps, per explicit instruction.

1. **Dashboard "Active Alerts" stat card.** Added `pipelineActiveAlertStats()`
   to `pipelineApi.ts` — fetches pipeline alerts (capped 500) + their
   dashboard-owned lifecycle state, counts active/resolved/fire/smoke using
   the exact same "active = no resolved lifecycle row" definition
   AlertsReports.tsx's dual-read already uses. Dashboard.tsx polls it every
   10s, gated on `PIPELINE_FLAGS.alerts` (not `.dashboard` — this is
   alert-count data, the same domain AlertsReports' flag governs), and adds
   it into the existing `activeAlertsCount`/`activeFiresCount`/
   `activeSmokesCount` computations alongside the legacy `stats` object and
   the live-camera `camThreat` bump that were already there.
2. **CSV export.** Added a third Reports-tab card, "Export Merged CSV (All
   Sources)" — builds a CSV **client-side** in the browser from both
   `getAlerts({})` (legacy, unfiltered) and `pipelineListAlerts` + lifecycle
   batch (pipeline), independent of whatever filter is active on the Live
   Warning Flags tab. Left the two existing legacy-only PDF/CSV exports in
   place but added a visible amber disclosure line on both when
   `PIPELINE_FLAGS.alerts` is on, pointing at the merged export.
3. **PDF export — NOT fixed, disclosed instead.** The existing PDF is a
   server-rendered "certified operational audit log" (letterhead, formatted
   layout) via `/api/v1/incidents/export/pdf`. Replicating that client-side,
   or extending the dashboard backend to query the pipeline mid-export, is a
   materially bigger job than the stat card or CSV — judged out of scope for
   this pass. Disclosed directly in the UI copy, not left silent.

**Verified live, independently cross-checked against real data, not just
"looks right in the UI":**
- Stat card showed **240 Active / 178 Fire / 74 Smoke**. Cross-checked
  against direct SQLite (`alerts` table: 4 active, 8 fire, 7 smoke — legacy)
  and a direct signed pipeline API call (`GET /v1/alerts?limit=500`: 237
  alerts, 170 fire / 67 smoke, 236 active after subtracting the one D8
  resolve). `4+236=240` ✓, `8+170=178` ✓, `7+67=74` ✓ — exact arithmetic
  match, not an approximation.
- CSV export: monkey-patched `URL.createObjectURL` in a live browser session
  to capture the actual `Blob` before the download fired (rather than
  guessing at its contents), read it back with `blob.text()`. Result: 253
  lines total = 1 header + 15 legacy rows + 237 pipeline rows — exactly
  matching the same real counts above (legacy total, not just active, since
  the export intentionally pulls everything).

**Known remaining limitation, disclosed not hidden:** `pipelineActiveAlertStats`
and the CSV export both cap the pipeline fetch at 500 alerts (currently well
above the real 237, so no truncation yet). Past 500, both would silently
undercount without the `truncated` flag being surfaced more prominently than
the small stat-card caption currently does. A real fix needs a dedicated
count/aggregate endpoint on the pipeline side — not built in this pass.

---

## D12 — New dashboard feature: real-time multi-camera calibration + adjacency, and a Zone Data tab

**Decision:** extended `Calibration.tsx` (route `/calibration`, already wired
in App.tsx/Layout.tsx — no new route needed) with a 3-tab shell: the existing
single-camera flow (now "Calibrate"), plus two new tabs in new files
`CalibrationLiveOverview.tsx` and `CalibrationZoneData.tsx`.

**Why this design, grounded in what actually exists server-side** (verified
by reading `sentinel_pipeline/api/app.py`, `context/calibration.py`,
`context/zones.py` directly, not from memory): there is no aggregate
"all cameras' calibration progress" or dedicated adjacency-graph endpoint on
the pipeline. "Live Overview" therefore polls `GET /v1/cameras` every 3s for
every registered camera's `calibration_state`, then fans out
`GET .../calibrate/suggestion` (`Promise.allSettled`) only for cameras
currently `calibrating`, plus `GET /v1/zones` for confirmed adjacency. Two
adjacency sources are drawn with deliberately different line styles so they
are never visually conflated: **confirmed** (solid) from an approved zone's
human-set `adjacent_camera_ids`; **candidate** (dashed) from
`CalibrationManager._adjacency_candidates()` — real behavioural correlation
(≥50% of one camera's triggers co-occur with another's within 3s), computed
automatically but never auto-promoted to confirmed. "Zone Data" is a direct
render of `GET /v1/zones` — every field the severity formula actually reads
(risk_weight, envelope stats, containment polygon, always_on, flammables,
adjacency), no client-side computation.

**Real bug found and fixed during live verification, not left in:**
`CalibrationZoneData.tsx` initially keyed its zone cards by `zone_id`. This
codebase's data model allows multiple cameras to legitimately share one
`zone_id` (`ZoneRegistry.are_adjacent()` treats same-`zone_id`-across-cameras
as adjacency evidence, by design) — `camera_id`, not `zone_id`, is the actual
uniqueness guarantee (`ZoneRegistry._by_camera: dict[str, Zone]`). Against
this session's own stale test data (12+ old "chemical_storage"/"break_area"
zones from earlier `test_api_integration.py` runs, previously noted in D5 as
harmless because no UI listed all zones — this feature is now that UI, so the
clutter became visible), the wrong key produced real React "duplicate key"
console warnings. Fixed by keying on `camera_id`. Caught via live testing
(the fresh-tab console check below), not code review.

**Verified live with real, independently-generated multi-camera data** — not
existing seed data: wrote a one-off script
(`/tmp/.../scratchpad/gen_calibration_demo.py`) that registered 4 new
cameras against the real running pipeline and started real calibration
sessions on all four concurrently ("multiple feeds ingested together," per
the request), submitting real fire/smoke test images:
- **North + South**, fed in lockstep (same instant, 16 rounds) — intended to
  produce real behavioural adjacency. It did: both ended up with each other
  in `adjacency_candidates`.
- **East + West**, fed with a 0.15s/1.9s stagger — *intended* to stay
  uncorrelated as a contrast case, but the stagger was still inside the 3s
  correlation tolerance, so they candidate-correlated too. **Disclosed as a
  test-design mistake on my part, not a pipeline bug** — the correlation
  logic did exactly what it's supposed to do given the actual timing; my
  "independent" framing for these two was wrong, not the system's response
  to it. Still useful for the demo: two separate live candidate pairs to
  visualize instead of one.
- Manually approved North's zone with South declared as a **confirmed**
  adjacent camera, to get one of each edge type on screen simultaneously.
- Opened a **fresh browser tab** (to avoid the same tab's accumulated stale
  console history that caused a false alarm earlier in this session — see
  D9) and confirmed **zero console errors** after the key fix, screenshots
  showing: real green/amber/gray node coloring matching real
  `calibration_state`, a real dashed candidate edge (Zone-B East ↔ West), a
  real solid confirmed edge (Zone-A South ↔ North), and a pre-existing solid
  edge (Test Camera A ↔ B, from earlier session data) — three independent,
  real confirmations that both edge types render correctly from genuinely
  different data sources.
- Live camera cards showed real, changing observation counts (39-40 across
  the 4 new cameras) and correct per-state UI (uncalibrated cameras show the
  "safe default" explainer; calibrated ones show real `risk_weight`).

**New disclosed item, not fixed in this pass:** the Zone Data tab now makes
this session's ~12 stale duplicate test zones visible for the first time (no
UI listed all zones before). Not cleaned up here — no `DELETE /v1/zones/{id}`
endpoint exists (confirmed absent from the route inventory), so a real
cleanup needs either a new pipeline-side endpoint or direct DB access, same
as D5's unresolved note about this. Added to TODO doc.

---

## D13 — Authorized, reviewed, reasoned, logged zone editing

**Decision:** built a full correction path for calibration/zone mistakes,
per explicit instruction: "user should be able to edit zone data if the
system makes a mistake during calibration but this can only be done by
authorized personnel... and before fixing the calibrated values and zones it
needs to ask the user for approval, have a log for that."

**Three layers, each independently enforced and live-verified — not just
designed:**
1. **Authorized only.** Gated by `manage_cameras` permission (administrator/
   admin + operator, not viewer) — reused, not invented: same tier the
   codebase already uses for camera management elsewhere. Enforced at three
   independent layers: the `/calibration` ROUTE itself (pre-existing
   `RequireRole permission="detection"` — a viewer gets a full 403 page,
   confirmed live), the Edit BUTTON (hidden entirely for non-`manage_cameras`
   roles), and the BACKEND (`require_operator` on every zone-edit route,
   confirmed live: a viewer's token gets a real `403` on both
   `POST /api/v1/zone-edits/{id}` and `PUT /api/v1/facility-map/cameras/{id}`).
2. **Ask for approval before applying.** Implemented as a mandatory two-step
   UI flow (`ZoneEditModal.tsx`): fill the form, then a REQUIRED review step
   (`setStep('review')`) shows the exact before/after diff computed
   client-side, with explicit "Back" / "Confirm & Apply" buttons — nothing
   is sent to the server until that second, explicit click. Backend
   additionally requires a real `reason` string (min 8 chars, `422` if
   shorter — confirmed live) as a second, independent gate against
   accidental or unexplained changes.
3. **Have a log for that.** Reused the existing `AuditLog` table/`log_audit()`
   mechanism (not a new table) — every successful edit writes an entry with
   username, exact reason, and a computed field-by-field diff (old→new). A
   new `GET /api/v1/zone-edits/{camera_id}` route (also `require_operator`)
   surfaces just that camera's history, and the Zone Data tab renders it
   inline per zone ("Edit history" expandable panel) so the acting user sees
   the trail without needing full admin access to the site-wide audit log.

**New pipeline-side capability this required** (`sentinel_pipeline`):
`ContextEngine.edit_zone()` (`context/engine.py`) and
`PATCH /v1/cameras/{camera_id}/zone` (`app.py`) — a genuine gap, not
reachable through the existing approve-zone endpoint. Reusing
`POST .../zone` for an edit would have gone through `CalibrationManager
.approve()`, which falls back to a **blank** `NormalEnvelope()` when there is
no live calibration session — meaning re-approving an already-calibrated
zone to fix one field would have silently wiped its envelope/polygon data.
`edit_zone()` is a separate, non-calibration path: `dataclasses.replace()`
on the current `Zone`/`NormalEnvelope`, only supplied fields change,
everything else carried over exactly. Verified live: an envelope-only PATCH
(`{"envelope": {"max_area": 200000}}`) changed only `max_area`
(409600→200000), left `mean_area` (105505.41...) byte-identical.

**Live-verified, real data, independently cross-checked at three layers**
(browser UI → dashboard backend → pipeline's own `/v1/zones` → raw SQLite):
a real risk_weight correction (1.0→0.85) on a real "Chemical Storage" zone,
applied through the actual review-then-confirm UI with a typed reason,
confirmed identically in: the UI's own re-render, a direct
`GET /v1/zones` call to the pipeline, and a direct SQLite read of the
dashboard's `audit_logs` table (bypassing the API and the pipeline both).

**Existing behavior preserved:** confirmed the pre-existing PIN-gated resolve
pattern (checkpoint work, earlier this session) was NOT touched or
duplicated here — this is a separate, new correction path for zone/
calibration DATA, distinct from alert lifecycle actions.

---

## D14 — Facility map: camera placement + geometric field-of-view overlap

**Decision:** built the "geometric seed" adjacency input explicitly
identified as missing in the original investigation
(`TODO_ACTION_ITEMS.md` A2: *"needs a site map that does not exist here"*),
per explicit instruction: upload a real facility map, place cameras on it,
and compute adjacency from **field-of-view overlap** specifically — "not
only... which cameras are side by side or in the same room... it's about
what cameras share a certain field of view and to what extent."

**New dashboard-native data** (`Fire_Smoke_Application-main/backend`,
`models.py` + `facility_map_routes.py`, deliberately NOT on the
pipeline side — this is site configuration, not detection logic):
`FacilityMap` (one active image at a time — re-uploading replaces rather
than accumulates, since placements are keyed by camera_id, not tied to a
specific map's pixel geometry) and `CameraPlacement` (position as %, facing
bearing, FOV angle width, range as % of the map diagonal).

**Geometry, not ML, same as everywhere else in this pipeline's design:**
each camera's FOV is a circular sector approximated as a 26-point convex
polygon; overlap between two cameras is the EXACT intersection via
Sutherland-Hodgman polygon clipping (both sectors convex, so exact, not
approximated) — deliberately hand-rolled rather than adding a geometry
library dependency, matching calibration's own convex-hull approach.
Returns **two asymmetric percentages** (`pct_of_a_fov`, `pct_of_b_fov`), not
one symmetric number — a wide camera's small overlap with a narrow one is a
different fact from each camera's own perspective, and Jaccard-style
collapsing would hide that.

**Never writes to a zone directly.** A computed overlap is surfaced as an
"Apply via <camera>'s zone" suggestion; clicking it opens the exact same
`ZoneEditModal` review-then-confirm-then-log flow as any other zone
correction (D13) — prefilled, never auto-applied. This was a deliberate
design choice to reuse D13's authorization/approval/logging machinery
rather than building a parallel, weaker path for geometric suggestions.

**Live-verified end-to-end, real (if synthetic) data:**
- Uploaded a real 800×600 PNG floor plan through the actual upload UI (built
  via an in-browser `<canvas>` → `Blob` → `File`, assigned to the file input
  via `DataTransfer` and a dispatched `change` event — a real file object
  going through the real upload code path, not a mocked request).
- Placed two real registered cameras by clicking directly on the rendered
  map; the SVG cone overlay drew correctly in real time from the exact
  placement data submitted.
- Backend computed **43.0% / 43.0%** overlap for the two facing, overlapping
  cones — independently re-confirmed via a direct authenticated
  `GET /api/v1/facility-map/overlap` call, exact match with what the UI
  displayed.
- Applied the suggestion through the full review/reason/confirm flow;
  independently confirmed on the pipeline's own `GET /v1/zones`
  (`adjacent_camera_ids` now contains the other camera's real id) and via a
  direct SQLite read of the resulting audit log entry.

**Real process finding, disclosed rather than hidden:** the first attempt to
apply a suggestion failed with real `401`s (visible in the network log) —
caused by an independent `curl` login as the same admin account (used to
verify the overlap percentage from outside the browser) silently
invalidating the browser's own session token. This app keeps one session
token per user row, so a second login anywhere logs out the first. Not a bug
in the new feature — re-authenticating in the browser and retrying
reproduced success cleanly. Worth knowing before parallel-testing the same
account from two places again.

**Scope decisions, disclosed:**
- Placement itself (position/facing/FOV) is authorized-only
  (`manage_cameras`) but NOT reason-logged like a zone edit — placing a
  camera on a map changes no detection/alerting behavior by itself; only
  applying a suggested adjacency does, and that already goes through the
  full D13 path.
- This session verified the MECHANISM with a synthetic test image and two
  test cameras, not a real facility. A real site map and real camera
  placements are still needed from whoever operates the actual deployment —
  tracked in `TODO_ACTION_ITEMS.md` A2.

---

## D15 — Batch-start calibration on multiple cameras at once

**Decision:** the Calibrate tab's camera picker (`Calibration.tsx`) was a
single `<select>` — starting calibration on N cameras meant N separate
manual round-trips through the dropdown. Replaced it with a multi-select
checkbox list (`startSet: Set<string>`) plus "Select all"/"Clear"; "Start
Calibration" now fires `pipelineCalibrateStart` for every checked camera via
`Promise.allSettled` (partial-failure tolerant — reports "started X/Y" if
some fail) and adds all successes to a `calibratingCameras: Set<string>` at
once.

**Why the suggestion/approve detail panel stays single-camera:** approving a
zone is inherently per-camera (one polygon, one risk weight, one zone_id).
Rather than running N parallel suggestion pollers in this tab (duplicating
what `CalibrationLiveOverview` already does well), starting is now
batch-capable but the detail panel keeps a "Viewing details for" dropdown
that focuses on and polls one calibrating camera at a time — switching it
tears down the old poller and starts a new one for the newly-focused camera.
Already-calibrating cameras are greyed out and unselectable in the checklist
(can't double-start), with a `CALIBRATING` badge per row.

**Live-verified, real API calls, not assumed:** checked 4 real registered
cameras (webcam-01, Dashboard CAM-01, Live Monitoring, Test Camera A),
clicked "Start Calibration (4 cameras)" once — network log confirmed **4
separate real `POST .../calibrate/start` calls**, all `200 OK`, fired
together. The Live Overview tab immediately showed all 4 as `CALIBRATING`
with independent real observation counts, alongside the pre-existing
calibrating/calibrated cameras from earlier sessions — proving the batch
start and the existing multi-camera live-polling view compose correctly,
not just that each works in isolation.

---
