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
  Flame, Wind, ShieldAlert, Camera, AlertCircle
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { motion } from 'framer-motion';
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
    <div className="bg-white border border-[#e5e5e2] rounded-lg shadow-md px-3 py-2 text-[12px]">
      <p className="text-[#6b6b6b] font-medium mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex justify-between gap-4 font-semibold" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span className="text-[#1a1a1a] font-mono">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

const StatCard = ({ label, value, icon: Icon, color, sub }: any) => (
  <motion.div variants={fadeUp} className="bg-white border border-[#e5e5e2] rounded-xl p-5 flex items-start gap-4">
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
      <Icon size={16} />
    </div>
    <div>
      <p className="text-[11px] font-medium text-[#6b6b6b] uppercase tracking-wider">{label}</p>
      <p className="text-[26px] font-bold text-[#1a1a1a] leading-none mt-1 tracking-tight">{value}</p>
      {sub && <p className="text-[11px] text-[#a0a0a0] mt-1 font-medium">{sub}</p>}
    </div>
  </motion.div>
);

const Dashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [stats, setStats] = useState<any>({ total_alerts: 0, active_alerts: 0, fire_alerts: 0, smoke_alerts: 0, connected_cameras: 0, recent_alerts: [] });
  const [timeline, setTimeline] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [cameras, setCameras] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');
  const [selectedCam, setSelectedCam] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  // Webcam
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camActive, setCamActive] = useState(false);
  const [camThreat, setCamThreat] = useState<'fire' | 'smoke' | null>(null);
  const [camFps, setCamFps] = useState(0);
  const [muted, setMuted] = useState(true);
  const webcamRef = useRef<HTMLDivElement>(null);
  const rtspRef = useRef<HTMLDivElement>(null);
  const [fullscreenEl, setFullscreenEl] = useState<string | null>(null);

  // RTSP
  const [rtspConnected, setRtspConnected] = useState(false);
  const [rtspLoading, setRtspLoading] = useState(false);
  const [rtspLatency, setRtspLatency] = useState<number | null>(null);

  // Store
  const storeAlerts = useDashboardStore(s => s.recentAlerts);
  const setStoreStats = useDashboardStore(s => s.setStats);
  const addNotification = useNotificationsStore(s => s.addNotification);
  const pushPopup = useNotificationsStore(s => s.pushPopup);

  // Auth and AI continuous monitoring state
  const currentUser = useAuthStore(s => s.currentUser);
  const isOperatorOrAdmin = useMemo(() => {
    const r = (currentUser?.role || '').toLowerCase();
    return r === 'admin' || r === 'administrator' || r === 'operator';
  }, [currentUser]);

  const [simulationMode, setSimulationMode] = useState(!isOperatorOrAdmin);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [frameSkip, setFrameSkip] = useState(3);

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
      gain.gain.value = 0.06;
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

  // Data load
  const load = async () => {
    try {
      const [s, a, inc, cams, settings] = await Promise.all([
        getDashboardStats(), getDashboardAnalytics(), getIncidents({}), listCameras(), getSettings()
      ]);
      setStats(s);
      setTimeline(a.timeline || []);
      setIncidents(inc.items || []);
      setCameras(cams);
      setSelectedCam(cams[0] || null);
      setStoreStats({
        totalAlerts: s.total_alerts, activeAlerts: s.active_alerts,
        fireAlerts: s.fire_alerts, smokeAlerts: s.smoke_alerts,
        connectedCameras: s.connected_cameras, recentAlerts: s.recent_alerts || [],
      });
      const skip = settings.find((setObj: any) => setObj.id === 'frame_skip')?.value;
      if (skip) setFrameSkip(parseInt(skip));
    } catch (e: any) {
      toast(e.message || 'Failed to load dashboard', 'error');
    }
  };

  useEffect(() => {
    void load();
    return () => { stopWebcam(); };
  }, []);

  // Sync websocket alerts
  useEffect(() => {
    if (!storeAlerts.length) return;
    setStats((p: any) => ({ ...p, recent_alerts: storeAlerts }));
  }, [storeAlerts]);

  // Webcam
  const startWebcam = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
      setCamActive(true);
      toast('Webcam monitoring started', 'success');
    } catch (e: any) {
      toast('Camera access denied: ' + e.message, 'error');
    }
  };

  const stopWebcam = () => {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setCamActive(false);
    setCamThreat(null);
    stopSiren();
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

  // Webcam canvas loop
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

        // Simulation Mode
        if (simModeRef.current) {
          const cycle = tick % 600;
          let threat: 'fire' | 'smoke' | null = null;
          if (cycle > 150 && cycle < 280) threat = 'fire';
          else if (cycle > 360 && cycle < 490) threat = 'smoke';

          if (threat !== camThreatRef.current) {
            setCamThreat(threat);
            if (threat) {
              startSiren();
              const mock = { 
                id: `wc-${Date.now()}`, 
                alertType: threat, 
                cameraId: 'webcam-01', 
                cameraName: 'Webcam', 
                zone: 'SOC', 
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
              const res = await uploadImage(file, 'webcam-01');
              if (res && res.detections) {
                setDetections(res.detections);
                const hasFire = res.detections.some(d => d.detection_type === 'fire');
                const hasSmoke = res.detections.some(d => d.detection_type === 'smoke');

                if (hasFire || hasSmoke) {
                  const threat = hasFire ? 'fire' : 'smoke';
                  if (threat !== camThreatRef.current) {
                    setCamThreat(threat);
                    startSiren();

                    const newAlert = {
                      id: res.alert_ids[0] || `wc-${Date.now()}`,
                      alertType: threat,
                      cameraId: 'webcam-01',
                      cameraName: 'Webcam',
                      zone: 'SOC',
                      confidence: Math.max(...res.detections.map(d => d.confidence)),
                      timestamp: new Date().toISOString(),
                      severity: threat === 'fire' ? 'critical' : 'warning',
                      isRead: false
                    } as any;
                    addNotification(newAlert);
                    pushPopup(newAlert);
                  }
                } else {
                  if (camThreatRef.current) {
                    setCamThreat(null);
                    stopSiren();
                  }
                }
              }
            } catch (err) {
              console.error("Webcam AI inference failed:", err);
            } finally {
              isProcessing = false;
            }
          }, 'image/jpeg', 0.85);
        }

        // Draw active bounding box overlays (Red for Fire, Orange for Smoke)
        if (detectionsRef.current && detectionsRef.current.length > 0) {
          detectionsRef.current.forEach((det) => {
            const col = det.detection_type === 'fire' ? '#e5484d' : '#e79020';
            ctx.strokeStyle = col; 
            ctx.lineWidth = 2.5;
            
            const { x1, y1, x2, y2 } = det.bbox;
            const width = x2 - x1;
            const height = y2 - y1;
            ctx.strokeRect(x1, y1, width, height);
            
            ctx.fillStyle = col;
            ctx.fillRect(x1, y1 - 25 > 0 ? y1 - 25 : y1, 100, 22);
            
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText(`${det.detection_type.toUpperCase()} ${Math.round(det.confidence * 100)}%`, x1 + 8, (y1 - 25 > 0 ? y1 - 25 : y1) + 15);
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

  // RTSP connect
  const connectRtsp = async () => {
    if (!selectedCam) return;
    setRtspLoading(true);
    const t0 = performance.now();
    try {
      await testCctvConnection(selectedCam.stream_url || '');
      setRtspConnected(true);
      setRtspLatency(Math.round(performance.now() - t0));
      toast(`Connected to ${selectedCam.name}`, 'success');
    } catch (e: any) {
      toast(`Connection failed: ${e.message}`, 'error');
    } finally { setRtspLoading(false); }
  };

  const disconnectRtsp = () => {
    setRtspConnected(false);
    setRtspLatency(null);
    toast('Stream disconnected', 'info');
  };

  const activeAlerts = useMemo(() => (stats.recent_alerts || []).filter((a: any) => a.status === 'active'), [stats]);

  return (
    <motion.div className="space-y-6" variants={stagger} initial="hidden" animate="show">

      {/* Page header */}
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-[var(--text)] tracking-tight">Security Operations Center</h1>
          <p className="text-[12px] text-[var(--text-2)] mt-0.5">Real-time visual surveillance matrix & visual threat validation layers</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-1 gap-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all ${viewMode === 'grid' ? 'bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] shadow-xs' : 'text-[var(--text-2)] hover:text-[var(--text)]'}`}
            >
              <Grid2x2 size={12} className="mr-1" /> Grid
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all ${viewMode === 'map' ? 'bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] shadow-xs' : 'text-[var(--text-2)] hover:text-[var(--text)]'}`}
            >
              <Map size={12} className="mr-1" /> Map
            </button>
          </div>
          <button
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className={`px-3 py-2 border rounded-lg text-[11px] font-bold transition-all ${rightPanelOpen ? 'bg-[var(--primary-light)] text-[var(--primary)] border-[var(--primary-ring)]' : 'bg-[var(--surface)] text-[var(--text-2)] border-[var(--border)] hover:text-[var(--text)]'}`}
          >
            {rightPanelOpen ? 'Hide Panel' : 'Show Panel'}
          </button>
          <button
            onClick={load}
            className="flex items-center gap-1 px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[11px] font-bold text-[var(--text-2)] hover:text-[var(--text)] hover:border-[var(--border-strong)] transition-all"
          >
            <RefreshCw size={12} className="mr-1" /> Refresh
          </button>
        </div>
      </motion.div>

      {/* Horizontal statistics strip */}
      <motion.div variants={stagger} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Alerts" value={stats.total_alerts} icon={ShieldAlert} color="bg-[var(--fire-bg)] text-[var(--fire-text)]" sub="All time logs" />
        <StatCard label="Fire Detections" value={stats.fire_alerts} icon={Flame} color="bg-[var(--fire-bg)] text-[var(--fire-text)]" sub="Active warnings" />
        <StatCard label="Smoke Detections" value={stats.smoke_alerts} icon={Wind} color="bg-[var(--smoke-bg)] text-[var(--smoke-text)]" sub="Active warnings" />
        <StatCard label="Active Cameras" value={cameras.length} icon={Camera} color="bg-[var(--primary-light)] text-[var(--primary)]" sub={`${cameras.filter(c => c.status === 'online').length} channels live`} />
      </motion.div>

      {/* Main 2-column layout supporting sidebar collapse */}
      <div className="flex flex-col xl:flex-row gap-6 items-stretch">

        {/* Left column: CCTV Grid (occupies largest screen space) */}
        <div className="flex-1 min-w-0 transition-all duration-200">
          {viewMode === 'grid' ? (
            <motion.div variants={fadeUp} className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Webcam feed */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)]">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${camActive ? (camThreat ? 'bg-[var(--fire)] animate-pulse' : 'bg-[var(--safe)]') : 'bg-[var(--text-3)]'}`} style={{ animation: camActive ? 'pulse-dot 1.5s infinite' : 'none' }} />
                    <span className="text-[12px] font-bold text-[var(--text)]">CCTV 01 (Local Terminal)</span>
                  </div>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${camActive ? (camThreat ? 'bg-[var(--fire-bg)] text-[var(--fire-text)] border-[var(--fire-border)]' : 'bg-[var(--safe-bg)] text-[var(--safe-text)] border-[var(--safe-border)]') : 'bg-[var(--bg)] text-[var(--text-3)] border-[var(--border)]'}`}>
                    {camActive ? (camThreat ? `${camThreat.toUpperCase()} ALERT` : 'MONITORING') : 'OFFLINE'}
                  </span>
                </div>

                <div className="p-4 flex-1 flex flex-col justify-center min-h-[220px]">
                  <video ref={videoRef} className="hidden" width={640} height={480} autoPlay playsInline muted />
                  
                  {camActive ? (
                    <div ref={webcamRef} id="webcam-fullscreen" className="relative rounded-lg overflow-hidden bg-black aspect-video group">
                      <canvas ref={canvasRef} width={640} height={480} className="w-full h-full object-contain" />
                      {camThreat && (
                        <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-[var(--fire)]/85 to-transparent px-3 py-2">
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
                    <div className="aspect-video rounded-lg border-2 border-dashed border-[var(--border)] flex flex-col items-center justify-center gap-3 bg-[var(--bg)] p-6">
                      <Video size={24} className="text-[var(--text-3)]" />
                      <p className="text-[12px] text-[var(--text-2)] font-semibold">CCTV Feed Offline</p>
                      <button
                        onClick={startWebcam}
                        className="px-3.5 py-1.5 bg-[var(--primary)] text-white text-[11px] font-bold rounded-lg hover:bg-[var(--primary-hover)] transition-colors shadow-xs"
                      >
                        Start CCTV Feed
                      </button>
                    </div>
                  )}
                </div>
                {camActive && (
                  <div className="px-4 pb-4 flex justify-between items-center">
                    <div className="flex gap-2">
                      <button onClick={stopWebcam} className="px-3 py-1.5 bg-[var(--fire-bg)] text-[var(--fire-text)] border border-[var(--fire-border)] text-[11px] font-bold rounded-lg hover:bg-[var(--fire)] hover:text-white transition-colors">
                        Deactivate
                      </button>
                      {isOperatorOrAdmin ? (
                        <button 
                          onClick={() => {
                            setSimulationMode(!simulationMode);
                            setDetections([]);
                            setCamThreat(null);
                            stopSiren();
                          }} 
                          className={`px-3 py-1.5 border text-[11px] font-bold rounded-lg transition-all ${
                            simulationMode 
                              ? 'bg-[var(--smoke-bg)] text-[var(--smoke-text)] border-[var(--smoke-border)] hover:bg-[var(--smoke-text)] hover:text-white' 
                              : 'bg-[var(--primary-light)] text-[var(--primary)] border-[var(--primary-ring)] hover:bg-[var(--primary)] hover:text-white'
                          }`}
                        >
                          {simulationMode ? 'Simulation: Active' : 'AI Inference: Live'}
                        </button>
                      ) : (
                        <span className="px-3 py-1.5 bg-[var(--surface-hover)] border border-[var(--border)] text-[10px] text-[var(--text-3)] font-bold rounded-lg select-none">
                          Simulation Mode Locked (Viewer)
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-[var(--text-3)] font-mono">{camFps} FPS</span>
                  </div>
                )}
              </div>

              {/* RTSP feed */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)]">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${rtspConnected ? 'bg-[var(--safe)] animate-pulse' : 'bg-[var(--text-3)]'}`} style={{ animation: rtspConnected ? 'pulse-dot 2s infinite' : 'none' }} />
                    <span className="text-[12px] font-bold text-[var(--text)]">CCTV 02 (Remote Feed)</span>
                  </div>
                  <select
                    value={selectedCam?.id || ''}
                    onChange={(e) => {
                      const cam = cameras.find(c => c.id === e.target.value);
                      if (cam) { setSelectedCam(cam); disconnectRtsp(); }
                    }}
                    className="text-[11px] border border-[var(--border)] rounded-lg px-2 py-0.5 bg-[var(--bg)] text-[var(--text)] outline-none font-bold max-w-[140px] focus:border-[var(--primary)]"
                  >
                    {cameras.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    {cameras.length === 0 && <option value="">No cameras</option>}
                  </select>
                </div>

                <div className="p-4 flex-1 flex flex-col justify-center min-h-[220px]">
                  {rtspConnected ? (
                    <div ref={rtspRef} id="rtsp-fullscreen" className="relative rounded-lg overflow-hidden bg-black aspect-video group">
                      <div className="w-full h-full bg-zinc-950 flex items-center justify-center">
                        <div className="text-center">
                          <div className="w-2 h-2 rounded-full bg-[var(--safe)] mx-auto mb-2 animate-ping" />
                          <p className="text-zinc-600 text-[10px] font-mono uppercase tracking-widest">[ CCTV ENCRYPTED LIVE ]</p>
                        </div>
                      </div>
                      <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/75 text-white text-[9px] font-mono px-2 py-1 rounded-md">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--safe)] animate-pulse" />
                        LIVE · {rtspLatency}ms
                      </div>
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => toggleFullscreen(rtspRef.current)} className="p-1.5 bg-black/60 rounded-lg text-white">
                          {fullscreenEl === 'rtsp-fullscreen' ? <Minimize size={12} /> : <Maximize size={12} />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-video rounded-lg border-2 border-dashed border-[var(--border)] flex flex-col items-center justify-center gap-3 bg-[var(--bg)] p-6">
                      <WifiOff size={24} className="text-[var(--text-3)]" />
                      <p className="text-[12px] text-[var(--text-2)] font-semibold">Feed Disconnected</p>
                      <button
                        onClick={connectRtsp}
                        disabled={rtspLoading || !selectedCam}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[var(--primary)] text-white text-[11px] font-bold rounded-lg hover:bg-[var(--primary-hover)] transition-colors shadow-xs disabled:opacity-50"
                      >
                        {rtspLoading ? <RefreshCw size={11} className="animate-spin" /> : <Wifi size={11} />}
                        {rtspLoading ? 'Connecting...' : 'Stream Feed'}
                      </button>
                    </div>
                  )}
                </div>
                {rtspConnected && (
                  <div className="px-4 pb-4 flex justify-between items-center">
                    <button onClick={disconnectRtsp} className="px-3 py-1.5 bg-[var(--fire-bg)] text-[var(--fire-text)] border border-[var(--fire-border)] text-[11px] font-bold rounded-lg hover:bg-[var(--fire)] hover:text-white transition-colors">
                      Disconnect
                    </button>
                    <span className="text-[10px] text-[var(--text-3)] font-mono">{rtspLatency}ms latency</span>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div variants={fadeUp} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-xs">
              <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
                <p className="text-[12px] font-bold text-[var(--text)]">SOC Facility Map overlay</p>
              </div>
              <FacilityMap
                cameras={cameras.map((c, i) => ({ id: c.id, name: c.name, zone: c.zone || `Zone ${String.fromCharCode(65 + (i % 5))}`, x: 15 + ((i * 30) % 75), y: 25 + ((i * 20) % 55) }))}
                activeAlerts={[...activeAlerts.map((a: any) => a.camera_id), ...(camThreat ? ['webcam-01'] : [])]}
                selectedCameraId={selectedCam?.id}
                onCameraSelect={(id) => { const c = cameras.find(x => x.id === id); if (c) { setSelectedCam(c); setViewMode('grid'); }}}
              />
            </motion.div>
          )}
        </div>

        {/* Right column: Collapsible control sidebar panel */}
        {rightPanelOpen && (
          <div className="w-full xl:w-80 shrink-0 space-y-5 animate-fade-up">

            {/* AI and System Core Health */}
            <motion.div variants={fadeUp} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xs overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between">
                <span className="text-[11px] font-bold text-[var(--text)] uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu size={12} className="text-[var(--primary)]" /> System Core Health
                </span>
              </div>
              <div className="p-4 space-y-3.5">
                <div className="flex items-center gap-2.5 p-2 rounded-lg bg-[var(--safe-bg)] border border-[var(--safe-border)]">
                  <CheckCircle2 size={15} className="text-[var(--safe-text)] shrink-0" />
                  <div>
                    <p className="text-[11px] font-bold text-[var(--safe-text)]">YOLO Core Active</p>
                    <p className="text-[9px] text-[var(--safe-text)] opacity-80">Device: {cameras.length > 0 ? "CUDA Accelerated" : "CPU Engine"}</p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {[
                    { label: 'CPU Usage', value: 14 },
                    { label: 'System Memory', value: 42 },
                  ].map((m) => (
                    <div key={m.label}>
                      <div className="flex justify-between text-[10px] font-bold mb-1">
                        <span className="text-[var(--text-2)]">{m.label}</span>
                        <span className="text-[var(--text)] font-mono">{m.value}%</span>
                      </div>
                      <div className="h-1 bg-[var(--bg-alt)] rounded-full overflow-hidden border border-[var(--border)]">
                        <div
                          className="h-full bg-[var(--primary)] rounded-full transition-all duration-500"
                          style={{ width: `${m.value}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5 pt-2 border-t border-[var(--border)] text-[10px]">
                  {[
                    { label: 'API Services', value: 'Operational', ok: true },
                    { label: 'Database Logs', value: 'SQLite Connected', ok: true },
                    { label: 'Channel Registries', value: `${cameras.length} registered`, ok: cameras.length > 0 },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center justify-between">
                      <span className="text-[var(--text-2)] font-semibold">{r.label}</span>
                      <span className={`font-bold ${r.ok ? 'text-[var(--safe-text)]' : 'text-[var(--fire-text)]'}`}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>

            {/* Incident Tickets */}
            <motion.div variants={fadeUp} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xs overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)]">
                <span className="text-[11px] font-bold text-[var(--text)] uppercase tracking-wider">Active Incident Tickets</span>
              </div>
              <div className="divide-y divide-[var(--border)] max-h-40 overflow-y-auto custom-scrollbar">
                {incidents.length === 0 ? (
                  <div className="py-8 text-center text-[11px] text-[var(--text-3)] bg-[var(--surface)]">No incident logs registered.</div>
                ) : (
                  incidents.slice(0, 4).map((inc: any) => (
                    <div
                      key={inc.id}
                      onClick={() => navigate('/alerts-reports')}
                      className="flex items-center justify-between px-4 py-2.5 hover:bg-[var(--surface-hover)] cursor-pointer transition-colors bg-[var(--surface)]"
                    >
                      <div className="flex-1 min-w-0 mr-2">
                        <p className="text-[11px] font-bold text-[var(--text)] truncate">{inc.title}</p>
                        <p className="text-[9px] text-[var(--text-3)] mt-0.5 truncate">{inc.description || 'No notes'}</p>
                      </div>
                      <span className={`shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                        inc.severity === 'critical' ? 'bg-[var(--fire-bg)] text-[var(--fire-text)] border-[var(--fire-border)]' :
                        inc.severity === 'high' ? 'bg-[var(--smoke-bg)] text-[var(--smoke-text)] border-[var(--smoke-border)]' :
                        'bg-[var(--surface-2)] text-[var(--text-2)] border-[var(--border)]'
                      }`}>
                        {inc.severity}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </motion.div>

            {/* Active alerts */}
            <motion.div variants={fadeUp} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xs overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)]">
                <span className="text-[11px] font-bold text-[var(--text)] uppercase tracking-wider flex items-center gap-1">
                  <AlertCircle size={12} className="text-[var(--fire)] animate-pulse" /> Threat Alerts log
                </span>
                {activeAlerts.length > 0 && (
                  <span className="px-1.5 py-0.5 bg-[var(--fire-bg)] text-[var(--fire-text)] text-[9px] font-bold rounded-full border border-[var(--fire-border)]">
                    {activeAlerts.length} Active
                  </span>
                )}
              </div>
              <div className="divide-y divide-[var(--border)] max-h-48 overflow-y-auto custom-scrollbar">
                {(stats.recent_alerts || []).length === 0 ? (
                  <div className="py-8 text-center text-[11px] text-[var(--text-3)] bg-[var(--surface)]">No warnings flagged.</div>
                ) : (
                  (stats.recent_alerts || []).slice(0, 6).map((alert: any) => (
                    <div
                      key={alert.id}
                      onClick={() => navigate('/alerts-reports')}
                      className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-[var(--surface-hover)] cursor-pointer transition-colors bg-[var(--surface)]"
                    >
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${alert.detection_type === 'fire' ? 'bg-[var(--fire)]' : 'bg-[var(--smoke)]'} ${alert.status === 'active' ? 'animate-pulse' : 'opacity-40'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`text-[10px] font-bold capitalize ${alert.detection_type === 'fire' ? 'text-[var(--fire-text)]' : 'text-[var(--smoke-text)]'}`}>
                            {alert.detection_type}
                          </span>
                          <span className="text-[9px] text-[var(--text-3)] font-mono">{(alert.confidence * 100).toFixed(0)}% Match</span>
                        </div>
                        <p className="text-[10px] text-[var(--text-2)] truncate">{alert.camera_id || 'Static Upload'}</p>
                        <p className="text-[8px] text-[var(--text-3)]">{new Date(alert.timestamp).toLocaleTimeString()}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>

            {/* Timeline chart */}
            <motion.div variants={fadeUp} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xs overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)]">
                <span className="text-[11px] font-bold text-[var(--text)] uppercase tracking-wider flex items-center gap-1.5">
                  <Activity size={12} className="text-[var(--primary)]" /> Visual Timeline Logs
                </span>
              </div>
              <div className="p-3 bg-[var(--surface)] h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeline} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gFire" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="var(--fire)" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="var(--fire)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gSmoke" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="var(--smoke)" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="var(--smoke)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="time" tick={{ fontSize: 8, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 8, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="fire"  stroke="var(--fire)" strokeWidth={1} fill="url(#gFire)"  name="Fire" />
                    <Area type="monotone" dataKey="smoke" stroke="var(--smoke)" strokeWidth={1} fill="url(#gSmoke)" name="Smoke" />
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
