import { useNavigate } from 'react-router-dom';
import { Flame, Shield, Activity, Video, ArrowRight, Database, Server, Cpu } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

const Landing = () => {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const features = [
    { icon: <Flame className="w-5 h-5 text-red-500" />, title: 'Real-time YOLOv8 AI', desc: 'Custom vision models identify active fire & smoke incidents with millisecond latency.' },
    { icon: <Activity className="w-5 h-5 text-orange-500" />, title: 'SOC Console', desc: 'Integrated console displaying real-time warning indicators, live feeds, and alerts feed.' },
    { icon: <Video className="w-5 h-5 text-blue-500" />, title: 'Multi-stream CCTV Grid', desc: 'CCTV feed processing, deep linking parameters, and simple fullscreen camera grids.' },
    { icon: <Shield className="w-5 h-5 text-green-500" />, title: 'Audited Incident Log', desc: 'Instant warning flags trigger evidence captures, database audits, and PDF tickets.' },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans relative overflow-x-hidden selection:bg-blue-100 dark:selection:bg-blue-900/30">
      
      {/* Header bar */}
      <header className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between border-b border-[var(--border)]">
        <div className="flex items-center gap-2 text-red-500 font-bold select-none cursor-pointer" onClick={() => navigate('/')}>
          <Flame size={16} className="fill-current" />
          <span className="text-sm font-bold text-[var(--text)]">FireGuard AI</span>
        </div>
        <div className="flex items-center gap-4">
          {isAuthenticated ? (
            <button 
              onClick={() => navigate('/dashboard')}
              className="px-3.5 py-1.5 rounded-md bg-[#2383e2] hover:bg-[#1a6ec2] text-white font-medium text-xs tracking-wide transition-colors cursor-pointer flex items-center gap-1"
            >
              Go to Console <ArrowRight size={12} />
            </button>
          ) : (
            <>
              <button 
                onClick={() => navigate('/login')}
                className="text-xs font-semibold text-[var(--text-2)] hover:text-[var(--text)] cursor-pointer"
              >
                Log in
              </button>
              <button 
                onClick={() => navigate('/register')}
                className="px-3.5 py-1.5 rounded-md bg-[#2383e2] hover:bg-[#1a6ec2] text-white font-medium text-xs transition-all cursor-pointer"
              >
                Get FireGuard free
              </button>
            </>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-20 text-center space-y-6">
        {/* Notion header avatar block */}
        <div className="flex justify-center items-center gap-1.5 py-2 select-none pointer-events-none">
          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-center justify-center text-red-500 font-bold">
            🔥
          </div>
          <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-900/50 flex items-center justify-center text-orange-500 font-bold">
            🛡️
          </div>
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 flex items-center justify-center text-blue-500 font-bold">
            👁️
          </div>
        </div>

        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-[var(--text)] leading-tight max-w-3xl mx-auto">
          Where fire safety and <br />
          <span className="underline decoration-[#2383e2] decoration-4 underline-offset-4">AI jam together.</span>
        </h1>

        <p className="text-[var(--text-2)] text-base md:text-lg max-w-xl mx-auto font-normal leading-relaxed">
          Capture context, find answers, and automate security tasks with computer vision built for your operations team.
        </p>

        <div className="flex justify-center gap-3 pt-2">
          <button
            onClick={() => navigate(isAuthenticated ? '/dashboard' : '/login')}
            className="px-5 py-2 rounded-md bg-[#2383e2] hover:bg-[#1a6ec2] text-white font-semibold text-xs uppercase tracking-wider transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            Get FireGuard free <ArrowRight size={13} />
          </button>
          <button
            onClick={() => navigate('/login')}
            className="px-5 py-2 rounded-md bg-[var(--bg-alt)] hover:bg-black/[0.05] dark:hover:bg-white/[0.05] border border-[var(--border)] text-[var(--text)] font-semibold text-xs uppercase tracking-wider transition-colors cursor-pointer"
          >
            Request a demo
          </button>
        </div>

        {/* Flat Dashboard Preview Panel */}
        <div className="mt-16 border border-[var(--border)] bg-[var(--bg-alt)] rounded-lg p-3 shadow-sm max-w-4xl mx-auto relative overflow-hidden">
          <div className="h-5 flex items-center gap-1.5 border-b border-[var(--border)] pb-3 px-1 select-none">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]"></span>
            <span className="text-[9px] font-mono text-[var(--muted)] ml-3">FIREGUARD_WORKSPACE_DASHBOARD_LIVE</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 text-left">
            <div className="md:col-span-2 rounded-lg bg-[var(--bg)] aspect-video relative overflow-hidden border border-[var(--border)] flex items-center justify-center select-none font-mono text-[10px] text-[var(--muted)]">
              [ CCTV CAMERA STREAM INGEST SIMULATOR ]
              <div className="absolute inset-0 border border-red-500/40 m-6 rounded-lg flex items-start p-2 bg-red-500/5">
                <span className="px-1.5 py-0.5 rounded bg-red-500 text-[8px] font-bold text-white uppercase tracking-wider">FIRE 96%</span>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)] space-y-1">
                <p className="text-[9px] text-[var(--muted)] font-bold uppercase tracking-wider">System Threat Status</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                  <span className="text-red-500 font-bold text-xs font-mono uppercase">Threat Discovered</span>
                </div>
              </div>
              <div className="p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)] space-y-2 flex-1 flex flex-col justify-center font-mono text-[10px] text-[var(--text-2)]">
                <div className="flex justify-between border-b border-[var(--border)] pb-1"><span>Model:</span><span className="text-orange-500 font-bold">YOLOv8s</span></div>
                <div className="flex justify-between border-b border-[var(--border)] pb-1"><span>Latency:</span><span>24ms</span></div>
                <div className="flex justify-between border-b border-[var(--border)] pb-1"><span>Status:</span><span className="text-red-500 font-bold">Alerting</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="max-w-5xl mx-auto px-6 py-16 border-t border-[var(--border)]">
        <h2 className="text-xl font-bold text-center mb-12 text-[var(--text)]">Designed for modern security operations</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {features.map((f, i) => (
            <div
              key={i}
              className="p-5 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-alt)] transition-colors duration-150 flex flex-col gap-3"
            >
              <div className="w-8 h-8 rounded bg-[var(--bg-alt)] border border-[var(--border)] flex items-center justify-center shrink-0">
                {f.icon}
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-xs text-[var(--text)]">{f.title}</h3>
                <p className="text-[11px] text-[var(--text-2)] leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Technology & Architecture Section */}
      <section className="max-w-5xl mx-auto px-6 py-16 border-t border-[var(--border)]">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-[var(--text)]">Platform Infrastructure</h2>
            <p className="text-xs text-[var(--text-2)] leading-relaxed font-medium">
              FireGuard AI processes video feeds locally or in private networks with minimal computing footprints. The server communicates warning events to your operations team via real-time sockets.
            </p>
            <div className="space-y-4 pt-2">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded bg-[var(--bg-alt)] border border-[var(--border)] flex items-center justify-center shrink-0">
                  <Database size={14} className="text-zinc-500" />
                </div>
                <div>
                  <h4 className="font-bold text-xs text-[var(--text)]">SQL Database Persistence</h4>
                  <p className="text-[10px] text-[var(--text-2)] mt-0.5">Logs and index records are persisted in a fast, robust database.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded bg-[var(--bg-alt)] border border-[var(--border)] flex items-center justify-center shrink-0">
                  <Server size={14} className="text-zinc-500" />
                </div>
                <div>
                  <h4 className="font-bold text-xs text-[var(--text)]">FastAPI Telemetry</h4>
                  <p className="text-[10px] text-[var(--text-2)] mt-0.5">Pushes instantaneous alert updates to active browsers over WebSockets.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded bg-[var(--bg-alt)] border border-[var(--border)] flex items-center justify-center shrink-0">
                  <Cpu size={14} className="text-zinc-500" />
                </div>
                <div>
                  <h4 className="font-bold text-xs text-[var(--text)]">YOLOv8 Pre-trained Network</h4>
                  <p className="text-[10px] text-[var(--text-2)] mt-0.5">Identifies bounding boxes and fire probability scores in real-time.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="p-6 rounded-lg bg-[var(--bg-alt)] border border-[var(--border)] font-mono text-[10px] text-[var(--text-2)] space-y-4 shadow-sm">
            <h3 className="font-bold text-[var(--text)] border-b border-[var(--border)] pb-2 text-xs flex items-center gap-1.5 select-none">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              Threat Ingestion Pipeline Flow
            </h3>
            <div className="space-y-3.5 border-l border-[var(--border)] pl-4 ml-2">
              <div className="relative">
                <div className="absolute -left-6 top-1 w-4 h-4 rounded bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center font-sans text-[8px] font-bold text-[var(--text)]">1</div>
                <p className="font-bold text-[var(--text)]">Ingestion</p>
                <p className="text-[9px] mt-0.5">Video payloads or camera feeds are captured and sliced into frame intervals.</p>
              </div>
              <div className="relative">
                <div className="absolute -left-6 top-1 w-4 h-4 rounded bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center font-sans text-[8px] font-bold text-[var(--text)]">2</div>
                <p className="font-bold text-[var(--text)]">AI Core Inference</p>
                <p className="text-[9px] mt-0.5">YOLOv8 process analyzes frames and calculates fire/smoke confidence metrics.</p>
              </div>
              <div className="relative">
                <div className="absolute -left-6 top-1 w-4 h-4 rounded bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center font-sans text-[8px] font-bold text-[var(--text)]">3</div>
                <p className="font-bold text-[var(--text)]">Telemetry Broadcast</p>
                <p className="text-[9px] mt-0.5">Active logs save to local store, and alert updates push via active socket.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] bg-[var(--bg-alt)] py-10 px-6 mt-16 select-none">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text)] font-bold">
            <Flame size={14} className="text-red-500 fill-current" />
            <span>FireGuard AI</span>
          </div>
          <div className="flex flex-wrap justify-center gap-4 text-[11px] text-[var(--text-2)] font-semibold uppercase tracking-wider">
            <button onClick={() => navigate('/documentation')} className="hover:text-[var(--text)] transition-colors cursor-pointer">Documentation</button>
            <span className="text-[var(--border)]">|</span>
            <span className="text-[var(--muted)] normal-case font-normal">© {new Date().getFullYear()} FireGuard AI. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
