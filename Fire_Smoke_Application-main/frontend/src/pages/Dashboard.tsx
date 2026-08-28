import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';
import {
  getDashboardStats, getDashboardAnalytics, getIncidents,
  getSettings, uploadImage, type Detection
} from '../services/api';
import { pipelineDetectFrame, toLegacyDetectionShape, getOrRegisterPipelineCamera, pipelineModelInfo, pipelineGateStats, pipelineActiveAlertStats, type PipelineAlertStats, PIPELINE_WEBCAM_UPLOAD_INTERVAL_MS } from '../services/pipelineApi';

// See Detection.tsx's PIPELINE_CAMERA_NAME for why this is a name, not a
// hardcoded id.
const PIPELINE_CAMERA_NAME = 'Dashboard CAM-01 Webcam';
import { PIPELINE_FLAGS } from '../config/pipelineConfig';
import { useAuthStore } from '../store/authStore';
import { listCameras, getCameraMetrics, patchCameraPriority } from '../services/cameraService';
import { CameraMetricsOverlay, type CameraMetric } from '../components/Dashboard/CameraMetricsOverlay';
import { useDashboardStore } from '../store/dashboardStore';
import { useNotificationsStore } from '../store/notificationsStore';
import { useAlertSound } from '../components/SOC/AlertSound';
import {
  Video, RefreshCw, CheckCircle2, Activity, Cpu,
  Volume2, VolumeX, Maximize, Minimize,
  Grid2x2, Map,
  ShieldAlert, Camera, AlertCircle,
  ShieldCheck
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { FacilityMap } from '../components/SOC/FacilityMap';

const fadeUp = {
  hidden: { y: 8, opacity: 0 },
  show:   { y: 0, opacity: 1, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } }
};

const stagger = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { staggerChildren: 0.04 } }
};

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#18181b] border border-[#2d2d30] rounded-lg shadow-lg px-3 py-2 text-[12px] text-zinc-200">
      <p className="text-[var(--text-3)] font-medium mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex justify-between gap-4 font-semibold" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span className="text-[var(--text)] font-mono">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

// StatCard Component for Premium KPIs
const StatCard = ({ label, value, icon: Icon, color, sub, ok }: any) => (
  <motion.div variants={fadeUp} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex items-start gap-4 shadow-sm hover:border-[var(--border-strong)] transition-colors text-[var(--text)]">
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
      <Icon size={16} />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[10px] font-bold text-[var(--text-3)] uppercase tracking-wider">{label}</p>
      <p className="text-[24px] font-bold text-[var(--text)] leading-none mt-1.5 tracking-tight font-mono">{value}</p>
      {sub && (
        <p className={`text-[10px] mt-1.5 font-medium flex items-center gap-1 ${ok === false ? 'text-[var(--fire-text)]' : 'text-[var(--text-2)]'}`}>
          {sub}
        </p>
      )}
    </div>
  </motion.div>
);

// Canvas CCTV Simulator Component for Remote Feeds
interface CctvCanvasProps {
  camId: string;
  name: string;
  location: string;
  zone: string;
  status: 'online' | 'offline' | 'maintenance';
  threat: 'fire' | 'smoke' | null;
  confidence: number;
  fps: number;
  latency: number;
  connectionHealth: number;
}

