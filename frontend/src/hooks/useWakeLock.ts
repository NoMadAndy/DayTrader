/**
 * Screen Wake Lock Hook
 * 
 * Keeps the screen on for mobile devices (iOS/Android).
 * Uses the Screen Wake Lock API with fallback for older browsers.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { log } from '../utils/logger';

interface WakeLockSentinel {
  released: boolean;
  type: 'screen';
  release(): Promise<void>;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface UseWakeLockResult {
  isSupported: boolean;
  isActive: boolean;
  request: () => Promise<void>;
  release: () => Promise<void>;
  toggle: () => Promise<void>;
}

export function useWakeLock(): UseWakeLockResult {
  const [isSupported, setIsSupported] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const noSleepVideoRef = useRef<HTMLVideoElement | null>(null);

  // Check if Wake Lock API is supported
  useEffect(() => {
    const supported = 'wakeLock' in navigator;
    setIsSupported(supported);
    
    // For iOS Safari that doesn't support Wake Lock API,
    // we'll use a video-based workaround
    const userAgent = window.navigator?.userAgent || '';
    if (!supported && /iPhone|iPad|iPod/.test(userAgent)) {
      setIsSupported(true); // We have a fallback
    }
  }, []);

  // Re-acquire wake lock when page becomes visible again
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && isActive) {
        // Re-acquire when page becomes visible
        await requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      releaseWakeLock();
    };
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      // Try native Wake Lock API first
      if ('wakeLock' in navigator) {
        const nav = navigator as Navigator & { wakeLock: { request: (type: string) => Promise<WakeLockSentinel> } };
        wakeLockRef.current = await nav.wakeLock.request('screen');
        
        wakeLockRef.current.addEventListener('release', () => {
          log.info('Wake Lock released');
        });
        
        setIsActive(true);
        log.info('Wake Lock acquired via API');
        return;
      }

      // iOS Safari fallback: Use a looping video to prevent sleep
      const userAgent = window.navigator?.userAgent || '';
      if (/iPhone|iPad|iPod/.test(userAgent)) {
        if (!noSleepVideoRef.current) {
          // Create a tiny video element
          const video = document.createElement('video');
          video.setAttribute('playsinline', '');
          video.setAttribute('muted', '');
          video.style.position = 'fixed';
          video.style.top = '-1px';
          video.style.left = '-1px';
          video.style.width = '1px';
          video.style.height = '1px';
          video.style.opacity = '0';
          video.style.pointerEvents = 'none';
          
          // Use a data URL for a tiny MP4 (1x1 pixel, silent)
          video.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAA7VtZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE1OSByMjk5MSBNOTMzN2UgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDE5IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA9liIQAV/0TAAYdeBTXzg8AAALvbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAhl0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAASAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAGRbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAHABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABPG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAPxzdGJsAAAAkHN0c2QAAAAAAAAAAQAAAIBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAEgASAEgAAABIAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY//8AAAAuYXZjQwFkAAr/4QATZGQACU4VU9FAIAAAAwAEAAADAKA8YMZYAQAFaOvssiwAAAAQcGFzcAAAAAEAAAABAAAAGHN0dHMAAAAAAAAAAQAAAAEAABwAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAAQAAABRzdHN6AAAAAAAAAtgAAAABAAAAFHN0Y28AAAAAAAAAAQAAADAAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjU4LjI5LjEwMA==';
          video.loop = true;
          
          document.body.appendChild(video);
          noSleepVideoRef.current = video;
        }
        
        await noSleepVideoRef.current.play();
        setIsActive(true);
        log.info('Wake Lock acquired via video workaround (iOS)');
        return;
      }

      log.warn('Wake Lock not supported on this browser');
    } catch (err) {
      log.error('Failed to acquire Wake Lock:', err);
      setIsActive(false);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      // Release native Wake Lock
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }

      // Stop iOS video workaround
      if (noSleepVideoRef.current) {
        noSleepVideoRef.current.pause();
        noSleepVideoRef.current.remove();
        noSleepVideoRef.current = null;
      }

      setIsActive(false);
      log.info('Wake Lock released');
    } catch (err) {
      log.error('Failed to release Wake Lock:', err);
    }
  }, []);

  const toggle = useCallback(async () => {
    if (isActive) {
      await releaseWakeLock();
    } else {
      await requestWakeLock();
    }
  }, [isActive, requestWakeLock, releaseWakeLock]);

  return {
    isSupported,
    isActive,
    request: requestWakeLock,
    release: releaseWakeLock,
    toggle,
  };
}
