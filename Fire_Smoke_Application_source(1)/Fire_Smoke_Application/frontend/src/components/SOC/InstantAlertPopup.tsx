import { useMemo, useState } from 'react';
import { AlertTriangle, Flame, Wind, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '../../components/Common/Button';
import type { NotificationItem } from '../../store/notificationsStore';


export function AlertPopupCard({
  item,
  onDismiss,
  onNavigate,
}: {
  item: NotificationItem;
  onDismiss: () => void;
  onNavigate: () => void;
}) {
  const theme = useMemo(() => {
    if (item.alertType === 'fire') {
      return {
        bar: 'bg-red-500',
        badge: 'bg-red-500/15 text-red-500 border-red-500/20',
        icon: <Flame size={16} />,
        title: 'Fire Alert',
      };
    }
    return {
      bar: 'bg-orange-500',
      badge: 'bg-orange-500/15 text-orange-500 border-orange-500/20',
      icon: <Wind size={16} />,
      title: 'Smoke Alert',
    };
  }, [item.alertType]);

  const [imgError, setImgError] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.98 }}
      className="w-[380px] bg-white dark:bg-[#0f0f17] border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-xl"
      role="status"
      aria-live="polite"
    >
      <div className={`h-1 w-full ${theme.bar}`} />

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-2 px-2 py-1 rounded-lg border ${theme.badge}`}>
                <AlertTriangle size={14} />
                {item.alertType.toUpperCase()}
              </span>
              <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
                {(item.confidence * 100).toFixed(1)}%
              </span>
            </div>
            <div className="mt-2">
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{theme.title}</p>
              <p className="text-sm text-gray-600 dark:text-gray-300 truncate">{item.cameraName || 'Unknown Camera'}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {new Date(item.timestamp).toLocaleString()}
              </p>
            </div>
          </div>

          <Button variant="ghost" size="sm" onClick={onDismiss} className="text-gray-500 hover:text-gray-700">
            <X size={16} />
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-[96px_1fr] gap-3 items-center">
          <div className="w-[96px] h-[72px] rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center">
            {!item.evidenceUrl || imgError ? (
              <div className="flex flex-col items-center text-gray-400">
                {theme.icon}
                <span className="text-[10px] mt-1 font-medium">No evidence</span>
              </div>
            ) : (
              <img
                src={item.evidenceUrl}
                alt="Evidence"
                className="w-full h-full object-cover"
                onError={() => setImgError(true)}
              />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-gray-500 dark:text-gray-400">Camera</div>
              <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">{item.cameraId || 'N/A'}</div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-gray-500 dark:text-gray-400">Severity</div>
              <div className="text-xs font-semibold text-gray-900 dark:text-white">{item.alertType === 'fire' ? 'Critical' : 'High'}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="primary" onClick={onNavigate} className="flex-1">
            View Camera
          </Button>
          <Button variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    </motion.div>
  );
}



