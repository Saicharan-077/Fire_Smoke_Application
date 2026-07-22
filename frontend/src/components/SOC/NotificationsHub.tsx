import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotificationsStore, type NotificationItem } from '../../store/notificationsStore';
import { evidenceUrl, connectAlertSocket } from '../../services/api';
import { useAlertSound } from './AlertSound';
import { AlertPopupCard } from './InstantAlertPopup';
import { APP_CONFIG } from '../../config/appConfig';

interface NotificationsHubProps {
  onConnectionChange?: (connected: boolean) => void;
}

export function NotificationsHub({ onConnectionChange }: NotificationsHubProps) {
  const navigate = useNavigate();
  const { play, startSiren } = useAlertSound();

  const queue = useNotificationsStore((s) => s.queue);
  const historyAdd = useNotificationsStore((s) => s.addNotification);
  const pushPopup = useNotificationsStore((s) => s.pushPopup);
  const popPopup = useNotificationsStore((s) => s.popPopup);
  const hasSeen = useNotificationsStore((s) => s.hasSeen);
  const markSeen = useNotificationsStore((s) => s.markSeen);
  const permissionRequested = useRef(false);

  // Defer browser notification permission until first alert

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closedByCleanup = false;
    let reconnectAttempts = 0;
    const backoffs = [1000, 2000, 5000, 10000, 30000];

    const handleAlertData = (alert: any) => {
      const cameraId = alert.camera_id ?? null;

      // Compute severity
      let severity: 'info' | 'warning' | 'critical' = 'info';
      if (alert.detection_type === 'fire') {
        severity = alert.confidence >= 0.8 ? 'critical' : 'warning';
      } else if (alert.detection_type === 'smoke') {
        severity = alert.confidence >= 0.8 ? 'warning' : 'info';
      }

      const cameraName = alert.location || cameraId || 'Unknown Camera';
      const zone = null;

      const item: NotificationItem = {
        id: alert.id,
        alertType: alert.detection_type,
        cameraId,
        cameraName,
        zone,
        confidence: alert.confidence,
        timestamp: alert.timestamp,
        evidenceUrl: evidenceUrl(alert.evidence_path),
        severity,
        isRead: false,
      };

      historyAdd(item);
      pushPopup(item);
      markSeen(alert.id);

      if (alert.detection_type === 'fire' || severity === 'critical') {
        startSiren();
      } else {
        void play();
      }

      // Native browser notification
      if (
        typeof window !== 'undefined' &&
        'Notification' in window
      ) {
        if (window.Notification.permission === 'default' && !permissionRequested.current) {
          permissionRequested.current = true;
          window.Notification.requestPermission().catch(() => {});
        }
        if (window.Notification.permission === 'granted') {
          try {
            new window.Notification(`SentinelOS: ${alert.detection_type.toUpperCase()} Alert`, {
              body: `${alert.detection_type.toUpperCase()} detected at ${cameraName} — Conf: ${(alert.confidence * 100).toFixed(0)}%`,
              icon: '/favicon.ico',
            });
          } catch (e) {
            console.error('Failed to trigger browser notification:', e);
          }
        }
      }

      // Update related stores in real-time
      import('../../store/dashboardStore').then((mod) => {
        mod.useDashboardStore.getState().addRecentAlert(alert);
      }).catch(() => {});
    };

    const start = () => {
      if (closedByCleanup) return;

      ws = connectAlertSocket((data: unknown) => {
        const incoming = data as any;
        if (!incoming || incoming.event !== 'new_alert') return;

        const alertId = incoming.alert_id;
        if (!alertId || hasSeen(alertId)) return;

        // Bypass mode: full alert payload already embedded in WS message
        if (incoming.alert) {
          handleAlertData(incoming.alert);
        } else {
          fetch(`${APP_CONFIG.apiBaseUrl}/api/v1/alerts/${alertId}`, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('fg-token') ?? ''}`,
            },
          })
            .then((r) => {
              if (!r.ok) throw new Error('Failed to fetch alert');
              return r.json();
            })
            .then((alert) => handleAlertData(alert))
            .catch((e) => console.error('Failed to fetch alert details:', e));
        }
      });

      ws.onopen = () => {
        reconnectAttempts = 0;
        onConnectionChange?.(true);
      };

      ws.onclose = () => {
        onConnectionChange?.(false);
        if (closedByCleanup) return;
        const delay = backoffs[Math.min(reconnectAttempts, backoffs.length - 1)];
        reconnectAttempts++;
        setTimeout(() => start(), delay);
      };

      ws.onerror = () => {
        try { ws?.close(); } catch { /**/ }
      };
    };

    start();

    return () => {
      closedByCleanup = true;
      onConnectionChange?.(false);
      try { ws?.close(); } catch { /**/ }
    };
  }, [hasSeen, markSeen, historyAdd, pushPopup, play, onConnectionChange]);

  return (
    <div
      className="fixed top-20 right-6 z-[10000] flex flex-col gap-3 pointer-events-none"
      aria-label="Alert popups"
    >
      {queue.map((it) => (
        <div key={it.id} className="pointer-events-auto">
          <AlertPopupCard
            item={it}
            onDismiss={() => popPopup(it.id)}
            onNavigate={() => {
              popPopup(it.id);
              const cam = it.cameraId;
              navigate(`/live-monitoring${cam ? `?cameraId=${encodeURIComponent(cam)}` : ''}`);
            }}
          />
        </div>
      ))}
    </div>
  );
}
