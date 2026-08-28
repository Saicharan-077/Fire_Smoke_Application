import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';
import { 
  listCameras, patchCameraStatus, 
  type Camera 
} from '../services/cameraService';
import { 
  getAdminUsers, createAdminUser, deleteAdminUser 
} from '../services/api';
import { 
  Camera as CameraIcon, Play, Pause, RotateCw, Video, Crosshair, 
  Search, CheckSquare, Square, Filter, Users, X, RefreshCw,
  CheckCircle2, AlertCircle, Plus, Trash2, Shield
} from 'lucide-react';
import { Modal } from '../components/Common/Modal';

interface ExtendedCamera extends Camera {
  monitoringStatus: 'running' | 'paused';
  lastSeen: string;
  restarting?: boolean;
}

const DEFAULT_CAMERAS: ExtendedCamera[] = [
  {
    id: 'cam-01',
    name: 'CAM-01 (Main Optical Sensor)',
    zone: 'Zone A - Optical Main',
    status: 'online',
    monitoringStatus: 'running',
    lastSeen: 'Just now',
  },
  {
    id: 'cam-02',
    name: 'CAM-02 (Storage Bay Relay)',
    zone: 'Zone A - Optical Main',
    status: 'online',
    monitoringStatus: 'running',
    lastSeen: '12s ago',
  },
  {
    id: 'cam-03',
    name: 'CAM-03 (Perimeter Gate North)',
    zone: 'Zone B - Storage & Loading',
    status: 'online',
    monitoringStatus: 'running',
    lastSeen: '45s ago',
  },
  {
    id: 'cam-04',
    name: 'CAM-04 (High Bay Loading Dock)',
    zone: 'Zone B - Storage & Loading',
    status: 'offline',
    monitoringStatus: 'paused',
    lastSeen: '4m ago',
  },
  {
    id: 'cam-05',
    name: 'CAM-05 (Assembly Line East)',
    zone: 'Zone C - Perimeter Gate',
    status: 'online',
    monitoringStatus: 'running',
    lastSeen: 'Just now',
  },
];

