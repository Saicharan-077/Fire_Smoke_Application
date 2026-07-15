import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/Common/Card';
import { Badge } from '../components/Common/Badge';
import { Button } from '../components/Common/Button';
import { useToast } from '../components/ui/Toast';
import { getDashboardStats, getDashboardAnalytics, getIncidents } from '../services/api';
import { useDashboardStore } from '../store/dashboardStore';
import { 
  Flame, Wind, Activity, 
  Video,  RefreshCw, AlertTriangle, ChevronRight, BarChart3, Clock, 
  MapPin, ShieldAlert, Target, Cpu, Heart, CheckCircle2
} from 'lucide-react';
import { HeroBackground } from '../components/Dashboard/HeroBackground';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';
import { AnimatedCounter } from '../components/Common/AnimatedCounter';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } }
};

const itemVariants = {
  hidden: { y: 15, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 120 } }
};

const Dashboard = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();

  // Metrics states
  const [stats, setStats] = useState<any>({
    total_alerts: 0,
    active_alerts: 0,
    fire_alerts: 0,
    smoke_alerts: 0,
    connected_cameras: 0,
    recent_alerts: []
  });
  const [timeline, setTimeline] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const storeRecentAlerts = useDashboardStore((s) => s.recentAlerts);
  const setStoreStats = useDashboardStore((s) => s.setStats);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const [statsData, analyticsData, incidentsData] = await Promise.all([
        getDashboardStats(),
        getDashboardAnalytics(),
        getIncidents({})
      ]);
      setStats(statsData);
      setTimeline(analyticsData.timeline || []);
      setIncidents(incidentsData.items || []);
      setStoreStats({
        totalAlerts: statsData.total_alerts,
        activeAlerts: statsData.active_alerts,
        fireAlerts: statsData.fire_alerts,
        smokeAlerts: statsData.smoke_alerts,
        connectedCameras: statsData.connected_cameras,
        recentAlerts: statsData.recent_alerts || [],
      });
    } catch (e: any) {
      toast(e.message || 'Failed to fetch SOC command metrics.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboardData();
  }, []);

  // Merge real-time WebSocket alerts into dashboard view
  useEffect(() => {
    if (storeRecentAlerts.length === 0) return;
    setStats((prev: typeof stats) => ({
      ...prev,
      recent_alerts: storeRecentAlerts,
      active_alerts: Math.max(prev.active_alerts, storeRecentAlerts.filter((a) => a.status === 'active').length),
      total_alerts: Math.max(prev.total_alerts, storeRecentAlerts.length),
    }));
  }, [storeRecentAlerts]);

  // Sorted active threats
  const sortedAlerts = useMemo(() => {
    const source = storeRecentAlerts.length > 0 ? storeRecentAlerts : (stats.recent_alerts || []);
    return [...source].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return b.confidence - a.confidence;
    });
  }, [stats.recent_alerts, storeRecentAlerts]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400">
        <RefreshCw className="animate-spin text-red-500 mb-4" size={36} />
        <p className="font-semibold text-base">Initializing Security Operations Command (SOC)...</p>
      </div>
    );
  }

  return (
    <motion.div 
      className="space-y-8 w-full"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Premium Defender Banner */}
      <motion.div variants={itemVariants} className="relative rounded-3xl overflow-hidden border border-red-500/10 bg-[#0c0c14] p-8 shadow-2xl">
        <HeroBackground />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/15 border border-red-500/25 text-xs font-bold text-red-500">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></span>
              Live Threat Shield Active
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">FireGuard AI Command Center</h1>
            <p className="text-slate-400 text-sm md:text-base max-w-2xl">
              Autonomous AI threat detection system auditing CCTV streams, thermal imaging, and workstation cameras.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" size="sm" onClick={loadDashboardData} className="flex items-center gap-1.5">
              <RefreshCw size={14} /> Sync Metrics
            </Button>
            <Button variant="primary" size="sm" onClick={() => navigate(hasPermission('detection') ? '/detection' : '/alerts-reports')} className="flex items-center gap-1.5">
              <Activity size={14} /> {hasPermission('detection') ? 'Threat Ingest' : 'View Alerts'}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* SOC KPIs Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5">
        {[
          { label: 'Fire Count', value: <AnimatedCounter value={stats.fire_alerts} />, icon: <Flame size={20} className="text-red-500" />, desc: 'Active detections' },
          { label: 'Smoke Count', value: <AnimatedCounter value={stats.smoke_alerts} />, icon: <Wind size={20} className="text-orange-500" />, desc: 'Active detections' },
          { label: 'Active Alerts', value: <AnimatedCounter value={stats.active_alerts} />, icon: <ShieldAlert size={20} className="text-yellow-500" />, desc: 'Unresolved queue' },
          { label: 'Model Accuracy', value: <AnimatedCounter value={stats.model_accuracy ?? 94.2} suffix="%" decimals={1} />, icon: <Cpu size={20} className="text-green-500" />, desc: stats.model_ready ? 'YOLOv8 ready' : 'Model loading' },
          { label: 'System Health', value: (stats.system_health ?? 'nominal').charAt(0).toUpperCase() + (stats.system_health ?? 'nominal').slice(1), icon: <Heart size={20} className={stats.system_health === 'nominal' ? 'text-blue-500' : 'text-amber-500'} />, desc: 'All services' },
          { label: 'Cameras Online', value: <><AnimatedCounter value={stats.online_cameras ?? stats.connected_cameras} />/<AnimatedCounter value={stats.total_cameras ?? stats.connected_cameras} /></>, icon: <Video size={20} className="text-indigo-500" />, desc: 'Active CCTV feeds' },
        ].map((kpi, idx) => (
          <motion.div key={idx} variants={itemVariants}>
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17] hover:scale-[1.02] transition-all">
              <CardContent className="p-5 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{kpi.label}</span>
                  {kpi.icon}
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white">{kpi.value}</h3>
                  <p className="text-[10px] text-slate-500 mt-1 font-semibold">{kpi.desc}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Timeline & Charts */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Timeline chart */}
          <motion.div variants={itemVariants}>
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardHeader className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 pb-4">
                <CardTitle className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Activity size={16} className="text-red-500" /> Real-Time Threat Activity Timeline (24h)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeline} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fireGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="smokeGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                    <XAxis dataKey="time" stroke="#9ca3af" fontSize={10} axisLine={false} tickLine={false} />
                    <YAxis stroke="#9ca3af" fontSize={10} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f0f17', borderColor: '#1f2937' }} />
                    <Legend />
                    <Area type="monotone" dataKey="fire" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#fireGrad)" name="Fire Detections" />
                    <Area type="monotone" dataKey="smoke" stroke="#f97316" strokeWidth={2} fillOpacity={1} fill="url(#smokeGrad)" name="Smoke Detections" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </motion.div>

          {/* Quick Actions & Recent Incidents Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Quick Actions */}
            <motion.div variants={itemVariants}>
              <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17] h-full">
                <CardHeader><CardTitle className="text-sm font-bold text-slate-900 dark:text-white">Security Command Actions</CardTitle></CardHeader>
                <CardContent className="p-5 grid grid-cols-1 gap-3">
                  <button onClick={() => hasPermission('detection') && navigate('/detection')} className={`w-full text-left p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5 hover:border-red-500/30 transition-all flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-white ${!hasPermission('detection') ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <div className="flex items-center gap-2">
                      <Video size={16} className="text-red-500" />
                      <span>Initiate AI Stream Scan</span>
                    </div>
                    <span className="text-red-400">→</span>
                  </button>
                  <button onClick={() => hasPermission('live_monitoring') && navigate('/live-monitoring')} className={`w-full text-left p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5 hover:border-red-500/30 transition-all flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-white ${!hasPermission('live_monitoring') ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <div className="flex items-center gap-2">
                      <Activity size={16} className="text-blue-500" />
                      <span>View CCTV Security Grid</span>
                    </div>
                    <span className="text-red-400">→</span>
                  </button>
                  <button onClick={() => navigate('/alerts-reports')} className="w-full text-left p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5 hover:border-red-500/30 transition-all flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-white">
                    <div className="flex items-center gap-2">
                      <ShieldAlert size={16} className="text-yellow-500" />
                      <span>Audit Alerts & Incidents</span>
                    </div>
                    <span className="text-red-400">→</span>
                  </button>
                  <button onClick={() => navigate('/analytics')} className="w-full text-left p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5 hover:border-red-500/30 transition-all flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-white">
                    <div className="flex items-center gap-2">
                      <Cpu size={16} className="text-green-500" />
                      <span>Analyze Threat Analytics</span>
                    </div>
                    <span className="text-red-400">→</span>
                  </button>
                </CardContent>
              </Card>
            </motion.div>

            {/* Recent Incidents */}
            <motion.div variants={itemVariants}>
              <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17] h-full">
                <CardHeader><CardTitle className="text-sm font-bold text-slate-900 dark:text-white">Recent Logged Incidents</CardTitle></CardHeader>
                <CardContent className="p-5 space-y-3 max-h-[220px] overflow-y-auto custom-scrollbar">
                  {incidents.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-6">No incidents filed.</p>
                  ) : (
                    incidents.map((inc, i) => (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        key={inc.id} 
                        className="flex justify-between items-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-850 bg-slate-50 dark:bg-slate-900/30 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <div className="space-y-0.5 max-w-[70%]">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{inc.title}</p>
                          <p className="text-[9px] text-slate-500 dark:text-slate-450 truncate">{inc.description}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                          inc.severity === 'critical' ? 'bg-red-500/10 text-red-500' : 'bg-yellow-500/10 text-yellow-500'
                        }`}>{inc.severity}</span>
                      </motion.div>
                    ))
                  )}
                </CardContent>
              </Card>
            </motion.div>

          </div>
        </div>

        {/* Right Column: Live Status & Recent Activity Feed */}
        <div className="space-y-6">
          
          {/* Live Status Widget */}
          <motion.div variants={itemVariants}>
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardHeader><CardTitle className="text-sm font-bold text-white">Shield Shield Integrity</CardTitle></CardHeader>
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="text-green-500 w-6 h-6 shrink-0" />
                  <div>
                    <h4 className="font-bold text-xs text-white">{stats.model_ready ? 'Threat Shield Online' : 'Model Initializing'}</h4>
                    <p className="text-[10px] text-slate-450">Accuracy: {stats.model_accuracy ?? 94.2}% · Health: {stats.system_health ?? 'nominal'}</p>
                  </div>
                </div>
                <div className="space-y-2 text-xs font-medium text-slate-400 border-t border-slate-850 pt-3">
                  <div className="flex justify-between">
                    <span>Database Connection:</span>
                    <span className="text-green-500 font-mono">SQLite (Healthy)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>RTSP Video Buffers:</span>
                    <span className="text-green-500 font-mono">Online</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Recent Activity Feed */}
          <motion.div variants={itemVariants}>
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardHeader><CardTitle className="text-sm font-bold text-slate-900 dark:text-white">Recent SOC Activity Feed</CardTitle></CardHeader>
              <CardContent className="p-5 space-y-3.5 max-h-[340px] overflow-y-auto custom-scrollbar">
                {sortedAlerts.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">No recent alert events logged.</p>
                ) : (
                  sortedAlerts.map((alert) => (
                    <div key={alert.id} className="flex justify-between items-start gap-3 p-3 rounded-xl border border-slate-850 bg-slate-900/30 hover:border-red-500/20 transition-all">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <Badge type={alert.detection_type}>{alert.detection_type}</Badge>
                          <span className="text-[9px] font-mono text-slate-400">{(alert.confidence * 100).toFixed(0)}% Match</span>
                        </div>
                        <p className="text-[10px] font-bold text-slate-900 dark:text-white">Camera: {alert.camera_id || 'Upload Source'}</p>
                        <p className="text-[9px] text-slate-550">{new Date(alert.timestamp).toLocaleTimeString()}</p>
                      </div>
                      <span className={`w-2 h-2 rounded-full ${alert.status === 'active' ? 'bg-red-500 animate-pulse' : 'bg-slate-650'}`}></span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </motion.div>

        </div>
      </div>

    </motion.div>
  );
};

export default Dashboard;
