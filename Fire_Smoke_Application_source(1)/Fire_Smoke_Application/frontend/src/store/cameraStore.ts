import { create } from 'zustand';

export interface Camera {
  id: string;
  name: string;
  location: string;
  zone: string;
  status: 'online' | 'offline' | 'maintenance';
  stream_url?: string;
}

interface CameraState {
  cameras: Camera[];
  isLoading: boolean;
  setCameras: (cameras: Camera[]) => void;
  updateCameraStatus: (id: string, status: 'online' | 'offline' | 'maintenance') => void;
  setLoading: (loading: boolean) => void;
}

export const useCameraStore = create<CameraState>((set) => ({
  cameras: [],
  isLoading: false,
  setCameras: (cameras) => set({ cameras }),
  updateCameraStatus: (id, status) => set((state) => ({
    cameras: state.cameras.map(cam => cam.id === id ? { ...cam, status } : cam)
  })),
  setLoading: (loading) => set({ isLoading: loading }),
}));
