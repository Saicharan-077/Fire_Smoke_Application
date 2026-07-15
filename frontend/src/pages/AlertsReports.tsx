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
  Download, RefreshCw, Eye, FileText, BarChart, Plus, AlertOctagon
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
    <div className="space-y-6 max-w-7xl mx-auto text-[#37352f] select-none">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight uppercase tracking-wider">Alerts & Incidents Center</h2>
          <p className="text-xs text-[#7c7b77] mt-1 font-semibold leading-relaxed">Review active warning flags, manage incident lifecycles, and export operations logs.</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'incidents' && (
            <Button 
              variant="primary" 
              size="sm" 
              onClick={() => { setFormMode('create'); setForm({ ...DEFAULT_INCIDENT_FORM }); setFormOpen(true); }} 
              className="flex items-center gap-1.5 shadow-sm text-xs"
            >
              <Plus size={14} /> File Incident Ticket
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-[#f7f7f5] border border-[#e9e9e6] p-1 rounded-2xl gap-1 overflow-x-auto custom-scrollbar">
        {[
          { id: 'alerts', label: 'Live Warning Flags', icon: <AlertOctagon size={14} /> },
          { id: 'incidents', label: 'Incident Ticket Log', icon: <FileText size={14} /> },
          { id: 'reports', label: 'Reports & Exports', icon: <Download size={14} /> }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-5 py-3 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              activeTab === tab.id 
                ? 'bg-white text-[#006fee] border border-[#e9e9e6] shadow-sm' 
                : 'text-[#7c7b77] hover:text-[#37352f] border border-transparent'
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
          <Card className="bg-white border-[#e9e9e6] shadow-sm">
            <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            </CardContent>
          </Card>

          {loading ? (
            <div className="py-20 text-center text-zinc-500 font-semibold"><RefreshCw className="animate-spin text-[#006fee] mx-auto mb-3" size={24} /> Syncing warnings database...</div>
          ) : alerts.length === 0 ? (
            <div className="p-16 text-center text-zinc-500 border border-[#e9e9e6] bg-[#f7f7f5]/30 rounded-2xl">
              <ShieldCheck size={42} className="mx-auto mb-3 text-[#27ae60] animate-radar" />
              <h4 className="text-[#37352f] font-bold mb-1 uppercase tracking-widest text-xs">Node Ingress Secure</h4>
              <p className="text-[10px] text-[#7c7b77] font-bold">No active warnings or threat flags found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {alerts.map((alert) => (
                <div key={alert.id} className="p-5 border border-[#e9e9e6] bg-white rounded-2xl flex flex-col justify-between gap-4 shadow-sm hover:border-[#7c7b77]/30 transition-all">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <Badge type={alert.detection_type}>{alert.detection_type}</Badge>
                      <span className="text-[9px] font-mono font-bold bg-[#f7f7f5] border border-[#e9e9e6] px-2 py-0.5 rounded-lg text-[#37352f]">
                        {(alert.confidence * 100).toFixed(0)}% Match
                      </span>
                    </div>
                    <span className="text-[9px] font-mono font-bold text-[#7c7b77]">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                  </div>

                  <div className="flex gap-4">
                    {alert.evidence_path && (
                      <div className="h-16 w-24 shrink-0 rounded-xl overflow-hidden border border-[#e9e9e6] bg-black flex items-center justify-center relative group shadow-sm">
                        <img src={evidenceUrl(alert.evidence_path) || ''} alt="Evidence" className="w-full h-full object-cover" />
                        <button onClick={() => setZoomUrl(evidenceUrl(alert.evidence_path))} className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white cursor-pointer">
                          <Eye size={16} />
                        </button>
                      </div>
                    )}
                    <div className="space-y-1.5 text-xs">
                      <p className="font-bold text-[#37352f] tracking-tight">Surveillance Cam: {alert.camera_id || 'Upload feed'}</p>
                      <p className="text-[#7c7b77] font-bold">Location: {alert.location || 'N/A'}</p>
                    </div>
                  </div>

                  <div className="flex justify-between items-center border-t border-[#e9e9e6] pt-4">
                    <span className="text-[9px] font-mono font-bold text-[#a4a3a0]">ID: {alert.id.slice(0, 8).toUpperCase()}</span>
                    <div className="flex gap-2">
                      {alert.status === 'active' && (
                        <Button variant="outline" size="sm" className="h-8 flex items-center gap-1.5 bg-white border border-[#e9e9e6] text-xs" onClick={() => void handleResolveAlert(alert.id)}>
                          <Check size={12} /> Resolve
                        </Button>
                      )}
                      <Button variant="destructive" size="sm" className="h-8 p-2 rounded-xl text-xs" onClick={() => void handleDeleteAlert(alert.id)}>
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
        <div className="space-y-6 animate-slide-up">
          <Card className="bg-white border-[#e9e9e6] shadow-sm">
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
            <div className="py-20 text-center text-[#7c7b77] font-semibold"><RefreshCw className="animate-spin text-[#006fee] mx-auto mb-3" size={24} /> Syncing incidents log...</div>
          ) : incidents.length === 0 ? (
            <div className="p-16 text-center text-[#7c7b77] border border-[#e9e9e6] bg-[#f7f7f5]/30 rounded-2xl">
              <ShieldCheck size={42} className="mx-auto mb-3 text-[#27ae60] animate-radar" />
              <h4 className="text-[#37352f] font-bold mb-1 uppercase tracking-widest text-xs">Node Ingress Secure</h4>
              <p className="text-[10px] text-[#7c7b77] font-bold">No incident tickets logged.</p>
            </div>
          ) : (
            <div className="border border-[#e9e9e6] rounded-xl bg-white overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#e9e9e6] bg-[#f7f7f5]/35 text-[#7c7b77] font-bold uppercase tracking-wider">
                      <th className="p-4 px-6">Title</th>
                      <th className="p-4 px-6">Severity</th>
                      <th className="p-4 px-6">Reporter</th>
                      <th className="p-4 px-6">Assigned Staff</th>
                      <th className="p-4 px-6">Triage</th>
                      <th className="p-4 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e9e9e6] text-[#37352f] font-semibold">
                    {incidents.map((inc) => (
                      <tr key={inc.id} className="hover:bg-[#f7f7f5]/40 transition-colors">
                        <td className="p-4 px-6 font-bold text-xs">{inc.title}</td>
                        <td className="p-4 px-6">
                          <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider border ${
                            inc.severity === 'critical' ? 'bg-[#fdebeb] text-[#eb5757] border-[#f8cfcf]' :
                            inc.severity === 'high' ? 'bg-[#fef5ed] text-[#f2994a] border-[#fcdcb8]' : 'bg-[#fdf8e7] text-[#b38b00] border-[#fae8b8]'
                          }`}>
                            {inc.severity}
                          </span>
                        </td>
                        <td className="p-4 px-6 text-[#7c7b77] font-bold">{inc.reporter || 'AI System'}</td>
                        <td className="p-4 px-6 text-[#7c7b77] font-bold">{inc.assigned_user || 'Unassigned'}</td>
                        <td className="p-4 px-6"><Badge type={inc.status === 'active' ? 'danger' : 'default'}>{inc.status}</Badge></td>
                        <td className="p-4 px-6 text-right space-x-1.5">
                          {inc.status === 'active' && (
                            <Button variant="outline" size="sm" onClick={() => void handleResolveIncident(inc.id)} className="h-8 p-2 rounded-lg bg-white border border-[#e9e9e6]" title="Mark Resolved">
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
                          }} className="h-8 p-2 rounded-lg bg-white border border-[#e9e9e6]" title="Edit Ticket">
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
          <Card className="bg-white border-[#e9e9e6] shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div className="p-2.5 rounded-lg bg-[#eb5757]/10 border border-[#eb5757]/20 text-[#eb5757] w-fit">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-[#37352f]">Generate Operations Incident Report</h3>
              <p className="text-[11px] text-[#7c7b77] leading-relaxed font-bold">
                Compile all logged fire, smoke, and threat warnings. Creates a certified operational PDF audit log detailing timestamps, confidence percentages, and operator comments.
              </p>
              <Button variant="primary" size="sm" onClick={handleExportPdf} className="w-full flex items-center justify-center gap-2 text-xs">
                <Download size={14} /> Download PDF Report
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-white border-[#e9e9e6] shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div className="p-2.5 rounded-lg bg-[#f2994a]/10 border border-[#f2994a]/20 text-[#f2994a] w-fit">
                <BarChart className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-[#37352f]">Download Ingest Logs (CSV)</h3>
              <p className="text-[11px] text-[#7c7b77] leading-relaxed font-bold">
                Export complete historical threat and surveillance activity records into a CSV spreadsheet. Perfect for import into external data analysis databases.
              </p>
              <Button variant="outline" size="sm" onClick={() => {
                const token = localStorage.getItem('fg-token');
                window.open(`${APP_CONFIG.apiBaseUrl}/api/v1/history/export/csv?token=${token || ''}`, '_blank');
                toast('Exporting CSV logs...', 'info');
              }} className="w-full flex items-center justify-center gap-2 bg-white border border-[#e9e9e6] text-xs">
                <Download size={14} /> Download CSV Logs
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Incident Modal */}
      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title={formMode === 'create' ? 'Create Incident Ticket' : 'Edit Incident Ticket'}>
        <form onSubmit={handleCreateOrEditIncident} className="space-y-4 text-xs font-semibold text-[#7c7b77]">
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
            placeholder="operator@fireguard.ai"
          />
          <Input 
            label="Resolution Comments" 
            value={form.notes || ''} 
            onChange={(e) => setForm({ ...form, notes: e.target.value })} 
            placeholder="Triage steps or remarks."
          />
          <div className="flex justify-end gap-2 pt-4 border-t border-[#e9e9e6] font-bold">
            <Button variant="outline" size="sm" type="button" onClick={() => setFormOpen(false)} className="bg-white border border-[#e9e9e6] text-xs">Cancel</Button>
            <Button variant="primary" size="sm" type="submit" isLoading={isSubmitting} className="text-xs">
              {formMode === 'create' ? 'File Ticket' : 'Save Details'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Image Zoom Modal */}
      <Modal isOpen={!!zoomUrl} onClose={() => setZoomUrl(null)} title="Full-Resolution Evidence Frame">
        {zoomUrl && (
          <div className="rounded-xl overflow-hidden border border-[#e9e9e6] bg-black flex justify-center shadow-lg">
            <img src={zoomUrl} alt="Evidence" className="w-full h-auto object-contain max-h-[500px]" />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AlertsReports;
