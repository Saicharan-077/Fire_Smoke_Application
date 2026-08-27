import { useDashboardStore } from './dashboardStore';
import type { Alert } from './dashboardStore';

// Bridge websocket-delivered live alerts into DashboardStore feed.
export function pushAlertToDashboardFeed(alert: Alert) {
  const { addRecentAlert } = useDashboardStore.getState();
  addRecentAlert(alert);
}

