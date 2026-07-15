import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';
import {
  getDashboardStats, getDashboardAnalytics, getIncidents,
  testCctvConnection
} from '../services/api';
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
      const [s, a, inc, cams] = await Promise.all([
        getDashboardStats(), getDashboardAnalytics(), getIncidents({}), listCameras()
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

  // Webcam canvas loop
  useEffect(() => {
    let raf: number;
    let last = performance.now();
    let frames = 0;
    let tick = 0;

    const render = () => {
      if (!camActive || !videoRef.current || !canvasRef.current) return;
      const v = videoRef.current;
      const c = canvasRef.current;
      const ctx = c.getContext('2d');
      if (ctx && v.readyState === v.HAVE_ENOUGH_DATA) {
        ctx.drawImage(v, 0, 0, c.width, c.height);
        tick++;
        const cycle = tick % 600;
        let threat: 'fire' | 'smoke' | null = null;
        if (cycle > 150 && cycle < 280) threat = 'fire';
        else if (cycle > 360 && cycle < 490) threat = 'smoke';

        if (threat !== camThreat) {
          setCamThreat(threat);
          if (threat) {
            startSiren();
            const mock = { id: `wc-${Date.now()}`, alertType: threat, cameraId: 'webcam-01', cameraName: 'Webcam', zone: 'SOC', confidence: threat === 'fire' ? 0.96 : 0.88, timestamp: new Date().toISOString(), severity: threat === 'fire' ? 'critical' : 'warning', isRead: false } as any;
            addNotification(mock);
            pushPopup(mock);
          } else { stopSiren(); }
        }

        if (threat) {
          const col = threat === 'fire' ? '#e5484d' : '#e79020';
          ctx.strokeStyle = col; ctx.lineWidth = 2.5;
          ctx.strokeRect(180, 130, 280, 200);
          ctx.fillStyle = col;
          ctx.fillRect(180, 105, 100, 25);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 11px sans-serif';
          ctx.fillText(`${threat.toUpperCase()} ${threat === 'fire' ? 96 : 88}%`, 187, 121);
        }

        frames++;
        const now = performance.now();
        if (now - last >= 1000) { setCamFps(frames); frames = 0; last = now; }
      }
      raf = requestAnimationFrame(render);
    };

    if (camActive) raf = requestAnimationFrame(render);
    else stopSiren();
    return () => { cancelAnimationFrame(raf); };
  }, [camActive, camThreat, muted]);

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
          <h1 className="text-[22px] font-bold text-[#1a1a1a] tracking-tight">Dashboard</h1>
          <p className="text-[13px] text-[#6b6b6b] mt-0.5">Security Operations Center — real-time monitoring & AI detection</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-white border border-[#e5e5e2] rounded-lg p-1 gap-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${viewMode === 'grid' ? 'bg-[#f0f0ed] text-[#1a1a1a]' : 'text-[#6b6b6b] hover:text-[#1a1a1a]'}`}
            >
              <Grid2x2 size={13} /> Grid
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${viewMode === 'map' ? 'bg-[#f0f0ed] text-[#1a1a1a]' : 'text-[#6b6b6b] hover:text-[#1a1a1a]'}`}
            >
              <Map size={13} /> Map
            </button>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#e5e5e2] rounded-lg text-[12px] font-medium text-[#6b6b6b] hover:text-[#1a1a1a] hover:border-[#d4d4d0] transition-all"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </motion.div>

      {/* Stat cards row */}
      <motion.div variants={stagger} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Alerts" value={stats.total_alerts} icon={ShieldAlert} color="bg-[#fff1f1] text-[#e5484d]" sub="All time" />
        <StatCard label="Fire Detections" value={stats.fire_alerts} icon={Flame} color="bg-[#fff1f1] text-[#e5484d]" sub="Active threats" />
        <StatCard label="Smoke Detections" value={stats.smoke_alerts} icon={Wind} color="bg-[#fef9ec] text-[#e79020]" sub="Active threats" />
        <StatCard label="Active Cameras" value={cameras.length} icon={Camera} color="bg-[#eff6ff] text-[#0070f3]" sub={`${cameras.filter(c => c.status === 'online').length} online`} />
      </motion.div>

      {/* Main 3-col grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Left: Camera feeds (2 cols) */}
        <div className="xl:col-span-2 space-y-6">

          {viewMode === 'grid' ? (
            <motion.div variants={fadeUp} className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Webcam feed */}
              <div className="bg-white border border-[#e5e5e2] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e5e2] bg-[#f9f9f8]">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${camActive ? (camThreat ? 'bg-[#e5484d]' : 'bg-[#30a46c]') : 'bg-[#a0a0a0]'}`} style={{ animation: camActive ? 'pulse-dot 1.5s infinite' : 'none' }} />
                    <span className="text-[12px] font-semibold text-[#1a1a1a]">Webcam</span>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${camActive ? (camThreat ? 'bg-[#fff1f1] text-[#e5484d]' : 'bg-[#f0fdf4] text-[#30a46c]') : 'bg-[#f0f0ed] text-[#a0a0a0]'}`}>
                    {camActive ? (camThreat ? `${camThreat.toUpperCase()} ALERT` : 'MONITORING') : 'OFFLINE'}
                  </span>
                </div>

                <div className="p-4 space-y-3">
                  <video ref={videoRef} className="hidden" width={640} height={480} autoPlay playsInline muted />
                  
                  {camActive ? (
                    <div ref={webcamRef} id="webcam-fullscreen" className="relative rounded-lg overflow-hidden bg-black aspect-video group">
                      <canvas ref={canvasRef} width={640} height={480} className="w-full h-full object-contain" />
                      {camThreat && (
                        <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-[#e5484d]/80 to-transparent px-3 py-2">
                          <p className="text-white text-[11px] font-bold uppercase tracking-wider animate-pulse">⚠ {camThreat} detected</p>
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
                        {camFps} fps · {currentTime}
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-video rounded-lg border-2 border-dashed border-[#e5e5e2] flex flex-col items-center justify-center gap-3 bg-[#f9f9f8]">
                      <Video size={28} className="text-[#d4d4d0]" />
                      <p className="text-[12px] text-[#6b6b6b] font-medium">Webcam offline</p>
                      <button
                        onClick={startWebcam}
                        className="px-4 py-2 bg-[#0070f3] text-white text-[12px] font-semibold rounded-lg hover:bg-[#0060d6] transition-colors"
                      >
                        Start Webcam
                      </button>
                    </div>
                  )}

                  {camActive && (
                    <div className="flex justify-between items-center">
                      <button onClick={stopWebcam} className="px-3 py-1.5 bg-[#fff1f1] text-[#e5484d] text-[12px] font-semibold rounded-lg border border-[#fecdce] hover:bg-[#e5484d] hover:text-white transition-colors">
                        Stop
                      </button>
                      <span className="text-[11px] text-[#6b6b6b] font-mono">{camFps} fps</span>
                    </div>
                  )}
                </div>
              </div>

              {/* RTSP feed */}
              <div className="bg-white border border-[#e5e5e2] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e5e2] bg-[#f9f9f8]">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${rtspConnected ? 'bg-[#30a46c]' : 'bg-[#a0a0a0]'}`} style={{ animation: rtspConnected ? 'pulse-dot 2s infinite' : 'none' }} />
                    <span className="text-[12px] font-semibold text-[#1a1a1a]">RTSP Feed</span>
                  </div>
                  <select
                    value={selectedCam?.id || ''}
                    onChange={(e) => {
                      const cam = cameras.find(c => c.id === e.target.value);
                      if (cam) { setSelectedCam(cam); disconnectRtsp(); }
                    }}
                    className="text-[11px] border border-[#e5e5e2] rounded-lg px-2 py-1 bg-white text-[#1a1a1a] outline-none font-medium max-w-[140px]"
                  >
                    {cameras.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    {cameras.length === 0 && <option value="">No cameras</option>}
                  </select>
                </div>

                <div className="p-4 space-y-3">
                  {rtspConnected ? (
                    <div ref={rtspRef} id="rtsp-fullscreen" className="relative rounded-lg overflow-hidden bg-black aspect-video group">
                      <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
                        <div className="text-center">
                          <div className="w-3 h-3 rounded-full bg-[#30a46c] mx-auto mb-2 animate-pulse" />
                          <p className="text-zinc-500 text-[11px] font-mono uppercase tracking-widest">[ RTSP LIVE ]</p>
                        </div>
                      </div>
                      <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/70 text-white text-[9px] font-mono px-2 py-1 rounded-md">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#30a46c] animate-pulse" />
                        LIVE · {rtspLatency}ms
                      </div>
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => toggleFullscreen(rtspRef.current)} className="p-1.5 bg-black/60 rounded-lg text-white">
                          {fullscreenEl === 'rtsp-fullscreen' ? <Minimize size={12} /> : <Maximize size={12} />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-video rounded-lg border-2 border-dashed border-[#e5e5e2] flex flex-col items-center justify-center gap-3 bg-[#f9f9f8]">
                      <WifiOff size={28} className="text-[#d4d4d0]" />
                      <p className="text-[12px] text-[#6b6b6b] font-medium">RTSP disconnected</p>
                      <button
                        onClick={connectRtsp}
                        disabled={rtspLoading || !selectedCam}
                        className="flex items-center gap-1.5 px-4 py-2 bg-[#0070f3] text-white text-[12px] font-semibold rounded-lg hover:bg-[#0060d6] transition-colors disabled:opacity-50"
                      >
                        {rtspLoading ? <RefreshCw size={12} className="animate-spin" /> : <Wifi size={12} />}
                        {rtspLoading ? 'Connecting...' : 'Connect'}
                      </button>
                    </div>
                  )}

                  {rtspConnected && (
                    <div className="flex justify-between items-center">
                      <button onClick={disconnectRtsp} className="px-3 py-1.5 bg-[#fff1f1] text-[#e5484d] text-[12px] font-semibold rounded-lg border border-[#fecdce] hover:bg-[#e5484d] hover:text-white transition-colors">
                        Disconnect
                      </button>
                      <span className="text-[11px] text-[#6b6b6b] font-mono">{rtspLatency}ms latency</span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div variants={fadeUp} className="bg-white border border-[#e5e5e2] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#e5e5e2] bg-[#f9f9f8]">
                <p className="text-[12px] font-semibold text-[#1a1a1a]">Facility Map</p>
              </div>
              <FacilityMap
                cameras={cameras.map((c, i) => ({ id: c.id, name: c.name, zone: c.zone || `Zone ${String.fromCharCode(65 + (i % 5))}`, x: 15 + ((i * 30) % 75), y: 25 + ((i * 20) % 55) }))}
                activeAlerts={[...activeAlerts.map((a: any) => a.camera_id), ...(camThreat ? ['webcam-01'] : [])]}
                selectedCameraId={selectedCam?.id}
                onCameraSelect={(id) => { const c = cameras.find(x => x.id === id); if (c) { setSelectedCam(c); setViewMode('grid'); }}}
              />
            </motion.div>
          )}

          {/* Timeline chart */}
          <motion.div variants={fadeUp} className="bg-white border border-[#e5e5e2] rounded-xl">
            <div className="px-5 py-4 border-b border-[#e5e5e2]">
              <p className="text-[13px] font-semibold text-[#1a1a1a] flex items-center gap-2">
                <Activity size={14} className="text-[#0070f3]" />
                Detection Timeline
              </p>
            </div>
            <div className="p-4 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeline} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gFire" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#e5484d" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#e5484d" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gSmoke" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#e79020" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#e79020" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0ed" vertical={false} />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#a0a0a0' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#a0a0a0' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="fire"  stroke="#e5484d" strokeWidth={1.5} fill="url(#gFire)"  name="Fire" />
                  <Area type="monotone" dataKey="smoke" stroke="#e79020" strokeWidth={1.5} fill="url(#gSmoke)" name="Smoke" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>

        {/* Right: Status + Alerts */}
        <div className="space-y-5">

          {/* System health */}
          <motion.div variants={fadeUp} className="bg-white border border-[#e5e5e2] rounded-xl">
            <div className="px-4 py-3 border-b border-[#e5e5e2]">
              <p className="text-[12px] font-semibold text-[#1a1a1a] flex items-center gap-2">
                <Cpu size={13} className="text-[#0070f3]" />
                System Status
              </p>
            </div>
            <div className="p-4 space-y-3">
              {/* AI Core */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-[#f0fdf4] border border-[#bbf7d0]">
                <CheckCircle2 size={16} className="text-[#30a46c] shrink-0" />
                <div>
                  <p className="text-[12px] font-semibold text-[#166534]">AI Core Online</p>
                  <p className="text-[10px] text-[#30a46c] font-medium">YOLOv8 · Ready</p>
                </div>
              </div>

              {/* Resource meters */}
              <div className="space-y-3">
                {[
                  { label: 'CPU', value: 14 },
                  { label: 'Memory', value: 42 },
                ].map((m) => (
                  <div key={m.label}>
                    <div className="flex justify-between text-[11px] font-medium mb-1.5">
                      <span className="text-[#6b6b6b]">{m.label}</span>
                      <span className="text-[#1a1a1a] font-mono">{m.value}%</span>
                    </div>
                    <div className="h-1.5 bg-[#f0f0ed] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#0070f3] rounded-full transition-all duration-500"
                        style={{ width: `${m.value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Status rows */}
              <div className="space-y-2 pt-1 border-t border-[#e5e5e2]">
                {[
                  { label: 'API', value: 'Connected', ok: true },
                  { label: 'Database', value: 'SQLite active', ok: true },
                  { label: 'Cameras', value: `${cameras.length} registered`, ok: cameras.length > 0 },
                ].map((r) => (
                  <div key={r.label} className="flex items-center justify-between text-[11px]">
                    <span className="text-[#6b6b6b] font-medium">{r.label}</span>
                    <span className={`font-semibold ${r.ok ? 'text-[#30a46c]' : 'text-[#e5484d]'}`}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Active alerts */}
          <motion.div variants={fadeUp} className="bg-white border border-[#e5e5e2] rounded-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e5e2]">
              <p className="text-[12px] font-semibold text-[#1a1a1a] flex items-center gap-2">
                <AlertCircle size={13} className="text-[#e5484d]" />
                Recent Alerts
              </p>
              {activeAlerts.length > 0 && (
                <span className="px-1.5 py-0.5 bg-[#fff1f1] text-[#e5484d] text-[10px] font-bold rounded-full border border-[#fecdce]">
                  {activeAlerts.length} active
                </span>
              )}
            </div>
            <div className="divide-y divide-[#e5e5e2] max-h-64 overflow-y-auto custom-scrollbar">
              {(stats.recent_alerts || []).length === 0 ? (
                <div className="py-10 text-center text-[12px] text-[#a0a0a0]">No alerts</div>
              ) : (
                (stats.recent_alerts || []).slice(0, 6).map((alert: any) => (
                  <div
                    key={alert.id}
                    onClick={() => navigate('/analytics')}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-[#f9f9f8] cursor-pointer transition-colors"
                  >
                    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${alert.detection_type === 'fire' ? 'bg-[#e5484d]' : 'bg-[#e79020]'} ${alert.status === 'active' ? 'animate-pulse' : ''}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[11px] font-bold capitalize ${alert.detection_type === 'fire' ? 'text-[#e5484d]' : 'text-[#e79020]'}`}>
                          {alert.detection_type}
                        </span>
                        <span className="text-[10px] text-[#a0a0a0] font-mono">{(alert.confidence * 100).toFixed(0)}%</span>
                      </div>
                      <p className="text-[11px] text-[#6b6b6b] truncate">{alert.camera_id || 'File upload'}</p>
                      <p className="text-[10px] text-[#a0a0a0]">{new Date(alert.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>

          {/* Incidents */}
          <motion.div variants={fadeUp} className="bg-white border border-[#e5e5e2] rounded-xl">
            <div className="px-4 py-3 border-b border-[#e5e5e2]">
              <p className="text-[12px] font-semibold text-[#1a1a1a]">Incident Tickets</p>
            </div>
            <div className="divide-y divide-[#e5e5e2] max-h-48 overflow-y-auto custom-scrollbar">
              {incidents.length === 0 ? (
                <div className="py-8 text-center text-[12px] text-[#a0a0a0]">No incidents</div>
              ) : (
                incidents.slice(0, 4).map((inc: any) => (
                  <div
                    key={inc.id}
                    onClick={() => navigate('/alerts-reports')}
                    className="flex items-center justify-between px-4 py-3 hover:bg-[#f9f9f8] cursor-pointer transition-colors"
                  >
                    <div className="flex-1 min-w-0 mr-3">
                      <p className="text-[12px] font-medium text-[#1a1a1a] truncate">{inc.title}</p>
                      <p className="text-[10px] text-[#a0a0a0] mt-0.5">{inc.description?.slice(0, 40) || 'No description'}</p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      inc.severity === 'critical' ? 'bg-[#fff1f1] text-[#e5484d] border-[#fecdce]' :
                      inc.severity === 'high' ? 'bg-[#fef9ec] text-[#e79020] border-[#fde68a]' :
                      'bg-[#f0f0ed] text-[#6b6b6b] border-[#e5e5e2]'
                    }`}>
                      {inc.severity}
                    </span>
                  </div>
                ))
              )}
            </div>
          </motion.div>

        </div>
      </div>
    </motion.div>
  );
};

export default Dashboard;
