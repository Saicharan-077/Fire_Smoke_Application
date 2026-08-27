import { useEffect, useState } from 'react';
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
  Download, RefreshCw, Eye, FileText, BarChart 
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

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Live Alerts Tab State
  // ────────────────────────────────────────────────────────────────────────────
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertFilterType, setAlertFilterType] = useState('');
  const [alertFilterStatus, setAlertFilterStatus] = useState('active');
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      const data = await getAlerts({
        detection_type: alertFilterType || undefined,
        status: alertFilterStatus || undefined,
      });
      // Handle both flat array and paginated { items: [] } response shapes
      setAlerts(Array.isArray(data) ? data : (data as any)?.items ?? []);
    } catch (err: any) {
      toast(err.message || 'Failed to fetch alerts.', 'error');
    } finally {
      setLoading(false);
    }
  };

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

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Incident History Tab State
  // ────────────────────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Reports Tab State
  // ────────────────────────────────────────────────────────────────────────────
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
    <div className="space-y-6 max-w-6xl mx-auto p-4 select-none">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Alerts & Incidents Center</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Review active warning flags, manage incident lifecycles, and export reports.</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'incidents' && (
            <Button variant="primary" size="sm" onClick={() => { setFormMode('create'); setForm({ ...DEFAULT_INCIDENT_FORM }); setFormOpen(true); }} className="flex items-center gap-1">
              File Incident Ticket
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 overflow-x-auto pb-2">
        <button
          onClick={() => setActiveTab('alerts')}
          className={`px-5 py-2.5 rounded-xl text-sm font-semibold capitalize transition-all ${
            activeTab === 'alerts' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Live Alerts
        </button>
        <button
          onClick={() => setActiveTab('incidents')}
          className={`px-5 py-2.5 rounded-xl text-sm font-semibold capitalize transition-all ${
            activeTab === 'incidents' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Incident History
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={`px-5 py-2.5 rounded-xl text-sm font-semibold capitalize transition-all ${
            activeTab === 'reports' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Reports & Exports
        </button>
      </div>

      {/* TABS CONTENT */}
      {activeTab === 'alerts' && (
        <div className="space-y-6">
          <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
            <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select 
                label="Filter Class"
                options={[
                  { label: 'All Detections', value: '' },
                  { label: 'Fire Warnings', value: 'fire' },
                  { label: 'Smoke Flags', value: 'smoke' },
                ]}
                value={alertFilterType}
                onChange={(e) => setAlertFilterType(e.target.value)}
              />
              <Select 
                label="Filter State"
                options={[
                  { label: 'Active Flags', value: 'active' },
                  { label: 'Resolved Tickets', value: 'resolved' },
                ]}
                value={alertFilterStatus}
                onChange={(e) => setAlertFilterStatus(e.target.value)}
              />
            </CardContent>
          </Card>

          {loading ? (
            <div className="py-20 text-center text-slate-500"><RefreshCw className="animate-spin text-red-500 mx-auto mb-2" /> Syncing alerts...</div>
          ) : alerts.length === 0 ? (
            <div className="p-16 text-center text-slate-500 border border-slate-800 rounded-3xl">
              <ShieldCheck size={48} className="mx-auto mb-3 text-slate-600" />
              <h4 className="text-gray-900 dark:text-white font-bold mb-1">Grid Area Secure</h4>
              <p className="text-xs text-slate-400">No active fire/smoke flags logged.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {alerts.map((alert) => (
                <div key={alert.id} className="p-4 border border-slate-800 bg-[#0f0f17] rounded-2xl flex flex-col justify-between gap-4">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <Badge type={alert.detection_type}>{alert.detection_type}</Badge>
                      <span className="text-xs font-mono font-bold bg-white/10 px-2 py-0.5 rounded text-slate-300">
                        {(alert.confidence * 100).toFixed(0)}% MATCH
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                  </div>

                  <div className="flex gap-3">
                    {alert.evidence_path && (
                      <div className="h-16 w-24 shrink-0 rounded-lg overflow-hidden border border-white/10 bg-black flex items-center justify-center relative group">
                        <img src={evidenceUrl(alert.evidence_path) || ''} alt="Evidence" className="w-full h-full object-cover" />
                        <button onClick={() => setZoomUrl(evidenceUrl(alert.evidence_path))} className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white cursor-pointer">
                          <Eye size={16} />
                        </button>
                      </div>
                    )}
                    <div className="space-y-1 text-xs">
                      <p className="font-bold text-white">Camera: {alert.camera_id || 'Upload Source'}</p>
                      <p className="text-slate-400">Location: {alert.location || 'N/A'}</p>
                    </div>
                  </div>

                  <div className="flex justify-between items-center border-t border-slate-800 pt-3">
                    <span className="text-[10px] font-mono text-slate-500">ID: {alert.id.slice(0, 8)}</span>
                    <div className="flex gap-2">
                      {alert.status === 'active' && (
                        <Button variant="outline" size="sm" className="h-8 flex items-center gap-1" onClick={() => void handleResolveAlert(alert.id)}>
                          <Check size={12} /> Resolve
                        </Button>
                      )}
                      <Button variant="destructive" size="sm" className="h-8" onClick={() => void handleDeleteAlert(alert.id)}>
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'incidents' && (
        <div className="space-y-6">
          <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
            <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input 
                placeholder="Search incident tickets..." 
                value={incSearch}
                onChange={(e) => setIncSearch(e.target.value)}
              />
              <Select 
                label="Severity" 
                options={[
                  { label: 'All Severities', value: '' },
                  { label: 'Critical Threats', value: 'critical' },
                  { label: 'High Priority', value: 'high' },
                  { label: 'Medium Priority', value: 'medium' },
                  { label: 'Low Priority', value: 'low' },
                ]}
                value={incFilterSeverity}
                onChange={(e) => setIncFilterSeverity(e.target.value)}
              />
              <Select 
                label="Status" 
                options={[
                  { label: 'All Statuses', value: '' },
                  { label: 'Active Flags', value: 'active' },
                  { label: 'Resolved Tickets', value: 'resolved' },
                ]}
                value={incFilterStatus}
                onChange={(e) => setIncFilterStatus(e.target.value)}
              />
            </CardContent>
          </Card>

          {loading ? (
            <div className="py-20 text-center text-slate-500"><RefreshCw className="animate-spin text-red-500 mx-auto mb-2" /> Syncing incidents...</div>
          ) : incidents.length === 0 ? (
            <div className="p-16 text-center text-slate-500 border border-slate-800 rounded-3xl">
              <ShieldCheck size={48} className="mx-auto mb-3 text-slate-600" />
              <h4 className="text-gray-900 dark:text-white font-bold mb-1">Facility Secure</h4>
              <p className="text-xs text-slate-400">No incident tickets logged.</p>
            </div>
          ) : (
            <div className="border border-slate-800 rounded-2xl bg-[#0f0f17] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/30 text-slate-400 font-semibold text-xs tracking-wider">
                      <th className="p-4">Title</th>
                      <th className="p-4">Severity</th>
                      <th className="p-4">Reporter</th>
                      <th className="p-4">Assigned To</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 text-slate-300">
                    {incidents.map((inc) => (
                      <tr key={inc.id} className="hover:bg-slate-800/20 transition-colors">
                        <td className="p-4 font-semibold text-white">{inc.title}</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            inc.severity === 'critical' ? 'bg-red-500/10 text-red-500' :
                            inc.severity === 'high' ? 'bg-orange-500/10 text-orange-500' : 'bg-yellow-500/10 text-yellow-500'
                          }`}>
                            {inc.severity}
                          </span>
                        </td>
                        <td className="p-4 text-xs text-slate-450">{inc.reporter || 'System'}</td>
                        <td className="p-4 text-xs text-slate-450">{inc.assigned_user || 'Unassigned'}</td>
                        <td className="p-4"><Badge type={inc.status === 'active' ? 'danger' : 'default'}>{inc.status}</Badge></td>
                        <td className="p-4 text-right space-x-1.5">
                          {inc.status === 'active' && (
                            <Button variant="outline" size="sm" onClick={() => void handleResolveIncident(inc.id)} className="h-8">
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
                          }} className="h-8">
                            <Edit2 size={12} />
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => void handleDeleteIncident(inc.id)} className="h-8">
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
            <CardContent className="p-6 space-y-4">
              <FileText className="text-red-500 w-10 h-10" />
              <h3 className="font-bold text-lg text-gray-900 dark:text-white">Generate Operations Report</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Compile all logged fire, smoke, and hardware diagnostic events. Creates a certified audit PDF detailing timestamps, confidence rates, and response actions.
              </p>
              <Button variant="primary" size="sm" onClick={handleExportPdf} className="w-full flex items-center justify-center gap-2">
                <Download size={14} /> Download PDF Report
              </Button>
            </CardContent>
          </Card>

          <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
            <CardContent className="p-6 space-y-4">
              <BarChart className="text-red-500 w-10 h-10" />
              <h3 className="font-bold text-lg text-gray-900 dark:text-white">Download Raw Logs (CSV)</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Export complete historical threat and incident log entries as a raw CSV file. Useful for import into external security databases or spreadsheets.
              </p>
              <Button variant="outline" size="sm" onClick={() => {
                const token = localStorage.getItem('fg-token');
                window.open(`${APP_CONFIG.apiBaseUrl}/api/v1/history/export/csv?token=${token || ''}`, '_blank');
                toast('Exporting CSV logs...', 'info');
              }} className="w-full flex items-center justify-center gap-2">
                <Download size={14} /> Download CSV Logs
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Incident Modal */}
      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title={formMode === 'create' ? 'Create Incident Ticket' : 'Edit Incident Ticket'}>
        <form onSubmit={handleCreateOrEditIncident} className="space-y-4">
          <Input 
            label="Incident Title" 
            value={form.title || ''} 
            onChange={(e) => setForm({ ...form, title: e.target.value })} 
            placeholder="Uncontrolled Fire Warning in Zone B"
            required
          />
          <Input 
            label="Description" 
            value={form.description || ''} 
            onChange={(e) => setForm({ ...form, description: e.target.value })} 
            placeholder="Outline details or instructions here."
          />
          <div className="grid grid-cols-2 gap-4">
            <Select 
              label="Severity" 
              options={[
                { label: 'Critical Threat', value: 'critical' },
                { label: 'High Priority', value: 'high' },
                { label: 'Medium Priority', value: 'medium' },
                { label: 'Low Priority', value: 'low' },
              ]}
              value={form.severity || 'medium'}
              onChange={(e) => setForm({ ...form, severity: e.target.value as any })}
            />
            <Select 
              label="Triage Status" 
              options={[
                { label: 'Active Warning', value: 'active' },
                { label: 'Resolved Threat', value: 'resolved' },
              ]}
              value={form.status || 'active'}
              onChange={(e) => setForm({ ...form, status: e.target.value as any })}
            />
          </div>
          <Input 
            label="Assigned Operations Staff" 
            value={form.assigned_user || ''} 
            onChange={(e) => setForm({ ...form, assigned_user: e.target.value })} 
            placeholder="operator@fireguard.ai"
          />
          <Input 
            label="Resolution Notes" 
            value={form.notes || ''} 
            onChange={(e) => setForm({ ...form, notes: e.target.value })} 
            placeholder="Enter triage actions or remarks."
          />
          <div className="flex justify-end gap-2 pt-4 border-t border-slate-800">
            <Button variant="outline" size="sm" type="button" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" type="submit" isLoading={isSubmitting}>
              {formMode === 'create' ? 'File Ticket' : 'Save Details'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Image Zoom Modal */}
      <Modal isOpen={!!zoomUrl} onClose={() => setZoomUrl(null)} title="Full-Resolution Evidence Frame">
        {zoomUrl && (
          <div className="rounded-2xl overflow-hidden border border-slate-800 bg-black flex justify-center">
            <img src={zoomUrl} alt="Evidence" className="w-full h-auto object-contain max-h-[500px]" />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AlertsReports;
