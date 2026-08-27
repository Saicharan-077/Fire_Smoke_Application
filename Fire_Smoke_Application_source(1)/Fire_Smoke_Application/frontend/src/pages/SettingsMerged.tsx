import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/Common/Card';
import { Button } from '../components/Common/Button';
import { Input } from '../components/Common/Input';
import { Modal } from '../components/Common/Modal';
import { useToast } from '../components/ui/Toast';
import { 
  listCameras, createCamera, patchCamera, deleteCamera, 
  patchCameraStatus, type Camera 
} from '../services/cameraService';
import { testCctvConnection, getSettings, updateSettings } from '../services/api';
import { 
  Settings, Camera as CameraIcon, Cpu, Bell, 
  User, Plus, Trash2, Edit2, ShieldCheck,
  Sliders, Database, Save, RotateCcw, Zap
} from 'lucide-react';
import { useAppSettingsStore } from '../store/appSettingsStore';

const DEFAULT_FORM = {
  name: '',
  location: '',
  zone: '',
  stream_url: '',
  description: '',
};

const SettingsMerged = () => {
  const { toast } = useToast();
  const { theme, setTheme, setAlertSoundEnabled } = useAppSettingsStore();

  const [activeSection, setActiveSection] = useState<'general' | 'ai' | 'thresholds' | 'camera' | 'rtsp' | 'notifications' | 'storage' | 'account' | 'triggers'>('general');

  // ── 1. General & AI States ───────────────────────────────────────────────────
  const [systemMode, setSystemMode] = useState('surveillance');
  const [debugLevel, setDebugLevel] = useState('info');
  const [yoloWeights, setYoloWeights] = useState('models/best.pt');
  const [device, setDevice] = useState('cpu');
  const [confFire, setConfFire] = useState(0.35);
  const [confSmoke, setConfSmoke] = useState(0.40);
  const [nmsThreshold, setNmsThreshold] = useState(0.45);
  const [enableAudio, setEnableAudio] = useState(true);
  const [enableEmail, setEnableEmail] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('http://localhost:9000/webhook');
  const [storagePath, setStoragePath] = useState('./evidence');
  const [purgeDays, setPurgeDays] = useState(30);

  // ── Emergency Triggers State
  const [triggerSprinklers, setTriggerSprinklers] = useState(false);
  const [triggerAlarm, setTriggerAlarm] = useState(true);
  const [triggerLockdown, setTriggerLockdown] = useState(false);

  // ── 2. Camera Management State ───────────────────────────────────────────────
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loadingCameras, setLoadingCameras] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editCameraId, setEditCameraId] = useState<string | null>(null);
  const [cameraForm, setCameraForm] = useState({ ...DEFAULT_FORM });
  const [submittingCamera, setSubmittingCamera] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  const fetchCameras = async () => {
    try {
      setLoadingCameras(true);
      const data = await listCameras();
      setCameras(data);
    } catch (err: any) {
      toast('Failed to load camera list.', 'error');
    } finally {
      setLoadingCameras(false);
    }
  };

  const handleTestRtsp = async () => {
    if (!cameraForm.stream_url) {
      toast('Please enter an RTSP Stream URL.', 'error');
      return;
    }
    setTestingConnection(true);
    try {
      const res = await testCctvConnection(cameraForm.stream_url);
      toast(`Connection Success: ${res.message}`, 'success');
    } catch (err: any) {
      toast(`Connection Failed: ${err.message}`, 'error');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleCameraSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cameraForm.name) return;
    setSubmittingCamera(true);
    try {
      if (formMode === 'create') {
        await createCamera(cameraForm);
        toast('Camera device configured.', 'success');
      } else if (editCameraId) {
        await patchCamera(editCameraId, cameraForm);
        toast('Camera configuration updated.', 'success');
      }
      setFormOpen(false);
      void fetchCameras();
    } catch (e: any) {
      toast(e.message || 'Failed to save camera.', 'error');
    } finally {
      setSubmittingCamera(false);
    }
  };

  const handleDeleteCamera = async (id: string) => {
    if (!window.confirm('Remove this camera device permanently?')) return;
    try {
      await deleteCamera(id);
      toast('Camera device removed.', 'info');
      void fetchCameras();
    } catch (e: any) {
      toast(e.message || 'Failed to delete camera.', 'error');
    }
  };

  const handleToggleCameraStatus = async (cam: Camera) => {
    const next = cam.status === 'online' ? 'offline' : 'online';
    try {
      await patchCameraStatus(cam.id, { status: next });
      toast(`Camera ${cam.name} status updated to ${next}.`, 'success');
      void fetchCameras();
    } catch (e: any) {
      toast('Failed to toggle status.', 'error');
    }
  };

  const handleSaveAllSettings = async () => {
    try {
      await updateSettings({
        system_mode: systemMode,
        debug_level: debugLevel,
        yolo_weights: yoloWeights,
        inference_device: device,
        fire_min_confidence: String(confFire),
        smoke_min_confidence: String(confSmoke),
        nms_threshold: String(nmsThreshold),
        enable_sound_alerts: String(enableAudio),
        enable_email_alerts: String(enableEmail),
        webhook_url: webhookUrl,
        evidence_storage_path: storagePath,
        retention_days: String(purgeDays),
      });
      setAlertSoundEnabled(enableAudio);
      toast('Settings saved successfully to the system database.', 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to save settings.', 'error');
    }
  };

  const handleResetSettings = () => {
    setSystemMode('surveillance');
    setDebugLevel('info');
    setYoloWeights('models/best.pt');
    setDevice('cpu');
    setConfFire(0.35);
    setConfSmoke(0.40);
    setNmsThreshold(0.45);
    setEnableAudio(true);
    setEnableEmail(false);
    setWebhookUrl('http://localhost:9000/webhook');
    setStoragePath('./evidence');
    setPurgeDays(30);
    toast('Settings reset to system defaults.', 'info');
  };

  useEffect(() => {
    void fetchCameras();
    void (async () => {
      try {
        const settings = await getSettings();
        const map = Object.fromEntries(settings.map((s) => [s.id, s.value]));
        if (map.system_mode) setSystemMode(map.system_mode);
        if (map.debug_level) setDebugLevel(map.debug_level);
        if (map.yolo_weights) setYoloWeights(map.yolo_weights);
        if (map.inference_device) setDevice(map.inference_device);
        if (map.fire_min_confidence) setConfFire(parseFloat(map.fire_min_confidence));
        if (map.smoke_min_confidence) setConfSmoke(parseFloat(map.smoke_min_confidence));
        if (map.nms_threshold) setNmsThreshold(parseFloat(map.nms_threshold));
        if (map.enable_sound_alerts) setEnableAudio(map.enable_sound_alerts === 'true');
        if (map.enable_email_alerts) setEnableEmail(map.enable_email_alerts === 'true');
        if (map.webhook_url) setWebhookUrl(map.webhook_url);
        if (map.evidence_storage_path) setStoragePath(map.evidence_storage_path);
        if (map.retention_days) setPurgeDays(parseInt(map.retention_days, 10));
      } catch {
        // Settings load optional on first run
      }
    })();
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 select-none">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">System Settings</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure cameras, adjust AI confidence thresholds, and manage alert notifications.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleResetSettings} className="flex items-center gap-1">
            <RotateCcw size={14} /> Reset Defaults
          </Button>
          <Button variant="primary" size="sm" onClick={handleSaveAllSettings} className="flex items-center gap-1">
            <Save size={14} /> Save Config
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Sidebar Sections */}
        <div className="space-y-1">
          {[
            { id: 'general', label: 'General', icon: <Settings size={16} /> },
            { id: 'ai', label: 'AI Model', icon: <Cpu size={16} /> },
            { id: 'thresholds', label: 'Confidence & NMS', icon: <Sliders size={16} /> },
            { id: 'camera', label: 'Camera Configuration', icon: <CameraIcon size={16} /> },
            { id: 'rtsp', label: 'RTSP Configuration', icon: <MonitorPlayIcon size={16} /> },
            { id: 'notifications', label: 'Notifications', icon: <Bell size={16} /> },
            { id: 'triggers', label: 'Emergency Triggers', icon: <Zap size={16} /> },
            { id: 'storage', label: 'Storage & Purging', icon: <Database size={16} /> },
            { id: 'account', label: 'Theme & Account', icon: <User size={16} /> },
          ].map((sec) => (
            <button
              key={sec.id}
              onClick={() => setActiveSection(sec.id as any)}
              className={`w-full flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-semibold transition-all ${
                activeSection === sec.id 
                  ? 'bg-red-500/10 text-red-500 border border-red-500/10 shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/10'
              }`}
            >
              {sec.icon} {sec.label}
            </button>
          ))}
        </div>

        {/* Configurations Ingest */}
        <div className="lg:col-span-3">
          
          {/* GENERAL SECTION */}
          {activeSection === 'general' && (
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardHeader><CardTitle>General Settings</CardTitle></CardHeader>
              <CardContent className="p-6 space-y-5">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Operational Mode</label>
                  <select 
                    value={systemMode}
                    onChange={(e) => setSystemMode(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5 text-xs font-bold text-gray-900 dark:text-white outline-none"
                  >
                    <option value="surveillance">Surveillance & Alerting</option>
                    <option value="audit">Compliance Audit Mode</option>
                    <option value="silent">Silent Monitoring (No Alarms)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Logging Verbosity</label>
                  <select 
                    value={debugLevel}
                    onChange={(e) => setDebugLevel(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5 text-xs font-bold text-gray-900 dark:text-white outline-none"
                  >
                    <option value="debug">Debug (All logs)</option>
                    <option value="info">Info (Default)</option>
                    <option value="warning">Warnings & Errors</option>
                  </select>
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI MODEL SECTION */}
          {activeSection === 'ai' && (
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardHeader><CardTitle>AI Model Configuration</CardTitle></CardHeader>
              <CardContent className="p-6 space-y-5">
                <Input 
                  label="YOLOv8 Weights Path" 
                  value={yoloWeights} 
                  onChange={(e) => setYoloWeights(e.target.value)} 
                />
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Hardware Device Acceleration</label>
                  <select 
                    value={device}
                    onChange={(e) => setDevice(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5 text-xs font-bold text-gray-900 dark:text-white outline-none"
                  >
                    <option value="cpu">CPU Execution</option>
                    <option value="cuda">NVIDIA CUDA GPU</option>
                    <option value="rocm">AMD ROCm GPU</option>
                  </select>
                </div>
              </CardContent>
            </Card>
          )}

          {/* THRESHOLDS SECTION */}
          {activeSection === 'thresholds' && (
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardHeader><CardTitle>Confidence & NMS Thresholds</CardTitle></CardHeader>
              <CardContent className="p-6 space-y-6">
                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                    <span>Fire Confidence Threshold</span>
                    <span className="text-red-500">{Math.round(confFire * 100)}%</span>
                  </div>
                  <input 
                    type="range" min="0.10" max="0.95" step="0.05" 
                    value={confFire}
                    onChange={(e) => setConfFire(parseFloat(e.target.value))}
                    className="w-full accent-red-500" 
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                    <span>Smoke Confidence Threshold</span>
                    <span className="text-orange-500">{Math.round(confSmoke * 100)}%</span>
                  </div>
                  <input 
                    type="range" min="0.10" max="0.95" step="0.05" 
                    value={confSmoke}
                    onChange={(e) => setConfSmoke(parseFloat(e.target.value))}
                    className="w-full accent-orange-500" 
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                    <span>Non-Maximum Suppression (NMS) IoU Threshold</span>
                    <span className="text-indigo-500">{Math.round(nmsThreshold * 100)}%</span>
                  </div>
                  <input 
                    type="range" min="0.10" max="0.95" step="0.05" 
                    value={nmsThreshold}
                    onChange={(e) => setNmsThreshold(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500" 
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* CAMERA CONFIGURATION */}
          {activeSection === 'camera' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-sm text-gray-900 dark:text-white">Camera Configuration</h3>
                <Button variant="primary" size="sm" onClick={() => { setFormMode('create'); setCameraForm({ ...DEFAULT_FORM }); setFormOpen(true); }} className="flex items-center gap-1">
                  <Plus size={14} /> Configure Camera
                </Button>
              </div>

              {loadingCameras ? (
                <div className="py-12 text-center text-slate-500">Loading cameras...</div>
              ) : cameras.length === 0 ? (
                <div className="p-12 text-center text-slate-500 border border-slate-800 rounded-2xl">
                  <CameraIcon size={36} className="mx-auto mb-2 text-slate-650" />
                  <p className="text-xs">No cameras configured.</p>
                </div>
              ) : (
                <div className="border border-slate-800 rounded-2xl bg-[#0f0f17] overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-850 bg-slate-900/40 text-slate-400 font-semibold tracking-wider">
                        <th className="p-4">Name</th>
                        <th className="p-4">Zone</th>
                        <th className="p-4">Status</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850 text-slate-300">
                      {cameras.map((cam) => (
                        <tr key={cam.id} className="hover:bg-slate-800/10">
                          <td className="p-4 font-bold text-gray-900 dark:text-white">{cam.name}</td>
                          <td className="p-4">{cam.zone || 'N/A'}</td>
                          <td className="p-4">
                            <button onClick={() => void handleToggleCameraStatus(cam)} className="cursor-pointer">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                                cam.status === 'online' ? 'bg-green-500/15 text-green-500' : 'bg-red-500/15 text-red-500'
                              }`}>{cam.status}</span>
                            </button>
                          </td>
                          <td className="p-4 text-right space-x-2">
                            <Button variant="outline" size="sm" onClick={() => {
                              setFormMode('edit');
                              setEditCameraId(cam.id);
                              setCameraForm({
                                name: cam.name || '',
                                location: cam.location || '',
                                zone: cam.zone || '',
                                stream_url: cam.stream_url || '',
                                description: cam.description || '',
                              });
                              setFormOpen(true);
                            }} className="h-7"><Edit2 size={10} /></Button>
                            <Button variant="destructive" size="sm" onClick={() => void handleDeleteCamera(cam.id)} className="h-7"><Trash2 size={10} /></Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* RTSP CONFIGURATION */}
          {activeSection === 'rtsp' && (
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardHeader><CardTitle>RTSP Stream Options</CardTitle></CardHeader>
              <CardContent className="p-6 space-y-5">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Protocol Ingest Method</label>
                  <select className="w-full px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5 text-xs font-bold text-gray-900 dark:text-white outline-none">
                    <option value="rtsp">RTSP (Real-Time Streaming Protocol)</option>
                    <option value="rtmp">RTMP (Real-Time Messaging Protocol)</option>
                    <option value="hls">HTTP Live Streaming (HLS)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Network Timeout (Seconds)</label>
                  <input type="number" defaultValue="10" className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5 text-xs font-bold text-gray-900 dark:text-white outline-none" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* NOTIFICATIONS SECTION */}
          {activeSection === 'notifications' && (
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardHeader><CardTitle>Alert Dispatch & Notifications</CardTitle></CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="font-semibold text-xs text-gray-900 dark:text-white">Enable Local Audio Siren</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5">Synthesizes audio alarm warnings on the browser.</p>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={enableAudio}
                    onChange={(e) => setEnableAudio(e.target.checked)}
                    className="accent-red-500 w-4 h-4" 
                  />
                </div>
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="font-semibold text-xs text-gray-900 dark:text-white">Email Incident Logs</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5">Dispatches automatic PDF summaries to safety operators.</p>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={enableEmail}
                    onChange={(e) => setEnableEmail(e.target.checked)}
                    className="accent-red-500 w-4 h-4" 
                  />
                </div>
                <Input 
                  label="Dispatch Webhook Endpoint" 
                  value={webhookUrl} 
                  onChange={(e) => setWebhookUrl(e.target.value)} 
                />
              </CardContent>
            </Card>
          )}

          {/* TRIGGERS SECTION */}
          {activeSection === 'triggers' && (
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardHeader><CardTitle>Automated Emergency Responses</CardTitle></CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="flex justify-between items-center p-4 border border-red-500/20 bg-red-500/5 rounded-xl">
                  <div>
                    <h4 className="font-semibold text-xs text-gray-900 dark:text-white flex items-center gap-2"><Zap size={14} className="text-red-500"/> Activate Sprinkler System</h4>
                    <p className="text-[10px] text-slate-400 mt-1 max-w-sm">Automatically trigger fire suppression via IoT integration if fire confidence is {'>'}90% for 5 seconds.</p>
                  </div>
                  <input type="checkbox" checked={triggerSprinklers} onChange={(e) => setTriggerSprinklers(e.target.checked)} className="accent-red-500 w-5 h-5 cursor-pointer" />
                </div>
                <div className="flex justify-between items-center p-4 border border-orange-500/20 bg-orange-500/5 rounded-xl">
                  <div>
                    <h4 className="font-semibold text-xs text-gray-900 dark:text-white flex items-center gap-2"><Bell size={14} className="text-orange-500"/> Sound General Facility Alarm</h4>
                    <p className="text-[10px] text-slate-400 mt-1 max-w-sm">Dispatch general evacuation alarm across all connected PA speakers.</p>
                  </div>
                  <input type="checkbox" checked={triggerAlarm} onChange={(e) => setTriggerAlarm(e.target.checked)} className="accent-orange-500 w-5 h-5 cursor-pointer" />
                </div>
                <div className="flex justify-between items-center p-4 border border-indigo-500/20 bg-indigo-500/5 rounded-xl">
                  <div>
                    <h4 className="font-semibold text-xs text-gray-900 dark:text-white flex items-center gap-2"><ShieldCheck size={14} className="text-indigo-500"/> Initiate Building Lockdown</h4>
                    <p className="text-[10px] text-slate-400 mt-1 max-w-sm">Seal fire doors and override access control systems in the affected zone.</p>
                  </div>
                  <input type="checkbox" checked={triggerLockdown} onChange={(e) => setTriggerLockdown(e.target.checked)} className="accent-indigo-500 w-5 h-5 cursor-pointer" />
                </div>
                
                <div className="pt-4 border-t border-slate-800">
                  <Button variant="outline" className="w-full text-red-500 border-red-500/30 hover:bg-red-500/10 hover:border-red-500">
                    TEST EMERGENCY TRIGGERS
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* STORAGE SECTION */}
          {activeSection === 'storage' && (
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardHeader><CardTitle>Storage & Purging Settings</CardTitle></CardHeader>
              <CardContent className="p-6 space-y-5">
                <Input 
                  label="Evidence Storage Path" 
                  value={storagePath} 
                  onChange={(e) => setStoragePath(e.target.value)} 
                />
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Purge Interval (Days)</label>
                  <input 
                    type="number" 
                    value={purgeDays}
                    onChange={(e) => setPurgeDays(parseInt(e.target.value) || 30)}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5 text-xs font-bold text-gray-900 dark:text-white outline-none" 
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* ACCOUNT & THEME SECTION */}
          {activeSection === 'account' && (
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
              <CardHeader><CardTitle>Theme & Account Preferences</CardTitle></CardHeader>
              <CardContent className="p-6 space-y-6">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Active System Theme</label>
                  <select 
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as any)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5 text-xs font-bold text-gray-900 dark:text-white outline-none"
                  >
                    <option value="dark">Dark Theme (Recommended)</option>
                    <option value="light">Light Theme</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Operator Clearance Level</label>
                  <input type="text" value="Administrator" disabled className="w-full px-4 py-2.5 rounded-xl bg-slate-850 border border-slate-800 text-xs font-bold text-slate-400 cursor-not-allowed" />
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      </div>

      {/* Camera Ingest Modal */}
      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title={formMode === 'create' ? 'Configure Camera Stream' : 'Update Camera Stream'}>
        <form onSubmit={handleCameraSubmit} className="space-y-4">
          <Input 
            label="Name / Device ID" 
            value={cameraForm.name} 
            onChange={(e) => setCameraForm({ ...cameraForm, name: e.target.value })} 
            placeholder="CAM-06 Front Yard"
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input 
              label="Location" 
              value={cameraForm.location} 
              onChange={(e) => setCameraForm({ ...cameraForm, location: e.target.value })} 
              placeholder="Warehouse A"
            />
            <Input 
              label="Monitoring Zone" 
              value={cameraForm.zone} 
              onChange={(e) => setCameraForm({ ...cameraForm, zone: e.target.value })} 
              placeholder="Zone F"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Stream RTSP/HTTP URL</label>
            <div className="flex gap-2">
              <input 
                type="text" 
                value={cameraForm.stream_url} 
                onChange={(e) => setCameraForm({ ...cameraForm, stream_url: e.target.value })} 
                placeholder="rtsp://192.168.1.100:554/h264"
                className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5 focus:border-red-500/30 text-gray-900 dark:text-white outline-none transition-all text-sm font-semibold"
              />
              <Button type="button" variant="outline" size="sm" onClick={handleTestRtsp} isLoading={testingConnection}>
                Test Link
              </Button>
            </div>
          </div>
          <Input 
            label="Hardware Description" 
            value={cameraForm.description} 
            onChange={(e) => setCameraForm({ ...cameraForm, description: e.target.value })} 
            placeholder="High resolution outdoor bullet camera."
          />
          <div className="flex justify-end gap-2 pt-4 border-t border-slate-800">
            <Button variant="outline" size="sm" type="button" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" type="submit" isLoading={submittingCamera}>
              {formMode === 'create' ? 'Create Ingest' : 'Save Details'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

// MonitorPlayIcon placeholder to avoid compiler warning
const MonitorPlayIcon = ({ size, className }: { size?: number; className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width={size || 24} 
    height={size || 24} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <path d="M12 17v4" />
    <path d="M8 21h8" />
    <polygon points="10 7 15 10 10 13 10 7" />
  </svg>
);

export default SettingsMerged;
