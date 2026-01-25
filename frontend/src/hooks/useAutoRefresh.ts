/**
 * Auto-Refresh Hook for Real-Time Stock Updates
 * 
 * Provides intelligent auto-refresh based on:
 * - Available API quota
 * - Page visibility (foreground vs background)
 * - User's watchlist
 * - Rate limiter configuration
 * 
 * Features:
 * - Adaptive refresh intervals based on API limits
 * - Background sync via Service Worker
 * - Visibility-aware polling (slower when tab is hidden)
 * - Efficient batched updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDataService } from './useDataService';
import type { QuoteData, DataSourceType } from '../services/types';
import { PROVIDER_RATE_LIMITS } from '../services/rateLimiter';

// Minimum and maximum refresh intervals (in ms)
const MIN_REFRESH_INTERVAL = 15000;  // 15 seconds minimum
const MAX_REFRESH_INTERVAL = 300000; // 5 minutes maximum
const BACKGROUND_MULTIPLIER = 3;     // Slow down 3x when page is hidden

interface AutoRefreshConfig {
  symbols: string[];
  enabled?: boolean;
  onQuotesUpdate?: (quotes: Map<string, QuoteData>) => void;
  onError?: (error: Error) => void;
}

interface AutoRefreshState {
  quotes: Map<string, QuoteData>;
  lastUpdate: Date | null;
  nextUpdate: Date | null;
  refreshInterval: number;
  isRefreshing: boolean;
  isPaused: boolean;
  error: Error | null;
}

interface AutoRefreshActions {
  refresh: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  setSymbols: (symbols: string[]) => void;
}

/**
 * Calculate optimal refresh interval based on API quota
 */
function calculateOptimalInterval(
  source: DataSourceType,
  symbolCount: number,
  remainingQuota: { daily: number; perMinute: number }
): number {
  const config = PROVIDER_RATE_LIMITS[source];
  
  // If mock, use fast interval
  if (source === 'mock') {
    return MIN_REFRESH_INTERVAL;
  }
  
  // Calculate based on per-minute limit
  // We want to use at most 50% of available per-minute quota for auto-refresh
  const quotaForAutoRefresh = Math.floor(config.requestsPerMinute * 0.5);
  
  if (quotaForAutoRefresh <= 0 || symbolCount <= 0) {
    return MAX_REFRESH_INTERVAL;
  }
  
  // Time per request cycle (in ms)
  // If we have N symbols and can make M requests per minute,
  // we can refresh all symbols M/N times per minute
  const refreshesPerMinute = quotaForAutoRefresh / symbolCount;
  const intervalMs = Math.ceil(60000 / refreshesPerMinute);
  
  // Consider daily limit as well
  // If daily limit is tight, slow down
  const remainingHours = (24 - new Date().getHours());
  const requestsNeededPerHour = (symbolCount * 60) / (intervalMs / 60000);
  const requestsPerHourBudget = remainingQuota.daily / remainingHours;
  
  if (requestsNeededPerHour > requestsPerHourBudget) {
    // Need to slow down to stay within daily budget
    const adjustedInterval = Math.ceil((symbolCount * 3600000) / requestsPerHourBudget);
    return Math.min(Math.max(adjustedInterval, MIN_REFRESH_INTERVAL), MAX_REFRESH_INTERVAL);
  }
  
  // Also respect the cooldown
  const minByConfig = Math.max(config.cooldownMs * symbolCount, MIN_REFRESH_INTERVAL);
  
  return Math.min(Math.max(intervalMs, minByConfig), MAX_REFRESH_INTERVAL);
}

/**
 * Hook for automatic quote refreshing
 */