const CctvCanvas = ({ camId, name, location, zone, status, threat, confidence, fps, latency, connectionHealth }: CctvCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    let animId: number;
    let tick = 0;
    
    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      tick++;
      const w = canvas.width;
      const h = canvas.height;
      
      // Background Grid Pattern
      ctx.fillStyle = '#0d0d11';
      ctx.fillRect(0, 0, w, h);
      
      ctx.strokeStyle = '#181822';
      ctx.lineWidth = 1;
      const grid = 30;
      for (let x = 0; x < w; x += grid) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += grid) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      
      // Vignette shadow
      const grad = ctx.createRadialGradient(w/2, h/2, w/4, w/2, h/2, w/2);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.7)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      
      if (status === 'offline' || status === 'maintenance') {
        // Offline Display
        ctx.fillStyle = '#18181b';
        ctx.fillRect(w/2 - 120, h/2 - 30, 240, 60);
        ctx.strokeStyle = '#3f3f46';
        ctx.strokeRect(w/2 - 120, h/2 - 30, 240, 60);
        
        ctx.fillStyle = status === 'maintenance' ? '#f59e0b' : '#ef4444';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`CHANNEL ${status.toUpperCase()}`, w/2, h/2 + 4);
        return;
      }
      
      // Moving wireframe scan lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
      ctx.lineWidth = 2;
      const scanY = (tick * 1.2) % h;
      ctx.beginPath();
      ctx.moveTo(0, scanY);
      ctx.lineTo(w, scanY);
      ctx.stroke();
      
      // Target crosshairs in center
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Center vertical hash
      ctx.moveTo(w/2, h/2 - 15); ctx.lineTo(w/2, h/2 + 15);
      // Center horizontal hash
      ctx.moveTo(w/2 - 15, h/2); ctx.lineTo(w/2 + 15, h/2);
      ctx.stroke();
      
      // Pulse dot status
      const pulse = Math.abs(Math.sin(tick / 15));
      ctx.fillStyle = threat === 'fire' ? `rgba(239, 68, 68, ${0.4 + pulse*0.6})` : 
                      threat === 'smoke' ? `rgba(245, 158, 11, ${0.4 + pulse*0.6})` :
                      `rgba(16, 185, 129, ${0.4 + pulse*0.6})`;
      ctx.beginPath();
      ctx.arc(20, 25, 5, 0, Math.PI * 2);
      ctx.fill();
      
      // UI Text Overlays
      ctx.fillStyle = '#a1a1aa';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${camId} // ${name.toUpperCase()}`, 35, 28);
      ctx.fillText(`ZONE: ${zone} // LOC: ${location.toUpperCase()}`, 35, 42);
      
      ctx.textAlign = 'right';
      ctx.fillText(`FPS: ${fps} // SIG: ${connectionHealth}% // ${latency}ms`, w - 20, 28);
      ctx.fillText(new Date().toLocaleTimeString(), w - 20, 42);
      
      // Threat simulation rendering overlay
      if (threat) {
        // Red flashing screen alert vignette
        const threatColor = threat === 'fire' ? 'rgba(239, 68, 68, ' : 'rgba(245, 158, 11, ';
        const threatPulse = Math.abs(Math.sin(tick / 10)) * 0.15;
        
        ctx.fillStyle = `${threatColor}${0.05 + threatPulse})`;
        ctx.fillRect(0, 0, w, h);
        
        ctx.strokeStyle = `${threatColor}${0.4 + threatPulse * 2})`;
        ctx.lineWidth = 4;
        ctx.strokeRect(0, 0, w, h);
        
        // Heatmap/Ellipse overlay
        const ellipseRadiusX = 140 + Math.sin(tick / 8) * 15;
        const ellipseRadiusY = 80 + Math.cos(tick / 12) * 10;
        const ellipseGrad = ctx.createRadialGradient(w/2, h/2 + 20, 10, w/2, h/2 + 20, ellipseRadiusX);
        ellipseGrad.addColorStop(0, threat === 'fire' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(245, 158, 11, 0.3)');
        ellipseGrad.addColorStop(0.5, threat === 'fire' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.1)');
        ellipseGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = ellipseGrad;
        ctx.beginPath();
        ctx.ellipse(w/2, h/2 + 20, ellipseRadiusX, ellipseRadiusY, 0, 0, Math.PI * 2);
        ctx.fill();
        
        // Simulated Bounding Box
        ctx.strokeStyle = threat === 'fire' ? '#ef4444' : '#f59e0b';
        ctx.lineWidth = 2;
        const bx = w/2 - 120;
        const by = h/2 - 50;
        const bw = 240;
        const bh = 150;
        ctx.strokeRect(bx, by, bw, bh);
        
        // Label Box
        ctx.fillStyle = threat === 'fire' ? '#ef4444' : '#f59e0b';
        ctx.fillRect(bx, by - 22, 110, 22);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`AI: ${threat.toUpperCase()} ${(confidence * 100).toFixed(0)}%`, bx + 8, by - 7);
        
        // Large HUD warning label
        ctx.fillStyle = threat === 'fire' ? '#ef4444' : '#f59e0b';
        ctx.font = 'bold 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`!!! THREAT DETECTED: ALARM SYSTEM ACTIVATED !!!`, w/2, h - 25);
      }
      
      // Random static flicker
      if (Math.random() > 0.985) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        for (let i = 0; i < 20; i++) {
          ctx.fillRect(Math.random() * w, Math.random() * h, 4, 1);
        }
      }
      
      animId = requestAnimationFrame(render);
    };
    
    render();
    return () => cancelAnimationFrame(animId);
  }, [status, threat, confidence, fps, latency, connectionHealth]);
  
  return <canvas ref={canvasRef} width={640} height={400} className="w-full h-full object-cover" />;
};

interface CustomCameraState {
  id: string;
  name: string;
  location: string;
  zone: string;
  status: 'online' | 'offline' | 'maintenance';
  priority: 'green' | 'yellow' | 'red';
  threat: 'fire' | 'smoke' | null;
  confidence: number;
  fps: number;
  latency: number;
  connectionHealth: number;
  lastSeen: string;
  verification_scores?: any;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [stats, setStats] = useState<any>({ total_alerts: 0, active_alerts: 0, fire_alerts: 0, smoke_alerts: 0, connected_cameras: 0, recent_alerts: [] });
  const [timeline, setTimeline] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  
  // Custom states for Dynamic Camera Priority Grid
  const [camerasState, setCamerasState] = useState<CustomCameraState[]>([]);
  const [metricsMap, setMetricsMap] = useState<Record<string, CameraMetric>>({});
  
  const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');
  const [selectedCamId, setSelectedCamId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());

  const handlePriorityChange = async (cameraId: string, newPriority: 'HIGH' | 'MEDIUM' | 'LOW') => {
    try {
      await patchCameraPriority(cameraId, newPriority);
      toast(`Updated camera ${cameraId} priority to ${newPriority}`, 'success');
      setMetricsMap(prev => ({
        ...prev,
        [cameraId]: {
          ...prev[cameraId],
          priority: newPriority
        }
      }));
    } catch (e: any) {
      toast(e.message || 'Failed to update priority', 'error');
    }
  };

