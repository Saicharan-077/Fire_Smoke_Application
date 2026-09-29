const getDynamicHost = () => {
  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:8000`;
  }
  return 'http://localhost:8000';
};

const getDynamicWsHost = () => {
  if (typeof window !== 'undefined' && window.location) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname;
    return `${wsProtocol}//${hostname}:8000/ws/alerts`;
  }
  return 'ws://localhost:8000/ws/alerts';
};

const defaultBase = getDynamicHost();
const defaultWs = getDynamicWsHost();

export const APP_CONFIG = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || defaultBase,
  evidenceBaseUrl:
    import.meta.env.VITE_EVIDENCE_BASE_URL ||
    (import.meta.env.VITE_API_BASE_URL || defaultBase),
  wsBaseUrl: import.meta.env.VITE_WS_URL || defaultWs,
  websocketUrl: import.meta.env.VITE_WS_URL || defaultWs,
};



