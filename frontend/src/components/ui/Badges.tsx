import { Flame, Wind, CheckCircle2, AlertCircle } from 'lucide-react';

export const TypeBadge = ({ type }: { type: 'fire' | 'smoke' }) =>
  type === 'fire'
    ? <span className="badge-fire"><Flame size={10} />Fire</span>
    : <span className="badge-smoke"><Wind size={10} />Smoke</span>;

export const StatusBadge = ({ status }: { status: string }) => {
  if (status === 'active')       return <span className="badge-active"><AlertCircle size={10} />Active</span>;
  return <span className="badge-resolved"><CheckCircle2 size={10} />Resolved</span>;
};

export const ConfidencePill = ({ value }: { value: number }) => (
  <span className={`text-xs font-bold px-2 py-0.5 rounded-lg
    ${value >= 0.8 ? 'bg-red-500/20 text-red-400'
    : value >= 0.5 ? 'bg-orange-500/20 text-orange-400'
    : 'bg-slate-500/20 text-slate-400'}`}>
    {(value * 100).toFixed(1)}%
  </span>
);
