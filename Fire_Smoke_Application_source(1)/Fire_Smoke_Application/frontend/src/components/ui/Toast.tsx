import { useState, createContext, useContext, useCallback, type ReactNode } from 'react';

import { CheckCircle2, AlertTriangle, Info, X, XCircle } from 'lucide-react';

type Variant = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  message: string;
  variant: Variant;
  exiting?: boolean;
}

interface ToastCtx {
  toast: (message: string, variant?: Variant) => void;
}

const ToastContext = createContext<ToastCtx>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

let _id = 0;

const ICONS: Record<Variant, typeof Info> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS: Record<Variant, string> = {
  success: 'var(--safe-text)',
  error: 'var(--fire-text)',
  warning: 'var(--warn-text)',
  info: 'var(--muted)',
};



const ToastItem = ({ t, onDismiss }: { t: Toast; onDismiss: (id: number) => void }) => {
  const Icon = ICONS[t.variant];
  return (
    <div
      className={t.exiting ? 'toast-exit' : 'toast-enter'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px',
        borderRadius: 12,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-lg)',
        minWidth: 300,
        maxWidth: 420,
        fontSize: 14,
        fontWeight: 500,
        color: 'var(--text)',
      }}
    >
      <Icon size={18} style={{ color: COLORS[t.variant], flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{t.message}</span>
      <button
        onClick={() => onDismiss(t.id)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--muted-2)' }}
      >
        <X size={14} />
      </button>
    </div>
  );
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 200);
  }, []);

  const toast = useCallback((message: string, variant: Variant = 'info') => {
    const id = ++_id;
    setToasts(prev => [...prev, { id, message, variant }]);
    setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {toasts.map(t => (
          <ToastItem key={t.id} t={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};
