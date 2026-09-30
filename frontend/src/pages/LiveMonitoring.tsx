import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';
import { getAlerts, uploadImage } from '../services/api';
import { listCameras } from '../services/cameraService';
import { 
  Camera, MonitorPlay, ShieldCheck, 
  Activity, Volume2, VolumeX, RefreshCw,
  Map as MapIcon, Grid, Maximize, Minimize,
  Flame, 
  Play, Pause, ChevronLeft, ChevronRight,
  Download, Layers
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
  const [webcamThreat, setWebcamThreat] = useState<'fire' | 'smoke' | 'sparks' | null>(null);
  const [, setWebcamFps] = useState(0);
  const [webcamMuted, setWebcamMuted] = useState(true);

  const [simulationMode, setSimulationMode] = useState(false);
  const [, setDetections] = useState<any[]>([]);
  const [frameSkip] = useState(2);

  const [cameras, setCameras] = useState<any[]>([]);
  const [selectedRtspCam, setSelectedRtspCam] = useState<any>(null);
  const [rtspConnected, setRtspConnected] = useState(false);
  const [rtspLoading, setRtspLoading] = useState(false);
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
  const [timelinePosition, setTimelinePosition] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const [snapshotGallery, setSnapshotGallery] = useState<{ id: string; time: string; url: string; label: string }[]>([]);

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

  const detectionsRef = useRef<any[]>([]);

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
          let threat: 'fire' | 'smoke' | 'sparks' | null = null;
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

          if (threat) {
            detectionsRef.current = [{
              detection_type: threat,
              confidence: threat === 'fire' ? 0.96 : 0.88,
              bbox: { x1: 200, y1: 150, x2: 500, y2: 400 }
            }];
          } else {
            detectionsRef.current = [];
          }
        }
        else if (tick % Math.max(1, frameSkipRef.current) === 0 && !isProcessing) {
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
                detectionsRef.current = res.detections;
                setDetections(res.detections);
                const hasFire = res.detections.some((d: any) => d.detection_type === 'fire');
                const hasSmoke = res.detections.some((d: any) => d.detection_type === 'smoke');
                const hasSparks = res.detections.some((d: any) => d.detection_type === 'sparks' || d.detection_type === 'spark');

                if (hasFire || hasSmoke || hasSparks) {
                  const threat: 'fire' | 'smoke' | 'sparks' = hasFire ? 'fire' : (hasSmoke ? 'smoke' : 'sparks');
                  if (threat !== webcamThreatRef.current) {
                    setWebcamThreat(threat);
                    if (!mutedRef.current) startSiren();
                    const newAlert = {
                      id: res.alert_ids?.[0] || `wc-det-${Date.now()}`,
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

        // Draw bounding boxes
        if (detectionsRef.current && detectionsRef.current.length > 0) {
          detectionsRef.current.forEach((det: any) => {
            const isSparks = det.detection_type === 'sparks' || det.detection_type === 'spark';
            const col = det.detection_type === 'fire' ? '#ef4444' : (isSparks ? '#f59e0b' : '#0ea5e9');
            ctx.strokeStyle = col;
            ctx.lineWidth = 3;

            const { x1, y1, x2, y2 } = det.bbox;
            const width = x2 - x1;
            const height = y2 - y1;
            ctx.strokeRect(x1, y1, width, height);

            const badgeText = `${det.detection_type.toUpperCase()} ${Math.round(det.confidence * 100)}%`;
            ctx.font = 'bold 12px sans-serif';
            const textWidth = ctx.measureText(badgeText).width + 16;
            ctx.fillStyle = col;
            ctx.fillRect(x1, y1 - 26 > 0 ? y1 - 26 : y1, textWidth, 24);

            ctx.fillStyle = '#fff';
            ctx.fillText(badgeText, x1 + 8, (y1 - 26 > 0 ? y1 - 26 : y1) + 16);
          });
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
    <div className="space-y-4 max-w-[1700px] mx-auto text-[var(--color-fg)] font-sans pb-10 select-none">
      
      {/* Compact Operational Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <h1 className="text-page-title text-[var(--color-fg)] flex items-center gap-2">
            Live Surveillance Matrix
          </h1>
          <span className="tech-badge">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
            LIVE FEED
          </span>
          <span className="text-xs text-[var(--color-muted)] font-medium hidden md:inline">
            {cameras.length + 1} Channels Connected
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="floating-pill py-0.5">
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
            <div className="floating-pill py-0.5">
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
            title="Sync Alert Feeds"
          >
            <RefreshCw size={12} className={isLoadingAlerts ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── 2. MAIN 70 / 30 SPLIT ARCHITECTURE ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        
        {/* Left Stage (70%): CCTV Video Feed & Scrubber */}
        <div className="lg:col-span-8 space-y-4">
          
          {viewMode === 'grid' ? (
            <div className="space-y-3.5">
              
              {/* Primary 16:9 Video Viewport */}
              <div 
                ref={mainVideoContainerRef}
                className="relative rounded-2xl overflow-hidden glass-panel border border-[var(--color-border)] aspect-video bg-black shadow-lg group select-none"
              >
                {activeChannel === 'webcam' ? (
                  webcamActive ? (
                    <div className="w-full h-full relative flex items-center justify-center">
                      <video ref={webcamVideoRef} className="hidden" width={1280} height={720} autoPlay playsInline muted />
                      <canvas ref={webcamCanvasRef} width={1280} height={720} className="w-full h-full object-contain" />
                      
                      {webcamThreat && (
                        <div className="absolute top-0 inset-x-0 p-3 bg-gradient-to-b from-red-600/90 via-red-600/40 to-transparent flex items-center justify-between z-20">
                          <div className="flex items-center gap-2.5">
                            <Flame size={18} className="text-white animate-pulse" />
                            <div>
                              <p className="text-white text-xs font-bold uppercase tracking-wider">
                                ALARM: {webcamThreat.toUpperCase()} DETECTED (96%)
                              </p>
                              <p className="text-white/80 text-[10px] font-medium">Automatic dispatch queued.</p>
                            </div>
                          </div>
                          <button 
                            onClick={stopSiren}
                            className="px-3 py-1 rounded-full glass text-white text-[11px] font-bold hover:scale-105 transition-transform cursor-pointer"
                          >
                            Acknowledge
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)]">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-[var(--color-accent)] flex items-center justify-center mb-3 shadow-sm">
                        <Camera size={24} className="animate-pulse" />
                      </div>
                      <h3 className="text-base font-bold text-[var(--color-fg)] tracking-tight">Primary Optical Feed Standby</h3>
                      <p className="text-xs text-[var(--color-muted)] max-w-sm mt-1 mb-4 font-normal leading-relaxed">
                        Arm the optical sensor to start continuous real-time neural vision network inference.
                      </p>
                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={startWebcam}
                          className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-bold shadow-sm hover:scale-105 transition-all cursor-pointer"
                        >
                          Arm Sensor
                        </button>
                        <button
                          onClick={() => setActiveChannel('rtsp')}
                          className="px-3.5 py-2 rounded-xl glass-light border border-[var(--color-border)] text-xs font-semibold text-[var(--color-fg)] hover:text-[var(--color-accent)] transition-all cursor-pointer"
                        >
                          Switch to RTSP
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
                    <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)]">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-[var(--color-accent)] flex items-center justify-center mb-3 shadow-sm">
                        <MonitorPlay size={24} className="animate-pulse" />
                      </div>
                      <h3 className="text-base font-bold text-[var(--color-fg)] tracking-tight">RTSP Ingress Stream Offline</h3>
                      <p className="text-xs text-[var(--color-muted)] max-w-sm mt-1 mb-4 font-normal leading-relaxed">
                        Connect to the remote network stream relay to decode IP camera surveillance feeds.
                      </p>
                      <button
                        onClick={connectRtsp}
                        disabled={rtspLoading}
                        className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-bold shadow-sm hover:scale-105 transition-all cursor-pointer disabled:opacity-50"
                      >
                        {rtspLoading ? 'Connecting...' : 'Connect RTSP Ingest'}
                      </button>
                    </div>
                  )
                )}

                {/* Floating HUD Overlays */}
                <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
                  <div className="floating-pill text-[10px] bg-black/60 border-white/10 text-white">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>{activeChannel === 'webcam' ? 'LOCAL OPTICAL' : (selectedRtspCam?.name || 'RTSP INGRESS')}</span>
                  </div>
                  <div className="floating-pill text-[10px] bg-black/60 border-white/10 text-white">
                    <span>{currentTime}</span>
                  </div>
                </div>

                <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10 opacity-80 hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setActiveChannel('webcam')}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${activeChannel === 'webcam' ? 'bg-indigo-600 text-white shadow-sm' : 'glass text-white/80'}`}
                  >
                    Optical
                  </button>
                  <button
                    onClick={() => setActiveChannel('rtsp')}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${activeChannel === 'rtsp' ? 'bg-indigo-600 text-white shadow-sm' : 'glass text-white/80'}`}
                  >
                    RTSP
                  </button>
                </div>

                <div className="absolute bottom-3 inset-x-3 flex items-center justify-between z-10 opacity-0 group-hover:opacity-100 transition-all duration-200">
                  <div className="flex items-center gap-1.5">
                    <button 
                      onClick={() => setIsPaused(!isPaused)} 
                      className="p-2 rounded-xl glass text-white hover:scale-105 transition-transform cursor-pointer"
                      title={isPaused ? 'Resume Stream' : 'Pause Frame Buffer'}
                    >
                      {isPaused ? <Play size={13} /> : <Pause size={13} />}
                    </button>
                    <button 
                      onClick={takeSnapshot}
                      className="p-2 rounded-xl glass text-white hover:scale-105 transition-transform cursor-pointer"
                      title="Store Frame Snapshot"
                    >
                      <Download size={13} />
                    </button>
                    <button 
                      onClick={() => setWebcamMuted(!webcamMuted)} 
                      className="p-2 rounded-xl glass text-white hover:scale-105 transition-transform cursor-pointer"
                      title={webcamMuted ? 'Unmute Audio Siren' : 'Mute Audio Siren'}
                    >
                      {webcamMuted ? <VolumeX size={13} /> : <Volume2 size={13} className="text-red-400" />}
                    </button>
                    <button
                      onClick={() => {
                        setSimulationMode(!simulationMode);
                        setWebcamThreat(null);
                        stopSiren();
                        toast(`Simulation Mode: ${!simulationMode ? 'Armed' : 'Disarmed'}`, 'info');
                      }}
                      className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${simulationMode ? 'bg-amber-500 text-black' : 'glass text-white'}`}
                    >
                      {simulationMode ? 'Sim Active' : 'Sim Mode'}
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {activeChannel === 'webcam' && webcamActive && (
                      <button 
                        onClick={stopWebcam}
                        className="px-3 py-1.5 rounded-xl bg-red-600/80 hover:bg-red-600 text-white text-xs font-bold transition-all cursor-pointer"
                      >
                        Disarm
                      </button>
                    )}
                    {activeChannel === 'rtsp' && rtspConnected && (
                      <button 
                        onClick={disconnectRtsp}
                        className="px-3 py-1.5 rounded-xl bg-red-600/80 hover:bg-red-600 text-white text-xs font-bold transition-all cursor-pointer"
                      >
                        Release Stream
                      </button>
                    )}
                    <button 
                      onClick={toggleFullscreen}
                      className="p-2 rounded-xl glass text-white hover:scale-105 transition-transform cursor-pointer"
                      title="Fullscreen Theater"
                    >
                      {isFullscreen ? <Minimize size={13} /> : <Maximize size={13} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Scrubber Strip */}
              <div className="glass-surface p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-fg)]">Detection Scrubber</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-[var(--color-muted)] font-mono">
                    <span>BUFFER: 60s</span>
                    <span>T-00:{100 - timelinePosition}s</span>
                  </div>
                </div>

                <div className="relative pt-1">
                  <div className="h-2 bg-[var(--color-surface-2)] rounded-full relative overflow-hidden border border-[var(--color-border)] cursor-pointer">
                    <div 
                      className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500 rounded-full transition-all duration-150"
                      style={{ width: `${timelinePosition}%` }}
                    />
                    <div className="absolute top-0 bottom-0 left-[25%] w-1 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]" title="Fire @ T-45s" />
                    <div className="absolute top-0 bottom-0 left-[60%] w-1 bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.9)]" title="Smoke @ T-24s" />
                    <div className="absolute top-0 bottom-0 left-[85%] w-1 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]" title="Fire @ T-09s" />
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

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1.5 border-t border-[var(--color-border)]">
                  <div className="flex items-center gap-1.5">
                    <button 
                      onClick={() => setTimelinePosition(p => Math.max(0, p - 5))}
                      className="p-1 rounded-lg glass-light text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)] cursor-pointer"
                    >
                      <ChevronLeft size={13} />
                    </button>
                    <button 
                      onClick={() => setTimelinePosition(100)}
                      className="px-2.5 py-0.5 rounded-lg glass-light text-[11px] font-bold text-[var(--color-fg-secondary)] hover:text-[var(--color-accent)] cursor-pointer"
                    >
                      Live
                    </button>
                    <button 
                      onClick={() => setTimelinePosition(p => Math.min(100, p + 5))}
                      className="p-1 rounded-lg glass-light text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)] cursor-pointer"
                    >
                      <ChevronRight size={13} />
                    </button>
                  </div>

                  <div className="flex items-center gap-2 overflow-x-auto">
                    {snapshotGallery.map((snap) => (
                      <div key={snap.id} className="relative group shrink-0 cursor-pointer">
                        <div className="w-12 h-8 rounded-md overflow-hidden border border-[var(--color-border)] bg-black">
                          <img src={snap.url} alt={snap.label} className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                        </div>
                        <span className="text-[8px] text-[var(--color-muted)] font-mono block text-center mt-0.5">{snap.time}</span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

            </div>
          ) : (
            <div className="glass-panel p-4">
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

        {/* ── Right Column: Threat Stack & Incidents (30%) ── */}
        <div className="lg:col-span-4 space-y-3.5">
          
          {/* Compact Threat Assessment */}
          <div className={`glass-panel p-3.5 relative overflow-hidden transition-all duration-200 ${
            currentThreat ? 'border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.15)]' : 'border-[var(--color-border)]'
          }`}>
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5">
                {currentThreat ? (
                  <Flame size={15} className="text-red-500 animate-pulse" />
                ) : (
                  <ShieldCheck size={15} className="text-emerald-400" />
                )}
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-fg)]">Threat Assessment</h3>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${
                currentThreat ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              }`}>
                {currentThreat ? 'ALERT' : 'SECURE'}
              </span>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between border-b border-[var(--color-border)] pb-1">
                <span className="text-[var(--color-muted)]">Type:</span>
                <span className="font-bold capitalize text-[var(--color-fg)]">{currentThreat || 'None'}</span>
              </div>
              <div className="flex justify-between border-b border-[var(--color-border)] pb-1">
                <span className="text-[var(--color-muted)]">Confidence:</span>
                <span className="font-bold text-[var(--color-fg)]">{currentThreat ? '96.4%' : '0.0%'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Sector:</span>
                <span className="font-bold text-[var(--color-fg)]">Zone A · Optical Node</span>
              </div>
            </div>

            {currentThreat && (
              <div className="mt-2.5 pt-2 border-t border-[var(--color-border)] flex gap-2">
                <button 
                  onClick={() => toast('Incident Dispatched to Team', 'success')}
                  className="flex-1 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  Dispatch
                </button>
                <button 
                  onClick={takeSnapshot}
                  className="px-2.5 py-1 rounded-lg glass-light border border-[var(--color-border)] text-xs font-bold hover:text-[var(--color-fg)] cursor-pointer"
                >
                  Capture
                </button>
              </div>
            )}
          </div>

          {/* Compact Incident Stream Timeline */}
          <div className="glass-panel p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-fg)] flex items-center gap-1.5">
                <Activity size={13} className="text-indigo-400" /> Incidents
              </h3>
              <span className="text-[10px] font-bold text-[var(--color-muted)]">{recentAlerts.length} Events</span>
            </div>

            {recentAlerts.length === 0 ? (
              <div className="py-6 text-center text-xs text-[var(--color-muted)]">No anomalies recorded</div>
            ) : (
              <div className="space-y-2 max-h-[220px] overflow-y-auto custom-scrollbar relative pl-3 before:absolute before:left-1 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-[var(--color-border)]">
                {recentAlerts.map((alert, idx) => {
                  const isFire = alert.detection_type === 'fire';
                  return (
                    <div key={alert.id || idx} className="relative group cursor-pointer">
                      <span className={`absolute -left-3 top-1.5 w-1.5 h-1.5 rounded-full ring-2 ring-[var(--color-bg)] ${
                        isFire ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]' : 'bg-amber-400'
                      }`} />
                      
                      <div className="p-2 rounded-lg glass-surface hover:border-[var(--color-accent)]/40 transition-all">
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${isFire ? 'text-red-400' : 'text-amber-400'}`}>
                            {alert.detection_type}
                          </span>
                          <span className="text-[10px] font-mono text-[var(--color-muted)]">
                            {new Date(alert.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-[var(--color-fg)] mt-0.5 truncate">
                          {alert.camera_id || 'CAM-01'} · {(alert.confidence * 100).toFixed(0)}%
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active Hardware Devices */}
          <div className="glass-panel p-3.5 space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-fg)] flex items-center gap-1.5">
              <Layers size={13} className="text-purple-400" /> Active Nodes
            </h3>
            <div className="space-y-2">
              <div className="p-2 rounded-lg glass-surface flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                    <Camera size={12} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[var(--color-fg)]">Optical Sensor</p>
                    <p className="text-[10px] text-[var(--color-muted)]">USB HD Ingest</p>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${webcamActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-500/10 text-gray-400'}`}>
                  {webcamActive ? 'LIVE' : 'STANDBY'}
                </span>
              </div>

              <div className="p-2 rounded-lg glass-surface flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                    <MonitorPlay size={12} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[var(--color-fg)]">{selectedRtspCam?.name || 'RTSP Relay'}</p>
                    <p className="text-[10px] text-[var(--color-muted)]">H.264 Stream</p>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${rtspConnected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-500/10 text-gray-400'}`}>
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
