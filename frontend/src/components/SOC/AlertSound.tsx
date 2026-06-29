import { useEffect, useRef } from 'react';
import { useAppSettingsStore } from '../../store/appSettingsStore';

export function useAlertSound() {
  const { alertSoundEnabled } = useAppSettingsStore();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayAtRef = useRef<number>(0);

  // Create audio lazily once
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio('/sounds/alert.mp3');
      audioRef.current.preload = 'auto';
    }
  }, []);

  // Prevent sound spam (2–3s cooldown)
  const play = async () => {
    if (!alertSoundEnabled) return;

    const now = Date.now();
    const elapsed = now - lastPlayAtRef.current;
    if (elapsed < 2500) return; // ~2.5s cooldown within required range

    try {
      if (!audioRef.current) return;
      audioRef.current.currentTime = 0;
      lastPlayAtRef.current = now;
      await audioRef.current.play();
    } catch {
      // Ignore autoplay errors
    }
  };

  return { play };
}


