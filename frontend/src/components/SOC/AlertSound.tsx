import { useRef, useCallback, useEffect } from 'react';
import { useAppSettingsStore } from '../../store/appSettingsStore';

export function useAlertSound() {
  const { alertSoundEnabled } = useAppSettingsStore();
  const lastBeepAtRef = useRef<number>(0);
  const sirenIntervalRef = useRef<any>(null);

  // High-Volume High-Pitch Emergency Beep Tone (Plays every 2.5-3 seconds when fire is sustained)
  const playHighBeep = useCallback(async () => {
    if (!alertSoundEnabled) return;

    const now = Date.now();
    const elapsed = now - lastBeepAtRef.current;
    if (elapsed < 2500) return; // Strict 2.5s cooldown to beep every 2.5-3 seconds

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      
      // High-volume double beep (C6 1046.5Hz & E6 1318.5Hz)
      const playPulse = (startTime: number, freq: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.35, startTime); // Full volume gain
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.18);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.2);
      };

      // Double Beep burst spaced 120ms apart
      playPulse(ctx.currentTime, 1046.50);
      playPulse(ctx.currentTime + 0.14, 1318.51);

      lastBeepAtRef.current = now;
    } catch (e) {
      console.error('Failed to play high beep sound:', e);
    }
  }, [alertSoundEnabled]);

  const startSustainedBeepLoop = useCallback(() => {
    if (!alertSoundEnabled || sirenIntervalRef.current) return;

    void playHighBeep();
    sirenIntervalRef.current = setInterval(() => {
      void playHighBeep();
    }, 2800); // Repeat every 2.8 seconds
  }, [alertSoundEnabled, playHighBeep]);

  const stopSustainedBeepLoop = useCallback(() => {
    if (sirenIntervalRef.current) {
      clearInterval(sirenIntervalRef.current);
      sirenIntervalRef.current = null;
    }
  }, []);

  const triggerSustainedFireAlarm = useCallback((consecutiveFrames: number) => {
    // Only trigger if fire has been detected continuously for 2-3 seconds (~15-20 frames)
    if (consecutiveFrames >= 15) {
      startSustainedBeepLoop();
    }
  }, [startSustainedBeepLoop]);

  useEffect(() => {
    return () => {
      stopSustainedBeepLoop();
    };
  }, [stopSustainedBeepLoop]);

  return {
    play: playHighBeep,
    playHighBeep,
    startSiren: startSustainedBeepLoop,
    stopSiren: stopSustainedBeepLoop,
    triggerSustainedFireAlarm,
  };
}

