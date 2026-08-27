import React from 'react';
import { ShieldCheck, Flame, Wind, AlertTriangle, Radio, WifiOff } from 'lucide-react';

export type StatusType = 'safe' | 'warning' | 'fire' | 'smoke' | 'critical' | 'offline' | 'monitoring';

interface StatusChipProps {
  status: StatusType | string;
  label?: string;
  className?: string;
}

export const StatusChip: React.FC<StatusChipProps> = ({ status, label, className = '' }) => {
  const normalized = status.toLowerCase();

  const getStatusConfig = () => {
    switch (normalized) {
      case 'fire':
      case 'critical':
        return {
          icon: <Flame size={12} className="text-red-400 animate-pulse" />,
          text: label || 'FIRE DETECTED',
          classes: 'bg-red-500/10 border-red-500/30 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.2)]',
        };
      case 'smoke':
        return {
          icon: <Wind size={12} className="text-amber-400 animate-pulse" />,
          text: label || 'SMOKE DETECTED',
          classes: 'bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]',
        };
      case 'warning':
      case 'possible':
        return {
          icon: <AlertTriangle size={12} className="text-amber-400" />,
          text: label || 'WARNING',
          classes: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
        };
      case 'safe':
      case 'normal':
      case 'active':
        return {
          icon: <ShieldCheck size={12} className="text-emerald-400" />,
          text: label || 'SYSTEM SAFE',
          classes: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
        };
      case 'offline':
        return {
          icon: <WifiOff size={12} className="text-gray-400" />,
          text: label || 'OFFLINE',
          classes: 'bg-gray-500/10 border-gray-500/30 text-gray-400',
        };
      case 'monitoring':
      default:
        return {
          icon: <Radio size={12} className="text-indigo-400 animate-pulse" />,
          text: label || 'MONITORING',
          classes: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <span className={`status-chip border ${config.classes} ${className}`}>
      {config.icon}
      <span>{config.text}</span>
    </span>
  );
};

export default StatusChip;
