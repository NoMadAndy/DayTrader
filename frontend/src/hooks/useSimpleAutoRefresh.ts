/**
 * useSimpleAutoRefresh Hook
 * 
 * Simple, stable auto-refresh that polls at regular intervals.
 * - Uses refs to avoid React dependency loops
 * - Pauses when tab is hidden
 * - Does not interfere with user interactions
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { log } from '../utils/logger';

interface SimpleAutoRefreshState {
  isRefreshing: boolean;
  lastRefresh: Date | null;
  isActive: boolean;
}

interface UseSimpleAutoRefreshOptions {
  /** Refresh interval in ms (default: 1000 = 1s) */
  interval?: number;
  /** Whether auto-refresh is enabled (default: true) */
  enabled?: boolean;
}

/**
 * Stable auto-refresh hook that won't cause infinite loops.
 * 
 * IMPORTANT: The onRefresh callback should be stable (wrapped in useCallback with [])
 * or this hook will use a ref to always call the latest version safely.
 * 
 * @param onRefresh - Function to call on each refresh. Can be async.
 * @param options - Configuration options
 */
export function useSimpleAutoRefresh(
  onRefresh: () => void | Promise<void>,
  options: UseSimpleAutoRefreshOptions = {}
) {
  const { interval = 1000, enabled = true } = options;

  const [state, setState] = useState<SimpleAutoRefreshState>({
    isRefreshing: false,
    lastRefresh: null,
    isActive: !document.hidden,
  });

  // Store callback in ref to avoid dependency issues - this is key to stability
  const onRefreshRef = useRef(onRefresh);
  const isRefreshingRef = useRef(false);
  const mountedRef = useRef(true);

  // Update ref when callback changes (without triggering effects)
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  });

  // Track mount state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Handle visibility changes
  useEffect(() => {
    const handleVisibility = () => {
      if (mountedRef.current) {
        setState(prev => ({ ...prev, isActive: !document.hidden }));
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Main interval effect - dependencies are minimal and stable
  useEffect(() => {
    if (!enabled) return;

    const tick = async () => {
      // Skip if already refreshing, unmounted, or tab is hidden
      if (isRefreshingRef.current || !mountedRef.current || document.hidden) {
        return;
      }

      isRefreshingRef.current = true;
      if (mountedRef.current) {
        setState(prev => ({ ...prev, isRefreshing: true }));
      }

      try {
        await onRefreshRef.current();
        if (mountedRef.current) {
          setState(prev => ({
            ...prev,
            isRefreshing: false,
            lastRefresh: new Date(),
          }));
        }
      } catch (error) {
        // Silently handle errors - don't spam console
        if (mountedRef.current) {
          setState(prev => ({ ...prev, isRefreshing: false }));
        }
      } finally {
        isRefreshingRef.current = false;
      }
    };

    const timerId = window.setInterval(tick, interval);

    return () => {
      window.clearInterval(timerId);
    };
  }, [enabled, interval]); // Only re-run if enabled/interval changes - NOT callback!

  // Manual refresh function
  const refresh = useCallback(async () => {
    if (isRefreshingRef.current || !mountedRef.current) return;

    isRefreshingRef.current = true;
    setState(prev => ({ ...prev, isRefreshing: true }));

    try {
      await onRefreshRef.current();
      if (mountedRef.current) {
        setState(prev => ({
          ...prev,
          isRefreshing: false,
          lastRefresh: new Date(),
        }));
      }
    } catch (error) {
      log.error('Manual refresh error:', error);
      if (mountedRef.current) {
        setState(prev => ({ ...prev, isRefreshing: false }));
      }
    } finally {
      isRefreshingRef.current = false;
    }
  }, []);

  return {
    ...state,
    refresh,
  };
}
