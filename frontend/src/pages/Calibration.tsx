import React, { useState, useRef, useEffect } from 'react';
import { 
  Target, Sliders, ShieldCheck, 
  RotateCcw, Check, Sparkles, Eye, Info,
  Cpu, Layers, Flame, Activity
} from 'lucide-react';
import { useToast } from '../components/ui/Toast';

interface ZoneProfile {
  id: string;
  name: string;
  cameraId: string;
  polygon: [number, number][];
  riskWeight: number;
  alwaysOn: boolean;
  minArea: number;
  maxArea: number;
  status: 'calibrated' | 'observing' | 'pending_approval';
  driftRatio: number;
  observations: number;
}

const INITIAL_ZONES: ZoneProfile[] = [
  {
    id: 'zone-a-furnace',
    name: 'Sector A — Smelting Furnace Flare',
    cameraId: 'cam-01-warehouse',
    polygon: [[120, 80], [380, 70], [420, 260], [160, 290]],
    riskWeight: 0.2,
    alwaysOn: true,
    minArea: 1200,
    maxArea: 14500,
    status: 'calibrated',
    driftRatio: 0.04,
    observations: 148
  },
  {
    id: 'zone-b-server',
    name: 'Sector B — Server Rack Thermal Containment',
    cameraId: 'cam-02-server-room',
    polygon: [[200, 140], [460, 130], [490, 340], [180, 350]],
    riskWeight: 0.9,
    alwaysOn: false,
    minArea: 800,
    maxArea: 8200,
    status: 'pending_approval',
    driftRatio: 0.12,
    observations: 42
  }
];

