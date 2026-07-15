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
  { id: 'system',  label: 'System',        icon: Database },
];

const SettingsPage = () => {
  const { toast } = useToast();
  const { theme, setTheme } = useAppSettingsStore();
  const [activeSection, setActiveSection] = useState<'ai' | 'cameras' | 'notifs' | 'system'>('ai');

  // AI thresholds
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [iouThreshold, setIouThreshold] = useState(0.45);
  const [frameInterval, setFrameInterval] = useState(3);
  const [saveEvidence, setSaveEvidence] = useState(true);

  const fetchAIConfig = async () => {
    try {
      const res = await getSettings();
      const conf = res.find((s: any) => s.id === 'confidence_threshold')?.value;
      if (conf) setConfidenceThreshold(parseFloat(conf));
      const iou = res.find((s: any) => s.id === 'iou_threshold')?.value;
      if (iou) setIouThreshold(parseFloat(iou));
      const skip = res.find((s: any) => s.id === 'frame_skip')?.value;
      if (skip) setFrameInterval(parseInt(skip));
      const save = res.find((s: any) => s.id === 'save_evidence')?.value;
      if (save) setSaveEvidence(save === 'true');
    } catch { /* defaults */ }
  };

  const saveAIConfig = async () => {
    try {
      await updateSettings({
        confidence_threshold: String(confidenceThreshold),
        iou_threshold: String(iouThreshold),
        frame_skip: String(frameInterval),
        save_evidence: String(saveEvidence),
      });
      toast('AI configuration saved', 'success');
    } catch (e: any) {
      toast(e.message || 'Failed to save', 'error');
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
    if (!form.stream_url) { toast('Enter a stream URL first', 'error'); return; }
    setTestingConn(true);
    try {
      const r = await testCctvConnection(form.stream_url);
      toast(r.message || 'Connection successful', 'success');
    } catch (e: any) {
      toast(e.message || 'Connection failed', 'error');
    } finally { setTestingConn(false); }
  };

  const handleSaveCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.stream_url) { toast('Name and URL are required', 'error'); return; }
    setSavingCam(true);
    try {
      if (formMode === 'create') await createCamera(form);
      else if (editId) await patchCamera(editId, form);
      toast(formMode === 'create' ? 'Camera registered' : 'Camera updated', 'success');
      setModalOpen(false);
      setForm(DEFAULT_FORM);
      void fetchCameras();
    } catch (e: any) {
      toast(e.message || 'Save failed', 'error');
    } finally { setSavingCam(false); }
  };

  const handleDeleteCamera = async (id: string) => {
    if (!confirm('Delete this camera?')) return;
    try { await deleteCamera(id); toast('Camera deleted', 'info'); void fetchCameras(); }
    catch (e: any) { toast(e.message || 'Delete failed', 'error'); }
  };

  // Notifications
  const [notifSound, setNotifSound] = useState(true);
  const [notifEmail, setNotifEmail] = useState(false);
  const [notifSprinkler, setNotifSprinkler] = useState(false);

  useEffect(() => { void fetchAIConfig(); void fetchCameras(); }, []);

  const SliderField = ({ label, desc, value, min, max, step, onChange, format }: any) => (
    <div className="space-y-2 pb-5 border-b border-[#e5e5e2] last:border-0 last:pb-0">
      <div className="flex items-center justify-between">
        <label className="text-[13px] font-semibold text-[#1a1a1a]">{label}</label>
        <span className="text-[12px] font-mono font-bold text-[#0070f3] bg-[#eff6ff] px-2 py-0.5 rounded-md border border-[#bfdbfe]">
          {format ? format(value) : value}
        </span>
      </div>
      {desc && <p className="text-[12px] text-[#6b6b6b]">{desc}</p>}
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[#0070f3] bg-[#e5e5e2]"
      />
      <div className="flex justify-between text-[10px] text-[#a0a0a0] font-medium">
        <span>{min}</span><span>{max}</span>
      </div>
    </div>
  );

  const ToggleRow = ({ label, desc, value, onChange }: any) => (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-[#e5e5e2] last:border-0">
      <div>
        <p className="text-[13px] font-semibold text-[#1a1a1a]">{label}</p>
        {desc && <p className="text-[12px] text-[#6b6b6b] mt-0.5">{desc}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative shrink-0 w-10 h-6 rounded-full transition-colors duration-200 ${value ? 'bg-[#0070f3]' : 'bg-[#e5e5e2]'}`}
      >
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-200 ${value ? 'left-5' : 'left-1'}`} />
      </button>
    </div>
  );

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-[#1a1a1a] tracking-tight">Settings</h1>
          <p className="text-[13px] text-[#6b6b6b] mt-0.5">AI model parameters, camera management, and system preferences</p>
        </div>
        {activeSection === 'cameras' && (
          <button
            onClick={() => { setFormMode('create'); setForm(DEFAULT_FORM); setModalOpen(true); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0070f3] text-white text-[12px] font-semibold rounded-lg hover:bg-[#0060d6] transition-colors shadow-sm"
          >
            <Plus size={14} /> Add Camera
          </button>
        )}
      </div>

      {/* Layout */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

        {/* Sidebar nav */}
        <div className="md:col-span-1">
          <div className="bg-white border border-[#e5e5e2] rounded-xl p-2 space-y-0.5">
            {SECTIONS.map(sec => {
              const Icon = sec.icon;
              const active = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  onClick={() => setActiveSection(sec.id as any)}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all ${
                    active ? 'bg-[#eff6ff] text-[#0070f3] font-semibold' : 'text-[#6b6b6b] hover:bg-[#f0f0ed] hover:text-[#1a1a1a]'
                  }`}
                >
                  <Icon size={15} className={active ? 'text-[#0070f3]' : 'text-[#a0a0a0]'} />
                  {sec.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content panel */}
        <div className="md:col-span-3 bg-white border border-[#e5e5e2] rounded-xl overflow-hidden">

          {/* AI Settings */}
          {activeSection === 'ai' && (
            <>
              <div className="px-5 py-4 border-b border-[#e5e5e2]">
                <p className="text-[13px] font-semibold text-[#1a1a1a]">YOLOv8 Model Configuration</p>
                <p className="text-[12px] text-[#6b6b6b] mt-0.5">Adjust inference thresholds and detection behavior</p>
              </div>
              <div className="p-5 space-y-5">
                <SliderField
                  label="Confidence Threshold"
                  desc="Detections below this score are discarded. Lower values increase sensitivity."
                  value={confidenceThreshold}
                  min={0.1} max={0.9} step={0.05}
                  onChange={setConfidenceThreshold}
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
                <div className="flex items-start justify-between gap-4 pb-5 border-b border-[#e5e5e2]">
                  <div>
                    <p className="text-[13px] font-semibold text-[#1a1a1a]">Save Evidence Snapshots</p>
                    <p className="text-[12px] text-[#6b6b6b] mt-0.5">Store annotated bounding box frames to local storage</p>
                  </div>
                  <button
                    onClick={() => setSaveEvidence(!saveEvidence)}
                    className={`relative shrink-0 w-10 h-6 rounded-full transition-colors duration-200 ${saveEvidence ? 'bg-[#0070f3]' : 'bg-[#e5e5e2]'}`}
                  >
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-200 ${saveEvidence ? 'left-5' : 'left-1'}`} />
                  </button>
                </div>
                <div className="flex gap-2 justify-end pt-1">
                  <button onClick={fetchAIConfig} className="px-3 py-2 border border-[#e5e5e2] rounded-lg text-[12px] font-medium text-[#6b6b6b] hover:bg-[#f0f0ed] transition-colors">
                    Reset
                  </button>
                  <button onClick={saveAIConfig} className="px-4 py-2 bg-[#0070f3] text-white text-[12px] font-semibold rounded-lg hover:bg-[#0060d6] transition-colors">
                    Save Changes
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Cameras */}
          {activeSection === 'cameras' && (
            <>
              <div className="px-5 py-4 border-b border-[#e5e5e2]">
                <p className="text-[13px] font-semibold text-[#1a1a1a]">CCTV Cameras</p>
                <p className="text-[12px] text-[#6b6b6b] mt-0.5">{cameras.length} camera{cameras.length !== 1 ? 's' : ''} registered</p>
              </div>
              <div className="p-5">
                {cameras.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14 gap-3 border-2 border-dashed border-[#e5e5e2] rounded-xl">
                    <div className="w-10 h-10 rounded-xl bg-[#f0f0ed] flex items-center justify-center">
                      <CameraIcon size={18} className="text-[#a0a0a0]" />
                    </div>
                    <p className="text-[13px] text-[#6b6b6b] font-medium">No cameras registered</p>
                    <button
                      onClick={() => { setFormMode('create'); setForm(DEFAULT_FORM); setModalOpen(true); }}
                      className="px-4 py-2 bg-[#0070f3] text-white text-[12px] font-semibold rounded-lg hover:bg-[#0060d6] transition-colors"
                    >
                      Add First Camera
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {cameras.map(c => (
                      <div key={c.id} className="border border-[#e5e5e2] rounded-xl p-4 hover:border-[#d4d4d0] transition-colors">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1 min-w-0 mr-2">
                            <p className="text-[13px] font-semibold text-[#1a1a1a] truncate">{c.name}</p>
                            <p className="text-[11px] text-[#6b6b6b] mt-0.5">Zone: {c.zone || 'Unassigned'}</p>
                          </div>
                          <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            c.status === 'active' || c.status === 'online'
                              ? 'bg-[#f0fdf4] text-[#30a46c] border-[#bbf7d0]'
                              : 'bg-[#fff1f1] text-[#e5484d] border-[#fecdce]'
                          }`}>
                            {c.status}
                          </span>
                        </div>
                        <code className="block text-[10px] text-[#a0a0a0] font-mono truncate bg-[#f9f9f8] border border-[#e5e5e2] px-2 py-1.5 rounded-lg mb-3">
                          {c.stream_url}
                        </code>
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => { setFormMode('edit'); setEditId(c.id); setForm({ name: c.name || '', stream_url: c.stream_url || '', location: c.location || '', zone: c.zone || '', status: c.status || 'online' }); setModalOpen(true); }}
                            className="p-1.5 rounded-lg border border-[#e5e5e2] text-[#6b6b6b] hover:text-[#1a1a1a] hover:bg-[#f0f0ed] transition-colors"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => void handleDeleteCamera(c.id)}
                            className="p-1.5 rounded-lg border border-[#e5e5e2] text-[#6b6b6b] hover:text-[#e5484d] hover:bg-[#fff1f1] hover:border-[#fecdce] transition-colors"
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
              <div className="px-5 py-4 border-b border-[#e5e5e2]">
                <p className="text-[13px] font-semibold text-[#1a1a1a]">Alert Preferences</p>
                <p className="text-[12px] text-[#6b6b6b] mt-0.5">Configure how you receive threat alerts</p>
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
              <div className="px-5 py-4 border-b border-[#e5e5e2]">
                <p className="text-[13px] font-semibold text-[#1a1a1a]">Appearance & Preferences</p>
                <p className="text-[12px] text-[#6b6b6b] mt-0.5">Workspace display settings</p>
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between py-4 border-b border-[#e5e5e2]">
                  <div>
                    <p className="text-[13px] font-semibold text-[#1a1a1a]">Theme</p>
                    <p className="text-[12px] text-[#6b6b6b] mt-0.5">Switch between light and dark mode</p>
                  </div>
                  <select
                    value={theme}
                    onChange={e => setTheme(e.target.value as any)}
                    className="px-3 py-2 border border-[#e5e5e2] rounded-lg text-[12px] bg-white text-[#1a1a1a] outline-none focus:border-[#0070f3] transition-colors"
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark (Beta)</option>
                  </select>
                </div>
                <div className="py-4 space-y-2">
                  <p className="text-[13px] font-semibold text-[#1a1a1a]">System Info</p>
                  {[
                    { label: 'Platform', value: 'FireGuard AI v2.0' },
                    { label: 'ML Engine', value: 'YOLOv8 (Ultralytics)' },
                    { label: 'Backend', value: 'FastAPI + SQLite' },
                    { label: 'Frontend', value: 'React 19 + Vite 8' },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between items-center text-[12px] py-1.5">
                      <span className="text-[#6b6b6b]">{r.label}</span>
                      <span className="font-mono font-semibold text-[#1a1a1a]">{r.value}</span>
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
          <div className="flex items-center justify-between pt-3 border-t border-[#e5e5e2]">
            <button type="button" onClick={testConn} disabled={testingConn} className="flex items-center gap-1.5 px-3 py-2 border border-[#e5e5e2] rounded-lg text-[12px] font-medium text-[#6b6b6b] hover:bg-[#f0f0ed] transition-colors disabled:opacity-50">
              <Wifi size={13} /> {testingConn ? 'Testing...' : 'Test Connection'}
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-3 py-2 border border-[#e5e5e2] rounded-lg text-[12px] font-medium text-[#6b6b6b] hover:bg-[#f0f0ed] transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={savingCam} className="px-4 py-2 bg-[#0070f3] text-white text-[12px] font-semibold rounded-lg hover:bg-[#0060d6] transition-colors disabled:opacity-50">
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
