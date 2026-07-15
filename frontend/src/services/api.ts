import { APP_CONFIG } from '../config/appConfig';

const BASE = APP_CONFIG.apiBaseUrl;


export interface BBox { x1: number; y1: number; x2: number; y2: number; }
export interface Detection { detection_type: 'fire' | 'smoke'; confidence: number; bbox: BBox; }

export interface Alert {
  id: string;
  detection_type: 'fire' | 'smoke';
  confidence: number;
  status: 'active' | 'resolved';

  source_type: string;
  camera_id: string | null;
  location: string | null;
  file_name: string | null;
  evidence_path: string | null;
  frame_number: number | null;
  resolved_by?: string | null;
  timestamp: string;
}

export interface DashboardStats {
  total_alerts: number;
  active_alerts: number;
  fire_alerts: number;
  smoke_alerts: number;
  connected_cameras: number;
  online_cameras?: number;
  total_cameras?: number;
  model_ready?: boolean;
  model_accuracy?: number;
  system_health?: string;
  recent_alerts: Alert[];
}

export interface DetectionEvent {
  id: string;
  alert_id: string | null;
  detection_type: 'fire' | 'smoke';
  confidence: number;
  bbox_x1: number | null;
  bbox_y1: number | null;
  bbox_x2: number | null;
  bbox_y2: number | null;
  source_type: string;
  camera_id: string | null;
  location: string | null;
  file_name: string | null;
  frame_number: number | null;
  evidence_path: string | null;
  timestamp: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = localStorage.getItem('fg-token');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  });

  if (res.status === 401) {
    localStorage.removeItem('fg-token');
    // Clear Zustand store dynamically
    import('../store/authStore').then((mod) => {
      mod.useAuthStore.getState().logout();
    }).catch(() => {});
  }

  if (!res.ok) {
    let errText = 'API Error';
    try {
      const data = JSON.parse(await res.clone().text());
      errText = data.detail || data.message || errText;
    } catch {
      try {
        errText = await res.text();
      } catch {}
    }
    throw new Error(errText);
  }
  return res.json();
}

// Remove undefined/null/empty values before building query string
function toQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.append(k, String(v));
  });
  const s = p.toString();
  return s ? '?' + s : '';
}

// ── Upload ────────────────────────────────────────────────────────────────────
export const uploadImage = (file: File, sourceId?: string) => {
  const fd = new FormData();
  fd.append('file', file);
  const query = sourceId ? `?source_id=${encodeURIComponent(sourceId)}` : '';
  return api<{
    detections: Detection[];
    alert_ids: string[];
    evidence_path: string | null;
    file_name: string;
  }>(
    `/api/v1/upload/image${query}`,
    { method: 'POST', body: fd }
  );
};

export const uploadVideo = (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return api<{
    total_events: number;
    events: Record<string, unknown>[];
    file_name: string;
  }>(
    '/api/v1/upload/video',
    { method: 'POST', body: fd }
  );
};

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const getDashboardStats = () =>
  api<DashboardStats>('/api/v1/dashboard/stats');

export const getDashboardAnalytics = () =>
  api<{ timeline: Record<string, unknown>[]; zones: Record<string, unknown>[] }>(
    '/api/v1/dashboard/analytics'
  );


export const getAnalyticsIncidentTrends = () =>
  api<{ timeline: { day: string; fire: number; smoke: number }[] }>(
    '/api/v1/analytics/incident-trends'
  ).then((d) => d.timeline);

export const getAnalyticsFireSmokeDistribution = () =>
  api<{ breakdown: { name: string; value: number; color: string }[] }>(
    '/api/v1/analytics/fire-smoke-distribution'
  ).then((d) => d.breakdown);


export const getEvents = (params?: {
  detection_type?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
}) => api<DetectionEvent[]>(`/api/v1/dashboard/events${toQuery(params)}`);

// ── Alerts ────────────────────────────────────────────────────────────────────
export const getAlerts = (params?: {
  detection_type?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
}) => api<{ items: Alert[] }>(`/api/v1/alerts${toQuery(params)}`).then(res => res.items);