export function useAutoRefresh(config: AutoRefreshConfig): [AutoRefreshState, AutoRefreshActions] {
  const { dataService, preferredSource } = useDataService();
  const [state, setState] = useState<AutoRefreshState>({
    quotes: new Map(),
    lastUpdate: null,
    nextUpdate: null,
    refreshInterval: 60000,
    isRefreshing: false,
    isPaused: false,
    error: null,
  });
  
  const symbolsRef = useRef<string[]>(config.symbols);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const enabledRef = useRef(config.enabled !== false);
  const isVisibleRef = useRef(!document.hidden);
  
  // Update symbols ref when config changes
  useEffect(() => {
    symbolsRef.current = config.symbols;
    
    // Update Service Worker with watchlist
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'UPDATE_WATCHLIST',
        payload: { symbols: config.symbols }
      });
    }
  }, [config.symbols]);
  
  // Fetch quotes for all symbols
  const fetchQuotes = useCallback(async () => {
    const symbols = symbolsRef.current;
    if (symbols.length === 0) return;
    
    setState(prev => ({ ...prev, isRefreshing: true, error: null }));
    
    const newQuotes = new Map<string, QuoteData>();
    const errors: Error[] = [];
    
    // Fetch in batches to respect rate limits
    const batchSize = 3;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (symbol) => {
          try {
            const quote = await dataService.fetchQuote(symbol);
            if (quote) {
              newQuotes.set(symbol, quote);
            }
          } catch (e) {
            errors.push(e instanceof Error ? e : new Error(`Failed to fetch ${symbol}`));
          }
        })
      );
      
      // Small delay between batches
      if (i + batchSize < symbols.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    const now = new Date();
    
    // Calculate next optimal interval
    const rateLimiter = dataService.getRateLimiter();
    const quota = rateLimiter.getRemainingQuota(preferredSource);
    const optimalInterval = calculateOptimalInterval(preferredSource, symbols.length, quota);
    
    // Adjust for visibility
    const adjustedInterval = isVisibleRef.current 
      ? optimalInterval 
      : optimalInterval * BACKGROUND_MULTIPLIER;
    
    setState(prev => ({
      ...prev,
      quotes: newQuotes,
      lastUpdate: now,
      nextUpdate: new Date(now.getTime() + adjustedInterval),
      refreshInterval: adjustedInterval,
      isRefreshing: false,
      error: errors.length > 0 ? errors[0] : null,
    }));
    
    // Call callback
    if (config.onQuotesUpdate) {
      config.onQuotesUpdate(newQuotes);
    }
    
    if (errors.length > 0 && config.onError) {
      config.onError(errors[0]);
    }
    
    return adjustedInterval;
  }, [dataService, preferredSource, config]);
  
  // Set up refresh interval
  const setupInterval = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    if (!enabledRef.current || state.isPaused) return;
    
    // Initial fetch
    const interval = await fetchQuotes() || 60000;
    
    // Set up recurring fetch
    intervalRef.current = setInterval(async () => {
      if (!enabledRef.current || state.isPaused) return;
      
      const newInterval = await fetchQuotes();
      
      // If interval changed significantly, reset the timer
      if (newInterval && Math.abs(newInterval - interval) > 5000) {
        setupInterval();
      }
    }, interval);
  }, [fetchQuotes, state.isPaused]);
  
  // Handle visibility changes
  useEffect(() => {
    const handleVisibility = () => {
      const wasVisible = isVisibleRef.current;
      isVisibleRef.current = !document.hidden;
      
      // If becoming visible after being hidden, refresh immediately
      if (!wasVisible && isVisibleRef.current && enabledRef.current && !state.isPaused) {
        fetchQuotes().then((interval) => {
          if (interval) {
            setupInterval();
          }
        });
      } else if (wasVisible && !isVisibleRef.current) {
        // Slow down when going to background
        setupInterval();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [fetchQuotes, setupInterval, state.isPaused]);
  
  // Listen for Service Worker updates
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'QUOTES_UPDATED') {
        const swQuotes = event.data.quotes;
        const newQuotes = new Map<string, QuoteData>();
        
        Object.entries(swQuotes).forEach(([symbol, data]: [string, any]) => {
          if (data.data) {
            newQuotes.set(symbol, data.data);
          }
        });
        
        if (newQuotes.size > 0) {
          setState(prev => ({
            ...prev,
            quotes: new Map([...prev.quotes, ...newQuotes]),
            lastUpdate: new Date(),
          }));
          
          if (config.onQuotesUpdate) {
            config.onQuotesUpdate(newQuotes);
          }
        }
      }
    };
    
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleMessage);
      return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
    }
  }, [config]);
  
  // Initial setup
  useEffect(() => {
    if (config.enabled !== false) {
      setupInterval();
    }
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [setupInterval, config.enabled]);
  
  // Actions
  const actions: AutoRefreshActions = {
    refresh: async () => {
      await fetchQuotes();
    },
    pause: () => {
      setState(prev => ({ ...prev, isPaused: true }));
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    },
    resume: () => {
      setState(prev => ({ ...prev, isPaused: false }));
      setupInterval();
    },
    setSymbols: (symbols: string[]) => {
      symbolsRef.current = symbols;
      fetchQuotes();
    },
  };
  
  return [state, actions];
}

/**
 * Hook for registering and managing the Service Worker
 */
export function useServiceWorker() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [periodicSyncSupported, setPeriodicSyncSupported] = useState(false);
  
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      console.log('[SW] Service Worker not supported');
      return;
    }
    
    setIsSupported(true);
    
    // Register Service Worker
    navigator.serviceWorker.register('/sw.js')
      .then(async (reg) => {
        console.log('[SW] Service Worker registered:', reg.scope);
        setRegistration(reg);
        
        // Check for Periodic Background Sync support
        if ('periodicSync' in reg) {
          try {
            const status = await navigator.permissions.query({
              name: 'periodic-background-sync' as PermissionName,
            });
            
            if (status.state === 'granted') {
              setPeriodicSyncSupported(true);
              
              // Register periodic sync (every 15 minutes minimum)
              await (reg as any).periodicSync.register('update-quotes', {
                minInterval: 15 * 60 * 1000, // 15 minutes
              });
              console.log('[SW] Periodic sync registered');
            }
          } catch (e) {
            console.log('[SW] Periodic sync not available:', e);
          }
        }
        
        // Register regular background sync
        if ('sync' in reg) {
          try {
            await (reg as any).sync.register('update-quotes');
            console.log('[SW] Background sync registered');
          } catch (e) {
            console.log('[SW] Background sync not available:', e);
          }
        }
      })
      .catch((err) => {
        console.error('[SW] Service Worker registration failed:', err);
      });
  }, []);
  
  const triggerSync = useCallback(() => {
    if (registration && 'sync' in registration) {
      (registration as any).sync.register('update-quotes').catch(console.error);
    } else if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'MANUAL_SYNC' });
    }
  }, [registration]);
  
  return {
    registration,
    isSupported,
    periodicSyncSupported,
    triggerSync,
  };
}

/**
 * Format refresh interval for display
 */
export function formatRefreshInterval(ms: number): string {
  if (ms < 60000) {
    return `${Math.round(ms / 1000)}s`;
  }
  return `${Math.round(ms / 60000)}min`;
}

/**
 * Format time until next refresh
 */
export function formatTimeUntilRefresh(nextUpdate: Date | null): string {
  if (!nextUpdate) return '-';
  
  const now = Date.now();
  const diff = nextUpdate.getTime() - now;
  
  if (diff <= 0) return 'Jetzt';
  if (diff < 60000) return `${Math.round(diff / 1000)}s`;
  return `${Math.round(diff / 60000)}min`;
}
