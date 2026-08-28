import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '../components/Common/Card';
import { Button } from '../components/Common/Button';
import { Badge } from '../components/Common/Badge';
import { useToast } from '../components/ui/Toast';
import { usePermissions } from '../hooks/usePermissions';
import {
  facilityMapGet, facilityMapUpload, facilityMapImageUrl, facilityMapSetPlacement,
  facilityMapRemovePlacement, facilityMapOverlap, pipelineListCameras, pipelineListZones,
  type FacilityMapMeta, type CameraPlacement, type FovOverlapPair, type PipelineCamera, type PipelineZone,
} from '../services/pipelineApi';
import { Upload, MapPin, Trash2, Link2 } from 'lucide-react';
import ZoneEditModal from './ZoneEditModal';

/**
 * Facility map: an uploaded site/floor plan, camera placements on it
 * (position + facing direction + field-of-view cone), and the GEOMETRIC
 * field-of-view overlap computed between every camera pair -- the
 * "geometric seed" adjacency input that was explicitly missing until now
 * (see TODO_ACTION_ITEMS.md A2: "needs a site map that does not exist
 * here"). This is a THIRD adjacency signal, distinct from the confirmed
 * (human-declared) and candidate (behavioural-correlation) ones already
 * shown on the Live Overview tab -- it answers "what cameras share a
 * certain field of view and to what extent," not just "are these two
 * cameras near each other."
 *
 * Placement (position/facing/FOV) is authorized-only (gated the same way as
 * zone edits) but NOT reason-logged -- placing a camera on a map changes no
 * detection/alerting behaviour by itself. Only APPLYING a suggested overlap
 * as a zone's confirmed adjacency goes through the full reasoned+logged
 * ZoneEditModal flow, same as every other zone correction.
 */

// Same angle convention as the backend's _sector_polygon (0deg = up/north,
// clockwise) -- what an operator sets here must draw exactly what the
// server computes overlap against.
function sectorPath(cx: number, cy: number, facingDeg: number, fovDeg: number, radius: number): string {
  const half = fovDeg / 2;
  const rad = (d: number) => (d * Math.PI) / 180;
  const p1 = { x: cx + radius * Math.sin(rad(facingDeg - half)), y: cy - radius * Math.cos(rad(facingDeg - half)) };
  const p2 = { x: cx + radius * Math.sin(rad(facingDeg + half)), y: cy - radius * Math.cos(rad(facingDeg + half)) };
  const largeArc = fovDeg > 180 ? 1 : 0;
  return `M ${cx},${cy} L ${p1.x},${p1.y} A ${radius},${radius} 0 ${largeArc} 1 ${p2.x},${p2.y} Z`;
}

const OVERLAP_THRESHOLD_PCT = 5;

