import { useNavigate } from 'react-router-dom';
import { Flame, Shield, Activity, Video, ArrowRight, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

const Landing = () => {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const features = [
    { 
      icon: <Flame className="w-5 h-5 text-[#eb5757]" />, 
      title: 'YOLOv8 Real-Time AI Inference', 
      desc: 'Custom vision models evaluate camera streams with millisecond latency, minimizing false alarms.' 
    },
    { 
      icon: <Activity className="w-5 h-5 text-[#f2994a]" />, 
      title: 'Operations Command Center', 
      desc: 'High-stress dashboard with warning triggers, live feeds, and real-time telemetry metrics.' 
    },
    { 
      icon: <Video className="w-5 h-5 text-[#006fee]" />, 
      title: 'Multi-Stream CCTV Grid', 
      desc: 'Seamless camera grid systems supporting local webcam captures and RTSP network streams.' 
    },
    { 
      icon: <Shield className="w-5 h-5 text-[#27ae60]" />, 
      title: 'Security Auditing & Escalation', 
      desc: 'Automated logging of threats into an incident reporting workspace with PDF ticket exports.' 
    },
  ];

  return (
    <div className="min-h-screen bg-white text-[#37352f] font-sans relative overflow-x-hidden selection:bg-[#006fee]/10 selection:text-[#006fee]">
      
      {/* Notion-style Top Navigation Header */}
      <header className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between border-b border-[#e9e9e6] relative z-20">
        <div className="flex items-center gap-6">
          {/* Logo */}
          <div className="flex items-center gap-2 font-bold cursor-pointer select-none" onClick={() => navigate('/')}>
            <div className="p-1.5 rounded bg-[#eb5757]/10 text-[#eb5757] border border-[#eb5757]/20 flex items-center justify-center shrink-0">
              <Flame size={15} className="fill-current" />
            </div>
            <span className="text-sm font-bold tracking-tight text-[#37352f]">FireGuard AI</span>
          </div>

          {/* Links (Replicating Notion reference image navigation links) */}
          <nav className="hidden lg:flex items-center gap-5 text-xs font-semibold text-[#7c7b77]">
            <span className="hover:text-[#37352f] cursor-pointer flex items-center gap-0.5">Product <ChevronDown size={11} /></span>
            <span className="hover:text-[#37352f] cursor-pointer flex items-center gap-0.5">Solutions <ChevronDown size={11} /></span>
            <span className="hover:text-[#37352f] cursor-pointer flex items-center gap-0.5">Resources <ChevronDown size={11} /></span>
            <span className="hover:text-[#37352f] cursor-pointer">Developers</span>
            <span className="hover:text-[#37352f] cursor-pointer">Enterprise</span>
            <span className="hover:text-[#37352f] cursor-pointer">Pricing</span>
            <span className="hover:text-[#37352f] cursor-pointer">Request a demo</span>
          </nav>
        </div>

        <div className="flex items-center gap-4 text-xs font-semibold">
          {isAuthenticated ? (
            <button 
              onClick={() => navigate('/dashboard')}
              className="px-3.5 py-1.5 rounded-lg bg-[#006fee] hover:bg-[#005bc5] text-white transition-all cursor-pointer flex items-center gap-1 shadow-sm"
            >
              Command Center <ArrowRight size={12} />
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button 
                onClick={() => navigate('/login')}
                className="px-3 py-1.5 text-[#7c7b77] hover:text-[#37352f] transition-all cursor-pointer"
              >
                Log in
              </button>
              <button 
                onClick={() => navigate('/register')}
                className="px-3.5 py-1.5 rounded-lg bg-[#006fee] hover:bg-[#005bc5] text-white transition-all shadow-sm cursor-pointer"
              >
                Get FireGuard free
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-6xl mx-auto px-6 pt-16 pb-32 relative z-10 space-y-16">
        
        {/* Title, Subtitle, and CTAs (Replicating Notion reference style) */}
        <div className="text-center max-w-3xl mx-auto space-y-6 flex flex-col items-center">
          
          {/* Avatar bubbles representation */}
          <div className="flex -space-x-1.5 overflow-hidden py-2 select-none">
            {['👨‍✈️', '🤖', '👩‍💻', '👮', '👨‍🚒'].map((emoji, idx) => (
              <div key={idx} className="inline-block h-9 w-9 rounded-full bg-[#f7f7f5] border-2 border-white flex items-center justify-center text-lg shadow-sm">
                {emoji}
              </div>
            ))}
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-[1.15] text-[#37352f] max-w-2xl">
            Where safety and agents <span className="bg-[#fff0d4] px-3 py-1 rounded-2xl border border-[#fae8b8] text-[#b38b00] inline-block mt-2">Build together.</span>
          </h1>

          <p className="text-sm sm:text-base text-[#7c7b77] max-w-lg mx-auto font-semibold leading-relaxed">
            Autonomous computer vision pipeline built to scan industrial campuses, factories, and CCTV channels for real-time fire and smoke warnings.
          </p>

          <div className="pt-2 flex justify-center gap-3 font-semibold">
            <button 
              onClick={() => navigate('/login')}
              className="px-5 py-2.5 rounded-lg bg-[#006fee] hover:bg-[#005bc5] text-xs text-white transition-all shadow-sm cursor-pointer flex items-center gap-1.5"
            >
              Get FireGuard free <ArrowRight size={13} />
            </button>
            <button 
              onClick={() => navigate('/documentation')}
              className="px-5 py-2.5 rounded-lg bg-[#efefe5]/50 hover:bg-[#efefe5] border border-[#e9e9e6] text-xs text-[#37352f] transition-all cursor-pointer"
            >
              Request a demo
            </button>
          </div>
        </div>

        {/* Dashboard Mockup (Notion-style clean interface) */}
        <div className="rounded-xl border border-[#e9e9e6] bg-[#f7f7f5] p-3 shadow-md max-w-4xl mx-auto overflow-hidden">
          <div className="rounded-lg bg-white border border-[#e9e9e6] p-4 shadow-sm space-y-4">
            
            {/* Mock Header */}
            <div className="flex items-center justify-between pb-3 border-b border-[#e9e9e6] text-[10px] font-bold text-[#7c7b77]">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#eb5757]" />
                <span className="w-2 h-2 rounded-full bg-[#f2994a]" />
                <span className="w-2 h-2 rounded-full bg-[#27ae60]" />
              </div>
              <span className="uppercase tracking-wider font-mono">WORKSPACE COMMAND MONITOR</span>
            </div>
            
            {/* Mock Dashboard Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-3.5 rounded-lg border border-[#e9e9e6] bg-[#f7f7f5]/30 space-y-1.5">
                <span className="text-[9px] font-bold text-[#eb5757] uppercase tracking-wider">AI Accuracy</span>
                <p className="text-xl font-bold font-mono text-[#37352f]">99.4%</p>
                <div className="w-full h-1 bg-[#e9e9e6] rounded-full overflow-hidden">
                  <div className="h-full bg-[#eb5757] w-[99%]" />
                </div>
              </div>
              <div className="p-3.5 rounded-lg border border-[#e9e9e6] bg-[#f7f7f5]/30 space-y-1.5">
                <span className="text-[9px] font-bold text-[#f2994a] uppercase tracking-wider">Inference Speed</span>
                <p className="text-xl font-bold font-mono text-[#37352f]">12 ms</p>
                <div className="w-full h-1 bg-[#e9e9e6] rounded-full overflow-hidden">
                  <div className="h-full bg-[#f2994a] w-[20%]" />
                </div>
              </div>
              <div className="p-3.5 rounded-lg border border-[#e9e9e6] bg-[#f7f7f5]/30 space-y-1.5">
                <span className="text-[9px] font-bold text-[#006fee] uppercase tracking-wider">Active Channels</span>
                <p className="text-xl font-bold font-mono text-[#37352f]">SECURE</p>
                <div className="w-full h-1 bg-[#e9e9e6] rounded-full overflow-hidden">
                  <div className="h-full bg-[#006fee] w-[100%]" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="space-y-10 pt-10">
          <div className="text-center max-w-xl mx-auto space-y-2">
            <h2 className="text-xl font-bold tracking-tight text-[#37352f]">Enterprise Security Integrations</h2>
            <p className="text-xs text-[#7c7b77] font-semibold">FireGuard layers directly over existing facility monitoring networks.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f, i) => (
              <div key={i} className="p-5 rounded-xl border border-[#e9e9e6] bg-white hover:border-[#7c7b77]/40 hover:shadow-md transition-all space-y-3">
                <div className="p-2.5 rounded-lg bg-[#f7f7f5] border border-[#e9e9e6] w-fit">
                  {f.icon}
                </div>
                <h3 className="font-bold text-xs tracking-tight text-[#37352f]">{f.title}</h3>
                <p className="text-[11px] text-[#7c7b77] font-semibold leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Target Industries */}
        <div className="py-10 border-y border-[#e9e9e6] text-center space-y-4">
          <p className="text-[9px] font-bold uppercase tracking-wider text-[#a4a3a0]">Trusted by Operational Managers</p>
          <div className="flex flex-wrap justify-center gap-4 sm:gap-6 text-[11px] font-semibold text-[#7c7b77]">
            {['Industrial Factories', 'Cargo Airports', 'Logistics Warehouses', 'Campuses', 'Server Rooms', 'Hospitals'].map((ind, i) => (
              <span key={i} className="px-3.5 py-1.5 rounded-lg bg-[#f7f7f5] border border-[#e9e9e6]">{ind}</span>
            ))}
          </div>
        </div>

        {/* Footer Call to Action */}
        <div className="rounded-2xl border border-[#e9e9e6] bg-[#f7f7f5] p-8 sm:p-12 text-center max-w-3xl mx-auto space-y-5 relative overflow-hidden">
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[#37352f]">Begin securing your space today</h2>
          <p className="text-xs text-[#7c7b77] max-w-md mx-auto leading-relaxed font-semibold">
            Integrate local webcam channels or connect RTSP CCTV cameras immediately from the main command workspace.
          </p>
          <div className="flex justify-center">
            <button 
              onClick={() => navigate('/login')}
              className="px-5 py-2.5 rounded-lg bg-[#006fee] hover:bg-[#005bc5] text-xs font-bold text-white transition-all shadow-sm cursor-pointer flex items-center gap-1.5"
            >
              Get FireGuard free <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </main>

      <footer className="text-center py-8 border-t border-[#e9e9e6] text-[10px] text-[#a4a3a0] font-semibold tracking-wide">
        &copy; {new Date().getFullYear()} FireGuard AI, Inc. All rights reserved.
      </footer>
    </div>
  );
};

export default Landing;
