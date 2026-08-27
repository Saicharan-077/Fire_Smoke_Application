import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AlertType = 'fire' | 'smoke';
export type SeverityType = 'info' | 'warning' | 'critical';

export interface NotificationItem {
  id: string; // alert id
  alertType: AlertType;
  cameraId: string | null;
  cameraName: string;
  zone: string | null;
  confidence: number;
  timestamp: string;
  evidenceUrl: string | null;
  severity: SeverityType;
  isRead: boolean;
}

interface NotificationsState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;

  // Unread badge count
  unreadCount: number;

  // history (bounded)
  history: NotificationItem[];
  addNotification: (n: NotificationItem) => void;
  clearHistory: () => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;

  // instant popup queue
  queue: NotificationItem[];
  pushPopup: (n: NotificationItem) => void;
  popPopup: (id: string) => void;

  // prevent duplicate popups
  seenIds: Record<string, true>;
  markSeen: (id: string) => void;
  hasSeen: (id: string) => boolean;
}

const MAX_HISTORY = 200;
const MAX_QUEUE = 10;

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set, get) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),

      unreadCount: 0,
      history: [],
      queue: [],
      seenIds: {},

      addNotification: (n) => {
        set((state) => {
          const nextHistory = [n, ...state.history].filter((_x, idx) => idx < MAX_HISTORY);
          const nextUnread = nextHistory.filter((x) => !x.isRead).length;
          return { 
            history: nextHistory,
            unreadCount: nextUnread
          };
        });
      },

      clearHistory: () => set({ history: [], queue: [], seenIds: {}, unreadCount: 0 }),

      markAsRead: (id) => set((state) => {
        const nextHistory = state.history.map((x) => 
          x.id === id ? { ...x, isRead: true } : x
        );
        const nextUnread = nextHistory.filter((x) => !x.isRead).length;
        return {
          history: nextHistory,
          unreadCount: nextUnread
        };
      }),

      markAllAsRead: () => set((state) => {
        const nextHistory = state.history.map((x) => ({ ...x, isRead: true }));
        return {
          history: nextHistory,
          unreadCount: 0
        };
      }),

      pushPopup: (n) => {
        if (!get().enabled) return;
        set((state) => {
          const exists = state.queue.some((x) => x.id === n.id);
          const nextQueue = exists ? state.queue : [n, ...state.queue].slice(0, MAX_QUEUE);
          return { queue: nextQueue };
        });
      },

      popPopup: (id) => set((state) => ({ queue: state.queue.filter((x) => x.id !== id) })),

      markSeen: (id) => set((state) => ({ seenIds: { ...state.seenIds, [id]: true } })),
      hasSeen: (id) => !!get().seenIds[id],
    }),
    {
      name: 'fg-notifications',
      version: 1,
      partialize: (state) => ({
        enabled: state.enabled,
        history: state.history,
        unreadCount: state.unreadCount,
      }),
    }
  )
);
