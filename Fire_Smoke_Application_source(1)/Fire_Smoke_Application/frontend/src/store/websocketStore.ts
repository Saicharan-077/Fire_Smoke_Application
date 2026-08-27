import { create } from 'zustand';

interface WebSocketState {
  isConnected: boolean;
  socket: WebSocket | null;
  connect: (url: string) => void;
  disconnect: () => void;
  sendMessage: (msg: any) => void;
}

export const useWebSocketStore = create<WebSocketState>((set, get) => ({
  isConnected: false,
  socket: null,
  connect: (url: string) => {
    if (get().socket) {
      get().socket?.close();
    }
    const ws = new WebSocket(url);
    ws.onopen = () => set({ isConnected: true, socket: ws });
    ws.onclose = () => set({ isConnected: false, socket: null });
    ws.onerror = (error) => {
      console.error('WebSocket Error:', error);
      set({ isConnected: false });
    };
    // The message handler should be assigned elsewhere or here if it needs to dispatch to other stores
  },
  disconnect: () => {
    get().socket?.close();
    set({ isConnected: false, socket: null });
  },
  sendMessage: (msg: any) => {
    const socket = get().socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }
}));
