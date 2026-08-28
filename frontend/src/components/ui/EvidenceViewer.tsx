import { X } from 'lucide-react';
import { evidenceUrl } from '../../services/api';

interface Props { path: string | null; onClose: () => void; }

const EvidenceViewer = ({ path, onClose }: Props) => {
  const url = evidenceUrl(path);
  if (!url) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
        <button onClick={onClose}
          className="absolute -top-10 right-0 text-slate-400 hover:text-white transition-colors">
          <X size={22} />
        </button>
        <img src={url} alt="Detection evidence" className="w-full rounded-2xl border border-white/10 shadow-2xl" />
      </div>
    </div>
  );
};

export default EvidenceViewer;
