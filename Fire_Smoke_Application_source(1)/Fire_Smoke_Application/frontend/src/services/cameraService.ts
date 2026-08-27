import { APP_CONFIG } from '../config/appConfig';

const BASE = APP_CONFIG.apiBaseUrl;

export type CameraStatus = 'online' | 'offline' | 'maintenance';

export interface Camera {
  id: string;
  name: string;
  location?: string | null;
  zone?: string | null;
  status: CameraStatus;
  stream_url?: string | null;
  description?: string | null;
}

export interface CameraCreateInput {
  name: string;
  location?: string;
  zone?: string;
  stream_url?: string;
}

export interface CameraUpdateInput {
  name?: string;
  location?: string | null;
  zone?: string | null;
  status?: CameraStatus;
  stream_url?: string | null;
  description?: string | null;
}

export interface CameraStatusUpdateInput {
  status: CameraStatus;
}

export interface CameraZoneUpdateInput {
  zone?: string | null;
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

export async function listCameras(): Promise<Camera[]> {
  return api<Camera[]>('/api/v1/cameras');
}

export async function createCamera(body: CameraCreateInput): Promise<Camera> {
  return api<Camera>('/api/v1/cameras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function patchCamera(cameraId: string, body: CameraUpdateInput): Promise<Camera> {
  return api<Camera>(`/api/v1/cameras/${cameraId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function patchCameraStatus(cameraId: string, body: CameraStatusUpdateInput): Promise<Camera> {
  return api<Camera>(`/api/v1/cameras/${cameraId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function patchCameraZone(cameraId: string, body: CameraZoneUpdateInput): Promise<Camera> {
  return api<Camera>(`/api/v1/cameras/${cameraId}/zone`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteCamera(cameraId: string): Promise<void> {
  await api<{ status: string; message?: string }>(`/api/v1/cameras/${cameraId}`, { method: 'DELETE' });
}

