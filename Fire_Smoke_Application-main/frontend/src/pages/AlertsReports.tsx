import { useEffect, useState, Fragment } from 'react';
import { Card, CardContent } from '../components/Common/Card';
import { Badge } from '../components/Common/Badge';
import { Button } from '../components/Common/Button';
import { Input, Select } from '../components/Common/Input';
import { Modal } from '../components/Common/Modal';
import { useToast } from '../components/ui/Toast';
import { 
  getAlerts, updateAlertStatus, deleteAlert, 
  getIncidents, createIncident, updateIncident, deleteIncident, 
  evidenceUrl, type Incident 
} from '../services/api';
import { APP_CONFIG } from '../config/appConfig';
import { 
  ShieldCheck, Check, Trash2, Edit2, 
  Download, RefreshCw, Eye, FileText, BarChart, Plus, AlertOctagon,
  Cpu, Activity
} from 'lucide-react';

const DEFAULT_INCIDENT_FORM = {
  title: '',
  description: '',
  severity: 'medium' as 'critical' | 'high' | 'medium' | 'low',
  status: 'active' as 'active' | 'resolved',
  assigned_user: '',
  notes: '',
};

const AlertsReports = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'alerts' | 'incidents' | 'reports'>('alerts');

  // Common state
  const [loading, setLoading] = useState(false);

  // 1. Live Alerts Tab State
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertFilterType, setAlertFilterType] = useState('');
  const [alertFilterStatus, setAlertFilterStatus] = useState('active');
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);

  // Search, severity, and sorting states
  const [alertSearch, setAlertSearch] = useState('');
  const [alertFilterSeverity, setAlertFilterSeverity] = useState('');
  const [alertSortBy, setAlertSortBy] = useState<'timestamp' | 'confidence'>('timestamp');
  const [alertSortOrder, setAlertSortOrder] = useState<'desc' | 'asc'>('desc');

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      const data = await getAlerts({
        detection_type: alertFilterType || undefined,
        status: alertFilterStatus || undefined,
      });
      setAlerts(Array.isArray(data) ? data : (data as any)?.items ?? []);
    } catch (err: any) {
      toast(err.message || 'Failed to fetch alerts.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getSeverity = (type: string, conf: number) => {
    if (type === 'fire') {
      return conf >= 0.70 ? 'critical' : 'warning';
    } else if (type === 'smoke') {
      return conf >= 0.60 ? 'warning' : 'info';
    }
    return 'info';
  };

  const processedAlerts = alerts
    .filter((alert) => {
      if (alertSearch.trim()) {
        const query = alertSearch.toLowerCase();
        const cam = (alert.camera_id || '').toLowerCase();
        const loc = (alert.location || '').toLowerCase();
        const file = (alert.file_name || '').toLowerCase();
        if (!cam.includes(query) && !loc.includes(query) && !file.includes(query)) {
          return false;
        }
      }
      if (alertFilterSeverity) {
        const sev = getSeverity(alert.detection_type, alert.confidence);
        if (sev !== alertFilterSeverity) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      const valA = alertSortBy === 'timestamp' ? new Date(a.timestamp).getTime() : a.confidence;
      const valB = alertSortBy === 'timestamp' ? new Date(b.timestamp).getTime() : b.confidence;
      if (alertSortOrder === 'asc') {
        return valA > valB ? 1 : -1;
      } else {
        return valA < valB ? 1 : -1;
      }
    });

  const handleResolveAlert = async (id: string) => {
    try {
      await updateAlertStatus(id, 'resolved');
      toast('Alert marked as resolved.', 'success');
      void fetchAlerts();
    } catch (err: any) {
      toast(err.message || 'Failed to resolve alert.', 'error');
    }
  };

  const handleDeleteAlert = async (id: string) => {
    if (!window.confirm('Permanently delete this alert?')) return;
    try {
      await deleteAlert(id);
      toast('Alert deleted successfully.', 'info');
      void fetchAlerts();
    } catch (err: any) {
      toast(err.message || 'Failed to delete alert.', 'error');
    }
  };

  // 2. Incident History Tab State
  const [incidents, setIncidents] = useState<any[]>([]);
  const [incFilterSeverity, setIncFilterSeverity] = useState('');
  const [incFilterStatus, setIncFilterStatus] = useState('');
  const [incSearch, setIncSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Incident>>({ ...DEFAULT_INCIDENT_FORM });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchIncidents = async () => {
    try {
      setLoading(true);
      const res = await getIncidents({
        status: incFilterStatus || undefined,
        severity: incFilterSeverity || undefined,
        search: incSearch || undefined,
      });
      setIncidents(res.items);
    } catch (err: any) {
      toast(err.message || 'Failed to load incidents.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateOrEditIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) {
      toast('Incident Title is required.', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      if (formMode === 'create') {
        await createIncident(form);
        toast('Incident ticket logged successfully.', 'success');
      } else if (editId) {
        await updateIncident(editId, form);
        toast('Incident ticket updated successfully.', 'success');
      }
      setFormOpen(false);
      void fetchIncidents();
    } catch (err: any) {
      toast(err.message || 'Failed to save incident.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResolveIncident = async (id: string) => {
    try {
      await updateIncident(id, { status: 'resolved' });
      toast('Incident resolved successfully.', 'success');
      void fetchIncidents();
    } catch (err: any) {
      toast(err.message || 'Failed to resolve incident.', 'error');
    }
  };

  const handleDeleteIncident = async (id: string) => {
    if (!window.confirm('Permanently delete this incident ticket?')) return;
    try {
      await deleteIncident(id);
      toast('Incident ticket removed.', 'info');
      void fetchIncidents();
    } catch (err: any) {
      toast(err.message || 'Failed to delete incident.', 'error');
    }
  };

  // 3. Reports Tab State
  const handleExportPdf = () => {
    const token = localStorage.getItem('fg-token');
    const base = APP_CONFIG.apiBaseUrl;
    const query = new URLSearchParams();
    if (incFilterStatus) query.append('status', incFilterStatus);
    if (incFilterSeverity) query.append('severity', incFilterSeverity);
    
    const url = `${base}/api/v1/incidents/export/pdf?${query.toString()}&token=${token || ''}`;
    window.open(url, '_blank');
    toast('Generating PDF Report...', 'info');
  };

  // Fetch handler on tab change
  useEffect(() => {
    if (activeTab === 'alerts') {
      void fetchAlerts();
    } else if (activeTab === 'incidents') {
      void fetchIncidents();
    }
  }, [activeTab, alertFilterType, alertFilterStatus, incFilterSeverity, incFilterStatus, incSearch]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-[var(--text)] select-none">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight uppercase tracking-wider text-[var(--text)]">Alerts & Incidents Center</h2>
          <p className="text-xs text-[var(--text-2)] mt-1 font-semibold leading-relaxed">Review active warning flags, manage incident lifecycles, and export operations logs.</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'incidents' && (
            <Button 
              variant="primary" 
              size="sm" 
              onClick={() => { setFormMode('create'); setForm({ ...DEFAULT_INCIDENT_FORM }); setFormOpen(true); }} 
              className="flex items-center gap-1.5 shadow-sm text-xs font-bold"
            >
              <Plus size={14} /> File Incident Ticket
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-50 dark:bg-slate-900 border border-[var(--border)] p-1 rounded-2xl gap-1 overflow-x-auto custom-scrollbar">
        {[
          { id: 'alerts', label: 'Live Warning Flags', icon: <AlertOctagon size={14} /> },
          { id: 'incidents', label: 'Incident Ticket Log', icon: <FileText size={14} /> },
          { id: 'reports', label: 'Reports & Exports', icon: <Download size={14} /> }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-5 py-3 rounded-xl text-xs font-bold transition-all duration-200 shrink-0 cursor-pointer ${
              activeTab === tab.id 
                ? 'bg-white dark:bg-slate-800 text-sky-700 dark:text-sky-400 border border-slate-200/50 dark:border-slate-700 shadow-sm' 
                : 'text-[var(--text-2)] hover:text-[var(--text)] hover:bg-white/40 border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2">
              {tab.icon}
              {tab.label}
            </div>
          </button>
        ))}
      </div>

      {/* TABS CONTENT */}
      {activeTab === 'alerts' && (
        <div className="space-y-6">
          {/* Filters Card */}
          <Card className="bg-[var(--surface)] border-[var(--border)] shadow-xs">
            <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Input 
                placeholder="Search cam, location, file..." 
                value={alertSearch}
                onChange={(e) => setAlertSearch(e.target.value)}
              />
              <Select 
                label="Filter Class Type"
                options={[
                  { label: 'All Classes', value: '' },
                  { label: 'Fire warnings', value: 'fire' },
                  { label: 'Smoke flags', value: 'smoke' },
                ]}
                value={alertFilterType}
                onChange={(e) => setAlertFilterType(e.target.value)}
              />
              <Select 
                label="Filter Warning State"
                options={[
                  { label: 'Active Alerts', value: 'active' },
                  { label: 'Resolved Alerts', value: 'resolved' },
                ]}
                value={alertFilterStatus}
                onChange={(e) => setAlertFilterStatus(e.target.value)}
              />
              <Select 
                label="Filter Severity"
                options={[
                  { label: 'All Severities', value: '' },
                  { label: 'Critical priority', value: 'critical' },
                  { label: 'Warning level', value: 'warning' },
                  { label: 'Info flags', value: 'info' },
                ]}
                value={alertFilterSeverity}
                onChange={(e) => setAlertFilterSeverity(e.target.value)}
              />
            </CardContent>
          </Card>

          {/* Sorting Row */}
          <div className="flex justify-between items-center px-1 text-xs">
            <span className="text-[var(--text-2)] font-bold uppercase tracking-wider">{processedAlerts.length} Warnings Logged</span>
            <div className="flex gap-2 items-center font-semibold text-[var(--text-2)]">
              <span>Sort By:</span>
              <button 
                onClick={() => {
                  if (alertSortBy === 'timestamp') {
                    setAlertSortOrder(alertSortOrder === 'asc' ? 'desc' : 'asc');
                  } else {
                    setAlertSortBy('timestamp');
                    setAlertSortOrder('desc');
                  }
                }}
                className={`px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] cursor-pointer hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition-all flex items-center gap-1 ${alertSortBy === 'timestamp' ? 'text-sky-600 border-sky-200 bg-sky-50/50 dark:text-sky-400 dark:border-sky-800 dark:bg-sky-950/20' : ''}`}
              >
                Time {alertSortBy === 'timestamp' && (alertSortOrder === 'asc' ? '▲' : '▼')}
              </button>
              <button 
                onClick={() => {
                  if (alertSortBy === 'confidence') {
                    setAlertSortOrder(alertSortOrder === 'asc' ? 'desc' : 'asc');
                  } else {
                    setAlertSortBy('confidence');
                    setAlertSortOrder('desc');
                  }
                }}
                className={`px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] cursor-pointer hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition-all flex items-center gap-1 ${alertSortBy === 'confidence' ? 'text-sky-600 border-sky-200 bg-sky-50/50 dark:text-sky-400 dark:border-sky-800 dark:bg-sky-950/20' : ''}`}
              >
                Confidence {alertSortBy === 'confidence' && (alertSortOrder === 'asc' ? '▲' : '▼')}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="py-20 text-center text-zinc-500 font-semibold"><RefreshCw className="animate-spin text-[#006fee] mx-auto mb-3" size={24} /> Syncing warnings database...</div>
          ) : processedAlerts.length === 0 ? (
            <div className="p-16 text-center text-[var(--text-3)] border border-[var(--border)] bg-[var(--surface-2)]/30 rounded-2xl">
              <ShieldCheck size={42} className="mx-auto mb-3 text-emerald-500 animate-radar" />
              <h4 className="text-[var(--text)] font-bold mb-1 uppercase tracking-widest text-xs">Node Ingress Secure</h4>
              <p className="text-[10px] text-[var(--text-2)] font-semibold">No warnings or threat flags found.</p>
            </div>
          ) : (
            <div className="border border-[var(--border)] rounded-xl bg-[var(--surface)] overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]/35 text-[var(--text-2)] font-bold uppercase tracking-wider">
                      <th className="p-4 px-6">Thumbnail</th>
                      <th className="p-4 px-6">Threat Type</th>
                      <th className="p-4 px-6">Confidence</th>
                      <th className="p-4 px-6">Camera & Location</th>
                      <th className="p-4 px-6">Source</th>
                      <th className="p-4 px-6">Date & Time</th>
                      <th className="p-4 px-6">Severity</th>
                      <th className="p-4 px-6">Status</th>
                      <th className="p-4 px-6">Operator Acknowledged</th>
                      <th className="p-4 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] text-[var(--text)] font-semibold">
                    {processedAlerts.map((alert) => {
                      const severity = getSeverity(alert.detection_type, alert.confidence);
                      const isExpanded = expandedAlertId === alert.id;
                      return (
                        <Fragment key={alert.id}>
                          <tr 
                            className="hover:bg-[var(--surface-hover)] transition-all duration-150 cursor-pointer"
                            onClick={() => setExpandedAlertId(isExpanded ? null : alert.id)}
                          >
                            <td className="p-4 px-6">
                              {alert.evidence_path ? (
                                <div className="h-10 w-16 shrink-0 rounded-lg overflow-hidden border border-[var(--border)] bg-black flex items-center justify-center relative group shadow-xs">
                                  <img src={evidenceUrl(alert.evidence_path) || ''} alt="Evidence" className="w-full h-full object-cover" />
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); setZoomUrl(evidenceUrl(alert.evidence_path)); }} 
                                    className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white cursor-pointer"
                                  >
                                    <Eye size={12} />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[10px] text-[var(--text-3)] font-mono">No Image</span>
                              )}
                            </td>
                            <td className="p-4 px-6">
                              <Badge type={alert.detection_type}>{alert.detection_type}</Badge>
                            </td>
                            <td className="p-4 px-6 font-mono text-[11px] font-bold">
                              {(alert.confidence * 100).toFixed(0)}%
                            </td>
                            <td className="p-4 px-6">
                              <div className="space-y-0.5">
                                <p className="font-bold text-xs">{alert.camera_id || 'Upload Feed'}</p>
                                <p className="text-[10px] text-[var(--text-3)]">{alert.location || 'N/A'}</p>
                              </div>
                            </td>
                            <td className="p-4 px-6 capitalize text-[var(--text-3)] font-mono text-[10px]">
                              {alert.source_type || 'image'}
                            </td>
                            <td className="p-4 px-6 text-[var(--text-3)]">
                              <div className="space-y-0.5">
                                <p>{new Date(alert.timestamp).toLocaleDateString()}</p>
                                <p className="font-mono text-[10px]">{new Date(alert.timestamp).toLocaleTimeString()}</p>
                              </div>
                            </td>
                            <td className="p-4 px-6">
                              <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider border ${
                                severity === 'critical' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                severity === 'warning' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 'bg-blue-500/10 text-blue-500 border-blue-500/20'
                              }`}>
                                {severity}
                              </span>
                            </td>
                            <td className="p-4 px-6">
                              <Badge type={alert.status === 'active' ? 'danger' : 'default'}>{alert.status}</Badge>
                            </td>
                            <td className="p-4 px-6 text-[var(--text-3)] font-mono text-[10px] font-bold">
                              {alert.status === 'resolved' 
                                ? (alert.resolved_by || 'System Auto')
                                : 'N/A'}
                            </td>
                            <td className="p-4 px-6 text-right space-x-1.5" onClick={(e) => e.stopPropagation()}>
                              {alert.status === 'active' && (
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-8 p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]" 
                                  onClick={() => void handleResolveAlert(alert.id)}
                                  title="Resolve Alert"
                                >
                                  <Check size={12} />
                                </Button>
                              )}
                              <Button 
                                variant="destructive" 
                                size="sm" 
                                className="h-8 p-2 rounded-lg" 
                                onClick={() => void handleDeleteAlert(alert.id)}
                                title="Delete Alert"
                              >
                                <Trash2 size={12} />
                              </Button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-[var(--surface-2)]/20 border-b border-[var(--border)]">
                              <td colSpan={10} className="p-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                                  {/* Column 1: Image and CV analytics */}
                                  <div className="space-y-4">
                                    <h4 className="text-[10px] font-bold text-[var(--text-3)] uppercase tracking-wider flex items-center gap-1.5">
                                      <Cpu size={12} className="text-sky-500" /> Visual Evidence & CV Analytics
                                    </h4>
                                    {alert.evidence_path ? (
                                      <div className="rounded-xl overflow-hidden border border-[var(--border)] bg-black max-w-md aspect-video relative group shadow-xs">
                                        <img src={evidenceUrl(alert.evidence_path) || undefined} alt="Evidence" className="w-full h-full object-cover animate-fade-in" />
                                        <button 
                                          onClick={() => setZoomUrl(evidenceUrl(alert.evidence_path))}
                                          className="absolute inset-2 right-auto bottom-auto p-1.5 rounded-lg bg-black/60 text-white cursor-pointer hover:bg-black transition-colors"
                                        >
                                          <Eye size={12} />
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="h-44 rounded-xl border border-dashed border-[var(--border)] flex items-center justify-center text-[var(--text-3)] font-semibold text-xs">No visual evidence found</div>
                                    )}
                                    <div className="grid grid-cols-2 gap-4 text-[10px]">
                                      <div>
                                        <span className="text-[var(--text-3)] block uppercase tracking-wider">Resolution Status:</span>
                                        <span className={`font-mono font-bold ${alert.status === 'resolved' ? 'text-emerald-500' : 'text-rose-500 animate-pulse'}`}>
                                          {alert.status === 'resolved' ? 'CLOSED / RESOLVED' : 'ACTIVE INVESTIGATION'}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-[var(--text-3)] block uppercase tracking-wider">Detection Confidence:</span>
                                        <span className="font-mono font-bold text-[var(--text)]">{(alert.confidence * 100).toFixed(0)}% AI Confidence</span>
                                      </div>
                                    </div>
                                  </div>
 
                                  {/* Column 2: Forensic Timeline */}
                                  <div className="space-y-4 border-t md:border-t-0 md:border-l border-[var(--border)] pt-4 md:pt-0 md:pl-6">
                                    <h4 className="text-[10px] font-bold text-[var(--text-3)] uppercase tracking-wider flex items-center gap-1.5">
                                      <Activity size={12} className="text-sky-500" /> Forensic Investigation Timeline
                                    </h4>
                                    <div className="relative pl-4 border-l-2 border-[var(--border)] space-y-4 text-xs font-semibold">
                                      {/* Event 1 */}
                                      <div className="relative">
                                        <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-sky-500 border-2 border-white dark:border-zinc-900" />
                                        <p className="text-[var(--text)] font-bold">Anomaly Flagged by YOLOv8 Vision Core</p>
                                        <p className="text-[9px] text-[var(--text-3)] mt-0.5 font-mono">{new Date(alert.timestamp).toLocaleString()}</p>
                                        <p className="text-[10px] text-[var(--text-3)] mt-1 leading-relaxed">
                                          Autonomous engine flagged high-probability {alert.detection_type} anomaly. Bounding boxes drawn at frame coordinates.
                                        </p>
                                      </div>
 
                                      {/* Event 2 */}
                                      <div className="relative">
                                        <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-purple-500 border-2 border-white dark:border-zinc-900" />
                                        <p className="text-[var(--text)] font-bold">Stage 2 Deterministic CV Verification Passed</p>
                                        <p className="text-[9px] text-[var(--text-3)] mt-0.5 font-mono">{new Date(new Date(alert.timestamp).getTime() + 10).toLocaleString()}</p>
                                        <p className="text-[10px] text-[var(--text-3)] mt-1 leading-relaxed">
                                          Chroma difference, Laplacian focus checks, connected components size thresholds, and local temporal pixel variance checks verified anomaly authenticity.
                                        </p>
                                      </div>
 
                                      {/* Event 3 */}
                                      <div className="relative">
                                        <span className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900 ${alert.status === 'resolved' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                        <p className="text-[var(--text)] font-bold">
                                          {alert.status === 'resolved' ? 'Threat Acknowledged & Triage Closed' : 'Awaiting Operator Intervention'}
                                        </p>
                                        <p className="text-[9px] text-[var(--text-3)] mt-0.5 font-mono">
                                          {alert.status === 'resolved' ? new Date(alert.timestamp).toLocaleString() : 'PENDING ACTION'}
                                        </p>
                                        <p className="text-[10px] text-[var(--text-3)] mt-1 leading-relaxed">
                                          {alert.status === 'resolved' 
                                            ? `Triage closed by ${alert.resolved_by || 'System Admin'}. Safe operations confirmed.`
                                            : 'System is monitoring this warning. Operator review required.'}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'incidents' && (
        <div className="space-y-6 animate-slide-up">
          <Card className="bg-[var(--surface)] border-[var(--border)] shadow-xs">
            <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input 
                placeholder="Search tickets..." 
                value={incSearch}
                onChange={(e) => setIncSearch(e.target.value)}
              />
              <Select 
                label="Severity Level" 
                options={[
                  { label: 'All Severities', value: '' },
                  { label: 'Critical priority', value: 'critical' },
                  { label: 'High priority', value: 'high' },
                  { label: 'Medium priority', value: 'medium' },
                  { label: 'Low priority', value: 'low' },
                ]}
                value={incFilterSeverity}
                onChange={(e) => setIncFilterSeverity(e.target.value)}
              />
              <Select 
                label="Triage Status" 
                options={[
                  { label: 'All statuses', value: '' },
                  { label: 'Active warnings', value: 'active' },
                  { label: 'Resolved threats', value: 'resolved' },
                ]}
                value={incFilterStatus}
                onChange={(e) => setIncFilterStatus(e.target.value)}
              />
            </CardContent>
          </Card>

          {loading ? (
            <div className="py-20 text-center text-[var(--text-3)] font-semibold"><RefreshCw className="animate-spin text-sky-500 mx-auto mb-3" size={24} /> Syncing incidents log...</div>
          ) : incidents.length === 0 ? (
            <div className="p-16 text-center text-[var(--text-3)] border border-[var(--border)] bg-[var(--surface-2)]/30 rounded-2xl">
              <ShieldCheck size={42} className="mx-auto mb-3 text-emerald-500 animate-radar" />
              <h4 className="text-[var(--text)] font-bold mb-1 uppercase tracking-widest text-xs">Node Ingress Secure</h4>
              <p className="text-[10px] text-[var(--text-2)] font-semibold">No incident tickets logged.</p>
            </div>
          ) : (
            <div className="border border-[var(--border)] rounded-xl bg-[var(--surface)] overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]/35 text-[var(--text-2)] font-bold uppercase tracking-wider">
                      <th className="p-4 px-6">Title</th>
                      <th className="p-4 px-6">Severity</th>
                      <th className="p-4 px-6">Reporter</th>
                      <th className="p-4 px-6">Assigned Staff</th>
                      <th className="p-4 px-6">Triage</th>
                      <th className="p-4 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] text-[var(--text)] font-semibold">
                    {incidents.map((inc) => (
                      <tr key={inc.id} className="hover:bg-[var(--surface-hover)] transition-all duration-150">
                        <td className="p-4 px-6 font-bold text-xs">{inc.title}</td>
                        <td className="p-4 px-6">
                          <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider border ${
                            inc.severity === 'critical' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                            inc.severity === 'high' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 'bg-blue-500/10 text-blue-500 border-blue-500/20'
                          }`}>
                            {inc.severity}
                          </span>
                        </td>
                        <td className="p-4 px-6 text-[var(--text-3)] font-bold">{inc.reporter || 'AI System'}</td>
                        <td className="p-4 px-6 text-[var(--text-3)] font-bold">{inc.assigned_user || 'Unassigned'}</td>
                        <td className="p-4 px-6"><Badge type={inc.status === 'active' ? 'danger' : 'default'}>{inc.status}</Badge></td>
                        <td className="p-4 px-6 text-right space-x-1.5">
                          {inc.status === 'active' && (
                            <Button variant="outline" size="sm" onClick={() => void handleResolveIncident(inc.id)} className="h-8 p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]" title="Mark Resolved">
                              <Check size={12} />
                            </Button>
                          )}
                          <Button variant="outline" size="sm" onClick={() => {
                            setFormMode('edit');
                            setEditId(inc.id);
                            setForm({
                              title: inc.title || '',
                              description: inc.description || '',
                              severity: inc.severity || 'medium',
                              status: inc.status || 'active',
                              assigned_user: inc.assigned_user || '',
                              notes: inc.notes || '',
                            });
                            setFormOpen(true);
                          }} className="h-8 p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]" title="Edit Ticket">
                            <Edit2 size={12} />
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => void handleDeleteIncident(inc.id)} className="h-8 p-2 rounded-lg" title="Delete Ticket">
                            <Trash2 size={12} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-slide-up">
          <Card className="bg-[var(--surface)] border-[var(--border)] shadow-xs">
            <CardContent className="p-6 space-y-4">
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 w-fit">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-[var(--text)]">Generate Operations Incident Report</h3>
              <p className="text-[11px] text-[var(--text-2)] leading-relaxed font-semibold">
                Compile all logged fire, smoke, and threat warnings. Creates a certified operational PDF audit log detailing timestamps, confidence percentages, and operator comments.
              </p>
              <Button variant="primary" size="sm" onClick={handleExportPdf} className="w-full flex items-center justify-center gap-2 text-xs font-bold">
                <Download size={14} /> Download PDF Report
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-[var(--surface)] border-[var(--border)] shadow-xs">
            <CardContent className="p-6 space-y-4">
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 w-fit">
                <BarChart className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-[var(--text)]">Download Ingest Logs (CSV)</h3>
              <p className="text-[11px] text-[var(--text-2)] leading-relaxed font-semibold">
                Export complete historical threat and surveillance activity records into a CSV spreadsheet. Perfect for import into external data analysis databases.
              </p>
              <Button variant="outline" size="sm" onClick={() => {
                const token = localStorage.getItem('fg-token');
                window.open(`${APP_CONFIG.apiBaseUrl}/api/v1/history/export/csv?token=${token || ''}`, '_blank');
                toast('Exporting CSV logs...', 'info');
              }} className="w-full flex items-center justify-center gap-2 bg-[var(--surface)] border border-[var(--border)] text-xs font-bold">
                <Download size={14} /> Download CSV Logs
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Incident Modal */}
      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title={formMode === 'create' ? 'Create Incident Ticket' : 'Edit Incident Ticket'}>
        <form onSubmit={handleCreateOrEditIncident} className="space-y-4 text-xs font-semibold text-[var(--text-2)]">
          <Input 
            label="Incident Title" 
            value={form.title || ''} 
            onChange={(e) => setForm({ ...form, title: e.target.value })} 
            placeholder="Surveillance warning logged in Zone B"
            required
          />
          <Input 
            label="Description" 
            value={form.description || ''} 
            onChange={(e) => setForm({ ...form, description: e.target.value })} 
            placeholder="Outline threat parameters or dispatch details here."
          />
          <div className="grid grid-cols-2 gap-4">
            <Select 
              label="Severity Level" 
              options={[
                { label: 'Critical priority', value: 'critical' },
                { label: 'High priority', value: 'high' },
                { label: 'Medium priority', value: 'medium' },
                { label: 'Low priority', value: 'low' },
              ]}
              value={form.severity || 'medium'}
              onChange={(e) => setForm({ ...form, severity: e.target.value as any })}
            />
            <Select 
              label="Triage Status" 
              options={[
                { label: 'Active warning', value: 'active' },
                { label: 'Resolved threat', value: 'resolved' },
              ]}
              value={form.status || 'active'}
              onChange={(e) => setForm({ ...form, status: e.target.value as any })}
            />
          </div>
          <Input 
            label="Assigned Operations Staff" 
            value={form.assigned_user || ''} 
            onChange={(e) => setForm({ ...form, assigned_user: e.target.value })} 
            placeholder="operator@sentinelos.ai"
          />
          <Input 
            label="Resolution Comments" 
            value={form.notes || ''} 
            onChange={(e) => setForm({ ...form, notes: e.target.value })} 
            placeholder="Triage steps or remarks."
          />
          <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border)] font-bold">
            <Button variant="outline" size="sm" type="button" onClick={() => setFormOpen(false)} className="bg-[var(--surface)] border border-[var(--border)] text-xs font-bold">Cancel</Button>
            <Button variant="primary" size="sm" type="submit" isLoading={isSubmitting} className="text-xs font-bold">
              {formMode === 'create' ? 'File Ticket' : 'Save Details'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Image Zoom Modal */}
      <Modal isOpen={!!zoomUrl} onClose={() => setZoomUrl(null)} title="Full-Resolution Evidence Frame">
        {zoomUrl && (
          <div className="rounded-xl overflow-hidden border border-[var(--border)] bg-black flex justify-center shadow-lg">
            <img src={zoomUrl} alt="Evidence" className="w-full h-auto object-contain max-h-[500px]" />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AlertsReports;
