import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  role: string;
  last_login?: string;
  created_at?: string;
}

interface AuthState {
  currentUser: UserProfile | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: UserProfile) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      currentUser: null,
      token: null,
      isAuthenticated: false,
      login: (token, user) => {
        localStorage.setItem('fg-token', token);
        set({ token, currentUser: user, isAuthenticated: true });
      },
      logout: () => {
        localStorage.removeItem('fg-token');
        set({ token: null, currentUser: null, isAuthenticated: false });
      },
    }),
    {
      name: 'fg-auth',
      partialize: (state) => ({
        currentUser: state.currentUser,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
