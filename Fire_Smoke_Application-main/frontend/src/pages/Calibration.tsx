import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '../components/Common/Card';
import { Button } from '../components/Common/Button';
import { Badge } from '../components/Common/Badge';
import { useToast } from '../components/ui/Toast';
import {
  pipelineListCameras, pipelineCalibrateStart, pipelineCalibrateSuggestion,
  pipelineApproveZone,
} from '../services/pipelineApi';
import { Crosshair, Radio, CheckCircle2, FastForward, LayoutGrid, Database, Map as MapIcon } from 'lucide-react';
import CalibrationLiveOverview from './CalibrationLiveOverview';
import CalibrationZoneData from './CalibrationZoneData';
import CalibrationFacilityMap from './CalibrationFacilityMap';

/**
 * Calibration tab -- DEMO BUILD.
 *
 * The "skip ahead" control here is NOT a fake progress bar. It does two real
 * things, both already-shipped production behaviour, not anything special
 * built for this page:
 *
 *  1. It starts the SAME calibration window the production flow uses, just
 *     with a short `window_hours` value -- a real, already-exposed API
 *     parameter (see pipelineCalibrateStart), not a hack.
 *  2. "Get suggestion now" simply calls the suggestion endpoint before the
 *     window has elapsed. The backend already answers that call at any time
 *     -- it clusters whatever real observations have been logged so far and
 *     says so plainly (fewer observations = a lower-confidence note in the
 *     response, not a fabricated result).
 *
 * Approval goes through pipelineApproveZone -- the exact same call a real
 * 72-hour calibration would end with. Nothing about the zone that gets
 * written is demo-only.
 */

const DEMO_WINDOW_MINUTES_DEFAULT = 2;

interface CameraOption {
  camera_id: string;
  name: string;
}

interface SuggestionState {
  ready: boolean;
  observation_count: number;
  elapsed_hours: number;
  window_complete?: boolean;
  polygon?: number[][];
  envelope?: { mean_area?: number; std_area?: number; always_on?: boolean };
  always_on?: boolean;
  notes?: string[];
  detail?: string;
}

