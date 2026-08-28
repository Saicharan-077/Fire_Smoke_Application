import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '../components/Common/Card';
import { Badge } from '../components/Common/Badge';
import {
  pipelineListCameras, pipelineCalibrateSuggestion, pipelineListZones,
  type PipelineCamera, type PipelineCalibrateSuggestion, type PipelineZone,
} from '../services/pipelineApi';
import { Radio, Link2, CheckCircle2, HelpCircle } from 'lucide-react';

/**
 * Real-time multi-camera calibration + adjacency view.
 *
 * There is no aggregate "all cameras' calibration progress" endpoint on the
 * pipeline (confirmed by reading sentinel_pipeline/api/app.py directly) --
 * this fans out per camera every poll tick: one GET /v1/cameras (for
 * calibration_state across everyone), then one GET .../calibrate/suggestion
 * per camera currently mid-calibration (for live observation counts and
 * adjacency_candidates), plus GET /v1/zones (for APPROVED adjacency).
 *
 * Adjacency has two distinct sources, drawn differently, never conflated:
 *  - CONFIRMED (solid line): an approved Zone's adjacent_camera_ids field --
 *    a human decision made at zone-approval time.
 *  - CANDIDATE (dashed line): CalibrationManager._adjacency_candidates() --
 *    behavioural correlation (>=50% of one camera's triggers co-occur with
 *    another's within 3s) computed automatically DURING calibration. This is
 *    a suggestion, not a fact -- there is no "geometric seed" (site map)
 *    input in this codebase, so candidate edges can be wrong and are never
 *    auto-promoted to confirmed.
 */

const POLL_MS = 3000;

