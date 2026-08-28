/**
 * Client for the detection pipeline's public /v1 API.
 *
 * IMPORTANT: this does NOT talk to the pipeline directly. Every call is routed
 * through the dashboard backend's generic proxy
 * (`/api/v1/pipeline-proxy/api/*`), authenticated with the dashboard's own
 * session token -- the same `fg-token` every other dashboard API call uses.
 *
 * Why: the pipeline's raw API key must never reach the browser. If this file
 * attached `X-API-Key` from browser JS, the key would be inlined in plaintext
 * into the shipped bundle -- extractable via dev tools or view-source by
 * anyone with dashboard access, which defeats the entire point of having a
 * pipeline key. The dashboard backend holds that key server-side (from its
 * own environment) and forwards requests; the browser only ever sees the
 * dashboard's own session.
 *
 * Evidence images and the MJPEG stream get dedicated proxy routes rather than
 * the generic one, because neither can be fetched via `fetch()` in the first
 * place -- they're consumed by `<img>`/`<video>` tags, which can only hit a
 * plain URL, never attach a header.
 */

import { APP_CONFIG } from '../config/appConfig';

const DASHBOARD_API_BASE = APP_CONFIG.apiBaseUrl;
const PROXY_BASE = `${DASHBOARD_API_BASE}/api/v1/pipeline-proxy`;

export interface PipelineBBox { x1: number; y1: number; x2: number; y2: number }

export interface PipelineAlert {
  id: string;
  incident_id: string | null;
  camera_id: string;
  track_id: number | null;
  class: string;
  confidence: number;
  severity: string;
  severity_score: number;
  bbox: PipelineBBox | null;
  zone_id: string | null;
  containment_breached: boolean;
  envelope_exceeded: boolean;
  growth_rate: number;
  duration_s: number;
  evidence_ref: string;
  source_type: string;
  trigger_reason: string | null;
  reasoning: Record<string, unknown>;
  timestamp: string | null;
}

export interface PipelineDetectionResult {
  camera_id: string;
  gate_passed: boolean;
  trigger_reason: string | null;
  change_score: number;
  candidates: number;
  tracked: number;
  confirmed: number;
  rejected_false_positive: number;
  escalated_unconfirmed: number;
  detections: Array<{
    track_id: number; camera_id: string; timestamp: string;
    bbox: PipelineBBox; class: string; confidence: number;
  }>;
  alerts: PipelineAlert[];
}

export interface PipelineGateStats {
  camera_id: string; state: string; change_score: number;
  effective_threshold: number; frames_seen: number; frames_passed: number;
  frames_skipped: number; forced_overrides: number; motion_passes: number;
  state_transitions: number; warm: boolean; zone_id: string | null;
  risk_weight: number | null; forced_interval_s: number; risk_tier: string;
  avg_process_ms: number;
}

export interface PipelineModelInfo {
  architecture: string; weights_path: string; device: string;
  classes: Record<string, string>; imgsz: number; conf_threshold: number;
  iou_threshold: number; ultralytics_version: string;
  trained_date: string | null; ready: boolean;
}

export interface PipelineHealth {
  status: string; classifier: string; classifier_is_stub: boolean;
  cameras_gated: number; active_tracks: number; alerts_total: number;
  alerts_missing_evidence: number; active_incidents: number;
  scheduler_running: boolean; scheduler_cameras: number;
  auth: string; contract_version: string;
}

export class PipelineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineUnavailableError';
  }
}

function dashboardAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('fg-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Generic call through the dashboard proxy. `subPath` is pipeline-relative,
 *  e.g. "cameras", "detect/frame", "cameras/abc/calibrate/start". */
async function callProxy<T>(subPath: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${PROXY_BASE}/api/${subPath}`, {
      ...init,
      headers: { ...dashboardAuthHeaders(), ...(init.headers as Record<string, string> ?? {}) },
    });
  } catch (e) {
    throw new PipelineUnavailableError(
      `Detection pipeline unreachable (via dashboard proxy at ${DASHBOARD_API_BASE})`,
    );
  }
  if (res.status === 401) {
    throw new Error('Dashboard session expired or invalid. Please log in again.');
  }
  if (res.status === 403) {
    throw new Error('Your role does not permit this detection action.');
  }
  if (res.status === 502) {
    throw new PipelineUnavailableError('Dashboard could not reach the detection pipeline.');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Pipeline ${subPath} failed: ${res.status} ${detail.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

// --- status ---------------------------------------------------------------

export const pipelineHealth = () => callProxy<PipelineHealth>('health');
export const pipelineModelInfo = () => callProxy<PipelineModelInfo>('model/info');

// --- cameras --------------------------------------------------------------

export interface PipelineCamera {
  camera_id: string; name: string; source_uri: string | null;
  location: string | null; calibration_state: 'uncalibrated' | 'calibrating' | 'calibrated' | string;
  zone_id: string | null; risk_weight: number | null;
}

export const pipelineListCameras = () => callProxy<PipelineCamera[]>('cameras');

export const pipelineRegisterCamera = (body: {
  name: string; source_uri?: string | null; location?: string | null;
}) => callProxy<{ camera_id: string }>('cameras', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Resolve a STABLE pipeline camera_id for one of this app's "virtual"
 * webcam surfaces (Detection page's webcam, Dashboard's CAM-01,
 * LiveMonitoring's webcam) by NAME, registering it once if it doesn't exist
 * yet. Replaces an earlier demo shortcut that hardcoded one literal UUID --
 * that only worked for a single hand-registered camera and would have every
 * browser session collide on the same pipeline-side Gate/tracking/
 * calibration state, which is wrong the moment more than one such surface
 * (or more than one operator) is in play.
 *
 * Cached in-memory per name so repeated calls (e.g. once per webcam frame)
 * don't re-list/re-register on every call -- only the first call per name
 * per page-load hits the network.
 */
const _cameraIdCache = new Map<string, Promise<string>>();

export function getOrRegisterPipelineCamera(name: string): Promise<string> {
  const cached = _cameraIdCache.get(name);
  if (cached) return cached;

  const resolved = (async () => {
    const existing = await pipelineListCameras();
    const match = existing.find((c) => c.name === name);
    if (match) return match.camera_id;
    const created = await pipelineRegisterCamera({ name });
    return created.camera_id;
  })().catch((e) => {
    // Don't poison the cache with a rejected promise -- let the next frame
    // retry instead of permanently failing for the rest of the session.
    _cameraIdCache.delete(name);
    throw e;
  });

  _cameraIdCache.set(name, resolved);
  return resolved;
}

/** Real gate telemetry. Throws on 404 when a camera has no gate state yet --
 *  callers must show "no data" rather than substituting invented numbers. */
export const pipelineGateStats = (cameraId: string) =>
  callProxy<PipelineGateStats>(`cameras/${encodeURIComponent(cameraId)}/gate`);

// --- detection ------------------------------------------------------------

export const pipelineDetectFrame = (
  file: File | Blob, cameraId: string, applyGate = false,
) => {
  const fd = new FormData();
  fd.append('file', file, 'frame.jpg');
  const q = `camera_id=${encodeURIComponent(cameraId)}&apply_gate=${applyGate}`;
  return callProxy<PipelineDetectionResult>(`detect/frame?${q}`, { method: 'POST', body: fd });
};

export const pipelineDetectVideo = (file: File, cameraId: string) => {
  const fd = new FormData();
  fd.append('file', file, file.name);
  return callProxy<{ job_id: string; status: string }>(
    `detect/video?camera_id=${encodeURIComponent(cameraId)}`,
    { method: 'POST', body: fd },
  );
};

export interface PipelineJob {
  job_id: string; status: string; progress_pct: number;
  frames_total: number; frames_processed: number; frames_gated_out: number;
  alerts: PipelineAlert[]; error: string | null;
}

export const pipelineJobStatus = (jobId: string) =>
  callProxy<PipelineJob>(`jobs/${encodeURIComponent(jobId)}`);

export const pipelineCancelJob = (jobId: string) =>
  callProxy<{ job_id: string; status: string; cancelled: boolean }>(
    `jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });

// --- calibration & zones ----------------------------------------------------

