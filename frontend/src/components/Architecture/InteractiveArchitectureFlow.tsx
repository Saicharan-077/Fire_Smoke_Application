import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  Camera, Cpu, Eye, Zap, Clock, Flame, 
  Sparkles, Radio, AlertTriangle, 
  AlertOctagon, CheckCircle2, RefreshCw,
  Sliders, Activity, Info
} from 'lucide-react';

export interface PipelineScenario {
  id: string;
  name: string;
  badge: string;
  desc: string;
  yoloConf: number;
  colorRatio: number;
  brightness: number;
  flicker: number;
  sparks: number;
  consecutiveFrames: number;
  targetCategory: 'normal_fire' | 'far_fire_candidate' | 'spark_occluded' | 'normal_smoke' | 'none';
}

const SCENARIOS: PipelineScenario[] = [
  {
    id: 'normal_fire',
    name: 'Sustained Structural Fire',
    badge: '🔴 Critical Alarm',
    desc: 'High neural confidence combined with dominant HSV flame spectra and steady temporal continuity.',
    yoloConf: 0.88,
    colorRatio: 0.34,
    brightness: 0.85,
    flicker: 0.72,
    sparks: 1,
    consecutiveFrames: 6,
    targetCategory: 'normal_fire',
  },
  {
    id: 'far_fire',
    name: 'Distant Far Fire Hotspot',
    badge: '🟡 Advisory Verification',
    desc: 'Small pixel bounding box (<1.5% frame) with intense localized thermal hue requiring spatio-temporal validation.',
    yoloConf: 0.52,
    colorRatio: 0.42,
    brightness: 0.90,
    flicker: 0.45,
    sparks: 0,
    consecutiveFrames: 3,
    targetCategory: 'far_fire_candidate',
  },
  {
    id: 'sparks',
    name: 'Welding / Fleeting Spark Flare',
    badge: '✨ Transient Filtered',
    desc: 'High-frequency spark points with high intensity variance but low temporal frame persistence.',
    yoloConf: 0.41,
    colorRatio: 0.15,
    brightness: 0.95,
    flicker: 0.88,
    sparks: 7,
    consecutiveFrames: 1,
    targetCategory: 'spark_occluded',
  },
  {
    id: 'smoke',
    name: 'Dense Diffusion Smoke',
    badge: '💨 Atmospheric Threat',
    desc: 'Desaturated texture expansion with low edge density and persistent spatial expansion.',
    yoloConf: 0.79,
    colorRatio: 0.08,
    brightness: 0.55,
    flicker: 0.30,
    sparks: 0,
    consecutiveFrames: 5,
    targetCategory: 'normal_smoke',
  },
  {
    id: 'safe',
    name: 'Normal Ambient Baseline',
    badge: '🟢 Secure Monitoring',
    desc: 'Standard scene with zero anomalous thermal or photometric signatures.',
    yoloConf: 0.05,
    colorRatio: 0.01,
    brightness: 0.40,
    flicker: 0.05,
    sparks: 0,
    consecutiveFrames: 0,
    targetCategory: 'none',
  }
];

