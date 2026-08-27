import React from 'react';
import { Activity, Radio, Zap } from 'lucide-react';

export interface CameraMetric {
  camera_id: string;
  name: string;
  stream_url: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  current_state: 'IDLE' | 'MOTION' | 'SUSPICIOUS' | 'FIRE' | 'CONFIRMED' | 'RECOVERY';
  target_fps: number;
  actual_fps: number;
  pixel_change_pct: number;
  motion_score: number;
  inference_latency_ms: number;
  dropped_frames: number;
  queue_size: number;
  last_detection_type: string | null;
  last_detection_conf: number;
  last_detection_timestamp: string | null;
}

interface Props {
  metric: CameraMetric;
  onPriorityChange?: (cameraId: string, newPriority: 'HIGH' | 'MEDIUM' | 'LOW') => void;
}

export const CameraMetricsOverlay: React.FC<Props> = ({ metric, onPriorityChange }) => {
  const stateColors: Record<string, { bg: string; text: string; border: string }> = {
    IDLE: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/30' },
    MOTION: { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/30' },
    SUSPICIOUS: { bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/30' },
    FIRE: { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/30' },
    CONFIRMED: { bg: 'bg-rose-500/10', text: 'text-rose-500', border: 'border-rose-500/30' },
    RECOVERY: { bg: 'bg-sky-500/10', text: 'text-sky-500', border: 'border-sky-500/30' },
  };

  const currentTheme = stateColors[metric.current_state] || stateColors.IDLE;

  const priorityColors = {
    HIGH: 'bg-red-500/10 text-red-500 border-red-500/30',
    MEDIUM: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
    LOW: 'bg-[var(--glass-light-bg)] text-[var(--color-fg-secondary)] border-[var(--color-border)]',
  };

  return (
    <div className="glass-light border border-[var(--color-border)] rounded-xl p-3 text-[11px] font-sans text-[var(--color-fg)] shadow-sm space-y-2.5">
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] pb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse shrink-0" />
          <span className="font-bold text-[var(--color-fg)] truncate max-w-[140px]">{metric.name}</span>
        </div>

        {/* Priority Badge & Selector */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-[var(--color-muted)] uppercase tracking-wider font-extrabold">PRIO:</span>
          {onPriorityChange ? (
            <select
              value={metric.priority}
              onChange={(e) => onPriorityChange(metric.camera_id, e.target.value as any)}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${priorityColors[metric.priority]} bg-[var(--color-surface)] focus:outline-none cursor-pointer`}
            >
              <option value="HIGH" className="bg-[var(--color-surface)] text-red-500">HIGH (15 FPS)</option>
              <option value="MEDIUM" className="bg-[var(--color-surface)] text-amber-500">MEDIUM (8 FPS)</option>
              <option value="LOW" className="bg-[var(--color-surface)] text-[var(--color-fg-secondary)]">LOW (3 FPS)</option>
            </select>
          ) : (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${priorityColors[metric.priority]}`}>
              {metric.priority}
            </span>
          )}
        </div>
      </div>

      {/* State Machine Status & Target FPS */}
      <div className="flex items-center justify-between">
        <div className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${currentTheme.bg} ${currentTheme.text} ${currentTheme.border} flex items-center gap-1`}>
          <Activity className="w-3 h-3" />
          <span>{metric.current_state}</span>
        </div>
        <div className="flex items-center gap-1 text-[11px] font-bold text-[var(--color-muted)]">
          <Zap className="w-3 h-3 text-amber-500" />
          <span>{metric.target_fps} FPS</span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-2 pt-1 text-[10px]">
        <div className="glass-light rounded-lg p-2 border border-[var(--color-border)]">
          <span className="text-[var(--color-muted)] font-bold block uppercase text-[9px]">PIXEL CHANGE</span>
          <span className={`font-bold text-[12px] ${metric.pixel_change_pct >= 8.0 ? 'text-amber-500' : 'text-[var(--color-fg)]'}`}>
            {metric.pixel_change_pct.toFixed(1)}%
          </span>
        </div>
        <div className="glass-light rounded-lg p-2 border border-[var(--color-border)]">
          <span className="text-[var(--color-muted)] font-bold block uppercase text-[9px]">MOTION SCORE</span>
          <span className={`font-bold text-[12px] ${metric.motion_score >= 0.01 ? 'text-amber-500' : 'text-[var(--color-fg)]'}`}>
            {(metric.motion_score * 100).toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
};

export default CameraMetricsOverlay;
