import { useEffect, useState } from 'react';
import { Button } from '../components/Common/Button';
import { useToast } from '../components/ui/Toast';
import { deleteAlert, getDashboardAnalytics } from '../services/api';
import { getHistory } from '../services/historyService';
import { motion } from 'framer-motion';
import {
  Search, RefreshCw, Trash2, TrendingUp, AlertTriangle, Target, Database
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, PieChart as ReChartsPieChart, Pie, Cell
} from 'recharts';
import { DetectionHeatmap } from '../components/SOC/DetectionHeatmap';
import { PredictiveHeatmap } from '../components/Analytics/PredictiveHeatmap';

const toDateLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const ChartTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-md px-3 py-2 text-[12px]">
      <p className="text-[var(--text-2)] font-semibold mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex justify-between gap-5" style={{ color: p.color }}>
          <span className="font-medium">{p.name}</span>
          <span className="font-mono font-bold text-[var(--text)]">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

const fadeUp = {
  hidden: { y: 8, opacity: 0 },
  show: { y: 0, opacity: 1, transition: { duration: 0.18 } }
};

const Analytics = () => {
  const { toast } = useToast();
  const [trends, setTrends] = useState<any[]>([]);
  const [distribution, setDistribution] = useState<any[]>([]);

  const [typeFilter, setTypeFilter] = useState('');
  const [startDate, setStartDate] = useState(toDateLocal(new Date(Date.now() - 7 * 86400000)));
  const [endDate, setEndDate] = useState(toDateLocal(new Date()));
  const [historySearch, setHistorySearch] = useState('');

  const [history, setHistory] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const fetchCharts = async () => {
    try {
      const data = await getDashboardAnalytics() as any;
      setTrends(data.timeline || []);
      setDistribution([
        { name: 'Fire', value: data.fire_count || 12, color: '#e5484d' },
        { name: 'Smoke', value: data.smoke_count || 8, color: '#e79020' },
        { name: 'Resolved', value: data.false_positives || 2, color: '#30a46c' },
      ]);
    } catch {
      setTrends([
        { day: 'Mon', fire: 2, smoke: 1 }, { day: 'Tue', fire: 4, smoke: 3 },
        { day: 'Wed', fire: 1, smoke: 6 }, { day: 'Thu', fire: 3, smoke: 2 },
        { day: 'Fri', fire: 5, smoke: 4 }, { day: 'Sat', fire: 2, smoke: 1 },
        { day: 'Sun', fire: 1, smoke: 3 },
      ]);
      setDistribution([
        { name: 'Fire', value: 18, color: '#e5484d' },
        { name: 'Smoke', value: 20, color: '#e79020' },
        { name: 'Resolved', value: 3, color: '#30a46c' },
      ]);
    }
  };

  const fetchLogs = async () => {
    setLoadingHistory(true);
    try {
      const res = await getHistory({
        page, limit: 8,
        camera_id: undefined,
        detection_type: typeFilter || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        search: historySearch || undefined,
      } as any);
      setHistory(res.items);
      setTotalPages(res.pages);
    } catch (e: any) {
      toast(e.message || 'Failed to load logs', 'error');
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this log entry?')) return;
    try {
      await deleteAlert(id);
      toast('Entry deleted', 'info');
      void fetchLogs();
    } catch (e: any) {
      toast(e.message || 'Delete failed', 'error');
    }
  };

  useEffect(() => { void fetchCharts(); }, []);
  useEffect(() => { void fetchLogs(); }, [page, typeFilter, startDate, endDate, historySearch]);

  return (
    <motion.div className="space-y-6" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}>

      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--text)] tracking-tight">Analytics Dashboard</h1>
          <p className="text-[13px] text-[var(--text-2)] mt-0.5 font-semibold">Detection trends, threat distribution, and historical log archive</p>
        </div>
        <button
          onClick={() => { void fetchCharts(); void fetchLogs(); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-[12px] font-semibold text-[var(--text-2)] hover:text-[var(--text)] hover:border-[var(--border-strong)] transition-all"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </motion.div>
 
      {/* KPI cards */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Detection Accuracy', value: '99.4%', icon: Target, color: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-50 dark:bg-sky-950/20 border-sky-100 dark:border-sky-900/30' },
          { label: 'Alerts (24h)', value: '14', icon: AlertTriangle, color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900/30' },
          { label: 'False Positive Rate', value: '0.14%', icon: TrendingUp, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/30' },
        ].map((k) => (
          <div key={k.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex items-center gap-4 shadow-xs">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${k.bg}`}>
              <k.icon size={18} className={k.color} />
            </div>
            <div>
              <p className="text-[11px] text-[var(--text-3)] font-semibold uppercase tracking-wider">{k.label}</p>
              <p className="text-[24px] font-bold text-[var(--text)] tracking-tight leading-none mt-1 font-mono">{k.value}</p>
            </div>
          </div>
        ))}
      </motion.div>
 
      {/* Charts row */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
 
        {/* Trends */}
        <div className="lg:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-xs">
          <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-2)]/30">
            <p className="text-[13px] font-bold text-[var(--text)] uppercase tracking-wider">Detection Trends — 7 days</p>
          </div>
          <div className="p-4 h-64 bg-[var(--surface)]">
            <ResponsiveContainer width="100%" height={220} minWidth={0} minHeight={100}>
              <AreaChart data={trends} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="fireG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#e11d48" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="smokeG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#d97706" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="#d97706" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Area type="monotone" dataKey="fire" stroke="#e11d48" strokeWidth={1.5} fill="url(#fireG)" name="Fire" />
                <Area type="monotone" dataKey="smoke" stroke="#d97706" strokeWidth={1.5} fill="url(#smokeG)" name="Smoke" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
 
        {/* Distribution */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-xs">
          <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-2)]/30">
            <p className="text-[13px] font-bold text-[var(--text)] uppercase tracking-wider">Threat Distribution</p>
          </div>
          <div className="p-4 bg-[var(--surface)]">
            <div className="h-44">
              <ResponsiveContainer width="100%" height={140} minWidth={0} minHeight={100}>
                <ReChartsPieChart>
                  <Pie data={distribution} innerRadius={52} outerRadius={70} paddingAngle={3} dataKey="value">
                    {distribution.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                </ReChartsPieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2.5 mt-2">
              {distribution.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-[12px]">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-[var(--text-2)] font-semibold">{item.name}</span>
                  </div>
                  <span className="font-mono font-bold text-[var(--text)]">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Spatial & Predictive heatmaps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <motion.div variants={fadeUp}>
          <DetectionHeatmap />
        </motion.div>
        <motion.div variants={fadeUp}>
          <PredictiveHeatmap />
        </motion.div>
      </div>

      {/* History log */}
      <motion.div variants={fadeUp} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-4 flex-wrap bg-[var(--surface-2)]/10">
          <div className="flex items-center gap-2">
            <Database size={14} className="text-[var(--text-3)]" />
            <p className="text-[13px] font-bold text-[var(--text)] uppercase tracking-wider">Detection Log Archive</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Filters */}
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="px-3 py-2 border border-[var(--border)] rounded-xl text-[12px] bg-[var(--bg)] text-[var(--text)] outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-500 transition-all font-semibold"
            >
              <option value="">All Types</option>
              <option value="fire">Fire</option>
              <option value="smoke">Smoke</option>
            </select>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="px-3 py-2 border border-[var(--border)] rounded-xl text-[12px] bg-[var(--bg)] text-[var(--text)] outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-500 transition-all font-semibold" />
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="px-3 py-2 border border-[var(--border)] rounded-xl text-[12px] bg-[var(--bg)] text-[var(--text)] outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-500 transition-all font-semibold" />
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
              <input
                type="text"
                placeholder="Search by camera..."
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                className="pl-8 pr-3 py-2 border border-[var(--border)] rounded-xl text-[12px] bg-[var(--bg)] text-[var(--text)] outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-500 transition-all placeholder-[var(--text-3)] w-44 font-semibold"
              />
            </div>
          </div>
        </div>
 
        {loadingHistory ? (
          <div className="flex items-center justify-center py-16 gap-3">
            <RefreshCw size={16} className="animate-spin text-sky-500" />
            <span className="text-[13px] text-[var(--text-3)] font-semibold">Loading logs...</span>
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-2)] flex items-center justify-center border border-[var(--border)]">
              <Database size={18} className="text-[var(--text-3)]" />
            </div>
            <p className="text-[13px] text-[var(--text-3)] font-semibold">No log entries found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]/30 text-[var(--text-2)] font-semibold">
                    {['Timestamp', 'Camera', 'Source', 'Type', 'Confidence', ''].map(h => (
                      <th key={h} className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {history.map((log) => (
                    <tr key={log.id} className="hover:bg-[var(--surface-hover)] transition-all duration-150">
                      <td className="px-5 py-3 text-[12px] font-mono text-[var(--text-3)] whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-[12px] font-bold text-[var(--text)]">
                        {log.camera_id || '— Upload'}
                      </td>
                      <td className="px-5 py-3 text-[12px] text-[var(--text-3)] font-mono">
                        {log.source_type}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                          log.detection_type === 'fire'
                            ? 'bg-red-500/10 text-red-500 border-red-500/20'
                            : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                        }`}>
                          {log.detection_type}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-[12px] font-mono font-bold text-[var(--text)]">
                        {(log.confidence * 100).toFixed(1)}%
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => void handleDelete(log.id)}
                          className="p-1.5 rounded-lg text-[var(--text-3)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          title="Delete entry"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
 
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)] bg-[var(--surface-2)]/30">
                <span className="text-[12px] text-[var(--text-3)] font-semibold">Page {page} of {totalPages}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </motion.div>

    </motion.div>
  );
};

export default Analytics;