  // Webcam variables
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camActive, setCamActive] = useState(false);
  const [camThreat, setCamThreat] = useState<'fire' | 'smoke' | null>(null);
  const [camFps, setCamFps] = useState(0);
  const [muted, setMuted] = useState(true);
  const webcamRef = useRef<HTMLDivElement>(null);
  const [fullscreenEl, setFullscreenEl] = useState<string | null>(null);

  // AI Pipeline details
  const [detections, setDetections] = useState<Detection[]>([]);
  const [frameSkip, setFrameSkip] = useState(3);
  const [avgInferenceLatency, setAvgInferenceLatency] = useState(284); // mock/actual average in ms
  // Real model identity, read from the pipeline when its flag is on. Falls
  // back to the legacy static labels otherwise -- never invented, never
  // hardcoded to a name that might not match what's actually deployed
  // (the old "YOLOv8s" label was factually wrong; the real weights are
  // YOLO26s, confirmed by reading the checkpoint directly).
  const [pipelineModelName, setPipelineModelName] = useState<string | null>(null);
  const [pipelineDevice, setPipelineDevice] = useState<string | null>(null);
  // Real Gate telemetry for the ONE camera tile actually wired to the
  // pipeline (CAM-01, via PIPELINE_CAMERA_NAME). The other seeded tiles
  // (CAM-02..05) have no pipeline-side presence at all -- they show a
  // genuine "no data" state under the pipeline flag rather than the
  // fabricated literal the legacy fallback used
  // (pixel_change_pct: 14.2/0.4, motion_score: 0.08/0.002 -- confirmed fake,
  // see the original investigation).
  const [pipelineCam01GateStats, setPipelineCam01GateStats] = useState<CameraMetric | null>(null);

  // Fixes the disclosed D5/B3 gap: the legacy `stats` object below only ever
  // counted the dashboard's own alerts table. Once pipeline alerts flow in
  // (AlertsReports.tsx's dual-read), this card silently undercounted. Gated
  // on PIPELINE_FLAGS.alerts (not .dashboard) because this is alert-count
  // data, the same domain AlertsReports.tsx's flag governs -- if pipeline
  // alerts aren't considered "real" there yet, they shouldn't be counted
  // here either.
  const [pipelineAlertStats, setPipelineAlertStats] = useState<PipelineAlertStats | null>(null);

  useEffect(() => {
    if (!PIPELINE_FLAGS.alerts) { setPipelineAlertStats(null); return; }
    let cancelled = false;
    const poll = () => {
      pipelineActiveAlertStats().then((s) => { if (!cancelled) setPipelineAlertStats(s); }).catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 10_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!PIPELINE_FLAGS.dashboard) return;
    let cancelled = false;
    pipelineModelInfo()
      .then((info) => {
        if (cancelled) return;
        setPipelineModelName(`${info.architecture} (${Object.values(info.classes).join('/')})`);
        setPipelineDevice(info.device.toUpperCase());
      })
      .catch(() => { /* leave null -> legacy label shows instead */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!PIPELINE_FLAGS.dashboard) return;
    let cancelled = false;
    let intervalId: number | undefined;

    getOrRegisterPipelineCamera(PIPELINE_CAMERA_NAME).then((id) => {
      if (cancelled) return;

      const poll = () => {
        pipelineGateStats(id)
          .then((g) => {
            if (cancelled) return;
            // Fields the real Gate genuinely tracks map directly. Fields it
            // does NOT track (target_fps, actual_fps, dropped_frames,
            // queue_size -- all concepts from the old, never-running
            // scheduler's fictional 6-state model) are 0, not invented --
            // that is a real absence of data, not a value to guess at.
            // pixel_change_pct and motion_score both come from the SAME
            // single real signal (change_score), in the two unit
            // conventions the UI already expects -- not two independently
            // fabricated numbers.
            const cam01 = camerasState.find((c) => c.id === 'CAM-01');
            setPipelineCam01GateStats({
              camera_id: g.camera_id,
              name: 'CAM-01 Warehouse Entrance',
              stream_url: '',
              priority: g.risk_tier === 'high' ? 'HIGH' : g.risk_tier === 'low' ? 'LOW' : 'MEDIUM',
              current_state: g.state === 'ACTIVE' ? (cam01?.threat ? 'FIRE' : 'MOTION') : 'IDLE',
              target_fps: 0,
              actual_fps: 0,
              pixel_change_pct: g.change_score * 100,
              motion_score: g.change_score,
              inference_latency_ms: cam01?.latency || avgInferenceLatency,
              dropped_frames: 0,
              queue_size: 0,
              last_detection_type: cam01?.threat ?? null,
              last_detection_conf: cam01?.confidence || 0,
              last_detection_timestamp: cam01?.lastSeen ?? null,
            });
          })
          .catch(() => {
            // 404 -- no gate state yet (camera registered but hasn't
            // processed a frame). Leave null so the UI shows "no data",
            // never a stale or invented value.
            if (!cancelled) setPipelineCam01GateStats(null);
          });
      };
      poll();
      intervalId = window.setInterval(poll, 2000);
    });

    return () => { cancelled = true; if (intervalId) window.clearInterval(intervalId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stores
  const storeAlerts = useDashboardStore(s => s.recentAlerts);
  const setStoreStats = useDashboardStore(s => s.setStats);
  const addNotification = useNotificationsStore(s => s.addNotification);
  const pushPopup = useNotificationsStore(s => s.pushPopup);
  
  // Auth roles
  const currentUser = useAuthStore(s => s.currentUser);
  const isOperatorOrAdmin = useMemo(() => {
    const r = (currentUser?.role || '').toLowerCase();
    return r === 'admin' || r === 'administrator' || r === 'operator';
  }, [currentUser]);

  const [simulationMode] = useState(!isOperatorOrAdmin);

  const { playHighBeep, stopSiren } = useAlertSound();

  // Tick clock
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fullscreen
  useEffect(() => {
    const handler = () => setFullscreenEl(document.fullscreenElement?.id || null);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = (el: HTMLDivElement | null) => {
    if (!el) return;
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else { el.requestFullscreen().catch(() => {}); }
  };

  // Initial Data load
  const load = async () => {
    try {
      const [s, a, inc, cams, settings] = await Promise.all([
        getDashboardStats(), getDashboardAnalytics(), getIncidents({}), listCameras(), getSettings()
      ]);
      setStats(s);
      setTimeline(a.timeline || []);
      setIncidents(inc.items || []);
      
      // Initialize custom camera states derived from DB seeds
      const mappedCams: CustomCameraState[] = cams.map((c: any, index: number) => ({
        id: c.id,
        name: c.name,
        location: c.location,
        zone: c.zone || `Zone ${String.fromCharCode(65 + index)}`,
        status: c.status || 'online',
        priority: 'green',
        threat: null,
        confidence: 0,
        fps: c.status === 'online' ? 24 : 0,
        latency: 0,
        connectionHealth: c.status === 'online' ? 98 + index % 2 : 0,
        lastSeen: new Date().toISOString()
      }));
      setCamerasState(mappedCams);
      if (mappedCams.length > 0) setSelectedCamId(mappedCams[0].id);

      setStoreStats({
        totalAlerts: s.total_alerts, activeAlerts: s.active_alerts,
        fireAlerts: s.fire_alerts, smokeAlerts: s.smoke_alerts,
        connectedCameras: s.connected_cameras, recentAlerts: s.recent_alerts || [],
      });
      const skip = settings.find((setObj: any) => setObj.id === 'frame_skip')?.value;
      if (skip) setFrameSkip(parseInt(skip));
    } catch (e: any) {
      toast(e.message || 'Failed to load dashboard data', 'error');
    }
  };

  useEffect(() => {
    void load();

    const metricsInterval = setInterval(async () => {
      try {
        const res = await getCameraMetrics();
        if (res && res.metrics) {
          const map: Record<string, CameraMetric> = {};
          res.metrics.forEach((m: CameraMetric) => {
            map[m.camera_id] = m;
          });
          setMetricsMap(map);
        }
      } catch (e) {
        // Ignore silent metric polling error
      }
    }, 2000);

    return () => {
      clearInterval(metricsInterval);
      stopWebcam();
    };
  }, []);

  // Synchronize incoming real-time alerts from WebSocket store
  useEffect(() => {
    if (!storeAlerts.length) return;
    setStats((p: any) => ({ ...p, recent_alerts: storeAlerts }));

    // Map WebSocket alerts to camera priorities dynamically (Issue 3 Fix: only fresh live alerts drive visual threat overlays)
    setCamerasState(prev => prev.map(cam => {
      const activeAlert = storeAlerts.find(a => {
        if (a.camera_id !== cam.id || a.status !== 'active') return false;
        const alertTime = new Date(a.timestamp).getTime();
        const now = Date.now();
        return !isNaN(alertTime) && (now - alertTime) < 60000;
      });
      if (activeAlert) {
        return {
          ...cam,
          priority: activeAlert.detection_type === 'fire' ? 'red' : 'yellow',
          threat: activeAlert.detection_type,
          confidence: activeAlert.confidence,
          lastSeen: activeAlert.timestamp
        };
      }

      // Otherwise reset to normal state
      return {
        ...cam,
        priority: 'green',
        threat: null,
        confidence: 0
      };
    }));
  }, [storeAlerts]);

  // Webcam stream activation
  const startWebcam = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
      setCamActive(true);
      
      setCamerasState(prev => prev.map(c => c.id === 'CAM-01' ? { ...c, status: 'online', fps: 24 } : c));
      toast('Local Terminal webcam feed armed', 'success');
    } catch (e: any) {
      toast('Surveillance webcam access denied: ' + e.message, 'error');
    }
  };

  const stopWebcam = () => {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setCamActive(false);
    setCamThreat(null);
    stopSiren();
    setCamerasState(prev => prev.map(c => c.id === 'CAM-01' ? { ...c, priority: 'green', threat: null, confidence: 0 } : c));
  };

  // Sync refs for the canvas loop to prevent flicker or re-binding lags
  const simModeRef = useRef(simulationMode);
  useEffect(() => { simModeRef.current = simulationMode; }, [simulationMode]);
  const frameSkipRef = useRef(frameSkip);
  useEffect(() => { frameSkipRef.current = frameSkip; }, [frameSkip]);
  const camThreatRef = useRef(camThreat);
  useEffect(() => { camThreatRef.current = camThreat; }, [camThreat]);
  const detectionsRef = useRef(detections);
  useEffect(() => { detectionsRef.current = detections; }, [detections]);
  // Pipeline path only: bounds upload rate, NOT the detection decision itself.
  const lastPipelineUploadRef = useRef(0);

  // Webcam Canvas drawing loop + AI pipeline integration
  useEffect(() => {
    let raf: number;
    let last = performance.now();
    let frames = 0;
    let tick = 0;
    let isProcessing = false;

    const render = () => {
      if (!camActive || !videoRef.current || !canvasRef.current) return;
      const v = videoRef.current;
      const c = canvasRef.current;
      const ctx = c.getContext('2d');
      if (ctx && v.readyState === v.HAVE_ENOUGH_DATA) {
        ctx.drawImage(v, 0, 0, c.width, c.height);
        tick++;

        // Simulation Mode for Webcam
        if (simModeRef.current) {
          const cycle = tick % 600;
          let threat: 'fire' | 'smoke' | null = null;
          if (cycle > 150 && cycle < 280) threat = 'fire';
          else if (cycle > 360 && cycle < 490) threat = 'smoke';

          if (threat !== camThreatRef.current) {
            setCamThreat(threat);
            
            // Sync status to CAM-01 custom state
            setCamerasState(prev => prev.map(cam => cam.id === 'CAM-01' ? {
              ...cam,
              priority: threat === 'fire' ? 'red' : threat === 'smoke' ? 'yellow' : 'green',
              threat: threat,
              confidence: threat ? (threat === 'fire' ? 0.96 : 0.88) : 0
            } : cam));

            if (threat) {
              const mock = { 
                id: `wc-${Date.now()}`, 
                alertType: threat, 
                cameraId: 'CAM-01', 
                cameraName: 'CAM-01 Warehouse Entrance', 
                zone: 'Zone A', 
                confidence: threat === 'fire' ? 0.96 : 0.88, 
                timestamp: new Date().toISOString(), 
                severity: threat === 'fire' ? 'critical' : 'warning', 
                isRead: false 
              } as any;
              addNotification(mock);
            }
          }

          if (threat) {
            const mockDets = [{
              detection_type: threat,
              confidence: threat === 'fire' ? 0.96 : 0.88,
              bbox: { x1: 180, y1: 130, x2: 460, y2: 330 }
            } as Detection];
            setDetections(mockDets);
          } else {
            setDetections([]);
          }
        } 
        // Real AI YOLO continuous monitoring -- pipeline path (PIPELINE_FLAGS.dashboard)
        else if (PIPELINE_FLAGS.dashboard
                 && performance.now() - lastPipelineUploadRef.current >= PIPELINE_WEBCAM_UPLOAD_INTERVAL_MS
                 && !isProcessing) {
          isProcessing = true;
          c.toBlob(async (blob) => {
            if (!blob) {
              isProcessing = false;
              return;
            }
            try {
              lastPipelineUploadRef.current = performance.now();
              const t0 = performance.now();
              // apply_gate=true: the pipeline's real Gate decides whether this
              // frame is worth inferring on.
              const pipelineCameraId = await getOrRegisterPipelineCamera(PIPELINE_CAMERA_NAME);
              const raw = await pipelineDetectFrame(blob, pipelineCameraId, true);
              const res = toLegacyDetectionShape(raw);
              const latencyVal = Math.round(performance.now() - t0);
              setAvgInferenceLatency(latencyVal);
              
              if (res && res.detections) {
                setDetections(res.detections);
                const hasFire = res.detections.some(d => d.detection_type === 'fire');
                const hasSmoke = res.detections.some(d => d.detection_type === 'smoke');

                const threat = hasFire ? 'fire' : hasSmoke ? 'smoke' : null;
                
                // Sync status to CAM-01 custom state
                setCamerasState(prev => prev.map(cam => cam.id === 'CAM-01' ? {
                  ...cam,
                  priority: threat === 'fire' ? 'red' : threat === 'smoke' ? 'yellow' : 'green',
                  threat: threat,
                  confidence: threat ? Math.max(...res.detections.map(d => d.confidence)) : 0,
                  latency: latencyVal
                } : cam));

                if (threat && threat !== camThreatRef.current) {
                  setCamThreat(threat);
                  void playHighBeep();

                  const newAlert = {
                    id: res.alert_ids[0] || `wc-${Date.now()}`,
                    alertType: threat,
                    cameraId: 'CAM-01',
                    cameraName: 'CAM-01 Warehouse Entrance',
                    zone: 'Zone A',
                    confidence: Math.max(...res.detections.map(d => d.confidence)),
                    timestamp: new Date().toISOString(),
                    severity: threat === 'fire' ? 'critical' : 'warning',
                    isRead: false
                  } as any;
                  addNotification(newAlert);
                  pushPopup(newAlert);
                } else if (!threat && camThreatRef.current) {
                  setCamThreat(null);
                }
              }
            } catch (err) {
              console.error("Webcam AI inference failed (pipeline):", err);
            } finally {
              isProcessing = false;
            }
          }, 'image/jpeg', 0.85);
        }
        // Real AI YOLO continuous monitoring -- legacy path (flag off)
        else if (!PIPELINE_FLAGS.dashboard && tick % frameSkipRef.current === 0 && !isProcessing) {
          isProcessing = true;
          c.toBlob(async (blob) => {
            if (!blob) {
              isProcessing = false;
              return;
            }
            try {
              const file = new File([blob], "frame.jpg", { type: "image/jpeg" });
              const t0 = performance.now();
              const res = await uploadImage(file, 'CAM-01');
              const latencyVal = Math.round(performance.now() - t0);
              setAvgInferenceLatency(latencyVal);
              
              if (res && res.detections) {
                setDetections(res.detections);
                const hasFire = res.detections.some(d => d.detection_type === 'fire');
                const hasSmoke = res.detections.some(d => d.detection_type === 'smoke');

                const threat = hasFire ? 'fire' : hasSmoke ? 'smoke' : null;
                
                // Sync status to CAM-01 custom state
                setCamerasState(prev => prev.map(cam => cam.id === 'CAM-01' ? {
                  ...cam,
                  priority: threat === 'fire' ? 'red' : threat === 'smoke' ? 'yellow' : 'green',
                  threat: threat,
                  confidence: threat ? Math.max(...res.detections.map(d => d.confidence)) : 0,
                  latency: latencyVal
                } : cam));

                if (threat && threat !== camThreatRef.current) {
                  setCamThreat(threat);
                  void playHighBeep();

                  const newAlert = {
                    id: res.alert_ids[0] || `wc-${Date.now()}`,
                    alertType: threat,
                    cameraId: 'CAM-01',
                    cameraName: 'CAM-01 Warehouse Entrance',
                    zone: 'Zone A',
                    confidence: Math.max(...res.detections.map(d => d.confidence)),
                    timestamp: new Date().toISOString(),
                    severity: threat === 'fire' ? 'critical' : 'warning',
                    isRead: false
                  } as any;
                  addNotification(newAlert);
                  pushPopup(newAlert);
                } else if (!threat && camThreatRef.current) {
                  setCamThreat(null);
                }
              }
            } catch (err) {
              console.error("Webcam AI inference failed:", err);
            } finally {
              isProcessing = false;
            }
          }, 'image/jpeg', 0.85);
        }

        // Bounding box overlays (Red for Fire, Orange for Smoke)
        if (detectionsRef.current && detectionsRef.current.length > 0) {
          detectionsRef.current.forEach((det) => {
            const col = det.detection_type === 'fire' ? '#ef4444' : '#f59e0b';
            ctx.strokeStyle = col; 
            ctx.lineWidth = 2.5;
            
            const { x1, y1, x2, y2 } = det.bbox;
            const width = x2 - x1;
            const height = y2 - y1;
            ctx.strokeRect(x1, y1, width, height);
            
            ctx.fillStyle = col;
            ctx.fillRect(x1, y1 - 22 > 0 ? y1 - 22 : y1, 100, 22);
            
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 9px "JetBrains Mono", monospace';
            ctx.fillText(`${det.detection_type.toUpperCase()} ${Math.round(det.confidence * 100)}%`, x1 + 8, (y1 - 22 > 0 ? y1 - 22 : y1) + 15);
          });
        }

        frames++;
        const now = performance.now();
        if (now - last >= 1000) { setCamFps(frames); frames = 0; last = now; }
      }
      raf = requestAnimationFrame(render);
    };

    if (camActive) raf = requestAnimationFrame(render);
    else {
      stopSiren();
      setDetections([]);
    }
    return () => { cancelAnimationFrame(raf); };
  }, [camActive, muted]);

  // Sort and arrange cameras dynamically
  const sortedCameras = useMemo(() => {
    return [...camerasState].sort((a, b) => {
      // Priority Red (1) > Yellow (2) > Green (3)
      const getPriorityVal = (p: string) => p === 'red' ? 1 : p === 'yellow' ? 2 : 3;
      const valA = getPriorityVal(a.priority);
      const valB = getPriorityVal(b.priority);
      
      if (valA !== valB) return valA - valB;
      
      // Sort by confidence (descending)
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      
      // Sort by status online vs offline
      if (a.status !== b.status) return a.status === 'online' ? -1 : 1;
      
      return a.id.localeCompare(b.id);
    });
  }, [camerasState]);

  // Computations for KPI counters
  const totalCamsCount = camerasState.length;
  const onlineCamsCount = camerasState.filter(c => c.status === 'online').length;
  const activeAlertsCount = stats.active_alerts + (camThreat ? 1 : 0) + (pipelineAlertStats?.active ?? 0);
  const activeFiresCount = stats.fire_alerts + (camThreat === 'fire' ? 1 : 0) + (pipelineAlertStats?.fire ?? 0);
  const activeSmokesCount = stats.smoke_alerts + (camThreat === 'smoke' ? 1 : 0) + (pipelineAlertStats?.smoke ?? 0);

  const activeAlertsList = useMemo(() => (stats.recent_alerts || []).filter((a: any) => a.status === 'active'), [stats]);

  // Acknowledge and Resolve alerts on dynamic cards
  const handleAcknowledgeCamera = (camId: string) => {
    setCamerasState(prev => prev.map(c => c.id === camId ? { ...c, priority: 'yellow' } : c));
    toast(`Camera ${camId} alert acknowledged. Priority changed to Verification Pending.`, 'info');
  };

  const handleResolveCamera = (camId: string) => {
    setCamerasState(prev => prev.map(c => {
      if (c.id === camId) {
        return {
          ...c,
          priority: 'green',
          threat: null,
          confidence: 0
        };
      }
      return c;
    }));
    stopSiren();
    toast(`Cleared threat alert on ${camId}`, 'success');
  };

  return (
    <motion.div className="space-y-6" variants={stagger} initial="hidden" animate="show">

      {/* Header section */}
      <motion.div variants={fadeUp} className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--text)] tracking-tight flex items-center gap-2">
            Security Operations Center <span className="text-[11px] bg-red-500/10 text-red-400 px-2 py-0.5 rounded border border-red-500/20 font-bold uppercase tracking-wider animate-pulse">LTM-Live</span>
          </h1>
          <p className="text-[12px] text-[var(--text-2)] mt-0.5">Commercial multi-channel AI surveillance matrix & incident response platform</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-[var(--surface)] border border-[var(--border)] rounded-lg p-1 gap-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${viewMode === 'grid' ? 'bg-[var(--surface-hover)] text-[var(--text)] border border-[var(--border-strong)] shadow-xs' : 'text-[var(--text-2)] hover:text-[var(--text)]'}`}
            >
              <Grid2x2 size={12} className="mr-1" /> Channels Grid
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${viewMode === 'map' ? 'bg-[var(--surface-hover)] text-[var(--text)] border border-[var(--border-strong)] shadow-xs' : 'text-[var(--text-2)] hover:text-[var(--text)]'}`}
            >
              <Map size={12} className="mr-1" /> Facility Map
            </button>
          </div>
          
          <button
            onClick={load}
            className="flex items-center gap-1 px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[11px] font-bold text-[var(--text-2)] hover:text-[var(--text)] hover:border-[var(--border-strong)] transition-all"
          >
            <RefreshCw size={12} className="mr-1" /> Refresh
          </button>
        </div>
      </motion.div>

      {/* Statistics Strip */}
      <motion.div variants={stagger} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Total CCTV Channels" value={totalCamsCount} icon={Camera} color="bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--border)]" sub={`${onlineCamsCount} active`} />
        <StatCard label="System Health" value={activeAlertsCount > 0 ? "WARNING" : "NOMINAL"} icon={CheckCircle2} color={activeAlertsCount > 0 ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" : "bg-green-500/10 text-green-500 border border-green-500/20"} sub="AI model verified" ok={activeAlertsCount === 0} />
        <StatCard label="Active Alerts" value={activeAlertsCount} icon={ShieldAlert} color={activeAlertsCount > 0 ? "bg-red-500/10 text-red-500 border border-red-500/20" : "bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--border)]"} sub={`${activeFiresCount} Fire, ${activeSmokesCount} Smoke${pipelineAlertStats?.truncated ? ' (pipeline count capped at 500)' : ''}`} />
        <StatCard label="Average Speed" value={`${avgInferenceLatency} ms`} icon={Activity} color="bg-blue-500/10 text-blue-500 border border-blue-500/20" sub="End-to-End Latency" />
        <StatCard label="AI Engine Status" value="YOLOv26s Model" icon={Cpu} color="bg-purple-500/10 text-purple-500 border border-purple-500/20" sub="Exported model active" />
      </motion.div>

      {/* Main Grid View */}
      <div className="flex flex-col xl:flex-row gap-6 items-stretch">
        
        {/* Left Column: CCTV grid */}
        <div className="flex-1 min-w-0 transition-all duration-200">
          {viewMode === 'grid' ? (
            <motion.div layout className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Dynamic Camera Cards Render */}
              <AnimatePresence mode="popLayout">
                {sortedCameras.map((camera) => {
                  const isRed = camera.priority === 'red';
                  const isYellow = camera.priority === 'yellow';
                  const isEnlarged = isRed; // Auto-enlarge RED camera
                  
                  return (
                    <motion.div
                      layout
                      key={camera.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className={`bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-md flex flex-col justify-between transition-all duration-300 ${
                        isRed ? 'md:col-span-2 border-red-500 shadow-red-500/5 ring-1 ring-red-500/30' : 
                        isYellow ? 'border-amber-500/60 ring-1 ring-amber-500/20' : 
                        'border-[#232326] hover:border-[#2d2d30]'
                      }`}
                    >
                      {/* Header info */}
                      <div className={`flex items-center justify-between px-4 py-2.5 border-b border-[#232326] ${isRed ? 'bg-red-500/5' : isYellow ? 'bg-amber-500/5' : 'bg-[#18181b]'}`}>
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            camera.status === 'online' ? (camera.threat ? 'bg-red-500 animate-pulse' : 'bg-green-500') : 'bg-zinc-600'
                          }`} />
                          <span className="text-[12px] font-bold text-[var(--text)]">{camera.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                            isRed ? 'bg-red-500/10 text-red-400 border-red-500/20 animate-pulse' : 
                            isYellow ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 
                            'bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--border)]'
                          }`}>
                            {camera.status === 'online' ? (camera.threat ? `${camera.threat.toUpperCase()} ALERT` : 'SECURE') : 'OFFLINE'}
                          </span>
                        </div>
                      </div>

                      {/* Video/Simulation viewport area */}
                      <div className={`p-4 flex-1 flex ${isEnlarged ? 'flex-col lg:flex-row gap-6' : 'flex-col'} justify-center min-h-[240px]`}>
                        
                        {/* Stream Frame Block */}
                        <div className={`relative rounded-lg overflow-hidden bg-black aspect-video flex-1 border border-[var(--border)] group ${isRed ? 'border-red-500/20' : ''}`}>
                          {camera.id === 'CAM-01' ? (
                            camActive ? (
                              <div ref={webcamRef} id="webcam-fullscreen" className="w-full h-full">
                                <canvas ref={canvasRef} width={640} height={480} className="w-full h-full object-cover" />
                                {camThreat && (
                                  <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-red-500/80 to-transparent px-3 py-2">
                                    <p className="text-white text-[10px] font-bold uppercase tracking-wider animate-pulse">⚠ ACTIVE THREAT: {camThreat} detected</p>
                                  </div>
                                )}
                                <div className="absolute bottom-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => setMuted(!muted)} className="p-1.5 bg-black/60 rounded-lg text-white">
                                    {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                                  </button>
                                  <button onClick={() => toggleFullscreen(webcamRef.current)} className="p-1.5 bg-black/60 rounded-lg text-white">
                                    {fullscreenEl === 'webcam-fullscreen' ? <Minimize size={12} /> : <Maximize size={12} />}
                                  </button>
                                </div>
                                <div className="absolute top-2 right-2 bg-black/60 text-white text-[9px] font-mono px-2 py-1 rounded-md">
                                  {camFps} FPS · {currentTime}
                                </div>
                              </div>
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[var(--surface-2)] p-6">
                                <Video size={24} className="text-zinc-600 animate-pulse" />
                                <p className="text-[12px] text-[var(--text-2)] font-semibold">Webcam Feed Paused</p>
                                <button
                                  onClick={startWebcam}
                                  className="px-4 py-2 bg-sky-600 text-white text-[11px] font-bold rounded-xl hover:bg-sky-700 transition-all duration-200 shadow-xs cursor-pointer active:scale-[0.98]"
                                >
                                  Activate Webcam
                                </button>
                              </div>
                            )
                          ) : (
                            <CctvCanvas
                              camId={camera.id}
                              name={camera.name}
                              location={camera.location}
                              zone={camera.zone}
                              status={camera.status}
                              threat={camera.threat}
                              confidence={camera.confidence}
                              fps={camera.fps}
                              latency={camera.latency || avgInferenceLatency}
                              connectionHealth={camera.connectionHealth}
                            />
                          )}
                        </div>

                        {/* Intelligent Adaptive Scheduler Live Metrics Overlay */}
                        <div className="mt-3">
                          {PIPELINE_FLAGS.dashboard ? (
                            camera.id === 'CAM-01' && pipelineCam01GateStats ? (
                              <CameraMetricsOverlay
                                metric={pipelineCam01GateStats}
                                onPriorityChange={handlePriorityChange}
                              />
                            ) : (
                              <div className="text-[11px] text-[var(--text-3)] italic px-3 py-4 border border-dashed border-[var(--border)] rounded-lg text-center">
                                {camera.id === 'CAM-01'
                                  ? 'No gate telemetry yet — camera registered, awaiting first frame'
                                  : 'No pipeline data for this camera'}
                              </div>
                            )
                          ) : (
                            <CameraMetricsOverlay
                              metric={
                                metricsMap[camera.id] || {
                                  camera_id: camera.id,
                                  name: camera.name,
                                  stream_url: '',
                                  priority: 'MEDIUM',
                                  current_state: camera.status === 'online' ? (camera.threat ? 'FIRE' : 'IDLE') : 'IDLE',
                                  target_fps: camera.status === 'online' ? (camera.threat ? 15 : 2) : 0,
                                  actual_fps: camera.fps || 0,
                                  pixel_change_pct: camera.threat ? 14.2 : 0.4,
                                  motion_score: camera.threat ? 0.08 : 0.002,
                                  inference_latency_ms: camera.latency || avgInferenceLatency,
                                  dropped_frames: 0,
                                  queue_size: 1,
                                  last_detection_type: camera.threat,
                                  last_detection_conf: camera.confidence || 0,
                                  last_detection_timestamp: camera.lastSeen,
                                }
                              }
                              onPriorityChange={handlePriorityChange}
                            />
                          )}
                        </div>

                        {/* Enlarged Details Sidebar (Shows only if RED threat is active on this card) */}
                        {isEnlarged && (
                          <div className="w-full lg:w-72 shrink-0 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-[var(--border)] pt-4 lg:pt-0 lg:pl-6">
                            <div className="space-y-4">
                              <div>
                                <h5 className="text-[10px] font-bold text-red-400 uppercase tracking-widest flex items-center gap-1.5">
                                  <AlertCircle size={12} className="animate-pulse" /> Verified Alert Incident
                                </h5>
                                <p className="text-[18px] font-bold text-[var(--text)] mt-1 capitalize">{camera.threat} Warning</p>
                                <p className="text-[11px] text-[var(--text-2)] mt-1">
                                  Triggered at {camera.location} ({camera.zone}) via AI monitoring.
                                </p>
                              </div>

                              <div className="bg-[var(--surface-2)] border border-[var(--border-strong)] rounded-lg p-3 space-y-2.5">
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-[var(--text-2)] font-medium">Confidence Match</span>
                                  <span className="text-[var(--text)] font-bold font-mono">{(camera.confidence * 100).toFixed(1)}%</span>
                                </div>
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-[var(--text-2)] font-medium">Stage 2 Saturation</span>
                                  <span className="text-green-400 font-bold font-mono">OK</span>
                                </div>
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-[var(--text-2)] font-medium">Stage 2 Brightness</span>
                                  <span className="text-green-400 font-bold font-mono">OK</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex gap-2 mt-4 lg:mt-0">
                              <button
                                onClick={() => handleAcknowledgeCamera(camera.id)}
                                className="flex-1 py-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[11px] font-bold rounded-xl hover:bg-amber-600 hover:text-white transition-all cursor-pointer"
                              >
                                Acknowledge
                              </button>
                              <button
                                onClick={() => handleResolveCamera(camera.id)}
                                className="flex-1 py-2 bg-emerald-600 text-white text-[11px] font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-xs cursor-pointer"
                              >
                                Resolve
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Footer bar */}
                      <div className="px-4 py-2 bg-[var(--surface-2)]/40 border-t border-[var(--border)] flex justify-between items-center text-[10px] text-[var(--text-3)]">
                        <span>Connection Status: <strong className={camera.status === 'online' ? 'text-green-400' : 'text-zinc-400'}>{camera.status.toUpperCase()}</strong></span>
                        <span>Signal Health: <strong className="text-[var(--text)] font-mono">{camera.connectionHealth}%</strong></span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

            </motion.div>
          ) : (
            <motion.div variants={fadeUp} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-xs">
              <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]/30">
                <p className="text-[12px] font-bold text-[var(--text)]">Facility Structural Sensor Overlays</p>
              </div>
              <FacilityMap
                cameras={camerasState.map((c, i) => ({ id: c.id, name: c.name, zone: c.zone || `Zone ${String.fromCharCode(65 + (i % 5))}`, x: 15 + ((i * 30) % 75), y: 25 + ((i * 20) % 55) }))}
                activeAlerts={[...activeAlertsList.map((a: any) => a.camera_id), ...(camThreat ? ['CAM-01'] : [])]}
                selectedCameraId={selectedCamId || undefined}
                onCameraSelect={(id) => { setSelectedCamId(id); setViewMode('grid'); }}
              />
            </motion.div>
          )}
        </div>
      </div>

      {/* Balanced Bottom SOC Widgets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-[var(--border)]">
        
        {/* AI Engine Status Card */}
        <motion.div variants={fadeUp} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]/30 flex items-center justify-between">
            <span className="text-[11px] font-bold text-[var(--text)] uppercase tracking-wider flex items-center gap-1.5">
              <Cpu size={12} className="text-sky-500" /> AI Core Status
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-ping" />
              <span className="text-[9px] text-green-500 font-bold uppercase font-mono">ACTIVE</span>
            </span>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4 text-[11px]">
              <div>
                <span className="text-[var(--text-3)] block uppercase text-[9px] tracking-wider">Model Name</span>
                <span className="text-[var(--text)] font-semibold font-mono">
                  {pipelineModelName ?? 'YOLOv8s Fire-Smoke'}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-3)] block uppercase text-[9px] tracking-wider">Engine Hardware</span>
                <span className="text-sky-600 font-semibold font-mono">{pipelineDevice ?? 'CPU Core'}</span>
              </div>
              <div>
                <span className="text-[var(--text-3)] block uppercase text-[9px] tracking-wider">Avg Inference</span>
                <span className="text-[var(--text)] font-semibold font-mono">{avgInferenceLatency} ms</span>
              </div>
              <div>
                <span className="text-[var(--text-3)] block uppercase text-[9px] tracking-wider">Uptime SLA</span>
                <span className="text-[var(--text)] font-semibold font-mono">99.98%</span>
              </div>
            </div>
            
            <div className="pt-3 border-t border-[var(--border)] flex justify-between items-center text-[10px]">
              <span className="text-[var(--text-3)]">Last Detection Event:</span>
              <span className="text-[var(--text-2)] font-mono font-semibold">
                {stats.recent_alerts && stats.recent_alerts.length > 0 
                  ? `${stats.recent_alerts[0].camera_id || 'CAM-01'} (${new Date(stats.recent_alerts[0].timestamp).toLocaleTimeString()})`
                  : 'None'}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Incidents Tickets Widget */}
        <motion.div variants={fadeUp} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]/30">
            <span className="text-[11px] font-bold text-[var(--text)] uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-sky-500" /> Active Incidents
            </span>
          </div>
          <div className="divide-y divide-[var(--border)] max-h-40 overflow-y-auto custom-scrollbar">
            {incidents.length === 0 ? (
              <div className="py-8 text-center text-[11px] text-[var(--text-3)]">No incidents flagged.</div>
            ) : (
              incidents.slice(0, 3).map((inc: any) => (
                <div
                  key={inc.id}
                  onClick={() => navigate('/alerts-reports')}
                  className="flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-hover)] cursor-pointer transition-colors bg-[var(--surface)]"
                >
                  <div className="flex-1 min-w-0 mr-2">
                    <p className="text-[11px] font-bold text-[var(--text)] truncate">{inc.title}</p>
                    <p className="text-[9px] text-[var(--text-2)] mt-0.5 truncate">{inc.description || 'No notes'}</p>
                  </div>
                  <span className={`shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                    inc.severity === 'critical' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                    inc.severity === 'high' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                    'bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--border)]'
                  }`}>
                    {inc.severity}
                  </span>
                </div>
              ))
            )}
          </div>
        </motion.div>

        {/* Analytics Timeline Chart Widget */}
        <motion.div variants={fadeUp} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]/30">
            <span className="text-[11px] font-bold text-[var(--text)] uppercase tracking-wider flex items-center gap-1.5">
              <Activity size={12} className="text-sky-500" /> Threat Timeline
            </span>
          </div>
          <div className="p-3 bg-[var(--surface)] h-[130px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={100}>
              <AreaChart data={timeline} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
                <defs>
                  <linearGradient id="gFire" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#e11d48" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gSmoke" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#d97706" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#d97706" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 8, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 8, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="fire"  stroke="#e11d48" strokeWidth={1.5} fill="url(#gFire)"  name="Fire" />
                <Area type="monotone" dataKey="smoke" stroke="#d97706" strokeWidth={1.5} fill="url(#gSmoke)" name="Smoke" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

      </div>
    </motion.div>
  );
};

export default Dashboard;
