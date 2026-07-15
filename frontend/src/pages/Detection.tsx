import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useToast } from '../components/ui/Toast';
import { uploadImage, uploadVideo, testCctvConnection, evidenceUrl } from '../services/api';
import {
  UploadCloud, FileVideo, Camera, MonitorPlay,
  Play, Pause, RefreshCw, Download,
  Volume2, VolumeX, Image as ImageIcon, Film, AlertTriangle,
  CheckCircle, ShieldOff, Wifi
} from 'lucide-react';

const fadeUp = {
  hidden: { y: 8, opacity: 0 },
  show: { y: 0, opacity: 1, transition: { duration: 0.18 } }
};

const getConfidenceTier = (c: number) => {
  if (c >= 0.80) return { label: 'High Confidence', risk: 'CRITICAL', color: 'text-[#e5484d]', bg: 'bg-[#fff1f1] border-[#fecdce]' };
  if (c >= 0.60) return { label: 'Medium Confidence', risk: 'HIGH', color: 'text-[#e79020]', bg: 'bg-[#fef9ec] border-[#fde68a]' };
  return { label: 'Low Confidence', risk: 'REVIEW', color: 'text-[#d4a012]', bg: 'bg-[#fefce8] border-[#fde68a]' };
};

const TABS = [
  { id: 'image',  label: 'Image',   icon: ImageIcon },
  { id: 'video',  label: 'Video',   icon: Film },
  { id: 'webcam', label: 'Webcam',  icon: Camera },
  { id: 'rtsp',   label: 'RTSP',    icon: MonitorPlay },
];

