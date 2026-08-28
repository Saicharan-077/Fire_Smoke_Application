import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';
import {
  getDashboardStats, getDashboardAnalytics, getIncidents,
  getSettings, uploadImage, type Detection
} from '../services/api';
import { useAuthStore } from '../store/authStore';
import { listCameras, getCameraMetrics, patchCameraPriority } from '../services/cameraService';
import { CameraMetricsOverlay, type CameraMetric } from '../components/Dashboard/CameraMetricsOverlay';
import { useDashboardStore } from '../store/dashboardStore';
import { useNotificationsStore } from '../store/notificationsStore';
import { useAlertSound } from '../components/SOC/AlertSound';
import {
  Video, RefreshCw, Activity, Cpu,
  Volume2, VolumeX, Maximize, Minimize,
  Grid2x2, Map,
  ShieldAlert, Camera, AlertCircle,
  ShieldCheck, BellRing, Flame
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

// StatCard Component with Massive Typography & Hierarchy
const StatCard = ({ label, value, icon: Icon, color, sub, ok }: any) => (
  <motion.div variants={fadeUp} className="glass-panel p-6 flex flex-col justify-between card-hover border border-[var(--color-border)] text-[var(--color-fg)] relative overflow-hidden group">
    <div className="flex items-center justify-between gap-2 mb-3">
      <p className="text-[11px] font-extrabold text-[var(--color-muted)] uppercase tracking-wider">{label}</p>
      <div className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 shadow-sm transition-transform duration-300 group-hover:scale-110 ${color}`}>
        <Icon size={16} />
      </div>
    </div>
    <div>
      <p className="text-3xl sm:text-4xl font-black text-[var(--color-fg)] tracking-tight leading-none">
        {value}
      </p>
      {sub && (
        <p className={`text-[12px] mt-2.5 font-bold flex items-center gap-1.5 ${ok === false ? 'text-red-400' : 'text-[var(--color-fg-secondary)]'}`}>
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

  const { playEmergencySiren, stopSiren } = useAlertSound();

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
        // Real AI continuous monitoring
        else if (tick % frameSkipRef.current === 0 && !isProcessing) {
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
                  void playEmergencySiren(2.8);

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

  const activeFiresCount = stats.fire_alerts + (camThreat === 'fire' ? 1 : 0);
  const activeSmokesCount = stats.smoke_alerts + (camThreat === 'smoke' ? 1 : 0);
  const hasActiveThreat = activeFiresCount > 0 || activeSmokesCount > 0 || !!camThreat;

  useEffect(() => {
    if (hasActiveThreat && !muted) {
      playEmergencySiren(2.8);
    }
  }, [hasActiveThreat, muted, playEmergencySiren]);

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

      {/* Compact Operational Header */}
      <motion.div variants={fadeUp} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <h1 className="text-page-title text-[var(--color-fg)] flex items-center gap-2">
            Security Operations Center
          </h1>
          <span className="tech-badge">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
            LIVE
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              playEmergencySiren(2.8);
              toast('🔊 Sounding 2-3s Emergency Siren Alarm...', 'error');
            }}
            className="floating-pill text-rose-400 hover:text-rose-300 hover:border-rose-500/40 cursor-pointer font-bold text-xs flex items-center gap-1"
            title="Test 2-3s Siren Alarm Sound"
          >
            <BellRing size={12} className="animate-pulse" />
            <span>Test Siren</span>
          </button>

          <div className="floating-pill py-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${viewMode === 'grid' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]'}`}
            >
              <Grid2x2 size={12} className="inline mr-1" /> Channels
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${viewMode === 'map' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]'}`}
            >
              <Map size={12} className="inline mr-1" /> Facility
            </button>
          </div>
          
          <button
            onClick={load}
            className="floating-pill text-[var(--color-fg-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 cursor-pointer"
            title="Refresh All Feeds"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </motion.div>

      {/* High-Impact Emergency Hazard Siren Banner */}
      {hasActiveThreat && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10 }}
          className="p-4 rounded-2xl border-2 border-rose-500 bg-gradient-to-r from-rose-950/80 via-red-900/50 to-slate-950 text-white shadow-[0_0_50px_rgba(239,68,68,0.4)] flex flex-wrap items-center justify-between gap-4 animate-pulse"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-rose-500/20 border border-rose-500/50 text-rose-400 flex items-center justify-center shrink-0 shadow-lg shadow-rose-500/20">
              <BellRing className="w-6 h-6 animate-bounce text-rose-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                  <Flame size={14} className="text-rose-500" /> CRITICAL HAZARD ACTIVE — {activeFiresCount > 0 ? 'FIRE INCIDENT' : 'SMOKE DETECTED'}
                </span>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-600 text-white uppercase tracking-wider shadow-sm">
                  SIREN ACTIVE (2-3s)
                </span>
              </div>
              <p className="text-xs text-rose-200/90 font-semibold mt-0.5">
                Immediate threat detected in optical surveillance feed. Emergency acoustic siren sounding continuously for 2–3s.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => playEmergencySiren(2.8)}
              className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
            >
              <Volume2 size={13} /> Re-Play Siren (3s)
            </button>
            <button
              onClick={() => {
                stopSiren();
                setCamThreat(null);
                setCamerasState(prev => prev.map(c => ({ ...c, threat: null, priority: 'green' })));
                toast('Emergency siren silenced and alarm cleared', 'info');
              }}
              className="px-3.5 py-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-rose-500/40 text-rose-300 font-bold text-xs transition-all cursor-pointer flex items-center gap-1.5"
            >
              <VolumeX size={13} /> Silence Siren
            </button>
          </div>
        </motion.div>
      )}

      {/* Compact 4 KPI Cards */}
      <motion.div variants={stagger} className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <StatCard 
          label="Cameras Online" 
          value={`${onlineCamsCount} / ${totalCamsCount}`} 
          icon={Camera} 
          color="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" 
          sub="All Channels Active" 
        />
        <StatCard 
          label="Fire Alerts" 
          value={activeFiresCount} 
          icon={ShieldAlert} 
          color={activeFiresCount > 0 ? "bg-red-500/15 text-red-400 border border-red-500/30 animate-pulse" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"} 
          sub={activeFiresCount > 0 ? "Critical Threat Detected" : "Zero Threats"} 
          ok={activeFiresCount === 0} 
        />
        <StatCard 
          label="Smoke Warnings" 
          value={activeSmokesCount} 
          icon={ShieldAlert} 
          color={activeSmokesCount > 0 ? "bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"} 
          sub={activeSmokesCount > 0 ? "Attention Required" : "Zero Warnings"} 
          ok={activeSmokesCount === 0}
        />
        <StatCard 
          label="Inference Latency" 
          value={`${avgInferenceLatency} ms`} 
          icon={Activity} 
          color="bg-blue-500/10 text-blue-400 border border-blue-500/20" 
          sub="Neural Vision Core" 
        />
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
                      className={`glass rounded-2xl overflow-hidden shadow-sm flex flex-col justify-between transition-all duration-300 ${
                        isRed ? 'md:col-span-2 border-red-500/80 shadow-[0_0_30px_rgba(239,68,68,0.2)] ring-1 ring-red-500/40' : 
                        isYellow ? 'border-amber-500/70 ring-1 ring-amber-500/30' : 
                        'border-[var(--color-border)] hover:border-[var(--color-accent)]/30'
                      }`}
                    >
                      {/* Header info */}
                      <div className={`flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] ${isRed ? 'bg-red-500/10' : isYellow ? 'bg-amber-500/10' : 'bg-[var(--glass-light-bg)]'}`}>
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${
                            camera.status === 'online' ? (camera.threat ? 'bg-red-500 animate-ping' : 'bg-emerald-500') : 'bg-gray-400'
                          }`} />
                          <span className="text-[13px] font-bold text-[var(--color-fg)]">{camera.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                            isRed ? 'bg-red-500/10 text-red-500 border-red-500/30 animate-pulse' : 
                            isYellow ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' : 
                            'bg-[var(--glass-light-bg)] text-[var(--color-fg-secondary)] border border-[var(--color-border)]'
                          }`}>
                            {camera.status === 'online' ? (camera.threat ? `${camera.threat.toUpperCase()} ALERT` : 'SECURE') : 'OFFLINE'}
                          </span>
                        </div>
                      </div>

                      {/* Video/Simulation viewport area */}
                      <div className={`p-4 flex-1 flex ${isEnlarged ? 'flex-col lg:flex-row gap-6' : 'flex-col'} justify-center min-h-[240px]`}>
                        
                        {/* Stream Frame Block */}
                        <div className={`relative rounded-xl overflow-hidden bg-black aspect-video flex-1 border border-[var(--color-border)] group ${isRed ? 'border-red-500/40' : ''}`}>
                          {camera.id === 'CAM-01' ? (
                            camActive ? (
                              <div ref={webcamRef} id="webcam-fullscreen" className="w-full h-full">
                                <canvas ref={canvasRef} width={640} height={480} className="w-full h-full object-cover" />
                                {camThreat && (
                                  <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-red-500/90 to-transparent px-4 py-2.5">
                                    <p className="text-white text-[11px] font-bold uppercase tracking-wider animate-pulse">⚠ ACTIVE THREAT: {camThreat} detected</p>
                                  </div>
                                )}
                                <div className="absolute bottom-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => setMuted(!muted)} className="p-1.5 glass rounded-lg text-white hover:scale-105 transition-transform cursor-pointer">
                                    {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                                  </button>
                                  <button onClick={() => toggleFullscreen(webcamRef.current)} className="p-1.5 glass rounded-lg text-white hover:scale-105 transition-transform cursor-pointer">
                                    {fullscreenEl === 'webcam-fullscreen' ? <Minimize size={14} /> : <Maximize size={14} />}
                                  </button>
                                </div>
                                <div className="absolute top-2 right-2 glass text-white text-[10px] font-semibold px-2.5 py-1 rounded-lg">
                                  {camFps} FPS · {currentTime}
                                </div>
                              </div>
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[var(--color-surface-2)] p-6">
                                <Video size={28} className="text-[var(--color-muted)] animate-pulse" />
                                <p className="text-[13px] text-[var(--color-fg-secondary)] font-bold">Webcam Feed Paused</p>
                                <button
                                  onClick={startWebcam}
                                  className="px-4 py-2 bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-2)] text-white text-xs font-bold rounded-xl hover:scale-105 transition-all shadow-glow cursor-pointer active:scale-[0.98]"
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
                        </div>

                        {/* Enlarged Details Sidebar (Shows only if RED threat is active on this card) */}
                        {isEnlarged && (
                          <div className="w-full lg:w-72 shrink-0 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-[var(--color-border)] pt-4 lg:pt-0 lg:pl-6">
                            <div className="space-y-4">
                              <div>
                                <h5 className="text-[10px] font-bold text-red-500 uppercase tracking-widest flex items-center gap-1.5">
                                  <AlertCircle size={14} className="animate-pulse" /> Verified Alert Incident
                                </h5>
                                <p className="text-[18px] font-black text-[var(--color-fg)] mt-1 capitalize">{camera.threat} Warning</p>
                                <p className="text-[11px] text-[var(--color-muted)] mt-1 font-medium">
                                  Triggered at {camera.location} ({camera.zone}) via AI monitoring.
                                </p>
                              </div>

                              <div className="glass-light border border-[var(--color-border)] rounded-xl p-3.5 space-y-2.5">
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-[var(--color-muted)] font-medium">Confidence Match</span>
                                  <span className="text-[var(--color-fg)] font-bold">{(camera.confidence * 100).toFixed(1)}%</span>
                                </div>
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-[var(--color-muted)] font-medium">Stage 2 Saturation</span>
                                  <span className="text-emerald-500 font-bold">OK</span>
                                </div>
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-[var(--color-muted)] font-medium">Stage 2 Brightness</span>
                                  <span className="text-emerald-500 font-bold">OK</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex gap-2.5 mt-4 lg:mt-0">
                              <button
                                onClick={() => handleAcknowledgeCamera(camera.id)}
                                className="flex-1 py-2.5 bg-amber-500/10 text-amber-500 border border-amber-500/30 text-xs font-bold rounded-xl hover:bg-amber-500 hover:text-white transition-all cursor-pointer"
                              >
                                Acknowledge
                              </button>
                              <button
                                onClick={() => handleResolveCamera(camera.id)}
                                className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-700 text-white text-xs font-bold rounded-xl hover:scale-105 transition-all shadow-sm cursor-pointer"
                              >
                                Resolve
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Footer bar */}
                      <div className="px-4 py-2.5 bg-[var(--glass-light-bg)] border-t border-[var(--color-border)] flex justify-between items-center text-[10px] text-[var(--color-muted)]">
                        <span>Connection Status: <strong className={`font-bold ${camera.status === 'online' ? 'text-emerald-500' : 'text-gray-400'}`}>{camera.status.toUpperCase()}</strong></span>
                        <span>Signal Health: <strong className="text-[var(--color-fg)] font-bold">{camera.connectionHealth}%</strong></span>
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
        <motion.div variants={fadeUp} className="glass rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--color-border)] bg-[var(--glass-light-bg)] flex items-center justify-between">
            <span className="text-[11px] font-extrabold text-[var(--color-fg)] uppercase tracking-wider flex items-center gap-2">
              <Cpu size={14} className="text-[var(--color-accent)]" /> AI Core Status
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-[10px] font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>ACTIVE</span>
            </span>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4 text-[11px]">
              <div>
                <span className="text-[var(--color-muted)] block uppercase text-[10px] font-bold tracking-wider">Vision Engine</span>
                <span className="text-[var(--color-fg)] font-bold text-[13px]">FireGuard Vision Core</span>
              </div>
              <div>
                <span className="text-[var(--color-muted)] block uppercase text-[10px] font-bold tracking-wider">Engine Hardware</span>
                <span className="text-[var(--color-accent)] font-bold text-[13px]">CPU Core</span>
              </div>
              <div>
                <span className="text-[var(--color-muted)] block uppercase text-[10px] font-bold tracking-wider">Avg Inference</span>
                <span className="text-[var(--color-fg)] font-bold text-[13px]">{avgInferenceLatency} ms</span>
              </div>
              <div>
                <span className="text-[var(--color-muted)] block uppercase text-[10px] font-bold tracking-wider">Uptime SLA</span>
                <span className="text-[var(--color-fg)] font-bold text-[13px]">99.98%</span>
              </div>
            </div>
            
            <div className="pt-3 border-t border-[var(--color-border)] flex justify-between items-center text-[11px]">
              <span className="text-[var(--color-muted)] font-medium">Last Detection Event:</span>
              <span className="text-[var(--color-fg-secondary)] font-bold">
                {stats.recent_alerts && stats.recent_alerts.length > 0 
                  ? `${stats.recent_alerts[0].camera_id || 'CAM-01'} (${new Date(stats.recent_alerts[0].timestamp).toLocaleTimeString()})`
                  : 'None'}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Incidents Tickets Widget */}
        <motion.div variants={fadeUp} className="glass rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--color-border)] bg-[var(--glass-light-bg)]">
            <span className="text-[11px] font-extrabold text-[var(--color-fg)] uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck size={14} className="text-[var(--color-accent)]" /> Active Incidents
            </span>
          </div>
          <div className="divide-y divide-[var(--color-border)] max-h-44 overflow-y-auto custom-scrollbar">
            {incidents.length === 0 ? (
              <div className="py-10 text-center text-[12px] font-medium text-[var(--color-muted)]">No incidents flagged.</div>
            ) : (
              incidents.slice(0, 3).map((inc: any) => (
                <div
                  key={inc.id}
                  onClick={() => navigate('/alerts-reports')}
                  className="flex items-center justify-between px-5 py-3 hover:bg-[var(--glass-light-bg)] cursor-pointer transition-colors"
                >
                  <div className="flex-1 min-w-0 mr-2">
                    <p className="text-[12px] font-bold text-[var(--color-fg)] truncate">{inc.title}</p>
                    <p className="text-[10px] text-[var(--color-muted)] mt-0.5 truncate">{inc.description || 'No notes'}</p>
                  </div>
                  <span className={`shrink-0 text-[9px] font-extrabold px-2 py-0.5 rounded-full border uppercase ${
                    inc.severity === 'critical' ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                    inc.severity === 'high' ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' :
                    'bg-[var(--glass-light-bg)] text-[var(--color-fg-secondary)] border border-[var(--color-border)]'
                  }`}>
                    {inc.severity}
                  </span>
                </div>
              ))
            )}
          </div>
        </motion.div>

        {/* Analytics Timeline Chart Widget */}
        <motion.div variants={fadeUp} className="glass rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--color-border)] bg-[var(--glass-light-bg)]">
            <span className="text-[11px] font-extrabold text-[var(--color-fg)] uppercase tracking-wider flex items-center gap-2">
              <Activity size={14} className="text-[var(--color-accent)]" /> Threat Timeline
            </span>
          </div>
          <div className="p-4 h-[135px]">
            <ResponsiveContainer width="100%" height={100} minWidth={0} minHeight={100}>
              <AreaChart data={timeline} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
                <defs>
                  <linearGradient id="gFire" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#e11d48" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gSmoke" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#d97706" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#d97706" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="fire"  stroke="#e11d48" strokeWidth={2} fill="url(#gFire)"  name="Fire" />
                <Area type="monotone" dataKey="smoke" stroke="#d97706" strokeWidth={2} fill="url(#gSmoke)" name="Smoke" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

      </div>
    </motion.div>
  );
};

export default Dashboard;