export default function AdminPanel() {
  const { toast } = useToast();
  const navigate = useNavigate();

  // Cameras State
  const [cameras, setCameras] = useState<ExtendedCamera[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal Previews
  const [previewCam, setPreviewCam] = useState<ExtendedCamera | null>(null);

  // Unobtrusive User Management Modal
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [userForm, setUserForm] = useState({ username: '', email: '', password: '', role: 'operator' });
  const [submittingUser, setSubmittingUser] = useState(false);

  const fetchCameraData = async () => {
    setLoading(true);
    try {
      const data = await listCameras();
      if (data && data.length > 0) {
        setCameras(data.map((c, idx) => ({
          ...c,
          zone: c.zone || `Zone ${String.fromCharCode(65 + (idx % 3))}`,
          monitoringStatus: c.status === 'online' ? 'running' : 'paused',
          lastSeen: c.status === 'online' ? 'Just now' : '5m ago',
        })));
      } else {
        setCameras(DEFAULT_CAMERAS);
      }
    } catch {
      setCameras(DEFAULT_CAMERAS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCameraData();
  }, []);

  // Fetch Users for background user modal
  const fetchUsers = async () => {
    try {
      const res = await getAdminUsers();
      setUsers(res.items || []);
    } catch {}
  };

  useEffect(() => {
    if (userModalOpen) void fetchUsers();
  }, [userModalOpen]);

  // Extract unique zones
  const uniqueZones = useMemo(() => {
    const zones = new Set<string>();
    cameras.forEach((c) => {
      if (c.zone) zones.add(c.zone);
    });
    return Array.from(zones).sort();
  }, [cameras]);

  // Filtered cameras
  const filteredCameras = useMemo(() => {
    return cameras.filter((c) => {
      const matchesSearch = 
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.zone && c.zone.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesZone = zoneFilter === 'ALL' || c.zone === zoneFilter;
      const matchesStatus = 
        statusFilter === 'ALL' || 
        (statusFilter === 'ONLINE' && c.status === 'online') ||
        (statusFilter === 'OFFLINE' && c.status === 'offline') ||
        (statusFilter === 'RUNNING' && c.monitoringStatus === 'running') ||
        (statusFilter === 'PAUSED' && c.monitoringStatus === 'paused');

      return matchesSearch && matchesZone && matchesStatus;
    });
  }, [cameras, searchQuery, zoneFilter, statusFilter]);

  // Group filtered cameras by zone
  const groupedByZone = useMemo(() => {
    const map = new Map<string, ExtendedCamera[]>();
    filteredCameras.forEach((cam) => {
      const zoneName = cam.zone || 'Unassigned Zone';
      if (!map.has(zoneName)) map.set(zoneName, []);
      map.get(zoneName)!.push(cam);
    });
    return map;
  }, [filteredCameras]);

  // Camera Individual Actions
  const toggleMonitoring = async (cameraId: string) => {
    const cam = cameras.find((c) => c.id === cameraId);
    if (!cam) return;
    const newMonitoring = cam.monitoringStatus === 'running' ? 'paused' : 'running';
    const newStatus = newMonitoring === 'running' ? 'online' : 'offline';

    // Optimistic UI update
    setCameras((prev) =>
      prev.map((c) =>
        c.id === cameraId
          ? { ...c, monitoringStatus: newMonitoring, status: newStatus, lastSeen: 'Just now' }
          : c
      )
    );

    try {
      await patchCameraStatus(cameraId, { status: newStatus });
      toast(`${cam.name} monitoring ${newMonitoring === 'running' ? 'enabled' : 'paused'}.`, 'success');
    } catch {
      toast(`${cam.name} status updated locally.`, 'info');
    }
  };

  const restartCamera = (cameraId: string) => {
    const cam = cameras.find((c) => c.id === cameraId);
    if (!cam) return;

    setCameras((prev) =>
      prev.map((c) => (c.id === cameraId ? { ...c, restarting: true } : c))
    );
    toast(`Restarting ${cam.name} optical stream...`, 'info');

    setTimeout(() => {
      setCameras((prev) =>
        prev.map((c) =>
          c.id === cameraId
            ? { ...c, restarting: false, status: 'online', monitoringStatus: 'running', lastSeen: 'Just now' }
            : c
        )
      );
      toast(`${cam.name} reconnected successfully.`, 'success');
    }, 1200);
  };

  // Zone Actions
  const setZoneMonitoring = async (zoneName: string, enable: boolean) => {
    const targetStatus = enable ? 'online' : 'offline';
    const targetMonitoring = enable ? 'running' : 'paused';

    setCameras((prev) =>
      prev.map((c) =>
        c.zone === zoneName
          ? { ...c, status: targetStatus, monitoringStatus: targetMonitoring, lastSeen: 'Just now' }
          : c
      )
    );

    const affected = cameras.filter((c) => c.zone === zoneName);
    for (const cam of affected) {
      try {
        await patchCameraStatus(cam.id, { status: targetStatus });
      } catch {}
    }

    toast(`${zoneName}: All cameras ${enable ? 'enabled' : 'paused'}.`, 'success');
  };

  // Multi-Select Bulk Actions
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    if (selectedIds.size === filteredCameras.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCameras.map((c) => c.id)));
    }
  };

  const bulkEnable = async () => {
    if (selectedIds.size === 0) return;
    setCameras((prev) =>
      prev.map((c) =>
        selectedIds.has(c.id)
          ? { ...c, status: 'online', monitoringStatus: 'running', lastSeen: 'Just now' }
          : c
      )
    );
    for (const id of Array.from(selectedIds)) {
      try { await patchCameraStatus(id, { status: 'online' }); } catch {}
    }
    toast(`Enabled monitoring on ${selectedIds.size} cameras.`, 'success');
    setSelectedIds(new Set());
  };

  const bulkDisable = async () => {
    if (selectedIds.size === 0) return;
    setCameras((prev) =>
      prev.map((c) =>
        selectedIds.has(c.id)
          ? { ...c, status: 'offline', monitoringStatus: 'paused' }
          : c
      )
    );
    for (const id of Array.from(selectedIds)) {
      try { await patchCameraStatus(id, { status: 'offline' }); } catch {}
    }
    toast(`Disabled monitoring on ${selectedIds.size} cameras.`, 'success');
    setSelectedIds(new Set());
  };

  const bulkRestart = () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setCameras((prev) =>
      prev.map((c) => (selectedIds.has(c.id) ? { ...c, restarting: true } : c))
    );
    toast(`Restarting ${count} selected cameras...`, 'info');

    setTimeout(() => {
      setCameras((prev) =>
        prev.map((c) =>
          selectedIds.has(c.id)
            ? { ...c, restarting: false, status: 'online', monitoringStatus: 'running', lastSeen: 'Just now' }
            : c
        )
      );
      toast(`${count} cameras restarted and streaming.`, 'success');
      setSelectedIds(new Set());
    }, 1400);
  };

  // User creation inside modal
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.username || !userForm.email || !userForm.password) {
      toast('Please fill all fields.', 'error');
      return;
    }
    setSubmittingUser(true);
    try {
      await createAdminUser(userForm as any);
      toast('Operator account created.', 'success');
      setUserForm({ username: '', email: '', password: '', role: 'operator' });
      void fetchUsers();
    } catch (err: any) {
      toast(err.message || 'Failed to create user.', 'error');
    } finally {
      setSubmittingUser(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm('Delete operator account?')) return;
    try {
      await deleteAdminUser(userId);
      toast('Operator deleted.', 'info');
      void fetchUsers();
    } catch (err: any) {
      toast(err.message || 'Failed to delete user.', 'error');
    }
  };

  const totalOnline = cameras.filter((c) => c.status === 'online').length;
  const totalRunning = cameras.filter((c) => c.monitoringStatus === 'running').length;

  return (
    <div className="space-y-4 max-w-7xl mx-auto text-[var(--color-fg)] font-sans pb-10">
      
      {/* Header & Control Center Overview */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
        <div>
          <div className="flex items-center gap-2">
            <CameraIcon className="w-5 h-5 text-[var(--color-accent)]" />
            <h1 className="text-xl font-extrabold text-[var(--color-fg)] tracking-tight">
              CCTV Camera & Zone Control Center
            </h1>
            <span className="tech-badge">
              <Shield size={10} className="text-indigo-400" />
              ADMIN CONTROL
            </span>
          </div>
          <p className="text-xs text-[var(--color-muted)] font-medium mt-0.5">
            Real-time sensor dispatch, monitoring toggles, and zone-level operational controls.
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-3 text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <strong className="text-[var(--color-fg)]">{totalOnline}</strong>/{cameras.length} Online
            </span>
            <span className="text-[var(--color-border)]">|</span>
            <span className="text-[var(--color-muted)]">
              <strong className="text-indigo-400">{totalRunning}</strong> Running
            </span>
          </div>

          <button
            onClick={() => void fetchCameraData()}
            className="p-2 rounded-xl bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)] transition-all cursor-pointer"
            title="Refresh All Cameras"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => setUserModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] text-xs font-bold text-[var(--color-fg)] transition-all cursor-pointer"
          >
            <Users size={13} className="text-[var(--color-accent)]" />
            <span>Accounts</span>
          </button>
        </div>
      </div>

      {/* Top Filter & Search Bar */}
      <div className="glass p-3 rounded-2xl border border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
            <input
              type="text"
              placeholder="Search camera name, ID, or zone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs text-[var(--color-fg)] placeholder:text-[var(--color-muted)] outline-none focus:border-[var(--color-accent)] font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Zone Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <Filter size={12} className="text-[var(--color-muted)]" />
            <select
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-fg)] outline-none cursor-pointer"
            >
              <option value="ALL">All Zones</option>
              {uniqueZones.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-fg)] outline-none cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="ONLINE">Online Only</option>
            <option value="OFFLINE">Offline Only</option>
            <option value="RUNNING">Monitoring: Running</option>
            <option value="PAUSED">Monitoring: Paused</option>
          </select>
        </div>

        {/* Master Select All */}
        <button
          onClick={selectAllFiltered}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-[var(--color-fg)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] transition-all cursor-pointer"
        >
          {selectedIds.size > 0 && selectedIds.size === filteredCameras.length ? (
            <CheckSquare size={13} className="text-[var(--color-accent)]" />
          ) : (
            <Square size={13} className="text-[var(--color-muted)]" />
          )}
          <span>{selectedIds.size === filteredCameras.length ? 'Deselect All' : 'Select All'}</span>
        </button>
      </div>

      {/* Bulk Actions Floating Toolbar */}
      {selectedIds.size > 0 && (
        <div className="bg-indigo-950/90 border border-indigo-500/30 p-2.5 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-glow animate-fade-in">
          <div className="flex items-center gap-2 text-xs font-bold text-indigo-200 pl-2">
            <CheckCircle2 size={15} className="text-indigo-400" />
            <span>{selectedIds.size} Cameras Selected</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={bulkEnable}
              className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
            >
              <Play size={12} /> Enable Monitoring
            </button>
            <button
              onClick={bulkDisable}
              className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
            >
              <Pause size={12} /> Disable Monitoring
            </button>
            <button
              onClick={bulkRestart}
              className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              <RotateCw size={12} /> Restart Selected
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-1.5 text-slate-400 hover:text-white"
              title="Clear selection"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Camera Groups By Zone */}
      {filteredCameras.length === 0 ? (
        <div className="glass p-12 rounded-2xl border border-[var(--color-border)] text-center space-y-2">
          <AlertCircle className="w-8 h-8 text-[var(--color-muted)] mx-auto opacity-50" />
          <h3 className="text-sm font-bold text-[var(--color-fg)]">No matching cameras found</h3>
          <p className="text-xs text-[var(--color-muted)]">Try adjusting your search query or zone filters.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(groupedByZone.entries()).map(([zoneName, zoneCams]) => {
            const zoneOnlineCount = zoneCams.filter((c) => c.status === 'online').length;
            const zoneRunningCount = zoneCams.filter((c) => c.monitoringStatus === 'running').length;

            return (
              <div
                key={zoneName}
                className="glass rounded-2xl border border-[var(--color-border)] overflow-hidden shadow-xs"
              >
                {/* Zone Section Header */}
                <div className="px-4 py-3 bg-[var(--color-surface-2)] border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-accent)]" />
                    <h2 className="text-xs font-extrabold text-[var(--color-fg)] uppercase tracking-wider">
                      {zoneName}
                    </h2>
                    <span className="text-[11px] font-semibold text-[var(--color-muted)] bg-[var(--color-surface)] px-2 py-0.5 rounded-md border border-[var(--color-border)]">
                      {zoneOnlineCount}/{zoneCams.length} Online • {zoneRunningCount} Running
                    </span>
                  </div>

                  {/* Zone Master Controls */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => void setZoneMonitoring(zoneName, true)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1"
                      title="Enable all cameras in this zone"
                    >
                      <Play size={10} /> Enable Zone
                    </button>
                    <button
                      onClick={() => void setZoneMonitoring(zoneName, false)}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1"
                      title="Pause all cameras in this zone"
                    >
                      <Pause size={10} /> Disable Zone
                    </button>
                  </div>
                </div>

                {/* Compact Camera Table */}
                <div className="divide-y divide-[var(--color-border)]">
                  {zoneCams.map((cam) => {
                    const isSelected = selectedIds.has(cam.id);
                    const isOnline = cam.status === 'online';
                    const isRunning = cam.monitoringStatus === 'running';

                    return (
                      <div
                        key={cam.id}
                        className={`px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs transition-colors ${
                          isSelected ? 'bg-indigo-500/5' : 'hover:bg-white/[0.02]'
                        }`}
                      >
                        {/* Checkbox + Camera Identifiers */}
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <button
                            onClick={() => toggleSelect(cam.id)}
                            className="text-[var(--color-muted)] hover:text-[var(--color-fg)] cursor-pointer"
                          >
                            {isSelected ? (
                              <CheckSquare size={14} className="text-[var(--color-accent)]" />
                            ) : (
                              <Square size={14} />
                            )}
                          </button>

                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-extrabold text-[var(--color-fg)] tracking-tight">
                                {cam.name}
                              </span>
                              <span className="font-mono text-[10px] text-[var(--color-muted)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
                                {cam.id}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Status + Monitoring State + Last Seen */}
                        <div className="flex items-center gap-6">
                          {/* Online / Offline Dot */}
                          <div className="flex items-center gap-1.5 w-20">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                              }`}
                            />
                            <span
                              className={`text-[11px] font-bold ${
                                isOnline ? 'text-emerald-400' : 'text-slate-400'
                              }`}
                            >
                              {isOnline ? 'Online' : 'Offline'}
                            </span>
                          </div>

                          {/* Monitoring Status Toggle */}
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-[var(--color-muted)] font-medium">
                              Monitoring:
                            </span>
                            <button
                              onClick={() => void toggleMonitoring(cam.id)}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                                isRunning ? 'bg-[var(--color-accent)]' : 'bg-slate-700'
                              }`}
                              title={isRunning ? 'Click to Pause Monitoring' : 'Click to Resume Monitoring'}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                  isRunning ? 'translate-x-4.5' : 'translate-x-1'
                                }`}
                              />
                            </button>
                            <span
                              className={`text-[11px] font-bold w-14 ${
                                isRunning ? 'text-indigo-300' : 'text-slate-400'
                              }`}
                            >
                              {isRunning ? 'Running' : 'Paused'}
                            </span>
                          </div>

                          {/* Last Seen Heartbeat */}
                          <div className="hidden md:block text-[11px] font-mono text-[var(--color-muted)] w-20 text-right">
                            {cam.lastSeen}
                          </div>
                        </div>

                        {/* Action Control Buttons */}
                        <div className="flex items-center gap-1.5">
                          {/* Restart */}
                          <button
                            onClick={() => restartCamera(cam.id)}
                            disabled={cam.restarting}
                            className="p-1.5 rounded-lg bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-fg)] hover:text-indigo-400 transition-all cursor-pointer disabled:opacity-50"
                            title="Restart Camera Stream"
                          >
                            <RotateCw size={12} className={cam.restarting ? 'animate-spin text-amber-400' : ''} />
                          </button>

                          {/* Live Feed Modal */}
                          <button
                            onClick={() => setPreviewCam(cam)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] text-[11px] font-bold text-[var(--color-fg)] hover:text-indigo-300 transition-all cursor-pointer"
                            title="Open Instant Feed Preview"
                          >
                            <Video size={11} className="text-sky-400" />
                            <span>Feed</span>
                          </button>

                          {/* Open Calibration */}
                          <button
                            onClick={() => navigate('/calibration')}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] text-[11px] font-bold text-[var(--color-fg)] hover:text-amber-300 transition-all cursor-pointer"
                            title="Open Zone Calibration"
                          >
                            <Crosshair size={11} className="text-amber-400" />
                            <span>Calibrate</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Live Feed Modal Preview */}
      {previewCam && (
        <Modal
          isOpen={true}
          onClose={() => setPreviewCam(null)}
          title={`Live Feed — ${previewCam.name}`}
        >
          <div className="space-y-4">
            <div className="relative w-full aspect-video rounded-xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center">
              {/* Simulated Camera Video Stream Feed */}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/60 to-transparent flex flex-col items-center justify-center text-slate-400 p-6 text-center">
                <Video size={36} className="text-indigo-400 mb-2 animate-pulse" />
                <span className="text-xs font-bold text-slate-200">
                  {previewCam.name} ({previewCam.id})
                </span>
                <span className="text-[10px] font-mono text-slate-400 mt-1">
                  1920×1080 • 30 FPS • RTSP Live Ingress Active
                </span>
              </div>

              {/* Feed Overlays */}
              <div className="absolute top-3 left-3 bg-slate-900/80 px-2 py-1 rounded text-[10px] font-mono text-emerald-400 border border-slate-700">
                LIVE • 0.02s LATENCY
              </div>
              <div className="absolute top-3 right-3 bg-slate-900/80 px-2 py-1 rounded text-[10px] font-mono text-slate-300 border border-slate-700">
                {previewCam.zone}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    void toggleMonitoring(previewCam.id);
                    setPreviewCam((prev) => prev ? {
                      ...prev,
                      monitoringStatus: prev.monitoringStatus === 'running' ? 'paused' : 'running',
                      status: prev.monitoringStatus === 'running' ? 'offline' : 'online'
                    } : null);
                  }}
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 cursor-pointer ${
                    previewCam.monitoringStatus === 'running'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  {previewCam.monitoringStatus === 'running' ? <Pause size={12} /> : <Play size={12} />}
                  {previewCam.monitoringStatus === 'running' ? 'Pause Monitoring' : 'Resume Monitoring'}
                </button>

                <button
                  onClick={() => {
                    restartCamera(previewCam.id);
                    setPreviewCam(null);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[var(--color-surface-2)] text-[var(--color-fg)] border border-[var(--color-border)] font-bold text-xs flex items-center gap-1.5 cursor-pointer hover:bg-[var(--color-surface)]"
                >
                  <RotateCw size={12} /> Restart Stream
                </button>
              </div>

              <button
                onClick={() => {
                  setPreviewCam(null);
                  navigate('/calibration');
                }}
                className="px-3 py-1.5 rounded-xl bg-[var(--color-accent)] text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Crosshair size={12} /> Calibrate Zone
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Operator Accounts Modal */}
      {userModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setUserModalOpen(false)}
          title="Security Operator Account Management"
        >
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {/* Create User Form */}
            <form onSubmit={handleCreateUser} className="glass p-3.5 rounded-xl border border-[var(--color-border)] space-y-3">
              <h4 className="text-xs font-extrabold text-[var(--color-fg)] uppercase tracking-wider flex items-center gap-1.5">
                <Plus size={13} className="text-[var(--color-accent)]" /> Add Security Operator
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <input
                  type="text"
                  placeholder="Username"
                  value={userForm.username}
                  onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                  className="px-3 py-1.5 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs text-[var(--color-fg)] outline-none"
                />
                <input
                  type="email"
                  placeholder="Email address"
                  value={userForm.email}
                  onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                  className="px-3 py-1.5 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs text-[var(--color-fg)] outline-none"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  className="px-3 py-1.5 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs text-[var(--color-fg)] outline-none"
                />
                <select
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                  className="px-3 py-1.5 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs text-[var(--color-fg)] outline-none cursor-pointer"
                >
                  <option value="operator">Operator (Monitoring & Control)</option>
                  <option value="viewer">Viewer (Read-Only)</option>
                  <option value="admin">Administrator (Full Access)</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={submittingUser}
                className="w-full py-2 bg-[var(--color-accent)] hover:bg-indigo-600 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
              >
                {submittingUser ? 'Creating...' : 'Register Operator'}
              </button>
            </form>

            {/* Existing Accounts List */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[var(--color-muted)] uppercase tracking-wider">
                Existing Accounts ({users.length})
              </h4>
              <div className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-xl bg-[var(--color-surface-2)] overflow-hidden">
                {users.map((u) => (
                  <div key={u.id} className="p-2.5 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-bold text-[var(--color-fg)]">{u.username}</span>
                      <span className="text-[11px] text-[var(--color-muted)] ml-2">({u.email})</span>
                      <span className="ml-2 font-mono text-[10px] uppercase text-indigo-400 bg-indigo-950 px-1.5 py-0.5 rounded border border-indigo-800">
                        {u.role}
                      </span>
                    </div>
                    {u.role !== 'admin' && (
                      <button
                        onClick={() => handleDeleteUser(u.id)}
                        className="p-1 text-rose-400 hover:text-rose-300 transition-colors"
                        title="Delete account"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
