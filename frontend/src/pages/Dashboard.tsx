import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';
import {
  getDashboardStats, getDashboardAnalytics, getIncidents,
  testCctvConnection, getSettings, uploadImage, type Detection
} from '../services/api';
import { useAuthStore } from '../store/authStore';
import { listCameras } from '../services/cameraService';
import { useDashboardStore } from '../store/dashboardStore';
import { useNotificationsStore } from '../store/notificationsStore';
import {
  Video, RefreshCw, CheckCircle2, Activity, Cpu,
  Volume2, VolumeX, Maximize, Minimize,
  Grid2x2, Map, Wifi, WifiOff,
  Flame, Wind, ShieldAlert, Camera, AlertCircle,
  Sliders, Search, Filter, ShieldCheck, Play, Square,
  PlayCircle
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
      <p className="text-zinc-500 font-medium mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex justify-between gap-4 font-semibold" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span className="text-white font-mono">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

// StatCard Component for Premium KPIs
const StatCard = ({ label, value, icon: Icon, color, sub, ok }: any) => (
  <motion.div variants={fadeUp} className="bg-[#18181b] border border-[#232326] rounded-xl p-5 flex items-start gap-4 shadow-sm hover:border-[#2d2d30] transition-colors">
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
      <Icon size={16} />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className="text-[24px] font-bold text-white leading-none mt-1.5 tracking-tight font-mono">{value}</p>
      {sub && (
        <p className={`text-[10px] mt-1.5 font-medium flex items-center gap-1 ${ok === false ? 'text-red-400' : 'text-zinc-400'}`}>
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
  const [injectedThreats, setInjectedThreats] = useState<Record<string, { threat: 'fire' | 'smoke'; confidence: number }>>({});
  
  const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');
  const [selectedCamId, setSelectedCamId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [injectorOpen, setInjectorOpen] = useState(true);

  // Alert Center Search and Filters
  const [alertSearch, setAlertSearch] = useState('');
  const [alertFilter, setAlertFilter] = useState<'all' | 'fire' | 'smoke'>('all');

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

  const [simulationMode, setSimulationMode] = useState(!isOperatorOrAdmin);

  // Audio refs
  const audioCtx = useRef<AudioContext | null>(null);
  const oscNode = useRef<OscillatorNode | null>(null);

  const startSiren = () => {
    if (muted) return;
    try {
      if (!audioCtx.current) audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtx.current;
      if (ctx.state === 'suspended') void ctx.resume();
      if (oscNode.current) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      oscNode.current = osc;
      let up = true;
      const id = setInterval(() => {
        if (!oscNode.current) { clearInterval(id); return; }
        osc.frequency.setValueAtTime(up ? 880 : 440, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(up ? 440 : 880, ctx.currentTime + 0.5);
        up = !up;
      }, 500);
    } catch { /**/ }
  };

  const stopSiren = () => {
    try {
      oscNode.current?.stop();
      oscNode.current?.disconnect();
      oscNode.current = null;
    } catch { /**/ }
  };

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
    return () => { stopWebcam(); };
  }, []);

  // Synchronize incoming real-time alerts from WebSocket store
  useEffect(() => {
    if (!storeAlerts.length) return;
    setStats((p: any) => ({ ...p, recent_alerts: storeAlerts }));

    // Map WebSocket alerts to camera priorities dynamically
    setCamerasState(prev => prev.map(cam => {
      // Look for active alerts matching this camera ID
      const activeAlert = storeAlerts.find(a => a.camera_id === cam.id && a.status === 'active');
      if (activeAlert) {
        return {
          ...cam,
          priority: activeAlert.detection_type === 'fire' ? 'red' : 'yellow',
          threat: activeAlert.detection_type,
          confidence: activeAlert.confidence,
          lastSeen: activeAlert.timestamp
        };
      }

      // If a threat was injected, preserve it
      const hasInjection = injectedThreats[cam.id];
      if (hasInjection) {
        return {
          ...cam,
          priority: hasInjection.threat === 'fire' ? 'red' : 'yellow',
          threat: hasInjection.threat,
          confidence: hasInjection.confidence
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
  }, [storeAlerts, injectedThreats]);

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
              startSiren();
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
              pushPopup(mock);
            } else { 
              stopSiren(); 
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
        // Real AI YOLO continuous monitoring
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
                  startSiren();

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
                  stopSiren();
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

  // Demo Threat Injector Handlers
  const injectThreat = (cameraId: string, type: 'fire' | 'smoke') => {
    const confidence = type === 'fire' ? 0.94 + Math.random() * 0.05 : 0.82 + Math.random() * 0.1;
    
    // Add to injected threats state
    setInjectedThreats(p => ({ ...p, [cameraId]: { threat: type, confidence } }));
    
    // Update camera priority
    setCamerasState(prev => prev.map(c => {
      if (c.id === cameraId) {
        return {
          ...c,
          priority: type === 'fire' ? 'red' : 'yellow',
          threat: type,
          confidence: parseFloat(confidence.toFixed(4)),
          lastSeen: new Date().toISOString()
        };
      }
      return c;
    }));

    // Trigger local siren if any critical threat is injected
    if (type === 'fire') {
      startSiren();
    }

    // Trigger instant alert in Notification & Dashboard store
    const mockAlert = {
      id: `inject-${cameraId}-${Date.now()}`,
      alertType: type,
      cameraId: cameraId,
      cameraName: camerasState.find(c => c.id === cameraId)?.name || cameraId,
      zone: camerasState.find(c => c.id === cameraId)?.zone || 'Zone A',
      confidence: parseFloat(confidence.toFixed(4)),
      timestamp: new Date().toISOString(),
      severity: type === 'fire' ? 'critical' : 'warning',
      isRead: false
    } as any;

    addNotification(mockAlert);
    pushPopup(mockAlert);
    
    toast(`Injected simulated ${type.toUpperCase()} on camera ${cameraId}`, 'info');
  };

  const clearThreat = (cameraId: string) => {
    setInjectedThreats(p => {
      const copy = { ...p };
      delete copy[cameraId];
      return copy;
    });

    setCamerasState(prev => prev.map(c => {
      if (c.id === cameraId) {
        return {
          ...c,
          priority: 'green',
          threat: null,
          confidence: 0
        };
      }
      return c;
    }));

    // If no more red threats exist, stop sound
    const hasRemainingFires = Object.values(injectedThreats).some(t => t.threat === 'fire');
    if (!hasRemainingFires && !camThreat) {
      stopSiren();
    }

    toast(`Cleared threat simulation on ${cameraId}`, 'success');
  };

  const clearAllThreats = () => {
    setInjectedThreats({});
    setCamerasState(prev => prev.map(c => ({
      ...c,
      priority: 'green',
      threat: null,
      confidence: 0
    })));
    stopSiren();
    if (camActive) {
      setCamThreat(null);
    }
    toast('All threats cleared. Grid layout returned to nominal states.', 'success');
  };

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
  const offlineCamsCount = camerasState.filter(c => c.status !== 'online').length;
  const activeAlertsCount = stats.active_alerts + Object.keys(injectedThreats).length + (camThreat ? 1 : 0);
  const activeFiresCount = stats.fire_alerts + Object.values(injectedThreats).filter(t => t.threat === 'fire').length + (camThreat === 'fire' ? 1 : 0);
  const activeSmokesCount = stats.smoke_alerts + Object.values(injectedThreats).filter(t => t.threat === 'smoke').length + (camThreat === 'smoke' ? 1 : 0);

  const activeAlertsList = useMemo(() => (stats.recent_alerts || []).filter((a: any) => a.status === 'active'), [stats]);

  // Acknowledge and Resolve alerts on dynamic cards
  const handleAcknowledgeCamera = (camId: string) => {
    setCamerasState(prev => prev.map(c => c.id === camId ? { ...c, priority: 'yellow' } : c));
    toast(`Camera ${camId} alert acknowledged. Priority changed to Verification Pending.`, 'info');
  };

  const handleResolveCamera = (camId: string) => {
    clearThreat(camId);
  };

  // Filtered Alerts for the Enterprise Alert Center sidebar
  const filteredAlerts = useMemo(() => {
    const list = stats.recent_alerts || [];
    return list.filter((a: any) => {
      const matchQuery = alertSearch === '' || 
        a.camera_id?.toLowerCase().includes(alertSearch.toLowerCase()) ||
        a.detection_type.toLowerCase().includes(alertSearch.toLowerCase());
      const matchType = alertFilter === 'all' || a.detection_type === alertFilter;
      return matchQuery && matchType;
    });
  }, [stats.recent_alerts, alertSearch, alertFilter]);

  return (
    <motion.div className="space-y-6" variants={stagger} initial="hidden" animate="show">

      {/* Header section */}
      <motion.div variants={fadeUp} className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-white tracking-tight flex items-center gap-2">
            Security Operations Center <span className="text-[11px] bg-red-500/10 text-red-400 px-2 py-0.5 rounded border border-red-500/20 font-bold uppercase tracking-wider animate-pulse">LTM-Live</span>
          </h1>
          <p className="text-[12px] text-zinc-400 mt-0.5">Commercial multi-channel AI surveillance matrix & incident response platform</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setInjectorOpen(!injectorOpen)}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-[11px] font-bold transition-all ${
              injectorOpen ? 'bg-zinc-800 text-amber-400 border-zinc-700 shadow-inner' : 'bg-[#18181b] text-zinc-400 border-[#232326] hover:text-white'
            }`}
          >
            <Sliders size={12} /> {injectorOpen ? 'Hide Injector' : 'Threat Injector'}
          </button>
          
          <div className="flex items-center bg-[#18181b] border border-[#232326] rounded-lg p-1 gap-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${viewMode === 'grid' ? 'bg-[#27272a] text-white border border-[#2d2d30] shadow-xs' : 'text-zinc-400 hover:text-white'}`}
            >
              <Grid2x2 size={12} className="mr-1" /> Channels Grid
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${viewMode === 'map' ? 'bg-[#27272a] text-white border border-[#2d2d30] shadow-xs' : 'text-zinc-400 hover:text-white'}`}
            >
              <Map size={12} className="mr-1" /> Facility Map
            </button>
          </div>

          <button
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className={`px-3 py-2 border rounded-lg text-[11px] font-bold transition-all ${rightPanelOpen ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' : 'bg-[#18181b] text-zinc-400 border-[#232326] hover:text-white'}`}
          >
            {rightPanelOpen ? 'Hide Alert Hub' : 'Show Alert Hub'}
          </button>
          
          <button
            onClick={load}
            className="flex items-center gap-1 px-3 py-2 bg-[#18181b] border border-[#232326] rounded-lg text-[11px] font-bold text-zinc-400 hover:text-white hover:border-[#2d2d30] transition-all"
          >
            <RefreshCw size={12} className="mr-1" /> Refresh
          </button>
        </div>
      </motion.div>

      {/* Threat Simulator Injector Controls */}
      <AnimatePresence>
        {injectorOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-[#18181b] border border-amber-500/20 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex-1">
                <h4 className="text-[12px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                  💡 Presentation Threat Injector Controls
                </h4>
                <p className="text-[11px] text-zinc-400 mt-1">
                  Select any CCTV camera to inject a simulated threat. Watch the grid re-sort, highlight the active feed, sound the siren, and provide alert options.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {camerasState.filter(c => c.status === 'online').map((cam) => {
                  const hasThreat = !!injectedThreats[cam.id];
                  return (
                    <div key={cam.id} className="bg-[#202024] border border-[#2d2d30] rounded-lg p-2 flex items-center gap-2">
                      <span className="text-[10px] font-bold text-white font-mono">{cam.id}</span>
                      {hasThreat ? (
                        <button
                          onClick={() => clearThreat(cam.id)}
                          className="px-2 py-1 bg-green-500/10 text-green-400 border border-green-500/20 text-[9px] font-bold rounded-md hover:bg-green-500 hover:text-white transition-colors"
                        >
                          Clear Alert
                        </button>
                      ) : (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => injectThreat(cam.id, 'fire')}
                            className="px-2 py-1 bg-red-500/10 text-red-400 border border-red-500/20 text-[9px] font-bold rounded-md hover:bg-red-500 hover:text-white transition-colors"
                          >
                            Inject Fire
                          </button>
                          <button
                            onClick={() => injectThreat(cam.id, 'smoke')}
                            className="px-2 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[9px] font-bold rounded-md hover:bg-amber-500 hover:text-white transition-colors"
                          >
                            Inject Smoke
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <button
                  onClick={clearAllThreats}
                  className="px-3.5 py-1.5 bg-red-500 text-white text-[10px] font-bold rounded-lg hover:bg-red-600 transition-colors shadow-sm"
                >
                  Clear All Threats
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Statistics Strip */}
      <motion.div variants={stagger} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Total CCTV Channels" value={totalCamsCount} icon={Camera} color="bg-zinc-800 text-zinc-300" sub={`${onlineCamsCount} active`} />
        <StatCard label="System Health" value={activeAlertsCount > 0 ? "WARNING" : "NOMINAL"} icon={CheckCircle2} color={activeAlertsCount > 0 ? "bg-amber-500/10 text-amber-400" : "bg-green-500/10 text-green-400"} sub="AI model verified" ok={activeAlertsCount === 0} />
        <StatCard label="Active Alerts" value={activeAlertsCount} icon={ShieldAlert} color={activeAlertsCount > 0 ? "bg-red-500/10 text-red-400 border-red-500/10" : "bg-zinc-800 text-zinc-300"} sub={`${activeFiresCount} Fire, ${activeSmokesCount} Smoke`} />
        <StatCard label="Average Speed" value={`${avgInferenceLatency} ms`} icon={Activity} color="bg-blue-500/10 text-blue-400" sub="End-to-End Latency" />
        <StatCard label="AI Engine Status" value="YOLOv8 CPU" icon={Cpu} color="bg-purple-500/10 text-purple-400" sub="Model loaded successfully" />
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
                      className={`bg-[#18181b] border rounded-xl overflow-hidden shadow-md flex flex-col justify-between transition-all duration-300 ${
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
                          <span className="text-[12px] font-bold text-white">{camera.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                            isRed ? 'bg-red-500/10 text-red-400 border-red-500/20 animate-pulse' : 
                            isYellow ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 
                            'bg-zinc-800 text-zinc-400 border-zinc-700'
                          }`}>
                            {camera.status === 'online' ? (camera.threat ? `${camera.threat.toUpperCase()} ALERT` : 'SECURE') : 'OFFLINE'}
                          </span>
                        </div>
                      </div>

                      {/* Video/Simulation viewport area */}
                      <div className={`p-4 flex-1 flex ${isEnlarged ? 'flex-col lg:flex-row gap-6' : 'flex-col'} justify-center min-h-[240px]`}>
                        
                        {/* Stream Frame Block */}
                        <div className={`relative rounded-lg overflow-hidden bg-black aspect-video flex-1 border border-[#232326] group ${isRed ? 'border-red-500/20' : ''}`}>
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
                              <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-zinc-950 p-6">
                                <Video size={24} className="text-zinc-600 animate-pulse" />
                                <p className="text-[12px] text-zinc-400 font-semibold">Webcam Feed Paused</p>
                                <button
                                  onClick={startWebcam}
                                  className="px-3.5 py-1.5 bg-blue-500 text-white text-[11px] font-bold rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
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

                        {/* Enlarged Details Sidebar (Shows only if RED threat is active on this card) */}
                        {isEnlarged && (
                          <div className="w-full lg:w-72 shrink-0 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-[#232326] pt-4 lg:pt-0 lg:pl-6">
                            <div className="space-y-4">
                              <div>
                                <h5 className="text-[10px] font-bold text-red-400 uppercase tracking-widest flex items-center gap-1.5">
                                  <AlertCircle size={12} className="animate-pulse" /> Verified Alert Incident
                                </h5>
                                <p className="text-[18px] font-bold text-white mt-1 capitalize">{camera.threat} Warning</p>
                                <p className="text-[11px] text-zinc-400 mt-1">
                                  Triggered at {camera.location} ({camera.zone}) via AI monitoring.
                                </p>
                              </div>

                              <div className="bg-[#202024] border border-[#2d2d30] rounded-lg p-3 space-y-2.5">
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-zinc-400 font-medium">Confidence Match</span>
                                  <span className="text-white font-bold font-mono">{(camera.confidence * 100).toFixed(1)}%</span>
                                </div>
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-zinc-400 font-medium">Stage 2 Saturation</span>
                                  <span className="text-green-400 font-bold font-mono">OK</span>
                                </div>
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-zinc-400 font-medium">Stage 2 Brightness</span>
                                  <span className="text-green-400 font-bold font-mono">OK</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex gap-2 mt-4 lg:mt-0">
                              <button
                                onClick={() => handleAcknowledgeCamera(camera.id)}
                                className="flex-1 py-2 bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px] font-bold rounded-lg hover:bg-amber-500 hover:text-white transition-colors"
                              >
                                Acknowledge
                              </button>
                              <button
                                onClick={() => handleResolveCamera(camera.id)}
                                className="flex-1 py-2 bg-green-500 text-white text-[11px] font-bold rounded-lg hover:bg-green-600 transition-colors shadow-sm"
                              >
                                Resolve
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Footer bar */}
                      <div className="px-4 py-2 bg-[#202024]/40 border-t border-[#232326] flex justify-between items-center text-[10px] text-zinc-500">
                        <span>Connection Status: <strong className={camera.status === 'online' ? 'text-green-400' : 'text-zinc-400'}>{camera.status.toUpperCase()}</strong></span>
                        <span>Signal Health: <strong className="text-white font-mono">{camera.connectionHealth}%</strong></span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

            </motion.div>
          ) : (
            <motion.div variants={fadeUp} className="bg-[#18181b] border border-[#232326] rounded-xl overflow-hidden shadow-xs">
              <div className="px-4 py-3 border-b border-[#232326] bg-[#202024]/30">
                <p className="text-[12px] font-bold text-white">Facility Structural Sensor Overlays</p>
              </div>
              <FacilityMap
                cameras={camerasState.map((c, i) => ({ id: c.id, name: c.name, zone: c.zone || `Zone ${String.fromCharCode(65 + (i % 5))}`, x: 15 + ((i * 30) % 75), y: 25 + ((i * 20) % 55) }))}
                activeAlerts={[...activeAlertsList.map((a: any) => a.camera_id), ...(camThreat ? ['CAM-01'] : []), ...Object.keys(injectedThreats)]}
                selectedCameraId={selectedCamId}
                onCameraSelect={(id) => { setSelectedCamId(id); setViewMode('grid'); }}
              />
            </motion.div>
          )}
        </div>

        {/* Right Column: Alert Center & Analytics Sidebar */}
        {rightPanelOpen && (
          <div className="w-full xl:w-80 shrink-0 space-y-5 animate-fade-up">

            {/* Acknowledged / Resolved Alert Center */}
            <motion.div variants={fadeUp} className="bg-[#18181b] border border-[#232326] rounded-xl shadow-xs overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#232326] bg-[#202024]/30 flex items-center justify-between">
                <span className="text-[11px] font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck size={12} className="text-blue-400" /> Enterprise Alert Center
                </span>
                {activeAlertsCount > 0 && (
                  <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 text-[9px] font-bold rounded-full border border-red-500/20">
                    {activeAlertsCount} active
                  </span>
                )}
              </div>
              
              {/* Filter controls */}
              <div className="p-3 bg-[#202024]/20 border-b border-[#232326] space-y-2">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search alert logs..."
                    value={alertSearch}
                    onChange={(e) => setAlertSearch(e.target.value)}
                    className="w-full bg-[#18181b] border border-[#232326] rounded-lg px-2.5 py-1.5 pl-8 text-[11px] text-white placeholder-zinc-500 focus:outline-none focus:border-[#2d2d30] font-medium"
                  />
                  <Search size={11} className="absolute left-2.5 top-2.5 text-zinc-500" />
                </div>
                <div className="flex gap-1">
                  {['all', 'fire', 'smoke'].map((f) => (
                    <button
                      key={f}
                      onClick={() => setAlertFilter(f as any)}
                      className={`flex-1 py-1 rounded text-[9px] font-bold uppercase transition-all border ${
                        alertFilter === f 
                          ? 'bg-[#27272a] text-white border-[#2d2d30]' 
                          : 'bg-[#18181b] text-zinc-400 border-transparent hover:text-white'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="divide-y divide-[#232326] max-h-48 overflow-y-auto custom-scrollbar">
                {filteredAlerts.length === 0 ? (
                  <div className="py-8 text-center text-[11px] text-zinc-500 bg-[#18181b]">No alerts matching filters.</div>
                ) : (
                  filteredAlerts.map((alert: any) => (
                    <div
                      key={alert.id}
                      onClick={() => navigate('/alerts-reports')}
                      className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-[#202024] cursor-pointer transition-colors bg-[#18181b]"
                    >
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${alert.detection_type === 'fire' ? 'bg-red-500' : 'bg-amber-500'} ${alert.status === 'active' ? 'animate-pulse' : 'opacity-40'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`text-[10px] font-bold capitalize ${alert.detection_type === 'fire' ? 'text-red-400' : 'text-amber-400'}`}>
                            {alert.detection_type}
                          </span>
                          <span className="text-[9px] text-zinc-400 font-mono">{(alert.confidence * 100).toFixed(0)}% Match</span>
                        </div>
                        <p className="text-[10px] text-zinc-300 truncate">{alert.camera_id || 'System Input'}</p>
                        <p className="text-[8px] text-zinc-500">{new Date(alert.timestamp).toLocaleTimeString()}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>

            {/* Active Incidents */}
            <motion.div variants={fadeUp} className="bg-[#18181b] border border-[#232326] rounded-xl shadow-xs overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#232326] bg-[#202024]/30">
                <span className="text-[11px] font-bold text-white uppercase tracking-wider">Active Incident Tickets</span>
              </div>
              <div className="divide-y divide-[#232326] max-h-40 overflow-y-auto custom-scrollbar">
                {incidents.length === 0 ? (
                  <div className="py-8 text-center text-[11px] text-zinc-500 bg-[#18181b]">No incidents flagged.</div>
                ) : (
                  incidents.slice(0, 4).map((inc: any) => (
                    <div
                      key={inc.id}
                      onClick={() => navigate('/alerts-reports')}
                      className="flex items-center justify-between px-4 py-2.5 hover:bg-[#202024] cursor-pointer transition-colors bg-[#18181b]"
                    >
                      <div className="flex-1 min-w-0 mr-2">
                        <p className="text-[11px] font-bold text-white truncate">{inc.title}</p>
                        <p className="text-[9px] text-zinc-400 mt-0.5 truncate">{inc.description || 'No notes'}</p>
                      </div>
                      <span className={`shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                        inc.severity === 'critical' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                        inc.severity === 'high' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                        'bg-zinc-800 text-zinc-400 border-zinc-700'
                      }`}>
                        {inc.severity}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </motion.div>

            {/* Timeline */}
            <motion.div variants={fadeUp} className="bg-[#18181b] border border-[#232326] rounded-xl shadow-xs overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#232326] bg-[#202024]/30">
                <span className="text-[11px] font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <Activity size={12} className="text-blue-500" /> Threat Analytics Timeline
                </span>
              </div>
              <div className="p-3 bg-[#18181b] h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeline} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gFire" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gSmoke" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#232326" vertical={false} />
                    <XAxis dataKey="time" tick={{ fontSize: 8, fill: '#71717a' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 8, fill: '#71717a' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="fire"  stroke="#ef4444" strokeWidth={1.5} fill="url(#gFire)"  name="Fire" />
                    <Area type="monotone" dataKey="smoke" stroke="#f59e0b" strokeWidth={1.5} fill="url(#gSmoke)" name="Smoke" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

          </div>
        )}
      </div>
    </motion.div>
  );
};

export default Dashboard;
