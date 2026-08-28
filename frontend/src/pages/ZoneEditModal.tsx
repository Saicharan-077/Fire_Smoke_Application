import { useMemo, useState } from 'react';
import { Modal } from '../components/Common/Modal';
import { Button } from '../components/Common/Button';
import { Badge } from '../components/Common/Badge';
import { useToast } from '../components/ui/Toast';
import {
  pipelineEditZone, type PipelineZone, type ZoneEditRequest, type ZoneEditChange,
} from '../services/pipelineApi';
import { AlertTriangle, Plus, X } from 'lucide-react';

/**
 * Human correction to an already-approved zone -- "ask the user for
 * approval" is implemented as this two-step flow: fill the form, then a
 * REQUIRED review step shows the exact before/after diff before anything is
 * actually sent. Nothing is applied on the first click; the backend
 * (zone_edit_routes.py) additionally requires a real reason string and
 * writes an audit log entry on every successful apply -- the "have a log
 * for that" half of the request. Access itself is gated by the caller
 * (CalibrationZoneData.tsx only renders the Edit button for
 * hasPermission(role, 'manage_cameras')), and independently enforced
 * server-side via require_operator -- verified live to 403 a viewer account.
 */

interface Props {
  zone: PipelineZone;
  availableCameras: Array<{ camera_id: string; name: string }>;
  isOpen: boolean;
  onClose: () => void;
  onApplied: () => void;
  /** Pre-fill for a suggested change (e.g. facility-map FOV-overlap adjacency) -- still requires the same review+reason+confirm flow, never applied without it. */
  prefill?: Partial<ZoneEditRequest>;
}

type FormState = {
  risk_weight: number;
  flammable_materials_nearby: boolean;
  designated_activity_allowed: string[];
  adjacent_camera_ids: string[];
  min_area: string; max_area: string; mean_area: string; std_area: string;
  always_on: boolean; area_sigma_tolerance: string;
};

function toForm(z: PipelineZone, prefill?: Partial<ZoneEditRequest>): FormState {
  return {
    risk_weight: prefill?.risk_weight ?? z.risk_weight,
    flammable_materials_nearby: prefill?.flammable_materials_nearby ?? z.flammable_materials_nearby,
    designated_activity_allowed: prefill?.designated_activity_allowed ?? [...z.designated_activity_allowed],
    adjacent_camera_ids: prefill?.adjacent_camera_ids ?? [...z.adjacent_camera_ids],
    min_area: String(prefill?.envelope?.min_area ?? z.envelope.min_area ?? ''),
    max_area: String(prefill?.envelope?.max_area ?? z.envelope.max_area ?? ''),
    mean_area: String(prefill?.envelope?.mean_area ?? z.envelope.mean_area ?? ''),
    std_area: String(prefill?.envelope?.std_area ?? z.envelope.std_area ?? ''),
    always_on: prefill?.envelope?.always_on ?? z.envelope.always_on,
    area_sigma_tolerance: String(prefill?.envelope?.area_sigma_tolerance ?? z.envelope.area_sigma_tolerance),
  };
}