export default function CalibrationFacilityMap() {
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('manage_cameras');

  const [map, setMap] = useState<FacilityMapMeta | null>(null);
  const [placements, setPlacements] = useState<CameraPlacement[]>([]);
  const [cameras, setCameras] = useState<PipelineCamera[]>([]);
  const [zones, setZones] = useState<PipelineZone[]>([]);
  const [overlapPairs, setOverlapPairs] = useState<FovOverlapPair[]>([]);
  const [uploading, setUploading] = useState(false);

  const [placing, setPlacing] = useState(false);
  const [pendingSpot, setPendingSpot] = useState<{ x_pct: number; y_pct: number } | null>(null);
  const [formCamera, setFormCamera] = useState('');
  const [formFacing, setFormFacing] = useState(0);
  const [formFov, setFormFov] = useState(90);
  const [formRange, setFormRange] = useState(25);

  const [adjacencyTarget, setAdjacencyTarget] = useState<{ zone: PipelineZone; addCameraId: string } | null>(null);

  const imgRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const [mapRes, cams, zs] = await Promise.all([facilityMapGet(), pipelineListCameras(), pipelineListZones()]);
      setMap(mapRes.map);
      setPlacements(mapRes.placements);
      setCameras(cams);
      setZones(zs);
      if (mapRes.map) setOverlapPairs((await facilityMapOverlap()).pairs);
      else setOverlapPairs([]);
    } catch (e: any) {
      toast(e.message || 'Could not load facility map', 'error');
    }
  };

  useEffect(() => { void load(); }, []);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      await facilityMapUpload(file, file.name);
      toast('Facility map uploaded.', 'success');
      await load();
    } catch (e: any) {
      toast(e.message || 'Upload failed.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!placing || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x_pct = ((e.clientX - rect.left) / rect.width) * 100;
    const y_pct = ((e.clientY - rect.top) / rect.height) * 100;
    setPendingSpot({ x_pct: Math.max(0, Math.min(100, x_pct)), y_pct: Math.max(0, Math.min(100, y_pct)) });
    setFormCamera(''); setFormFacing(0); setFormFov(90); setFormRange(25);
  };

  const editPlacement = (p: CameraPlacement) => {
    setPendingSpot({ x_pct: p.x_pct, y_pct: p.y_pct });
    setFormCamera(p.camera_id); setFormFacing(p.facing_deg); setFormFov(p.fov_deg); setFormRange(p.range_pct);
  };

  const savePlacement = async () => {
    if (!pendingSpot || !formCamera) { toast('Select a camera first.', 'error'); return; }
    try {
      const cam = cameras.find((c) => c.camera_id === formCamera);
      await facilityMapSetPlacement(formCamera, {
        camera_id: formCamera, camera_name: cam?.name ?? null,
        x_pct: pendingSpot.x_pct, y_pct: pendingSpot.y_pct,
        facing_deg: formFacing, fov_deg: formFov, range_pct: formRange,
      });
      toast('Camera placed.', 'success');
      setPendingSpot(null); setPlacing(false);
      await load();
    } catch (e: any) {
      toast(e.message || 'Failed to save placement.', 'error');
    }
  };

  const removePlacement = async (cameraId: string) => {
    if (!window.confirm('Remove this camera from the facility map?')) return;
    try {
      await facilityMapRemovePlacement(cameraId);
      toast('Placement removed.', 'info');
      await load();
    } catch (e: any) {
      toast(e.message || 'Failed to remove placement.', 'error');
    }
  };

  const zoneFor = (cameraId: string) => zones.find((z) => z.camera_id === cameraId);
  const diagonal = map ? Math.hypot(map.width_px, map.height_px) : 0;
  const scale = map ? Math.min(700 / map.width_px, 500 / map.height_px, 1) : 1;
  const dispW = map ? map.width_px * scale : 0;
  const dispH = map ? map.height_px * scale : 0;

  return (
    <div className="space-y-6">
      <Card className="bg-[var(--surface)] border-[var(--border)]">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-bold text-sm text-[var(--text)]">Facility Map</h3>
              <p className="text-[10px] text-[var(--text-2)]">
                {map ? `${map.name} — ${map.width_px}×${map.height_px}px, uploaded by ${map.uploaded_by ?? 'unknown'}` : 'No map uploaded yet.'}
              </p>
            </div>
            {canEdit && (
              <div className="flex gap-2">
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} />
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="flex items-center gap-1.5 text-xs font-bold">
                  <Upload size={12} /> {uploading ? 'Uploading…' : map ? 'Replace Map' : 'Upload Map'}
                </Button>
                {map && (
                  <Button variant={placing ? 'primary' : 'outline'} size="sm" onClick={() => setPlacing(!placing)}
                    className="flex items-center gap-1.5 text-xs font-bold">
                    <MapPin size={12} /> {placing ? 'Click the map…' : 'Place a Camera'}
                  </Button>
                )}
              </div>
            )}
          </div>

          {!map ? (
            <div className="p-10 text-center text-[var(--text-3)] text-sm font-semibold border border-dashed border-[var(--border)] rounded-xl">
              {canEdit ? 'Upload a site photo or floor plan to start placing cameras.' : 'No facility map has been uploaded by an authorized user yet.'}
            </div>
          ) : (
            <div
              ref={imgRef}
              onClick={handleImageClick}
              className="relative border border-[var(--border)] rounded-xl overflow-hidden bg-black"
              style={{ width: dispW, height: dispH, cursor: placing ? 'crosshair' : 'default' }}
            >
              <img src={facilityMapImageUrl()} alt="Facility map" className="w-full h-full object-contain select-none" draggable={false} />
              <svg viewBox={`0 0 ${map.width_px} ${map.height_px}`} className="absolute inset-0 w-full h-full pointer-events-none">
                {placements.map((p) => {
                  const cx = (p.x_pct / 100) * map.width_px, cy = (p.y_pct / 100) * map.height_px;
                  const r = (p.range_pct / 100) * diagonal;
                  return (
                    <g key={p.camera_id}>
                      <path d={sectorPath(cx, cy, p.facing_deg, p.fov_deg, r)} fill="#38bdf8" fillOpacity={0.22} stroke="#38bdf8" strokeWidth={diagonal * 0.002} />
                      <circle cx={cx} cy={cy} r={diagonal * 0.008} fill="#0ea5e9" stroke="white" strokeWidth={diagonal * 0.0015} />
                    </g>
                  );
                })}
              </svg>
              {placing && pendingSpot && (
                <div className="absolute w-3 h-3 rounded-full bg-rose-500 border-2 border-white -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ left: `${pendingSpot.x_pct}%`, top: `${pendingSpot.y_pct}%` }} />
              )}
            </div>
          )}

          {canEdit && pendingSpot && (
            <Card className="bg-[var(--surface-2)] border-[var(--border)]">
              <CardContent className="p-4 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-[var(--text-2)] block mb-1">Camera</label>
                    <select value={formCamera} onChange={(e) => setFormCamera(e.target.value)}
                      className="border rounded px-2 py-1.5 bg-[var(--bg-2)] text-[var(--text)] text-xs w-full">
                      <option value="">Select…</option>
                      {cameras.map((c) => <option key={c.camera_id} value={c.camera_id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[var(--text-2)] block mb-1">Facing (° cw from up)</label>
                    <input type="number" min={0} max={359} value={formFacing} onChange={(e) => setFormFacing(Number(e.target.value))}
                      className="border rounded px-2 py-1.5 bg-[var(--bg-2)] text-[var(--text)] text-xs w-full" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[var(--text-2)] block mb-1">FOV width (°)</label>
                    <input type="number" min={1} max={360} value={formFov} onChange={(e) => setFormFov(Number(e.target.value))}
                      className="border rounded px-2 py-1.5 bg-[var(--bg-2)] text-[var(--text)] text-xs w-full" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[var(--text-2)] block mb-1">Range (% of map diagonal)</label>
                    <input type="number" min={1} max={150} value={formRange} onChange={(e) => setFormRange(Number(e.target.value))}
                      className="border rounded px-2 py-1.5 bg-[var(--bg-2)] text-[var(--text)] text-xs w-full" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setPendingSpot(null); setPlacing(false); }}>Cancel</Button>
                  <Button size="sm" onClick={() => void savePlacement()}>Save Placement</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {placements.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {placements.map((p) => (
                <Badge key={p.camera_id} variant="default" className="text-[9px] flex items-center gap-1.5">
                  <button className="hover:underline" onClick={() => canEdit && editPlacement(p)}>{p.camera_name ?? p.camera_id.slice(0, 8)}</button>
                  {canEdit && <button onClick={() => void removePlacement(p.camera_id)}><Trash2 size={9} /></button>}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {map && (
        <Card className="bg-[var(--surface)] border-[var(--border)]">
          <CardContent className="p-5 space-y-3">
            <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-1.5"><Link2 size={14} className="text-sky-500" /> Field-of-View Overlap</h3>
            <p className="text-[10px] text-[var(--text-2)]">
              Computed server-side (exact convex-sector geometry, not an approximation) from the placements above. A SUGGESTION only — applying it to a zone's confirmed adjacency requires the same reviewed, reasoned, logged edit as any other zone correction.
            </p>
            {overlapPairs.length === 0 ? (
              <p className="text-xs text-[var(--text-3)]">No overlapping fields of view among placed cameras.</p>
            ) : (
              <div className="space-y-2">
                {overlapPairs.map((pair) => {
                  const zoneA = zoneFor(pair.camera_a), zoneB = zoneFor(pair.camera_b);
                  const notable = Math.max(pair.pct_of_a_fov, pair.pct_of_b_fov) >= OVERLAP_THRESHOLD_PCT;
                  return (
                    <div key={`${pair.camera_a}-${pair.camera_b}`} className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs">
                      <div>
                        <span className="font-bold">{pair.camera_a_name ?? pair.camera_a.slice(0, 8)}</span>
                        <span className="text-[var(--text-3)]"> ↔ </span>
                        <span className="font-bold">{pair.camera_b_name ?? pair.camera_b.slice(0, 8)}</span>
                        <p className="text-[10px] text-[var(--text-2)] font-mono">
                          {pair.pct_of_a_fov}% of A's FOV overlaps B · {pair.pct_of_b_fov}% of B's FOV overlaps A
                        </p>
                      </div>
                      {canEdit && notable && (
                        <div className="flex gap-1.5 shrink-0">
                          {zoneA && !zoneA.adjacent_camera_ids.includes(pair.camera_b) && (
                            <Button variant="outline" size="sm" className="text-[10px]"
                              onClick={() => setAdjacencyTarget({ zone: zoneA, addCameraId: pair.camera_b })}>
                              Apply via {pair.camera_a_name ?? 'A'}'s zone
                            </Button>
                          )}
                          {zoneB && !zoneB.adjacent_camera_ids.includes(pair.camera_a) && (
                            <Button variant="outline" size="sm" className="text-[10px]"
                              onClick={() => setAdjacencyTarget({ zone: zoneB, addCameraId: pair.camera_a })}>
                              Apply via {pair.camera_b_name ?? 'B'}'s zone
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {adjacencyTarget && (
        <ZoneEditModal
          zone={adjacencyTarget.zone}
          availableCameras={cameras.map((c) => ({ camera_id: c.camera_id, name: c.name }))}
          isOpen={true}
          onClose={() => setAdjacencyTarget(null)}
          onApplied={() => void load()}
          prefill={{
            adjacent_camera_ids: Array.from(new Set([...adjacencyTarget.zone.adjacent_camera_ids, adjacencyTarget.addCameraId])),
          }}
        />
      )}
    </div>
  );
}
