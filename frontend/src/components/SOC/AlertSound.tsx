import { useRef, useCallback, useEffect } from 'react';
import { useAppSettingsStore } from '../../store/appSettingsStore';

export function useAlertSound() {
  const { alertSoundEnabled } = useAppSettingsStore();
  const lastPlayAtRef = useRef<number>(0);
  const sirenIntervalRef = useRef<any>(null);

  const playChime = useCallback(async () => {
    if (!alertSoundEnabled) return;

    const now = Date.now();
    const elapsed = now - lastPlayAtRef.current;
    if (elapsed < 1500) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(880.00, ctx.currentTime + 0.15);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(659.25, ctx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.2);

      gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start();
      osc2.start();

      osc1.stop(ctx.currentTime + 0.4);
      osc2.stop(ctx.currentTime + 0.4);

      lastPlayAtRef.current = now;
    } catch (e) {
      console.error('Failed to play alert chime:', e);
    }
  }, [alertSoundEnabled]);

  const startContinuousSiren = useCallback(() => {
    if (!alertSoundEnabled || sirenIntervalRef.current) return;

    const playSirenPulse = () => {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;

        const ctx = new AudioContextClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // Pulsing High Emergency Pitch (880 Hz down to 587 Hz)
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880.0, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(587.33, ctx.currentTime + 0.25);

        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch (e) {
        console.error('Continuous siren error:', e);
      }
    };

    playSirenPulse();
    sirenIntervalRef.current = setInterval(playSirenPulse, 320);
  }, [alertSoundEnabled]);

  const stopContinuousSiren = useCallback(() => {
    if (sirenIntervalRef.current) {
      clearInterval(sirenIntervalRef.current);
      sirenIntervalRef.current = null;
    }
  }, []);

  const triggerContinuousThreatAlarm = useCallback((consecutiveFrames: number) => {
    if (consecutiveFrames >= 3) {
      startContinuousSiren();
    }
  }, [startContinuousSiren]);

  useEffect(() => {
    return () => {
      stopContinuousSiren();
    };
  }, [stopContinuousSiren]);

  return {
    play: playChime,
    startSiren: startContinuousSiren,
    stopSiren: stopContinuousSiren,
    triggerContinuousThreatAlarm,
  };
}

