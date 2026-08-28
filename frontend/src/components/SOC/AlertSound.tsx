import { useRef, useCallback, useEffect } from 'react';
import { useAppSettingsStore } from '../../store/appSettingsStore';

export function useAlertSound() {
  const { alertSoundEnabled } = useAppSettingsStore();
  const lastSirenAtRef = useRef<number>(0);
  const activeOscillatorsRef = useRef<Array<{ stop: () => void }>>([]);
  const sirenTimeoutRef = useRef<any>(null);

  // High-Impact Industrial Emergency Siren (Plays continuously for 2.5 - 3.0 seconds)
  const playEmergencySiren = useCallback((durationSeconds: number = 2.8) => {
    if (!alertSoundEnabled) return;

    const now = Date.now();
    // Allow triggering if not currently playing or at least 2.5s since last start
    if (now - lastSirenAtRef.current < 2500) return;
    lastSirenAtRef.current = now;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const t0 = ctx.currentTime;
      const tEnd = t0 + durationSeconds;

      // Master Gain
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.01, t0);
      masterGain.gain.linearRampToValueAtTime(0.40, t0 + 0.1); // Fast attack
      masterGain.gain.setValueAtTime(0.40, tEnd - 0.2);
      masterGain.gain.linearRampToValueAtTime(0.001, tEnd); // Smooth decay
      masterGain.connect(ctx.destination);

      // Primary Siren Oscillator (Sweeping pitch 700Hz -> 1350Hz -> 700Hz)
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';

      // Sweep frequency back and forth over the duration (approx 2 sweeps per second)
      const sweepRate = 0.5; // seconds per cycle
      const cycles = Math.ceil(durationSeconds / sweepRate);
      for (let i = 0; i < cycles; i++) {
        const cycleStart = t0 + (i * sweepRate);
        const cycleMid = cycleStart + (sweepRate / 2);
        const cycleEnd = cycleStart + sweepRate;

        osc1.frequency.setValueAtTime(700, Math.min(tEnd, cycleStart));
        osc1.frequency.exponentialRampToValueAtTime(1350, Math.min(tEnd, cycleMid));
        osc1.frequency.exponentialRampToValueAtTime(700, Math.min(tEnd, cycleEnd));
      }

      // Secondary Harmonizer Oscillator (gives rich alarm texture)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'square';
      gain2.gain.setValueAtTime(0.25, t0);

      for (let i = 0; i < cycles; i++) {
        const cycleStart = t0 + (i * sweepRate);
        const cycleMid = cycleStart + (sweepRate / 2);
        const cycleEnd = cycleStart + sweepRate;

        osc2.frequency.setValueAtTime(850, Math.min(tEnd, cycleStart));
        osc2.frequency.exponentialRampToValueAtTime(1550, Math.min(tEnd, cycleMid));
        osc2.frequency.exponentialRampToValueAtTime(850, Math.min(tEnd, cycleEnd));
      }

      osc1.connect(masterGain);
      osc2.connect(gain2);
      gain2.connect(masterGain);

      osc1.start(t0);
      osc2.start(t0);
      osc1.stop(tEnd);
      osc2.stop(tEnd);

      const handleStop = () => {
        try {
          osc1.stop();
          osc2.stop();
          ctx.close().catch(() => {});
        } catch {}
      };

      activeOscillatorsRef.current.push({ stop: handleStop });

      if (sirenTimeoutRef.current) clearTimeout(sirenTimeoutRef.current);
      sirenTimeoutRef.current = setTimeout(() => {
        handleStop();
      }, durationSeconds * 1000 + 100);

    } catch (e) {
      console.error('Failed to synthesize emergency siren:', e);
    }
  }, [alertSoundEnabled]);

  const stopSiren = useCallback(() => {
    if (sirenTimeoutRef.current) {
      clearTimeout(sirenTimeoutRef.current);
      sirenTimeoutRef.current = null;
    }
    activeOscillatorsRef.current.forEach((o) => {
      try { o.stop(); } catch {}
    });
    activeOscillatorsRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      stopSiren();
    };
  }, [stopSiren]);

  return {
    play: playEmergencySiren,
    playHighBeep: playEmergencySiren,
    playEmergencySiren,
    startSiren: playEmergencySiren,
    stopSiren,
  };
}