export const InteractiveArchitectureFlow: React.FC = () => {
  const [selectedScenario, setSelectedScenario] = useState<PipelineScenario>(SCENARIOS[0]);
  const [activeNode, setActiveNode] = useState<string>('fusion');
  const [customYolo, setCustomYolo] = useState<number>(selectedScenario.yoloConf);
  const [customColor, setCustomColor] = useState<number>(selectedScenario.colorRatio);
  const [customBrightness, setCustomBrightness] = useState<number>(selectedScenario.brightness);
  const [customSparks, setCustomSparks] = useState<number>(selectedScenario.sparks);
  const [isCustomMode, setIsCustomMode] = useState<boolean>(false);

  // Apply scenario preset
  const handleSelectScenario = (scenario: PipelineScenario) => {
    setSelectedScenario(scenario);
    setIsCustomMode(false);
    setCustomYolo(scenario.yoloConf);
    setCustomColor(scenario.colorRatio);
    setCustomBrightness(scenario.brightness);
    setCustomSparks(scenario.sparks);
  };

  // Live Fusion Math
  const liveMetrics = useMemo(() => {
    const yolo = isCustomMode ? customYolo : selectedScenario.yoloConf;
    const color = isCustomMode ? customColor : selectedScenario.colorRatio;
    const bright = isCustomMode ? customBrightness : selectedScenario.brightness;
    const sparks = isCustomMode ? customSparks : selectedScenario.sparks;
    const flicker = selectedScenario.flicker;

    const colorScore = Math.min(1.0, color / 0.20);
    const sparkBoost = Math.min(0.15, sparks * 0.03);
    const fusionScore = Math.min(
      0.99,
      Math.max(
        0.02,
        0.45 * yolo + 0.30 * colorScore + 0.15 * bright + 0.10 * flicker + sparkBoost
      )
    );

    let category: 'normal_fire' | 'far_fire_candidate' | 'spark_occluded' | 'normal_smoke' | 'none' = 'none';
    if (fusionScore < 0.20) {
      category = 'none';
    } else if (sparks >= 3 || flicker > 0.8) {
      category = 'spark_occluded';
    } else if (colorScore > 0.6 && yolo < 0.6) {
      category = 'far_fire_candidate';
    } else if (selectedScenario.id === 'smoke') {
      category = 'normal_smoke';
    } else {
      category = 'normal_fire';
    }

    let alertLevel: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
    if (category === 'none' || fusionScore < 0.30) {
      alertLevel = 'GREEN';
    } else if (fusionScore >= 0.65 || (category === 'normal_fire' && fusionScore >= 0.55)) {
      alertLevel = 'RED';
    } else {
      alertLevel = 'YELLOW';
    }

    return {
      yolo,
      color,
      bright,
      sparks,
      flicker,
      colorScore,
      fusionScore: Math.round(fusionScore * 100) / 100,
      category,
      alertLevel,
    };
  }, [
    isCustomMode,
    customYolo,
    customColor,
    customBrightness,
    customSparks,
    selectedScenario,
  ]);

  return (
    <div className="w-full rounded-3xl bg-[#090a10] border border-white/10 p-6 md:p-8 space-y-8 shadow-2xl relative overflow-hidden text-gray-100">
      {/* Glow Orbs */}
      <div className="absolute top-0 -left-20 w-80 h-80 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-20 w-80 h-80 bg-orange-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header & Scenario Selector */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-white/10 relative z-10">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wide uppercase bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 animate-pulse" /> Dual-Stream Pipeline
            </span>
            <span className="text-xs text-gray-400 font-mono">YOLO26m + OpenCV Fusion</span>
          </div>
          <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            Interactive Architecture Visualizer
          </h2>
          <p className="text-sm text-gray-400 max-w-xl">
            Inspect real-time evidence synthesis from neural object detection to deterministic CV heuristics and multi-level alert states.
          </p>
        </div>

        {/* Preset Selector */}
        <div className="flex flex-wrap items-center gap-2">
          {SCENARIOS.map((sc) => {
            const isSelected = selectedScenario.id === sc.id && !isCustomMode;
            return (
              <button
                key={sc.id}
                onClick={() => handleSelectScenario(sc)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 border ${
                  isSelected
                    ? 'bg-red-500 text-white border-red-400 shadow-lg shadow-red-500/25'
                    : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
                }`}
              >
                <span>{sc.name.split(' ')[0]}</span>
                <span className="opacity-70 text-[10px]">({sc.badge.split(' ')[0]})</span>
              </button>
            );
          })}
          <button
            onClick={() => setIsCustomMode(!isCustomMode)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 border ${
              isCustomMode
                ? 'bg-orange-500 text-white border-orange-400 shadow-lg shadow-orange-500/25'
                : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" /> Manual Tune
          </button>
        </div>
      </div>

      {/* Main Interactive Diagram Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start relative z-10">
        
        {/* Left Diagram Canvas (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col items-center space-y-4">
          
          {/* Level 1: Camera Frame */}
          <motion.div
            onClick={() => setActiveNode('camera')}
            whileHover={{ scale: 1.02 }}
            className={`w-full max-w-md p-4 rounded-2xl border transition-all cursor-pointer text-center relative overflow-hidden ${
              activeNode === 'camera'
                ? 'bg-gradient-to-r from-blue-950/60 to-indigo-950/60 border-blue-500 ring-2 ring-blue-500/30 shadow-lg shadow-blue-500/20'
                : 'bg-white/[0.03] border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-center gap-2 text-blue-400 font-bold text-sm tracking-wider uppercase">
              <Camera className="w-4 h-4" /> Camera Frame Input
            </div>
            <p className="text-xs text-gray-400 mt-1">1080p RTSP Stream / Video / Image Upload</p>
            {/* Scanline Animation */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-500/10 to-transparent h-4 animate-pulse pointer-events-none" />
          </motion.div>

          {/* Split Connectors */}
          <div className="w-full max-w-md flex justify-around text-gray-500 font-mono text-xs">
            <span className="flex flex-col items-center">
              <span className="h-6 w-0.5 bg-gradient-to-b from-blue-500 to-indigo-500" />
              <span>Deep Learning Stream</span>
            </span>
            <span className="flex flex-col items-center">
              <span className="h-6 w-0.5 bg-gradient-to-b from-blue-500 to-teal-500" />
              <span>Optical CV Stream</span>
            </span>
          </div>

          {/* Level 2: Dual Stream Parallel Nodes */}
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* YOLO26m Node */}
            <motion.div
              onClick={() => setActiveNode('yolo')}
              whileHover={{ scale: 1.02 }}
              className={`p-4 rounded-2xl border transition-all cursor-pointer relative ${
                activeNode === 'yolo'
                  ? 'bg-indigo-950/50 border-indigo-500 ring-2 ring-indigo-500/30 shadow-lg shadow-indigo-500/20'
                  : 'bg-white/[0.02] border-white/10 hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
                  <Cpu className="w-4 h-4" /> YOLO26m Vision AI
                </div>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-500/20 text-indigo-300">
                  {Math.round(liveMetrics.yolo * 100)}% Conf
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Neural bounding boxes for fire, smoke & context objects with NMS filtering.
              </p>
            </motion.div>

            {/* OpenCV CV Node */}
            <motion.div
              onClick={() => setActiveNode('opencv')}
              whileHover={{ scale: 1.02 }}
              className={`p-4 rounded-2xl border transition-all cursor-pointer relative ${
                activeNode === 'opencv'
                  ? 'bg-teal-950/50 border-teal-500 ring-2 ring-teal-500/30 shadow-lg shadow-teal-500/20'
                  : 'bg-white/[0.02] border-white/10 hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-teal-400 font-bold text-sm">
                  <Eye className="w-4 h-4" /> OpenCV CV
                </div>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-teal-500/20 text-teal-300">
                  HSV + Motion
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Color masks, flicker (8–12Hz), {liveMetrics.sparks} spark points & Laplacian texture.
              </p>
            </motion.div>
          </div>

          {/* Merge Line */}
          <div className="flex flex-col items-center">
            <span className="h-6 w-0.5 bg-gradient-to-b from-gray-500 to-amber-500" />
            <span className="text-[10px] uppercase font-mono tracking-wider text-amber-400">Cross-Entropy Synthesis</span>
          </div>

          {/* Level 3: Evidence Fusion */}
          <motion.div
            onClick={() => setActiveNode('fusion')}
            whileHover={{ scale: 1.02 }}
            className={`w-full p-5 rounded-2xl border transition-all cursor-pointer text-center relative ${
              activeNode === 'fusion'
                ? 'bg-amber-950/40 border-amber-500 ring-2 ring-amber-500/30 shadow-lg shadow-amber-500/20'
                : 'bg-white/[0.02] border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm uppercase tracking-wider">
                <Zap className="w-4 h-4 animate-bounce" /> Evidence Fusion Engine
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Score: {liveMetrics.fusionScore.toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Weighted matrix fusing 45% YOLO neural logits + 30% HSV color ratio + 15% Brightness/Flicker + 10% Sparks.
            </p>
          </motion.div>

          {/* Flow Down */}
          <div className="flex flex-col items-center">
            <span className="h-6 w-0.5 bg-gradient-to-b from-amber-500 to-emerald-500" />
          </div>

          {/* Level 4: Temporal Verification */}
          <motion.div
            onClick={() => setActiveNode('temporal')}
            whileHover={{ scale: 1.02 }}
            className={`w-full p-4 rounded-2xl border transition-all cursor-pointer text-center relative ${
              activeNode === 'temporal'
                ? 'bg-emerald-950/40 border-emerald-500 ring-2 ring-emerald-500/30 shadow-lg shadow-emerald-500/20'
                : 'bg-white/[0.02] border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm uppercase tracking-wider">
                <Clock className="w-4 h-4" /> Temporal Verification (ByteTrack)
              </div>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/20 text-emerald-300">
                EMA Buffer (α=0.6)
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Multi-frame IoU persistence checks and Exponential Moving Average smoothing.
            </p>
          </motion.div>

          {/* Flow Down to 3 Categories */}
          <div className="flex flex-col items-center">
            <span className="h-6 w-0.5 bg-gradient-to-b from-emerald-500 to-purple-500" />
          </div>

          {/* Level 5: Classification Candidates */}
          <div className="w-full grid grid-cols-3 gap-3">
            
            {/* Normal Fire */}
            <motion.div
              onClick={() => setActiveNode('candidate_normal')}
              whileHover={{ scale: 1.02 }}
              className={`p-3 rounded-xl border text-center transition-all cursor-pointer ${
                liveMetrics.category === 'normal_fire'
                  ? 'bg-red-950/60 border-red-500 ring-2 ring-red-500/40 shadow-lg shadow-red-500/20'
                  : 'bg-white/[0.02] border-white/10 opacity-60'
              }`}
            >
              <Flame className={`w-5 h-5 mx-auto mb-1 ${liveMetrics.category === 'normal_fire' ? 'text-red-400' : 'text-gray-500'}`} />
              <div className="text-xs font-bold text-white">NORMAL FIRE</div>
              <div className="text-[10px] text-gray-400">Sustained Flame</div>
            </motion.div>

            {/* Far Fire Candidate */}
            <motion.div
              onClick={() => setActiveNode('candidate_far')}
              whileHover={{ scale: 1.02 }}
              className={`p-3 rounded-xl border text-center transition-all cursor-pointer ${
                liveMetrics.category === 'far_fire_candidate'
                  ? 'bg-amber-950/60 border-amber-500 ring-2 ring-amber-500/40 shadow-lg shadow-amber-500/20'
                  : 'bg-white/[0.02] border-white/10 opacity-60'
              }`}
            >
              <Radio className={`w-5 h-5 mx-auto mb-1 ${liveMetrics.category === 'far_fire_candidate' ? 'text-amber-400' : 'text-gray-500'}`} />
              <div className="text-xs font-bold text-white">FAR FIRE</div>
              <div className="text-[10px] text-gray-400">Small ROI Hotspot</div>
            </motion.div>

            {/* Spark / Occluded */}
            <motion.div
              onClick={() => setActiveNode('candidate_spark')}
              whileHover={{ scale: 1.02 }}
              className={`p-3 rounded-xl border text-center transition-all cursor-pointer ${
                liveMetrics.category === 'spark_occluded'
                  ? 'bg-purple-950/60 border-purple-500 ring-2 ring-purple-500/40 shadow-lg shadow-purple-500/20'
                  : 'bg-white/[0.02] border-white/10 opacity-60'
              }`}
            >
              <Sparkles className={`w-5 h-5 mx-auto mb-1 ${liveMetrics.category === 'spark_occluded' ? 'text-purple-400' : 'text-gray-500'}`} />
              <div className="text-xs font-bold text-white">SPARK / OCCLUDED</div>
              <div className="text-[10px] text-gray-400">Transient Bursts</div>
            </motion.div>
          </div>

          {/* Flow Down */}
          <div className="flex flex-col items-center">
            <span className="h-6 w-0.5 bg-gradient-to-b from-purple-500 to-red-500" />
          </div>

          {/* Level 6: Alert Engine Outputs */}
          <motion.div
            onClick={() => setActiveNode('alert_engine')}
            whileHover={{ scale: 1.02 }}
            className={`w-full p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden ${
              liveMetrics.alertLevel === 'RED'
                ? 'bg-red-950/80 border-red-500 shadow-xl shadow-red-500/30'
                : liveMetrics.alertLevel === 'YELLOW'
                ? 'bg-amber-950/80 border-amber-500 shadow-xl shadow-amber-500/30'
                : 'bg-emerald-950/80 border-emerald-500 shadow-xl shadow-emerald-500/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {liveMetrics.alertLevel === 'RED' ? (
                  <AlertOctagon className="w-7 h-7 text-red-400 animate-pulse" />
                ) : liveMetrics.alertLevel === 'YELLOW' ? (
                  <AlertTriangle className="w-7 h-7 text-amber-400 animate-bounce" />
                ) : (
                  <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                )}
                <div>
                  <div className="text-xs text-gray-300 font-mono uppercase tracking-wider">
                    ALERT ENGINE STATE
                  </div>
                  <div className="text-xl font-black tracking-tight text-white">
                    {liveMetrics.alertLevel === 'RED' && '🔴 RED — ACTIVE CRITICAL THREAT'}
                    {liveMetrics.alertLevel === 'YELLOW' && '🟡 YELLOW — ADVISORY / VERIFYING'}
                    {liveMetrics.alertLevel === 'GREEN' && '🟢 GREEN — SECURE & NORMAL'}
                  </div>
                </div>
              </div>
              <span className="px-3 py-1 rounded-lg bg-black/40 text-xs font-mono border border-white/10 text-white font-bold">
                WebSocket Push
              </span>
            </div>
          </motion.div>

        </div>

        {/* Right Inspector & Param Controls (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Node Inspector Card */}
          <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/10 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-400" /> Node Inspector
              </h3>
              <span className="text-xs font-mono text-gray-400 uppercase">
                Stage: {activeNode}
              </span>
            </div>

            {activeNode === 'camera' && (
              <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
                <p>
                  <strong className="text-white">Camera Frame:</strong> Decodes continuous RTSP streams or batch video frames. Utilizes OpenCV VideoCapture with fallback downsampling for high-resolution 4K feeds.
                </p>
                <div className="p-3 rounded-xl bg-black/40 font-mono text-xs text-gray-400 space-y-1">
                  <div>• Resolution: 1920x1080 (adaptive downscaling to 1280 max)</div>
                  <div>• Format: BGR / RGB color channels</div>
                  <div>• Frame Rate: 25.0 FPS continuous stream</div>
                </div>
              </div>
            )}

            {activeNode === 'yolo' && (
              <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
                <p>
                  <strong className="text-white">YOLO26m Vision AI:</strong> Ultralytics neural network inferring bounding boxes, class logits (<code className="text-indigo-300">fire</code>, <code className="text-indigo-300">smoke</code>), and Non-Maximum Suppression (NMS).
                </p>
                <div className="p-3 rounded-xl bg-black/40 font-mono text-xs text-gray-400 space-y-1">
                  <div>• Model: YOLO26m PyTorch Container (`best.pt`)</div>
                  <div>• Current Raw Confidence: {(liveMetrics.yolo * 100).toFixed(1)}%</div>
                  <div>• Target Classes: [0: Fire, 1: Smoke]</div>
                </div>
              </div>
            )}

            {activeNode === 'opencv' && (
              <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
                <p>
                  <strong className="text-white">OpenCV CV Verification:</strong> Deterministic checks verifying HSV spectral fire ranges, motion optical flow, dynamic flame flicker frequency (8–12 Hz), and ultra-bright spark points.
                </p>
                <div className="p-3 rounded-xl bg-black/40 font-mono text-xs text-gray-400 space-y-1">
                  <div>• Flame Color Ratio: {(liveMetrics.color * 100).toFixed(1)}%</div>
                  <div>• Spark Component Count: {liveMetrics.sparks}</div>
                  <div>• Texture Laplacian Variance: Passed</div>
                </div>
              </div>
            )}

            {activeNode === 'fusion' && (
              <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
                <p>
                  <strong className="text-white">Evidence Fusion Math:</strong> Synthesizes neural inference with deterministic CV physics metrics.
                </p>
                <div className="p-3 rounded-xl bg-black/50 border border-white/5 font-mono text-xs text-amber-300 space-y-1.5">
                  <div className="text-gray-400"># Formula:</div>
                  <div>Score = 0.45(YOLO) + 0.30(Color) + 0.15(Bright) + 0.10(Flicker) + Sparks</div>
                  <div className="text-white font-bold pt-1 border-t border-white/10">
                    = {(0.45 * liveMetrics.yolo).toFixed(3)} + {(0.30 * liveMetrics.colorScore).toFixed(3)} + {(0.15 * liveMetrics.bright).toFixed(3)} + {(0.10 * liveMetrics.flicker).toFixed(3)} + {(Math.min(0.15, liveMetrics.sparks * 0.03)).toFixed(3)}
                  </div>
                  <div className="text-emerald-400 font-black">
                    = {liveMetrics.fusionScore.toFixed(2)}
                  </div>
                </div>
              </div>
            )}

            {activeNode === 'temporal' && (
              <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
                <p>
                  <strong className="text-white">Temporal Verification:</strong> Multi-frame ByteTrack tracker correlates bounding boxes over time. Uses Exponential Moving Average (EMA) to avoid single-frame flickering glitches.
                </p>
                <div className="p-3 rounded-xl bg-black/40 font-mono text-xs text-gray-400 space-y-1">
                  <div>• Consecutive Requirement: 3 Frames</div>
                  <div>• Smoothing Alpha: 0.60</div>
                  <div>• Track ID Persistence: Max age 25 frames</div>
                </div>
              </div>
            )}

            {activeNode.startsWith('candidate') && (
              <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
                <p>
                  <strong className="text-white">Threat Categorization:</strong> Distinguishes sustained macro flames from distant localized candidates and fleeting spark eruptions.
                </p>
                <div className="p-3 rounded-xl bg-black/40 font-mono text-xs text-gray-400 space-y-1">
                  <div>• Active Classification: <span className="text-white font-bold uppercase">{liveMetrics.category.replace('_', ' ')}</span></div>
                  <div>• Spatial Area Ratio: {liveMetrics.category === 'far_fire_candidate' ? '< 1.5% (Distant)' : '> 3.0% (Macro)'}</div>
                </div>
              </div>
            )}

            {activeNode === 'alert_engine' && (
              <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
                <p>
                  <strong className="text-white">Alert Engine:</strong> Maps verified threat scores into operational SOC states (Green/Yellow/Red) and broadcasts events via WebSockets.
                </p>
                <div className="p-3 rounded-xl bg-black/40 font-mono text-xs text-gray-400 space-y-1">
                  <div>• Current Severity: <span className="text-white font-bold">{liveMetrics.alertLevel}</span></div>
                  <div>• Action: {liveMetrics.alertLevel === 'RED' ? 'Push WS Alert + Sound + DB Incident' : liveMetrics.alertLevel === 'YELLOW' ? 'Advisory Log + Pre-Alarm' : 'Normal Monitoring'}</div>
                </div>
              </div>
            )}
          </div>

          {/* Interactive Manual Tuning Sliders */}
          <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/10 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Sliders className="w-4 h-4 text-orange-400" /> Pipeline Parameter Controls
              </h3>
              {isCustomMode && (
                <span className="text-xs text-orange-400 font-mono">Custom Mode Active</span>
              )}
            </div>

            {/* Slider 1: YOLO Confidence */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-gray-400">YOLO Neural Confidence (w=0.45)</span>
                <span className="text-indigo-400 font-bold">{Math.round((isCustomMode ? customYolo : selectedScenario.yoloConf) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={isCustomMode ? customYolo : selectedScenario.yoloConf}
                onChange={(e) => {
                  setIsCustomMode(true);
                  setCustomYolo(parseFloat(e.target.value));
                }}
                className="w-full accent-indigo-500 cursor-pointer"
              />
            </div>

            {/* Slider 2: Flame Color Ratio */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-gray-400">OpenCV HSV Flame Ratio (w=0.30)</span>
                <span className="text-teal-400 font-bold">{Math.round((isCustomMode ? customColor : selectedScenario.colorRatio) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.01"
                value={isCustomMode ? customColor : selectedScenario.colorRatio}
                onChange={(e) => {
                  setIsCustomMode(true);
                  setCustomColor(parseFloat(e.target.value));
                }}
                className="w-full accent-teal-500 cursor-pointer"
              />
            </div>

            {/* Slider 3: Brightness / Luminance */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-gray-400">Luminance / Brightness (w=0.15)</span>
                <span className="text-amber-400 font-bold">{Math.round((isCustomMode ? customBrightness : selectedScenario.brightness) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isCustomMode ? customBrightness : selectedScenario.brightness}
                onChange={(e) => {
                  setIsCustomMode(true);
                  setCustomBrightness(parseFloat(e.target.value));
                }}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>

            {/* Slider 4: Spark Count */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-gray-400">Sparks / Hotspot Count</span>
                <span className="text-purple-400 font-bold">{isCustomMode ? customSparks : selectedScenario.sparks} pts</span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={isCustomMode ? customSparks : selectedScenario.sparks}
                onChange={(e) => {
                  setIsCustomMode(true);
                  setCustomSparks(parseInt(e.target.value, 10));
                }}
                className="w-full accent-purple-500 cursor-pointer"
              />
            </div>

            {/* Reset Button */}
            {isCustomMode && (
              <button
                onClick={() => handleSelectScenario(selectedScenario)}
                className="w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-gray-300 flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Reset to Scenario Defaults
              </button>
            )}
          </div>

        </div>

      </div>
    </div>
  );
};

export default InteractiveArchitectureFlow;
