import { useState, useEffect } from 'react';
import { RefreshCw, Wifi, WifiOff, Activity, Cpu, Zap } from 'lucide-react';
import { testCctvConnection, getRtspStreamUrl, connectRtspTelemetry, disconnectRtspStream } from '../../services/api';
import { useToast } from '../ui/Toast';

interface RtspStreamPlayerProps {
  rtspUrl: string;
  onThreatDetected?: (threat: 'fire' | 'smoke' | null) => void;
  onTelemetryUpdate?: (telemetry: any) => void;
  hideTelemetry?: boolean;
}

export const RtspStreamPlayer = ({ rtspUrl, onThreatDetected, onTelemetryUpdate, hideTelemetry = false }: RtspStreamPlayerProps) => {
  const { toast } = useToast();
  
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<any>({ fps: 0, inference_fps: 0, latency: 0, active_detections: [] });
  const [threat, setThreat] = useState<'fire' | 'smoke' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number>(0);

  useEffect(() => {
    let sse: EventSource | null = null;
    let mounted = true;

    const init = async () => {
      setLoading(true);
      setError(null);
      const t0 = performance.now();
      try {
        await testCctvConnection(rtspUrl);
        if (!mounted) return;
        setLatency(Math.round(performance.now() - t0));
        setStreamUrl(getRtspStreamUrl(rtspUrl));
        
        sse = connectRtspTelemetry(
          rtspUrl,
          (data) => {
            if (!mounted) return;
            setTelemetry(data);
            if (onTelemetryUpdate) onTelemetryUpdate(data);
            
            const hasFire = data.active_detections.some((d: any) => d.detection_type === 'fire');
            const hasSmoke = data.active_detections.some((d: any) => d.detection_type === 'smoke');
            const newThreat = hasFire ? 'fire' : hasSmoke ? 'smoke' : null;
            
            setThreat((prev) => {
              if (prev !== newThreat && onThreatDetected) {
                onThreatDetected(newThreat);
              }
              return newThreat;
            });
          },
          () => {
            // Suppress SSE disconnect noisy error
          }
        );
      } catch (err: any) {
        if (!mounted) return;
        setError(err.message || 'RTSP connection handshake failed');
        toast('RTSP connection handshake failed', 'error');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    
    void init();
    
    return () => {
      mounted = false;
      if (sse) sse.close();
      void disconnectRtspStream(rtspUrl).catch(() => {});
    };
  }, [rtspUrl]);

  if (error) {
     return (
       <div className="aspect-video w-full h-full rounded-xl border border-red-900 bg-red-950/20 flex flex-col items-center justify-center gap-3 text-red-400">
         <WifiOff size={24} />
         <p className="text-xs font-bold text-center px-4">{error}</p>
       </div>
     );
  }

  if (loading || !streamUrl) {
    return (
      <div className="aspect-video w-full h-full rounded-xl border border-slate-800 bg-slate-900 flex flex-col items-center justify-center gap-3 text-slate-400">
        <RefreshCw size={24} className="text-sky-500 animate-spin" />
        <p className="text-xs font-bold text-slate-200">Initializing RTSP Stream...</p>
        <p className="text-[10px] text-slate-500 px-4 text-center">Opening cv2 capture and first frame inference...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 w-full">
      <div className="relative rounded-xl overflow-hidden bg-black aspect-video shadow-2xl border border-slate-800">
        <img
          src={streamUrl}
          alt="Live RTSP AI Detection Feed"
          className="w-full h-full object-contain"
          style={{ imageRendering: 'auto' }}
        />
        {/* LIVE badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/70 backdrop-blur text-white text-[10px] font-mono px-2.5 py-1 rounded border border-white/10 pointer-events-none z-10">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          LIVE RTSP — AI INFERENCE
        </div>
        {/* FPS badge */}
        <div className="absolute top-2 right-2 bg-black/60 text-white text-[9px] font-mono px-2 py-1 rounded-md pointer-events-none z-10">
          {telemetry.fps} fps
        </div>
        {/* Threat banner */}
        {threat && (
          <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-red-600/80 to-transparent px-4 py-2 pointer-events-none z-10">
            <p className="text-white text-[11px] font-bold uppercase animate-pulse text-center">
              ⚠ ACTIVE THREAT: {threat.toUpperCase()} DETECTED
            </p>
          </div>
        )}
        {/* Detections overlay badge */}
        {telemetry.active_detections.length > 0 && (
          <div className="absolute bottom-2 left-2 bg-red-500/30 text-red-300 border border-red-500/50 text-[9px] font-mono px-2 py-1 rounded pointer-events-none z-10 animate-pulse">
            🔥 {telemetry.active_detections.length} DETECTION{telemetry.active_detections.length > 1 ? 'S' : ''} ACTIVE
          </div>
        )}
      </div>

      {/* Telemetry HUD */}
      {!hideTelemetry && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 text-center">
              <div className="text-[10px] text-slate-400 uppercase font-semibold flex items-center justify-center gap-1">
                <Activity size={10} className="text-sky-400" /> Stream FPS
              </div>
              <div className="text-sm font-bold text-slate-100 font-mono mt-0.5">{telemetry.fps}</div>
            </div>
            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 text-center">
              <div className="text-[10px] text-slate-400 uppercase font-semibold flex items-center justify-center gap-1">
                <Cpu size={10} className="text-emerald-400" /> Infer FPS
              </div>
              <div className="text-sm font-bold text-slate-100 font-mono mt-0.5">{telemetry.inference_fps}</div>
            </div>
            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 text-center">
              <div className="text-[10px] text-slate-400 uppercase font-semibold flex items-center justify-center gap-1">
                <Zap size={10} className="text-amber-400" /> Latency
              </div>
              <div className="text-sm font-bold text-slate-100 font-mono mt-0.5">{(telemetry.latency || 0).toFixed(0)} ms</div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-[var(--text-3)] font-semibold">
            <div className="flex items-center gap-1.5">
              <Wifi size={11} className="text-emerald-500" />
              <span className="font-mono truncate max-w-[220px]">{rtspUrl}</span>
            </div>
            <span className="font-mono text-[var(--text-3)]">{latency} ms probe</span>
          </div>
        </>
      )}
    </div>
  );
};
