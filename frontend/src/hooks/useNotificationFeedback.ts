/**
 * Notification Feedback Hook
 * 
 * Provides visual, audio, and haptic feedback for notifications.
 * Supports different notification types with distinct sounds.
 */

import { useCallback, useRef, useEffect } from 'react';

export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'trade';

interface NotificationSettings {
  sound: boolean;
  vibration: boolean;
  flash: boolean;
}

interface UseNotificationFeedbackOptions {
  settings: NotificationSettings;
  volume?: number; // 0.0 - 1.0
}

// Sound frequencies for different notification types
const SOUND_CONFIG: Record<NotificationType, { frequency: number; duration: number; pattern: number[] }> = {
  info: { frequency: 600, duration: 100, pattern: [1] },
  success: { frequency: 880, duration: 80, pattern: [1, 0.5, 1] }, // Two-tone up
  warning: { frequency: 440, duration: 150, pattern: [1, 0.3, 1] },
  error: { frequency: 300, duration: 200, pattern: [1, 0.2, 1, 0.2, 1] },
  trade: { frequency: 1000, duration: 60, pattern: [1, 0.3, 1.2, 0.3, 1.5] }, // Ascending tones
};

// Vibration patterns in milliseconds (vibrate, pause, vibrate, ...)
const VIBRATION_PATTERNS: Record<NotificationType, number[]> = {
  info: [50],
  success: [50, 50, 100],
  warning: [100, 50, 100],
  error: [200, 100, 200],
  trade: [50, 30, 50, 30, 100],
};

export function useNotificationFeedback({ settings, volume = 0.3 }: UseNotificationFeedbackOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const isInitializedRef = useRef(false);

  // Initialize AudioContext on first user interaction
  const initAudio = useCallback(() => {
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        isInitializedRef.current = true;
      } catch {
        console.warn('Web Audio API not supported');
      }
    }
    // Resume if suspended (browser autoplay policy)
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }
  }, []);

  // Initialize on mount with user gesture detection
  useEffect(() => {
    const handleInteraction = () => {
      initAudio();
      // Remove listeners after first interaction
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('touchstart', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
    };

    document.addEventListener('click', handleInteraction);
    document.addEventListener('touchstart', handleInteraction);
    document.addEventListener('keydown', handleInteraction);

    return () => {
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('touchstart', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
    };
  }, [initAudio]);

  // Play notification sound
  const playSound = useCallback((type: NotificationType) => {
    if (!settings.sound) return;
    
    initAudio();
    const ctx = audioContextRef.current;
    if (!ctx) return;

    const config = SOUND_CONFIG[type];
    let startTime = ctx.currentTime;

    config.pattern.forEach((freqMultiplier) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = config.frequency * freqMultiplier;
      oscillator.type = type === 'trade' ? 'triangle' : 'sine';

      // Envelope: attack, sustain, release
      const duration = config.duration / 1000;
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.01);
      gainNode.gain.setValueAtTime(volume, startTime + duration * 0.7);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);

      // Gap between notes
      startTime += duration + 0.05;
    });
  }, [settings.sound, volume, initAudio]);

  // Trigger haptic feedback
  const vibrate = useCallback((type: NotificationType) => {
    if (!settings.vibration) return;
    
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(VIBRATION_PATTERNS[type]);
      } catch {
        // Vibration not supported or blocked
      }
    }
  }, [settings.vibration]);

  // Combined notification trigger
  const notify = useCallback((type: NotificationType = 'info') => {
    if (settings.sound) {
      playSound(type);
    }
    if (settings.vibration) {
      vibrate(type);
    }
  }, [settings.sound, settings.vibration, playSound, vibrate]);

  // Notify specifically for trading events
  const notifyTrade = useCallback((isExecuted: boolean) => {
    notify(isExecuted ? 'trade' : 'info');
  }, [notify]);

  // Notify for new decision
  const notifyDecision = useCallback((decisionType: string, isExecuted: boolean) => {
    if (isExecuted) {
      notify('trade');
    } else if (decisionType === 'buy' || decisionType === 'sell') {
      notify('success');
    } else if (decisionType === 'skip') {
      // Silent for skips
    } else {
      notify('info');
    }
  }, [notify]);

  return {
    notify,
    notifyTrade,
    notifyDecision,
    playSound,
    vibrate,
    initAudio,
  };
}
