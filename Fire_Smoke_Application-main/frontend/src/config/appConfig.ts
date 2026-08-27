export const APP_CONFIG = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
  evidenceBaseUrl:
    import.meta.env.VITE_EVIDENCE_BASE_URL ??
    (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'),
  wsBaseUrl: import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws/alerts',
  websocketUrl: import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws/alerts',
};


