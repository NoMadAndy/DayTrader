import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isCacheValid, type CachedWatchlistSignals } from '../services/watchlistCacheService';

function makeCachedSignals(overrides: Partial<CachedWatchlistSignals> = {}): CachedWatchlistSignals {
  return {
    symbol: 'AAPL',
    signals: {
      hourly: { action: 'buy', score: 0.7, contributions: [] },
      daily: { action: 'hold', score: 0.5, contributions: [] },
      weekly: { action: 'sell', score: 0.3, contributions: [] },
      longTerm: { action: 'buy', score: 0.8, contributions: [] },
      market_impact: 'neutral',
      market_impact_en: 'neutral',
    },
    sources: { hasNews: false, hasML: false, hasRL: false },
    cachedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    ...overrides,
  };
}

describe('watchlistCacheService', () => {
  describe('isCacheValid', () => {
    it('returns true when cache has not expired', () => {
      const data = makeCachedSignals({
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
      expect(isCacheValid(data)).toBe(true);
    });

    it('returns false when cache has expired', () => {
      const data = makeCachedSignals({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      expect(isCacheValid(data)).toBe(false);
    });

    it('returns false when expiresAt is missing', () => {
      const data = makeCachedSignals({ expiresAt: '' });
      expect(isCacheValid(data)).toBe(false);
    });
  });
});
