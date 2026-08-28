import { useEffect, useState } from 'react';
import { Card, CardContent } from '../components/Common/Card';
import { Badge } from '../components/Common/Badge';
import { Button } from '../components/Common/Button';
import { useToast } from '../components/ui/Toast';
import {
  pipelineListZones, pipelineListCameras, pipelineZoneEditLog,
  type PipelineZone, type ZoneEditLogEntry,
} from '../services/pipelineApi';
import { usePermissions } from '../hooks/usePermissions';
import { RefreshCw, Database, Pencil, History, ChevronDown, ChevronUp } from 'lucide-react';
import ZoneEditModal from './ZoneEditModal';

/**
 * Per-camera calibrated data -- exactly what the Context Engine's severity
 * formula reads at alert time for each camera (see
 * sentinel_pipeline/context/severity.py and zones.py, quoted directly in the
 * CONTEXT_ENGINE_VALIDATION_REPORT). This is a direct render of
 * GET /v1/zones -- no client-side computation, no invented fields.
 */
export default function CalibrationZoneData() {
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('manage_cameras'); // administrator/admin + operator, not viewer -- matches require_operator on the backend
  const [zones, setZones] = useState<PipelineZone[]>([]);
  const [cameras, setCameras] = useState<Array<{ camera_id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [editingZone, setEditingZone] = useState<PipelineZone | null>(null);
  const [historyCameraId, setHistoryCameraId] = useState<string | null>(null);
  const [history, setHistory] = useState<ZoneEditLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [z, c] = await Promise.all([pipelineListZones(), pipelineListCameras()]);
      setZones(z);
      setCameras(c.map((cam) => ({ camera_id: cam.camera_id, name: cam.name })));
    } catch (e: any) {
      toast(e.message || 'Could not load zone data', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const loadHistory = async (cameraId: string) => {
    setHistoryLoading(true);
    try {
      setHistory(await pipelineZoneEditLog(cameraId));
    } catch (e: any) {
      toast(e.message || 'Could not load edit history', 'error');
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleHistory = async (cameraId: string) => {
    if (historyCameraId === cameraId) { setHistoryCameraId(null); return; }
    setHistoryCameraId(cameraId);
    await loadHistory(cameraId);
  };

  const tierColor: Record<string, string> = {
    high: 'bg-red-500/10 text-red-500 border-red-500/20',
    medium: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    low: 'bg-sky-500/10 text-sky-500 border-sky-500/20',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-2)] font-semibold">
          {zones.length} approved zone{zones.length === 1 ? '' : 's'} — the data each camera's severity scoring actually reads.
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="flex items-center gap-1.5 text-xs font-bold">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      {zones.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-[var(--text-3)] text-sm font-semibold">
          <Database size={28} className="mx-auto mb-2 opacity-50" />
          No approved zones yet. Approve one from the Calibrate tab first.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {zones.map((z) => (
            // camera_id, not zone_id, is the real uniqueness guarantee here --
            // ZoneRegistry is keyed by camera_id (zones.py), and multiple
            // cameras covering the same physical area are meant to share one
            // zone_id (ZoneRegistry.are_adjacent() relies on exactly that).
            // Using zone_id as the key produced real "duplicate key" React
            // warnings against this session's own stale test zone data.
            <Card key={z.camera_id} className="bg-[var(--surface)] border-[var(--border)]">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-sm text-[var(--text)]">{z.name || z.zone_id}</h3>
                    <p className="text-[9px] font-mono text-[var(--text-3)]">{z.camera_id}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border ${tierColor[z.risk_tier] ?? tierColor.medium}`}>
                      {z.risk_tier} risk
                    </span>
                    {canEdit && (
                      <button
                        onClick={() => setEditingZone(z)}
                        title="Edit zone data (authorized accounts only)"
                        className="p-1 rounded-md border border-[var(--border)] text-[var(--text-2)] hover:text-sky-500 hover:border-sky-500/40 cursor-pointer"
                      >
                        <Pencil size={11} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
                  <div><span className="text-[var(--text-3)] block">risk_weight (severity input)</span><span className="font-mono font-bold">{z.risk_weight.toFixed(2)}</span></div>
                  <div><span className="text-[var(--text-3)] block">containment polygon</span><span className="font-mono font-bold">{z.has_containment ? `${z.polygon.length} pts` : 'none (every detection = breach)'}</span></div>
                  <div><span className="text-[var(--text-3)] block">mean area (envelope)</span><span className="font-mono font-bold">{z.envelope.mean_area?.toFixed(0) ?? '—'} px²</span></div>
                  <div><span className="text-[var(--text-3)] block">std area (envelope)</span><span className="font-mono font-bold">{z.envelope.std_area?.toFixed(0) ?? '—'} px²</span></div>
                  <div><span className="text-[var(--text-3)] block">min / max area</span><span className="font-mono font-bold">{z.envelope.min_area ?? '—'} / {z.envelope.max_area ?? '—'} px²</span></div>
                  <div><span className="text-[var(--text-3)] block">sigma tolerance</span><span className="font-mono font-bold">{z.envelope.area_sigma_tolerance}σ</span></div>
                  <div><span className="text-[var(--text-3)] block">always-on source</span><span className="font-mono font-bold">{z.envelope.always_on ? 'yes (furnace/flare-type)' : 'no'}</span></div>
                  <div><span className="text-[var(--text-3)] block">flammables nearby</span><span className="font-mono font-bold">{z.flammable_materials_nearby ? 'yes (+0.15 escalation)' : 'no'}</span></div>
                </div>

                {z.designated_activity_allowed.length > 0 && (
                  <div className="text-[10px]">
                    <span className="text-[var(--text-3)] block mb-1">designated activity allowed (discount-eligible)</span>
                    <div className="flex flex-wrap gap-1">
                      {z.designated_activity_allowed.map((a) => <Badge key={a} variant="default" className="text-[9px]">{a}</Badge>)}
                    </div>
                  </div>
                )}

                <div className="text-[10px]">
                  <span className="text-[var(--text-3)] block mb-1">adjacent cameras (confirmed, human-approved)</span>
                  {z.adjacent_camera_ids.length === 0
                    ? <span className="font-mono text-[var(--text-3)]">none declared — this camera's detections never merge into another camera's incident</span>
                    : <div className="flex flex-wrap gap-1">{z.adjacent_camera_ids.map((id) => <Badge key={id} variant="default" className="text-[9px] font-mono">{id.slice(0, 8)}</Badge>)}</div>}
                </div>

                {canEdit && (
                  <div className="pt-1 border-t border-[var(--border)]">
                    <button
                      onClick={() => void toggleHistory(z.camera_id)}
                      className="text-[9px] font-bold text-[var(--text-2)] hover:text-sky-500 flex items-center gap-1 cursor-pointer"
                    >
                      <History size={10} /> Edit history
                      {historyCameraId === z.camera_id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                    </button>
                    {historyCameraId === z.camera_id && (
                      <div className="mt-2 space-y-1.5">
                        {historyLoading ? (
                          <p className="text-[9px] text-[var(--text-3)]">Loading…</p>
                        ) : history.length === 0 ? (
                          <p className="text-[9px] text-[var(--text-3)]">No edits logged for this zone yet.</p>
                        ) : history.map((h) => (
                          <div key={h.id} className="text-[9px] bg-[var(--surface-2)] rounded-lg p-2 space-y-0.5">
                            <div className="flex justify-between font-bold">
                              <span>{h.username ?? 'unknown'}</span>
                              <span className="font-mono text-[var(--text-3)]">{new Date(h.timestamp).toLocaleString()}</span>
                            </div>
                            <p className="text-[var(--text-2)] italic">"{h.reason}"</p>
                            {h.changes.map((c, i) => (
                              <p key={i} className="font-mono text-[var(--text-3)]">
                                {c.field}: {JSON.stringify(c.before)} → {JSON.stringify(c.after)}
                              </p>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editingZone && (
        <ZoneEditModal
          zone={editingZone}
          availableCameras={cameras}
          isOpen={true}
          onClose={() => setEditingZone(null)}
          onApplied={() => { void load(); if (historyCameraId === editingZone.camera_id) void loadHistory(editingZone.camera_id); }}
        />
      )}
    </div>
  );
}
