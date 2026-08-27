import { useNavigate } from 'react-router-dom';
import { Flame, Shield, Activity, Video, ArrowRight, Zap, Play, CheckCircle, Database, Server, Cpu } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuthStore } from '../store/authStore';

const Landing = () => {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.15 } },
  };

  const itemVariants = {
    hidden: { y: 30, opacity: 0 },
    visible: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 100 } },
  };

  const features = [
    { icon: <Flame className="w-8 h-8 text-red-500" />, title: 'Real-time YOLOv8 AI', desc: 'Pre-trained state-of-the-art vision models detect fire & smoke incidents with millisecond latency.' },
    { icon: <Activity className="w-8 h-8 text-orange-500" />, title: 'SOC Command Center', desc: 'Integrated security operations panel displaying active alert queues, camera status grids, and stats.' },
    { icon: <Video className="w-8 h-8 text-indigo-500" />, title: 'Multi-stream RTSP Grid', desc: 'RTSP CCTV stream feed processing, deep linking stream parameters, and full-screen view grids.' },
    { icon: <Shield className="w-8 h-8 text-green-500" />, title: 'Audited Incident Log', desc: 'Every threat triggers alert banners, audible alarms, automatic evidence snapshots, and incident tickets.' },
  ];

  return (
    <div className="min-h-screen bg-[#06060a] text-gray-100 selection:bg-red-500 selection:text-white overflow-hidden relative">
      {/* Background Gradient Mesh */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-red-500/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-orange-500/5 rounded-full blur-[150px] pointer-events-none"></div>

      {/* Header */}
      <header className="border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2.5 text-red-500 font-bold text-xl tracking-tight select-none">
          <Flame className="w-6 h-6 fill-current animate-pulse" />
          <span>FireGuard<span className="text-white font-black ml-1">AI</span></span>
        </div>
        <div className="flex items-center gap-4">
          {isAuthenticated ? (
            <button 
              onClick={() => navigate('/dashboard')}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400 font-semibold text-sm transition-all duration-200 shadow-[0_0_15px_rgba(239,68,68,0.3)] flex items-center gap-2 cursor-pointer"
            >
              Go to Console <ArrowRight size={16} />
            </button>
          ) : (
            <>
              <button 
                onClick={() => navigate('/login')}
                className="text-sm font-semibold text-gray-300 hover:text-white transition-colors cursor-pointer"
              >
                Sign In
              </button>
              <button 
                onClick={() => navigate('/register')}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 font-semibold text-sm transition-all cursor-pointer"
              >
                Register
              </button>
            </>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 pt-20 pb-24 text-center relative z-10">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          <motion.div variants={itemVariants} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-xs font-semibold text-red-400 tracking-wide">
            <Zap size={12} className="fill-current animate-bounce" /> V1.0.0 Enterprise Release
          </motion.div>

          <motion.h1 variants={itemVariants} className="text-5xl md:text-7xl font-extrabold tracking-tight bg-gradient-to-r from-white via-gray-200 to-gray-500 bg-clip-text text-transparent max-w-4xl mx-auto leading-none">
            Next-Gen AI Fire & Smoke <br />
            <span className="bg-gradient-to-r from-red-500 via-orange-500 to-yellow-500 bg-clip-text text-transparent">SOC Threat Detection</span>
          </motion.h1>

          <motion.p variants={itemVariants} className="text-gray-400 text-lg md:text-xl max-w-2xl mx-auto font-medium">
            Deploy local or cloud-based computer vision monitoring across your CCTV, live camera feeds, images, and videos. Instant alarms, audit trails, and automated escalation.
          </motion.p>

          <motion.div variants={itemVariants} className="flex flex-wrap justify-center gap-4 pt-6">
            <button
              onClick={() => navigate(isAuthenticated ? '/dashboard' : '/login')}
              className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400 font-bold text-base transition-all duration-200 shadow-[0_0_20px_rgba(239,68,68,0.4)] flex items-center gap-2 cursor-pointer hover:scale-[1.02]"
            >
              Start Monitoring <ArrowRight size={18} />
            </button>
            <button
              onClick={() => navigate('/documentation')}
              className="px-8 py-3.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 font-bold text-base transition-all flex items-center gap-2 cursor-pointer"
            >
              <Play size={16} /> View Docs
            </button>
          </motion.div>
        </motion.div>

        {/* Mockup Dashboard */}
        <motion.div 
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5, type: 'spring', stiffness: 50 }}
          className="mt-16 border border-white/10 bg-[#0e0e15]/60 rounded-3xl p-4 shadow-2xl relative overflow-hidden backdrop-blur-md max-w-5xl mx-auto group"
        >
          <div className="absolute inset-0 bg-gradient-to-tr from-red-500/10 via-transparent to-transparent pointer-events-none"></div>
          <div className="h-6 flex items-center gap-1.5 border-b border-white/5 pb-4 px-2">
            <span className="w-3 h-3 rounded-full bg-rose-500/70"></span>
            <span className="w-3 h-3 rounded-full bg-amber-500/70"></span>
            <span className="w-3 h-3 rounded-full bg-green-500/70"></span>
            <span className="text-[10px] font-mono text-gray-500 ml-4">SOC_LIVE_GRID_CONSOLE_V1.0</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 text-left">
            <div className="md:col-span-2 rounded-2xl bg-[#08080c] aspect-video relative overflow-hidden border border-white/5 flex items-center justify-center">
              <img src="/evidence/test_red.jpg" alt="FireGuard Threat Grid" className="w-full h-full object-cover opacity-75 group-hover:scale-105 transition-transform duration-700" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              <div className="absolute inset-0 border border-red-500/40 m-8 rounded-xl flex items-start p-3 bg-red-950/20">
                <span className="px-2 py-0.5 rounded bg-red-600 text-[10px] font-bold tracking-wider text-white">FIRE 96%</span>
              </div>
              <div className="absolute bottom-4 left-4 flex gap-2">
                <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] font-mono text-gray-300">CAM-01 Warehouse Entrance</span>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1">
                <p className="text-[10px] text-gray-500 font-bold uppercase">System Threat Status</p>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping"></span>
                  <span className="text-red-500 font-bold text-lg font-mono">FIRE DISCOVERED</span>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-2 flex-1">
                <p className="text-[10px] text-gray-500 font-bold uppercase">AI Threat Inference</p>
                <div className="space-y-1 font-mono text-xs text-gray-300">
                  <div className="flex justify-between border-b border-white/5 pb-1"><span>Model:</span><span className="text-orange-400">YOLOv8s</span></div>
                  <div className="flex justify-between border-b border-white/5 pb-1"><span>Inference Time:</span><span>24ms</span></div>
                  <div className="flex justify-between border-b border-white/5 pb-1"><span>Target Class:</span><span className="text-red-500">Fire/Smoke</span></div>
                  <div className="flex justify-between"><span>Active Alerts:</span><span>3 Escalated</span></div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Feature grid */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-white/5 relative z-10">
        <h2 className="text-3xl font-bold text-center mb-12 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Designed for Modern Security Operations</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f, i) => (
            <motion.div
              key={i}
              whileHover={{ y: -8, borderColor: 'rgba(239, 68, 68, 0.2)' }}
              className="p-6 rounded-2xl bg-[#0c0c14]/80 border border-white/5 transition-all duration-200"
            >
              <div className="mb-4">{f.icon}</div>
              <h3 className="font-bold text-lg mb-2 text-white">{f.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Technology & Architecture Section */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-white/5 relative z-10 bg-[#07070c]/50">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <h2 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Enterprise Architecture</h2>
            <p className="text-gray-400 leading-relaxed">
              FireGuard AI is engineered to integrate seamlessly into existing CCTV streams, offering high reliability and minimal resource consumption. The backend leverages FastAPI to stream telemetry while SQLite provides immediate persistence.
            </p>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Database className="w-5 h-5 text-red-500 mt-1" />
                <div>
                  <h4 className="font-semibold text-white">SQL Database Persistence</h4>
                  <p className="text-xs text-gray-400">Stores alert histories, incident tickets, settings overrides, and user audits.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Server className="w-5 h-5 text-orange-500 mt-1" />
                <div>
                  <h4 className="font-semibold text-white">FastAPI Async Telemetry</h4>
                  <p className="text-xs text-gray-400">WebSocket connections stream live threats directly to operations consoles.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Cpu className="w-5 h-5 text-indigo-500 mt-1" />
                <div>
                  <h4 className="font-semibold text-white">YOLOv8 Pre-trained Inference</h4>
                  <p className="text-xs text-gray-400">Optimized frame pipelines process image inputs and live RTSP URLs quickly.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="p-6 rounded-2xl bg-[#0b0b12] border border-white/5 font-mono text-xs text-gray-400 space-y-4">
            <h3 className="font-bold text-white border-b border-white/5 pb-2 text-sm">System Workflow Diagram</h3>
            <div className="space-y-2 border-l border-red-500/30 pl-4 ml-2">
              <div className="relative">
                <div className="absolute -left-6 top-1.5 w-3 h-3 rounded-full bg-red-500"></div>
                <p className="font-bold text-white">1. Input Ingestion</p>
                <p className="text-[10px]">CCTV, Local Webcam, or uploaded Image/Video frame payload</p>
              </div>
              <div className="relative">
                <div className="absolute -left-6 top-1.5 w-3 h-3 rounded-full bg-orange-500"></div>
                <p className="font-bold text-white">2. YOLOv8 Analysis</p>
                <p className="text-[10px]">Model infers threat class (Fire/Smoke) and retrieves conf / bbox coordinate array</p>
              </div>
              <div className="relative">
                <div className="absolute -left-6 top-1.5 w-3 h-3 rounded-full bg-yellow-500"></div>
                <p className="font-bold text-white">3. Alert Broadcasting</p>
                <p className="text-[10px]">Creates active Alert + Incident in DB. Broadcasts WebSocket JSON event to frontend console</p>
              </div>
              <div className="relative">
                <div className="absolute -left-6 top-1.5 w-3 h-3 rounded-full bg-green-500"></div>
                <p className="font-bold text-white">4. Operator Alert & Action</p>
                <p className="text-[10px]">Flashing warnings, alarms, instant dashboard render, exports PDF ticket</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison Section */}
      <section className="max-w-5xl mx-auto px-6 py-20 border-t border-white/5 relative z-10">
        <div className="text-center mb-12">
          <p className="text-xs font-bold text-red-400 tracking-[0.15em] uppercase mb-3">Why FireGuard AI</p>
          <h2 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent mb-4">
            Why FireGuard AI beats manual patrols &amp; basic CCTV
          </h2>
          <p className="text-gray-400 max-w-xl mx-auto">Continuous, automated fire &amp; smoke detection vs spot-checks and passive footage.</p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#0b0b12] overflow-hidden">
          <div className="grid grid-cols-2">
            <div className="px-6 py-5" />
            <div className="px-6 py-5 border-l border-white/10 bg-red-500/5 flex items-center justify-center gap-2">
              <Flame className="w-4 h-4 text-red-500 fill-current" />
              <span className="font-bold text-white text-sm">FireGuard AI</span>
            </div>
          </div>
          {[
            { label: 'Coverage', before: 'Spot-checks; can’t watch every zone', after: 'Every camera, every zone, 24/7' },
            { label: 'When a threat is caught', before: 'At the next patrol — or never', after: 'In real time, before it spreads' },
            { label: 'Detection classes', before: 'Whatever the guard notices', after: 'Fire, smoke — confidence-scored' },
            { label: 'Hardware', before: 'New sensors & smoke alarms', after: 'Runs on your existing CCTV/RTSP' },
            { label: 'Evidence', before: 'Notes / raw footage', after: 'Timestamped snapshot per alert' },
          ].map((row) => (
            <div key={row.label} className="grid grid-cols-2 border-t border-white/5">
              <div className="px-6 py-4 flex flex-col justify-center">
                <p className="text-sm font-semibold text-white">{row.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{row.before}</p>
              </div>
              <div className="px-6 py-4 border-l border-white/10 bg-red-500/5 flex items-center justify-center text-center">
                <p className="text-sm font-semibold text-red-400">{row.after}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing / Demo Section */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-white/5 text-center relative z-10">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent mb-4">Enterprise SaaS Plans</h2>
        <p className="text-gray-400 max-w-xl mx-auto mb-12">Select the deployment structure optimized for your facility size.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 max-w-3xl mx-auto gap-8">
          <div className="p-8 rounded-3xl bg-[#090910] border border-white/5 text-left relative overflow-hidden flex flex-col justify-between min-h-[300px]">
            <div>
              <h3 className="text-xl font-bold text-white">Standard Deployment</h3>
              <p className="text-xs text-gray-500 mt-1">Perfect for single warehouse or office facility.</p>
              <div className="text-3xl font-extrabold text-white mt-6">$299<span className="text-sm font-normal text-gray-500">/mo</span></div>
              <ul className="text-xs text-gray-400 mt-6 space-y-2">
                <li className="flex items-center gap-2"><CheckCircle size={14} className="text-red-500" /> Up to 10 CCTV Stream feeds</li>
                <li className="flex items-center gap-2"><CheckCircle size={14} className="text-red-500" /> Standard YOLOv8 model</li>
                <li className="flex items-center gap-2"><CheckCircle size={14} className="text-red-500" /> Auto-saved screenshot captures</li>
              </ul>
            </div>
            <button onClick={() => navigate('/login')} className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 font-bold text-sm text-center mt-6 transition-colors cursor-pointer">
              Get Started
            </button>
          </div>
          <div className="p-8 rounded-3xl bg-[#0d0d18] border border-red-500/20 text-left relative overflow-hidden flex flex-col justify-between min-h-[300px]">
            <div className="absolute top-0 right-0 px-3 py-1 bg-red-500 text-[10px] font-bold text-white rounded-bl-xl uppercase tracking-wider">Popular</div>
            <div>
              <h3 className="text-xl font-bold text-white">Enterprise Grid</h3>
              <p className="text-xs text-gray-500 mt-1">Full industrial complex monitoring.</p>
              <div className="text-3xl font-extrabold text-white mt-6">$999<span className="text-sm font-normal text-gray-500">/mo</span></div>
              <ul className="text-xs text-gray-400 mt-6 space-y-2">
                <li className="flex items-center gap-2"><CheckCircle size={14} className="text-red-500" /> Unlimited CCTV stream feeds</li>
                <li className="flex items-center gap-2"><CheckCircle size={14} className="text-red-500" /> Fine-tuned YOLOv8 custom weights</li>
                <li className="flex items-center gap-2"><CheckCircle size={14} className="text-red-500" /> Full API access & Swagger controls</li>
                <li className="flex items-center gap-2"><CheckCircle size={14} className="text-red-500" /> Dedicated 24/7 support SLA</li>
              </ul>
            </div>
            <button onClick={() => navigate('/login')} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400 font-bold text-sm text-center text-white mt-6 transition-all cursor-pointer">
              Deploy Enterprise
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-[#030305] py-12 px-6 relative z-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 text-red-500 font-bold text-sm select-none">
            <Flame className="w-5 h-5 fill-current" />
            <span>FireGuard AI v1.0.0</span>
          </div>
          <div className="flex flex-wrap justify-center gap-6 text-xs text-gray-500 font-medium">
            <a href="/documentation" className="hover:text-gray-300 transition-colors">Documentation</a>
            <a href="/about" className="hover:text-gray-300 transition-colors">About Us</a>
            <a href="/faq" className="hover:text-gray-300 transition-colors">FAQs</a>
            <a href="/contact" className="hover:text-gray-300 transition-colors">Contact Support</a>
            <span className="text-gray-600">|</span>
            <span className="text-gray-600">© 2026 FireGuard AI. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
