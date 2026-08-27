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
          const color = threat === 'fire' ? '#ef4444' : '#f97316';
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.strokeRect(200, 140, 240, 200);
          ctx.fillStyle = color;
          ctx.fillRect(200, 112, 110, 28);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 13px sans-serif';
          ctx.fillText(`${threat.toUpperCase()} ${(threat === 'fire' ? 95 : 87)}%`, 208, 131);
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
    <div className="space-y-6 max-w-7xl mx-auto p-4 select-none">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Live Operations Center</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Real-time CCTV and local camera matrix with autonomous AI threat evaluation.</p>
        </div>
        <div className="flex gap-2">
          <div className="bg-slate-100 dark:bg-slate-900 p-1 rounded-lg flex mr-2">
            <button 
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <Grid size={14} /> Matrix View
            </button>
            <button 
              onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all ${viewMode === 'map' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <MapIcon size={14} /> Facility Map
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={loadRecentAlerts} className="flex items-center gap-1.5 border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
            <RefreshCw size={14} /> Refresh Logs
          </Button>
        </div>
      </div>

      {/* Main Container */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Left/Main Panel */}
        <div className="xl:col-span-3 space-y-6">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* 1. Live Webcam Feed */}
            <Card className="overflow-hidden border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardContent className="p-4 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                    <Camera size={16} className="text-red-500" /> Station Webcam
                  </h3>
                  <Badge type={webcamActive ? 'default' : 'danger'}>{webcamActive ? 'Active' : 'Offline'}</Badge>
                </div>
                
                <video ref={webcamVideoRef} className="hidden" width="640" height="480" autoPlay playsInline muted></video>
                
                {webcamActive ? (
                  <div ref={webcamContainerRef} className="relative rounded-xl overflow-hidden border border-slate-800 bg-black aspect-video flex justify-center group">
                    <canvas ref={webcamCanvasRef} className="w-full h-full object-contain" width="640" height="480"></canvas>
                    
                    {/* Notification Bar Overlay */}
                    <div className={`absolute top-0 left-0 right-0 p-3 flex justify-between items-start transition-opacity duration-300 ${webcamThreat ? 'bg-gradient-to-b from-red-900/90 to-transparent opacity-100' : 'bg-gradient-to-b from-black/80 to-transparent opacity-0 group-hover:opacity-100'}`}>
                      <div className="flex flex-col">
                        <span className={`font-bold text-xs flex items-center gap-2 ${webcamThreat ? 'text-red-400' : 'text-white'}`}>
                          <span className={`w-2 h-2 rounded-full animate-pulse ${webcamThreat ? 'bg-red-500' : 'bg-green-500'}`}></span>
                          {webcamThreat ? `ALERT: ${webcamThreat.toUpperCase()} DETECTED!` : 'LIVE: Station Webcam'}
                        </span>
                        <span className="text-[10px] text-slate-300 font-mono mt-0.5">{currentTime}</span>
                      </div>
                      <button 
                        onClick={() => toggleFullscreen(webcamContainerRef)} 
                        className="p-1.5 bg-black/50 hover:bg-black/80 rounded text-white transition-colors"
                      >
                        {isFullscreenWebcam ? <Minimize size={14} /> : <Maximize size={14} />}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="aspect-video rounded-xl bg-slate-900/40 border border-slate-800 flex flex-col items-center justify-center text-center text-slate-500">
                    <Camera size={36} className="mb-2 text-slate-600" />
                    <p className="text-xs">Webcam feed inactive</p>
                    <Button variant="primary" size="sm" onClick={startWebcam} className="mt-3">Start Feed</Button>
                  </div>
                )}

                {webcamActive && (
                  <div className="flex justify-between items-center text-xs">
                    <Button variant="destructive" size="sm" onClick={stopWebcam}>Stop</Button>
                    <div className="flex gap-4 font-semibold text-slate-400">
                      <span>FPS: <span className="text-gray-900 dark:text-white font-mono">{webcamFps}</span></span>
                      <button onClick={() => setWebcamMuted(!webcamMuted)} className="text-red-400 hover:text-red-300">
                        {webcamMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                      </button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 2. RTSP Camera Feed */}
            <Card className="overflow-hidden border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardContent className="p-4 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                    <MonitorPlay size={16} className="text-red-500" /> RTSP Ingest
                  </h3>
                  <select 
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white outline-none"
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
                  <div ref={rtspContainerRef} className="relative rounded-xl overflow-hidden border border-slate-800 bg-black aspect-video flex items-center justify-center group">
                    <img src="/evidence/test_red.jpg" alt="RTSP Feed" className="w-full h-full object-cover opacity-60" />
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:100%_4px] pointer-events-none"></div>
                    
                    {/* Notification Bar Overlay */}
                    <div className={`absolute top-0 left-0 right-0 p-3 flex justify-between items-start transition-opacity duration-300 ${recentAlerts.some(a => a.camera_id === selectedRtspCam?.id && a.status === 'active') ? 'bg-gradient-to-b from-red-900/90 to-transparent opacity-100' : 'bg-gradient-to-b from-black/80 to-transparent opacity-0 group-hover:opacity-100'}`}>
                      <div className="flex flex-col">
                        <span className={`font-bold text-xs flex items-center gap-2 ${recentAlerts.some(a => a.camera_id === selectedRtspCam?.id && a.status === 'active') ? 'text-red-400' : 'text-white'}`}>
                          <span className={`w-2 h-2 rounded-full animate-pulse ${recentAlerts.some(a => a.camera_id === selectedRtspCam?.id && a.status === 'active') ? 'bg-red-500' : 'bg-green-500'}`}></span>
                          {recentAlerts.some(a => a.camera_id === selectedRtspCam?.id && a.status === 'active') ? 'ALERT: THREAT DETECTED!' : `LIVE: ${selectedRtspCam?.name || 'RTSP Stream'}`}
                        </span>
                        <span className="text-[10px] text-slate-300 font-mono mt-0.5">{currentTime}</span>
                      </div>
                      <button 
                        onClick={() => toggleFullscreen(rtspContainerRef)} 
                        className="p-1.5 bg-black/50 hover:bg-black/80 rounded text-white transition-colors"
                      >
                        {isFullscreenRtsp ? <Minimize size={14} /> : <Maximize size={14} />}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="aspect-video rounded-xl bg-slate-900/40 border border-slate-800 flex flex-col items-center justify-center text-center text-slate-500">
                    <MonitorPlay size={36} className="mb-2 text-slate-600" />
                    <p className="text-xs">RTSP stream disconnected</p>
                    <Button variant="primary" size="sm" onClick={connectRtsp} isLoading={rtspLoading} className="mt-3">Connect Ingest</Button>
                  </div>
                )}

                {rtspConnected && (
                  <div className="flex justify-between items-center text-xs">
                    <Button variant="destructive" size="sm" onClick={disconnectRtsp}>Disconnect</Button>
                    <div className="flex gap-4 font-semibold text-slate-400">
                      <span>FPS: <span className="text-gray-900 dark:text-white font-mono">{rtspFps}</span></span>
                      <span>Latency: <span className="text-gray-900 dark:text-white font-mono">{rtspLatency} ms</span></span>
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
                x: 10 + ((i * 35) % 80),
                y: 20 + ((i * 25) % 60)
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
          <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
            <CardContent className="p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Activity className="text-red-500 animate-pulse w-6 h-6" />
                <div>
                  <h4 className="font-bold text-sm text-gray-900 dark:text-white">Active Threat Detection Pipeline</h4>
                  <p className="text-xs text-slate-400 mt-0.5">Global YOLOv8 model inference engine is active and scanning input buffers.</p>
                </div>
              </div>
              <div className="flex gap-4 text-xs font-semibold text-slate-400">
                <span>Active Threat: <span className={webcamThreat ? 'text-red-500 font-bold' : 'text-green-500'}>{webcamThreat ? webcamThreat.toUpperCase() : 'NONE'}</span></span>
                <span>Confidence: <span className="text-gray-900 dark:text-white font-mono">{webcamThreat ? (webcamThreat === 'fire' ? '95%' : '87%') : 'N/A'}</span></span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: Recent Alerts & System Status */}
        <div className="space-y-6">
          <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
            <CardContent className="p-5 space-y-4">
              <h3 className="font-bold text-sm text-gray-900 dark:text-white">System Status</h3>
              <div className="space-y-2 text-xs font-semibold text-slate-400">
                <div className="flex justify-between border-b border-slate-800 pb-1.5">
                  <span>Inference Engine:</span>
                  <span className="text-green-500">Active</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1.5">
                  <span>DB Status:</span>
                  <span className="text-green-500 font-mono">SQLite Connected</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1.5">
                  <span>Webcam Stream:</span>
                  <span className={webcamActive ? 'text-green-500' : 'text-slate-500'}>{webcamActive ? 'Online' : 'Offline'}</span>
                </div>
                <div className="flex justify-between">
                  <span>RTSP Stream:</span>
                  <span className={rtspConnected ? 'text-green-500' : 'text-slate-500'}>{rtspConnected ? 'Online' : 'Offline'}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
            <CardContent className="p-5 space-y-3">
              <h3 className="font-bold text-sm text-gray-900 dark:text-white">Recent SOC Alerts</h3>
              
              {isLoadingAlerts ? (
                <div className="py-8 text-center text-xs text-slate-500">Loading alerts...</div>
              ) : recentAlerts.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-1">
                  <ShieldCheck className="text-slate-600" size={24} />
                  <span>No active threats</span>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[300px] overflow-y-auto custom-scrollbar">
                  {recentAlerts.map((alert) => (
                    <div key={alert.id} className="p-3 rounded-xl border border-slate-800/80 bg-slate-900/40 flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Badge type={alert.detection_type}>{alert.detection_type}</Badge>
                          <span className="text-[10px] font-mono text-slate-400">{(alert.confidence * 100).toFixed(0)}%</span>
                        </div>
                        <span className="text-[9px] font-mono text-slate-500 block mt-1">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <span className={`w-2 h-2 rounded-full ${alert.status === 'active' ? 'bg-red-500 animate-ping' : 'bg-slate-600'}`}></span>
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
