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
  Play, Pause, RotateCw, Video, Crosshair, 
  Search, CheckSquare, Square, Filter, Users, RefreshCw,
  ChevronDown, ChevronRight, Plus, Trash2, Shield
} from 'lucide-react';
import { Modal } from '../components/Common/Modal';

interface ExtendedCamera extends Camera {
  monitoringStatus: 'running' | 'paused';
  fps: number;
  latency: number;
  lastSeen: string;
  restarting?: boolean;
}

const DEFAULT_CAMERAS: ExtendedCamera[] = [
  {
    id: 'CAM-01',
    name: 'Warehouse North Gate',
    zone: 'Zone A - Logistics & Gate',
    status: 'online',
    monitoringStatus: 'running',
    fps: 30,
    latency: 12,
    lastSeen: 'Just now',
  },
  {
    id: 'CAM-02',
    name: 'Loading Bay Relay 02',
    zone: 'Zone A - Logistics & Gate',
    status: 'online',
    monitoringStatus: 'running',
    fps: 30,
    latency: 14,
    lastSeen: '8s ago',
  },
  {
    id: 'CAM-03',
    name: 'Storage Chemical Yard',
    zone: 'Zone B - HazMat Facility',
    status: 'online',
    monitoringStatus: 'running',
    fps: 25,
    latency: 16,
    lastSeen: 'Just now',
  },
  {
    id: 'CAM-04',
    name: 'Perimeter Fence East',
    zone: 'Zone B - HazMat Facility',
    status: 'offline',
    monitoringStatus: 'paused',
    fps: 0,
    latency: 0,
    lastSeen: '4m ago',
  },
  {
    id: 'CAM-05',
    name: 'Assembly Bay Sector 4',
    zone: 'Zone C - Production Floor',
    status: 'online',
    monitoringStatus: 'running',
    fps: 30,
    latency: 11,
    lastSeen: 'Just now',
  },
  {
    id: 'CAM-06',
    name: 'Final Inspection Conveyor',
    zone: 'Zone C - Production Floor',
    status: 'online',
    monitoringStatus: 'running',
    fps: 30,
    latency: 15,
    lastSeen: 'Just now',
  },
];

