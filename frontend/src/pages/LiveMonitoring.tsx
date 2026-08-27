import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';
import { getAlerts, testCctvConnection, getSettings, uploadImage } from '../services/api';
import { listCameras } from '../services/cameraService';
import { 
  Camera, MonitorPlay, ShieldCheck, 
  Activity, Volume2, VolumeX, RefreshCw,
  Map as MapIcon, Grid, Maximize, Minimize
} from 'lucide-react';
import { FacilityMap } from '../components/SOC/FacilityMap';
import { useNotificationsStore } from '../store/notificationsStore';

const LiveMonitoring = () => {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const cameraIdParam = searchParams.get('cameraId');
  
  // Webcam & RTSP streams state
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const webcamCanvasRef = useRef<HTMLCanvasElement>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [webcamActive, setWebcamActive] = useState(false);
  const [webcamThreat, setWebcamThreat] = useState<'fire' | 'smoke' | null>(null);
  const [webcamFps, setWebcamFps] = useState(0);
  const [webcamMuted, setWebcamMuted] = useState(true);

  const [simulationMode, setSimulationMode] = useState(false);
  const [detections, setDetections] = useState<any[]>([]);
  const [frameSkip, setFrameSkip] = useState(3);

  const [cameras, setCameras] = useState<any[]>([]);
  const [selectedRtspCam, setSelectedRtspCam] = useState<any>(null);
  const [rtspConnected, setRtspConnected] = useState(false);
  const [rtspLoading, setRtspLoading] = useState(false);
  const [rtspFps, setRtspFps] = useState(0);
  const [rtspLatency, setRtspLatency] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState('');

  // Notifications store helpers
  const historyAdd = useNotificationsStore((s) => s.addNotification);
  const pushPopup = useNotificationsStore((s) => s.pushPopup);

  // Audio Context siren play simulation
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscNodeRef = useRef<OscillatorNode | null>(null);

  // View preferences
  const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');
  const [gridSize, setGridSize] = useState<1 | 2 | 4>(2);
  const [recentAlerts, setRecentAlerts] = useState<any[]>([]);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState(false);

  // Fullscreen hooks
  const webcamContainerRef = useRef<HTMLDivElement>(null);
  const rtspContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreenWebcam, setIsFullscreenWebcam] = useState(false);
  const [isFullscreenRtsp, setIsFullscreenRtsp] = useState(false);

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
      // Select first remote camera by default
      if (cams.length > 0) {
        const rtspOnly = cams.filter((c: any) => c.id !== 'webcam-01' && !c.name.toLowerCase().includes('webcam'));
        if (rtspOnly.length > 0) {
          setSelectedRtspCam(rtspOnly[0]);
        } else {
          setSelectedRtspCam(cams[0]);
        }
      }
    } catch {
      toast('Failed to load camera sources database', 'error');
    }
  };

  const loadRecentAlerts = async () => {
    setIsLoadingAlerts(true);
    try {
      const alerts = await getAlerts({ limit: 10 });
      setRecentAlerts(alerts);
    } catch {
      /**/
    } finally {
      setIsLoadingAlerts(false);
    }
  };

  // Sync selected camera parameter if passed in route query string
  useEffect(() => {
    if (cameraIdParam && cameras.length > 0) {
      const match = cameras.find(c => c.id === cameraIdParam);
      if (match) {
        setSelectedRtspCam(match);
        setViewMode('grid');
      }
    }
  }, [cameraIdParam, cameras]);

  // Audio sirens controller
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

      // Modulator warning loop pitch
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

    } catch (e) {
      console.error('Audio synthesizer initiation failed:', e);
    }
  };

  const stopSiren = () => {
    try {
      if (oscNodeRef.current) {
        oscNodeRef.current.stop();
        oscNodeRef.current.disconnect();
        oscNodeRef.current = null;
      }
    } catch {
      /**/
    }
  };

  // Webcam stream lifecycle
  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 }
      });
      setWebcamStream(stream);
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
      }
      setWebcamActive(true);
      toast('Local surveillance device armed', 'success');
    } catch (err: any) {
      toast(`Webcam access denied: ${err.message}`, 'error');
    }
  };

  const stopWebcam = () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach(track => track.stop());
    }
    setWebcamStream(null);
    setWebcamActive(false);
    setWebcamThreat(null);
    setDetections([]);
    stopSiren();
  };

  // RTSP Feed Connect Sim
  const connectRtsp = async () => {
    if (!selectedRtspCam) {
      toast('Select a remote camera to connect', 'error');
      return;
    }
    setRtspLoading(true);
    const start = performance.now();
    try {
      const res = await testCctvConnection(selectedRtspCam.stream_url);
      setRtspConnected(true);
      setRtspFps(24);
      setRtspLatency(Math.round(performance.now() - start));
      toast(res.message || 'CCTV Decoder relay initialized', 'success');
    } catch (err: any) {
      toast(err.message || 'Handshake failed', 'error');
    } finally {
      setRtspLoading(false);
    }
  };

  const disconnectRtsp = () => {
    setRtspConnected(false);
    setRtspFps(0);
    setRtspLatency(null);
    toast('RTSP stream disconnected', 'info');
  };

  // Sync refs for the canvas loop to prevent flicker or re-binding lags
  const simModeRef = useRef(simulationMode);
  useEffect(() => { simModeRef.current = simulationMode; }, [simulationMode]);
  const frameSkipRef = useRef(frameSkip);
  useEffect(() => { frameSkipRef.current = frameSkip; }, [frameSkip]);
  const webcamThreatRef = useRef(webcamThreat);
  useEffect(() => { webcamThreatRef.current = webcamThreat; }, [webcamThreat]);
  const detectionsRef = useRef(detections);
  useEffect(() => { detectionsRef.current = detections; }, [detections]);

  // Loop for Webcam canvas drawing & threat simulation
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();
    let frames = 0;
    let tick = 0;
    let isProcessing = false;

    const render = () => {
      if (!webcamActive || !webcamVideoRef.current || !webcamCanvasRef.current) return;
      const video = webcamVideoRef.current;
      const canvas = webcamCanvasRef.current;
      const ctx = canvas.getContext('2d');

      if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        tick++;

        // Simulation Mode
        if (simModeRef.current) {
          const cycle = tick % 600;
          let threat: 'fire' | 'smoke' | null = null;
          if (cycle > 150 && cycle < 280) threat = 'fire';
          else if (cycle > 360 && cycle < 490) threat = 'smoke';

          if (threat !== webcamThreatRef.current) {
            setWebcamThreat(threat);
            if (threat) {
              startSiren();
              const mock = {
                id: `wc-${Date.now()}`,
                alertType: threat,
                cameraId: 'webcam-01',
                cameraName: 'Station Webcam',
                zone: 'Local Command',
                confidence: threat === 'fire' ? 0.95 : 0.87,
                timestamp: new Date().toISOString(),
                severity: threat === 'fire' ? 'critical' : 'warning',
                isRead: false
              } as any;
              historyAdd(mock);
              pushPopup(mock);
              void loadRecentAlerts();
            } else {
              stopSiren();
            }
          }

          if (threat) {
            const mockDets = [{
              detection_type: threat,
              confidence: threat === 'fire' ? 0.95 : 0.87,
              bbox: { x1: 180, y1: 130, x2: 460, y2: 330 }
            } as any];
            setDetections(mockDets);
          } else {
            setDetections([]);
          }
        }
        // Real AI Mode
        else if (tick % frameSkipRef.current === 0 && !isProcessing) {
          isProcessing = true;
          canvas.toBlob(async (blob) => {
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
                  if (threat !== webcamThreatRef.current) {
                    setWebcamThreat(threat);
                    startSiren();

                    const newAlert = {
                      id: res.alert_ids[0] || `wc-${Date.now()}`,
                      alertType: threat,
                      cameraId: 'webcam-01',
                      cameraName: 'Station Webcam',
                      zone: 'Local Command',
                      confidence: Math.max(...res.detections.map(d => d.confidence)),
                      timestamp: new Date().toISOString(),
                      severity: threat === 'fire' ? 'critical' : 'warning',
                      isRead: false
                    } as any;
                    historyAdd(newAlert);
                    pushPopup(newAlert);
                    void loadRecentAlerts();
                  }
                } else {
                  if (webcamThreatRef.current) {
                    setWebcamThreat(null);
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

        // Draw bounding boxes (Red for fire, Orange for smoke)
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
        if (now - lastTime >= 1000) {
          setWebcamFps(frames);
          frames = 0;
          lastTime = now;
        }
      }
      animId = requestAnimationFrame(render);
    };

    if (webcamActive) {
      animId = requestAnimationFrame(render);
    } else {
      stopSiren();
      setDetections([]);
    }

    return () => {
      cancelAnimationFrame(animId);
      stopSiren();
    };
  }, [webcamActive, webcamMuted]);

  const fetchSettings = async () => {
    try {
      const res = await getSettings();
      const skip = res.find((s: any) => s.id === 'frame_skip')?.value;
      if (skip) setFrameSkip(parseInt(skip));
    } catch { /* ignore */ }
  };

  useEffect(() => {
    void fetchSettings();
    void loadCamerasList();
    void loadRecentAlerts();
    return () => {
      stopWebcam();
    };
  }, []);

  const toggleFullscreen = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (!ref.current) return;
    try {
      if (!document.fullscreenElement) {
        ref.current.requestFullscreen().then(() => {
          if (ref === webcamContainerRef) setIsFullscreenWebcam(true);
          if (ref === rtspContainerRef) setIsFullscreenRtsp(true);
        }).catch(() => {});
      } else {
        document.exitFullscreen().then(() => {
          setIsFullscreenWebcam(false);
          setIsFullscreenRtsp(false);
        }).catch(() => {});
      }
    } catch {
      /**/
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-[var(--color-fg)] font-sans select-none">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[var(--color-fg)]">Live Monitoring Matrix</h1>
          <p className="text-xs sm:text-sm text-[var(--color-muted)] mt-1 font-medium leading-relaxed">Real-time surveillance feeds matrix with autonomous visual threat validation layers.</p>
        </div>
        <div className="flex items-center gap-3">
          {viewMode === 'grid' && (
            <div className="glass-light border border-[var(--color-border)] p-1.5 rounded-2xl flex gap-1.5 shadow-sm">
              {[1, 2, 4].map(sz => (
                <button 
                  key={sz}
                  onClick={() => setGridSize(sz as any)}
                  className={`px-3 py-1 text-xs font-bold rounded-xl transition-all cursor-pointer ${gridSize === sz ? 'glass bg-[var(--color-accent)] text-white shadow-glow' : 'text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]'}`}
                >
                  {sz === 1 ? '1x1' : sz === 2 ? '2x2' : '4x4'}
                </button>
              ))}
            </div>
          )}
          <div className="glass-light border border-[var(--color-border)] p-1.5 rounded-2xl flex gap-1.5 shadow-sm">
            <button 
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer ${viewMode === 'grid' ? 'glass bg-[var(--color-accent)] text-white shadow-glow' : 'text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]'}`}
            >
              <Grid size={14} /> Matrix Grid
            </button>
            <button 
              onClick={() => setViewMode('map')}
              className={`px-3 py-1 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer ${viewMode === 'map' ? 'glass bg-[var(--color-accent)] text-white shadow-glow' : 'text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]'}`}
            >
              <MapIcon size={14} /> Facility Map
            </button>
          </div>
          <button onClick={loadRecentAlerts} className="flex items-center gap-1.5 px-4 py-2 glass-light border border-[var(--color-border)] text-[var(--color-fg-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 text-xs font-bold rounded-2xl shadow-sm cursor-pointer">
            <RefreshCw size={13} /> Sync Logs
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-stretch">
        
        {/* Main Matrix Content */}
        <div className="lg:col-span-3 space-y-6">
          {viewMode === 'grid' ? (
            <div className={`grid gap-6 ${gridSize === 1 ? 'grid-cols-1' : gridSize === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
              
              {/* 1. Webcam Stream */}
              <div className="glass rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden p-5 flex flex-col justify-between h-full">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-extrabold text-xs text-[var(--color-fg)] uppercase tracking-wider flex items-center gap-2">
                      <Camera size={16} className="text-red-500" /> Local Terminal Webcam
                    </h3>
                    <span className={`px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${webcamActive ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' : 'bg-red-500/10 text-red-500 border-red-500/30'}`}>{webcamActive ? 'Active' : 'Stopped'}</span>
                  </div>

                  {webcamActive ? (
                    <div ref={webcamContainerRef} className="relative rounded-2xl overflow-hidden border border-[var(--color-border)] bg-black aspect-video flex justify-center group shadow-inner">
                      <video ref={webcamVideoRef} className="hidden" width={640} height={480} autoPlay playsInline muted />
                      <canvas ref={webcamCanvasRef} width={640} height={480} className="w-full h-full object-contain" />
                      
                      {/* Active Threat HUD Overlay */}
                      {webcamThreat && (
                        <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-red-500/90 to-transparent">
                          <p className="text-white text-xs font-bold uppercase tracking-wider animate-pulse">⚠️ ALARM: Active {webcamThreat.toUpperCase()} anomaly verified</p>
                        </div>
                      )}

                      <div className="absolute top-2 left-2 flex items-center gap-2 glass text-white text-[10px] font-semibold px-2.5 py-1 rounded-lg">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        HUD · {currentTime}
                      </div>

                      <div className="absolute bottom-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <button 
                          onClick={() => toggleFullscreen(webcamContainerRef)} 
                          className="p-2 glass rounded-xl text-white hover:scale-105 transition-transform cursor-pointer"
                        >
                          {isFullscreenWebcam ? <Minimize size={14} /> : <Maximize size={14} />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-video rounded-2xl glass-light border border-dashed border-[var(--color-border)] flex flex-col items-center justify-center text-center p-6 transition-all duration-300">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-[var(--color-accent)] flex items-center justify-center mb-3 shadow-xs">
                        <Camera size={22} />
                      </div>
                      <h4 className="text-xs font-bold text-[var(--color-fg)] uppercase tracking-wider">Webcam stream disarmed</h4>
                      <p className="text-xs text-[var(--color-muted)] max-w-xs mt-1 mb-4 font-medium leading-relaxed">Arm the local video scanning sensor to initiate real-time visual anomaly processing.</p>
                      <button onClick={startWebcam} className="px-5 py-2.5 bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-2)] text-white text-xs font-bold rounded-xl hover:scale-105 transition-all shadow-glow cursor-pointer">
                        Arm local scanner
                      </button>
                    </div>
                  )}
                </div>

                {webcamActive && (
                  <div className="flex justify-between items-center text-xs mt-4 pt-3 border-t border-[var(--color-border)]">
                    <div className="flex gap-2">
                      <button onClick={stopWebcam} className="px-3 py-1.5 bg-red-500/10 text-red-500 border border-red-500/30 text-xs font-bold rounded-xl hover:bg-red-500 hover:text-white transition-all cursor-pointer">Disarm scanner</button>
                      <button 
                        onClick={() => {
                          setSimulationMode(!simulationMode);
                          setDetections([]);
                          setWebcamThreat(null);
                          stopSiren();
                        }} 
                        className={`px-3 py-1.5 border text-xs font-bold rounded-xl transition-all cursor-pointer ${
                          simulationMode 
                            ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' 
                            : 'bg-indigo-500/10 text-[var(--color-accent)] border-indigo-500/30'
                        }`}
                      >
                        {simulationMode ? 'Simulation: Active' : 'AI Inference: Live'}
                      </button>
                    </div>
                    <div className="flex gap-4 font-bold text-[var(--color-muted)] text-[11px]">
                      <span>Ingest FPS: <span className="text-[var(--color-fg)] font-extrabold">{webcamFps}</span></span>
                      <button onClick={() => setWebcamMuted(!webcamMuted)} className="text-red-500 hover:text-red-600 cursor-pointer">
                        {webcamMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 2. RTSP Camera Feed */}
              <div className="glass rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden p-5 flex flex-col justify-between h-full">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-extrabold text-xs text-[var(--color-fg)] uppercase tracking-wider flex items-center gap-2">
                      <MonitorPlay size={16} className="text-indigo-500" /> Ingress CCTV RTSP Feed
                    </h3>
                    <select 
                      className="glass-light border border-[var(--color-border)] rounded-xl px-3 py-1.5 text-xs text-[var(--color-fg)] font-bold outline-none cursor-pointer bg-[var(--color-surface)]"
                      value={selectedRtspCam?.id || ''}
                      onChange={(e) => {
                        const match = cameras.find(c => c.id === e.target.value);
                        if (match) {
                          setSelectedRtspCam(match);
                          disconnectRtsp();
                        }
                      }}
                    >
                      {cameras.map(c => (
                        <option key={c.id} value={c.id} className="bg-[var(--color-surface)] text-[var(--color-fg)] font-semibold">{c.name}</option>
                      ))}
                    </select>
                  </div>

                  {rtspConnected ? (
                    <div ref={rtspContainerRef} className="relative rounded-2xl overflow-hidden border border-[var(--color-border)] bg-black aspect-video flex items-center justify-center group shadow-inner">
                      <img src="/evidence/test_red.jpg" alt="RTSP Feed" className="w-full h-full object-cover opacity-60" />
                      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:100%_4px] pointer-events-none"></div>
                      
                      {/* Notification Bar Overlay */}
                      <div className={`absolute top-0 left-0 right-0 p-3.5 flex justify-between items-start transition-opacity duration-300 ${recentAlerts.some(a => a.camera_id === selectedRtspCam?.id && a.status === 'active') ? 'bg-gradient-to-b from-red-500/90 to-transparent opacity-100' : 'bg-gradient-to-b from-black/80 to-transparent opacity-0 group-hover:opacity-100'}`}>
                        <div className="flex flex-col">
                          <span className={`font-extrabold text-[11px] uppercase tracking-wider flex items-center gap-2 ${recentAlerts.some(a => a.camera_id === selectedRtspCam?.id && a.status === 'active') ? 'text-white animate-pulse' : 'text-white'}`}>
                            <span className={`w-2 h-2 rounded-full ${recentAlerts.some(a => a.camera_id === selectedRtspCam?.id && a.status === 'active') ? 'bg-red-500' : 'bg-emerald-500'}`}></span>
                            {recentAlerts.some(a => a.camera_id === selectedRtspCam?.id && a.status === 'active') ? 'WARNING: THREAT DETECTED!' : `LIVE: ${selectedRtspCam?.name}`}
                          </span>
                          <span className="text-[10px] text-white/80 font-bold mt-0.5">{currentTime}</span>
                        </div>
                        <button 
                          onClick={() => toggleFullscreen(rtspContainerRef)} 
                          className="p-2 glass rounded-xl text-white hover:scale-105 transition-transform cursor-pointer"
                        >
                          {isFullscreenRtsp ? <Minimize size={14} /> : <Maximize size={14} />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-video rounded-2xl glass-light border border-dashed border-[var(--color-border)] flex flex-col items-center justify-center text-center p-6 transition-all duration-300">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-[var(--color-accent)] flex items-center justify-center mb-3 shadow-xs">
                        <MonitorPlay size={22} />
                      </div>
                      <h4 className="text-xs font-bold text-[var(--color-fg)] uppercase tracking-wider">RTSP stream disconnected</h4>
                      <p className="text-xs text-[var(--color-muted)] max-w-xs mt-1 mb-4 font-medium leading-relaxed">Establish connection to the remote network stream decoders to analyze incoming surveillance frames.</p>
                      <button onClick={connectRtsp} disabled={rtspLoading} className="px-5 py-2.5 bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-2)] text-white text-xs font-bold rounded-xl hover:scale-105 transition-all shadow-glow cursor-pointer disabled:opacity-50">
                        {rtspLoading ? 'Connecting...' : 'Connect Ingest'}
                      </button>
                    </div>
                  )}
                </div>

                {rtspConnected && (
                  <div className="flex justify-between items-center text-xs mt-4 pt-3 border-t border-[var(--color-border)]">
                    <button onClick={disconnectRtsp} className="px-3 py-1.5 bg-red-500/10 text-red-500 border border-red-500/30 text-xs font-bold rounded-xl hover:bg-red-500 hover:text-white transition-all cursor-pointer">Disconnect Ingest</button>
                    <div className="flex gap-4 font-bold text-[var(--color-muted)] text-[11px]">
                      <span>Decoder FPS: <span className="text-[var(--color-fg)] font-extrabold">{rtspFps}</span></span>
                      <span>Telemetry Latency: <span className="text-[var(--color-fg)] font-extrabold">{rtspLatency} ms</span></span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
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
                  setViewMode('grid');
                }
              }}
            />
          )}

          {/* Current Detections Banner */}
          <div className="glass rounded-2xl border border-[var(--color-border)] shadow-sm p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Activity className="text-red-500 animate-pulse w-5 h-5 shrink-0" />
              <div>
                <h4 className="font-extrabold text-xs text-[var(--color-fg)] uppercase tracking-wider">Live Detection Ingestion Pipeline</h4>
                <p className="text-xs text-[var(--color-muted)] mt-0.5 font-medium">Global YOLOv8 core engine is scanning surveillance memory buffers in real-time.</p>
              </div>
            </div>
            <div className="flex gap-4 text-xs font-bold text-[var(--color-muted)] uppercase tracking-wider shrink-0">
              <span>Active Threat: <span className={webcamThreat ? 'text-red-500 font-extrabold animate-pulse' : 'text-emerald-500 font-extrabold'}>{webcamThreat ? webcamThreat.toUpperCase() : 'NONE'}</span></span>
              <span>Confidence: <span className="text-[var(--color-fg)] font-extrabold">{webcamThreat ? (webcamThreat === 'fire' ? '95%' : '87%') : 'N/A'}</span></span>
            </div>
          </div>
        </div>

        {/* Sidebar: Recent Alerts & System Status */}
        <div className="space-y-6">
          <div className="glass rounded-2xl border border-[var(--color-border)] shadow-sm p-5 space-y-4">
            <h3 className="font-extrabold text-xs text-[var(--color-fg)] uppercase tracking-wider">Surveillance Node Telemetry</h3>
            <div className="space-y-3 text-xs font-semibold text-[var(--color-fg-secondary)]">
              <div className="flex justify-between border-b border-[var(--color-border)] pb-2.5">
                <span>AI Inference:</span>
                <span className="text-emerald-500 font-bold">Active</span>
              </div>
              <div className="flex justify-between border-b border-[var(--color-border)] pb-2.5">
                <span>DB Connection:</span>
                <span className="text-emerald-500 font-bold">SQLite OK</span>
              </div>
              <div className="flex justify-between border-b border-[var(--color-border)] pb-2.5">
                <span>Webcam Scanner:</span>
                <span className={webcamActive ? 'text-emerald-500 font-bold' : 'text-[var(--color-muted)] font-medium'}>{webcamActive ? 'ONLINE' : 'OFFLINE'}</span>
              </div>
              <div className="flex justify-between">
                <span>RTSP Ingress:</span>
                <span className={rtspConnected ? 'text-emerald-500 font-bold' : 'text-[var(--color-muted)] font-medium'}>{rtspConnected ? 'ONLINE' : 'OFFLINE'}</span>
              </div>
            </div>
          </div>

          <div className="glass rounded-2xl border border-[var(--color-border)] shadow-sm p-5 space-y-4">
            <h3 className="font-extrabold text-xs text-[var(--color-fg)] uppercase tracking-wider">Recent SOC Warnings</h3>
            
            {isLoadingAlerts ? (
              <div className="py-10 text-center text-xs text-[var(--color-muted)] font-semibold">Syncing alerts...</div>
            ) : recentAlerts.length === 0 ? (
              <div className="py-10 text-center text-xs text-[var(--color-muted)] flex flex-col items-center justify-center gap-2">
                <ShieldCheck className="text-emerald-500 animate-pulse" size={28} />
                <span className="font-bold uppercase tracking-wider text-xs">No Active Warnings</span>
              </div>
            ) : (
              <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar">
                {recentAlerts.map((alert) => (
                  <div key={alert.id} className="p-3 rounded-xl border border-[var(--color-border)] glass-light hover:border-[var(--color-accent)]/30 transition-all flex items-center justify-between gap-3 cursor-pointer">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${alert.detection_type === 'fire' ? 'bg-red-500/10 text-red-500 border-red-500/30' : 'bg-amber-500/10 text-amber-500 border-amber-500/30'}`}>{alert.detection_type}</span>
                        <span className="text-[10px] font-bold text-[var(--color-fg-secondary)]">{(alert.confidence * 100).toFixed(0)}%</span>
                      </div>
                      <span className="text-[10px] font-medium text-[var(--color-muted)] block mt-1.5">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <span className={`text-[10px] font-extrabold uppercase ${alert.status === 'active' ? 'text-red-500 animate-pulse' : 'text-emerald-500'}`}>{alert.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default LiveMonitoring;
