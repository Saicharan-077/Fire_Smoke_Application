import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '../components/Common/Card';
import { Button } from '../components/Common/Button';
import { Badge } from '../components/Common/Badge';
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
    <div className="space-y-6 max-w-7xl mx-auto text-[var(--text)] font-sans select-none">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight uppercase">Live Monitoring Screen</h2>
          <p className="text-xs text-[var(--text-2)] mt-1 font-semibold leading-relaxed">Real-time surveillance feeds matrix with autonomous visual threat validation layers.</p>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'grid' && (
            <div className="bg-[var(--surface-2)] border border-[var(--border)] p-1 rounded-xl flex gap-1 mr-2">
              {[1, 2, 4].map(sz => (
                <button 
                  key={sz}
                  onClick={() => setGridSize(sz as any)}
                  className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${gridSize === sz ? 'bg-[var(--surface)] text-[var(--primary)] border border-[var(--border)] shadow-xs' : 'text-[var(--text-3)] hover:text-[var(--text)]'}`}
                >
                  {sz === 1 ? '1x1' : sz === 2 ? '2x2' : '4x4'}
                </button>
              ))}
            </div>
          )}
          <div className="bg-[var(--surface-2)] border border-[var(--border)] p-1 rounded-xl flex gap-1">
            <button 
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${viewMode === 'grid' ? 'bg-[var(--surface)] text-[var(--primary)] border border-[var(--border)] shadow-xs' : 'text-[var(--text-3)] hover:text-[var(--text)]'}`}
            >
              <Grid size={13} /> Matrix Grid
            </button>
            <button 
              onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${viewMode === 'map' ? 'bg-[var(--surface)] text-[var(--primary)] border border-[var(--border)] shadow-xs' : 'text-[var(--text-3)] hover:text-[var(--text)]'}`}
            >
              <MapIcon size={13} /> Facility Map
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={loadRecentAlerts} className="flex items-center gap-1.5 bg-[var(--surface)] border border-[var(--border)] text-xs">
            <RefreshCw size={12} /> Sync Logs
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-stretch">
        
        {/* Main Matrix Content */}
        <div className="lg:col-span-3 space-y-6">
          {viewMode === 'grid' ? (
            <div className={`grid gap-5 ${gridSize === 1 ? 'grid-cols-1' : gridSize === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
              
              {/* 1. Webcam Stream */}
              <Card className="overflow-hidden bg-[var(--surface)] border border-[var(--border)] shadow-xs">
                <CardContent className="p-4 space-y-4 flex flex-col justify-between h-full">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                      <Camera size={14} className="text-[var(--fire)]" /> Local Terminal Webcam
                    </h3>
                    <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border ${webcamActive ? 'bg-[var(--safe-bg)] text-[var(--safe-text)] border-[var(--safe-border)]' : 'bg-[var(--fire-bg)] text-[var(--fire-text)] border-[var(--fire-border)]'}`}>{webcamActive ? 'Active' : 'Stopped'}</span>
                  </div>

                  {webcamActive ? (
                    <div ref={webcamContainerRef} className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-black aspect-video flex justify-center group shadow-inner">
                      <video ref={webcamVideoRef} className="hidden" width={640} height={480} autoPlay playsInline muted />
                      <canvas ref={webcamCanvasRef} width={640} height={480} className="w-full h-full object-contain" />
                      
                      {/* Active Threat HUD Overlay */}
                      {webcamThreat && (
                        <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-[var(--fire)]/90 to-transparent">
                          <p className="text-white text-[10px] font-black uppercase tracking-widest animate-pulse">⚠️ ALARM: Active {webcamThreat.toUpperCase()} anomaly verified</p>
                        </div>
                      )}

                      <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/75 text-white text-[9px] font-mono px-2 py-1 rounded-md">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--safe)] animate-pulse" />
                        HUD · {currentTime}
                      </div>

                      <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <button 
                          onClick={() => toggleFullscreen(webcamContainerRef)} 
                          className="p-2 bg-black/60 hover:bg-black/90 rounded-xl text-white border border-white/5 transition-all"
                        >
                          {isFullscreenWebcam ? <Minimize size={13} /> : <Maximize size={13} />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-video rounded-xl bg-slate-50/30 dark:bg-slate-900/30 border border-dashed border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center p-6 transition-all duration-300">
                      <div className="w-12 h-12 rounded-full bg-sky-50 dark:bg-sky-950/30 flex items-center justify-center text-sky-600 dark:text-sky-400 mb-3 shadow-xs">
                        <Camera size={20} />
                      </div>
                      <h4 className="text-xs font-bold text-[var(--text)] uppercase tracking-wider">Webcam stream disarmed</h4>
                      <p className="text-[10.5px] text-[var(--text-2)] max-w-xs mt-1 mb-4 leading-relaxed">Arm the local video scanning sensor to initiate real-time visual anomaly processing.</p>
                      <Button variant="primary" size="sm" onClick={startWebcam}>Arm local scanner</Button>
                    </div>
                  )}

                  {webcamActive && (
                    <div className="flex justify-between items-center text-xs">
                      <div className="flex gap-2">
                        <Button variant="destructive" size="sm" onClick={stopWebcam} className="text-xs">Disarm scanner</Button>
                        <button 
                          onClick={() => {
                            setSimulationMode(!simulationMode);
                            setDetections([]);
                            setWebcamThreat(null);
                            stopSiren();
                          }} 
                          className={`px-3 py-1.5 border text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                            simulationMode 
                              ? 'bg-[var(--smoke-bg)] text-[var(--smoke-text)] border-[var(--smoke-border)] hover:bg-[var(--smoke-text)] hover:text-white' 
                              : 'bg-[var(--primary-light)] text-[var(--primary)] border-[var(--primary-ring)] hover:bg-[var(--primary)] hover:text-white'
                          }`}
                        >
                          {simulationMode ? 'Simulation: Active' : 'AI Inference: Live'}
                        </button>
                      </div>
                      <div className="flex gap-4 font-bold text-[var(--text-3)] text-[10px] uppercase tracking-wider">
                        <span>Ingest FPS: <span className="text-[var(--text)] font-mono">{webcamFps}</span></span>
                        <button onClick={() => setWebcamMuted(!webcamMuted)} className="text-[var(--fire)] hover:text-[var(--fire-text)] cursor-pointer">
                          {webcamMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                        </button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 2. RTSP Camera Feed */}
              <Card className="overflow-hidden bg-[var(--surface)] border border-[var(--border)] shadow-xs">
                <CardContent className="p-4 space-y-4 flex flex-col justify-between h-full">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                      <MonitorPlay size={14} className="text-[var(--fire)]" /> Ingress CCTV RTSP Feed
                    </h3>
                    <select 
                      className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[10px] text-[var(--text)] font-bold outline-none cursor-pointer"
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
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  {rtspConnected ? (
                    <div ref={rtspContainerRef} className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-black aspect-video flex items-center justify-center group shadow-inner">
                      <img src="/evidence/test_red.jpg" alt="RTSP Feed" className="w-full h-full object-cover opacity-60" />
                      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:100%_4px] pointer-events-none"></div>
                      
                      {/* Notification Bar Overlay */}
                      <div className={`absolute top-0 left-0 right-0 p-3.5 flex justify-between items-start transition-opacity duration-300 ${recentAlerts.some(a => a.camera_id === selectedRtspCam?.id && a.status === 'active') ? 'bg-gradient-to-b from-[#eb5757]/80 to-transparent opacity-100' : 'bg-gradient-to-b from-black/80 to-transparent opacity-0 group-hover:opacity-100'}`}>
                        <div className="flex flex-col">
                          <span className={`font-bold text-[10px] uppercase tracking-wider flex items-center gap-2 ${recentAlerts.some(a => a.camera_id === selectedRtspCam?.id && a.status === 'active') ? 'text-red-400 font-black animate-pulse' : 'text-white'}`}>
                            <span className={`w-2 h-2 rounded-full ${recentAlerts.some(a => a.camera_id === selectedRtspCam?.id && a.status === 'active') ? 'bg-red-500' : 'bg-emerald-500'}`}></span>
                            {recentAlerts.some(a => a.camera_id === selectedRtspCam?.id && a.status === 'active') ? 'WARNING: THREAT DETECTED!' : `LIVE: ${selectedRtspCam?.name}`}
                          </span>
                          <span className="text-[9px] text-zinc-400 font-mono mt-1 font-bold">{currentTime}</span>
                        </div>
                        <button 
                          onClick={() => toggleFullscreen(rtspContainerRef)} 
                          className="p-2 bg-black/60 hover:bg-black/90 rounded-xl text-white border border-white/5 transition-all"
                        >
                          {isFullscreenRtsp ? <Minimize size={13} /> : <Maximize size={13} />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-video rounded-xl bg-slate-50/30 dark:bg-slate-900/30 border border-dashed border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center p-6 transition-all duration-300">
                      <div className="w-12 h-12 rounded-full bg-sky-50 dark:bg-sky-950/30 flex items-center justify-center text-sky-600 dark:text-sky-400 mb-3 shadow-xs">
                        <MonitorPlay size={20} />
                      </div>
                      <h4 className="text-xs font-bold text-[var(--text)] uppercase tracking-wider">RTSP stream disconnected</h4>
                      <p className="text-[10.5px] text-[var(--text-2)] max-w-xs mt-1 mb-4 leading-relaxed">Establish connection to the remote network stream decoders to analyze incoming surveillance frames.</p>
                      <Button variant="primary" size="sm" onClick={connectRtsp} isLoading={rtspLoading}>Connect Ingest</Button>
                    </div>
                  )}

                  {rtspConnected && (
                    <div className="flex justify-between items-center text-xs">
                      <Button variant="destructive" size="sm" onClick={disconnectRtsp} className="text-xs">Disconnect Ingest</Button>
                      <div className="flex gap-4 font-bold text-[var(--text-3)] text-[10px] uppercase tracking-wider">
                        <span>Decoder FPS: <span className="text-[var(--text)] font-mono">{rtspFps}</span></span>
                        <span>Telemetry Latency: <span className="text-[var(--text)] font-mono">{rtspLatency} ms</span></span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
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
          <Card className="bg-[var(--surface)] border border-[var(--border)] shadow-xs">
            <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Activity className="text-[var(--fire)] animate-pulse w-5 h-5" />
                <div>
                  <h4 className="font-bold text-xs text-[var(--text)] uppercase tracking-wider">Live Detection Ingestion Pipeline</h4>
                  <p className="text-[10px] text-[var(--text-2)] mt-0.5 font-semibold">Global YOLOv8 core engine is scanning surveillance memory buffers in real-time.</p>
                </div>
              </div>
              <div className="flex gap-4 text-xs font-bold text-[var(--text-2)] uppercase tracking-wider">
                <span>Active Threat: <span className={webcamThreat ? 'text-[var(--fire)] font-bold animate-pulse' : 'text-[var(--safe)] font-bold'}>{webcamThreat ? webcamThreat.toUpperCase() : 'NONE'}</span></span>
                <span>Confidence: <span className="text-[var(--text)] font-mono">{webcamThreat ? (webcamThreat === 'fire' ? '95%' : '87%') : 'N/A'}</span></span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: Recent Alerts & System Status */}
        <div className="space-y-6">
          <Card className="bg-[var(--surface)] border border-[var(--border)] shadow-xs">
            <CardContent className="p-5 space-y-4">
              <h3 className="font-bold text-xs text-[var(--text-2)] uppercase tracking-widest">Surveillance Node Telemetry</h3>
              <div className="space-y-2.5 text-xs font-semibold text-[var(--text-2)]">
                <div className="flex justify-between border-b border-[var(--border)] pb-2">
                  <span>AI Inference:</span>
                  <span className="text-[var(--safe)] font-bold">Active</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border)] pb-2">
                  <span>DB Connection:</span>
                  <span className="text-[var(--safe)] font-mono text-[10px]">SQLite OK</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border)] pb-2">
                  <span>Webcam Scanner:</span>
                  <span className={webcamActive ? 'text-[var(--safe)]' : 'text-[var(--text-3)]'}>{webcamActive ? 'ONLINE' : 'OFFLINE'}</span>
                </div>
                <div className="flex justify-between">
                  <span>RTSP Ingress:</span>
                  <span className={rtspConnected ? 'text-[var(--safe)]' : 'text-[var(--text-3)]'}>{rtspConnected ? 'ONLINE' : 'OFFLINE'}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[var(--surface)] border border-[var(--border)] shadow-xs">
            <CardContent className="p-5 space-y-3.5">
              <h3 className="font-bold text-xs text-[var(--text-2)] uppercase tracking-widest">Recent SOC Warnings</h3>
              
              {isLoadingAlerts ? (
                <div className="py-10 text-center text-xs text-[var(--text-3)] font-semibold">Syncing alerts...</div>
              ) : recentAlerts.length === 0 ? (
                <div className="py-10 text-center text-xs text-[var(--text-3)] flex flex-col items-center justify-center gap-2">
                  <ShieldCheck className="text-[var(--safe)] animate-radar" size={28} />
                  <span className="font-semibold text-zinc-450 uppercase tracking-wider text-[10px]">No Active Warnings</span>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[300px] overflow-y-auto custom-scrollbar">
                  {recentAlerts.map((alert) => (
                    <div key={alert.id} className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/20 hover:border-[var(--fire)]/20 transition-all flex items-center justify-between gap-3 cursor-pointer">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge type={alert.detection_type}>{alert.detection_type}</Badge>
                          <span className="text-[9px] font-mono font-bold text-[var(--text-3)]">{(alert.confidence * 100).toFixed(0)}%</span>
                        </div>
                        <span className="text-[9px] font-mono text-[var(--text-3)] block mt-1.5">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <span className={`text-[9px] font-black uppercase ${alert.status === 'active' ? 'text-[var(--fire)] animate-pulse' : 'text-[var(--safe)]'}`}>{alert.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
};

export default LiveMonitoring;
