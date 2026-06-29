import { create } from 'zustand';

export interface Alert {
  id: string;
  detection_type: 'fire' | 'smoke';
  confidence: number;
  status: 'active' | 'resolved';
  source_type: string;
  camera_id?: string | null;
  location?: string | null;
  file_name?: string | null;
  evidence_path?: string | null;
  frame_number?: number | null;
  timestamp: string;
}


interface DashboardState {
  totalAlerts: number;
  activeAlerts: number;
  fireAlerts: number;
  smokeAlerts: number;
  connectedCameras: number;
  recentAlerts: Alert[];
  setStats: (stats: Partial<DashboardState>) => void;
  addRecentAlert: (alert: Alert) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  totalAlerts: 0,
  activeAlerts: 0,
  fireAlerts: 0,
  smokeAlerts: 0,
  connectedCameras: 0,
  recentAlerts: [],
  setStats: (stats) => set((state) => ({ ...state, ...stats })),
  addRecentAlert: (alert) => set((state) => {
    const newAlerts = [alert, ...state.recentAlerts].slice(0, 10);
    return { 
      recentAlerts: newAlerts,
      activeAlerts: state.activeAlerts + 1,
      totalAlerts: state.totalAlerts + 1,
      fireAlerts: state.fireAlerts + (alert.detection_type === 'fire' ? 1 : 0),
      smokeAlerts: state.smokeAlerts + (alert.detection_type === 'smoke' ? 1 : 0),
    };
  }),
}));
