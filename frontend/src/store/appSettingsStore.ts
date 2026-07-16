import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'midnight';

export interface ThemeConfig {
  id: Theme;
  label: string;
  icon: 'sun' | 'moon' | 'stars';
  colorScheme: 'light' | 'dark';
}

export const THEMES: ThemeConfig[] = [
  { id: 'light',    label: 'Light',    icon: 'sun',   colorScheme: 'light' },
  { id: 'dark',     label: 'Dark',     icon: 'moon',  colorScheme: 'dark'  },
  { id: 'midnight', label: 'Midnight', icon: 'stars', colorScheme: 'dark'  },
];

type AppSettingsState = {
  theme: Theme;
  notificationsEnabled: boolean;
  alertSoundEnabled: boolean;
  defaultGridLayout: '2x2' | '3x3' | '4x4';
  autoFocusNewAlerts: boolean;
  cameraRefreshRate: number; // in seconds

  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
  toggleNotifications: () => void;
  toggleAlertSound: () => void;
  setAlertSoundEnabled: (enabled: boolean) => void;
  setDefaultGridLayout: (layout: '2x2' | '3x3' | '4x4') => void;
  toggleAutoFocusNewAlerts: () => void;
  setCameraRefreshRate: (rate: number) => void;
};

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  const config = THEMES.find(t => t.id === theme);
  if (config?.colorScheme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export const useAppSettingsStore = create<AppSettingsState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      notificationsEnabled: true,
      alertSoundEnabled: true,
      defaultGridLayout: '2x2',
      autoFocusNewAlerts: true,
      cameraRefreshRate: 10,

      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      cycleTheme: () => {
        const current = get().theme;
        const idx = THEMES.findIndex(t => t.id === current);
        const next = THEMES[(idx + 1) % THEMES.length];
        applyTheme(next.id);
        set({ theme: next.id });
      },
      toggleNotifications: () => set((state) => ({ notificationsEnabled: !state.notificationsEnabled })),
      toggleAlertSound: () => set((state) => ({ alertSoundEnabled: !state.alertSoundEnabled })),
      setAlertSoundEnabled: (enabled) => set({ alertSoundEnabled: enabled }),
      setDefaultGridLayout: (layout) => set({ defaultGridLayout: layout }),
      toggleAutoFocusNewAlerts: () => set((state) => ({ autoFocusNewAlerts: !state.autoFocusNewAlerts })),
      setCameraRefreshRate: (rate) => set({ cameraRefreshRate: rate }),
    }),
    {
      name: 'fg-app-settings',
      version: 2,
      partialize: (state) => ({
        theme: state.theme,
        notificationsEnabled: state.notificationsEnabled,
        alertSoundEnabled: state.alertSoundEnabled,
        defaultGridLayout: state.defaultGridLayout,
        autoFocusNewAlerts: state.autoFocusNewAlerts,
        cameraRefreshRate: state.cameraRefreshRate,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        applyTheme(state.theme);
      },
    }
  )
);
