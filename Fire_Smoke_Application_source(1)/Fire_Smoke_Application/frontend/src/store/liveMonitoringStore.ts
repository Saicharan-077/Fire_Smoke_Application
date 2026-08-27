import { create } from 'zustand';
import type { Alert } from './dashboardStore';

interface LiveMonitoringState {
  liveAlerts: Alert[];
  liveDetections: Record<string, unknown>[];
  upsertLiveAlert: (alert: Alert) => void;
  addLiveDetectionEvent: (event: Record<string, unknown>) => void;
  clearLive: () => void;
}

export const useLiveMonitoringStore = create<LiveMonitoringState>((set) => ({
  liveAlerts: [],
  liveDetections: [],

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

  clearLive: () => set({ liveAlerts: [], liveDetections: [] }),
}));

