import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/Common/Card';
import { Badge } from '../components/Common/Badge';
import { Button } from '../components/Common/Button';
import { Input, Select } from '../components/Common/Input';
import { useToast } from '../components/ui/Toast';
import { getHistory, exportHistoryCsv, exportHistoryPdf, type HistoryItem } from '../services/historyService';
import { 
  getAnalyticsIncidentTrends, 
  getAnalyticsFireSmokeDistribution 
} from '../services/api';
import { 
  Download, Search, BarChart3, LineChart, 
  RefreshCw, Award, Activity 
} from 'lucide-react';
import { 
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, PieChart as ReChartsPieChart, Pie, Cell 
} from 'recharts';
import { PredictiveHeatmap } from '../components/Analytics/PredictiveHeatmap';

const toDateLocalInput = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const AnalyticsMerged = () => {
  const { toast: toastReal } = useToast();

  const [activeSubTab, setActiveSubTab] = useState<'metrics' | 'logs'>('metrics');

  // ── 1. Analytics & Metrics State ───────────────────────────────────────────
  const [trends, setTrends] = useState<any[]>([]);
  const [distribution, setDistribution] = useState<any[]>([]);
  const [, setLoadingMetrics] = useState(false);

  const loadMetrics = async () => {
    try {
      setLoadingMetrics(true);
      const trendData = await getAnalyticsIncidentTrends();
      const distData = await getAnalyticsFireSmokeDistribution();
      setTrends(trendData);
      setDistribution(distData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMetrics(false);
    }
  };

  // ── 2. Historical Logs State ───────────────────────────────────────────────
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  const loadLogs = async () => {
    try {
      setLoadingLogs(true);
      const res = await getHistory({
        page,
        page_size: pageSize,
        search: search || undefined,
        status: (status || undefined) as any,
        type: (type || undefined) as any,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      toastReal('Failed to load history logs', 'error');
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'metrics') {
      void loadMetrics();
    } else {
      void loadLogs();
    }
  }, [activeSubTab, page, pageSize, search, status, type, startDate, endDate]);

  const handleExportCsv = async () => {
    try {
      const blob = await exportHistoryCsv({
        search: search || undefined,
        status: status as any,
        type: type as any,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `history_export_${toDateLocalInput(new Date())}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toastReal('CSV export downloaded successfully.', 'success');
    } catch (e) {
      toastReal('CSV export failed.', 'error');
    }
  };

  const handleExportPdf = async () => {
    try {
      const blob = await exportHistoryPdf({
        search: search || undefined,
        status: status as any,
        type: type as any,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `history_export_${toDateLocalInput(new Date())}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toastReal('PDF report downloaded successfully.', 'success');
    } catch (e) {
      toastReal('PDF report generation failed.', 'error');
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 select-none">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics & History Log</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Review historical trends, model accuracy metrics, and export data audits.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => activeSubTab === 'metrics' ? void loadMetrics() : void loadLogs()} className="flex items-center gap-1.5">
            <RefreshCw size={14} /> Sync Metrics
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 overflow-x-auto pb-2">
        <button
          onClick={() => setActiveSubTab('metrics')}
          className={`px-5 py-2.5 rounded-xl text-sm font-semibold capitalize transition-all ${
            activeSubTab === 'metrics' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span className="flex items-center gap-1.5"><BarChart3 size={15} /> Operational Charts</span>
        </button>
        <button
          onClick={() => setActiveSubTab('logs')}
          className={`px-5 py-2.5 rounded-xl text-sm font-semibold capitalize transition-all ${
            activeSubTab === 'logs' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span className="flex items-center gap-1.5"><Activity size={15} /> Historical Logs</span>
        </button>
      </div>

      {/* TABS CONTENT */}
      {activeSubTab === 'metrics' && (
        <div className="space-y-6">
          
          {/* KPI Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-3 bg-red-500/10 rounded-xl text-red-500"><BarChart3 size={24} /></div>
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Overall Model Accuracy</p>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">99.4%</h3>
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-3 bg-red-500/10 rounded-xl text-red-500"><Award size={24} /></div>
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">True Positives</p>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">1,248</h3>
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-3 bg-red-500/10 rounded-xl text-red-500"><LineChart size={24} /></div>
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">False Alarm Ratio</p>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">0.14%</h3>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Trends Chart */}
            <Card className="lg:col-span-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardHeader><CardTitle>Threat Detections Over Time</CardTitle></CardHeader>
              <CardContent className="p-4 h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trends}>
                    <defs>
                      <linearGradient id="fireGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="smokeGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="day" stroke="#9ca3af" fontSize={10} />
                    <YAxis stroke="#9ca3af" fontSize={10} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f0f17', borderColor: '#1f2937' }} />
                    <Legend />
                    <Area type="monotone" dataKey="fire" stroke="#ef4444" fillOpacity={1} fill="url(#fireGrad)" name="Fire" />
                    <Area type="monotone" dataKey="smoke" stroke="#f97316" fillOpacity={1} fill="url(#smokeGrad)" name="Smoke" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Distribution Pie Chart */}
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardHeader><CardTitle>Threat Class Distribution</CardTitle></CardHeader>
              <CardContent className="p-4 h-[300px] flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <ReChartsPieChart>
                    <Pie
                      data={distribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {distribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.name === 'Fire' ? '#ef4444' : '#f97316'} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#0f0f17', borderColor: '#1f2937' }} />
                    <Legend />
                  </ReChartsPieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

          </div>

          {/* Predictive Heatmap Row */}
          <PredictiveHeatmap />
        </div>
      )}

      {activeSubTab === 'logs' && (
        <div className="space-y-6">
          <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
            <CardContent className="p-6 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <Input 
                  placeholder="Search by ID, camera, or location..." 
                  className="pl-10"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select 
                label="Class" 
                options={[
                  { label: 'All Classes', value: '' },
                  { label: 'Fire', value: 'fire' },
                  { label: 'Smoke', value: 'smoke' },
                ]}
                value={type}
                onChange={(e) => setType(e.target.value)}
              />
              <Select 
                label="State" 
                options={[
                  { label: 'All States', value: '' },
                  { label: 'Active', value: 'active' },
                  { label: 'Resolved', value: 'resolved' },
                ]}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              />
              <Input 
                type="date" 
                label="Date From"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <Input 
                type="date" 
                label="Date To"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <div className="flex gap-2 items-end">
                <Button variant="outline" className="w-full flex justify-center gap-1.5 h-10" onClick={handleExportCsv}>
                  <Download size={14} /> CSV
                </Button>
                <Button variant="outline" className="w-full flex justify-center gap-1.5 h-10" onClick={handleExportPdf}>
                  <Download size={14} /> PDF
                </Button>
              </div>
            </CardContent>
          </Card>

          {loadingLogs ? (
            <div className="py-20 text-center text-slate-500"><RefreshCw className="animate-spin text-red-500 mx-auto mb-2" /> Loading logs...</div>
          ) : items.length === 0 ? (
            <div className="p-16 text-center text-slate-500 border border-slate-800 rounded-3xl">
              <h4 className="text-gray-900 dark:text-white font-bold mb-1">No Log Entries Found</h4>
              <p className="text-xs text-slate-400">Try adjusting your filters or search query.</p>
            </div>
          ) : (
            <div className="border border-slate-800 rounded-2xl bg-[#0f0f17] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/30 text-slate-400 font-semibold text-xs tracking-wider">
                      <th className="p-4">Timestamp</th>
                      <th className="p-4">Camera ID</th>
                      <th className="p-4">Location</th>
                      <th className="p-4">Type</th>
                      <th className="p-4">Confidence</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 text-slate-300">
                    {items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/20 transition-colors">
                        <td className="p-4 text-xs font-mono">{new Date(item.timestamp).toLocaleString()}</td>
                        <td className="p-4 font-semibold text-white">{item.camera_id || 'Upload'}</td>
                        <td className="p-4 text-xs text-slate-400">{item.location || 'N/A'}</td>
                        <td className="p-4"><Badge type={item.detection_type}>{item.detection_type}</Badge></td>
                        <td className="p-4 font-mono text-xs text-white">{(item.confidence * 100).toFixed(0)}%</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            item.status === 'active' ? 'bg-red-500/10 text-red-500' : 'bg-slate-500/10 text-slate-400'
                          }`}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex justify-between items-center pt-4">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
              <span className="text-xs text-slate-400">Page {page} of {pages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}>Next</Button>
            </div>
          )}
        </div>
      )}

    </div>
  );
};

export default AnalyticsMerged;