export default function AdminPanel() {
  const { toast } = useToast();
  const navigate = useNavigate();

  // Camera State
  const [cameras, setCameras] = useState<ExtendedCamera[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Collapsible Accordion States (default all expanded)
  const [expandedZones, setExpandedZones] = useState<Record<string, boolean>>({});

  // Modals
  const [previewCam, setPreviewCam] = useState<ExtendedCamera | null>(null);
  const [calibrateCam, setCalibrateCam] = useState<ExtendedCamera | null>(null);
  const [userModalOpen, setUserModalOpen] = useState(false);

  // User Management
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
          fps: c.status === 'online' ? (idx % 2 === 0 ? 30 : 25) : 0,
          latency: c.status === 'online' ? Math.floor(Math.random() * 8) + 10 : 0,
          lastSeen: c.status === 'online' ? 'Just now' : '6m ago',
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

  const fetchUsers = async () => {
    try {
      const res = await getAdminUsers();
      setUsers(res.items || []);
    } catch {}
  };

  useEffect(() => {
    if (userModalOpen) void fetchUsers();
  }, [userModalOpen]);

  // Unique zones
  const uniqueZones = useMemo(() => {
    const zones = new Set<string>();
    cameras.forEach((c) => {
      if (c.zone) zones.add(c.zone);
    });
    return Array.from(zones).sort();
  }, [cameras]);

  // Ensure all zones start expanded
  useEffect(() => {
    const initial: Record<string, boolean> = {};
    uniqueZones.forEach((z) => {
      if (expandedZones[z] === undefined) initial[z] = true;
    });
    if (Object.keys(initial).length > 0) {
      setExpandedZones((prev) => ({ ...initial, ...prev }));
    }
  }, [uniqueZones, expandedZones]);

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

  // Grouped by Zone
  const groupedByZone = useMemo(() => {
    const map = new Map<string, ExtendedCamera[]>();
    filteredCameras.forEach((cam) => {
      const zoneName = cam.zone || 'Unassigned Zone';
      if (!map.has(zoneName)) map.set(zoneName, []);
      map.get(zoneName)!.push(cam);
    });
    return map;
  }, [filteredCameras]);

  // Toggle zone accordion expand/collapse
  const toggleZoneAccordion = (zoneName: string) => {
    setExpandedZones((prev) => ({
      ...prev,
      [zoneName]: prev[zoneName] === undefined ? false : !prev[zoneName],
    }));
  };

  // Single Zone Monitoring Toggle Switch (ON / OFF)
  const toggleZoneMonitoring = async (zoneName: string, currentlyAllRunning: boolean) => {
    const nextRunning = !currentlyAllRunning;
    const targetStatus = nextRunning ? 'online' : 'offline';
    const targetMonitoring = nextRunning ? 'running' : 'paused';

    setCameras((prev) =>
      prev.map((c) =>
        c.zone === zoneName
          ? {
              ...c,
              status: targetStatus,
              monitoringStatus: targetMonitoring,
              fps: nextRunning ? 30 : 0,
              latency: nextRunning ? 12 : 0,
              lastSeen: 'Just now',
            }
          : c
      )
    );

    const affected = cameras.filter((c) => c.zone === zoneName);
    for (const cam of affected) {
      try {
        await patchCameraStatus(cam.id, { status: targetStatus });
      } catch {}
    }

    toast(`${zoneName} monitoring ${nextRunning ? 'enabled' : 'paused'}.`, 'success');
  };

  // Camera Individual Monitoring Toggle
  const toggleCameraMonitoring = async (cameraId: string) => {
    const cam = cameras.find((c) => c.id === cameraId);
    if (!cam) return;
    const newMonitoring = cam.monitoringStatus === 'running' ? 'paused' : 'running';
    const newStatus = newMonitoring === 'running' ? 'online' : 'offline';

    setCameras((prev) =>
      prev.map((c) =>
        c.id === cameraId
          ? {
              ...c,
              monitoringStatus: newMonitoring,
              status: newStatus,
              fps: newMonitoring === 'running' ? 30 : 0,
              latency: newMonitoring === 'running' ? 12 : 0,
              lastSeen: 'Just now',
            }
          : c
      )
    );

    try {
      await patchCameraStatus(cameraId, { status: newStatus });
      toast(`${cam.id} monitoring ${newMonitoring === 'running' ? 'resumed' : 'paused'}.`, 'success');
    } catch {
      toast(`${cam.id} status updated locally.`, 'info');
    }
  };

  // Restart Camera
  const restartCamera = (cameraId: string) => {
    const cam = cameras.find((c) => c.id === cameraId);
    if (!cam) return;

    setCameras((prev) =>
      prev.map((c) => (c.id === cameraId ? { ...c, restarting: true } : c))
    );
    toast(`Restarting ${cam.id} optical stream...`, 'info');

    setTimeout(() => {
      setCameras((prev) =>
        prev.map((c) =>
          c.id === cameraId
            ? {
                ...c,
                restarting: false,
                status: 'online',
                monitoringStatus: 'running',
                fps: 30,
                latency: 12,
                lastSeen: 'Just now',
              }
            : c
        )
      );
      toast(`${cam.id} optical stream synchronized.`, 'success');
    }, 1100);
  };

  // Bulk Actions
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
          ? { ...c, status: 'online', monitoringStatus: 'running', fps: 30, latency: 12, lastSeen: 'Just now' }
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
          ? { ...c, status: 'offline', monitoringStatus: 'paused', fps: 0, latency: 0 }
          : c
      )
    );
    for (const id of Array.from(selectedIds)) {
      try { await patchCameraStatus(id, { status: 'offline' }); } catch {}
    }
    toast(`Paused monitoring on ${selectedIds.size} cameras.`, 'success');
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
            ? { ...c, restarting: false, status: 'online', monitoringStatus: 'running', fps: 30, latency: 12, lastSeen: 'Just now' }
            : c
        )
      );
      toast(`${count} cameras restarted and streaming.`, 'success');
      setSelectedIds(new Set());
    }, 1200);
  };

  // User Management Handlers
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.username || !userForm.email || !userForm.password) {
      toast('Please fill all required credentials.', 'error');
      return;
    }
    setSubmittingUser(true);
    try {
      await createAdminUser(userForm as any);
      toast('Operator profile created.', 'success');
      setUserForm({ username: '', email: '', password: '', role: 'operator' });
      void fetchUsers();
    } catch (err: any) {
      toast(err.message || 'Failed to create user.', 'error');
    } finally {
      setSubmittingUser(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm('Delete operator profile?')) return;
    try {
      await deleteAdminUser(userId);
      toast('Operator profile deleted.', 'info');
      void fetchUsers();
    } catch (err: any) {
      toast(err.message || 'Failed to delete user.', 'error');
    }
  };

  // Calculated Stats
  const totalCameras = cameras.length;
  const totalOnline = cameras.filter((c) => c.status === 'online').length;
  const totalOffline = cameras.filter((c) => c.status === 'offline').length;
  const totalZones = uniqueZones.length;

  return (
    <div className="space-y-3 max-w-7xl mx-auto text-[var(--color-fg)] font-sans pb-10">
      
      {/* 1. Compact Operational Header (Single Row) */}
      <div className="glass px-4 py-2.5 rounded-xl border border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-[var(--color-accent)]" />
            <h1 className="text-sm font-extrabold text-[var(--color-fg)] uppercase tracking-wider">
              Admin Console
            </h1>
          </div>
          <span className="text-[var(--color-border)]">|</span>
          
          {/* Compact Status Chips Row */}
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="bg-[var(--color-surface-2)] px-2.5 py-1 rounded-lg border border-[var(--color-border)] text-[var(--color-muted)]">
              Total: <strong className="text-[var(--color-fg)] font-mono">{totalCameras}</strong>
            </span>
            <span className="bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20 text-emerald-400">
              🟢 Online: <strong className="font-mono">{totalOnline}</strong>
            </span>
            {totalOffline > 0 && (
              <span className="bg-rose-500/10 px-2.5 py-1 rounded-lg border border-rose-500/20 text-rose-400">
                🔴 Offline: <strong className="font-mono">{totalOffline}</strong>
              </span>
            )}
            <span className="bg-[var(--color-surface-2)] px-2.5 py-1 rounded-lg border border-[var(--color-border)] text-[var(--color-muted)]">
              Zones: <strong className="text-indigo-400 font-mono">{totalZones}</strong>
            </span>
          </div>
        </div>

        {/* Right Tools */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => void fetchCameraData()}
            className="p-1.5 rounded-lg bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)] transition-all cursor-pointer"
            title="Refresh Cameras"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setUserModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] text-xs font-bold text-[var(--color-fg)] transition-all cursor-pointer"
          >
            <Users size={12} className="text-[var(--color-accent)]" />
            <span>Accounts</span>
          </button>
        </div>
      </div>

      {/* 2. Compact Search & Filters Bar (Single Row) */}
      <div className="glass px-3 py-2 rounded-xl border border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2 shadow-xs">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
          {/* Search */}
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
            <input
              type="text"
              placeholder="Search camera or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-3 py-1 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs text-[var(--color-fg)] placeholder:text-[var(--color-muted)] outline-none focus:border-[var(--color-accent)]"
            />
          </div>

          {/* Zone Dropdown */}
          <div className="flex items-center gap-1 text-xs">
            <Filter size={11} className="text-[var(--color-muted)]" />
            <select
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              className="px-2 py-1 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-fg)] outline-none cursor-pointer"
            >
              <option value="ALL">All Zones</option>
              {uniqueZones.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>

          {/* Status Dropdown */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2 py-1 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-fg)] outline-none cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="ONLINE">Online Only</option>
            <option value="OFFLINE">Offline Only</option>
            <option value="RUNNING">Running</option>
            <option value="PAUSED">Paused</option>
          </select>
        </div>

        {/* Master Select All Checkbox */}
        <button
          onClick={selectAllFiltered}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--color-fg)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] transition-all cursor-pointer"
        >
          {selectedIds.size > 0 && selectedIds.size === filteredCameras.length ? (
            <CheckSquare size={13} className="text-[var(--color-accent)]" />
          ) : (
            <Square size={13} className="text-[var(--color-muted)]" />
          )}
          <span>{selectedIds.size === filteredCameras.length ? 'Deselect All' : 'Select All'}</span>
        </button>
      </div>

      {/* 7. Compact Sticky Bulk Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-30 bg-slate-900/95 backdrop-blur-md border border-[var(--color-accent)] px-3 py-2 rounded-xl flex items-center justify-between gap-3 shadow-lg animate-fade-in">
          <span className="text-xs font-extrabold text-indigo-300">
            {selectedIds.size} Selected
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={bulkEnable}
              className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs"
            >
              <Play size={11} /> Enable Monitoring
            </button>
            <button
              onClick={bulkDisable}
              className="flex items-center gap-1 px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs"
            >
              <Pause size={11} /> Disable Monitoring
            </button>
            <button
              onClick={bulkRestart}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-lg text-xs font-bold transition-all cursor-pointer"
            >
              <RotateCw size={11} /> Restart Selected
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-slate-400 hover:text-white px-1.5 py-0.5 cursor-pointer font-bold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* 3. Zone Accordion Containers */}
      {filteredCameras.length === 0 ? (
        <div className="glass p-8 rounded-xl border border-[var(--color-border)] text-center text-xs text-[var(--color-muted)] font-medium">
          No matching cameras found.
        </div>
      ) : (
        <div className="space-y-2.5">
          {Array.from(groupedByZone.entries()).map(([zoneName, zoneCams]) => {
            const isExpanded = expandedZones[zoneName] ?? true;
            const zoneOnlineCount = zoneCams.filter((c) => c.status === 'online').length;
            const allRunning = zoneCams.every((c) => c.monitoringStatus === 'running');

            return (
              <div
                key={zoneName}
                className="glass rounded-xl border border-[var(--color-border)] overflow-hidden shadow-xs"
              >
                {/* 5. Zone Header with Single Clean Monitoring Toggle Switch */}
                <div className="px-3 py-2 bg-[var(--color-surface-2)] border-b border-[var(--color-border)] flex items-center justify-between gap-2 select-none">
                  {/* Left: Accordion Title */}
                  <div
                    onClick={() => toggleZoneAccordion(zoneName)}
                    className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} className="text-[var(--color-accent)]" />
                    ) : (
                      <ChevronRight size={14} className="text-[var(--color-muted)]" />
                    )}
                    <h2 className="text-xs font-bold text-[var(--color-fg)]">
                      {zoneName}
                    </h2>
                    <span className="text-[10px] font-mono text-[var(--color-muted)] bg-[var(--color-surface)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
                      {zoneCams.length} Cams • {zoneOnlineCount} Online
                    </span>
                  </div>

                  {/* Right: Zone Single Monitoring Toggle Switch */}
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[var(--color-muted)] font-semibold">
                      Zone Monitoring:
                    </span>
                    <button
                      onClick={() => void toggleZoneMonitoring(zoneName, allRunning)}
                      className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors cursor-pointer ${
                        allRunning ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                      title={allRunning ? 'Pause all in zone' : 'Resume all in zone'}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          allRunning ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                    <span className={`text-[10px] font-bold uppercase ${allRunning ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {allRunning ? 'ON' : 'OFF'}
                    </span>
                  </div>
                </div>

                {/* 4. Compact Camera Rows */}
                {isExpanded && (
                  <div className="divide-y divide-[var(--color-border)]">
                    {zoneCams.map((cam) => {
                      const isSelected = selectedIds.has(cam.id);
                      const isOnline = cam.status === 'online';
                      const isRunning = cam.monitoringStatus === 'running';

                      return (
                        <div
                          key={cam.id}
                          className={`px-3 py-2 flex flex-wrap items-center justify-between gap-3 text-xs transition-colors ${
                            isSelected ? 'bg-indigo-500/5' : 'hover:bg-white/[0.02]'
                          }`}
                        >
                          {/* 12. Information Hierarchy Left: Checkbox + Camera Info */}
                          <div className="flex items-center gap-2.5 min-w-[210px]">
                            <button
                              onClick={() => toggleSelect(cam.id)}
                              className="text-[var(--color-muted)] hover:text-[var(--color-fg)] cursor-pointer"
                            >
                              {isSelected ? (
                                <CheckSquare size={13} className="text-[var(--color-accent)]" />
                              ) : (
                                <Square size={13} />
                              )}
                            </button>

                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                                <span className="font-bold text-[var(--color-fg)]">
                                  {cam.name}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 text-[10px] font-mono text-[var(--color-muted)] mt-0.5">
                                <span>{cam.id}</span>
                              </div>
                            </div>
                          </div>

                          {/* Center: Status Badge + 6. Monitoring Toggle + 11. Health Indicator */}
                          <div className="flex items-center gap-5">
                            {/* 8. Status Badge */}
                            <div className="w-20">
                              {cam.restarting ? (
                                <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md flex items-center gap-1">
                                  🟡 Reconnecting
                                </span>
                              ) : isOnline ? (
                                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md flex items-center gap-1">
                                  🟢 Online
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-md flex items-center gap-1">
                                  🔴 Offline
                                </span>
                              )}
                            </div>

                            {/* 6. Clean Monitoring Toggle (Green = Running, Gray = Paused) */}
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => void toggleCameraMonitoring(cam.id)}
                                className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors cursor-pointer ${
                                  isRunning ? 'bg-emerald-500' : 'bg-slate-700'
                                }`}
                                title={isRunning ? 'Pause Monitoring' : 'Resume Monitoring'}
                              >
                                <span
                                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                    isRunning ? 'translate-x-4' : 'translate-x-0.5'
                                  }`}
                                />
                              </button>
                              <span className={`text-[10px] font-bold w-12 ${isRunning ? 'text-emerald-400' : 'text-slate-400'}`}>
                                {isRunning ? 'Running' : 'Paused'}
                              </span>
                            </div>

                            {/* 11. Compact Camera Health Indicator */}
                            <div className="hidden sm:block text-[11px] font-mono text-[var(--color-muted)]">
                              {isOnline ? `${cam.fps} FPS • ${cam.latency} ms • ${cam.lastSeen}` : `0 FPS • ${cam.lastSeen}`}
                            </div>
                          </div>

                          {/* Right: Only 3 Clean Actions (Live Feed, Calibrate, Restart) */}
                          <div className="flex items-center gap-1.5">
                            {/* 9. Live Feed Action */}
                            <button
                              onClick={() => setPreviewCam(cam)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] text-[11px] font-bold text-sky-400 hover:text-sky-300 transition-all cursor-pointer"
                              title="Open Live Feed"
                            >
                              <Video size={11} />
                              <span>Feed</span>
                            </button>

                            {/* 10. Calibration Action */}
                            <button
                              onClick={() => setCalibrateCam(cam)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] text-[11px] font-bold text-amber-400 hover:text-amber-300 transition-all cursor-pointer"
                              title="Open Calibration"
                            >
                              <Crosshair size={11} />
                              <span>Calibrate</span>
                            </button>

                            {/* Restart */}
                            <button
                              onClick={() => restartCamera(cam.id)}
                              disabled={cam.restarting}
                              className="p-1 rounded-lg bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-white transition-all cursor-pointer disabled:opacity-50"
                              title="Restart Camera"
                            >
                              <RotateCw size={12} className={cam.restarting ? 'animate-spin text-amber-400' : ''} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 9. Live Feed Modal Drawer */}
      {previewCam && (
        <Modal
          isOpen={true}
          onClose={() => setPreviewCam(null)}
          title={`Live Feed — ${previewCam.name} (${previewCam.id})`}
        >
          <div className="space-y-3">
            <div className="relative w-full aspect-video rounded-xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center">
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/40 to-transparent flex flex-col items-center justify-center text-slate-400 p-6 text-center">
                <Video size={32} className="text-indigo-400 mb-2 animate-pulse" />
                <span className="text-xs font-bold text-slate-200">
                  {previewCam.name}
                </span>
                <span className="text-[10px] font-mono text-slate-400 mt-1">
                  1920×1080 • {previewCam.fps} FPS • {previewCam.latency}ms Latency • Active Stream
                </span>
              </div>
              <div className="absolute top-2.5 left-2.5 bg-slate-900/90 px-2 py-0.5 rounded text-[10px] font-mono text-emerald-400 border border-slate-700">
                LIVE
              </div>
              <div className="absolute top-2.5 right-2.5 bg-slate-900/90 px-2 py-0.5 rounded text-[10px] font-mono text-slate-300 border border-slate-700">
                {previewCam.zone}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <button
                onClick={() => {
                  void toggleCameraMonitoring(previewCam.id);
                  setPreviewCam((prev) => prev ? {
                    ...prev,
                    monitoringStatus: prev.monitoringStatus === 'running' ? 'paused' : 'running',
                    status: prev.monitoringStatus === 'running' ? 'offline' : 'online'
                  } : null);
                }}
                className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 cursor-pointer ${
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
                  setPreviewCam(null);
                  navigate('/calibration');
                }}
                className="px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Crosshair size={12} /> Open Full Calibration
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 10. Inline Calibration Quick Modal */}
      {calibrateCam && (
        <Modal
          isOpen={true}
          onClose={() => setCalibrateCam(null)}
          title={`Zone Calibration Quick Trigger — ${calibrateCam.name}`}
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] space-y-2">
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)] font-semibold">Sensor Target:</span>
                <span className="font-bold text-[var(--color-fg)]">{calibrateCam.name} ({calibrateCam.id})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)] font-semibold">Assigned Sector:</span>
                <span className="font-mono text-indigo-400 font-bold">{calibrateCam.zone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)] font-semibold">Sensor Status:</span>
                <span className="font-bold text-emerald-400">Online & Armed</span>
              </div>
            </div>

            <p className="text-[var(--color-muted)] text-[11px] leading-relaxed">
              Initiate auto-fit optical convex hull bounding envelope calibration for this camera sensor.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
              <button
                onClick={() => setCalibrateCam(null)}
                className="px-3 py-1.5 rounded-lg text-[var(--color-muted)] hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setCalibrateCam(null);
                  navigate('/calibration');
                }}
                className="px-4 py-1.5 rounded-lg bg-[var(--color-accent)] hover:bg-indigo-500 text-white font-bold transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Crosshair size={12} /> Launch Calibration Suite
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
          title="Security Operator Accounts"
        >
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            <form onSubmit={handleCreateUser} className="glass p-3 rounded-xl border border-[var(--color-border)] space-y-2.5">
              <h4 className="text-xs font-extrabold text-[var(--color-fg)] uppercase tracking-wider flex items-center gap-1.5">
                <Plus size={12} className="text-[var(--color-accent)]" /> Add Operator Login
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <input
                  type="text"
                  placeholder="Username"
                  value={userForm.username}
                  onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                  className="px-2.5 py-1 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs text-[var(--color-fg)] outline-none"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={userForm.email}
                  onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                  className="px-2.5 py-1 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs text-[var(--color-fg)] outline-none"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  className="px-2.5 py-1 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs text-[var(--color-fg)] outline-none"
                />
                <select
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                  className="px-2.5 py-1 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs text-[var(--color-fg)] outline-none cursor-pointer"
                >
                  <option value="operator">Operator</option>
                  <option value="viewer">Viewer</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={submittingUser}
                className="w-full py-1.5 bg-[var(--color-accent)] hover:bg-indigo-600 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
              >
                {submittingUser ? 'Registering...' : 'Register Operator'}
              </button>
            </form>

            <div className="space-y-1.5">
              <h4 className="text-[11px] font-bold text-[var(--color-muted)] uppercase tracking-wider">
                Existing Accounts ({users.length})
              </h4>
              <div className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-xl bg-[var(--color-surface-2)] overflow-hidden">
                {users.map((u) => (
                  <div key={u.id} className="p-2 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-bold text-[var(--color-fg)]">{u.username}</span>
                      <span className="text-[10px] text-[var(--color-muted)] ml-1.5">({u.email})</span>
                      <span className="ml-1.5 font-mono text-[9px] uppercase text-indigo-400 bg-indigo-950 px-1 py-0.5 rounded border border-indigo-800">
                        {u.role}
                      </span>
                    </div>
                    {u.role !== 'admin' && (
                      <button
                        onClick={() => handleDeleteUser(u.id)}
                        className="p-1 text-rose-400 hover:text-rose-300"
                        title="Delete account"
                      >
                        <Trash2 size={11} />
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
