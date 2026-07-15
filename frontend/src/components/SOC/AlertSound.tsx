import { useRef } from 'react';
import { useAppSettingsStore } from '../../store/appSettingsStore';

export function useAlertSound() {
  const { alertSoundEnabled } = useAppSettingsStore();
  const lastPlayAtRef = useRef<number>(0);

  const play = async () => {
    if (!alertSoundEnabled) return;

    const now = Date.now();
    const elapsed = now - lastPlayAtRef.current;
    if (elapsed < 2500) return; // ~2.5s cooldown to prevent warning fatigue

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      
      // Synthesize a clean, premium enterprise dual-chime alarm tone
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5 frequency
      osc1.frequency.exponentialRampToValueAtTime(880.00, ctx.currentTime + 0.15); // A5 frequency

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(659.25, ctx.currentTime); // E5 frequency
      osc2.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.2); // C6 frequency

      gainNode.gain.setValueAtTime(0.08, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35); // fade out chime smoothly

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start();
      osc2.start();

      osc1.stop(ctx.currentTime + 0.4);
      osc2.stop(ctx.currentTime + 0.4);

      lastPlayAtRef.current = now;
    } catch (e) {
      console.error('Failed to play alert sound using Web Audio synthesis:', e);
    }
  };

  return { play };
}