export const pipelineCalibrateStart = (cameraId: string, windowHours?: number) =>
  callProxy<{ camera_id: string; started_at: string; window_hours: number; note: string }>(
    `cameras/${encodeURIComponent(cameraId)}/calibrate/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(windowHours !== undefined ? { window_hours: windowHours } : {}),
    },
  );

export interface PipelineEnvelope {
  min_area: number | null; max_area: number | null; mean_area: number | null;
  std_area: number | null; always_on: boolean; area_sigma_tolerance: number;
}

export interface PipelineCalibrateSuggestion {
  camera_id: string; ready: boolean; observation_count: number; elapsed_hours: number;
  polygon?: number[][]; envelope?: PipelineEnvelope;
  observation_count_full?: number; suggested_risk_weight?: number;
  always_on?: boolean; coverage_hours?: number;
  adjacency_candidates?: string[]; notes?: string[];
  requires_human_approval?: boolean; window_complete?: boolean; detail?: string;
}

export const pipelineCalibrateSuggestion = (cameraId: string) =>
  callProxy<PipelineCalibrateSuggestion>(`cameras/${encodeURIComponent(cameraId)}/calibrate/suggestion`);

export const pipelineApproveZone = (cameraId: string, body: {
  zone_id: string; risk_weight: number; name?: string;
  polygon?: number[][]; flammable_materials_nearby?: boolean;
  designated_activity_allowed?: string[]; adjacent_camera_ids?: string[];
}) => callProxy<{ zone: Record<string, unknown>; gate_forced_interval_s: number | null;
  gate_risk_tier: string | null }>(
    `cameras/${encodeURIComponent(cameraId)}/zone`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );

export interface PipelineZone {
  zone_id: string; camera_id: string; name: string; polygon: number[][];
  risk_weight: number; risk_tier: 'high' | 'medium' | 'low';
  flammable_materials_nearby: boolean; designated_activity_allowed: string[];
  envelope: PipelineEnvelope; approved: boolean; adjacent_camera_ids: string[];
  has_containment: boolean;
}

export const pipelineListZones = () =>
  callProxy<PipelineZone[]>('zones');

// --- streams (control only -- pixels go through the dedicated MJPEG proxy) --

export const pipelineStreamStart = (cameraId: string, sourceUri: string, inferenceFps = 4) =>
  callProxy<{ camera_id: string; running: boolean; scheduled: boolean }>(
    `cameras/${encodeURIComponent(cameraId)}/stream/start`
    + `?source_uri=${encodeURIComponent(sourceUri)}&inference_fps=${inferenceFps}`,
    { method: 'POST' });

export const pipelineStreamStop = (cameraId: string) =>
  callProxy<{ stopped: boolean }>(
    `cameras/${encodeURIComponent(cameraId)}/stream`, { method: 'DELETE' });

export interface PipelineStreamMetrics {
  stream_fps: number; inference_fps: number; inference_latency_ms: number;
  frames_read: number; frames_dropped: number; frames_inferred: number;
  connected: boolean; last_error: string | null; decoupled: boolean;
}

export const pipelineStreamMetrics = (cameraId: string) =>
  callProxy<PipelineStreamMetrics>(`cameras/${encodeURIComponent(cameraId)}/stream/metrics`);

/**
 * Mint a short-lived (2 min), single-resource media token. The dashboard
 * session (Bearer token) is checked HERE -- the only point that can check it,
 * since the <img>/<video> tag that will actually fetch the media cannot send
 * an Authorization header. The returned token is scoped to exactly this
 * resource and expires quickly, so it is not a standing credential even if it
 * ends up somewhere it shouldn't (a log, a screen share).
 */
async function mintMediaToken(
  resourceType: 'evidence' | 'stream', resourceId: string,
): Promise<string> {
  const q = `resource_type=${resourceType}&resource_id=${encodeURIComponent(resourceId)}`;
  const res = await fetch(`${PROXY_BASE}/media-token?${q}`, { headers: dashboardAuthHeaders() });
  if (!res.ok) {
    throw new Error(`Could not obtain a media token (${res.status})`);
  }
  const { token } = (await res.json()) as { token: string };
  return token;
}

/**
 * MJPEG display feed URL, ready to drop into a <video>/<img> `src`. Mints a
 * fresh scoped token first -- callers must `await` this rather than treating
 * it as a plain string constant, because unlike a static URL it requires one
 * round trip to the dashboard before the tag can be pointed at it.
 */
export const pipelineStreamMjpegUrl = async (cameraId: string): Promise<string> => {
  const token = await mintMediaToken('stream', cameraId);
  return `${PROXY_BASE}/stream/${encodeURIComponent(cameraId)}/mjpeg?token=${encodeURIComponent(token)}`;
};

// --- alerts / incidents / evidence ----------------------------------------

export const pipelineListAlerts = (params: {
  camera_id?: string; severity?: string; incident_id?: string;
  limit?: number; offset?: number;
} = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined) q.append(k, String(v)); });
  return callProxy<PipelineAlert[]>(`alerts${q.toString() ? `?${q}` : ''}`);
};

export const pipelineGetAlert = (id: string) =>
  callProxy<PipelineAlert>(`alerts/${encodeURIComponent(id)}`);

// --- lifecycle (dashboard-owned, NOT proxied to the pipeline) -------------
// `pipeline_alert_routes.py` lives directly on the dashboard backend, at
// /api/v1/pipeline-alerts -- lifecycle state (acknowledged/resolved/
// escalated/notes) is the dashboard's own data and is never sent to the
// pipeline, so this deliberately does NOT go through callProxy/PROXY_BASE.

export interface PipelineAlertLifecycle {
  pipeline_alert_id: string;
  status: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_pin_verified: boolean;
  escalated: boolean;
  escalated_at: string | null;
  escalated_by: string | null;
  escalation_target: string | null;
  notes: string | null;
}

async function callLifecycle<T>(subPath: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${DASHBOARD_API_BASE}/api/v1/pipeline-alerts/${subPath}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...dashboardAuthHeaders(),
      ...(init.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) {
    let detail = `Lifecycle action failed: ${res.status}`;
    try {
      const data = await res.clone().json();
      detail = data.detail || detail;
    } catch { /* not JSON */ }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

function snapshotFrom(alert: PipelineAlert) {
  return {
    camera_id: alert.camera_id,
    detection_type: alert.class,
    severity: alert.severity,
    confidence: alert.confidence,
    evidence_ref: alert.evidence_ref,
    timestamp: alert.timestamp,
  };
}

export const pipelineAlertLifecycleBatch = (ids: string[]) =>
  ids.length
    ? callLifecycle<PipelineAlertLifecycle[]>('batch', { method: 'POST', body: JSON.stringify(ids) })
    : Promise.resolve<PipelineAlertLifecycle[]>([]);

export const pipelineAcknowledgeAlert = (alert: PipelineAlert) =>
  callLifecycle<PipelineAlertLifecycle>(`${encodeURIComponent(alert.id)}/acknowledge`, {
    method: 'POST', body: JSON.stringify({ snapshot: snapshotFrom(alert) }),
  });

/** `pin` omitted unless the caller already knows one is required (see the
 * 400 "Resolution PIN required" retry path in AlertsReports.tsx). */
export const pipelineResolveAlert = (alert: PipelineAlert, pin?: string, notes?: string) =>
  callLifecycle<PipelineAlertLifecycle>(`${encodeURIComponent(alert.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ pin: pin || null, notes: notes || null, snapshot: snapshotFrom(alert) }),
  });