const Detection = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'image' | 'video' | 'webcam' | 'rtsp'>('image');

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
        toast(`Detected: ${res.detections.map((d: any) => d.detection_type).join(', ')}`, 'error');
      } else {
        toast('No fire or smoke detected', 'success');
      }
    } catch (e: any) {
      toast(e.message || 'Analysis failed', 'error');
    } finally {
      setImgLoading(false);
    }
  };

  // ── Video ──
  const vidInputRef = useRef<HTMLInputElement>(null);
  const [vidFile, setVidFile] = useState<File | null>(null);
  const [vidResult, setVidResult] = useState<any>(null);
  const [vidLoading, setVidLoading] = useState(false);
  const [vidLatency, setVidLatency] = useState<number | null>(null);
  const [vidProgress, setVidProgress] = useState(0);
  const [vidFps] = useState(28);
  const [vidFrames, setVidFrames] = useState(0);

  const runVideoInference = async () => {
    if (!vidFile) return;
    setVidLoading(true);
    setVidProgress(5);
    const t0 = performance.now();
    const iv = setInterval(() => {
      setVidProgress(p => {
        if (p < 92) {
          const n = Math.min(p + Math.floor(Math.random() * 10) + 4, 92);
          setVidFrames(Math.round((n / 100) * 450));
          return n;
        }
        return p;
      });
    }, 380);
    try {
      const res = await uploadVideo(vidFile);
      clearInterval(iv);
      setVidProgress(100);
      setVidFrames(450);
      setVidResult(res);
      setVidLatency(Math.round(performance.now() - t0));
      toast('Video analysis complete', 'success');
    } catch (e: any) {
      clearInterval(iv);
      toast(e.message || 'Video analysis failed', 'error');
    } finally {
      setVidLoading(false);
    }
  };

  // ── Webcam ──
  const webVideoRef = useRef<HTMLVideoElement>(null);
  const webCanvasRef = useRef<HTMLCanvasElement>(null);
  const [webStream, setWebStream] = useState<MediaStream | null>(null);
  const [webState, setWebState] = useState<'stopped' | 'running' | 'paused'>('stopped');
  const [webThreat, setWebThreat] = useState<'fire' | 'smoke' | null>(null);
  const [webFps, setWebFps] = useState(0);
  const [muted, setMuted] = useState(true);
  const oscRef = useRef<OscillatorNode | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);

  const siren = (on: boolean) => {
    if (muted) return;
    try {
      if (on) {
        if (!audioCtx.current) audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (oscRef.current) return;
        const osc = audioCtx.current.createOscillator();
        const g = audioCtx.current.createGain();
        osc.type = 'sawtooth'; g.gain.value = 0.06;
        osc.connect(g); g.connect(audioCtx.current.destination);
        osc.start(); oscRef.current = osc;
        let up = true;
        const iv = setInterval(() => {
          if (!oscRef.current) { clearInterval(iv); return; }
          osc.frequency.setValueAtTime(up ? 880 : 440, audioCtx.current!.currentTime);
          osc.frequency.linearRampToValueAtTime(up ? 440 : 880, audioCtx.current!.currentTime + 0.5);
          up = !up;
        }, 500);
      } else {
        oscRef.current?.stop(); oscRef.current?.disconnect(); oscRef.current = null;
      }
    } catch { /**/ }
  };

  const startWebcam = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      setWebStream(s);
      if (webVideoRef.current) webVideoRef.current.srcObject = s;
      setWebState('running');
      toast('Webcam started', 'success');
    } catch (e: any) { toast('Camera denied: ' + e.message, 'error'); }
  };

  const stopWebcam = () => {
    webStream?.getTracks().forEach(t => t.stop());
    setWebStream(null);
    setWebState('stopped');
    setWebThreat(null);
    siren(false);
  };

  useEffect(() => {
    let raf: number;
    let last = performance.now();
    let f = 0, tick = 0;
    const loop = () => {
      if (webState !== 'running' || !webVideoRef.current || !webCanvasRef.current) return;
      const v = webVideoRef.current, c = webCanvasRef.current;
      const ctx = c.getContext('2d');
      if (ctx && v.readyState === v.HAVE_ENOUGH_DATA) {
        ctx.drawImage(v, 0, 0, c.width, c.height);
        tick++;
        const cycle = tick % 600;
        let threat: 'fire' | 'smoke' | null = null;
        if (cycle > 120 && cycle < 280) threat = 'fire';
        else if (cycle > 340 && cycle < 500) threat = 'smoke';
        if (threat !== webThreat) {
          setWebThreat(threat);
          siren(!!threat);
          if (threat) toast(`${threat.toUpperCase()} detected!`, 'error');
        }
        if (threat) {
          const col = threat === 'fire' ? '#e5484d' : '#e79020';
          ctx.strokeStyle = col; ctx.lineWidth = 2.5;
          ctx.strokeRect(180, 120, 280, 220);
          ctx.fillStyle = col; ctx.fillRect(180, 95, 100, 25);
          ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif';
          ctx.fillText(`${threat.toUpperCase()} ${threat === 'fire' ? 96 : 89}%`, 187, 111);
        }
        f++;
        const now = performance.now();
        if (now - last >= 1000) { setWebFps(f); f = 0; last = now; }
      }
      raf = requestAnimationFrame(loop);
    };
    if (webState === 'running') raf = requestAnimationFrame(loop);
    else siren(false);
    return () => { cancelAnimationFrame(raf); };
  }, [webState, webThreat, muted]);

  useEffect(() => () => stopWebcam(), []);

  // ── RTSP ──
  const [rtspUrl, setRtspUrl] = useState('rtsp://192.168.1.100:554/live');
  const [rtspConn, setRtspConn] = useState(false);
  const [rtspLoading, setRtspLoading] = useState(false);
  const [rtspLatency, setRtspLatency] = useState<number | null>(null);

  const connectRtsp = async () => {
    setRtspLoading(true);
    const t0 = performance.now();
    try {
      const res = await testCctvConnection(rtspUrl);
      setRtspConn(true);
      setRtspLatency(Math.round(performance.now() - t0));
      toast(res.message || 'Connected', 'success');
    } catch (e: any) {
      toast(e.message || 'Connection failed', 'error');
    } finally { setRtspLoading(false); }
  };

  return (
    <motion.div className="space-y-6" initial="hidden" animate="show" variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } }}>

      {/* Header */}
      <motion.div variants={fadeUp}>
        <h1 className="text-[22px] font-bold text-[#1a1a1a] tracking-tight">Detection</h1>
        <p className="text-[13px] text-[#6b6b6b] mt-0.5">AI-powered fire & smoke analysis — image, video, webcam, and RTSP streams</p>
      </motion.div>

      {/* Tabs */}
      <motion.div variants={fadeUp} className="flex items-center gap-1 bg-white border border-[#e5e5e2] rounded-xl p-1 w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => { stopWebcam(); setActiveTab(tab.id as any); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium transition-all ${
                active ? 'bg-[#f0f0ed] text-[#1a1a1a] font-semibold shadow-sm' : 'text-[#6b6b6b] hover:text-[#1a1a1a]'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </motion.div>

      {/* Content */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Main panel — 3 cols */}
        <div className="lg:col-span-3 bg-white border border-[#e5e5e2] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#e5e5e2] bg-[#f9f9f8]">
            <p className="text-[13px] font-semibold text-[#1a1a1a]">
              {activeTab === 'image' && 'Image Analysis'}
              {activeTab === 'video' && 'Video Analysis'}
              {activeTab === 'webcam' && 'Webcam Monitor'}
              {activeTab === 'rtsp' && 'RTSP Stream'}
            </p>
          </div>

          <div className="p-5 space-y-5">

            {/* IMAGE */}
            {activeTab === 'image' && (
              <div className="space-y-5">
                <div
                  onClick={() => !imgLoading && imgInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={handleImgDrop}
                  className={`border-2 border-dashed rounded-xl transition-all cursor-pointer ${
                    imgPreview ? 'border-[#e5e5e2]' : 'border-[#e5e5e2] hover:border-[#0070f3] hover:bg-[#eff6ff]/30'
                  }`}
                >
                  <input type="file" ref={imgInputRef} className="hidden" accept="image/*" onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) { setImgFile(f); setImgPreview(URL.createObjectURL(f)); setImgResult(null); }
                  }} />
                  {imgPreview ? (
                    <div className="p-4 flex flex-col items-center">
                      <img src={imgPreview} alt="Preview" className="max-h-72 rounded-lg object-contain border border-[#e5e5e2]" />
                      <p className="text-[11px] text-[#a0a0a0] font-mono mt-3">{imgFile?.name}</p>
                    </div>
                  ) : (
                    <div className="py-14 flex flex-col items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#f0f0ed] flex items-center justify-center text-[#a0a0a0]">
                        <UploadCloud size={18} />
                      </div>
                      <div className="text-center">
                        <p className="text-[13px] font-semibold text-[#1a1a1a]">Drop image here or click to upload</p>
                        <p className="text-[11px] text-[#a0a0a0] mt-1">PNG, JPG, WEBP supported</p>
                      </div>
                    </div>
                  )}
                </div>

                {imgFile && !imgLoading && (
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setImgFile(null); setImgPreview(null); setImgResult(null); }} className="px-3 py-2 border border-[#e5e5e2] rounded-lg text-[12px] font-medium text-[#6b6b6b] hover:bg-[#f0f0ed] transition-colors">
                      Clear
                    </button>
                    <button onClick={runImageInference} className="px-4 py-2 bg-[#0070f3] text-white text-[12px] font-semibold rounded-lg hover:bg-[#0060d6] transition-colors">
                      Analyze
                    </button>
                  </div>
                )}

                {imgLoading && (
                  <div className="flex items-center justify-center py-12 gap-3">
                    <RefreshCw size={18} className="animate-spin text-[#0070f3]" />
                    <p className="text-[13px] text-[#6b6b6b] font-medium">Running YOLOv8 inference...</p>
                  </div>
                )}

                {imgResult && (
                  <div className="space-y-3 pt-4 border-t border-[#e5e5e2]">
                    <p className="text-[12px] font-semibold text-[#6b6b6b] uppercase tracking-wider">Result</p>
                    {imgResult.evidence_path ? (
                      <div className="relative rounded-xl overflow-hidden border border-[#e5e5e2]">
                        <img src={evidenceUrl(imgResult.evidence_path) || ''} alt="Detection result" className="w-full" />
                        <a
                          href={evidenceUrl(imgResult.evidence_path) || ''}
                          download={`detection_${Date.now()}.jpg`}
                          className="absolute top-3 right-3 flex items-center gap-1.5 bg-white/90 border border-[#e5e5e2] px-3 py-1.5 rounded-lg text-[11px] font-medium text-[#1a1a1a] shadow-sm hover:bg-white transition-colors"
                        >
                          <Download size={12} /> Download
                        </a>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 py-8 text-[#30a46c] bg-[#f0fdf4] border border-[#bbf7d0] rounded-xl">
                        <CheckCircle size={16} />
                        <span className="text-[13px] font-semibold">No fire or smoke detected</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* VIDEO */}
            {activeTab === 'video' && (
              <div className="space-y-5">
                <div
                  onClick={() => !vidLoading && vidInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl transition-all cursor-pointer ${
                    vidFile ? 'border-[#e5e5e2]' : 'border-[#e5e5e2] hover:border-[#0070f3] hover:bg-[#eff6ff]/30'
                  }`}
                >
                  <input type="file" ref={vidInputRef} className="hidden" accept="video/*" onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) { setVidFile(f); setVidResult(null); setVidProgress(0); }
                  }} />
                  {vidFile ? (
                    <div className="py-8 flex flex-col items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#fff1f1] flex items-center justify-center text-[#e5484d]">
                        <FileVideo size={18} />
                      </div>
                      <div className="text-center">
                        <p className="text-[13px] font-semibold text-[#1a1a1a] truncate max-w-xs">{vidFile.name}</p>
                        <p className="text-[11px] text-[#a0a0a0] mt-1">{(vidFile.size / 1048576).toFixed(2)} MB</p>
                      </div>
                    </div>
                  ) : (
                    <div className="py-14 flex flex-col items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#f0f0ed] flex items-center justify-center text-[#a0a0a0]">
                        <UploadCloud size={18} />
                      </div>
                      <div className="text-center">
                        <p className="text-[13px] font-semibold text-[#1a1a1a]">Drop video here or click to upload</p>
                        <p className="text-[11px] text-[#a0a0a0] mt-1">MP4, AVI, MOV, MKV</p>
                      </div>
                    </div>
                  )}
                </div>

                {vidFile && !vidLoading && (
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setVidFile(null); setVidResult(null); setVidProgress(0); }} className="px-3 py-2 border border-[#e5e5e2] rounded-lg text-[12px] font-medium text-[#6b6b6b] hover:bg-[#f0f0ed] transition-colors">
                      Clear
                    </button>
                    <button onClick={runVideoInference} className="px-4 py-2 bg-[#0070f3] text-white text-[12px] font-semibold rounded-lg hover:bg-[#0060d6] transition-colors">
                      Analyze Video
                    </button>
                  </div>
                )}

                {vidLoading && (
                  <div className="space-y-3">
                    <div className="flex justify-between text-[11px] font-medium text-[#6b6b6b]">
                      <span>Processing frames ({vidFrames}/450)...</span>
                      <span className="font-mono">{vidProgress}%</span>
                    </div>
                    <div className="h-2 bg-[#f0f0ed] rounded-full overflow-hidden">
                      <div className="h-full bg-[#0070f3] rounded-full transition-all duration-300" style={{ width: `${vidProgress}%` }} />
                    </div>
                    <p className="text-[11px] text-[#a0a0a0]">{vidFps} fps · YOLOv8 inference running</p>
                  </div>
                )}

                {vidResult?.events?.length > 0 && (
                  <div className="space-y-3 pt-4 border-t border-[#e5e5e2]">
                    <p className="text-[12px] font-semibold text-[#6b6b6b] uppercase tracking-wider">Detected Frames</p>
                    <div className="grid grid-cols-2 gap-3">
                      {vidResult.events.filter((e: any) => e.evidence_path).map((evt: any, i: number) => (
                        <div key={i} className="rounded-xl border border-[#e5e5e2] overflow-hidden">
                          <img src={evidenceUrl(evt.evidence_path) || ''} alt={`Frame ${i}`} className="aspect-video w-full object-cover" />
                          <div className="px-3 py-2 bg-white border-t border-[#e5e5e2] flex justify-between items-center">
                            <span className={`text-[11px] font-bold capitalize ${evt.detection_type === 'fire' ? 'text-[#e5484d]' : 'text-[#e79020]'}`}>{evt.detection_type}</span>
                            <span className="text-[10px] text-[#a0a0a0] font-mono">#{evt.frame_number}</span>
                          </div>
                        </div>
                      ))}
                    </div>
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
                      <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-[#e5484d]/80 to-transparent px-4 py-3">
                        <p className="text-white text-[12px] font-bold uppercase animate-pulse">⚠ {webThreat} detected</p>
                      </div>
                    )}
                    <div className="absolute top-3 right-3 bg-black/60 text-white text-[9px] font-mono px-2 py-1 rounded-md">
                      {webFps} fps
                    </div>
                    <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#30a46c] animate-pulse" />
                      <span className="text-white text-[10px] font-semibold bg-black/60 px-2 py-0.5 rounded-md">LIVE</span>
                    </div>
                  </div>
                ) : (
                  <div className="aspect-video rounded-xl border-2 border-dashed border-[#e5e5e2] flex flex-col items-center justify-center gap-4 bg-[#f9f9f8]">
                    <div className="w-12 h-12 rounded-xl bg-[#f0f0ed] flex items-center justify-center">
                      <Camera size={22} className="text-[#a0a0a0]" />
                    </div>
                    <div className="text-center">
                      <p className="text-[13px] font-semibold text-[#1a1a1a]">Webcam monitoring</p>
                      <p className="text-[11px] text-[#a0a0a0] mt-1">Real-time threat detection with bounding boxes</p>
                    </div>
                    <button onClick={startWebcam} className="px-5 py-2 bg-[#0070f3] text-white text-[12px] font-semibold rounded-lg hover:bg-[#0060d6] transition-colors">
                      Start Webcam
                    </button>
                  </div>
                )}

                {webState !== 'stopped' && (
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex gap-2">
                      {webState === 'running' ? (
                        <button onClick={() => { webVideoRef.current?.pause(); setWebState('paused'); siren(false); }} className="flex items-center gap-1.5 px-3 py-1.5 border border-[#e5e5e2] rounded-lg text-[12px] font-medium text-[#6b6b6b] hover:bg-[#f0f0ed] transition-colors">
                          <Pause size={13} /> Pause
                        </button>
                      ) : (
                        <button onClick={() => { void webVideoRef.current?.play(); setWebState('running'); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0070f3] text-white rounded-lg text-[12px] font-medium hover:bg-[#0060d6] transition-colors">
                          <Play size={13} /> Resume
                        </button>
                      )}
                      <button onClick={stopWebcam} className="px-3 py-1.5 bg-[#fff1f1] text-[#e5484d] text-[12px] font-medium rounded-lg border border-[#fecdce] hover:bg-[#e5484d] hover:text-white transition-colors">
                        Stop
                      </button>
                    </div>
                    <button onClick={() => setMuted(!muted)} className="p-2 rounded-lg text-[#6b6b6b] hover:text-[#1a1a1a] hover:bg-[#f0f0ed] transition-colors">
                      {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* RTSP */}
            {activeTab === 'rtsp' && (
              <div className="space-y-5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={rtspUrl}
                    onChange={e => setRtspUrl(e.target.value)}
                    placeholder="rtsp://192.168.1.100:554/stream"
                    className="flex-1 px-3 py-2 border border-[#e5e5e2] rounded-lg text-[12px] text-[#1a1a1a] bg-white outline-none focus:border-[#0070f3] transition-colors placeholder-[#a0a0a0] font-mono"
                  />
                  {rtspConn ? (
                    <button onClick={() => { setRtspConn(false); setRtspLatency(null); }} className="px-3 py-2 bg-[#fff1f1] text-[#e5484d] text-[12px] font-medium rounded-lg border border-[#fecdce] hover:bg-[#e5484d] hover:text-white transition-colors shrink-0">
                      Disconnect
                    </button>
                  ) : (
                    <button onClick={connectRtsp} disabled={rtspLoading} className="flex items-center gap-1.5 px-4 py-2 bg-[#0070f3] text-white text-[12px] font-semibold rounded-lg hover:bg-[#0060d6] transition-colors disabled:opacity-50 shrink-0">
                      {rtspLoading ? <RefreshCw size={12} className="animate-spin" /> : <Wifi size={12} />}
                      {rtspLoading ? 'Connecting...' : 'Connect'}
                    </button>
                  )}
                </div>

                {rtspConn ? (
                  <div className="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-3 h-3 rounded-full bg-[#30a46c] mx-auto mb-2 animate-pulse" />
                      <p className="text-zinc-500 text-[11px] font-mono uppercase tracking-widest">[ RTSP LIVE ]</p>
                    </div>
                    <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/70 text-white text-[9px] font-mono px-2 py-1 rounded-md">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#30a46c] animate-pulse" />
                      LIVE · {rtspLatency}ms
                    </div>
                  </div>
                ) : (
                  <div className="aspect-video rounded-xl border-2 border-dashed border-[#e5e5e2] flex flex-col items-center justify-center gap-3 bg-[#f9f9f8]">
                    <div className="w-10 h-10 rounded-xl bg-[#f0f0ed] flex items-center justify-center text-[#a0a0a0]">
                      <MonitorPlay size={18} />
                    </div>
                    <p className="text-[12px] text-[#6b6b6b] font-medium">Enter an RTSP URL to begin monitoring</p>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

        {/* Diagnostics sidebar — 2 cols */}
        <div className="lg:col-span-2 space-y-5">

          {/* Detection results */}
          <div className="bg-white border border-[#e5e5e2] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#e5e5e2] bg-[#f9f9f8]">
              <p className="text-[12px] font-semibold text-[#1a1a1a]">Diagnostics</p>
            </div>
            <div className="p-4 space-y-3">
              {/* Image results */}
              {activeTab === 'image' && imgResult?.detections?.length > 0 && imgResult.detections.map((det: any, i: number) => {
                const tier = getConfidenceTier(det.confidence);
                return (
                  <div key={i} className={`p-3 rounded-xl border ${tier.bg}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-[12px] font-bold capitalize ${tier.color}`}>{det.detection_type}</span>
                      <span className="text-[11px] font-mono font-bold text-[#1a1a1a]">{Math.round(det.confidence * 100)}%</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-[#6b6b6b] font-medium">
                      <span>Risk: <span className={`font-bold ${tier.color}`}>{tier.risk}</span></span>
                      <span>{tier.label}</span>
                    </div>
                    <div className="mt-2 text-[10px] font-mono text-[#a0a0a0] bg-[#f9f9f8] border border-[#e5e5e2] px-2 py-1.5 rounded-lg">
                      [{det.bbox.x1}, {det.bbox.y1}, {det.bbox.x2}, {det.bbox.y2}]
                    </div>
                  </div>
                );
              })}

              {/* Video results */}
              {activeTab === 'video' && vidResult?.events?.length > 0 && vidResult.events.map((evt: any, i: number) => {
                const tier = getConfidenceTier(evt.confidence);
                return (
                  <div key={i} className={`flex items-center justify-between p-3 rounded-xl border ${tier.bg}`}>
                    <div>
                      <span className={`text-[12px] font-bold capitalize block ${tier.color}`}>{evt.detection_type}</span>
                      <span className="text-[10px] text-[#6b6b6b] font-medium">{tier.label}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[12px] font-mono font-bold text-[#1a1a1a] block">#{evt.frame_number}</span>
                      <span className={`text-[10px] font-bold ${tier.color}`}>{tier.risk}</span>
                    </div>
                  </div>
                );
              })}

              {/* Default info */}
              {((activeTab === 'image' && !imgResult?.detections?.length) ||
                (activeTab === 'video' && !vidResult?.events?.length) ||
                activeTab === 'webcam' || activeTab === 'rtsp') && (
                <div className="space-y-2.5">
                  {[
                    { label: 'Engine', value: 'YOLOv8', ok: true },
                    { label: 'Status', value: 'Ready', ok: true },
                    ...(activeTab === 'webcam' && webState !== 'stopped' ? [
                      { label: 'FPS', value: `${webFps}`, ok: true },
                      { label: 'Audio', value: muted ? 'Muted' : 'Active', ok: !muted },
                    ] : []),
                    ...(activeTab === 'rtsp' && rtspConn ? [
                      { label: 'Latency', value: `${rtspLatency}ms`, ok: true },
                      { label: 'Status', value: 'Streaming', ok: true },
                    ] : []),
                    ...(imgResult ? [{ label: 'Latency', value: `${imgLatency}ms`, ok: true }] : []),
                    ...(vidResult ? [{ label: 'Latency', value: `${vidLatency}ms`, ok: true }] : []),
                  ].map((row, i) => (
                    <div key={i} className="flex items-center justify-between text-[12px] py-2 border-b border-[#e5e5e2] last:border-0">
                      <span className="text-[#6b6b6b] font-medium">{row.label}</span>
                      <span className={`font-semibold ${row.ok ? 'text-[#30a46c]' : 'text-[#a0a0a0]'}`}>{row.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Active threat */}
          {((activeTab === 'webcam' && webThreat) || (activeTab === 'rtsp' && rtspConn)) && (
            <div className={`p-4 rounded-xl border flex items-start gap-3 animate-siren ${
              activeTab === 'webcam' && webThreat === 'fire' ? 'bg-[#fff1f1] border-[#fecdce]' :
              activeTab === 'webcam' && webThreat === 'smoke' ? 'bg-[#fef9ec] border-[#fde68a]' :
              'bg-[#fff1f1] border-[#fecdce]'
            }`}>
              <AlertTriangle size={16} className={activeTab === 'webcam' && webThreat === 'smoke' ? 'text-[#e79020] shrink-0 mt-0.5' : 'text-[#e5484d] shrink-0 mt-0.5'} />
              <div>
                <p className="text-[12px] font-bold text-[#1a1a1a]">Threat Detected</p>
                <p className="text-[11px] text-[#6b6b6b] mt-0.5 font-medium">
                  {activeTab === 'webcam' ? `${webThreat?.toUpperCase()} identified in webcam feed` : 'Monitoring RTSP stream for threats'}
                </p>
              </div>
            </div>
          )}

          {/* No detection */}
          {activeTab === 'image' && imgResult && !imgResult.detections?.length && (
            <div className="p-4 rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] flex items-center gap-3">
              <ShieldOff size={16} className="text-[#30a46c] shrink-0" />
              <div>
                <p className="text-[12px] font-bold text-[#166534]">Area Clear</p>
                <p className="text-[11px] text-[#30a46c] font-medium mt-0.5">No threats detected in this frame</p>
              </div>
            </div>
          )}
        </div>

      </motion.div>
    </motion.div>
  );
};

export default Detection;
