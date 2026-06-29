import { APP_CONFIG } from '../config/appConfig';

const BASE = APP_CONFIG.apiBaseUrl;

export type HistoryType = 'fire' | 'smoke';
export type HistoryStatus = 'active' | 'resolved';

export type HistoryQuery = {
  page?: number;
  page_size?: number;
  search?: string;
  status?: HistoryStatus;
  type?: HistoryType;
  start_date?: string; // YYYY-MM-DD
  end_date?: string; // YYYY-MM-DD
};

export type HistoryItem = {
  id: string;
  detection_type: HistoryType;
  confidence: number;
  status: HistoryStatus;
  source_type: string;
  camera_id: string | null;
  location: string | null;
  file_name: string | null;
  evidence_path: string | null;
  frame_number: number | null;
  timestamp: string;
};

export type HistoryResponse = {
  items: HistoryItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
};

function toQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.append(k, String(v));
  });
  const s = p.toString();
  return s ? '?' + s : '';
}

async function getJson<T>(path: string): Promise<T> {
  const headers = new Headers();
  const token = localStorage.getItem('fg-token');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${BASE}${path}`, { headers });
  
  if (res.status === 401) {
    localStorage.removeItem('fg-token');
    import('../store/authStore').then((mod) => {
      mod.useAuthStore.getState().logout();
    }).catch(() => {});
  }

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function fetchWithAuth(path: string, init?: RequestInit): Promise<Response> {
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

  return res;
}

export async function getHistory(q: HistoryQuery): Promise<HistoryResponse> {
  const { page, page_size, search, status, type, start_date, end_date } = q;
  return getJson<HistoryResponse>(`/api/v1/history${toQuery({
    page,
    page_size,
    search,
    status,
    type,
    start_date,
    end_date,
  })}`);
}

export async function exportHistoryCsv(q: Omit<HistoryQuery, 'page' | 'page_size'>): Promise<Blob> {
  const res = await fetchWithAuth(
    `/api/v1/history/export/csv${toQuery(q as Record<string, unknown>)}`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}

export async function exportHistoryPdf(q: Omit<HistoryQuery, 'page' | 'page_size'>): Promise<Blob> {
  const res = await fetchWithAuth(
    `/api/v1/history/export/pdf${toQuery(q as Record<string, unknown>)}`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}

