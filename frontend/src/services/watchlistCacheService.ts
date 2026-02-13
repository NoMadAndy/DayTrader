/**
 * Watchlist Signal Cache Service
 * 
 * Provides caching for computed trading signals in the watchlist.
 * Uses server-side PostgreSQL cache with configurable TTL.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export interface CachedWatchlistSignals {
  symbol: string;
  signals: {
    hourly: { action: string; score: number; contributions: unknown[] };
    daily: { action: string; score: number; contributions: unknown[] };
    weekly: { action: string; score: number; contributions: unknown[] };
    longTerm: { action: string; score: number; contributions: unknown[] };
    market_impact: string;
    market_impact_en: string;
  };
  sources: {
    hasNews: boolean;
    hasML: boolean;
    hasRL: boolean;
    newsSentiment?: number;
    mlPrediction?: { predicted_direction: string; predicted_change_percent: number };
    rlSignals?: Array<{ agent_name: string; action: string; confidence: number }>;
  };
  cachedAt: string;
  expiresAt: string;
}

/**
 * Get cached signals for a symbol
 */
export async function getCachedSignals(symbol: string): Promise<CachedWatchlistSignals | null> {
  try {
    const response = await fetch(`${API_BASE}/watchlist/signals/${symbol}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null; // Not cached
      }
      throw new Error(`Failed to get cached signals: ${response.status}`);
    }

    const data = await response.json();
    return data.cache?.data || null;
  } catch (error) {
    log.warn('Error fetching cached signals:', error);
    return null;
  }
}

/**
 * Store signals in cache
 */
export async function setCachedSignals(
  symbol: string, 
  signals: CachedWatchlistSignals['signals'],
  sources: CachedWatchlistSignals['sources'],
  ttlSeconds: number = 900 // 15 minutes default
): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/watchlist/signals/${symbol}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ signals, sources, ttlSeconds }),
    });

    return response.ok;
  } catch (error) {
    log.warn('Error caching signals:', error);
    return false;
  }
}

/**
 * Get cached signals for multiple symbols in batch
 */
export async function getBatchCachedSignals(symbols: string[]): Promise<Map<string, CachedWatchlistSignals>> {
  const result = new Map<string, CachedWatchlistSignals>();
  
  if (symbols.length === 0) {
    return result;
  }

  try {
    const response = await fetch(`${API_BASE}/watchlist/signals/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ symbols }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get batch cached signals: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.results) {
      for (const [symbol, cacheData] of Object.entries(data.results)) {
        const cache = cacheData as { data?: CachedWatchlistSignals };
        if (cache?.data) {
          result.set(symbol, cache.data);
        }
      }
    }
  } catch (error) {
    log.warn('Error fetching batch cached signals:', error);
  }

  return result;
}

/**
 * Clear cached signals for a symbol
 */
export async function clearCachedSignals(symbol: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/watchlist/signals/${symbol}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    return response.ok;
  } catch (error) {
    log.warn('Error clearing cached signals:', error);
    return false;
  }
}

/**
 * Check if cached data is still valid
 */
export function isCacheValid(cachedData: CachedWatchlistSignals): boolean {
  if (!cachedData.expiresAt) {
    return false;
  }
  const expiresAt = new Date(cachedData.expiresAt);
  return expiresAt > new Date();
}
