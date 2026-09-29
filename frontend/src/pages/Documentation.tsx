import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  Shield, ArrowLeft, Key, BookOpen, Terminal, 
  Network, Cpu, Info, Database, Zap 
} from 'lucide-react';
import InteractiveArchitectureFlow from '../components/Architecture/InteractiveArchitectureFlow';

const Documentation = () => {
  const navigate = useNavigate();

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 100 } },
  };

  const credentials = [
    { role: 'Administrator', email: 'admin@sentinelos.ai', password: 'Admin@123', permissions: 'Full access + Admin Panel + System Settings' },
    { role: 'Operator', email: 'operator@sentinelos.ai', password: 'Operator@123', permissions: 'Live Monitoring + Camera Management + Trigger Detections' },
    { role: 'Viewer', email: 'viewer@sentinelos.ai', password: 'Viewer@123', permissions: 'Read-only SOC Dashboard + Incident reports' },
  ];

  const apiEndpoints = [
    { method: 'POST', path: '/api/v1/auth/login', desc: 'Authenticate and receive session token' },
    { method: 'GET', path: '/api/v1/cameras', desc: 'List all registered CCTV cameras' },
    { method: 'POST', path: '/api/v1/upload/image', desc: 'Upload image for neural vision AI inference & trigger alert' },
    { method: 'POST', path: '/api/v1/upload/video', desc: 'Upload video to group detections by class type' },
    { method: 'GET', path: '/api/v1/alerts', desc: 'Retrieve recent active and resolved alert events' },
    { method: 'GET', path: '/api/v1/admin/health', desc: 'Fetch system health, active sessions & database status' },
  ];

  return (
    <div className="min-h-screen bg-[#06060a] text-gray-100 selection:bg-red-500 selection:text-white relative overflow-x-hidden">
      {/* Background gradients */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-red-500/5 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-orange-500/5 rounded-full blur-[150px] pointer-events-none"></div>

      {/* Header */}
      <header className="border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2.5 text-red-500 font-bold text-xl tracking-tight select-none">
          <Shield className="w-6 h-6 fill-current animate-pulse" />
          <span>FireGuard AI</span>
        </div>
        <button 
          onClick={() => navigate('/')}
          className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 font-semibold text-sm transition-all flex items-center gap-2 cursor-pointer"
        >
          <ArrowLeft size={16} /> Back to Homepage
        </button>
      </header>

      {/* Body Content */}
      <main className="max-w-5xl mx-auto px-6 py-12">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-12"
        >
          {/* Page Title */}
          <motion.div variants={itemVariants} className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
              System Documentation
            </h1>
            <p className="text-gray-400 text-lg max-w-3xl">
              Understand the layout, setup credentials, APIs, and model pipeline configurations of the FireGuard AI Platform.
            </p>
          </motion.div>

          {/* Demo Credentials */}
          <motion.section variants={itemVariants} className="space-y-4">
            <h2 className="text-2xl font-bold flex items-center gap-2 text-white">
              <Key className="w-6 h-6 text-red-500" /> Demo Credentials
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {credentials.map((cred) => (
                <div key={cred.role} className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all flex flex-col gap-4">
                  <span className="px-3 py-1 self-start rounded-lg bg-red-500/10 border border-red-500/20 text-xs font-bold text-red-400 uppercase tracking-wider">
                    {cred.role}
                  </span>
                  <div className="space-y-2 text-sm">
                    <p className="text-gray-400">Email: <span className="text-white font-medium select-all">{cred.email}</span></p>
                    <p className="text-gray-400">Password: <span className="text-white font-medium select-all">{cred.password}</span></p>
                  </div>
                  <div className="pt-2 border-t border-white/5 text-xs text-gray-500 leading-relaxed">
                    {cred.permissions}
                  </div>
                </div>
              ))}
            </div>
          </motion.section>

          {/* Quick Start Guide */}
          <motion.section variants={itemVariants} className="space-y-4">
            <h2 className="text-2xl font-bold flex items-center gap-2 text-white">
              <BookOpen className="w-6 h-6 text-orange-500" /> Quick Start Guide
            </h2>
            <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/5 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <h3 className="font-bold text-lg text-white flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-gray-400" /> 1. Run Backend Server
                  </h3>
                  <pre className="bg-black/50 border border-white/5 p-4 rounded-xl text-xs font-mono text-gray-300 leading-loose select-all">
{`cd backend
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --reload`}
                  </pre>
                </div>
                <div className="space-y-4">
                  <h3 className="font-bold text-lg text-white flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-gray-400" /> 2. Run Frontend client
                  </h3>
                  <pre className="bg-black/50 border border-white/5 p-4 rounded-xl text-xs font-mono text-gray-300 leading-loose select-all">
{`cd frontend
npm install
npm run dev`}
                  </pre>
                </div>
              </div>
            </div>
          </motion.section>

          {/* Interactive Detection Pipeline Architecture */}
          <motion.section variants={itemVariants} className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold flex items-center gap-2 text-white">
                <Zap className="w-6 h-6 text-amber-500" /> Detection Pipeline & Evidence Fusion
              </h2>
              <span className="px-3 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-mono">
                Dual-Stream Engine
              </span>
            </div>

            {/* Interactive Architecture Widget */}
            <InteractiveArchitectureFlow />

            {/* ASCII & Structural Architecture View */}
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4">
              <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider font-mono flex items-center gap-2">
                <Network className="w-4 h-4 text-indigo-400" /> Pipeline Topology ASCII Map
              </h3>
              <pre className="bg-black/60 border border-white/5 p-5 rounded-xl text-xs font-mono text-amber-300 leading-relaxed overflow-x-auto select-all">
{`                    CAMERA FRAME
                         │
              ┌──────────┴──────────┐
              │                     │
           YOLO26m                OpenCV CV
              │                     │
       Fire / Smoke          Color + Motion
       normal objects        + Flicker + Sparks
              │                     │
              └──────────┬──────────┘
                         ↓
                 EVIDENCE FUSION
                         ↓
              TEMPORAL VERIFICATION
                         ↓
              ┌──────────┼──────────┐
              ↓          ↓          ↓
           NORMAL      FAR FIRE    SPARK /
            FIRE       CANDIDATE   OCCLUDED
              │          │          │
              └──────────┴──────────┘
                         ↓
                    ALERT ENGINE
                         ↓
                  GREEN / YELLOW / RED`}
              </pre>
            </div>
          </motion.section>

          {/* Core System Architecture */}
          <motion.section variants={itemVariants} className="space-y-4">
            <h2 className="text-2xl font-bold flex items-center gap-2 text-white">
              <Network className="w-6 h-6 text-indigo-500" /> System Architecture & Microservices
            </h2>
            <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/5 grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <Cpu className="w-5 h-5 text-indigo-400" />
                </div>
                <h3 className="font-bold text-white">Neural Vision AI Inference</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  FastAPI acts as the local computer vision pipeline. The model parses frames, applies Non-Maximum Suppression (NMS), and generates confidence thresholds.
                </p>
              </div>
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-red-400" />
                </div>
                <h3 className="font-bold text-white">Real-Time WebSockets</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  As soon as fire or smoke triggers an alert on the server, a WebSocket client broadcasts the alert metadata and evidence image directly to the React SOC Dashboard.
                </p>
              </div>
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                  <Database className="w-5 h-5 text-green-400" />
                </div>
                <h3 className="font-bold text-white">Database & Seeding</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  A modular SQLite integration manages threat databases, user session tokens, camera statuses, system audit logs, and incident escalation queues.
                </p>
              </div>
            </div>
          </motion.section>

          {/* API Endpoints */}
          <motion.section variants={itemVariants} className="space-y-4">
            <h2 className="text-2xl font-bold flex items-center gap-2 text-white">
              <Info className="w-6 h-6 text-teal-500" /> Primary API Endpoints
            </h2>
            <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.02] text-xs font-bold text-gray-400 uppercase tracking-wider">
                      <th className="px-6 py-4">Method</th>
                      <th className="px-6 py-4">Endpoint</th>
                      <th className="px-6 py-4">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-sm text-gray-300">
                    {apiEndpoints.map((endpoint, i) => (
                      <tr key={i} className="hover:bg-white/[0.01] transition-colors">
                        <td className="px-6 py-4 font-mono font-bold">
                          <span className={`px-2.5 py-0.5 rounded text-xs uppercase
                            ${endpoint.method === 'POST' ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                            : endpoint.method === 'PATCH' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
                            {endpoint.method}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-mono text-white select-all">{endpoint.path}</td>
                        <td className="px-6 py-4 text-gray-400">{endpoint.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.section>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-8 border-t border-white/5 mt-16 text-center text-xs text-gray-600">
        &copy; {new Date().getFullYear()} FireGuard AI. All rights reserved.
      </footer>
    </div>
  );
};

export default Documentation;
