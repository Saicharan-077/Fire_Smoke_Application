import { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../Common/Card';
import { motion } from 'framer-motion';

export function PredictiveHeatmap() {
  // Generate mock heatmap data for a 7-day week, 24 hours
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);

  const heatmapData = useMemo(() => {
    const data: number[][] = [];
    for (let d = 0; d < 7; d++) {
      const row: number[] = [];
      for (let h = 0; h < 24; h++) {
        // Higher probability during working hours (8-18) and weekdays (1-5)
        let prob = Math.random() * 0.3;
        if (d >= 1 && d <= 5) prob += 0.2;
        if (h >= 8 && h <= 18) prob += 0.3;
        // Introduce some random hotspots
        if (Math.random() > 0.95) prob += 0.4;
        row.push(Math.min(1, prob));
      }
      data.push(row);
    }
    return data;
  }, []);

  const getColor = (value: number) => {
    // value 0 to 1 -> color gradient from slate-900 to red-500
    if (value < 0.2) return 'bg-slate-800 dark:bg-slate-900';
    if (value < 0.4) return 'bg-orange-900/40';
    if (value < 0.6) return 'bg-orange-700/60';
    if (value < 0.8) return 'bg-red-600/80';
    return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]';
  };

  return (
    <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17] overflow-hidden">
      <CardHeader>
        <CardTitle className="text-sm font-bold text-slate-900 dark:text-white flex items-center justify-between">
          <span>Predictive Threat Heatmap</span>
          <span className="text-[10px] font-normal text-slate-500 bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">AI Forecasting Model Active</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 overflow-x-auto custom-scrollbar">
        <div className="min-w-[700px]">
          {/* Header Row (Hours) */}
          <div className="flex ml-12 mb-2">
            {hours.map(h => (
              <div key={h} className="flex-1 text-center text-[9px] text-slate-500 font-mono">
                {h.replace(':00', 'h')}
              </div>
            ))}
          </div>
          
          {/* Heatmap Grid */}
          <div className="space-y-1">
            {days.map((day, d) => (
              <div key={day} className="flex items-center gap-2">
                <div className="w-10 text-[10px] font-bold text-slate-400 text-right">{day}</div>
                <div className="flex flex-1 gap-1">
                  {heatmapData[d].map((val, h) => (
                    <motion.div
                      key={`${d}-${h}`}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: (d * 24 + h) * 0.002 }}
                      className={`flex-1 aspect-square rounded-sm ${getColor(val)} transition-colors cursor-crosshair group relative`}
                    >
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10 w-max bg-slate-900 border border-slate-700 text-white text-[10px] p-1.5 rounded shadow-xl pointer-events-none">
                        <span className="font-bold text-red-400">{(val * 100).toFixed(1)}% Risk</span>
                        <div className="text-slate-400">{day} {hours[h]}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          
          {/* Legend */}
          <div className="mt-4 flex items-center justify-end gap-2 text-[9px] font-bold text-slate-500">
            <span>Low Risk</span>
            <div className="flex gap-1">
              <div className="w-3 h-3 rounded-sm bg-slate-800"></div>
              <div className="w-3 h-3 rounded-sm bg-orange-900/40"></div>
              <div className="w-3 h-3 rounded-sm bg-orange-700/60"></div>
              <div className="w-3 h-3 rounded-sm bg-red-600/80"></div>
              <div className="w-3 h-3 rounded-sm bg-red-500"></div>
            </div>
            <span className="text-red-500">High Risk</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