export const updateAlertStatus = (alertId: string, status: Alert['status']) =>
  api<Alert>(`/api/v1/alerts/${alertId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });

export const deleteAlert = (alertId: string) =>
  api<{ status: string; message: string }>(`/api/v1/alerts/${alertId}`, {
    method: 'DELETE',
  });


// ── Evidence ──────────────────────────────────────────────────────────────────
export const evidenceUrl = (path: string | null) =>
  path ? `${BASE}${path}` : null;

// ── WebSocket ─────────────────────────────────────────────────────────────────
export const connectAlertSocket = (onMessage: (data: unknown) => void): WebSocket => {
  const wsBase = BASE.replace(/^http/, 'ws');
  const token = localStorage.getItem('fg-token') ?? '';
  const ws = new WebSocket(`${wsBase}/ws/alerts?token=${encodeURIComponent(token)}`);
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse((e as MessageEvent).data));
    } catch {
      // ignore invalid messages
    }
  };
  const ping = setInterval(() => {
    if (ws.readyState === 1) ws.send('ping');
  }, 20_000);
  ws.onclose = () => clearInterval(ping);
  return ws;
};

// ── Interfaces ────────────────────────────────────────────────────────────────
export interface Incident {
  id: string;
  title: string;
  description: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'active' | 'resolved';
  alert_id: string | null;
  reporter: string | null;
  assigned_user: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Setting {
  id: string;
  value: string;
  description: string | null;
  category: string | null;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  username: string | null;
  action: string;
  details: string | null;
  ip_address: string | null;
  timestamp: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const loginApi = (payload: any) =>
  api<{ token: string; user: any }>('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const registerApi = (payload: any) =>
  api<any>('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const googleAuthApi = (payload: { email: string; google_id: string; username?: string; action: string }) =>
  api<{ token: string; user: any }>('/api/v1/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const linkGoogleApi = (payload: { email: string; google_id: string }) =>
  api<{ token: string; user: any }>('/api/v1/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, action: 'link' }),
  });

export const forgotPasswordApi = (payload: { email: string }) =>
  api<{ status: string; message: string }>('/api/v1/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const changePasswordApi = (payload: {
  current_password: string;
  new_password: string;
  confirm_password: string;
}) =>
  api<{ status: string; message: string }>('/api/v1/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const logoutApi = () =>
  api<{ status: string; message: string }>('/api/v1/auth/logout', {
    method: 'POST',
  });

export const getProfileApi = () =>
  api<any>('/api/v1/auth/profile');

export const updateProfileApi = (payload: any) =>
  api<any>('/api/v1/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const getAuditLogs = () =>
  api<AuditLog[]>('/api/v1/profile/audit-logs');

// ── Incidents ─────────────────────────────────────────────────────────────────
export const getIncidents = (params?: { status?: string; severity?: string; search?: string }) =>
  api<{ items: Incident[]; total: number; page: number; limit: number; pages: number }>(
    `/api/v1/incidents${toQuery(params)}`
  );

export const createIncident = (payload: Partial<Incident>) =>
  api<Incident>('/api/v1/incidents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const updateIncident = (incidentId: string, payload: Partial<Incident>) =>
  api<Incident>(`/api/v1/incidents/${incidentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const deleteIncident = (incidentId: string) =>
  api<{ status: string; message: string }>(`/api/v1/incidents/${incidentId}`, {
    method: 'DELETE',
  });

// ── Settings ──────────────────────────────────────────────────────────────────
export const getSettings = () =>
  api<Setting[]>('/api/v1/settings');

export const updateSettings = (payload: Record<string, string>) =>
  api<Setting[]>('/api/v1/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

// ── CCTV/Webcam Stream Detections ─────────────────────────────────────────────
export const testCctvConnection = (streamUrl: string) =>
  api<{ status: string; message: string; url: string }>('/api/v1/detect/cctv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stream_url: streamUrl }),
  });

// ── Admin ─────────────────────────────────────────────────────────────────────
export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
  is_active?: string;
  last_login?: string;
  created_at?: string;
}

export const getAdminUsers = (params?: { page?: number; limit?: number; q?: string; role?: string }) =>
  api<{ items: AdminUser[]; total: number; page: number; limit: number; pages: number }>(
    `/api/v1/admin/users${toQuery(params)}`
  );

export const createAdminUser = (payload: { username: string; email: string; password: string; role: string }) =>
  api<AdminUser>('/api/v1/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const updateAdminUser = (userId: string, payload: Partial<AdminUser>) =>
  api<AdminUser>(`/api/v1/admin/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const deleteAdminUser = (userId: string) =>
  api<{ status: string; message: string }>(`/api/v1/admin/users/${userId}`, { method: 'DELETE' });

export const resetAdminUserPassword = (userId: string, new_password: string) =>
  api<{ status: string; message: string }>(`/api/v1/admin/users/${userId}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_password }),
  });

export const activateAdminUser = (userId: string) =>
  api<AdminUser>(`/api/v1/admin/users/${userId}/activate`, { method: 'PATCH' });

export const deactivateAdminUser = (userId: string) =>
  api<AdminUser>(`/api/v1/admin/users/${userId}/deactivate`, { method: 'PATCH' });

export const getAdminAuditLogs = (params?: { page?: number; limit?: number; action?: string }) =>
  api<{ items: AuditLog[]; total: number; page: number; limit: number; pages: number }>(
    `/api/v1/admin/audit-logs${toQuery(params)}`
  );

export interface SystemLog {
  id: string;
  level: string;
  source: string;
  message: string;
  timestamp: string;
}

export const getAdminSystemLogs = (params?: { page?: number; limit?: number; level?: string; source?: string }) =>
  api<{ items: SystemLog[]; total: number; page: number; limit: number; pages: number }>(
    `/api/v1/admin/system-logs${toQuery(params)}`
  );

export const getAdminSessions = () =>
  api<{ sessions: Array<{ user_id: string; username: string; email: string; role: string; last_login: string | null; expires_at: string | null }>; count: number }>(
    '/api/v1/admin/sessions'
  );

export const revokeAdminSession = (userId: string) =>
  api<{ status: string; message: string }>(`/api/v1/admin/sessions/${userId}`, { method: 'DELETE' });

export const getAdminHealth = () =>
  api<{
    status: string;
    model_ready: boolean;
    database: string;
    users: { total: number; active: number };
    cameras: { total: number; online: number };
    alerts: { total: number; active: number };
    sessions: number;
    recent_errors: number;
    timestamp: string;
  }>('/api/v1/admin/health');

export const getAdminStats = () =>
  api<{
    users_by_role: Record<string, number>;
    incidents: { total: number; active: number };
    audit_log_count: number;
    system_log_count: number;
  }>('/api/v1/admin/stats');