export const pipelineEscalateAlert = (alert: PipelineAlert, target: string, notes?: string) =>
  callLifecycle<PipelineAlertLifecycle>(`${encodeURIComponent(alert.id)}/escalate`, {
    method: 'POST',
    body: JSON.stringify({ target, notes: notes || null, snapshot: snapshotFrom(alert) }),
  });

/**
 * Active/resolved/fire/smoke counts across ALL pipeline alerts, merged with
 * their dashboard-owned lifecycle state -- the same "active" definition
 * AlertsReports.tsx's dual-read uses (a pipeline alert with no lifecycle row,
 * or a non-resolved one, counts as active).
 *
 * There is no server-side count-with-filter endpoint on either the pipeline
 * or the dashboard for this, so this fetches alert records and counts
 * client-side. Capped at `limit` (default 500) -- fine at current data
 * volumes (low hundreds), but this does NOT scale to a large historical
 * store; a real fix would add a dedicated stats endpoint. Documented as a
 * known limitation, not silently passed off as exact at any scale.
 */
export interface PipelineAlertStats {
  active: number; resolved: number; fire: number; smoke: number; total: number;
  counted: number; truncated: boolean;
}

export const pipelineActiveAlertStats = async (limit = 500): Promise<PipelineAlertStats> => {
  const alerts = await pipelineListAlerts({ limit });
  const lifecycles = await pipelineAlertLifecycleBatch(alerts.map((a) => a.id));
  const resolvedIds = new Set(
    lifecycles.filter((l) => l.status === 'resolved').map((l) => l.pipeline_alert_id),
  );
  let active = 0, resolved = 0, fire = 0, smoke = 0;
  for (const a of alerts) {
    if (resolvedIds.has(a.id)) resolved += 1; else active += 1;
    if (a.class === 'fire') fire += 1; else smoke += 1;
  }
  return {
    active, resolved, fire, smoke, total: alerts.length,
    counted: alerts.length, truncated: alerts.length >= limit,
  };
};