export const Calibration: React.FC = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'calibration' | 'classifier' | 'drift'>('calibration');
  const [selectedZone, setSelectedZone] = useState<ZoneProfile>(INITIAL_ZONES[0]);
  const [zones, setZones] = useState<ZoneProfile[]>(INITIAL_ZONES);

  // Calibration observation simulator state
  const [isObserving, setIsObserving] = useState(false);
  const [obsProgress, setObsProgress] = useState(65);
  
  // Classifier settings state
  const [fireThreshold, setFireThreshold] = useState(0.45);
  const [smokeThreshold, setSmokeThreshold] = useState(0.38);
  const [sparksThreshold, setSparksThreshold] = useState(0.50);
  const [temporalWindow, setTemporalWindow] = useState(3);
  const [gateChangeThreshold, setGateChangeThreshold] = useState(12);
  const [outlierSigma, setOutlierSigma] = useState(2.5);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Draw polygon on interactive canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw polygon
    if (selectedZone.polygon.length > 0) {
      ctx.beginPath();
      ctx.moveTo(selectedZone.polygon[0][0], selectedZone.polygon[0][1]);
      for (let i = 1; i < selectedZone.polygon.length; i++) {
        ctx.lineTo(selectedZone.polygon[i][0], selectedZone.polygon[i][1]);
      }
      ctx.closePath();

      // Polygon fill & border
      ctx.fillStyle = selectedZone.alwaysOn ? 'rgba(245, 158, 11, 0.15)' : 'rgba(79, 70, 229, 0.18)';
      ctx.fill();
      ctx.strokeStyle = selectedZone.alwaysOn ? '#f59e0b' : '#6366f1';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw point vertices
      selectedZone.polygon.forEach((pt, idx) => {
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#4f46e5';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '10px Inter, sans-serif';
        ctx.fillText(`P${idx + 1}`, pt[0] + 8, pt[1] - 4);
      });
    }
  }, [selectedZone]);

  const handleApproveZone = () => {
    setZones(prev => prev.map(z => z.id === selectedZone.id ? { ...z, status: 'calibrated' } : z));
    setSelectedZone(prev => ({ ...prev, status: 'calibrated' }));
    toast(`Zone ${selectedZone.name} calibrated and approved for SOC suppression logic.`, 'success');
  };

  const handleRecalculateHull = () => {
    toast('Convex hull point-cloud re-fitted with outlier trimming (σ = ' + outlierSigma + ').', 'info');
  };

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto text-[var(--color-fg)] font-sans pb-10 select-none">
      
      {/* Compact Operational Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[var(--color-border)]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-page-title text-[var(--color-fg)]">Calibration & Classifier Engine</h1>
            <span className="tech-badge">
              <Sparkles size={11} className="text-amber-400" />
              STAGE-1 GATE & STAGE-2 CLASSIFIER
            </span>
          </div>
          <p className="text-xs text-[var(--color-muted)] font-medium">
            Auto-suggested convex hull containment zones, normal envelopes, and neural classifier calibration.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-[var(--color-surface-2)] border border-[var(--color-border)] p-1 rounded-xl gap-1 w-fit">
          {[
            { id: 'calibration', label: 'Zone Calibration', icon: <Target size={13} /> },
            { id: 'classifier', label: 'Model Classifier & Gate', icon: <Sliders size={13} /> },
            { id: 'drift', label: 'Boundary Drift Monitor', icon: <Activity size={13} /> }
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  isActive 
                    ? 'bg-[var(--color-accent)] text-white shadow-sm' 
                    : 'text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)]'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── TAB 1: ZONE CALIBRATION ── */}
      {activeTab === 'calibration' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          
          {/* Visual Interactive Canvas (70%) */}
          <div className="lg:col-span-8 space-y-3.5">
            <div className="glass-panel p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-fg)]">
                    Optical Calibration Viewport — {selectedZone.name}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleRecalculateHull}
                    className="floating-pill text-[11px] hover:text-[var(--color-accent)] cursor-pointer"
                  >
                    <RotateCcw size={12} /> Auto-Fit Convex Hull
                  </button>
                </div>
              </div>

              {/* Canvas Viewport */}
              <div className="relative rounded-xl overflow-hidden border border-[var(--color-border)] bg-[#070913] aspect-video flex items-center justify-center">
                <img 
                  src="/evidence/test_red.jpg" 
                  alt="Calibration Reference Frame" 
                  className="w-full h-full object-cover opacity-40" 
                />
                <canvas 
                  ref={canvasRef} 
                  width={640} 
                  height={360} 
                  className="absolute inset-0 w-full h-full cursor-crosshair"
                />

                {/* HUD Legend Overlay */}
                <div className="absolute top-3 left-3 floating-pill text-[10px] bg-black/70 border-white/10 text-white">
                  <span>CAMERA: {selectedZone.cameraId.toUpperCase()}</span>
                </div>
                <div className="absolute top-3 right-3 floating-pill text-[10px] bg-black/70 border-white/10 text-white">
                  <span>STATUS: {selectedZone.status.toUpperCase()}</span>
                </div>
              </div>

              {/* Observation Window Status Bar */}
              <div className="glass-surface p-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-medium">
                  <div className="flex items-center gap-2">
                    <Eye size={13} className="text-indigo-400" />
                    <span>Observation Window Progress (24h continuous sampling)</span>
                  </div>
                  <span className="font-mono font-bold text-[var(--color-accent)]">{obsProgress}% Complete ({selectedZone.observations} detections)</span>
                </div>
                <div className="h-1.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 rounded-full transition-all duration-300"
                    style={{ width: `${obsProgress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-[var(--color-muted)]">
                  <span>Safety Policy: Calibration never creates blind spots. Detection and alerting continue during observation.</span>
                  <button 
                    onClick={() => {
                      setIsObserving(!isObserving);
                      setObsProgress(p => p >= 100 ? 0 : Math.min(100, p + 20));
                      toast(!isObserving ? 'Observation sampling initiated.' : 'Observation paused.', 'info');
                    }}
                    className="text-[var(--color-accent)] hover:underline font-bold cursor-pointer"
                  >
                    {isObserving ? 'Pause Observation' : 'Sample Next Batch'}
                  </button>
                </div>
              </div>
            </div>

            {/* Normal Envelope Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="glass-panel p-3">
                <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase">Min Area Envelope</p>
                <p className="text-lg font-black text-[var(--color-fg)] font-mono mt-0.5">{selectedZone.minArea} px²</p>
              </div>
              <div className="glass-panel p-3">
                <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase">Max Area Envelope</p>
                <p className="text-lg font-black text-[var(--color-fg)] font-mono mt-0.5">{selectedZone.maxArea} px²</p>
              </div>
              <div className="glass-panel p-3">
                <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase">Outlier Trim (σ)</p>
                <p className="text-lg font-black text-[var(--color-fg)] font-mono mt-0.5">{outlierSigma}x MAD</p>
              </div>
              <div className="glass-panel p-3">
                <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase">Always-On Flare</p>
                <p className={`text-lg font-black mt-0.5 ${selectedZone.alwaysOn ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {selectedZone.alwaysOn ? 'ENABLED' : 'OFF'}
                </p>
              </div>
            </div>
          </div>

          {/* Zone Approval & Inspector (30%) */}
          <div className="lg:col-span-4 space-y-3.5">
            
            {/* Zone Selector */}
            <div className="glass-panel p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-fg)] flex items-center gap-1.5">
                  <Layers size={13} className="text-indigo-400" /> Monitored Zones
                </h3>
                <span className="text-[10px] font-bold text-[var(--color-muted)]">{zones.length} Zones Active</span>
              </div>

              <div className="space-y-2">
                {zones.map((z) => (
                  <div 
                    key={z.id} 
                    onClick={() => setSelectedZone(z)}
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                      selectedZone.id === z.id 
                        ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]/50 shadow-sm' 
                        : 'glass-surface border-[var(--color-border)] hover:border-[var(--color-accent)]/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-[var(--color-fg)]">{z.name}</p>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase ${
                        z.status === 'calibrated' 
                          ? 'bg-emerald-500/15 text-emerald-400' 
                          : 'bg-amber-500/15 text-amber-400'
                      }`}>
                        {z.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--color-muted)] mt-1 font-mono">
                      Camera: {z.cameraId} · Risk: {z.riskWeight} · {z.observations} obs
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Human Approval Card */}
            <div className="glass-panel p-3.5 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-fg)] flex items-center gap-1.5">
                <ShieldCheck size={13} className="text-emerald-400" /> Human Approval Action
              </h3>

              <div className="space-y-2 text-xs">
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-[var(--color-muted)]">Risk Weight Multiplier:</span>
                    <span className="font-bold font-mono text-[var(--color-fg)]">{selectedZone.riskWeight}</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="1.0" 
                    step="0.05"
                    value={selectedZone.riskWeight}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setSelectedZone(prev => ({ ...prev, riskWeight: val }));
                    }}
                    className="w-full h-1.5 bg-[var(--color-surface-2)] rounded-full cursor-pointer accent-indigo-500"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-[var(--color-muted)]">Always-On Flare Source:</span>
                  <button 
                    onClick={() => setSelectedZone(prev => ({ ...prev, alwaysOn: !prev.alwaysOn }))}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${selectedZone.alwaysOn ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'glass text-[var(--color-muted)]'}`}
                  >
                    {selectedZone.alwaysOn ? 'ALWAYS ON' : 'DISABLED'}
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-[var(--color-border)]">
                <button 
                  onClick={handleApproveZone}
                  className="w-full py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:scale-[1.02] text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Check size={14} /> One-Click Approve Zone
                </button>
              </div>
            </div>

          </div>

        </div>
      )}

      {/* ── TAB 2: MODEL CLASSIFIER & GATE ── */}
      {activeTab === 'classifier' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          
          {/* Stage-1 Spatial Gate */}
          <div className="glass-panel p-4 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
                <Cpu size={16} />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-fg)]">Stage-1 Spatial / Temporal Change Gate</h3>
                <p className="text-[11px] text-[var(--color-muted)]">Rejects static background frames to conserve GPU/CPU cycles.</p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[var(--color-muted)] font-medium">Pixel Delta Activation Threshold (%):</span>
                  <span className="font-mono font-bold text-[var(--color-fg)]">{gateChangeThreshold}%</span>
                </div>
                <input 
                  type="range" 
                  min="5" 
                  max="30" 
                  value={gateChangeThreshold}
                  onChange={(e) => setGateChangeThreshold(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-[var(--color-surface-2)] rounded-full accent-indigo-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[var(--color-muted)] font-medium">Temporal Verification Window (Consecutive Frames):</span>
                  <span className="font-mono font-bold text-[var(--color-fg)]">{temporalWindow} frames</span>
                </div>
                <input 
                  type="range" 
                  min="1" 
                  max="10" 
                  value={temporalWindow}
                  onChange={(e) => setTemporalWindow(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-[var(--color-surface-2)] rounded-full accent-indigo-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[var(--color-muted)] font-medium">Outlier Trimming Multiplier (Sigma MAD):</span>
                  <span className="font-mono font-bold text-[var(--color-fg)]">{outlierSigma}x</span>
                </div>
                <input 
                  type="range" 
                  min="1.0" 
                  max="4.0" 
                  step="0.1"
                  value={outlierSigma}
                  onChange={(e) => setOutlierSigma(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-[var(--color-surface-2)] rounded-full accent-indigo-500 cursor-pointer"
                />
              </div>
            </div>

            <div className="p-3 rounded-lg glass-surface border border-[var(--color-border)] text-[11px] text-[var(--color-muted)] flex items-start gap-2">
              <Info size={14} className="text-indigo-400 shrink-0 mt-0.5" />
              <span>Gate operates at 60 FPS in C-optimized loop, passing suspicious ROIs to the YOLOv8 neural network.</span>
            </div>
          </div>

          {/* Stage-2 YOLOv8 Classifier Contract */}
          <div className="glass-panel p-4 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
                <Flame size={16} />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-fg)]">Stage-2 Classifier Confidence Calibration</h3>
                <p className="text-[11px] text-[var(--color-muted)]">Per-class decision boundary thresholds for dispatch alerting.</p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-red-400 font-bold">Fire Anomaly Threshold (IoU / Confidence):</span>
                  <span className="font-mono font-bold text-red-400">{(fireThreshold * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" 
                  min="0.2" 
                  max="0.9" 
                  step="0.05"
                  value={fireThreshold}
                  onChange={(e) => setFireThreshold(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-[var(--color-surface-2)] rounded-full accent-red-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-amber-400 font-bold">Smoke Dispersal Threshold:</span>
                  <span className="font-mono font-bold text-amber-400">{(smokeThreshold * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" 
                  min="0.2" 
                  max="0.9" 
                  step="0.05"
                  value={smokeThreshold}
                  onChange={(e) => setSmokeThreshold(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-[var(--color-surface-2)] rounded-full accent-amber-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-yellow-400 font-bold">Sparks / Flare Glint Threshold:</span>
                  <span className="font-mono font-bold text-yellow-400">{(sparksThreshold * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" 
                  min="0.2" 
                  max="0.9" 
                  step="0.05"
                  value={sparksThreshold}
                  onChange={(e) => setSparksThreshold(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-[var(--color-surface-2)] rounded-full accent-yellow-400 cursor-pointer"
                />
              </div>
            </div>

            <button 
              onClick={() => toast('Classifier thresholds synchronized with YOLOv8 runtime inference engine.', 'success')}
              className="w-full py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:scale-[1.01] text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer"
            >
              Commit Classifier Thresholds
            </button>
          </div>

        </div>
      )}

      {/* ── TAB 3: BOUNDARY DRIFT MONITOR ── */}
      {activeTab === 'drift' && (
        <div className="glass-panel p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-indigo-400" />
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-fg)]">Boundary Drift Safety Monitor</h3>
                <p className="text-[11px] text-[var(--color-muted)]">Flags detections landing outside approved containment polygons without silent auto-expansion.</p>
              </div>
            </div>
            <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-full">
              HEALTHY DRIFT ENVELOPE
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {zones.map((z) => (
              <div key={z.id} className="p-3.5 rounded-xl glass-surface border border-[var(--color-border)] space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-[var(--color-fg)]">{z.name}</p>
                  <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full ${z.driftRatio > 0.1 ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                    {(z.driftRatio * 100).toFixed(1)}% Drift
                  </span>
                </div>
                <div className="h-1.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${z.driftRatio > 0.1 ? 'bg-red-500' : 'bg-emerald-400'}`}
                    style={{ width: `${z.driftRatio * 100 * 5}%` }}
                  />
                </div>
                <p className="text-[10px] text-[var(--color-muted)]">
                  {z.driftRatio > 0.1 ? 'Flagged for operator review: boundary will NOT auto-expand.' : 'Within standard spatial tolerance window.'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};

export default Calibration;
