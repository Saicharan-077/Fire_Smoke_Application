import React, { useEffect, useRef, useState } from 'react';
import { Flame, Cloud, RefreshCw, Layers } from 'lucide-react';
import { getAnalyticsHeatmap } from '../../services/api';

interface HeatmapPoint {
  id?: string;
  x: number;
  y: number;
  weight: number;
  type: string;
}

interface DetectionHeatmapProps {
  cameraId?: string;
  className?: string;
}

export const DetectionHeatmap: React.FC<DetectionHeatmapProps> = ({ cameraId, className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'fire' | 'smoke'>('all');
  const [loading, setLoading] = useState<boolean>(true);

  const fetchHeatmap = async () => {
    setLoading(true);
    try {
      const res = await getAnalyticsHeatmap({ camera_id: cameraId });
      setPoints(res.heatmap_data || []);
    } catch (e) {
      console.error('Heatmap fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHeatmap();
  }, [cameraId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas grid background
    ctx.clearRect(0, 0, width, height);

    // Draw CCTV zone grid overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const step = 40;
    for (let x = 0; x < width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const filteredPoints = points.filter(
      (p) => filterType === 'all' || p.type.toLowerCase() === filterType
    );

    // Draw radial Gaussian heat gradients
    filteredPoints.forEach((p) => {
      const px = p.x * width;
      const py = p.y * height;
      const radius = 35 + p.weight * 25;

      const grad = ctx.createRadialGradient(px, py, 2, px, py, radius);
      if (p.type.toLowerCase() === 'fire') {
        grad.addColorStop(0, `rgba(239, 68, 68, ${0.7 * p.weight})`);
        grad.addColorStop(0.5, `rgba(245, 158, 11, ${0.4 * p.weight})`);
        grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      } else {
        grad.addColorStop(0, `rgba(168, 85, 247, ${0.7 * p.weight})`);
        grad.addColorStop(0.5, `rgba(59, 130, 246, ${0.4 * p.weight})`);
        grad.addColorStop(1, 'rgba(168, 85, 247, 0)');
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [points, filterType]);

  return (
    <div className={`bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl text-slate-100 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-100 text-sm tracking-wide">
              Spatial Detection Heatmap
            </h3>
            <p className="text-xs text-slate-400">
              Aggregated threat distribution across monitoring zones
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-800/80 p-1 rounded-lg border border-slate-700/80 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1 rounded-md transition-all font-medium ${
                filterType === 'all'
                  ? 'bg-orange-500 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterType('fire')}
              className={`flex items-center gap-1 px-3 py-1 rounded-md transition-all font-medium ${
                filterType === 'fire'
                  ? 'bg-red-600 text-white shadow'
                  : 'text-slate-400 hover:text-red-400'
              }`}
            >
              <Flame className="w-3 h-3" /> Fire
            </button>
            <button
              onClick={() => setFilterType('smoke')}
              className={`flex items-center gap-1 px-3 py-1 rounded-md transition-all font-medium ${
                filterType === 'smoke'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-slate-400 hover:text-purple-400'
              }`}
            >
              <Cloud className="w-3 h-3" /> Smoke
            </button>
          </div>

          <button
            onClick={fetchHeatmap}
            disabled={loading}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors"
            title="Refresh Heatmap"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-orange-400' : ''}`} />
          </button>
        </div>
      </div>

      <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-950/80 flex items-center justify-center">
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          className="w-full h-auto max-h-[360px] object-contain"
        />

        {loading && (
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center text-xs text-orange-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading Heatmap...
          </div>
        )}

        <div className="absolute bottom-3 left-3 bg-slate-900/90 border border-slate-700/80 backdrop-blur px-3 py-1.5 rounded-lg flex items-center gap-3 text-xs text-slate-300 shadow-md">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span> High Density
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Medium Density
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span> Smoke Pattern
          </div>
        </div>
      </div>
    </div>
  );
};