export const pipelineListIncidents = (activeOnly = true) =>
  callProxy<Array<{ incident_id: string; threat_class: string; severity: string;
    peak_score: number; resolved: boolean; camera_ids: string[];
    is_multi_camera: boolean; created_at: string }>>(`incidents?active_only=${activeOnly}`);

/**
 * Evidence image URL, ready to drop into an <img> `src`. Mints a fresh scoped
 * token first, for the same reason as `pipelineStreamMjpegUrl` -- an <img> tag
 * cannot carry the dashboard's own session header, so a short-lived,
 * single-file token stands in for it. `evidence_ref` arrives from the
 * pipeline as "/evidence/<file>".
 *
 * Async, unlike the old synchronous `evidenceUrl()` in `services/api.ts` --
 * callers (e.g. an alert list rendering many thumbnails) should resolve this
 * once per image and cache the resulting URL for that render, not re-mint a
 * token on every re-render.
 */
export const pipelineEvidenceUrl = async (
  evidenceRef: string | null | undefined,
): Promise<string | null> => {
  if (!evidenceRef) return null;
  const name = evidenceRef.split('/').pop();
  if (!name) return null;
  const token = await mintMediaToken('evidence', name);
  return `${PROXY_BASE}/evidence/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`;
};

// --- legacy-shape adapter --------------------------------------------------

/**
 * Maps a PipelineDetectionResult onto the `{detections, alert_ids}` shape the
 * existing webcam-loop code in Detection.tsx / LiveMonitoring.tsx /
 * Dashboard.tsx already expects from the legacy `uploadImage()` response.
 *
 * This is the whole trick behind keeping each page's edit small: everything
 * downstream of the upload call (box drawing, threat-state tracking,
 * notification dispatch) is left completely alone. Only the call itself
 * branches on the page's feature flag; the rest of the component never
 * needs to know which backend answered.
 *
 * The one real translation: the pipeline's taxonomy has three smoke
 * sub-types (`white_smoke` / `grey_smoke` / `black_smoke`); the legacy UI
 * only knows a generic `'smoke'`. That collapse happens here, once, rather
 * than in three separate pages.
 */
export function toLegacyDetectionShape(result: PipelineDetectionResult): {
  detections: Array<{ detection_type: 'fire' | 'smoke'; confidence: number; bbox: PipelineBBox }>;
  alert_ids: string[];
} {
  return {
    detections: result.detections.map((d) => ({
      detection_type: d.class === 'fire' ? 'fire' : 'smoke',
      confidence: d.confidence,
      bbox: d.bbox,
    })),
    alert_ids: result.alerts.map((a) => a.id),
  };
}

/**
 * Fixed client-side upload rate cap for continuous webcam sources on the
 * pipeline path. This is NOT a re-implementation of the Gate -- the pipeline's
 * real Gate (motion/hysteresis/forced-override) still makes the actual
 * inference decision server-side, via `apply_gate=true`. This constant exists
 * purely to bound upload BANDWIDTH: the browser cannot run the Gate itself
 * (it has no access to the per-camera background-subtraction state), so
 * without some cap it would upload a full JPEG on every animation frame.
 * ~4 fps is comfortably above the Gate's own forced-override cadence even at
 * the "high risk" tier (7s), so it never becomes the bottleneck.
 */
export const PIPELINE_WEBCAM_UPLOAD_INTERVAL_MS = 250;

export const pipelineSchedulerState = () =>
  callProxy<{ scheduler: Record<string, unknown>; queue: Record<string, unknown>;
    cameras: Array<Record<string, unknown>> }>('scheduler');

// --- zone edits (dashboard-owned: authorized, reasoned, logged) -----------
// Distinct from callProxy: these hit the dashboard's OWN routes directly
// (zone_edit_routes.py), not the pipeline-proxy, because the dashboard needs
// to enforce a reason, compute the diff, and write an audit log entry --
// none of which the generic proxy does or should do.

