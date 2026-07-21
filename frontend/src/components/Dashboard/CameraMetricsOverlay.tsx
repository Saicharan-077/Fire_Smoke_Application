import React from 'react';
import { Activity, ShieldAlert, Zap, Radio } from 'lucide-react';

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
    IDLE: { bg: 'bg-emerald-950/60', text: 'text-emerald-400', border: 'border-emerald-700/50' },
    MOTION: { bg: 'bg-amber-950/60', text: 'text-amber-400', border: 'border-amber-700/50' },
    SUSPICIOUS: { bg: 'bg-orange-950/70', text: 'text-orange-400', border: 'border-orange-600/80' },
    FIRE: { bg: 'bg-red-950/80', text: 'text-red-400', border: 'border-red-600' },
    CONFIRMED: { bg: 'bg-rose-950/90', text: 'text-rose-300', border: 'border-rose-500 font-bold' },
    RECOVERY: { bg: 'bg-blue-950/60', text: 'text-blue-400', border: 'border-blue-700/50' },
  };

  const currentTheme = stateColors[metric.current_state] || stateColors.IDLE;

  const priorityColors = {
    HIGH: 'bg-red-900/60 text-red-300 border-red-700',
    MEDIUM: 'bg-amber-900/60 text-amber-300 border-amber-700',
    LOW: 'bg-slate-800 text-slate-300 border-slate-700',
  };

  return (
    <div className="bg-[#121318]/90 backdrop-blur-md border border-zinc-800 rounded-lg p-3 text-[11px] font-sans text-zinc-300 shadow-xl space-y-2">
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span className="font-semibold text-zinc-100 truncate max-w-[120px]">{metric.name}</span>
        </div>

        {/* Priority Badge & Selector */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono">PRIO:</span>
          {onPriorityChange ? (
            <select
              value={metric.priority}
              onChange={(e) => onPriorityChange(metric.camera_id, e.target.value as any)}
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${priorityColors[metric.priority]} focus:outline-none cursor-pointer`}
            >
              <option value="HIGH" className="bg-zinc-900 text-red-400">HIGH (15 FPS)</option>
              <option value="MEDIUM" className="bg-zinc-900 text-amber-400">MEDIUM (8 FPS)</option>
              <option value="LOW" className="bg-zinc-900 text-slate-400">LOW (3 FPS)</option>
            </select>
          ) : (
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${priorityColors[metric.priority]}`}>
              {metric.priority}
            </span>
          )}
        </div>
      </div>

      {/* State Machine Status & Target FPS */}
      <div className="flex items-center justify-between">
        <div className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${currentTheme.bg} ${currentTheme.text} ${currentTheme.border} flex items-center gap-1`}>
          <Activity className="w-3 h-3" />
          <span>{metric.current_state}</span>
        </div>
        <div className="flex items-center gap-1 font-mono text-[10px] text-zinc-400">
          <Zap className="w-3 h-3 text-amber-400" />
          <span>{metric.target_fps} FPS</span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-1.5 pt-1 font-mono text-[10px]">
        <div className="bg-zinc-900/80 rounded p-1.5 border border-zinc-800/60">
          <span className="text-zinc-500 block">PIXEL CHANGE</span>
          <span className={`font-bold ${metric.pixel_change_pct >= 8.0 ? 'text-amber-400' : 'text-zinc-300'}`}>
            {metric.pixel_change_pct.toFixed(1)}%
          </span>
        </div>
        <div className="bg-zinc-900/80 rounded p-1.5 border border-zinc-800/60">
          <span className="text-zinc-500 block">MOTION SCORE</span>
          <span className={`font-bold ${metric.motion_score >= 0.01 ? 'text-amber-400' : 'text-zinc-300'}`}>
            {(metric.motion_score * 100).toFixed(1)}%
          </span>
        </div>
        <div className="bg-zinc-900/80 rounded p-1.5 border border-zinc-800/60">
          <span className="text-zinc-500 block">INFERENCE LATENCY</span>
          <span className="text-emerald-400 font-bold">{metric.inference_latency_ms.toFixed(1)} ms</span>
        </div>
        <div className="bg-zinc-900/80 rounded p-1.5 border border-zinc-800/60">
          <span className="text-zinc-500 block">QUEUE DEPTH</span>
          <span className="text-blue-400 font-bold">1 (Latest)</span>
        </div>
      </div>

      {/* Threat Confidence Bar if Threat Detected */}
      {metric.last_detection_conf > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-zinc-800">
          <div className="flex justify-between items-center text-[10px] font-mono mb-1">
            <span className="text-red-400 font-semibold flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" />
              {metric.last_detection_type?.toUpperCase()} DETECTED
            </span>
            <span className="text-red-300 font-bold">{(metric.last_detection_conf * 100).toFixed(0)}%</span>
          </div>
          <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-red-500 h-full transition-all duration-300"
              style={{ width: `${Math.min(100, metric.last_detection_conf * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
