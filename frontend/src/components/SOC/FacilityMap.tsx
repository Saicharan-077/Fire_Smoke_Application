import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Video, AlertTriangle } from 'lucide-react';

interface CameraNode {
  id: string;
  x: number; // Percentage 0-100
  y: number; // Percentage 0-100
  name: string;
  zone: string;
}

interface FacilityMapProps {
  cameras: CameraNode[];
  activeAlerts: string[]; // List of camera IDs that currently have active alerts
  onCameraSelect: (id: string) => void;
  selectedCameraId?: string;
}

export function FacilityMap({ cameras, activeAlerts, onCameraSelect, selectedCameraId }: FacilityMapProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // SVG Path for a mock industrial facility layout
  const mapPath = "M50,50 L950,50 L950,450 L750,450 L750,550 L950,550 L950,950 L50,950 Z M250,50 L250,450 M550,50 L550,450 M50,450 L750,450 M50,700 L400,700 M400,450 L400,950 M600,450 L600,950";

  return (
    <div className="relative w-full aspect-[4/3] max-h-[600px] bg-[#0c0c14] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
      {/* Grid Pattern Background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>
      
      {/* SVG Blueprint */}
      <svg viewBox="0 0 1000 1000" className="absolute inset-0 w-full h-full opacity-40">
        <defs>
          <linearGradient id="wallGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <path d={mapPath} fill="none" stroke="url(#wallGradient)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        
        {/* Zone Labels */}
        <text x="150" y="250" fill="#3b82f6" opacity="0.3" fontSize="40" fontWeight="bold" fontFamily="monospace">ZONE A</text>
        <text x="400" y="250" fill="#3b82f6" opacity="0.3" fontSize="40" fontWeight="bold" fontFamily="monospace">ZONE B</text>
        <text x="650" y="250" fill="#3b82f6" opacity="0.3" fontSize="40" fontWeight="bold" fontFamily="monospace">ZONE C</text>
        <text x="225" y="600" fill="#3b82f6" opacity="0.3" fontSize="40" fontWeight="bold" fontFamily="monospace">ZONE D</text>
        <text x="750" y="750" fill="#3b82f6" opacity="0.3" fontSize="40" fontWeight="bold" fontFamily="monospace">ZONE E</text>
      </svg>

      {/* Nodes */}
      {cameras.map((cam) => {
        const isAlert = activeAlerts.includes(cam.id);
        const isSelected = selectedCameraId === cam.id;
        const isHovered = hoveredNode === cam.id;

        return (
          <div 
            key={cam.id}
            className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer z-10"
            style={{ left: `${cam.x}%`, top: `${cam.y}%` }}
            onMouseEnter={() => setHoveredNode(cam.id)}
            onMouseLeave={() => setHoveredNode(null)}
            onClick={() => onCameraSelect(cam.id)}
          >
            {/* Pulsing Alert Effect */}
            {isAlert && (
              <span className="absolute inset-0 flex h-full w-full">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 transform scale-150"></span>
              </span>
            )}
            
            <motion.div 
              whileHover={{ scale: 1.2 }}
              className={`relative flex items-center justify-center w-8 h-8 rounded-full border-2 transition-colors ${
                isAlert ? 'bg-red-900 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.6)]' :
                isSelected ? 'bg-indigo-900 border-indigo-400 shadow-[0_0_15px_rgba(129,140,248,0.5)]' :
                'bg-slate-900 border-slate-600 hover:border-slate-400'
              }`}
            >
              <Video size={14} className={isAlert ? 'text-red-400' : isSelected ? 'text-indigo-300' : 'text-slate-400'} />
            </motion.div>

            {/* Hover Tooltip */}
            <AnimatePresence>
              {(isHovered || isSelected) && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.9 }}
                  className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 bg-slate-900/95 border border-slate-700 p-3 rounded-xl shadow-2xl backdrop-blur-sm z-50 pointer-events-none"
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-bold text-white font-mono">{cam.name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${isAlert ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                      {isAlert ? 'THREAT' : 'SECURE'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 mb-1">{cam.zone}</div>
                  
                  {isAlert && (
                    <div className="flex items-center gap-1.5 text-xs text-red-400 mt-2 bg-red-500/10 p-1.5 rounded-lg border border-red-500/20">
                      <AlertTriangle size={12} />
                      <span className="font-semibold">Hazard Detected</span>
                    </div>
                  )}
                  
                  <div className="mt-2 text-[9px] text-slate-500 font-mono text-center">Click to view stream feed</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Map Legend */}
      <div className="absolute bottom-4 left-4 bg-slate-900/80 backdrop-blur border border-slate-800 p-3 rounded-xl z-10 flex gap-4 text-[10px] font-semibold text-slate-400">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-slate-900 border border-slate-600"></div> Secure Node
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-900 border border-red-500 animate-pulse"></div> Active Threat
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-900 border border-indigo-400"></div> Viewing
        </div>
      </div>
    </div>
  );
}