async function callDashboard<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${DASHBOARD_API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...dashboardAuthHeaders(),
      ...(init.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) {
    let detail = `Request failed: ${res.status}`;
    try {
      const data = await res.clone().json();
      detail = data.detail || detail;
    } catch { /* not JSON */ }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export interface ZoneEditChange { field: string; before: unknown; after: unknown }

export interface ZoneEditResult {
  before: PipelineZone; after: PipelineZone; changes: ZoneEditChange[];
  reason: string; edited_by: string;
}

export interface ZoneEditRequest {
  reason: string;
  risk_weight?: number;
  polygon?: number[][];
  flammable_materials_nearby?: boolean;
  designated_activity_allowed?: string[];
  adjacent_camera_ids?: string[];
  envelope?: Partial<PipelineEnvelope>;
}

export const pipelineEditZone = (cameraId: string, body: ZoneEditRequest) =>
  callDashboard<ZoneEditResult>(`/api/v1/zone-edits/${encodeURIComponent(cameraId)}`, {
    method: 'POST', body: JSON.stringify(body),
  });

export interface ZoneEditLogEntry {
  id: string; username: string | null; timestamp: string;
  zone_id: string | null; reason: string | null; changes: ZoneEditChange[];
}

export const pipelineZoneEditLog = (cameraId: string) =>
  callDashboard<ZoneEditLogEntry[]>(`/api/v1/zone-edits/${encodeURIComponent(cameraId)}`);

// --- facility map (dashboard-owned: site image + camera placements) -------

export interface FacilityMapMeta {
  id: string; name: string; width_px: number; height_px: number;
  uploaded_by: string | null; uploaded_at: string;
}

export interface CameraPlacement {
  camera_id: string; camera_name: string | null; x_pct: number; y_pct: number;
  facing_deg: number; fov_deg: number; range_pct: number;
  updated_by: string | null; updated_at: string | null;
}

export const facilityMapGet = () =>
  callDashboard<{ map: FacilityMapMeta | null; placements: CameraPlacement[] }>('/api/v1/facility-map');

export const facilityMapUpload = async (file: File, name: string): Promise<FacilityMapMeta> => {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${DASHBOARD_API_BASE}/api/v1/facility-map?${new URLSearchParams({ name })}`, {
    method: 'POST', headers: dashboardAuthHeaders(), body: fd,
  });
  if (!res.ok) throw new Error(`Facility map upload failed: ${res.status}`);
  return res.json();
};

/** Mints the dashboard's own session token into the image URL -- an <img>
 * tag can't send an Authorization header, and this is dashboard-native data
 * (not the pipeline's), so it reuses the plain query-token pattern the rest
 * of this dashboard already uses for that exact problem (see history export
 * URLs), rather than the pipeline-evidence HMAC scheme, which exists
 * specifically to keep a THIRD PARTY's (the pipeline's) key off the browser
 * -- not applicable here since this image never involves the pipeline key. */
export const facilityMapImageUrl = (): string => {
  const token = localStorage.getItem('fg-token') ?? '';
  return `${DASHBOARD_API_BASE}/api/v1/facility-map/image?token=${encodeURIComponent(token)}`;
};

export const facilityMapSetPlacement = (cameraId: string, body: {
  camera_id: string; camera_name?: string | null; x_pct: number; y_pct: number;
  facing_deg: number; fov_deg: number; range_pct: number;
}) => callDashboard<CameraPlacement>(`/api/v1/facility-map/cameras/${encodeURIComponent(cameraId)}`, {
  method: 'PUT', body: JSON.stringify(body),
});

export const facilityMapRemovePlacement = (cameraId: string) =>
  callDashboard<{ removed: boolean }>(`/api/v1/facility-map/cameras/${encodeURIComponent(cameraId)}`, {
    method: 'DELETE',
  });

export interface FovOverlapPair {
  camera_a: string; camera_a_name: string | null;
  camera_b: string; camera_b_name: string | null;
  overlap_area_px2: number; pct_of_a_fov: number; pct_of_b_fov: number;
}

export const facilityMapOverlap = () =>
  callDashboard<{ pairs: FovOverlapPair[] }>('/api/v1/facility-map/overlap');
