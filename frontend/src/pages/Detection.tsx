import { useState, useRef, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useToast } from '../components/ui/Toast';
import { uploadImage, uploadVideoAsync, getVideoJobStatus, cancelVideoJob, connectVideoStreamSocket, getVideoMjpegStreamUrl, testCctvConnection, getSettings, evidenceUrl } from '../services/api';
import { RtspStreamPlayer } from '../components/Common/RtspStreamPlayer';

import { useAuthStore } from '../store/authStore';
import { useNotificationsStore } from '../store/notificationsStore';
import { useAlertSound } from '../components/SOC/AlertSound';
import {
  UploadCloud, FileVideo, Camera, MonitorPlay,
  RefreshCw, Download, XCircle, Activity, Cpu, Zap, Sliders,
  Volume2, VolumeX, Image as ImageIcon, Film, AlertTriangle,
  CheckCircle, Wifi, WifiOff
} from 'lucide-react';

const fadeUp = {
  hidden: { y: 8, opacity: 0 },
  show: { y: 0, opacity: 1, transition: { duration: 0.18 } }
};

const getConfidenceTier = (c: number) => {
  if (c >= 0.80) return { label: 'High Confidence', risk: 'CRITICAL', color: 'text-[var(--fire)]', bg: 'bg-[var(--fire-bg)] border-[var(--fire-border)]' };
  if (c >= 0.60) return { label: 'Medium Confidence', risk: 'HIGH', color: 'text-[var(--smoke)]', bg: 'bg-[var(--smoke-bg)] border-[var(--smoke-border)]' };
  return { label: 'Low Confidence', risk: 'REVIEW', color: 'text-[var(--text-2)]', bg: 'bg-[var(--surface-2)] border-[var(--border)]' };
};

const TABS = [
  { id: 'image',  label: 'Image Upload',   icon: ImageIcon },
  { id: 'video',  label: 'Video Upload',   icon: Film },
  { id: 'webcam', label: 'Continuous Webcam',  icon: Camera },
  { id: 'rtsp',   label: 'RTSP Connection',    icon: MonitorPlay },
];

