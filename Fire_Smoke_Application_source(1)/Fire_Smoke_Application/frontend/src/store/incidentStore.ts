import { create } from 'zustand';
import type { Alert } from './dashboardStore';

interface IncidentState {
  incidents: Alert[];
  isLoading: boolean;
  filters: {
    status: string;
    detection_type: string;
    search: string;
  };
  setIncidents: (incidents: Alert[]) => void;
  updateIncidentStatus: (id: string, status: 'active' | 'resolved') => void;

  setFilters: (filters: Partial<IncidentState['filters']>) => void;
  setLoading: (loading: boolean) => void;
}

export const useIncidentStore = create<IncidentState>((set) => ({
  incidents: [],
  isLoading: false,
  filters: {
    status: '',
    detection_type: '',
    search: '',
  },
  setIncidents: (incidents) => set({ incidents }),
  updateIncidentStatus: (id, status) => set((state) => ({
    incidents: state.incidents.map(inc => inc.id === id ? { ...inc, status } : inc)
  })),

  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
  setLoading: (loading) => set({ isLoading: loading }),
}));
