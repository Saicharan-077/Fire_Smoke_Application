/**
 * Client for the detection pipeline's public /v1 API.
 *
 * Deliberately separate from `api.ts` so the boundary is visible in imports and
 * the legacy client stays untouched. Nothing here talks to the dashboard
 * backend, and nothing here imports pipeline internals -- this is plain HTTP
 * against the documented public surface.
 */

import { PIPELINE_CONFIG } from '../config/pipelineConfig';

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

const headers = (extra: Record<string, string> = {}): Record<string, string> => {
  const h: Record<string, string> = { ...extra };
  if (PIPELINE_CONFIG.apiKey) h['X-API-Key'] = PIPELINE_CONFIG.apiKey;
  return h;
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${PIPELINE_CONFIG.baseUrl}${path}`, {
      ...init,
      headers: headers(init.headers as Record<string, string> | undefined ?? {}),
    });
  } catch (e) {
    // Network-level failure: the pipeline is down or unreachable. Distinct from
    // an HTTP error, because it is what the automatic fallback keys on.
    throw new PipelineUnavailableError(
      `Detection pipeline unreachable at ${PIPELINE_CONFIG.baseUrl}`,
    );
  }
  if (res.status === 401) {
    throw new Error('Pipeline rejected the API key (401). Check VITE_PIPELINE_API_KEY.');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Pipeline ${path} failed: ${res.status} ${detail.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

// --- status ---------------------------------------------------------------

export const pipelineHealth = () => call<PipelineHealth>('/v1/health');
export const pipelineModelInfo = () => call<PipelineModelInfo>('/v1/model/info');

// --- cameras --------------------------------------------------------------

export const pipelineListCameras = () =>
  call<Array<{ camera_id: string; name: string; source_uri: string | null;
    location: string | null; calibration_state: string;
    zone_id: string | null; risk_weight: number | null }>>('/v1/cameras');

export const pipelineRegisterCamera = (body: {
  name: string; source_uri?: string | null; location?: string | null;
}) => call<{ camera_id: string }>('/v1/cameras', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Real gate telemetry. Throws on 404 when a camera has no gate state yet --
 *  callers must show "no data" rather than substituting invented numbers. */
export const pipelineGateStats = (cameraId: string) =>
  call<PipelineGateStats>(`/v1/cameras/${encodeURIComponent(cameraId)}/gate`);

// --- detection ------------------------------------------------------------

export const pipelineDetectFrame = (
  file: File | Blob, cameraId: string, applyGate = false,
) => {
  const fd = new FormData();
  fd.append('file', file, 'frame.jpg');
  const q = `camera_id=${encodeURIComponent(cameraId)}&apply_gate=${applyGate}`;
  return call<PipelineDetectionResult>(`/v1/detect/frame?${q}`, { method: 'POST', body: fd });
};

export const pipelineDetectVideo = (file: File, cameraId: string) => {
  const fd = new FormData();
  fd.append('file', file, file.name);
  return call<{ job_id: string; status: string }>(
    `/v1/detect/video?camera_id=${encodeURIComponent(cameraId)}`,
    { method: 'POST', body: fd },
  );
};

export interface PipelineJob {
  job_id: string; status: string; progress_pct: number;
  frames_total: number; frames_processed: number; frames_gated_out: number;
  alerts: PipelineAlert[]; error: string | null;
}

export const pipelineJobStatus = (jobId: string) =>
  call<PipelineJob>(`/v1/jobs/${encodeURIComponent(jobId)}`);

export const pipelineCancelJob = (jobId: string) =>
  call<{ job_id: string; status: string; cancelled: boolean }>(
    `/v1/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });

// --- streams --------------------------------------------------------------

export const pipelineStreamStart = (cameraId: string, sourceUri: string, inferenceFps = 4) =>
  call<{ camera_id: string; running: boolean; scheduled: boolean }>(
    `/v1/cameras/${encodeURIComponent(cameraId)}/stream/start`
    + `?source_uri=${encodeURIComponent(sourceUri)}&inference_fps=${inferenceFps}`,
    { method: 'POST' });

export const pipelineStreamStop = (cameraId: string) =>
  call<{ stopped: boolean }>(
    `/v1/cameras/${encodeURIComponent(cameraId)}/stream`, { method: 'DELETE' });

export interface PipelineStreamMetrics {
  stream_fps: number; inference_fps: number; inference_latency_ms: number;
  frames_read: number; frames_dropped: number; frames_inferred: number;
  connected: boolean; last_error: string | null; decoupled: boolean;
}

export const pipelineStreamMetrics = (cameraId: string) =>
  call<PipelineStreamMetrics>(
    `/v1/cameras/${encodeURIComponent(cameraId)}/stream/metrics`);

/** MJPEG display feed. Rendered at display rate, never blocked by inference. */
export const pipelineStreamMjpegUrl = (cameraId: string): string => {
  const key = PIPELINE_CONFIG.apiKey
    ? `?api_key=${encodeURIComponent(PIPELINE_CONFIG.apiKey)}` : '';
  return `${PIPELINE_CONFIG.baseUrl}/v1/cameras/${encodeURIComponent(cameraId)}/stream/mjpeg${key}`;
};

// --- alerts / incidents / evidence ----------------------------------------

export const pipelineListAlerts = (params: {
  camera_id?: string; severity?: string; incident_id?: string;
  limit?: number; offset?: number;
} = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined) q.append(k, String(v)); });
  return call<PipelineAlert[]>(`/v1/alerts${q.toString() ? `?${q}` : ''}`);
};

export const pipelineGetAlert = (id: string) =>
  call<PipelineAlert>(`/v1/alerts/${encodeURIComponent(id)}`);

export const pipelineListIncidents = (activeOnly = true) =>
  call<Array<{ incident_id: string; threat_class: string; severity: string;
    peak_score: number; resolved: boolean; camera_ids: string[];
    is_multi_camera: boolean; created_at: string }>>(
    `/v1/incidents?active_only=${activeOnly}`);

/** Evidence image URL. `evidence_ref` arrives as "/evidence/<file>". */
export const pipelineEvidenceUrl = (evidenceRef: string | null | undefined): string | null => {
  if (!evidenceRef) return null;
  const name = evidenceRef.split('/').pop();
  if (!name) return null;
  const key = PIPELINE_CONFIG.apiKey
    ? `?api_key=${encodeURIComponent(PIPELINE_CONFIG.apiKey)}` : '';
  return `${PIPELINE_CONFIG.baseUrl}/v1/evidence/${encodeURIComponent(name)}${key}`;
};

export const pipelineSchedulerState = () =>
  call<{ scheduler: Record<string, unknown>; queue: Record<string, unknown>;
    cameras: Array<Record<string, unknown>> }>('/v1/scheduler');