const Detection = () => {
  const { toast } = useToast();
  const { play: playAlertChime, startSiren, stopSiren } = useAlertSound();
  const [activeTab, setActiveTab] = useState<'image' | 'video' | 'webcam' | 'rtsp'>('image');

  const currentUser = useAuthStore(s => s.currentUser);
  const addNotification = useNotificationsStore(s => s.addNotification);
  const pushPopup = useNotificationsStore(s => s.pushPopup);

  const isOperatorOrAdmin = useMemo(() => {
    const r = (currentUser?.role || '').toLowerCase();
    return r === 'admin' || r === 'administrator' || r === 'operator';
  }, [currentUser]);

  // ── Image ──
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [imgResult, setImgResult] = useState<any>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgLatency, setImgLatency] = useState<number | null>(null);

  const handleImgDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) {
      setImgFile(file);
      setImgPreview(URL.createObjectURL(file));
      setImgResult(null);
    }
  };

  const runImageInference = async () => {
    if (!imgFile) return;
    setImgLoading(true);
    const t0 = performance.now();
    try {
      const res = await uploadImage(imgFile);
      setImgResult(res);
      setImgLatency(Math.round(performance.now() - t0));
      if (res.detections?.length > 0) {
        // Play alert sound on detection
        if (!mutedRef.current) void playAlertChime();
        const types = res.detections.map((d: any) => d.detection_type).join(', ');
        toast(`⚠ Detected: ${types.toUpperCase()}`, 'error');
        const item = {
          id: `img-det-${Date.now()}`,
          alertType: res.detections[0].detection_type,
          cameraId: 'CAM-UPLOAD',
          cameraName: 'Image Upload',
          zone: 'Upload',
          confidence: Math.max(...res.detections.map((d: any) => d.confidence)),
          timestamp: new Date().toISOString(),
          severity: res.detections.some((d: any) => d.detection_type === 'fire') ? 'critical' : 'warning',
          isRead: false,
        } as any;
        addNotification(item);
        pushPopup(item);
      } else {
        toast('✓ No fire or smoke detected', 'success');
      }
    } catch (e: any) {
      toast(e.message || 'Analysis failed', 'error');
    } finally {
      setImgLoading(false);
    }
  };

  // ── Video ──
  const vidInputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<HTMLVideoElement>(null);
  const [vidFile, setVidFile] = useState<File | null>(null);
  const [vidResult, setVidResult] = useState<any>(null);
  const [vidLoading, setVidLoading] = useState(false);
  const [vidLatency, setVidLatency] = useState<number | null>(null);
  const [vidProgress, setVidProgress] = useState(0);
  const [vidJobId, setVidJobId] = useState<string | null>(null);
  const [vidJobStatus, setVidJobStatus] = useState<string>('idle');
  const [vidLivePreviewB64, setVidLivePreviewB64] = useState<string | null>(null); // Kept for WS-based small telemetry preview
  const [vidMjpegUrl, setVidMjpegUrl] = useState<string | null>(null); // MJPEG stream URL for live playback
  const [vidTimelineEvents, setVidTimelineEvents] = useState<Array<any>>([]);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const lastPopupTimeRef = useRef<number>(0);

  const [vidTelemetry, setVidTelemetry] = useState({
    fps: 0,
    inference_fps: 0,
    avg_latency_ms: 0,
    skipped_frames: 0,
    active_tracks: 0,
    current_frame: 0,
    total_frames: 0,
    eta_sec: 0,
  });

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('sentinel_video_analysis_cache');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.vidResult) setVidResult(parsed.vidResult);
        if (parsed.vidTelemetry) setVidTelemetry(parsed.vidTelemetry);
        if (parsed.vidTimelineEvents) setVidTimelineEvents(parsed.vidTimelineEvents);
        if (parsed.vidLatency) setVidLatency(parsed.vidLatency);
        if (parsed.vidLivePreviewB64) setVidLivePreviewB64(parsed.vidLivePreviewB64);
        if (parsed.fileName) setVidFile(new File([], parsed.fileName));
      }
    } catch { /**/ }
  }, []);

  const saveVideoCache = (res: any, telemetry: any, timeline: any, latency: number | null, preview: string | null, fName: string) => {
    try {
      sessionStorage.setItem('sentinel_video_analysis_cache', JSON.stringify({
        vidResult: res,
        vidTelemetry: telemetry,
        vidTimelineEvents: timeline,
        vidLatency: latency,
        vidLivePreviewB64: preview,
        fileName: fName
      }));
    } catch { /**/ }
  };

  const clearVideoCache = () => {
    try {
      sessionStorage.removeItem('sentinel_video_analysis_cache');
    } catch { /**/ }
    setVidResult(null);
    setVidFile(null);
    setVidJobStatus('idle');
    setVidProgress(0);
    setVidLivePreviewB64(null);
    setVidMjpegUrl(null);
    setVidTimelineEvents([]);
  };

  const [videoMode, setVideoMode] = useState<'Real-Time' | 'Accuracy' | 'Debug'>('Real-Time');
  const [videoMeta, setVideoMeta] = useState<any>(null);

  const handleStepFrame = (delta: number) => {
    if (!playerRef.current) return;
    const fps = vidTelemetry.fps || videoMeta?.fps || 25.0;
    playerRef.current.pause();
    playerRef.current.currentTime = Math.max(0, playerRef.current.currentTime + (delta / fps));
  };

  const handleRestartVideo = () => {
    if (!playerRef.current) return;
    playerRef.current.currentTime = 0;
    playerRef.current.play().catch(() => {});
  };

  const runVideoInference = async () => {
    if (!vidFile) return;
    setVidLoading(true);
    setVidProgress(1);
    setVidTimelineEvents([]);
    setVidResult(null);
    setVidJobStatus('processing');
    setVidLivePreviewB64(null);
    setVidMjpegUrl(null);
    const t0 = performance.now();

    try {
      const init = await uploadVideoAsync(vidFile, videoMode);
      const jobId = init.job_id;
      setVidJobId(jobId);
      if (init.metadata) setVideoMeta(init.metadata);

      // Immediately set MJPEG stream URL — browser starts receiving frames as they are processed
      const mjpegUrl = getVideoMjpegStreamUrl(jobId);
      setVidMjpegUrl(mjpegUrl);

      const pollTimer = setInterval(async () => {
        try {
          const status = await getVideoJobStatus(jobId);
          if (status) {
            setVidProgress(status.progress_pct || 0);
            if (status.metadata) setVideoMeta(status.metadata);
            if (status.latest_preview) {
              setVidLivePreviewB64(`data:image/jpeg;base64,${status.latest_preview}`);
            }
            if (status.status === 'completed' || status.progress_pct >= 100) {
              clearInterval(pollTimer);
              stopSiren();
              setVidProgress(100);
              setVidJobStatus('completed');
              setVidResult(status);
              const computedLatency = Math.round(performance.now() - t0);
              setVidLatency(computedLatency);
              saveVideoCache(status, vidTelemetry, vidTimelineEvents, computedLatency, vidLivePreviewB64, vidFile.name);
              setVidLoading(false);
            } else if (status.status === 'cancelled' || status.status === 'failed') {
              clearInterval(pollTimer);
              setVidLoading(false);
              setVidJobStatus(status.status);
            }
          }
        } catch { /* ignore */ }
      }, 1000);

      const ws = connectVideoStreamSocket(jobId, (msg: any) => {
        if (msg.event === 'frame_update' || msg.type === 'frame') {
          setVidProgress(msg.progress_pct || 0);
          if (msg.metadata) setVideoMeta(msg.metadata);
          if (msg.preview_b64) {
            setVidLivePreviewB64(`data:image/jpeg;base64,${msg.preview_b64}`);
          }
          setVidTelemetry({
            fps: msg.fps || 0,
            inference_fps: msg.inference_fps || msg.fps || 0,
            avg_latency_ms: msg.avg_latency_ms || 0,
            skipped_frames: msg.skipped_frames || 0,
            active_tracks: msg.active_tracks_count || 0,
            current_frame: msg.frame_number || 0,
            total_frames: msg.total_frames || 0,
            eta_sec: msg.eta_sec || 0,
          });

          if (msg.detections && msg.detections.length > 0) {
            setVidTimelineEvents(prev => {
              if (prev.some((e) => Math.abs(e.timestamp_sec - msg.timestamp_sec) < 0.8)) return prev;
              return [
                ...prev,
                {
                  timestamp_sec: msg.timestamp_sec,
                  type: msg.detections[0].detection_type,
                  confidence: Math.max(...msg.detections.map((d: any) => d.confidence)),
                }
              ];
            });
          }

          if ((msg.continuous_alarm || (msg.consecutive_threat_frames && msg.consecutive_threat_frames >= 15)) && !mutedRef.current) {
            startSiren();
          }

          const now = Date.now();
          if ((msg.continuous_alarm || msg.early_threat || (msg.consecutive_threat_frames && msg.consecutive_threat_frames >= 10)) && (now - lastPopupTimeRef.current > 2500)) {
            lastPopupTimeRef.current = now;
            toast(`🚨 CRITICAL THREAT: ${msg.early_threat?.toUpperCase() || 'FIRE'} detected continuously!`, 'error');
            const alertItem = {
              id: `vid-threat-${now}`,
              alertType: msg.early_threat || 'fire',
              cameraId: 'CAM-VIDEO',
              cameraName: 'Video Stream Analysis',
              zone: 'Upload Feed',
              confidence: 0.95,
              timestamp: new Date().toISOString(),
              severity: 'critical',
              isRead: false,
            } as any;
            addNotification(alertItem);
            pushPopup(alertItem);
          }
        } else if (msg.event === 'completed' || msg.type === 'completed') {
          clearInterval(pollTimer);
          stopSiren();
          setVidProgress(100);
          setVidJobStatus('completed');
          setVidResult(msg);
          if (msg.metadata) setVideoMeta(msg.metadata);
          const computedLatency = Math.round(performance.now() - t0);
          setVidLatency(computedLatency);
          if (msg.has_detections) {
            if (!mutedRef.current) void playAlertChime();
            toast(`⚠ Video analysis complete: threats detected`, 'error');
          } else {
            toast('✓ Video analysis complete — no threats detected', 'success');
          }
          saveVideoCache(msg, vidTelemetry, vidTimelineEvents, computedLatency, vidLivePreviewB64, vidFile.name);
          setVidLoading(false);
          ws.close();
        } else if (msg.event === 'cancelled' || msg.type === 'cancelled') {
          clearInterval(pollTimer);
          stopSiren();
          setVidJobStatus('cancelled');
          toast('Video processing cancelled by user', 'info');
          setVidLoading(false);
          ws.close();
        }
      });
    } catch (e: any) {
      toast(e.message || 'Video upload failed', 'error');
      setVidLoading(false);
      setVidJobStatus('failed');
    }
  };

  const handleCancelVideoJob = async () => {
    if (!vidJobId) return;
    try {
      await cancelVideoJob(vidJobId);
      setVidJobStatus('cancelled');
      setVidLoading(false);
      toast('Job cancellation requested', 'info');
    } catch (e: any) {
      toast('Failed to cancel job: ' + e.message, 'error');
    }
  };

  // ── Webcam ──
  const webVideoRef = useRef<HTMLVideoElement>(null);
  const webCanvasRef = useRef<HTMLCanvasElement>(null);
  const [webStream, setWebStream] = useState<MediaStream | null>(null);
  const [webState, setWebState] = useState<'stopped' | 'running' | 'paused'>('stopped');
  const [webThreat, setWebThreat] = useState<'fire' | 'smoke' | 'sparks' | null>(null);
  const [webFps, setWebFps] = useState(0);
  const [muted, setMuted] = useState(true);
  const [simulationMode, setSimulationMode] = useState(false);
  const [detections, setDetections] = useState<any[]>([]);
  const [frameSkip, setFrameSkip] = useState(2);

  const fetchSettings = async () => {
    try {
      const res = await getSettings();
      const skip = res.find((s: any) => s.id === 'frame_skip')?.value;
      if (skip) setFrameSkip(parseInt(skip));
    } catch { /* ignore */ }
  };

  const startWebcam = async () => {
    try {
      await fetchSettings();
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      setWebStream(s);
      if (webVideoRef.current) webVideoRef.current.srcObject = s;
      setWebState('running');
      toast('Webcam started', 'success');
    } catch (e: any) { 
      toast('Camera access denied: ' + e.message, 'error'); 
    }
  };

  const stopWebcam = () => {
    webStream?.getTracks().forEach(t => t.stop());
    setWebStream(null);
    setWebState('stopped');
    setWebThreat(null);
    setDetections([]);
    detectionsRef.current = [];
  };

  const simModeRef = useRef(simulationMode);
  useEffect(() => { simModeRef.current = simulationMode; }, [simulationMode]);
  const frameSkipRef = useRef(frameSkip);
  useEffect(() => { frameSkipRef.current = frameSkip; }, [frameSkip]);
  const webThreatRef = useRef(webThreat);
  useEffect(() => { webThreatRef.current = webThreat; }, [webThreat]);
  const detectionsRef = useRef(detections);
  useEffect(() => { detectionsRef.current = detections; }, [detections]);
  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  useEffect(() => {
    let raf: number;
    let last = performance.now();
    let f = 0, tick = 0;
    let isProcessing = false;

    const loop = () => {
      if (webState !== 'running' || !webVideoRef.current || !webCanvasRef.current) return;
      const v = webVideoRef.current, c = webCanvasRef.current;
      const ctx = c.getContext('2d');
      if (ctx && v.readyState === v.HAVE_ENOUGH_DATA) {
        ctx.drawImage(v, 0, 0, c.width, c.height);
        tick++;

        // Simulation Mode
        if (simModeRef.current) {
          const cycle = tick % 600;
          let threat: 'fire' | 'smoke' | 'sparks' | null = null;
          if (cycle > 120 && cycle < 280) threat = 'fire';
          else if (cycle > 340 && cycle < 500) threat = 'smoke';

          if (threat !== webThreatRef.current) {
            setWebThreat(threat);
            if (threat) {
              if (!mutedRef.current) void playAlertChime();
              toast(`${threat.toUpperCase()} warning identified (Simulation)`, 'error');

              const mockAlert = {
                id: `wc-det-${Date.now()}`,
                alertType: threat,
                cameraId: 'webcam-01',
                cameraName: 'Station Webcam',
                zone: 'Local Command',
                confidence: threat === 'fire' ? 0.95 : 0.87,
                timestamp: new Date().toISOString(),
                severity: threat === 'fire' ? 'critical' : 'warning',
                isRead: false,
              } as any;
              addNotification(mockAlert);
              pushPopup(mockAlert);
            }
          }

          if (threat) {
            const mockDets = [{
              detection_type: threat,
              confidence: threat === 'fire' ? 0.95 : 0.87,
              bbox: { x1: 180, y1: 120, x2: 460, y2: 340 }
            }];
            detectionsRef.current = mockDets;
            setDetections(mockDets);
          } else {
            detectionsRef.current = [];
            setDetections([]);
          }
        }
        // Real AI Mode
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
                  if (threat !== webThreatRef.current) {
                    setWebThreat(threat);
                    if (!mutedRef.current) void playAlertChime();

                    const newAlert = {
                      id: res.alert_ids?.[0] || `wc-det-${Date.now()}`,
                      alertType: threat,
                      cameraId: 'webcam-01',
                      cameraName: 'Station Webcam',
                      zone: 'Local Command',
                      confidence: Math.max(...res.detections.map((d: any) => d.confidence)),
                      timestamp: new Date().toISOString(),
                      severity: threat === 'fire' ? 'critical' : 'warning',
                      isRead: false
                    } as any;
                    addNotification(newAlert);
                    pushPopup(newAlert);
                  }
                } else {
                  if (webThreatRef.current) {
                    setWebThreat(null);
                  }
                }
              }
            } catch (err) {
              console.error("Webcam inference error:", err);
            } finally {
              isProcessing = false;
            }
          }, 'image/jpeg', 0.85);
        }

        // Draw bounding boxes (Red for fire, Orange for smoke, Gold for sparks)
        if (detectionsRef.current && detectionsRef.current.length > 0) {
          detectionsRef.current.forEach((det: any) => {
            const isSparks = det.detection_type === 'sparks' || det.detection_type === 'spark';
            const col = det.detection_type === 'fire' ? '#e5484d' : (isSparks ? '#f59e0b' : '#e79020');
            ctx.strokeStyle = col;
            ctx.lineWidth = 2.5;

            const { x1, y1, x2, y2 } = det.bbox;
            const width = x2 - x1;
            const height = y2 - y1;
            ctx.strokeRect(x1, y1, width, height);

            const badgeText = `${det.detection_type.toUpperCase()} ${Math.round(det.confidence * 100)}%`;
            ctx.font = 'bold 11px sans-serif';
            const textWidth = ctx.measureText(badgeText).width + 16;
            ctx.fillStyle = col;
            ctx.fillRect(x1, y1 - 25 > 0 ? y1 - 25 : y1, textWidth, 22);

            ctx.fillStyle = '#fff';
            ctx.fillText(badgeText, x1 + 8, (y1 - 25 > 0 ? y1 - 25 : y1) + 15);
          });
        }

        f++;
        const now = performance.now();
        if (now - last >= 1000) { setWebFps(f); f = 0; last = now; }
      }
      raf = requestAnimationFrame(loop);
    };
    if (webState === 'running') raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); };
  }, [webState]);

  useEffect(() => () => stopWebcam(), []);

  // ── RTSP ──
  const [rtspUrl, setRtspUrl] = useState('rtsp://192.168.1.100:554/live');
  const [rtspConn, setRtspConn] = useState(false);
  const [rtspLoading, setRtspLoading] = useState(false);
  const [rtspLatency, setRtspLatency] = useState<number | null>(null);

  const activeRtspUrlRef = useRef<string | null>(null);

  const connectRtsp = async () => {
    if (rtspConn) {
      setRtspConn(false);
      setRtspLatency(null);
      activeRtspUrlRef.current = null;
      return;
    }

    setRtspLoading(true);
    const t0 = performance.now();
    try {
      const res = await testCctvConnection(rtspUrl);
      setRtspConn(true);
      setRtspLatency(Math.round(performance.now() - t0));
      activeRtspUrlRef.current = rtspUrl;
      toast(res.message || 'RTSP Relaying connected successfully', 'success');
    } catch (e: any) {
      toast(e.message || 'RTSP Connection handshake failed', 'error');
    } finally { setRtspLoading(false); }
  };

  return (
    <motion.div className="space-y-6 text-[var(--text)] font-sans" initial="hidden" animate="show" variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } }}>

      {/* Header */}
      <motion.div variants={fadeUp}>
        <h1 className="text-[22px] font-bold tracking-tight text-[var(--text)]">Detection Command Center</h1>
        <p className="text-[13px] text-[var(--text-2)] mt-0.5 font-semibold">AI-powered fire & smoke analysis feeds — upload media, stream webcams, or link remote RTSP relays</p>
      </motion.div>

      {/* Tabs */}
      <motion.div variants={fadeUp} className="flex items-center gap-1 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-1 w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => { stopWebcam(); setActiveTab(tab.id as any); }}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                active 
                  ? 'bg-[var(--color-accent)] text-white shadow-sm' 
                  : 'text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)]'
              }`}
            >
              <Icon size={13} className={active ? 'text-white' : 'text-[var(--color-muted)]'} />
              {tab.label}
            </button>
          );
        })}
      </motion.div>

      {/* Content */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Main panel — 3 cols */}
        <div className="lg:col-span-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-xs flex flex-col justify-between">
          <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-2)] flex justify-between items-center">
            <p className="text-[13px] font-bold text-[var(--text)] uppercase tracking-wider">
              {activeTab === 'image' && 'Image Ingest analysis'}
              {activeTab === 'video' && 'Video Frame scanning'}
              {activeTab === 'webcam' && 'Webcam continuous monitor'}
              {activeTab === 'rtsp' && 'RTSP feed link'}
            </p>
          </div>

          <div className="p-5 space-y-5 flex-1">

            {/* IMAGE */}
            {activeTab === 'image' && (
              <div className="space-y-5">
                <div
                  onClick={() => !imgLoading && imgInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={handleImgDrop}
                  className={`border-2 border-dashed rounded-2xl p-6 transition-all duration-300 cursor-pointer text-center ${
                    imgPreview 
                      ? 'border-slate-200 bg-white' 
                      : 'border-slate-200 dark:border-slate-700 hover:border-sky-300 dark:hover:border-sky-800 bg-slate-50/30 dark:bg-slate-900/30 hover:bg-sky-50/10'
                  }`}
                >
                  <input type="file" ref={imgInputRef} className="hidden" accept="image/*" onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) { setImgFile(f); setImgPreview(URL.createObjectURL(f)); setImgResult(null); }
                  }} />
                  {imgPreview ? (
                    <div className="p-4 flex flex-col items-center">
                      <img src={imgPreview} alt="Preview" className="max-h-72 rounded-lg object-contain border border-[var(--border)] bg-[var(--bg)]" />
                      <p className="text-[11px] text-[var(--text-3)] font-mono mt-3">{imgFile?.name}</p>
                    </div>
                  ) : (
                    <div className="py-14 flex flex-col items-center gap-3 select-none">
                      <div className="w-12 h-12 rounded-full bg-sky-50 dark:bg-sky-950/30 flex items-center justify-center text-sky-600 dark:text-sky-400 mb-3 shadow-xs">
                        <UploadCloud size={20} />
                      </div>
                      <div className="text-center">
                        <p className="text-[13px] font-bold text-[var(--text)]">Drop image here or click to browse</p>
                        <p className="text-[11px] text-[var(--text-3)] font-medium mt-1">PNG, JPG, WEBP formats up to 10MB</p>
                      </div>
                    </div>
                  )}
                </div>

                {imgFile && !imgLoading && (
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setImgFile(null); setImgPreview(null); setImgResult(null); }} className="px-3.5 py-2 border border-[var(--border)] rounded-xl text-[12px] font-bold text-[var(--text-2)] hover:bg-[var(--surface-hover)] transition-all cursor-pointer">
                      Clear
                    </button>
                    <button onClick={runImageInference} className="px-4.5 py-2 bg-sky-600 text-white text-[12px] font-bold rounded-xl hover:bg-sky-700 transition-all cursor-pointer shadow-xs">
                      Analyze Image
                    </button>
                  </div>
                )}

                {imgLoading && (
                  <div className="flex items-center justify-center py-12 gap-3">
                    <RefreshCw size={18} className="animate-spin text-sky-600" />
                    <p className="text-[13px] text-[var(--text-2)] font-bold">Running FireGuard AI inference...</p>
                  </div>
                )}

                {imgResult && (
                  <div className="space-y-3 pt-4 border-t border-[var(--border)]">
                    <div className="flex justify-between items-center text-[11px] font-bold text-[var(--text-3)] uppercase tracking-wider">
                      <span>Result</span>
                      {imgLatency && <span>Inference Time: {imgLatency}ms</span>}
                    </div>
                    {imgResult.evidence_path ? (
                      <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg)]">
                        <img src={evidenceUrl(imgResult.evidence_path) || ''} alt="Detection result" className="w-full object-contain" />
                        <a
                          href={evidenceUrl(imgResult.evidence_path) || ''}
                          download="detection_result.jpg"
                          className="absolute top-3 right-3 flex items-center gap-1.5 bg-[var(--surface)] border border-[var(--border)] px-3.5 py-2 rounded-xl text-[11px] font-bold text-[var(--text)] shadow-xs hover:bg-[var(--surface-hover)] transition-all cursor-pointer"
                        >
                          <Download size={12} /> Download
                        </a>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 py-8 text-[var(--safe-text)] bg-[var(--safe-bg)] border border-[var(--safe-border)] rounded-xl">
                        <CheckCircle size={16} />
                        <span className="text-[13px] font-bold">No fire or smoke anomalies detected</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* VIDEO */}
            {activeTab === 'video' && (
              <div className="space-y-5">
                {/* Mode Selector & Strategy */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--surface-2)] p-3 rounded-xl border border-[var(--border)]">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-3)]">Processing Mode:</span>
                    <div className="flex rounded-lg bg-[var(--surface)] p-0.5 border border-[var(--border)]">
                      {(['Real-Time', 'Accuracy', 'Debug'] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setVideoMode(mode)}
                          className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                            videoMode === mode
                              ? 'bg-[var(--primary)] text-white shadow-xs'
                              : 'text-[var(--text-2)] hover:text-[var(--text)]'
                          }`}
                        >
                          {mode === 'Real-Time' && '⚡ Real-Time'}
                          {mode === 'Accuracy' && '🎯 Accuracy (960p)'}
                          {mode === 'Debug' && '🛠 Debug HUD'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="text-[10px] text-[var(--text-3)] font-mono">
                    {videoMode === 'Real-Time' && 'Optimized 640p letterbox with low latency'}
                    {videoMode === 'Accuracy' && 'High-res 960p inference for small/distant fire & smoke'}
                    {videoMode === 'Debug' && 'Full CV telemetry + bounding box inspector'}
                  </div>
                </div>

                <div
                  onClick={() => !vidLoading && vidInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 transition-all duration-300 cursor-pointer text-center ${
                    vidFile 
                      ? 'border-slate-200 bg-white dark:bg-slate-900/60 dark:border-slate-800' 
                      : 'border-slate-200 dark:border-slate-700 hover:border-sky-300 dark:hover:border-sky-800 bg-slate-50/30 dark:bg-slate-900/30 hover:bg-sky-50/10'
                  }`}
                >
                  <input type="file" ref={vidInputRef} className="hidden" accept="video/*" onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) { setVidFile(f); setVidResult(null); setVidProgress(0); setVidLivePreviewB64(null); setVidTimelineEvents([]); setVideoMeta(null); }
                  }} />
                  {vidFile ? (
                    <div className="py-4 flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-full bg-sky-50 dark:bg-sky-950/30 flex items-center justify-center text-sky-600 dark:text-sky-400 mb-1 shadow-xs">
                        <FileVideo size={20} />
                      </div>
                      <div className="text-center">
                        <p className="text-[13px] font-bold text-[var(--text)] truncate max-w-xs">{vidFile.name}</p>
                        <p className="text-[11px] text-[var(--text-3)] font-medium mt-0.5">{(vidFile.size / 1048576).toFixed(2)} MB</p>
                      </div>
                      {videoMeta && (
                        <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                          <span className="text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[var(--text-2)] border border-[var(--border)]">
                            {videoMeta.width}x{videoMeta.height}
                          </span>
                          <span className="text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[var(--text-2)] border border-[var(--border)]">
                            {videoMeta.fps} FPS
                          </span>
                          <span className="text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[var(--text-2)] border border-[var(--border)]">
                            {videoMeta.total_frames || videoMeta.frame_count} Frames ({videoMeta.duration_sec?.toFixed(1) || videoMeta.duration?.toFixed(1)}s)
                          </span>
                          {videoMeta.codec && (
                            <span className="text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[var(--text-2)] border border-[var(--border)]">
                              Codec: {videoMeta.codec}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-12 flex flex-col items-center gap-3 select-none">
                      <div className="w-12 h-12 rounded-full bg-sky-50 dark:bg-sky-950/30 flex items-center justify-center text-sky-600 dark:text-sky-400 mb-2 shadow-xs">
                        <UploadCloud size={20} />
                      </div>
                      <div className="text-center">
                        <p className="text-[13px] font-bold text-[var(--text)]">Drop video file here or click to browse</p>
                        <p className="text-[11px] text-[var(--text-3)] font-medium mt-1">MP4, AVI, MOV, MKV formats up to 50MB</p>
                      </div>
                    </div>
                  )}
                </div>

                {vidFile && !vidLoading && vidJobStatus !== 'processing' && (
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setVidFile(null); setVidResult(null); setVidProgress(0); setVidLivePreviewB64(null); setVideoMeta(null); }} className="px-3 py-2 border border-[var(--border)] rounded-lg text-[12px] font-bold text-[var(--text-2)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer">
                      Clear
                    </button>
                    <button onClick={runVideoInference} className="px-4 py-2 bg-[var(--primary)] text-white text-[12px] font-bold rounded-lg hover:bg-[var(--primary-hover)] transition-colors cursor-pointer shadow-sm flex items-center gap-1.5">
                      <Play size={13} />
                      Start {videoMode} Analysis
                    </button>
                  </div>
                )}

                {/* LIVE PREVIEW, TELEMETRY HUD & RESULTS */}
                {(vidLoading || vidResult !== null) && (
                  <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/90 p-4 shadow-xl text-slate-100">
                    <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-2">
                      <div className="flex items-center gap-2">
                        {vidLoading ? (
                          <>
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                            <span className="font-bold text-emerald-400">ByteTrack AI Stream Processing ({videoMode})</span>
                          </>
                        ) : (
                          <>
                            <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                            <span className="font-bold text-sky-400">Analysis Results Ready</span>
                          </>
                        )}
                        {vidJobId && <span className="text-[10px] text-slate-500 font-mono">Job: {vidJobId}</span>}
                      </div>

                      {vidLoading ? (
                        <button
                          onClick={handleCancelVideoJob}
                          className="flex items-center gap-1.5 px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold transition-all cursor-pointer"
                        >
                          <XCircle size={14} /> Cancel Analysis
                        </button>
                      ) : (
                        <button
                          onClick={clearVideoCache}
                          className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                        >
                          <XCircle size={14} /> Close Results
                        </button>
                      )}
                    </div>

                    {/* LIVE CCTV STREAM OR COMPLETED ANNOTATED VIDEO PLAYER */}
                    {(() => {
                      const displayTotal = vidTelemetry.total_frames || videoMeta?.total_frames || videoMeta?.frame_count || vidResult?.total_frames || vidResult?.events?.length || 100;
                      const displayCurrent = (vidProgress === 100 || vidJobStatus === 'completed' || !vidLoading)
                        ? displayTotal
                        : (vidTelemetry.current_frame || 1);
                      const displaySkipped = vidTelemetry.skipped_frames !== undefined && vidTelemetry.skipped_frames > 0
                        ? vidTelemetry.skipped_frames
                        : (vidResult ? vidResult.skipped_frames || 0 : 0);

                      const completedVideoUrl = vidResult?.annotated_video_path ? evidenceUrl(vidResult.annotated_video_path) : null;
                      const hasActiveAlarm = vidTelemetry.active_tracks > 0;

                      return (
                        <>
                          {/* COMPLETED: Show H.264 annotated video with bounding boxes & frame controls */}
                          {completedVideoUrl && !vidLoading ? (
                            <div className="space-y-2">
                              <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-black aspect-video flex items-center justify-center shadow-2xl">
                                <video
                                  ref={playerRef}
                                  src={completedVideoUrl}
                                  controls
                                  autoPlay
                                  playsInline
                                  className="w-full h-full object-contain"
                                />
                                <div className="absolute top-2 left-2 bg-black/70 backdrop-blur text-white text-[10px] font-mono px-2.5 py-1 rounded border border-white/10 pointer-events-none z-10">
                                  🎬 ANNOTATED AI STREAM ({displayTotal} FRAMES)
                                </div>
                              </div>

                              {/* Interactive Precision Controls (Restart, Step Back, Step Forward) */}
                              <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 px-3 py-2 rounded-lg text-xs">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={handleRestartVideo}
                                    title="Restart video"
                                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                                  >
                                    <RotateCcw size={11} /> Restart
                                  </button>
                                  <button
                                    onClick={() => handleStepFrame(-1)}
                                    title="Step backward 1 frame"
                                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                                  >
                                    <ChevronLeft size={12} /> -1 Frame
                                  </button>
                                  <button
                                    onClick={() => handleStepFrame(1)}
                                    title="Step forward 1 frame"
                                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                                  >
                                    +1 Frame <ChevronRight size={12} />
                                  </button>
                                </div>
                                <span className="text-[11px] text-slate-400 font-mono">
                                  Frame Stepping Active (1 / {vidTelemetry.fps || videoMeta?.fps || 25}s)
                                </span>
                              </div>
                            </div>
                          ) : vidMjpegUrl ? (
                            /* PROCESSING: MJPEG live stream — frames arrive frame-by-frame as AI processes them */
                            <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-black aspect-video flex items-center justify-center shadow-2xl">
                              <img
                                src={vidMjpegUrl}
                                alt="Live AI Detection Stream"
                                className="w-full h-full object-contain"
                                style={{ imageRendering: 'auto' }}
                              />
                              {/* LIVE BADGE */}
                              <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/70 backdrop-blur text-white text-[10px] font-mono px-2.5 py-1 rounded border border-white/10 pointer-events-none z-10">
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                LIVE AI STREAM — FRAME {displayCurrent} / {displayTotal}
                              </div>
                              {/* BYTETRACK COUNT BADGE */}
                              {vidTelemetry.active_tracks > 0 && (
                                <div className={`absolute top-2 right-2 text-[10px] font-mono px-2.5 py-1 rounded border pointer-events-none z-10 ${hasActiveAlarm ? 'bg-red-500/30 text-red-300 border-red-500/50 animate-pulse' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'}`}>
                                  🔥 {vidTelemetry.active_tracks} ACTIVE TRACK{vidTelemetry.active_tracks > 1 ? 'S' : ''}
                                </div>
                              )}
                              {/* DETECTION BANNER — shows on fire/smoke detection */}
                              {hasActiveAlarm && (
                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-red-900/90 to-transparent py-3 px-4 pointer-events-none z-10">
                                  <div className="flex items-center gap-2 text-red-300 text-[11px] font-bold">
                                    <span className="text-red-400 text-lg">⚠</span>
                                    FIRE / SMOKE / SPARK DETECTED — AI BOUNDING BOX ACTIVE
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-900 aspect-video flex flex-col items-center justify-center p-6 text-center text-slate-400">
                              <Film size={32} className="text-sky-500 mb-2 animate-bounce" />
                              <p className="text-xs font-bold text-slate-200">Initializing Live AI Stream ({videoMode})...</p>
                              <p className="text-[10px] text-slate-500 mt-1">Video is being extracted and sequential inference is beginning...</p>
                            </div>
                          )}

                          {/* TELEMETRY HUD STATS - REMAINS VISIBLE */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 text-center">
                              <div className="text-[10px] text-slate-400 uppercase font-semibold flex items-center justify-center gap-1">
                                <Activity size={12} className="text-sky-400" /> Processing FPS
                              </div>
                              <div className="text-sm font-bold text-slate-100 font-mono mt-0.5">
                                {vidTelemetry.fps || (vidResult ? vidResult.fps || 15 : 0)} FPS
                              </div>
                            </div>
                            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 text-center">
                              <div className="text-[10px] text-slate-400 uppercase font-semibold flex items-center justify-center gap-1">
                                <Zap size={12} className="text-amber-400" /> Avg Latency
                              </div>
                              <div className="text-sm font-bold text-slate-100 font-mono mt-0.5">
                                {vidTelemetry.avg_latency_ms || (vidResult ? vidResult.avg_latency_ms || 45 : 0)} ms
                              </div>
                            </div>
                            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 text-center">
                              <div className="text-[10px] text-slate-400 uppercase font-semibold flex items-center justify-center gap-1">
                                <Sliders size={12} className="text-emerald-400" /> Source FPS
                              </div>
                              <div className="text-sm font-bold text-slate-100 font-mono mt-0.5">
                                {videoMeta?.fps || 25} FPS
                              </div>
                            </div>
                            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 text-center">
                              <div className="text-[10px] text-slate-400 uppercase font-semibold flex items-center justify-center gap-1">
                                <Cpu size={12} className="text-purple-400" /> Total Time
                              </div>
                              <div className="text-sm font-bold text-slate-100 font-mono mt-0.5">
                                {vidLoading ? `${vidTelemetry.eta_sec}s ETA` : (vidLatency ? `${(vidLatency / 1000).toFixed(1)}s` : 'Completed')}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1.5 pt-1">
                            <div className="flex justify-between text-[11px] font-bold text-slate-300">
                              <span>Progress ({vidProgress}%)</span>
                              <span className="font-mono">{displayCurrent} / {displayTotal} frames</span>
                            </div>
                            <div className="h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                              <div className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 rounded-full transition-all duration-300" style={{ width: `${vidProgress}%` }} />
                            </div>
                          </div>
                        </>
                      );
                    })()}

                    {/* INTERACTIVE DETECTION TIMELINE */}
                    {vidTimelineEvents.length > 0 && (
                      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2 mt-3">
                        <div className="flex justify-between items-center text-xs font-bold text-slate-200">
                          <span>Detection Timeline</span>
                          <span className="text-[10px] text-slate-400">{vidTimelineEvents.length} Threat Timestamp(s)</span>
                        </div>
                        <div className="flex gap-2 overflow-x-auto py-1 custom-scrollbar">
                          {vidTimelineEvents.map((evt, idx) => {
                            const isSpark = evt.type === 'sparks' || evt.type === 'spark';
                            const isFire = evt.type === 'fire';
                            return (
                              <button
                                key={idx}
                                onClick={() => {
                                  if (playerRef.current) {
                                    playerRef.current.currentTime = evt.timestamp_sec;
                                    playerRef.current.play().catch(() => {});
                                  }
                                }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer whitespace-nowrap ${
                                  isFire
                                    ? 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30'
                                    : (isSpark
                                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30'
                                      : 'bg-purple-500/20 text-purple-400 border-purple-500/30 hover:bg-purple-500/30')
                                }`}
                              >
                                <span>{isFire ? '🔥' : (isSpark ? '✨' : '💨')}</span>
                                <span className="capitalize">{evt.type}</span>
                                <span>{Math.floor(evt.timestamp_sec / 60)}:{(evt.timestamp_sec % 60).toFixed(0).padStart(2, '0')}</span>
                                <span className="text-[10px] opacity-75 font-mono">({(evt.confidence * 100).toFixed(0)}%)</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* SNAPSHOT THUMBNAIL & ANNOTATED VIDEO DOWNLOAD */}
                    {vidResult !== null && (
                      <div className="flex flex-wrap gap-3 items-center justify-between pt-2 border-t border-slate-800">
                        {vidResult.annotated_video_path && (
                          <a
                            href={evidenceUrl(vidResult.annotated_video_path) || vidResult.annotated_video_path}
                            download="sentinelos_annotated.mp4"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-[12px] font-bold rounded-xl transition-all cursor-pointer shadow-xs"
                          >
                            <Download size={13} />
                            Download Annotated Video (MP4)
                          </a>
                        )}

                        {vidResult.thumbnail_path && (
                          <div className="flex items-center gap-3 bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                            <img
                              src={evidenceUrl(vidResult.thumbnail_path) || ''}
                              alt="Highest Confidence Thumbnail"
                              onClick={() => setLightboxImg(evidenceUrl(vidResult.thumbnail_path))}
                              className="w-16 h-10 object-cover rounded-lg border border-slate-700 cursor-pointer hover:opacity-80 transition-opacity"
                              title="Click to view full snapshot"
                            />
                            <div>
                              <p className="text-[11px] font-bold text-slate-200">Highest Threat Snapshot</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <button
                                  onClick={() => setLightboxImg(evidenceUrl(vidResult.thumbnail_path))}
                                  className="text-[10px] text-sky-400 hover:underline font-semibold cursor-pointer"
                                  type="button"
                                >
                                  View Fullscreen
                                </button>
                                <span className="text-[10px] text-slate-600">•</span>
                                <a
                                  href={evidenceUrl(vidResult.thumbnail_path) || ''}
                                  download="snapshot.jpg"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-slate-400 hover:underline font-semibold"
                                >
                                  Download
                                </a>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* WEBCAM */}
            {activeTab === 'webcam' && (
              <div className="space-y-4">
                <video ref={webVideoRef} className="hidden" width={640} height={480} autoPlay playsInline muted />

                {webState !== 'stopped' ? (
                  <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                    <canvas ref={webCanvasRef} width={640} height={480} className="w-full h-full object-contain" />
                    {webThreat && (
                      <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-[var(--fire)]/85 to-transparent px-4 py-3">
                        <p className="text-white text-[12px] font-bold uppercase animate-pulse">⚠ ACTIVE THREAT: {webThreat.toUpperCase()} detected</p>
                      </div>
                    )}
                    <div className="absolute top-3 right-3 bg-black/60 text-white text-[9px] font-mono px-2 py-1 rounded-md">
                      {webFps} fps
                    </div>
                    <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--safe)] animate-pulse" />
                      <span className="text-white text-[10px] font-bold bg-black/60 px-2 py-0.5 rounded-md">CCTV LIVE</span>
                    </div>
                  </div>
                ) : (
                  <div className="aspect-video rounded-xl border border-[var(--border)] flex flex-col items-center justify-center gap-4 bg-[var(--surface-2)] text-[var(--text-3)]">
                    <div className="w-12 h-12 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center">
                      <Camera size={22} className="text-[var(--text-3)]" />
                    </div>
                    <div className="text-center">
                      <p className="text-[11px] font-bold uppercase tracking-wider">Webcam feed disarmed</p>
                      <p className="text-[10px] mt-1 font-semibold">Continuous operator verification scanner</p>
                    </div>
                    <button onClick={startWebcam} className="px-4 py-2 bg-[var(--primary)] text-white text-xs font-bold rounded-lg hover:bg-[var(--primary-hover)] transition-all cursor-pointer shadow-sm active:scale-[0.98]">
                      Arm Local Scanner
                    </button>
                  </div>
                )}

                {webState !== 'stopped' && (
                  <div className="flex justify-between items-center text-xs pt-1">
                    <div className="flex gap-2">
                      <button onClick={stopWebcam} className="px-3 py-1.5 bg-[var(--fire-bg)] border border-[var(--fire-border)] text-[var(--fire-text)] font-bold rounded-lg hover:bg-[var(--fire)] hover:text-white transition-colors cursor-pointer text-xs">
                        Disarm
                      </button>
                      {isOperatorOrAdmin ? (
                        <button 
                          onClick={() => {
                            setSimulationMode(!simulationMode);
                            setDetections([]);
                            setWebThreat(null);
                          }} 
                          className={`px-3 py-1.5 border text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                            simulationMode 
                              ? 'bg-[var(--smoke-bg)] text-[var(--smoke-text)] border-[var(--smoke-border)] hover:bg-[var(--smoke-text)] hover:text-white' 
                              : 'bg-[var(--primary-light)] text-[var(--primary)] border-[var(--primary-ring)] hover:bg-[var(--primary)] hover:text-white'
                          }`}
                        >
                          {simulationMode ? 'Simulation: Active' : 'AI Inference: Live'}
                        </button>
                      ) : (
                        <span className="px-3 py-1.5 bg-[var(--surface-hover)] border border-[var(--border)] text-[10px] text-[var(--text-3)] font-bold rounded-lg select-none">
                          Simulation Mode Locked
                        </span>
                      )}
                    </div>

                    <div className="flex gap-3 items-center">
                      <span className="text-[10px] text-[var(--text-3)] font-mono font-bold uppercase">Webcam FPS: {webFps}</span>
                      <button onClick={() => setMuted(!muted)} className="text-[var(--text-3)] hover:text-[var(--text)] transition-colors cursor-pointer">
                        {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* RTSP */}
            {activeTab === 'rtsp' && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[var(--text-2)] uppercase tracking-wider">Relay Stream URL</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={rtspUrl}
                      onChange={e => setRtspUrl(e.target.value)}
                      className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs text-[var(--text)] font-semibold outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-500 transition-all placeholder-[var(--text-3)]"
                      placeholder="rtsp://host:port/live_stream"
                    />
                    <button
                      onClick={connectRtsp}
                      disabled={rtspLoading || (!rtspUrl && !rtspConn)}
                      className={`px-4 py-2 ${rtspConn ? 'bg-red-600 hover:bg-red-700' : 'bg-sky-600 hover:bg-sky-700'} text-white text-xs font-bold rounded-xl disabled:opacity-50 transition-all duration-200 cursor-pointer shrink-0 flex items-center gap-1.5 shadow-xs hover:-translate-y-0.5 active:translate-y-0`}
                    >
                      {rtspLoading ? <RefreshCw size={12} className="animate-spin" /> : (rtspConn ? <XCircle size={12} /> : <Wifi size={12} />)}
                      {rtspLoading ? 'Connecting...' : (rtspConn ? 'Disconnect' : 'Connect')}
                    </button>
                  </div>
                  {rtspConn && rtspLatency !== null && (
                    <div className="text-[10px] text-sky-400 font-semibold flex items-center gap-1 mt-1">
                      <Activity size={10} /> Handshake Latency: {rtspLatency}ms
                    </div>
                  )}
                </div>

                {rtspConn && activeRtspUrlRef.current ? (
                  <RtspStreamPlayer 
                    rtspUrl={activeRtspUrlRef.current} 
                    onThreatDetected={(threat: string | null) => {
                      if (threat && !mutedRef.current) void playAlertChime();
                    }}
                  />
                ) : (
                  <div className="p-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl flex items-center gap-3 text-xs text-[var(--text-3)]">
                    <WifiOff size={16} className="text-[var(--text-3)] shrink-0" />
                    <p className="font-semibold">Enter a valid IP cameras RTSP url stream link above and perform handshake test.</p>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

        {/* Results Sidebar — 2 cols */}
        <div className="lg:col-span-2 space-y-5">

          {/* Detections card */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4 shadow-xs">
            <h3 className="text-xs font-bold text-[var(--text-2)] uppercase tracking-widest flex items-center gap-1.5">
              <AlertTriangle className="text-[var(--fire)]" size={14} /> Feeds Analytics Bounding Box
            </h3>

            {activeTab === 'image' && imgResult && imgResult.detections?.length > 0 && (
              <div className="space-y-3">
                {imgResult.detections.map((det: any, idx: number) => {
                  const tier = getConfidenceTier(det.confidence);
                  return (
                    <div key={idx} className={`p-3.5 rounded-xl border ${tier.bg} flex justify-between items-center text-xs hover:scale-[1.01] transition-transform`}>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[var(--text)] capitalize">{det.detection_type}</span>
                          <span className={`text-[10px] font-bold ${tier.color}`}>{tier.label}</span>
                        </div>
                        <p className="text-[10px] text-[var(--text-3)] font-semibold">Coords: [{det.bbox.x1.toFixed(0)}, {det.bbox.y1.toFixed(0)}] to [{det.bbox.x2.toFixed(0)}, {det.bbox.y2.toFixed(0)}]</p>
                      </div>
                      <span className="font-mono font-bold text-[var(--text)]">{(det.confidence * 100).toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'webcam' && webState === 'running' && detections.length > 0 && (
              <div className="space-y-3 animate-fade-up">
                {detections.map((det: any, idx: number) => {
                  const tier = getConfidenceTier(det.confidence);
                  return (
                    <div key={idx} className={`p-3.5 rounded-xl border ${tier.bg} flex justify-between items-center text-xs hover:scale-[1.01] transition-transform`}>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[var(--text)] capitalize">{det.detection_type}</span>
                          <span className={`text-[10px] font-bold ${tier.color}`}>{tier.label}</span>
                        </div>
                        <p className="text-[10px] text-[var(--text-3)] font-semibold">Live relative coords validation active</p>
                      </div>
                      <span className="font-mono font-bold text-[var(--text)]">{(det.confidence * 100).toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            )}

            {!(
              (activeTab === 'image' && imgResult && imgResult.detections?.length > 0) ||
              (activeTab === 'webcam' && webState === 'running' && detections.length > 0)
            ) && (
              <div className="py-8 text-center text-[var(--text-3)] font-semibold text-xs border border-dashed border-[var(--border)] rounded-xl bg-[var(--surface-2)]/30">
                No active analytical detections to review.
              </div>
            )}
          </div>

          {/* Guidelines info */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-3.5 shadow-xs">
            <h4 className="text-[11px] font-bold text-[var(--text-2)] uppercase tracking-wider">Ingress Guidelines</h4>
            <div className="space-y-2 text-xs font-semibold text-[var(--text-2)] leading-relaxed">
              <p>1. **Formats**: Images (PNG, JPG, BMP) up to 10MB; Video streams (MP4, MKV) up to 50MB.</p>
              <p>2. **Webcam**: Relies on browser permission access. Continuous frames are uploaded every skip-interval for model decoding.</p>
            </div>
          </div>

        </div>

      </motion.div>

      {/* LIGHTBOX MODAL OVERLAY */}
      {lightboxImg && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setLightboxImg(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl space-y-2 p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-3 py-1.5 border-b border-slate-800 bg-slate-950 rounded-xl">
              <span className="text-xs font-bold text-slate-200">Threat Detection Snapshot (Fullscreen)</span>
              <button
                onClick={() => setLightboxImg(null)}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer p-1"
              >
                <XCircle size={18} />
              </button>
            </div>
            <div className="p-2 flex items-center justify-center bg-black rounded-xl">
              <img src={lightboxImg} alt="Expanded Snapshot" className="max-h-[75vh] w-auto object-contain rounded-lg" />
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default Detection;
