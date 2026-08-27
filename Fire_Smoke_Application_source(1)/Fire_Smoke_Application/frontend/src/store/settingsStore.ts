import { create } from 'zustand';

interface SettingsState {
  theme: 'light' | 'dark';
  notificationsEnabled: boolean;
  alertSoundEnabled: boolean;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleNotifications: () => void;
  toggleAlertSound: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: 'light',
  notificationsEnabled: true,
  alertSoundEnabled: true,
  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
  toggleNotifications: () => set((state) => ({ notificationsEnabled: !state.notificationsEnabled })),
  toggleAlertSound: () => set((state) => ({ alertSoundEnabled: !state.alertSoundEnabled })),
}));