export default function CalibrationLiveOverview() {
  const [cameras, setCameras] = useState<PipelineCamera[]>([]);
  const [suggestions, setSuggestions] = useState<Map<string, PipelineCalibrateSuggestion>>(new Map());
  const [zones, setZones] = useState<PipelineZone[]>([]);
  const [lastPoll, setLastPoll] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (pollingRef.current) return; // don't overlap if a fetch is slow
      pollingRef.current = true;
      try {
        const [cams, zoneList] = await Promise.all([pipelineListCameras(), pipelineListZones()]);
        if (cancelled) return;
        setCameras(cams);
        setZones(zoneList);
        setError(null);

        const calibrating = cams.filter((c) => c.calibration_state === 'calibrating');
        const results = await Promise.allSettled(
          calibrating.map((c) => pipelineCalibrateSuggestion(c.camera_id)),
        );
        if (cancelled) return;
        setSuggestions((prev) => {
          const next = new Map(prev);
          calibrating.forEach((c, i) => {
            const r = results[i];
            if (r.status === 'fulfilled') next.set(c.camera_id, r.value);
          });
          // Drop entries for cameras no longer calibrating (approved or reset)
          for (const id of Array.from(next.keys())) {
            if (!calibrating.some((c) => c.camera_id === id)) next.delete(id);
          }
          return next;
        });
        setLastPoll(Date.now());
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Could not reach the detection pipeline');
      } finally {
        pollingRef.current = false;
      }
    };

    void poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const stateColor: Record<string, string> = {
    uncalibrated: 'text-[var(--text-3)] bg-[var(--surface-2)] border-[var(--border)]',
    calibrating: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
    calibrated: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
  };

  // --- adjacency graph geometry ---------------------------------------
  const N = cameras.length;
  const size = 420;
  const cx = size / 2, cy = size / 2, r = size / 2 - 60;
  const pos = new Map<string, { x: number; y: number }>();
  cameras.forEach((c, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, N) - Math.PI / 2;
    pos.set(c.camera_id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  });

  const confirmedEdges: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const z of zones) {
    for (const adj of z.adjacent_camera_ids) {
      const key = [z.camera_id, adj].sort().join('|');
      if (seen.has(key) || !pos.has(z.camera_id) || !pos.has(adj)) continue;
      seen.add(key);
      confirmedEdges.push([z.camera_id, adj]);
    }
  }

  const candidateEdges: Array<[string, string]> = [];
  const seenC = new Set<string>();
  suggestions.forEach((s, camId) => {
    (s.adjacency_candidates ?? []).forEach((other) => {
      const key = [camId, other].sort().join('|');
      if (seenC.has(key) || seen.has(key) || !pos.has(camId) || !pos.has(other)) return;
      seenC.add(key);
      candidateEdges.push([camId, other]);
    });
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-[var(--text-2)] font-semibold">
          Polling all registered cameras every {POLL_MS / 1000}s.
          {lastPoll && <span className="ml-2 font-mono text-[10px]">last update {new Date(lastPoll).toLocaleTimeString()}</span>}
        </p>
        {error && <Badge variant="danger">{error}</Badge>}
      </div>

      {cameras.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-[var(--text-3)] text-sm font-semibold">
          No cameras registered on the pipeline yet.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Camera grid */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {cameras.map((c) => {
              const sug = suggestions.get(c.camera_id);
              return (
                <Card key={c.camera_id} className="bg-[var(--surface)] border-[var(--border)]">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-xs truncate" title={c.name}>{c.name}</span>
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border shrink-0 ${stateColor[c.calibration_state] ?? stateColor.uncalibrated}`}>
                        {c.calibration_state}
                      </span>
                    </div>
                    <p className="text-[9px] font-mono text-[var(--text-3)] truncate" title={c.camera_id}>{c.camera_id}</p>

                    {c.calibration_state === 'calibrating' && sug && (
                      <div className="pt-1 space-y-1 border-t border-[var(--border)] mt-1">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-[var(--text-2)]">Observations</span>
                          <span className="font-mono font-bold text-emerald-500">{sug.observation_count}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-[var(--text-2)]">Elapsed</span>
                          <span className="font-mono font-bold">{sug.elapsed_hours.toFixed(3)}h</span>
                        </div>
                        <Badge variant={sug.ready ? 'success' : 'default'} className="text-[9px]">
                          {sug.ready ? 'suggestion ready' : sug.detail ?? 'accumulating...'}
                        </Badge>
                        {(sug.adjacency_candidates?.length ?? 0) > 0 && (
                          <div className="flex items-center gap-1 text-[9px] text-sky-500 font-semibold pt-0.5">
                            <Link2 size={10} /> candidate adjacency: {sug.adjacency_candidates!.length}
                          </div>
                        )}
                      </div>
                    )}

                    {c.calibration_state === 'calibrated' && (
                      <div className="pt-1 flex items-center justify-between text-[10px] border-t border-[var(--border)] mt-1">
                        <span className="flex items-center gap-1 text-emerald-500 font-semibold"><CheckCircle2 size={11} /> zone approved</span>
                        <span className="font-mono font-bold">risk {c.risk_weight?.toFixed(2) ?? '—'}</span>
                      </div>
                    )}

                    {c.calibration_state === 'uncalibrated' && (
                      <div className="pt-1 flex items-center gap-1 text-[10px] text-[var(--text-3)] border-t border-[var(--border)] mt-1">
                        <HelpCircle size={11} /> not started — safe default (every detection = breach)
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Adjacency graph */}
          <Card className="bg-[var(--surface)] border-[var(--border)]">
            <CardContent className="p-4 space-y-2">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-2)] flex items-center gap-1.5">
                <Radio size={12} className="text-sky-500" /> Camera Adjacency
              </h3>
              <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-auto">
                {confirmedEdges.map(([a, b], i) => {
                  const pa = pos.get(a)!, pb = pos.get(b)!;
                  return <line key={`c${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="var(--text-2)" strokeWidth={1.5} opacity={0.6} />;
                })}
                {candidateEdges.map(([a, b], i) => {
                  const pa = pos.get(a)!, pb = pos.get(b)!;
                  return <line key={`d${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#38bdf8" strokeWidth={1.25} strokeDasharray="4 3" opacity={0.8} />;
                })}
                {cameras.map((c) => {
                  const p = pos.get(c.camera_id)!;
                  const fill = c.calibration_state === 'calibrated' ? '#10b981'
                    : c.calibration_state === 'calibrating' ? '#f59e0b' : '#94a3b8';
                  return (
                    <g key={c.camera_id}>
                      <circle cx={p.x} cy={p.y} r={9} fill={fill} stroke="var(--surface)" strokeWidth={2} />
                      <text x={p.x} y={p.y + 20} textAnchor="middle" fontSize={9} fill="var(--text-2)" fontWeight={700}>
                        {c.name.length > 14 ? c.name.slice(0, 13) + '…' : c.name}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <div className="text-[9px] text-[var(--text-3)] space-y-1 pt-1 border-t border-[var(--border)]">
                <p><span className="inline-block w-3 h-0.5 bg-[var(--text-2)] align-middle mr-1" /> confirmed — approved zone's <code>adjacent_camera_ids</code></p>
                <p><span className="inline-block w-3 h-0.5 bg-sky-400 align-middle mr-1" style={{ borderTop: '1.5px dashed #38bdf8' }} /> candidate — behavioural trigger correlation during calibration, not yet approved</p>
                <p className="pt-1">No geometric (site-map) adjacency in this build — see TODO_ACTION_ITEMS.md A2. Candidates are a suggestion a human must confirm at zone-approval time, never auto-applied.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
