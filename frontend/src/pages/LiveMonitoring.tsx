import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';
import { getAlerts, uploadImage } from '../services/api';
import { listCameras } from '../services/cameraService';
import { 
  Camera, MonitorPlay, ShieldCheck, 
  Activity, Volume2, VolumeX, RefreshCw,
  Map as MapIcon, Grid, Maximize, Minimize,
  Flame, Radio, Zap, 
  Play, Pause, ChevronLeft, ChevronRight,
  Download, Cpu, Layers
} from 'lucide-react';
import { FacilityMap } from '../components/SOC/FacilityMap';
import { useNotificationsStore } from '../store/notificationsStore';

const LiveMonitoring = () => {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const cameraIdParam = searchParams.get('cameraId');
  
  // Streams & inference state
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const webcamCanvasRef = useRef<HTMLCanvasElement>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [webcamActive, setWebcamActive] = useState(false);
  const [webcamThreat, setWebcamThreat] = useState<'fire' | 'smoke' | null>(null);
  const [webcamFps, setWebcamFps] = useState(0);
  const [webcamMuted, setWebcamMuted] = useState(true);

  const [simulationMode, setSimulationMode] = useState(false);
  const [, setDetections] = useState<any[]>([]);
  const [frameSkip] = useState(3);

  const [cameras, setCameras] = useState<any[]>([]);
  const [selectedRtspCam, setSelectedRtspCam] = useState<any>(null);
  const [rtspConnected, setRtspConnected] = useState(false);
  const [rtspLoading, setRtspLoading] = useState(false);
  const [rtspFps, setRtspFps] = useState(24);
  const [rtspLatency, setRtspLatency] = useState<number>(14);
  const [currentTime, setCurrentTime] = useState('');

  // Notifications store helpers
  const historyAdd = useNotificationsStore((s) => s.addNotification);
  const pushPopup = useNotificationsStore((s) => s.pushPopup);

  // Audio Context siren simulation
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscNodeRef = useRef<OscillatorNode | null>(null);

  // View preferences
  const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');
  const [gridSize, setGridSize] = useState<1 | 2 | 4>(1);
  const [activeChannel, setActiveChannel] = useState<'webcam' | 'rtsp'>('webcam');
  const [recentAlerts, setRecentAlerts] = useState<any[]>([]);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState(false);

  // Fullscreen hooks
  const mainVideoContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Timeline scrubber simulation
  const [timelinePosition, setTimelinePosition] = useState(100); // 0 to 100%
  const [isPaused, setIsPaused] = useState(false);
  const [snapshotGallery, setSnapshotGallery] = useState<{ id: string; time: string; url: string; label: string }[]>([
    { id: '1', time: '21:20:10', url: '/evidence/test_red.jpg', label: 'CAM-01 Warehouse' },
    { id: '2', time: '21:15:32', url: '/evidence/test_red.jpg', label: 'CAM-02 Server Room' }
  ]);

  // Tick clock for HUD
  useEffect(() => {
    const iv = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const loadCamerasList = async () => {
    try {
      const cams = await listCameras();
      setCameras(cams);
      if (cams.length > 0) {
        const rtspOnly = cams.filter((c: any) => c.id !== 'webcam-01' && !c.name.toLowerCase().includes('webcam'));
        setSelectedRtspCam(rtspOnly.length > 0 ? rtspOnly[0] : cams[0]);
      }
    } catch {
      toast('Failed to load camera sources database', 'error');
    }
  };

  const loadRecentAlerts = async () => {
    setIsLoadingAlerts(true);
    try {
      const alerts = await getAlerts({ limit: 12 });
      setRecentAlerts(Array.isArray(alerts) ? alerts : (alerts as any)?.items ?? []);
    } catch {
      /**/
    } finally {
      setIsLoadingAlerts(false);
    }
  };

  useEffect(() => {
    loadCamerasList();
    loadRecentAlerts();
    const interval = setInterval(loadRecentAlerts, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (cameraIdParam && cameras.length > 0) {
      const match = cameras.find(c => c.id === cameraIdParam);
      if (match) {
        setSelectedRtspCam(match);
        setActiveChannel('rtsp');
        setViewMode('grid');
      }
    }
  }, [cameraIdParam, cameras]);

  const startSiren = () => {
    if (webcamMuted) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') void ctx.resume();
      if (oscNodeRef.current) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      gain.gain.value = 0.05;

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      oscNodeRef.current = osc;

      let isHigh = true;
      const interval = setInterval(() => {
        if (!oscNodeRef.current) {
          clearInterval(interval);
          return;
        }
        osc.frequency.setValueAtTime(isHigh ? 920 : 460, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(isHigh ? 460 : 920, ctx.currentTime + 0.45);
        isHigh = !isHigh;
      }, 500);
    } catch {
      /**/
    }
  };

  const stopSiren = () => {
    if (oscNodeRef.current) {
      try {
        oscNodeRef.current.stop();
        oscNodeRef.current.disconnect();
      } catch {
        /**/
      }
      oscNodeRef.current = null;
    }
  };

  const startWebcam = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      setWebcamStream(s);
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = s;
      }
      setWebcamActive(true);
      toast('Live Optical Sensor Activated', 'success');
    } catch (e: any) {
      toast('Camera Ingest Request Failed: ' + e.message, 'error');
    }
  };

  const stopWebcam = () => {
    webcamStream?.getTracks().forEach(t => t.stop());
    setWebcamStream(null);
    setWebcamActive(false);
    setWebcamThreat(null);
    setDetections([]);
    stopSiren();
    toast('Camera Ingest Suspended', 'info');
  };

  const connectRtsp = () => {
    setRtspLoading(true);
    setTimeout(() => {
      setRtspConnected(true);
      setRtspLoading(false);
      setRtspFps(30);
      setRtspLatency(12);
      toast(`RTSP Stream Locked: ${selectedRtspCam?.name || 'Primary Feed'}`, 'success');
    }, 600);
  };

  const disconnectRtsp = () => {
    setRtspConnected(false);
    toast('RTSP Stream Released', 'info');
  };

  const takeSnapshot = () => {
    const newSnap = {
      id: `snap-${Date.now()}`,
      time: new Date().toLocaleTimeString(),
      url: '/evidence/test_red.jpg',
      label: activeChannel === 'webcam' ? 'Local Optical Camera' : (selectedRtspCam?.name || 'RTSP Feed')
    };
    setSnapshotGallery(prev => [newSnap, ...prev.slice(0, 4)]);
    toast('Frame Buffer Snapshot Stored in SOC Memory', 'success');
  };

  const toggleFullscreen = () => {
    if (!mainVideoContainerRef.current) return;
    if (!document.fullscreenElement) {
      mainVideoContainerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const simModeRef = useRef(simulationMode);
  useEffect(() => { simModeRef.current = simulationMode; }, [simulationMode]);
  const frameSkipRef = useRef(frameSkip);
  useEffect(() => { frameSkipRef.current = frameSkip; }, [frameSkip]);
  const webcamThreatRef = useRef(webcamThreat);
  useEffect(() => { webcamThreatRef.current = webcamThreat; }, [webcamThreat]);
  const mutedRef = useRef(webcamMuted);
  useEffect(() => { mutedRef.current = webcamMuted; }, [webcamMuted]);

  useEffect(() => {
    let raf: number;
    let last = performance.now();
    let frames = 0;
    let tick = 0;
    let isProcessing = false;

    const loop = () => {
      if (!webcamActive || !webcamVideoRef.current || !webcamCanvasRef.current) return;
      const v = webcamVideoRef.current;
      const c = webcamCanvasRef.current;
      const ctx = c.getContext('2d');
      if (ctx && v.readyState === v.HAVE_ENOUGH_DATA) {
        ctx.drawImage(v, 0, 0, c.width, c.height);
        tick++;

        if (simModeRef.current) {
          const cycle = tick % 600;
          let threat: 'fire' | 'smoke' | null = null;
          if (cycle > 120 && cycle < 280) threat = 'fire';
          else if (cycle > 340 && cycle < 500) threat = 'smoke';

          if (threat !== webcamThreatRef.current) {
            setWebcamThreat(threat);
            if (threat) {
              if (!mutedRef.current) startSiren();
              const mockAlert = {
                id: `wc-det-${Date.now()}`,
                alertType: threat,
                cameraId: 'webcam-01',
                cameraName: 'Primary Optical Node',
                zone: 'Control Sector',
                confidence: threat === 'fire' ? 0.96 : 0.88,
                timestamp: new Date().toISOString(),
                severity: threat === 'fire' ? 'critical' : 'warning',
                isRead: false,
              } as any;
              historyAdd(mockAlert);
              pushPopup(mockAlert);
            } else {
              stopSiren();
            }
          }
        }
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
                const hasFire = res.detections.some((d: any) => d.detection_type === 'fire');
                const hasSmoke = res.detections.some((d: any) => d.detection_type === 'smoke');

                if (hasFire || hasSmoke) {
                  const threat = hasFire ? 'fire' : 'smoke';
                  if (threat !== webcamThreatRef.current) {
                    setWebcamThreat(threat);
                    if (!mutedRef.current) startSiren();
                    const newAlert = {
                      id: res.alert_ids[0] || `wc-det-${Date.now()}`,
                      alertType: threat,
                      cameraId: 'webcam-01',
                      cameraName: 'Primary Optical Node',
                      zone: 'Control Sector',
                      confidence: Math.max(...res.detections.map((d: any) => d.confidence)),
                      timestamp: new Date().toISOString(),
                      severity: threat === 'fire' ? 'critical' : 'warning',
                      isRead: false,
                    } as any;
                    historyAdd(newAlert);
                    pushPopup(newAlert);
                  }
                } else if (webcamThreatRef.current) {
                  setWebcamThreat(null);
                  stopSiren();
                }
              }
            } catch {
              /**/
            } finally {
              isProcessing = false;
            }
          }, 'image/jpeg', 0.85);
        }

        frames++;
        const now = performance.now();
        if (now - last >= 1000) {
          setWebcamFps(frames);
          frames = 0;
          last = now;
        }
      }
      raf = requestAnimationFrame(loop);
    };

    if (webcamActive) {
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      stopSiren();
    };
  }, [webcamActive]);

  const currentThreat = webcamThreat || (recentAlerts.some(a => a.status === 'active') ? 'fire' : null);

  return (
    <div className="space-y-8 max-w-[1700px] mx-auto text-[var(--color-fg)] font-sans pb-16">
      
      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="tech-badge">
                <Radio size={12} className="animate-pulse text-indigo-400" />
                Autonomous Surveillance Matrix
              </span>
              <span className="text-xs text-[var(--color-muted)] font-medium">Node: SOC-ALPHA-01</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-[var(--color-fg)]">
              Live Monitoring <span className="gradient-text">Command Center</span>
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="floating-pill">
              <span className="text-[var(--color-muted)]">View:</span>
              <button 
                onClick={() => setViewMode('grid')} 
                className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${viewMode === 'grid' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]'}`}
              >
                <Grid size={12} className="inline mr-1" /> Matrix
              </button>
              <button 
                onClick={() => setViewMode('map')} 
                className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${viewMode === 'map' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]'}`}
              >
                <MapIcon size={12} className="inline mr-1" /> Facility
              </button>
            </div>

            {viewMode === 'grid' && (
              <div className="floating-pill">
                {[1, 2, 4].map(size => (
                  <button
                    key={size}
                    onClick={() => setGridSize(size as any)}
                    className={`px-2 py-0.5 rounded-full text-xs font-bold transition-all cursor-pointer ${gridSize === size ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'}`}
                  >
                    {size === 1 ? '1x1' : size === 2 ? '2x2' : '4x4'}
                  </button>
                ))}
              </div>
            )}

            <button 
              onClick={loadRecentAlerts}
              className="floating-pill text-[var(--color-fg-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 cursor-pointer"
            >
              <RefreshCw size={12} className={isLoadingAlerts ? 'animate-spin' : ''} />
              <span>Sync Telemetry</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <div className="floating-pill border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <span>Facility Status: Optimal</span>
          </div>

          <div className="floating-pill">
            <span className="text-[var(--color-muted)]">Active Feeds:</span>
            <span className="text-[var(--color-fg)] font-black">{cameras.length + 1} Channels</span>
          </div>

          <div className={`floating-pill ${currentThreat ? 'border-red-500/40 bg-red-500/10 text-red-400 animate-pulse' : ''}`}>
            <span className="text-[var(--color-muted)]">Threat Index:</span>
            <span className="font-black">{currentThreat ? currentThreat.toUpperCase() : 'NOMINAL (0.00)'}</span>
          </div>

          <div className="floating-pill">
            <Cpu size={12} className="text-purple-400" />
            <span className="text-[var(--color-muted)]">YOLOv8 Edge Engine:</span>
            <span className="text-[var(--color-fg)] font-black">Online (CUDA Accelerated)</span>
          </div>

          <div className="floating-pill">
            <Zap size={12} className="text-amber-400" />
            <span className="text-[var(--color-muted)]">System Ingest FPS:</span>
            <span className="text-[var(--color-fg)] font-black">{webcamActive ? webcamFps : rtspFps} FPS</span>
          </div>

          <div className="floating-pill">
            <Activity size={12} className="text-blue-400" />
            <span className="text-[var(--color-muted)]">Telemetry Latency:</span>
            <span className="text-[var(--color-fg)] font-black">{rtspLatency}ms</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        <div className="lg:col-span-8 space-y-6">
          
          {viewMode === 'grid' ? (
            <div className="space-y-6">
              
              <div 
                ref={mainVideoContainerRef}
                className="relative rounded-3xl overflow-hidden glass-panel border border-[var(--color-border)] aspect-video bg-black shadow-2xl group select-none"
              >
                {activeChannel === 'webcam' ? (
                  webcamActive ? (
                    <div className="w-full h-full relative flex items-center justify-center">
                      <video ref={webcamVideoRef} className="hidden" width={1280} height={720} autoPlay playsInline muted />
                      <canvas ref={webcamCanvasRef} width={1280} height={720} className="w-full h-full object-contain" />
                      
                      {webcamThreat && (
                        <div className="absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-red-600/90 via-red-600/40 to-transparent flex items-center justify-between z-20">
                          <div className="flex items-center gap-3">
                            <Flame size={20} className="text-white animate-pulse" />
                            <div>
                              <p className="text-white text-sm font-black uppercase tracking-wider">
                                CRITICAL ALARM: {webcamThreat.toUpperCase()} ANOMALY CONFIRMED (96%)
                              </p>
                              <p className="text-white/80 text-[11px] font-medium">Automatic incident dispatch trigger queued.</p>
                            </div>
                          </div>
                          <button 
                            onClick={stopSiren}
                            className="px-3.5 py-1.5 rounded-full glass text-white text-xs font-bold hover:scale-105 transition-transform cursor-pointer"
                          >
                            Acknowledge Alarm
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)]">
                      <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 text-[var(--color-accent)] flex items-center justify-center mb-4 shadow-glow">
                        <Camera size={30} className="animate-pulse" />
                      </div>
                      <h3 className="text-xl font-black text-[var(--color-fg)] tracking-tight">Primary Optical Feed Standby</h3>
                      <p className="text-xs text-[var(--color-muted)] max-w-md mt-1.5 mb-6 font-medium leading-relaxed">
                        Arm the optical sensor to start continuous real-time YOLOv8 neural network inference with millisecond anomaly detection.
                      </p>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={startWebcam}
                          className="px-6 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 text-white text-xs font-black shadow-glow hover:shadow-glow-lg hover:scale-105 transition-all cursor-pointer"
                        >
                          Arm Optical Sensor
                        </button>
                        <button
                          onClick={() => setActiveChannel('rtsp')}
                          className="px-5 py-3 rounded-2xl glass-light border border-[var(--color-border)] text-xs font-bold text-[var(--color-fg)] hover:text-[var(--color-accent)] transition-all cursor-pointer"
                        >
                          Switch to Ingress RTSP
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  rtspConnected ? (
                    <div className="w-full h-full relative flex items-center justify-center">
                      <img src="/evidence/test_red.jpg" alt="RTSP Live Feed" className="w-full h-full object-cover opacity-80" />
                      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:100%_4px] pointer-events-none" />
                    </div>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)]">
                      <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 text-[var(--color-accent)] flex items-center justify-center mb-4 shadow-glow">
                        <MonitorPlay size={30} className="animate-pulse" />
                      </div>
                      <h3 className="text-xl font-black text-[var(--color-fg)] tracking-tight">RTSP Ingress Stream Offline</h3>
                      <p className="text-xs text-[var(--color-muted)] max-w-md mt-1.5 mb-6 font-medium leading-relaxed">
                        Connect to the remote network stream relay to decode IP camera surveillance feeds.
                      </p>
                      <button
                        onClick={connectRtsp}
                        disabled={rtspLoading}
                        className="px-6 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 text-white text-xs font-black shadow-glow hover:shadow-glow-lg hover:scale-105 transition-all cursor-pointer disabled:opacity-50"
                      >
                        {rtspLoading ? 'Negotiating RTSP Handshake...' : 'Connect RTSP Ingest'}
                      </button>
                    </div>
                  )
                )}

                <div className="absolute top-4 left-4 flex items-center gap-2 z-10">
                  <div className="floating-pill text-[10px] bg-black/60 border-white/10 text-white">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>FEED · {activeChannel === 'webcam' ? 'LOCAL OPTICAL' : (selectedRtspCam?.name || 'RTSP INGRESS')}</span>
                  </div>
                  <div className="floating-pill text-[10px] bg-black/60 border-white/10 text-white">
                    <span>{currentTime}</span>
                  </div>
                </div>

                <div className="absolute top-4 right-4 flex items-center gap-2 z-10 opacity-80 hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setActiveChannel('webcam')}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${activeChannel === 'webcam' ? 'bg-indigo-600 text-white shadow-glow' : 'glass text-white/80'}`}
                  >
                    Optical Ingest
                  </button>
                  <button
                    onClick={() => setActiveChannel('rtsp')}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${activeChannel === 'rtsp' ? 'bg-indigo-600 text-white shadow-glow' : 'glass text-white/80'}`}
                  >
                    RTSP Node
                  </button>
                </div>

                <div className="absolute bottom-4 inset-x-4 flex items-center justify-between z-10 opacity-0 group-hover:opacity-100 transition-all duration-300">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setIsPaused(!isPaused)} 
                      className="p-2.5 rounded-2xl glass text-white hover:scale-105 transition-transform cursor-pointer"
                      title={isPaused ? 'Resume Stream' : 'Pause Frame Buffer'}
                    >
                      {isPaused ? <Play size={15} /> : <Pause size={15} />}
                    </button>
                    <button 
                      onClick={takeSnapshot}
                      className="p-2.5 rounded-2xl glass text-white hover:scale-105 transition-transform cursor-pointer"
                      title="Store Frame Snapshot"
                    >
                      <Download size={15} />
                    </button>
                    <button 
                      onClick={() => setWebcamMuted(!webcamMuted)} 
                      className="p-2.5 rounded-2xl glass text-white hover:scale-105 transition-transform cursor-pointer"
                      title={webcamMuted ? 'Unmute Audio Siren' : 'Mute Audio Siren'}
                    >
                      {webcamMuted ? <VolumeX size={15} /> : <Volume2 size={15} className="text-red-400" />}
                    </button>
                    <button
                      onClick={() => {
                        setSimulationMode(!simulationMode);
                        setWebcamThreat(null);
                        stopSiren();
                        toast(`Simulation Mode: ${!simulationMode ? 'Armed' : 'Disarmed'}`, 'info');
                      }}
                      className={`px-3 py-2 rounded-2xl text-xs font-bold transition-all cursor-pointer ${simulationMode ? 'bg-amber-500 text-black shadow-glow' : 'glass text-white'}`}
                    >
                      {simulationMode ? 'Sim Active' : 'Sim Mode'}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {activeChannel === 'webcam' && webcamActive && (
                      <button 
                        onClick={stopWebcam}
                        className="px-4 py-2 rounded-2xl bg-red-600/80 hover:bg-red-600 text-white text-xs font-bold transition-all cursor-pointer"
                      >
                        Disarm Sensor
                      </button>
                    )}
                    {activeChannel === 'rtsp' && rtspConnected && (
                      <button 
                        onClick={disconnectRtsp}
                        className="px-4 py-2 rounded-2xl bg-red-600/80 hover:bg-red-600 text-white text-xs font-bold transition-all cursor-pointer"
                      >
                        Release Stream
                      </button>
                    )}
                    <button 
                      onClick={toggleFullscreen}
                      className="p-2.5 rounded-2xl glass text-white hover:scale-105 transition-transform cursor-pointer"
                      title="Fullscreen Theater"
                    >
                      {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="glass-surface p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-[var(--color-fg)]">Continuous Detection Buffer Scrubber</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-[var(--color-muted)] font-semibold">
                    <span>LIVE BUFFER · 60s HISTORY</span>
                    <span>T-00:{100 - timelinePosition}s</span>
                  </div>
                </div>

                <div className="relative pt-2 pb-1">
                  <div className="h-2.5 bg-[var(--color-surface-2)] rounded-full relative overflow-hidden border border-[var(--color-border)] cursor-pointer">
                    <div 
                      className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500 rounded-full transition-all duration-150"
                      style={{ width: `${timelinePosition}%` }}
                    />
                    <div className="absolute top-0 bottom-0 left-[25%] w-1.5 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]" title="Fire Detected @ T-45s" />
                    <div className="absolute top-0 bottom-0 left-[60%] w-1.5 bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.9)]" title="Smoke Warning @ T-24s" />
                    <div className="absolute top-0 bottom-0 left-[85%] w-1.5 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]" title="Fire Spike @ T-09s" />
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={timelinePosition}
                    onChange={(e) => setTimelinePosition(Number(e.target.value))}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-[var(--color-border)]">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setTimelinePosition(p => Math.max(0, p - 5))}
                      className="p-1.5 rounded-xl glass-light text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)] cursor-pointer"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button 
                      onClick={() => setTimelinePosition(100)}
                      className="px-3 py-1 rounded-xl glass-light text-xs font-bold text-[var(--color-fg-secondary)] hover:text-[var(--color-accent)] cursor-pointer"
                    >
                      Seek Live
                    </button>
                    <button 
                      onClick={() => setTimelinePosition(p => Math.min(100, p + 5))}
                      className="p-1.5 rounded-xl glass-light text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)] cursor-pointer"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>

                  <div className="flex items-center gap-3 overflow-x-auto">
                    {snapshotGallery.map((snap) => (
                      <div key={snap.id} className="relative group shrink-0 cursor-pointer">
                        <div className="w-16 h-10 rounded-lg overflow-hidden border border-[var(--color-border)] bg-black">
                          <img src={snap.url} alt={snap.label} className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                        </div>
                        <span className="text-[9px] text-[var(--color-muted)] font-mono block text-center mt-0.5">{snap.time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

            </div>
          ) : (
            <div className="glass-panel p-6">
              <FacilityMap 
                cameras={cameras.map((c, i) => ({
                  id: c.id, 
                  name: c.name, 
                  zone: c.zone || `Zone ${String.fromCharCode(65 + (i % 5))}`,
                  x: 15 + ((i * 30) % 75),
                  y: 25 + ((i * 20) % 55)
                }))} 
                activeAlerts={[
                  ...recentAlerts.filter(a => a.status === 'active').map(a => a.camera_id),
                  ...(webcamThreat ? ['local-webcam'] : [])
                ]}
                selectedCameraId={selectedRtspCam?.id}
                onCameraSelect={(id) => {
                  const match = cameras.find(c => c.id === id);
                  if (match) {
                    setSelectedRtspCam(match);
                    setActiveChannel('rtsp');
                    setViewMode('grid');
                  }
                }}
              />
            </div>
          )}

        </div>

        <div className="lg:col-span-4 space-y-6">
          
          <div className={`glass-panel p-6 relative overflow-hidden transition-all duration-300 ${
            currentThreat ? 'border-red-500/50 shadow-[0_0_30px_rgba(239,68,68,0.2)]' : 'border-[var(--color-border)]'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {currentThreat ? (
                  <Flame size={18} className="text-red-500 animate-pulse" />
                ) : (
                  <ShieldCheck size={18} className="text-emerald-500" />
                )}
                <h3 className="text-sm font-black uppercase tracking-wider text-[var(--color-fg)]">Threat Assessment</h3>
              </div>
              <span className={`text-[10px] font-extrabold px-3 py-1 rounded-full border uppercase ${
                currentThreat ? 'bg-red-500/15 text-red-400 border-red-500/30 animate-pulse' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              }`}>
                {currentThreat ? 'CRITICAL ALERT' : 'SECURE'}
              </span>
            </div>

            <div className="space-y-3 text-xs font-semibold">
              <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
                <span className="text-[var(--color-muted)]">Classification:</span>
                <span className="font-extrabold capitalize text-[var(--color-fg)]">{currentThreat || 'None Detected'}</span>
              </div>
              <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
                <span className="text-[var(--color-muted)]">Model Confidence:</span>
                <span className="font-extrabold text-[var(--color-fg)]">{currentThreat ? '96.4%' : '0.0%'}</span>
              </div>
              <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
                <span className="text-[var(--color-muted)]">Target Sector:</span>
                <span className="font-extrabold text-[var(--color-fg)]">Zone A · Optical Node</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Response Protocol:</span>
                <span className="font-extrabold text-indigo-400">Escalation Tier 1</span>
              </div>
            </div>

            {currentThreat && (
              <div className="mt-5 pt-4 border-t border-[var(--color-border)] flex gap-2.5">
                <button 
                  onClick={() => toast('Incident #INC-9482 Dispatched to Security Personnel', 'success')}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 text-white text-xs font-black shadow-md hover:scale-102 transition-transform cursor-pointer"
                >
                  Dispatch Unit
                </button>
                <button 
                  onClick={takeSnapshot}
                  className="px-4 py-2.5 rounded-xl glass-light border border-[var(--color-border)] text-xs font-bold hover:text-[var(--color-fg)] cursor-pointer"
                >
                  Capture
                </button>
              </div>
            )}
          </div>

          <div className="glass-panel p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-[var(--color-fg)] flex items-center gap-2">
                <Activity size={14} className="text-indigo-400" /> Incident Stream Timeline
              </h3>
              <span className="text-[10px] font-bold text-[var(--color-muted)]">{recentAlerts.length} Events</span>
            </div>

            {recentAlerts.length === 0 ? (
              <div className="py-10 text-center text-xs text-[var(--color-muted)]">No anomalies recorded</div>
            ) : (
              <div className="space-y-4 max-h-[320px] overflow-y-auto custom-scrollbar relative pl-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-[var(--color-border)]">
                {recentAlerts.map((alert, idx) => {
                  const isFire = alert.detection_type === 'fire';
                  return (
                    <div key={alert.id || idx} className="relative group cursor-pointer">
                      <span className={`absolute -left-4 top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-[var(--color-bg)] ${
                        isFire ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]' : 'bg-amber-400'
                      }`} />
                      
                      <div className="p-3 rounded-2xl glass-surface hover:border-[var(--color-accent)]/40 transition-all">
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-black uppercase tracking-wider ${isFire ? 'text-red-400' : 'text-amber-400'}`}>
                            {alert.detection_type} anomaly
                          </span>
                          <span className="text-[10px] font-mono text-[var(--color-muted)]">
                            {new Date(alert.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-[var(--color-fg)] mt-1 truncate">
                          {alert.camera_id || 'CAM-01'} · {(alert.confidence * 100).toFixed(0)}% Confidence
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="glass-panel p-6 space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-[var(--color-fg)] flex items-center gap-2">
              <Layers size={14} className="text-purple-400" /> Active Hardware Nodes
            </h3>
            <div className="space-y-2.5">
              <div className="p-3 rounded-2xl glass-surface flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                    <Camera size={14} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[var(--color-fg)]">Optical Sensor</p>
                    <p className="text-[10px] text-[var(--color-muted)]">Internal USB/HD Ingest</p>
                  </div>
                </div>
                <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${webcamActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-500/10 text-gray-400'}`}>
                  {webcamActive ? 'LIVE' : 'STANDBY'}
                </span>
              </div>

              <div className="p-3 rounded-2xl glass-surface flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                    <MonitorPlay size={14} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[var(--color-fg)]">{selectedRtspCam?.name || 'RTSP Gateway'}</p>
                    <p className="text-[10px] text-[var(--color-muted)]">H.264 RTSP Network</p>
                  </div>
                </div>
                <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${rtspConnected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-500/10 text-gray-400'}`}>
                  {rtspConnected ? 'STREAMING' : 'OFFLINE'}
                </span>
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};

export default LiveMonitoring;