export default function ZoneEditModal({ zone, availableCameras, isOpen, onClose, onApplied, prefill }: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => toForm(zone, prefill));
  const [reason, setReason] = useState(prefill ? 'Applying geometric FOV-overlap adjacency suggestion from the facility map.' : '');
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [addActivity, setAddActivity] = useState('');
  const [addAdjacent, setAddAdjacent] = useState('');
  const [applying, setApplying] = useState(false);

  const numOrUndef = (s: string): number | undefined => {
    const t = s.trim();
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  };

  const changes: ZoneEditChange[] = useMemo(() => {
    const c: ZoneEditChange[] = [];
    if (form.risk_weight !== zone.risk_weight) c.push({ field: 'risk_weight', before: zone.risk_weight, after: form.risk_weight });
    if (form.flammable_materials_nearby !== zone.flammable_materials_nearby)
      c.push({ field: 'flammable_materials_nearby', before: zone.flammable_materials_nearby, after: form.flammable_materials_nearby });
    if (JSON.stringify(form.designated_activity_allowed) !== JSON.stringify(zone.designated_activity_allowed))
      c.push({ field: 'designated_activity_allowed', before: zone.designated_activity_allowed, after: form.designated_activity_allowed });
    if (JSON.stringify(form.adjacent_camera_ids) !== JSON.stringify(zone.adjacent_camera_ids))
      c.push({ field: 'adjacent_camera_ids', before: zone.adjacent_camera_ids, after: form.adjacent_camera_ids });

    const envPairs: Array<[keyof FormState, keyof typeof zone.envelope]> = [
      ['min_area', 'min_area'], ['max_area', 'max_area'], ['mean_area', 'mean_area'], ['std_area', 'std_area'],
    ];
    for (const [fk, ek] of envPairs) {
      const newVal = numOrUndef(form[fk] as string);
      const oldVal = zone.envelope[ek] as number | null;
      if (newVal !== undefined && newVal !== oldVal) c.push({ field: `envelope.${ek}`, before: oldVal, after: newVal });
    }
    if (form.always_on !== zone.envelope.always_on)
      c.push({ field: 'envelope.always_on', before: zone.envelope.always_on, after: form.always_on });
    const newSigma = numOrUndef(form.area_sigma_tolerance);
    if (newSigma !== undefined && newSigma !== zone.envelope.area_sigma_tolerance)
      c.push({ field: 'envelope.area_sigma_tolerance', before: zone.envelope.area_sigma_tolerance, after: newSigma });
    return c;
  }, [form, zone]);

  const buildPayload = (): ZoneEditRequest => {
    const body: ZoneEditRequest = { reason: reason.trim() };
    for (const c of changes) {
      if (c.field === 'risk_weight') body.risk_weight = form.risk_weight;
      if (c.field === 'flammable_materials_nearby') body.flammable_materials_nearby = form.flammable_materials_nearby;
      if (c.field === 'designated_activity_allowed') body.designated_activity_allowed = form.designated_activity_allowed;
      if (c.field === 'adjacent_camera_ids') body.adjacent_camera_ids = form.adjacent_camera_ids;
      if (c.field.startsWith('envelope.')) {
        body.envelope = body.envelope ?? {};
        (body.envelope as any)[c.field.slice('envelope.'.length)] =
          c.field === 'envelope.always_on' ? form.always_on : numOrUndef((form as any)[c.field.slice('envelope.'.length)]);
      }
    }
    return body;
  };

  const apply = async () => {
    if (reason.trim().length < 8) { toast('Reason must be at least 8 characters.', 'error'); return; }
    setApplying(true);
    try {
      const result = await pipelineEditZone(zone.camera_id, buildPayload());
      toast(`Zone updated — ${result.changes.length} field(s) changed, logged as ${result.edited_by}.`, 'success');
      onApplied();
      onClose();
    } catch (e: any) {
      toast(e.message || 'Zone edit failed.', 'error');
    } finally {
      setApplying(false);
    }
  };

  const nameFor = (id: string) => availableCameras.find((c) => c.camera_id === id)?.name ?? id.slice(0, 8);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={step === 'form' ? `Edit Zone — ${zone.name || zone.zone_id}` : 'Review Changes Before Applying'}
      footer={step === 'form' ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => (changes.length === 0 ? toast('No fields changed.', 'info') : setStep('review'))}>
            Review Changes ({changes.length})
          </Button>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setStep('form')} disabled={applying}>Back</Button>
          <Button onClick={() => void apply()} disabled={applying}>
            {applying ? 'Applying…' : 'Confirm & Apply'}
          </Button>
        </div>
      )}
    >
      {step === 'form' ? (
        <div className="space-y-4 text-sm">
          <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            This changes real data the Context Engine uses for severity scoring. Nothing is applied until you review and confirm.
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-2)] block mb-1">Risk weight (0–1)</label>
            <input type="number" min={0} max={1} step={0.05} value={form.risk_weight}
              onChange={(e) => setForm({ ...form, risk_weight: Number(e.target.value) })}
              className="border rounded px-3 py-2 bg-[var(--bg-2)] text-[var(--text)] w-32" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(['min_area', 'max_area', 'mean_area', 'std_area'] as const).map((f) => (
              <div key={f}>
                <label className="text-xs font-semibold text-[var(--text-2)] block mb-1">envelope.{f} (px²)</label>
                <input type="number" value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                  className="border rounded px-3 py-2 bg-[var(--bg-2)] text-[var(--text)] w-full" />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <label className="text-xs font-semibold text-[var(--text-2)] flex items-center gap-1.5">
              <input type="checkbox" checked={form.always_on} onChange={(e) => setForm({ ...form, always_on: e.target.checked })} />
              always-on source
            </label>
            <label className="text-xs font-semibold text-[var(--text-2)] flex items-center gap-1.5">
              <input type="checkbox" checked={form.flammable_materials_nearby} onChange={(e) => setForm({ ...form, flammable_materials_nearby: e.target.checked })} />
              flammables nearby
            </label>
            <div>
              <label className="text-xs font-semibold text-[var(--text-2)] block mb-1">sigma tolerance</label>
              <input type="number" step={0.1} min={0.1} value={form.area_sigma_tolerance}
                onChange={(e) => setForm({ ...form, area_sigma_tolerance: e.target.value })}
                className="border rounded px-2 py-1 bg-[var(--bg-2)] text-[var(--text)] w-20 text-xs" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-2)] block mb-1">Designated activity allowed</label>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {form.designated_activity_allowed.map((a) => (
                <Badge key={a} variant="default" className="text-[9px] flex items-center gap-1">
                  {a}
                  <button onClick={() => setForm({ ...form, designated_activity_allowed: form.designated_activity_allowed.filter((x) => x !== a) })}><X size={9} /></button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input value={addActivity} onChange={(e) => setAddActivity(e.target.value)} placeholder="e.g. bonfire, welding"
                className="border rounded px-2 py-1 bg-[var(--bg-2)] text-[var(--text)] text-xs flex-1" />
              <Button variant="outline" size="sm" onClick={() => {
                if (addActivity.trim()) { setForm({ ...form, designated_activity_allowed: [...form.designated_activity_allowed, addActivity.trim()] }); setAddActivity(''); }
              }}><Plus size={12} /></Button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-2)] block mb-1">Adjacent cameras (confirmed)</label>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {form.adjacent_camera_ids.map((id) => (
                <Badge key={id} variant="default" className="text-[9px] flex items-center gap-1">
                  {nameFor(id)}
                  <button onClick={() => setForm({ ...form, adjacent_camera_ids: form.adjacent_camera_ids.filter((x) => x !== id) })}><X size={9} /></button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-1.5">
              <select value={addAdjacent} onChange={(e) => setAddAdjacent(e.target.value)}
                className="border rounded px-2 py-1 bg-[var(--bg-2)] text-[var(--text)] text-xs flex-1">
                <option value="">Select a camera…</option>
                {availableCameras.filter((c) => c.camera_id !== zone.camera_id && !form.adjacent_camera_ids.includes(c.camera_id))
                  .map((c) => <option key={c.camera_id} value={c.camera_id}>{c.name}</option>)}
              </select>
              <Button variant="outline" size="sm" onClick={() => {
                if (addAdjacent) { setForm({ ...form, adjacent_camera_ids: [...form.adjacent_camera_ids, addAdjacent] }); setAddAdjacent(''); }
              }}><Plus size={12} /></Button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-2)] block mb-1">Reason for this correction (required)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder="e.g. calibration ran during an unusual welding job and overshot the normal envelope"
              className="border rounded px-3 py-2 bg-[var(--bg-2)] text-[var(--text)] w-full text-xs" />
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-[var(--text-2)]">
            {changes.length} field{changes.length === 1 ? '' : 's'} will change on <b>{zone.name || zone.zone_id}</b>. This is logged with your account and the reason below.
          </p>
          <div className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
            {changes.map((c) => (
              <div key={c.field} className="p-2.5 text-xs flex items-center justify-between gap-2">
                <span className="font-mono font-bold text-[var(--text)]">{c.field}</span>
                <span className="text-[var(--text-3)] font-mono">{JSON.stringify(c.before)}</span>
                <span className="text-[var(--text-3)]">→</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold">{JSON.stringify(c.after)}</span>
              </div>
            ))}
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs">
            <span className="text-[var(--text-3)] block mb-1">Reason</span>
            {reason}
          </div>
        </div>
      )}
    </Modal>
  );
}
