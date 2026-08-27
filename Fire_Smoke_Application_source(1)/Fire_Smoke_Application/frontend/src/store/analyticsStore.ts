import { create } from 'zustand';

interface AnalyticsState {
  timeline: any[];
  zones: any[];
  weeklyTrend: any[];
  cameraActivity: any[];
  typeBreakdown: any[];
  isLoading: boolean;
  setAnalyticsData: (data: Partial<AnalyticsState>) => void;
  setLoading: (loading: boolean) => void;
}

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  timeline: [],
  zones: [],
  weeklyTrend: [],
  cameraActivity: [],
  typeBreakdown: [],
  isLoading: false,
  setAnalyticsData: (data) => set((state) => ({ ...state, ...data })),
  setLoading: (loading) => set({ isLoading: loading }),
}));
