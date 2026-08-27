import { create } from 'zustand';
import type { Alert } from './dashboardStore';

export type LiveAlertUpdate =
  | { event: 'new_alert'; alert: Alert }
  | { event: 'alert_update'; alert: Alert }
  | { event: 'detection_event'; detection_event: Record<string, unknown> };

interface MonitoringState {
  activeStreams: string[];
  liveAlerts: Alert[];
  liveDetections: Record<string, unknown>[];
  addLiveAlert: (alert: Alert) => void;
  upsertLiveAlert: (alert: Alert) => void;
  addLiveDetectionEvent: (event: Record<string, unknown>) => void;
  setActiveStreams: (streams: string[]) => void;
  clearLive: () => void;
}

export const useMonitoringStore = create<MonitoringState>((set) => ({
  activeStreams: [],
  liveAlerts: [],
  liveDetections: [],

  addLiveAlert: (alert) =>
    set((state) => ({
      liveAlerts: [alert, ...state.liveAlerts].slice(0, 50),
    })),

  upsertLiveAlert: (alert) =>
    set((state) => {
      const idx = state.liveAlerts.findIndex((a) => a.id === alert.id);
      if (idx === -1) {
        return { liveAlerts: [alert, ...state.liveAlerts].slice(0, 50) };
      }
      const next = [...state.liveAlerts];
      next[idx] = alert;
      return { liveAlerts: next };
    }),

  addLiveDetectionEvent: (event) =>
    set((state) => ({
      liveDetections: [event, ...state.liveDetections].slice(0, 200),
    })),

  setActiveStreams: (streams) => set({ activeStreams: streams }),
  clearLive: () => set({ liveAlerts: [], liveDetections: [] }),
}));

