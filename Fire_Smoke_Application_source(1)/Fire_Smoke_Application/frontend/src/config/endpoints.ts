import { APP_CONFIG } from './appConfig';

export const endpoints = {
  api: {
    dashboardStats: '/api/v1/dashboard/stats',
    dashboardAnalytics: '/api/v1/dashboard/analytics',
    dashboardEvents: '/api/v1/dashboard/events',
    alerts: '/api/v1/alerts',
    uploadImage: '/api/v1/upload/image',
    uploadVideo: '/api/v1/upload/video',
    cameras: '/api/v1/cameras',
    alertsStatus: (alertId: string) => `/api/v1/alerts/${alertId}/status`,
    evidence: (filename: string) => `/evidence/${filename}`,
  },
  ws: {
    alerts: APP_CONFIG.websocketUrl,
  },
};

