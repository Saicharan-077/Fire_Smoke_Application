import React, { useState, useEffect } from 'react';
import { Input, Select } from '../components/Common/Input';
import { Modal } from '../components/Common/Modal';
import { useToast } from '../components/ui/Toast';
import { createCamera, patchCamera, deleteCamera, listCameras } from '../services/cameraService';
import type { CameraStatus } from '../services/cameraService';
import { testCctvConnection, getSettings, updateSettings } from '../services/api';
import {
  Camera as CameraIcon, Bell, Plus, Trash2, Edit2,
  Sliders, Database, Wifi
} from 'lucide-react';
import { useAppSettingsStore } from '../store/appSettingsStore';
import { motion } from 'framer-motion';

const DEFAULT_FORM = {
  name: '', stream_url: '', location: '', zone: '', status: 'online' as CameraStatus,
};

const SECTIONS = [
  { id: 'ai',      label: 'AI Parameters', icon: Sliders },
  { id: 'cameras', label: 'Cameras',       icon: CameraIcon },
  { id: 'notifs',  label: 'Notifications', icon: Bell },
  { id: 'system',  label: 'System Settings', icon: Database },
];

const SettingsPage = () => {
  const { toast } = useToast();
  const { theme, setTheme } = useAppSettingsStore();
  const [activeSection, setActiveSection] = useState<'ai' | 'cameras' | 'notifs' | 'system'>('ai');

  // AI thresholds
  const [fireConfidence, setFireConfidence] = useState(0.40);
  const [smokeConfidence, setSmokeConfidence] = useState(0.50);
  const [iouThreshold, setIouThreshold] = useState(0.45);
  const [frameInterval, setFrameInterval] = useState(3);
  const [saveEvidence, setSaveEvidence] = useState(true);
  const [operatingMode, setOperatingMode] = useState('Balanced');

  const fetchAIConfig = async () => {
    try {
      const res = await getSettings();
      const fire = res.find((s: any) => s.id === 'fire_min_confidence')?.value;
      if (fire) setFireConfidence(parseFloat(fire));
      const smoke = res.find((s: any) => s.id === 'smoke_min_confidence')?.value;
      if (smoke) setSmokeConfidence(parseFloat(smoke));
      const iou = res.find((s: any) => s.id === 'iou_threshold')?.value;
      if (iou) setIouThreshold(parseFloat(iou));
      const skip = res.find((s: any) => s.id === 'frame_skip')?.value;
      if (skip) setFrameInterval(parseInt(skip));
      const save = res.find((s: any) => s.id === 'save_evidence')?.value;
      if (save) setSaveEvidence(save === 'true');
      const mode = res.find((s: any) => s.id === 'operating_mode')?.value;
      if (mode) setOperatingMode(mode);
    } catch { /* defaults */ }
  };

  const saveAIConfig = async () => {
    try {
      await updateSettings({
        fire_min_confidence: String(fireConfidence),
        smoke_min_confidence: String(smokeConfidence),
        iou_threshold: String(iouThreshold),
        frame_skip: String(frameInterval),
        save_evidence: String(saveEvidence),
        operating_mode: operatingMode,
      });
      toast('AI configuration saved successfully', 'success');
    } catch (e: any) {
      toast(e.message || 'Failed to save settings', 'error');
    }
  };

  // Cameras
  const [cameras, setCameras] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [testingConn, setTestingConn] = useState(false);
  const [savingCam, setSavingCam] = useState(false);

  const fetchCameras = async () => {
    try { setCameras(await listCameras()); } catch { /**/ }
  };

  const testConn = async () => {
    if (!form.stream_url) { toast('Enter stream URL first', 'error'); return; }
    setTestingConn(true);
    try {
      const r = await testCctvConnection(form.stream_url);
      toast(r.message || 'RTSP Connection successful', 'success');
    } catch (e: any) {
      toast(e.message || 'RTSP Connection handshake failed', 'error');
    } finally { setTestingConn(false); }
  };

  const handleSaveCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.stream_url) { toast('Name and stream URL are required', 'error'); return; }
    setSavingCam(true);
    try {
      if (formMode === 'create') await createCamera(form);
      else if (editId) await patchCamera(editId, form);
      toast(formMode === 'create' ? 'Camera registered successfully' : 'Camera updated', 'success');
      setModalOpen(false);
      setForm(DEFAULT_FORM);
      void fetchCameras();
    } catch (e: any) {
      toast(e.message || 'Failed to save camera', 'error');
    } finally { setSavingCam(false); }
  };

  const handleDeleteCamera = async (id: string) => {
    if (!confirm('Permanently delete this camera source?')) return;
    try { await deleteCamera(id); toast('Camera source deleted', 'info'); void fetchCameras(); }
    catch (e: any) { toast(e.message || 'Failed to delete camera', 'error'); }
  };

  // Notifications
  const [notifSound, setNotifSound] = useState(true);
  const [notifEmail, setNotifEmail] = useState(false);
  const [notifSprinkler, setNotifSprinkler] = useState(false);

  useEffect(() => { void fetchAIConfig(); void fetchCameras(); }, []);

  const SliderField = ({ label, desc, value, min, max, step, onChange, format }: any) => (
    <div className="space-y-2 pb-5 border-b border-[var(--border)] last:border-0 last:pb-0">
      <div className="flex items-center justify-between">
        <label className="text-[13px] font-bold text-[var(--text)]">{label}</label>
        <span className="text-[12px] font-mono font-bold text-[var(--primary)] bg-[var(--primary-light)] px-2 py-0.5 rounded-md border border-[var(--primary-ring)]">
          {format ? format(value) : value}
        </span>
      </div>
      {desc && <p className="text-[12px] text-[var(--text-2)] font-semibold">{desc}</p>}
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[var(--primary)] bg-[var(--surface-3)]"
      />
      <div className="flex justify-between text-[10px] text-[var(--text-3)] font-bold">
        <span>{min}</span><span>{max}</span>
      </div>
    </div>
  );

  const ToggleRow = ({ label, desc, value, onChange }: any) => (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-[var(--border)] last:border-0">
      <div>
        <p className="text-[13px] font-bold text-[var(--text)]">{label}</p>
        {desc && <p className="text-[12px] text-[var(--text-2)] font-semibold mt-0.5">{desc}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative shrink-0 w-10 h-6 rounded-full transition-colors duration-200 cursor-pointer ${value ? 'bg-[var(--primary)]' : 'bg-[var(--surface-3)]'}`}
      >
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-200 ${value ? 'left-5' : 'left-1'}`} />
      </button>
    </div>
  );

  return (
    <motion.div className="space-y-6 text-[var(--text)] font-sans" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-[var(--text)]">Settings</h1>
          <p className="text-[13px] text-[var(--text-2)] mt-0.5 font-semibold">AI model parameters, camera management, and system preferences</p>
        </div>
        {activeSection === 'cameras' && (
          <button
            onClick={() => { setFormMode('create'); setForm(DEFAULT_FORM); setModalOpen(true); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-[12px] font-bold rounded-lg transition-colors cursor-pointer shadow-sm"
          >
            <Plus size={14} /> Add Camera
          </button>
        )}
      </div>

      {/* Layout */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

        {/* Sidebar nav */}
        <div className="md:col-span-1">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-2 space-y-0.5 shadow-xs">
            {SECTIONS.map(sec => {
              const Icon = sec.icon;
              const active = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  onClick={() => setActiveSection(sec.id as any)}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-bold transition-all cursor-pointer ${
                    active ? 'bg-[var(--primary-light)] text-[var(--primary)] font-bold' : 'text-[var(--text-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
                  }`}
                >
                  <Icon size={15} className={active ? 'text-[var(--primary)]' : 'text-[var(--text-3)]'} />
                  {sec.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content panel */}
        <div className="md:col-span-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-xs">

          {/* AI Settings */}
          {activeSection === 'ai' && (
            <>
              <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-2)]">
                <p className="text-[13px] font-bold text-[var(--text)] uppercase tracking-wider">YOLOv8 Model Configuration</p>
                <p className="text-[12px] text-[var(--text-2)] font-semibold mt-0.5">Adjust inference thresholds and detection behavior</p>
              </div>
              <div className="p-5 space-y-5">
                <div className="flex flex-col gap-1.5 pb-4 border-b border-[var(--border)]">
                  <p className="text-[13px] font-bold text-[var(--text)]">Pipeline Sensitivity Preset</p>
                  <p className="text-[12px] text-[var(--text-2)] font-semibold mb-2">Select a predefined sensitivity profile. Changing a profile automatically loads thresholds.</p>
                  <select
                    value={operatingMode}
                    onChange={(e) => setOperatingMode(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[13px] text-[var(--text)] outline-none focus:border-[var(--primary)] transition-all cursor-pointer"
                  >
                    <option value="Balanced">Balanced Preset (Recommended)</option>
                    <option value="High Precision">High Precision (Minimize False Alarms)</option>
                    <option value="High Recall">High Recall (Capture All Events)</option>
                  </select>
                </div>
                <SliderField
                  label="Fire Match Confidence"
                  desc="Minimum confidence required to trigger a fire alert. Elevated to reduce false positives."
                  value={fireConfidence}
                  min={0.1} max={0.9} step={0.05}
                  onChange={setFireConfidence}
                  format={(v: number) => `${Math.round(v * 100)}%`}
                />
                <SliderField
                  label="Smoke Match Confidence"
                  desc="Minimum confidence required to trigger a smoke alert. Elevated to reduce false positives."
                  value={smokeConfidence}
                  min={0.1} max={0.9} step={0.05}
                  onChange={setSmokeConfidence}
                  format={(v: number) => `${Math.round(v * 100)}%`}
                />
                <SliderField
                  label="IoU Overlap Threshold"
                  desc="Controls non-maximum suppression for overlapping bounding boxes."
                  value={iouThreshold}
                  min={0.1} max={0.9} step={0.05}
                  onChange={setIouThreshold}
                  format={(v: number) => `${Math.round(v * 100)}%`}
                />
                <SliderField
                  label="Frame Skip Rate"
                  desc="Process every Nth frame for video/RTSP streams to reduce CPU load."
                  value={frameInterval}
                  min={1} max={10} step={1}
                  onChange={setFrameInterval}
                  format={(v: number) => `${v} frame${v > 1 ? 's' : ''}`}
                />
                <div className="flex items-start justify-between gap-4 pb-5 border-b border-[var(--border)]">
                  <div>
                    <p className="text-[13px] font-bold text-[var(--text)]">Save Evidence Snapshots</p>
                    <p className="text-[12px] text-[var(--text-2)] font-semibold mt-0.5">Store annotated bounding box frames to local storage</p>
                  </div>
                  <button
                    onClick={() => setSaveEvidence(!saveEvidence)}
                    className={`relative shrink-0 w-10 h-6 rounded-full transition-colors duration-200 cursor-pointer ${saveEvidence ? 'bg-[var(--primary)]' : 'bg-[var(--surface-3)]'}`}
                  >
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-200 ${saveEvidence ? 'left-5' : 'left-1'}`} />
                  </button>
                </div>
                <div className="flex gap-2 justify-end pt-1">
                  <button onClick={fetchAIConfig} className="px-3 py-2 border border-[var(--border)] rounded-lg text-[12px] font-bold text-[var(--text-2)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer">
                    Reset
                  </button>
                  <button onClick={saveAIConfig} className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-[12px] font-bold rounded-lg transition-colors cursor-pointer">
                    Save Changes
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Cameras */}
          {activeSection === 'cameras' && (
            <>
              <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-2)]">
                <p className="text-[13px] font-bold text-[var(--text)] uppercase tracking-wider">CCTV Cameras</p>
                <p className="text-[12px] text-[var(--text-2)] font-semibold mt-0.5">{cameras.length} camera{cameras.length !== 1 ? 's' : ''} registered</p>
              </div>
              <div className="p-5">
                {cameras.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14 gap-3 border-2 border-dashed border-[var(--border)] rounded-xl">
                    <div className="w-10 h-10 rounded-xl bg-[var(--surface-2)] flex items-center justify-center">
                      <CameraIcon size={18} className="text-[var(--text-3)]" />
                    </div>
                    <p className="text-[13px] text-[var(--text-2)] font-semibold">No cameras registered</p>
                    <button
                      onClick={() => { setFormMode('create'); setForm(DEFAULT_FORM); setModalOpen(true); }}
                      className="px-4 py-2 bg-[var(--primary)] text-white text-[12px] font-bold rounded-lg hover:bg-[var(--primary-hover)] transition-colors cursor-pointer"
                    >
                      Add First Camera
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {cameras.map(c => (
                      <div key={c.id} className="border border-[var(--border)] rounded-xl p-4 hover:border-[var(--border-strong)] transition-all bg-[var(--surface-2)]/30">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1 min-w-0 mr-2">
                            <p className="text-[13px] font-bold text-[var(--text)] truncate">{c.name}</p>
                            <p className="text-[11px] text-[var(--text-2)] font-semibold mt-0.5">Zone: {c.zone || 'Unassigned'}</p>
                          </div>
                          <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            c.status === 'active' || c.status === 'online'
                              ? 'bg-[var(--safe-bg)] text-[var(--safe-text)] border-[var(--safe-border)]'
                              : 'bg-[var(--fire-bg)] text-[var(--fire-text)] border-[var(--fire-border)]'
                          }`}>
                            {c.status}
                          </span>
                        </div>
                        <code className="block text-[10px] text-[var(--text-3)] font-mono truncate bg-[var(--bg)] border border-[var(--border)] px-2 py-1.5 rounded-lg mb-3">
                          {c.stream_url}
                        </code>
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => { setFormMode('edit'); setEditId(c.id); setForm({ name: c.name || '', stream_url: c.stream_url || '', location: c.location || '', zone: c.zone || '', status: c.status || 'online' }); setModalOpen(true); }}
                            className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => void handleDeleteCamera(c.id)}
                            className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--fire)] hover:bg-[var(--fire-bg)] hover:border-[var(--fire-border)] transition-colors cursor-pointer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Notifications */}
          {activeSection === 'notifs' && (
            <>
              <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-2)]">
                <p className="text-[13px] font-bold text-[var(--text)] uppercase tracking-wider">Alert Preferences</p>
                <p className="text-[12px] text-[var(--text-2)] font-semibold mt-0.5">Configure how you receive threat alerts</p>
              </div>
              <div className="p-5 space-y-0">
                <ToggleRow
                  label="Audio Sirens"
                  desc="Play synthesized audio alerts through system speakers on threat detection"
                  value={notifSound}
                  onChange={setNotifSound}
                />
                <ToggleRow
                  label="Email Notifications"
                  desc="Forward alerts to dispatch centers via email (requires SMTP configuration)"
                  value={notifEmail}
                  onChange={setNotifEmail}
                />
                <ToggleRow
                  label="Automatic Sprinkler Trigger"
                  desc="Unlock facility emergency systems when confidence exceeds 90%"
                  value={notifSprinkler}
                  onChange={setNotifSprinkler}
                />
              </div>
            </>
          )}

          {/* System */}
          {activeSection === 'system' && (
            <>
              <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-2)]">
                <p className="text-[13px] font-bold text-[var(--text)] uppercase tracking-wider">Appearance & Preferences</p>
                <p className="text-[12px] text-[var(--text-2)] font-semibold mt-0.5">Workspace display settings</p>
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between py-4 border-b border-[var(--border)]">
                  <div>
                    <p className="text-[13px] font-bold text-[var(--text)]">Theme</p>
                    <p className="text-[12px] text-[var(--text-2)] font-semibold mt-0.5">Switch between light and dark mode</p>
                  </div>
                  <select
                    value={theme}
                    onChange={e => setTheme(e.target.value as any)}
                    className="px-3 py-2 border border-[var(--border)] rounded-lg text-[12px] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-[var(--primary)] transition-colors cursor-pointer font-bold"
                  >
                    <option value="light">Light Mode</option>
                    <option value="dark">Dark Mode</option>
                  </select>
                </div>
                <div className="py-4 space-y-2">
                  <p className="text-[13px] font-bold text-[var(--text)] uppercase tracking-wider">System Information</p>
                  {[
                    { label: 'Platform', value: 'SentinelOS SOC v2.0' },
                    { label: 'ML Vision Engine', value: 'YOLOv8 Object Detection (Ultralytics)' },
                    { label: 'Backend Database', value: 'FastAPI + SQLAlchemy + SQLite' },
                    { label: 'Frontend Framework', value: 'React 19 + Vite 8 + TS' },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between items-center text-[12px] py-1.5 border-b border-[var(--border)] last:border-0">
                      <span className="text-[var(--text-2)] font-semibold">{r.label}</span>
                      <span className="font-mono font-bold text-[var(--text)]">{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

        </div>
      </div>

      {/* Camera Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={formMode === 'create' ? 'Add Camera' : 'Edit Camera'}>
        <form onSubmit={handleSaveCamera} className="space-y-4">
          <Input label="Camera Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Main entrance CCTV" required />
          <Input label="RTSP Stream URL" value={form.stream_url} onChange={e => setForm({...form, stream_url: e.target.value})} placeholder="rtsp://192.168.1.105:554/live" required />
          <Input label="Location" value={form.location} onChange={e => setForm({...form, location: e.target.value})} placeholder="North entrance" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Zone" value={form.zone} onChange={e => setForm({...form, zone: e.target.value})} placeholder="Zone A" />
            <Select
              label="Status"
              options={[
                { label: 'Online', value: 'online' },
                { label: 'Offline', value: 'offline' },
              ]}
              value={form.status}
              onChange={e => setForm({...form, status: e.target.value as CameraStatus})}
            />
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
            <button type="button" onClick={testConn} disabled={testingConn} className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg text-[12px] font-bold text-[var(--text-2)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50 cursor-pointer">
              <Wifi size={13} /> {testingConn ? 'Testing...' : 'Test Connection'}
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-3 py-2 border border-[var(--border)] rounded-lg text-[12px] font-bold text-[var(--text-2)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={savingCam} className="px-4 py-2 bg-[var(--primary)] text-white text-[12px] font-bold rounded-lg hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50 cursor-pointer shadow-sm">
                {savingCam ? 'Saving...' : (formMode === 'create' ? 'Add Camera' : 'Save')}
              </button>
            </div>
          </div>
        </form>
      </Modal>

    </motion.div>
  );
};

export default SettingsPage;