export default function Calibration() {
  const { toast } = useToast();
  const [pageTab, setPageTab] = useState<'calibrate' | 'live' | 'zones' | 'map'>('calibrate');
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  // Which camera(s) are checked to be started together. Separate from
  // `selectedCamera` (below) -- starting is a batch action across many
  // cameras at once ("we should be able to calibrate multiple cameras at
  // once"), while the suggestion/approve detail panel still focuses on ONE
  // camera at a time (approving a zone is inherently per-camera). Watch ALL
  // of them progress simultaneously on the Live Overview tab, which already
  // polls every calibrating camera -- this tab's detail panel intentionally
  // doesn't duplicate that, to avoid running N parallel pollers here too.
  const [startSet, setStartSet] = useState<Set<string>>(new Set());
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [windowMinutes, setWindowMinutes] = useState(DEMO_WINDOW_MINUTES_DEFAULT);
  const [calibratingCameras, setCalibratingCameras] = useState<Set<string>>(new Set());
  const calibrating = calibratingCameras.has(selectedCamera);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [riskWeight, setRiskWeight] = useState(0.5);
  const [approving, setApproving] = useState(false);
  const [approvedZoneId, setApprovedZoneId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const toggleStartSet = (cameraId: string) => {
    setStartSet((prev) => {
      const next = new Set(prev);
      if (next.has(cameraId)) next.delete(cameraId); else next.add(cameraId);
      return next;
    });
  };

  useEffect(() => {
    pipelineListCameras()
      .then((cams) => {
        setCameras(cams.map((c) => ({ camera_id: c.camera_id, name: c.name })));
        if (cams.length && !selectedCamera) {
          setSelectedCamera(cams[0].camera_id);
          setStartSet(new Set([cams[0].camera_id]));
        }
      })
      .catch(() => toast('Could not load cameras from the pipeline', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  const pollSuggestion = async (cameraId: string) => {
    try {
      const s = await pipelineCalibrateSuggestion(cameraId);
      setSuggestion(s as SuggestionState);
    } catch {
      // No session yet, or camera has no calibration state -- not an error
      // worth surfacing on every poll tick.
    }
  };

  const startCalibration = async () => {
    const targets = Array.from(startSet.size ? startSet : (selectedCamera ? [selectedCamera] : []));
    if (targets.length === 0) { toast('Select at least one camera first', 'error'); return; }

    const results = await Promise.allSettled(
      targets.map((id) => pipelineCalibrateStart(id, windowMinutes / 60)),
    );
    const started = targets.filter((_, i) => results[i].status === 'fulfilled');
    const failed = targets.filter((_, i) => results[i].status === 'rejected');

    if (started.length) {
      setCalibratingCameras((prev) => new Set([...prev, ...started]));
      // Focus the detail/suggestion panel on one of the cameras just
      // started (prefer the currently-selected one if it's among them).
      if (!started.includes(selectedCamera)) setSelectedCamera(started[0]);
      setStartedAt(Date.now());
      setSuggestion(null);
      setApprovedZoneId(null);
      const focus = started.includes(selectedCamera) ? selectedCamera : started[0];
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(() => pollSuggestion(focus), 1500);
      void pollSuggestion(focus);
    }

    if (started.length && !failed.length) {
      toast(
        started.length === 1
          ? `Calibration started (demo window: ${windowMinutes} min)`
          : `Calibration started on ${started.length} cameras at once (demo window: ${windowMinutes} min each). Watch them all on the Live Overview tab.`,
        'success',
      );
    } else if (started.length && failed.length) {
      toast(`Started ${started.length}/${targets.length} — ${failed.length} failed (already calibrating, or unreachable).`, 'info');
    } else {
      toast('Failed to start calibration on the selected camera(s).', 'error');
    }
  };

  const skipAhead = async () => {
    if (!selectedCamera) return;
    await pollSuggestion(selectedCamera);
    toast('Fetched suggestion now, using whatever real observations exist so far', 'info');
  };

  const approve = async () => {
    if (!selectedCamera || !suggestion?.polygon) return;
    setApproving(true);
    try {
      const cam = cameras.find((c) => c.camera_id === selectedCamera);
      const zoneId = `zone-${selectedCamera.slice(0, 8)}-${Date.now()}`;
      const result = await pipelineApproveZone(selectedCamera, {
        zone_id: zoneId,
        risk_weight: riskWeight,
        name: `${cam?.name ?? 'Camera'} Zone`,
        polygon: suggestion.polygon,
      });
      setApprovedZoneId(zoneId);
      toast('Zone approved and written to the real zones table', 'success');
      if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
      setCalibratingCameras((prev) => { const next = new Set(prev); next.delete(selectedCamera); return next; });
      setStartSet((prev) => { const next = new Set(prev); next.delete(selectedCamera); return next; });
      console.log('Zone approval result:', result);
    } catch (e: any) {
      toast('Approval failed: ' + e.message, 'error');
    } finally {
      setApproving(false);
    }
  };

  const elapsedSec = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
          <Crosshair className="w-6 h-6 text-sky-500" /> Zone Calibration
        </h1>
        <p className="text-sm text-[var(--text-2)] mt-1">
          Auto-suggested containment zones from observed activity, human-approved before they take effect.
        </p>
        <Badge variant="warning" className="mt-2">
          DEMO MODE — window shortened to minutes for this demonstration. Production default is 24–72 hours.
          Same code path either way.
        </Badge>
      </div>

      <div className="flex bg-slate-50 dark:bg-slate-900 border border-[var(--border)] p-1 rounded-2xl gap-1 overflow-x-auto w-fit">
        {[
          { id: 'calibrate' as const, label: 'Calibrate', icon: <Crosshair size={14} /> },
          { id: 'live' as const, label: 'Live Overview & Adjacency', icon: <LayoutGrid size={14} /> },
          { id: 'zones' as const, label: 'Zone Data', icon: <Database size={14} /> },
          { id: 'map' as const, label: 'Facility Map', icon: <MapIcon size={14} /> },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setPageTab(tab.id)}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 shrink-0 cursor-pointer flex items-center gap-2 ${
              pageTab === tab.id
                ? 'bg-white dark:bg-slate-800 text-sky-700 dark:text-sky-400 border border-slate-200/50 dark:border-slate-700 shadow-sm'
                : 'text-[var(--text-2)] hover:text-[var(--text)] hover:bg-white/40 border border-transparent'
            }`}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {pageTab === 'live' && <CalibrationLiveOverview />}
      {pageTab === 'zones' && <CalibrationZoneData />}
      {pageTab === 'map' && <CalibrationFacilityMap />}

      {pageTab === 'calibrate' && (
      <Card>
        <CardContent className="p-5 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-[var(--text-2)]">
                Cameras to calibrate ({startSet.size} selected — starts together, one click)
              </label>
              <div className="flex gap-2">
                <button
                  className="text-[10px] font-bold text-sky-500 hover:underline cursor-pointer"
                  onClick={() => setStartSet(new Set(cameras.filter((c) => !calibratingCameras.has(c.camera_id)).map((c) => c.camera_id)))}
                >
                  Select all
                </button>
                <button
                  className="text-[10px] font-bold text-[var(--text-2)] hover:underline cursor-pointer"
                  onClick={() => setStartSet(new Set())}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="border border-[var(--border)] rounded-lg max-h-40 overflow-y-auto bg-[var(--bg-2)] divide-y divide-[var(--border)]">
              {cameras.length === 0 && <p className="p-3 text-xs text-[var(--text-3)]">No cameras registered</p>}
              {cameras.map((c) => {
                const isCalibrating = calibratingCameras.has(c.camera_id);
                return (
                  <label key={c.camera_id} className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer ${isCalibrating ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={startSet.has(c.camera_id)}
                      disabled={isCalibrating}
                      onChange={() => toggleStartSet(c.camera_id)}
                    />
                    <span className={selectedCamera === c.camera_id ? 'font-bold text-sky-500' : ''}>{c.name}</span>
                    {isCalibrating && <Badge variant="success" className="text-[8px] ml-auto">calibrating</Badge>}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-xs font-semibold text-[var(--text-2)] block mb-1">
                Demo window (minutes, applies to every camera started together)
              </label>
              <input
                type="number" min={1} max={30} value={windowMinutes}
                onChange={(e) => setWindowMinutes(Number(e.target.value))}
                className="border rounded px-3 py-2 bg-[var(--bg-2)] text-[var(--text)] w-24"
              />
            </div>
            <Button onClick={startCalibration} disabled={startSet.size === 0}>
              <Radio className="w-4 h-4 mr-1" /> Start Calibration{startSet.size > 1 ? ` (${startSet.size} cameras)` : ''}
            </Button>
          </div>

          {calibratingCameras.size > 0 && (
            <div className="flex flex-wrap items-end gap-4 border-t border-[var(--border)] pt-4">
              <div>
                <label className="text-xs font-semibold text-[var(--text-2)] block mb-1">Viewing details for</label>
                <select
                  className="border rounded px-3 py-2 bg-[var(--bg-2)] text-[var(--text)] min-w-[220px]"
                  value={selectedCamera}
                  onChange={(e) => {
                    setSelectedCamera(e.target.value);
                    setSuggestion(null);
                    setApprovedZoneId(null);
                    if (pollRef.current) window.clearInterval(pollRef.current);
                    if (calibratingCameras.has(e.target.value)) {
                      pollRef.current = window.setInterval(() => pollSuggestion(e.target.value), 1500);
                      void pollSuggestion(e.target.value);
                    }
                  }}
                >
                  {cameras.map((c) => (
                    <option key={c.camera_id} value={c.camera_id}>
                      {c.name}{calibratingCameras.has(c.camera_id) ? ' (calibrating)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              {calibrating && (
                <Button variant="outline" onClick={skipAhead}>
                  <FastForward className="w-4 h-4 mr-1" /> Get Suggestion Now (skip ahead)
                </Button>
              )}
              {calibratingCameras.size > 1 && (
                <p className="text-[10px] text-[var(--text-2)] max-w-xs">
                  {calibratingCameras.size} cameras are calibrating right now — see the <b>Live Overview &amp; Adjacency</b> tab to watch all of them at once. This panel shows detail for one at a time.
                </p>
              )}
            </div>
          )}

          {calibrating && (
            <div className="border-t border-[var(--border)] pt-4">
              <div className="flex gap-6 text-sm">
                <div>
                  <span className="text-[var(--text-2)]">Elapsed: </span>
                  <span className="font-mono font-bold text-[var(--text)]">{elapsedSec}s</span>
                  <span className="text-[var(--text-2)]"> / {windowMinutes * 60}s window</span>
                </div>
                <div>
                  <span className="text-[var(--text-2)]">Observations logged: </span>
                  <span className="font-mono font-bold text-emerald-500">
                    {suggestion?.observation_count ?? 0}
                  </span>
                </div>
                <div>
                  <Badge variant={suggestion?.ready ? 'success' : 'default'}>
                    {suggestion?.ready ? 'suggestion ready' : 'accumulating...'}
                  </Badge>
                </div>
              </div>
              <p className="text-xs text-[var(--text-2)] mt-2">
                Observations only increase when the pipeline confirms a real detection on this
                camera during the window — point it at your demo fire/smoke source now.
              </p>
            </div>
          )}

          {suggestion?.polygon && suggestion.polygon.length > 0 && (
            <div className="border-t border-[var(--border)] pt-4 space-y-3">
              <h3 className="font-bold text-[var(--text)] flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Suggested Zone
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-[var(--text-2)] text-xs">Polygon points</div>
                  <div className="font-mono font-bold">{suggestion.polygon.length}</div>
                </div>
                <div>
                  <div className="text-[var(--text-2)] text-xs">Mean area</div>
                  <div className="font-mono font-bold">
                    {suggestion.envelope?.mean_area?.toFixed(0) ?? '—'} px²
                  </div>
                </div>
                <div>
                  <div className="text-[var(--text-2)] text-xs">Std area</div>
                  <div className="font-mono font-bold">
                    {suggestion.envelope?.std_area?.toFixed(0) ?? '—'} px²
                  </div>
                </div>
                <div>
                  <div className="text-[var(--text-2)] text-xs">Always-on</div>
                  <div className="font-mono font-bold">
                    {(suggestion.always_on ?? suggestion.envelope?.always_on) ? 'yes' : 'no'}
                  </div>
                </div>
              </div>
              {suggestion.notes && suggestion.notes.length > 0 && (
                <ul className="text-xs text-amber-500 list-disc list-inside">
                  {suggestion.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
              <div className="flex items-end gap-4">
                <div>
                  <label className="text-xs font-semibold text-[var(--text-2)] block mb-1">
                    Risk weight (0–1)
                  </label>
                  <input
                    type="number" min={0} max={1} step={0.05} value={riskWeight}
                    onChange={(e) => setRiskWeight(Number(e.target.value))}
                    className="border rounded px-3 py-2 bg-[var(--bg-2)] text-[var(--text)] w-28"
                  />
                </div>
                <Button onClick={approve} disabled={approving}>
                  {approving ? 'Approving…' : 'Approve Zone'}
                </Button>
              </div>
              {approvedZoneId && (
                <p className="text-sm text-emerald-500 font-semibold">
                  ✓ Zone <code>{approvedZoneId}</code> approved and written to the pipeline's zones table.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
