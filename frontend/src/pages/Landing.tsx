import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Flame, Shield, Activity, Video, ArrowRight, 
  CheckCircle, Plus, Minus, Cpu, HelpCircle, HardDrive, 
  Terminal, ShieldAlert, CheckCircle2, AlertTriangle 
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { motion } from 'framer-motion';

const fadeInUp = {
  hidden: { opacity: 0, y: 25 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const scaleIn = {
  hidden: { scale: 0.96, opacity: 0 },
  visible: { scale: 1, opacity: 1, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } }
};

const Landing = () => {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // States for interactive mockup and FAQ accordion
  const [activeMockupTab, setActiveMockupTab] = useState<'matrix' | 'fire' | 'analytics'>('matrix');
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const [mockLiveAlerts, setMockLiveAlerts] = useState<any[]>([]);

  // Telemetry log simulation
  useEffect(() => {
    const defaultAlerts = [
      { id: 1, time: '21:18:04', cam: 'CAM-01 Warehouse', type: 'fire', conf: '96%', status: 'Active' },
      { id: 2, time: '21:12:44', cam: 'CAM-04 Loading Dock', type: 'smoke', conf: '84%', status: 'Active' },
      { id: 3, time: '20:55:12', cam: 'CAM-02 Server Room', type: 'system', conf: '100%', status: 'OK' }
    ];
    setMockLiveAlerts(defaultAlerts);

    const interval = setInterval(() => {
      const now = new Date().toLocaleTimeString();
      const cams = ['CAM-01 Warehouse', 'CAM-02 Server Room', 'CAM-04 Loading Dock', 'CAM-05 Yard'];
      const types = ['fire', 'smoke', 'system'];
      const randomCam = cams[Math.floor(Math.random() * cams.length)];
      const randomType = types[Math.floor(Math.random() * types.length)];
      
      const newAlert = {
        id: Date.now(),
        time: now,
        cam: randomCam,
        type: randomType,
        conf: randomType === 'system' ? '100%' : `${Math.floor(Math.random() * 20) + 79}%`,
        status: randomType === 'system' ? 'OK' : 'Active'
      };

      setMockLiveAlerts(prev => [newAlert, ...prev.slice(0, 2)]);
    }, 4500);

    return () => clearInterval(interval);
  }, []);

  const features = [
    {
      icon: <Flame className="w-5 h-5 text-[var(--fire)]" />,
      title: 'Neural Vision Inference',
      desc: 'High-speed local computer vision layers process frames in milliseconds, ensuring anomalies are flagged without network transport lag.'
    },
    {
      icon: <Activity className="w-5 h-5 text-[var(--smoke)]" />,
      title: 'Real-Time Telemetry Logs',
      desc: 'Every coordinate check and confidence delta is stored, providing high-precision analytics maps for compliance auditing.'
    },
    {
      icon: <Video className="w-5 h-5 text-[var(--primary)]" />,
      title: 'Unified Camera Ingest',
      desc: 'Seamlessly stream frames from built-in webcams, legacy cameras, or remote RTSP relays under a unified decoding scheduler.'
    },
    {
      icon: <Shield className="w-5 h-5 text-[var(--safe)]" />,
      title: 'Granular Access RBAC',
      desc: 'Enforce security boundaries by partitioning workspace controls between Administrators, Operators, and Viewers.'
    }
  ];

  const faqs = [
    {
      q: "How does FireGuard AI hook into legacy camera systems?",
      a: "FireGuard AI uses standard IP network protocol layers. Any camera supporting RTSP (Real-Time Streaming Protocol) or HTTP streaming can be registered in the Settings panel and monitored continuously."
    },
    {
      q: "Can the AI vision engine run locally on standard hardware?",
      a: "Yes. The backend architecture automatically evaluates host hardware capabilities. It switches seamlessly between CUDA-accelerated GPU pipelines and low-overhead CPU workers without requiring code modifications."
    },
    {
      q: "What settings can be tuned to reduce false-alarm triggers?",
      a: "Operators can adjust the Confidence Threshold, Intersection over Union (IoU) overlap margins, Frame Skip rates, and toggle pixel-variance Motion Filtering on the fly in the Settings view."
    },
    {
      q: "How does the sound siren alert trigger?",
      a: "On active threat flags, FireGuard AI uses native Web Audio synthesis to generate electronic chime sirens. This guarantees immediate audible warnings without needing external asset files."
    }
  ];

  const toggleFaq = (idx: number) => {
    setOpenFaqIndex(openFaqIndex === idx ? null : idx);
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans relative overflow-x-hidden selection:bg-[var(--primary-light)] selection:text-[var(--primary)] transition-colors duration-200">
      
      {/* Visual background decorations - Notion-like premium animated grids */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(128,128,128,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(128,128,128,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
      <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[80vw] h-[600px] bg-gradient-radial from-[var(--primary-light)] via-transparent to-transparent opacity-40 blur-3xl pointer-events-none" />
      <div className="absolute top-[40%] right-[-100px] w-[400px] h-[400px] bg-gradient-radial from-[var(--smoke-bg)] to-transparent opacity-20 blur-3xl pointer-events-none" />

      {/* Sticky Header */}
      <header className="sticky top-0 z-50 bg-[var(--color-bg)]/80 backdrop-blur-xl border-b border-[var(--color-border)]">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3 font-bold cursor-pointer select-none group" onClick={() => navigate('/')}>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 via-purple-600 to-blue-500 flex items-center justify-center shrink-0 shadow-glow group-hover:scale-105 transition-transform">
                <span className="text-[13px] font-black text-white tracking-wider">SC</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-black tracking-tight text-[var(--color-fg)]">Sai Charan</span>
                <span className="text-[10px] font-bold text-[var(--color-muted)] leading-none uppercase tracking-wider">
                  <span className="gradient-text font-extrabold">FireGuard</span> AI Platform
                </span>
              </div>
            </div>
 
            <nav className="hidden md:flex items-center gap-6 text-[13px] font-semibold text-[var(--color-muted)]">
              <a href="#features" className="hover:text-[var(--color-fg)] transition-colors">Features</a>
              <a href="#solutions" className="hover:text-[var(--color-fg)] transition-colors">Architecture</a>
              <a href="#tech" className="hover:text-[var(--color-fg)] transition-colors">AI Vision Engine</a>
              <a href="#faq" className="hover:text-[var(--color-fg)] transition-colors">Documentation</a>
            </nav>
          </div>
 
          <div className="flex items-center gap-3 text-[13px] font-semibold">
            {isAuthenticated ? (
              <button 
                onClick={() => navigate('/dashboard')}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white transition-all cursor-pointer flex items-center gap-2 shadow-glow font-bold active:scale-[0.98]"
              >
                Enter Command Center <ArrowRight size={14} />
              </button>
            ) : (
              <div className="flex items-center gap-2.5">
                <button 
                  onClick={() => navigate('/login')}
                  className="px-4 py-2 text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)] hover:bg-[var(--glass-light-bg)] rounded-xl transition-all cursor-pointer font-bold"
                >
                  Sign In
                </button>
                <button 
                  onClick={() => navigate('/register')}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white transition-all shadow-glow cursor-pointer font-bold active:scale-[0.98]"
                >
                  Let's Connect
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
 
      {/* Main Content Container */}
      <main className="max-w-6xl mx-auto px-6 pt-16 sm:pt-24 pb-32 relative z-10 space-y-28">
        
        {/* Hero Section */}
        <motion.section 
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
          className="text-center max-w-4xl mx-auto space-y-6 flex flex-col items-center"
        >
          
          {/* Release Tag */}
          <motion.div variants={fadeInUp} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass border border-[var(--color-border)] text-xs text-[var(--color-fg-secondary)] font-bold shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <span>Available for Real-time Fire & Smoke Intelligence</span>
          </motion.div>
 
          <motion.h1 variants={fadeInUp} className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[1.08] text-[var(--color-fg)] max-w-3xl">
            FireGuard <span className="gradient-text">AI Security</span> Operations Center
          </motion.h1>
 
          <motion.p variants={fadeInUp} className="text-base sm:text-lg text-[var(--color-muted)] max-w-2xl mx-auto font-medium leading-relaxed">
            Building production-grade AI systems and premium web applications. Continuous computer vision surveillance designed to scan CCTV networks for real-time fire and smoke anomalies.
          </motion.p>
 
          <motion.div variants={fadeInUp} className="pt-4 flex flex-col sm:flex-row justify-center gap-4 font-bold text-sm w-full sm:w-auto">
            <button 
              onClick={() => navigate('/detection')}
              className="px-7 py-3.5 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 text-white transition-all shadow-glow hover:shadow-glow-lg cursor-pointer flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              <Video size={16} /> Test Live CV Detection
            </button>
            <button 
              onClick={() => navigate('/dashboard')}
              className="px-7 py-3.5 rounded-2xl glass-light hover:bg-[var(--glass-bg)] border border-[var(--color-border)] text-[var(--color-fg)] transition-all cursor-pointer flex items-center justify-center gap-2 shadow-sm"
            >
              <Shield size={16} /> Access SOC Dashboard
            </button>
          </motion.div>
        </motion.section>

        {/* Detailed Product Demo Video Section */}
        <motion.section 
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={scaleIn}
          className="space-y-8 max-w-5xl mx-auto text-center"
        >
          <div className="space-y-3">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--text)] uppercase">
              Live Command Center Video Tour
            </h2>
            <p className="text-xs sm:text-sm text-[var(--text-2)] font-semibold max-w-xl mx-auto leading-relaxed">
              Watch FireGuard AI process incoming frame buffers, flag active thermal risks with 99.4% precision, and manage visual incident triage.
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-3 shadow-2xl overflow-hidden max-w-4xl mx-auto relative group hover:border-sky-300 dark:hover:border-sky-900 transition-all duration-300">
            <div className="rounded-xl overflow-hidden border border-[var(--border)] bg-black aspect-video relative flex items-center justify-center shadow-inner">
              <img 
                src="/demo_recording.webp" 
                alt="FireGuard AI Live Platform Walkthrough" 
                className="w-full h-full object-cover group-hover:scale-[1.008] transition-transform duration-700" 
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
              
              <div className="absolute bottom-4 left-4 bg-black/75 text-white text-[9px] font-mono px-2.5 py-1.5 rounded-md flex items-center gap-2 backdrop-blur-md select-none border border-white/10">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse" />
                HUD · DETECTOR ACTIVE · PROTOTYPE TOUR
              </div>
            </div>
          </div>
        </motion.section>
 
        {/* Premium Interactive Mockup Dashboard (Notion / Linear Reference) */}
        <section className="space-y-6 max-w-5xl mx-auto">
          {/* Tab Selector */}
          <div className="flex justify-center bg-[var(--surface-2)] border border-[var(--border)] p-1 rounded-2xl max-w-md mx-auto gap-1">
            {[
              { id: 'matrix', label: 'Surveillance Matrix', icon: <Video size={12} /> },
              { id: 'fire', label: 'AI Detections', icon: <AlertTriangle size={12} /> },
              { id: 'analytics', label: 'Analytics Panel', icon: <Activity size={12} /> }
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setActiveMockupTab(t.id as any)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeMockupTab === t.id 
                    ? 'bg-[var(--surface)] text-sky-600 border border-[var(--border)] shadow-xs' 
                    : 'text-[var(--text-3)] hover:text-[var(--text)]'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* Interactive Window */}
          <div className="rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl overflow-hidden aspect-[16/10] max-w-4xl mx-auto flex flex-col">
            {/* Header bar */}
            <div className="h-10 bg-[var(--surface-2)] border-b border-[var(--border)] px-4 flex items-center justify-between shrink-0 select-none">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              </div>
              <span className="text-[10px] font-bold text-[var(--text-3)] font-mono tracking-wider">SENTINELOS SECURE OPERATIONS PREVIEW</span>
              <span className="text-[10px] font-mono text-[var(--text-3)]">SYSTEM: ONLINE</span>
            </div>

            {/* Content Body */}
            <div className="flex-1 bg-[var(--bg)] flex overflow-hidden relative">
              
              {/* Tab 1: Matrix */}
              {activeMockupTab === 'matrix' && (
                <div className="flex-1 grid grid-cols-2 gap-4 p-4">
                  <div className="border border-[var(--border)] bg-[var(--surface)] rounded-xl p-3 flex flex-col justify-between relative overflow-hidden group">
                    <div className="flex justify-between items-center text-[10px] font-bold text-[var(--text-2)] uppercase tracking-wider mb-2 z-10">
                      <span>CCTV 01 · Warehouse</span>
                      <span className="flex items-center gap-1 text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-50 animate-pulse" />
                        Fire Detected
                      </span>
                    </div>
                    <div className="flex-1 rounded-lg bg-[var(--surface-2)]/30 border border-[var(--border)] flex items-center justify-center overflow-hidden relative aspect-video">
                      <div className="absolute inset-0 bg-rose-500/5 pointer-events-none" />
                      <div className="absolute border-2 border-rose-500 w-28 h-20 top-8 left-12 flex flex-col justify-between p-1 bg-rose-500/10">
                        <span className="text-[8px] font-bold text-white bg-rose-500 px-1 rounded-sm w-fit leading-none py-0.5">FIRE 96%</span>
                      </div>
                    </div>
                  </div>

                  <div className="border border-[var(--border)] bg-[var(--surface)] rounded-xl p-3 flex flex-col justify-between relative overflow-hidden group">
                    <div className="flex justify-between items-center text-[10px] font-bold text-[var(--text-2)] uppercase tracking-wider mb-2 z-10">
                      <span>CCTV 02 · Server Room</span>
                      <span className="flex items-center gap-1 text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        Active
                      </span>
                    </div>
                    <div className="flex-1 rounded-lg bg-[var(--surface-2)]/30 border border-[var(--border)] flex items-center justify-center overflow-hidden relative aspect-video">
                      <div className="text-[9px] font-mono text-[var(--text-3)]">[ CCTV ACTIVE STREAM ]</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Detections */}
              {activeMockupTab === 'fire' && (
                <div className="flex-1 flex flex-col md:flex-row gap-4 p-4 overflow-hidden">
                  <div className="flex-1 border border-[var(--border)] bg-[var(--surface)] rounded-xl p-4 flex flex-col gap-3">
                    <h4 className="text-[11px] font-bold text-[var(--text-2)] uppercase tracking-widest">Active Incident History</h4>
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                      {mockLiveAlerts.map(al => (
                        <div key={al.id} className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] flex items-center justify-between text-xs hover:border-[var(--border-strong)] transition-all">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${al.type === 'fire' ? 'bg-rose-500 animate-pulse' : al.type === 'smoke' ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                              <span className="font-bold text-[var(--text)] capitalize">{al.type} Alert</span>
                              <span className="font-mono text-[10px] text-[var(--text-3)]">{al.conf}</span>
                            </div>
                            <p className="text-[10px] text-[var(--text-2)]">{al.cam}</p>
                          </div>
                          <span className="font-mono text-[9px] text-[var(--text-3)]">{al.time}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="w-full md:w-64 border border-[var(--border)] bg-[var(--surface)] rounded-xl p-4 flex flex-col justify-between shrink-0">
                    <div className="space-y-4">
                      <div className="flex items-center gap-1.5">
                        <ShieldAlert className="text-rose-500 w-4 h-4" />
                        <h4 className="text-[11px] font-bold text-[var(--text-2)] uppercase tracking-widest">Core Engine Diagnostics</h4>
                      </div>
                      <div className="space-y-2 text-xs font-semibold text-[var(--text-2)]">
                        <div className="flex justify-between border-b border-[var(--border)] pb-1.5">
                          <span>AI Engine Core:</span>
                          <span className="text-[var(--text)] font-semibold">Active & Armed</span>
                        </div>
                        <div className="flex justify-between border-b border-[var(--border)] pb-1.5">
                          <span>Inference Latency:</span>
                          <span className="text-[var(--text)] font-mono">12 ms</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Precision Rate:</span>
                          <span className="text-[var(--text)] font-mono">99.4%</span>
                        </div>
                      </div>
                    </div>
                    <button 
                      onClick={() => navigate('/login')}
                      className="w-full py-2 bg-sky-600 text-white font-bold rounded-xl text-xs hover:bg-sky-700 transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      Authenticate and Resolve <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              )}

              {/* Tab 3: Analytics */}
              {activeMockupTab === 'analytics' && (
                <div className="flex-1 p-4 flex flex-col gap-4 overflow-hidden">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-[var(--surface)] border border-[var(--border)] p-3 rounded-xl">
                      <p className="text-[9px] font-bold text-[var(--text-3)] uppercase tracking-wider">Total Alerts</p>
                      <p className="text-xl font-bold font-mono text-[var(--text)] mt-1">1,482</p>
                    </div>
                    <div className="bg-[var(--surface)] border border-[var(--border)] p-3 rounded-xl">
                      <p className="text-[9px] font-bold text-[var(--text-3)] uppercase tracking-wider">Online Cameras</p>
                      <p className="text-xl font-bold font-mono text-[var(--text)] mt-1">4 Active</p>
                    </div>
                    <div className="bg-[var(--surface)] border border-[var(--border)] p-3 rounded-xl">
                      <p className="text-[9px] font-bold text-[var(--text-3)] uppercase tracking-wider">Motion Filter Savings</p>
                      <p className="text-xl font-bold font-mono text-[var(--text)] mt-1">72.4%</p>
                    </div>
                  </div>
                  <div className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex items-center justify-center">
                    <div className="text-center space-y-1">
                      <Activity size={24} className="mx-auto text-sky-500 mb-1" />
                      <p className="text-xs font-bold text-[var(--text-2)]">Real-time analytical graphs simulation active</p>
                      <p className="text-[10px] text-[var(--text-3)]">Integrates Recharts area layers on standard metrics</p>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </section>

        {/* Feature Grid */}
        <motion.section 
          id="features" 
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
          className="space-y-12 pt-8"
        >
          <div className="text-center max-w-xl mx-auto space-y-3">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">Enterprise Ingestion & Detection</h2>
            <p className="text-xs sm:text-sm text-[var(--text-2)] font-semibold leading-relaxed">
              FireGuard AI layers directly over existing security environments with zero hardware lock-in.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f, i) => (
              <motion.div 
                key={i} 
                variants={fadeInUp}
                whileHover={{ y: -6, transition: { duration: 0.2 } }}
                className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] hover:border-sky-300 dark:hover:border-sky-900 hover:shadow-md transition-all space-y-4"
              >
                <div className="p-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] w-fit text-sky-600">
                  {f.icon}
                </div>
                <h3 className="font-bold text-sm tracking-tight text-[var(--text)]">{f.title}</h3>
                <p className="text-xs text-[var(--text-2)] font-semibold leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Dynamic Showcase Section (Introduction to Features) */}
        <motion.section 
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={scaleIn}
          className="grid grid-cols-1 md:grid-cols-2 gap-12 py-8 border-y border-[var(--border)] items-center"
        >
          <div className="space-y-5">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">Continuous AI Live Feed Analysis</h2>
            <p className="text-xs sm:text-sm text-[var(--text-2)] leading-relaxed font-semibold font-medium">
              Our automated command center continuously feeds camera matrices through the inference model. Changes in confidence levels, overlapping bounding boxes, and sudden changes are computed instantly, sending high-precision notifications and warnings without manual tracking.
            </p>
            <div className="space-y-3 pt-2 text-xs font-semibold text-[var(--text-2)]">
              {[
                "Webcam, RTSP stream, and file ingestion supported",
                "Non-intrusive sound alarm notifications and real-time popups",
                "Configurable frame-skipping & preprocessing threshold settings"
              ].map((text, idx) => (
                <div key={idx} className="flex items-center gap-2.5">
                  <CheckCircle size={15} className="text-emerald-500 shrink-0" />
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3 p-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]/30">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-3)] mb-1">SOC Real-Time Log Ingestion</h3>
            <div className="space-y-2.5">
              <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-between text-xs shadow-xs">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                  <span className="font-bold text-rose-600">Fire Alert CAM-01</span>
                </div>
                <span className="font-mono text-[var(--text-3)] text-[10px] font-bold">98% Match</span>
              </div>
              <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-between text-xs shadow-xs">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span className="font-bold text-amber-600">Smoke Alert CAM-02</span>
                </div>
                <span className="font-mono text-[var(--text-3)] text-[10px] font-bold">86% Match</span>
              </div>
              <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-between text-xs opacity-65 shadow-xs">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={12} className="text-emerald-500" />
                  <span className="text-[var(--text-2)]">Routine Diagnostic check</span>
                </div>
                <span className="font-mono text-[var(--text-3)] text-[10px] font-bold">OK</span>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Tech Stack Overview */}
        <section id="tech" className="space-y-12">
          <div className="text-center max-w-xl mx-auto space-y-3">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">Built on Production Standards</h2>
            <p className="text-xs sm:text-sm text-[var(--text-2)] font-semibold leading-relaxed">
              We leverage modern enterprise frameworks to guarantee sub-15ms AI processing loops.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { icon: <Cpu className="w-6 h-6 text-sky-500 mx-auto" />, name: "Neural Vision Core", desc: "Hazard & anomaly classifier" },
              { icon: <HardDrive className="w-6 h-6 text-blue-500 mx-auto" />, name: "FastAPI Routing", desc: "High performance Python API" },
              { icon: <Terminal className="w-6 h-6 text-emerald-500 mx-auto" />, name: "Vite + React 19", desc: "Premium single-page web app" },
              { icon: <Shield className="w-6 h-6 text-rose-500 mx-auto" />, name: "Granular RBAC", desc: "SQLite database constraint logs" }
            ].map((stack, idx) => (
              <div key={idx} className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] space-y-3 shadow-xs">
                <div className="mb-2">{stack.icon}</div>
                <h4 className="text-xs font-bold text-[var(--text)]">{stack.name}</h4>
                <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider">{stack.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Frequently Asked Questions (FAQ Accordion) */}
        <section id="faq" className="space-y-8 max-w-3xl mx-auto pt-8">
          <div className="text-center space-y-3">
            <HelpCircle className="w-7 h-7 text-sky-500 mx-auto animate-bounce-slow" />
            <h2 className="text-2xl font-bold tracking-tight text-[var(--text)]">Frequently Asked Questions</h2>
            <p className="text-xs text-[var(--text-2)] font-semibold">Answers to general platform diagnostics and integration details.</p>
          </div>
          
          <div className="space-y-4">
            {faqs.map((faq, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div 
                  key={idx} 
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden transition-all duration-200 shadow-xs"
                >
                  <button
                    onClick={() => toggleFaq(idx)}
                    className="w-full flex items-center justify-between p-5 text-left text-xs sm:text-sm font-bold text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors select-none"
                  >
                    <span>{faq.q}</span>
                    <span className="text-[var(--text-3)] shrink-0 ml-4">
                      {isOpen ? <Minus size={15} /> : <Plus size={15} />}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-5 pt-1 text-xs text-[var(--text-2)] font-semibold leading-relaxed border-t border-[var(--border)] bg-[var(--surface-2)]/30">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Footer Call to Action */}
        <section className="rounded-3xl border border-[var(--border-strong)] bg-[var(--surface)] p-8 sm:p-12 text-center max-w-4xl mx-auto space-y-6 relative overflow-hidden shadow-xl">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-radial from-sky-500/10 to-transparent opacity-35 blur-xl pointer-events-none" />
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--text)]">Begin securing your workspace today</h2>
          <p className="text-xs sm:text-sm text-[var(--text-2)] max-w-md mx-auto leading-relaxed font-semibold">
            Integrate local webcam feeds or link remote RTSP streams immediately inside the main operations dashboard.
          </p>
          <div className="flex justify-center pt-2">
            <button 
              onClick={() => navigate('/login')}
              className="px-6 py-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-xs font-bold text-white transition-all shadow-md cursor-pointer flex items-center gap-1.5 active:scale-[0.98]"
            >
              Access Dashboard <ArrowRight size={13} />
            </button>
          </div>
        </section>
      </main>

      {/* Enterprise SaaS Multi-column Footer */}
      <footer className="bg-[var(--surface-2)]/50 border-t border-[var(--border)] py-12 text-xs text-[var(--text-2)] select-none">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          <div className="space-y-4">
            <div className="flex items-center gap-2 font-bold select-none">
              <div className="w-6 h-6 rounded-lg bg-sky-600 flex items-center justify-center shrink-0">
                <Shield size={12} className="text-white fill-white" />
              </div>
              <span className="text-sm font-semibold tracking-tight text-[var(--text)]">FireGuard AI</span>
            </div>
            <p className="text-[10px] text-[var(--text-3)] font-semibold leading-relaxed">
              Sub-second anomaly tracking powered by lightweight computer vision layers.
            </p>
          </div>
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)] mb-3">Product</h4>
            <ul className="space-y-2 font-semibold">
              <li><span className="hover:text-[var(--text)] cursor-pointer">Live Matrix</span></li>
              <li><span className="hover:text-[var(--text)] cursor-pointer">Threat Detection</span></li>
              <li><span className="hover:text-[var(--text)] cursor-pointer">Settings Panel</span></li>
            </ul>
          </div>
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)] mb-3">Resources</h4>
            <ul className="space-y-2 font-semibold">
              <li><span className="hover:text-[var(--text)] cursor-pointer" onClick={() => navigate('/documentation')}>API Specs</span></li>
              <li><span className="hover:text-[var(--text)] cursor-pointer">System Logs</span></li>
              <li><span className="hover:text-[var(--text)] cursor-pointer">Audit Logs</span></li>
            </ul>
          </div>
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)] mb-3">Contact</h4>
            <ul className="space-y-2 font-semibold">
              <li><span className="hover:text-[var(--text)] cursor-pointer">dispatch@sentinelos.ai</span></li>
              <li><span className="hover:text-[var(--text)] cursor-pointer">System Operator</span></li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 border-t border-[var(--border)] pt-6 flex flex-col sm:flex-row items-center justify-between text-[10px] text-[var(--text-3)] font-semibold">
          <span>&copy; {new Date().getFullYear()} FireGuard AI, Inc. All rights reserved.</span>
          <div className="flex gap-4 mt-2 sm:mt-0">
            <span className="hover:text-[var(--text-2)] cursor-pointer">Privacy Policy</span>
            <span className="hover:text-[var(--text-2)] cursor-pointer">Terms of Service</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
