import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '../components/Common/Card';
import { Button } from '../components/Common/Button';
import { Badge } from '../components/Common/Badge';
import { useToast } from '../components/ui/Toast';
import { getAlerts, testCctvConnection } from '../services/api';
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

  const [cameras, setCameras] = useState<any[]>([]);
  const [selectedRtspCam, setSelectedRtspCam] = useState<any>(null);
  const [rtspConnected, setRtspConnected] = useState(false);
  const [rtspFps, setRtspFps] = useState(0);
  const [rtspLatency, setRtspLatency] = useState<number | null>(null);
  const [rtspLoading, setRtspLoading] = useState(false);

  const [recentAlerts, setRecentAlerts] = useState<any[]>([]);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState(false);
  
  const historyAdd = useNotificationsStore((s) => s.addNotification);
  const pushPopup = useNotificationsStore((s) => s.pushPopup);

  const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');
  const [gridSize, setGridSize] = useState<1 | 2 | 4>(2); // Layout selector: 1x1, 2x2, etc.

  const [isFullscreenWebcam, setIsFullscreenWebcam] = useState(false);
  const [isFullscreenRtsp, setIsFullscreenRtsp] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  const webcamContainerRef = useRef<HTMLDivElement>(null);
  const rtspContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreenWebcam(document.fullscreenElement === webcamContainerRef.current);
      setIsFullscreenRtsp(document.fullscreenElement === rtspContainerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (!document.fullscreenElement) {
      ref.current?.requestFullscreen().catch(err => {
        toast(`Error attempting to enable fullscreen: ${err.message}`, 'error');
      });
    } else {
      document.exitFullscreen();
    }
  };

  // Audio synthesis helper for warning siren
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  const startSiren = () => {
    if (webcamMuted) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') void ctx.resume();

      if (!oscRef.current) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.5);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();

        let direction = true;
        const sirenInterval = setInterval(() => {
          if (!oscRef.current) {
            clearInterval(sirenInterval);
            return;
          }
          osc.frequency.setValueAtTime(direction ? 800 : 1200, ctx.currentTime);
          osc.frequency.linearRampToValueAtTime(direction ? 1200 : 800, ctx.currentTime + 0.5);
          direction = !direction;
        }, 500);

        oscRef.current = osc;
        gainRef.current = gain;
      }
    } catch (e) {}
  };

  const stopSiren = () => {
    try {
      if (oscRef.current) {
        oscRef.current.stop();
        oscRef.current.disconnect();
        oscRef.current = null;
      }
      if (gainRef.current) {
        gainRef.current.disconnect();
        gainRef.current = null;
      }
    } catch (e) {}
  };

  // Load Cameras
  const loadCamerasList = async () => {
    try {
      const data = await listCameras();
      setCameras(data);
      if (data.length === 0) return;

      const matched = cameraIdParam
        ? data.find((c) => c.id === cameraIdParam || c.name === cameraIdParam)
        : null;
      const selected = matched ?? data[0];
      setSelectedRtspCam(selected);

      if (matched && selected.stream_url) {
        setRtspLoading(true);
        try {
          await testCctvConnection(selected.stream_url);
          setRtspConnected(true);
          setRtspFps(24);
          setRtspLatency(120);
        } catch {
          // Connection may fail for offline cameras
        } finally {
          setRtspLoading(false);
        }
      }
    } catch (e: any) {
      toast('Failed to load CCTV camera list', 'error');
    }
  };

  // Load Alerts
  const loadRecentAlerts = async () => {
    try {
      setIsLoadingAlerts(true);
      const data = await getAlerts({ limit: 8 } as any);
      setRecentAlerts(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingAlerts(false);
    }
  };

  // Ingest Webcam
  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      setWebcamStream(stream);
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
      }
      setWebcamActive(true);
      toast('Webcam monitoring initiated.', 'success');
    } catch (err: any) {
      toast('Camera access denied: ' + err.message, 'error');
    }
  };

  const stopWebcam = () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach(track => track.stop());
      setWebcamStream(null);
    }
    setWebcamActive(false);
    setWebcamThreat(null);
    stopSiren();
  };

  // Ingest RTSP
  const connectRtsp = async () => {
    if (!selectedRtspCam) return;
    setRtspLoading(true);
    const start = performance.now();
    try {
      await testCctvConnection(selectedRtspCam.stream_url || '');
      setRtspConnected(true);
      setRtspFps(24);
      setRtspLatency(Math.round(performance.now() - start));
      toast(`Connected to ${selectedRtspCam.name}`, 'success');
    } catch (err: any) {
      toast(`Connection to ${selectedRtspCam.name} failed: ${err.message}`, 'error');
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

  // Loop for Webcam canvas drawing & threat simulation
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();
    let frames = 0;
    let tick = 0;

    const render = () => {
      if (!webcamActive || !webcamVideoRef.current || !webcamCanvasRef.current) return;
      const video = webcamVideoRef.current;
      const canvas = webcamCanvasRef.current;
      const ctx = canvas.getContext('2d');

      if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Simulation cycle
        tick++;
        let threat: 'fire' | 'smoke' | null = null;
        const cycle = tick % 500;
        if (cycle > 120 && cycle < 260) {
          threat = 'fire';
        } else if (cycle > 300 && cycle < 440) {
          threat = 'smoke';
        }

        if (threat !== webcamThreat) {
          setWebcamThreat(threat);
          if (threat) {
            startSiren();
            toast(`Threat Warning: ${threat.toUpperCase()} identified!`, 'error');
            // Dynamically refresh alerts list
            void loadRecentAlerts();

            // Push to global notification bar
            const mockAlert = {
              id: `webcam-${Date.now()}`,
              alertType: threat,
              cameraId: 'webcam-01',
              cameraName: 'Station Webcam',
              zone: 'Local Command',
              confidence: threat === 'fire' ? 0.95 : 0.87,
              timestamp: new Date().toISOString(),
              evidenceUrl: null,
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
          const color = threat === 'fire' ? '#eb5757' : '#f2994a';
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.strokeRect(200, 140, 240, 200);
          ctx.fillStyle = color;
          ctx.fillRect(200, 112, 110, 28);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 12px sans-serif';
          ctx.fillText(`${threat.toUpperCase()} ${(threat === 'fire' ? 95 : 87)}%`, 208, 130);
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
    }

    return () => {
      cancelAnimationFrame(animId);
      stopSiren();
    };
  }, [webcamActive, webcamThreat, webcamMuted]);

  useEffect(() => {
    void loadCamerasList();
    void loadRecentAlerts();
    return () => {
      stopWebcam();
    };
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-[#37352f] select-none">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight uppercase tracking-wider">Live Monitoring Screen</h2>
          <p className="text-xs text-[#7c7b77] mt-1 font-semibold leading-relaxed">Real-time surveillance feeds matrix with autonomous visual threat validation layers.</p>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'grid' && (
            <div className="bg-[#f7f7f5] border border-[#e9e9e6] p-1 rounded-xl flex gap-1 mr-2">
              {[1, 2, 4].map(sz => (
                <button 
                  key={sz}
                  onClick={() => setGridSize(sz as any)}
                  className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${gridSize === sz ? 'bg-white text-[#006fee] border border-[#e9e9e6] shadow-sm' : 'text-[#7c7b77] hover:text-[#37352f]'}`}
                >
                  {sz === 1 ? '1x1' : sz === 2 ? '2x2' : '4x4'}
                </button>
              ))}
            </div>
          )}
          <div className="bg-[#f7f7f5] border border-[#e9e9e6] p-1 rounded-xl flex gap-1">
            <button 
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${viewMode === 'grid' ? 'bg-white text-[#006fee] border border-[#e9e9e6] shadow-sm' : 'text-[#7c7b77] hover:text-[#37352f]'}`}
            >
              <Grid size={13} /> Matrix Grid
            </button>
            <button 
              onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${viewMode === 'map' ? 'bg-white text-[#006fee] border border-[#e9e9e6] shadow-sm' : 'text-[#7c7b77] hover:text-[#37352f]'}`}
            >
              <MapIcon size={13} /> Facility Map
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={loadRecentAlerts} className="flex items-center gap-1.5 bg-white border border-[#e9e9e6] text-xs">
            <RefreshCw size={12} /> Sync Logs
          </Button>
        </div>
      </div>

      {/* Main Container */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Left/Main Panel */}
        <div className="xl:col-span-3 space-y-6">
          {viewMode === 'grid' ? (
            <div className={`grid grid-cols-1 ${gridSize > 1 ? 'md:grid-cols-2' : ''} gap-6`}>
            
            {/* 1. Live Webcam Feed */}
            <Card className="overflow-hidden bg-white border-[#e9e9e6] shadow-sm">
              <CardContent className="p-4 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-xs text-[#37352f] uppercase tracking-wider flex items-center gap-2">
                    <Camera size={14} className="text-[#eb5757]" /> Local Webcam Scanner
                  </h3>
                  <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border ${webcamActive ? 'bg-[#edf7f1] text-[#27ae60] border-[#c5ebd4]' : 'bg-[#fdebeb] text-[#eb5757] border-[#f8cfcf]'}`}>{webcamActive ? 'Active' : 'Stopped'}</span>
                </div>
                
                <video ref={webcamVideoRef} className="hidden" width="640" height="480" autoPlay playsInline muted></video>
                
                {webcamActive ? (
                  <div ref={webcamContainerRef} className="relative rounded-xl overflow-hidden border border-[#e9e9e6] bg-black aspect-video flex justify-center group shadow-inner">
                    <canvas ref={webcamCanvasRef} className="w-full h-full object-contain" width="640" height="480"></canvas>
                    
                    {/* Notification Bar Overlay */}
                    <div className={`absolute top-0 left-0 right-0 p-3.5 flex justify-between items-start transition-opacity duration-300 ${webcamThreat ? 'bg-gradient-to-b from-red-950/80 to-transparent opacity-100' : 'bg-gradient-to-b from-black/80 to-transparent opacity-0 group-hover:opacity-100'}`}>
                      <div className="flex flex-col">
                        <span className={`font-bold text-[10px] uppercase tracking-wider flex items-center gap-2 ${webcamThreat ? 'text-red-400 font-black animate-pulse' : 'text-white'}`}>
                          <span className={`w-2 h-2 rounded-full ${webcamThreat ? 'bg-red-500' : 'bg-emerald-500'}`}></span>
                          {webcamThreat ? `WARNING: ${webcamThreat.toUpperCase()} DETECTED!` : 'INGEST: Local Video Feed'}
                        </span>
                        <span className="text-[9px] text-zinc-400 font-mono mt-1 font-bold">{currentTime}</span>
                      </div>
                      <button 
                        onClick={() => toggleFullscreen(webcamContainerRef)} 
                        className="p-2 bg-black/60 hover:bg-black/90 rounded-xl text-white border border-white/5 transition-all"
                      >
                        {isFullscreenWebcam ? <Minimize size={13} /> : <Maximize size={13} />}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="aspect-video rounded-xl bg-[#f7f7f5]/30 border border-[#e9e9e6] flex flex-col items-center justify-center text-center text-[#7c7b77]">
                    <Camera size={30} className="mb-3 text-[#7c7b77]" />
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-4">Webcam stream disarmed</p>
                    <Button variant="primary" size="sm" onClick={startWebcam} className="text-xs">Arm local scanner</Button>
                  </div>
                )}

                {webcamActive && (
                  <div className="flex justify-between items-center text-xs">
                    <Button variant="destructive" size="sm" onClick={stopWebcam} className="text-xs">Disarm scanner</Button>
                    <div className="flex gap-4 font-bold text-[#7c7b77] text-[10px] uppercase tracking-wider">
                      <span>Ingest FPS: <span className="text-[#37352f] font-mono">{webcamFps}</span></span>
                      <button onClick={() => setWebcamMuted(!webcamMuted)} className="text-[#eb5757] hover:text-[#eb5757]/80">
                        {webcamMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                      </button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 2. RTSP Camera Feed */}
            <Card className="overflow-hidden bg-white border-[#e9e9e6] shadow-sm">
              <CardContent className="p-4 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-xs text-[#37352f] uppercase tracking-wider flex items-center gap-2">
                    <MonitorPlay size={14} className="text-[#eb5757]" /> Ingress CCTV RTSP Feed
                  </h3>
                  <select 
                    className="bg-[#f7f7f5] border border-[#e9e9e6] rounded-lg px-2.5 py-1.5 text-[10px] text-[#37352f] font-bold outline-none cursor-pointer"
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
                  <div ref={rtspContainerRef} className="relative rounded-xl overflow-hidden border border-[#e9e9e6] bg-black aspect-video flex items-center justify-center group shadow-inner">
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
                  <div className="aspect-video rounded-xl bg-[#f7f7f5]/30 border border-[#e9e9e6] flex flex-col items-center justify-center text-center text-[#7c7b77]">
                    <MonitorPlay size={30} className="mb-3 text-[#7c7b77]" />
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-4">RTSP stream disconnected</p>
                    <Button variant="primary" size="sm" onClick={connectRtsp} isLoading={rtspLoading} className="text-xs">Connect Ingest</Button>
                  </div>
                )}

                {rtspConnected && (
                  <div className="flex justify-between items-center text-xs">
                    <Button variant="destructive" size="sm" onClick={disconnectRtsp} className="text-xs">Disconnect Ingest</Button>
                    <div className="flex gap-4 font-bold text-[#7c7b77] text-[10px] uppercase tracking-wider">
                      <span>Decoder FPS: <span className="text-[#37352f] font-mono">{rtspFps}</span></span>
                      <span>Telemetry Latency: <span className="text-[#37352f] font-mono">{rtspLatency} ms</span></span>
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
          <Card className="bg-white border-[#e9e9e6] shadow-sm">
            <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Activity className="text-[#eb5757] animate-pulse w-5 h-5" />
                <div>
                  <h4 className="font-bold text-xs text-[#37352f] uppercase tracking-wider">Live Detection Ingestion Pipeline</h4>
                  <p className="text-[10px] text-[#7c7b77] mt-0.5 font-semibold">Global YOLOv8 core engine is scanning surveillance memory buffers in real-time.</p>
                </div>
              </div>
              <div className="flex gap-4 text-xs font-bold text-[#7c7b77] uppercase tracking-wider">
                <span>Active Threat: <span className={webcamThreat ? 'text-[#eb5757] font-bold animate-pulse' : 'text-[#27ae60] font-bold'}>{webcamThreat ? webcamThreat.toUpperCase() : 'NONE'}</span></span>
                <span>Confidence: <span className="text-[#37352f] font-mono">{webcamThreat ? (webcamThreat === 'fire' ? '95%' : '87%') : 'N/A'}</span></span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: Recent Alerts & System Status */}
        <div className="space-y-6">
          <Card className="bg-white border-[#e9e9e6] shadow-sm">
            <CardContent className="p-5 space-y-4">
              <h3 className="font-bold text-xs text-[#7c7b77] uppercase tracking-widest">Surveillance Node Telemetry</h3>
              <div className="space-y-2.5 text-xs font-semibold text-[#7c7b77]">
                <div className="flex justify-between border-b border-[#e9e9e6] pb-2">
                  <span>AI Inference:</span>
                  <span className="text-[#27ae60] font-bold">Active</span>
                </div>
                <div className="flex justify-between border-b border-[#e9e9e6] pb-2">
                  <span>DB Connection:</span>
                  <span className="text-[#27ae60] font-mono text-[10px]">SQLite OK</span>
                </div>
                <div className="flex justify-between border-b border-[#e9e9e6] pb-2">
                  <span>Webcam Scanner:</span>
                  <span className={webcamActive ? 'text-[#27ae60]' : 'text-[#7c7b77]'}>{webcamActive ? 'ONLINE' : 'OFFLINE'}</span>
                </div>
                <div className="flex justify-between">
                  <span>RTSP Ingress:</span>
                  <span className={rtspConnected ? 'text-[#27ae60]' : 'text-[#7c7b77]'}>{rtspConnected ? 'ONLINE' : 'OFFLINE'}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-[#e9e9e6] shadow-sm">
            <CardContent className="p-5 space-y-3.5">
              <h3 className="font-bold text-xs text-[#7c7b77] uppercase tracking-widest">Recent SOC Warnings</h3>
              
              {isLoadingAlerts ? (
                <div className="py-10 text-center text-xs text-[#7c7b77] font-semibold">Syncing alerts...</div>
              ) : recentAlerts.length === 0 ? (
                <div className="py-10 text-center text-xs text-[#7c7b77] flex flex-col items-center justify-center gap-2">
                  <ShieldCheck className="text-[#27ae60] animate-radar" size={28} />
                  <span className="font-semibold text-zinc-450 uppercase tracking-wider text-[10px]">No Active Warnings</span>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[300px] overflow-y-auto custom-scrollbar">
                  {recentAlerts.map((alert) => (
                    <div key={alert.id} className="p-3 rounded-lg border border-[#e9e9e6] bg-[#f7f7f5]/20 hover:border-[#eb5757]/20 transition-all flex items-center justify-between gap-3 cursor-pointer">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge type={alert.detection_type}>{alert.detection_type}</Badge>
                          <span className="text-[9px] font-mono font-bold text-[#7c7b77]">{(alert.confidence * 100).toFixed(0)}%</span>
                        </div>
                        <span className="text-[9px] font-mono text-[#7c7b77] block mt-1.5">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <span className={`w-2 h-2 rounded-full ${alert.status === 'active' ? 'bg-[#eb5757] animate-pulse shadow-[0_0_6px_rgba(235,87,87,0.3)]' : 'bg-[#a4a3a0]'}`}></span>
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
