/**
 * Centralized outbound provider gate.
 *
 * Every external market-data / news call should go through providerCall so
 * we can enforce free-tier caps server-side, persist counters, and serve
 * stale cache when a provider is over quota.
 *
 * Flow:
 *   1. Fresh cache hit?               → return, no call
 *   2. Quota check fails?             → if allowStale and a stale row exists,
 *                                        return it with stale=true; else throw
 *                                        ProviderQuotaError
 *   3. Record request, execute fetch  → cache result, return
 *
 * `fetchFn` must resolve to the raw data payload. providerCall owns caching
 * and counter bookkeeping; the caller stays ignorant of the cache layer.
 */

import * as stockCache from './stockCache.js';
import logger from './logger.js';

export class ProviderQuotaError extends Error {
  constructor(provider, reason) {
    super(`${provider} quota exhausted (${reason})`);
    this.name = 'ProviderQuotaError';
    this.provider = provider;
    this.reason = reason; // 'perDay' | 'perMonth' | 'perMinute' | 'cooldown'
  }
}

/**
 * @param {string} provider
 * @param {() => Promise<any>} fetchFn
 * @param {object} opts
 * @param {string} opts.cacheKey   — required. Unique key for read-through + stale lookup.
 * @param {string} opts.cacheType  — see CACHE_DURATIONS keys (quote, candles_*, news, …).
 * @param {string} [opts.symbol]
 * @param {string} opts.source     — display name written to the cache row.
 * @param {number} opts.ttlSeconds
 * @param {boolean} [opts.allowStale=true] — serve expired cache if live call is blocked.
 *        Set false for time-critical data where stale answers are dangerous (live quotes).
 * @param {boolean} [opts.skipCacheRead=false] — force a fresh call even if cache is warm.
 */
export async function providerCall(provider, fetchFn, opts) {
  if (!opts || typeof opts !== 'object') throw new Error('providerCall: opts required');
  const { cacheKey, cacheType, symbol, source, ttlSeconds, allowStale = true, skipCacheRead = false } = opts;
  if (!cacheKey) throw new Error('providerCall: cacheKey required');
  if (!cacheType) throw new Error('providerCall: cacheType required');
  if (!source) throw new Error('providerCall: source required');
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new Error('providerCall: ttlSeconds must be > 0');
  if (typeof fetchFn !== 'function') throw new Error('providerCall: fetchFn must be a function');

  // 1. Fresh cache
  if (!skipCacheRead) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      return { data: cached.data, source: cached.source, fromCache: true, stale: false };
    }
  }

  // 2. Quota gate
  const quota = stockCache.checkQuota(provider);
  if (!quota.ok) {
    await stockCache.recordBlock(provider);
    logger.warn(`[ProviderCall] ${provider} blocked (${quota.reason})`);
    if (allowStale) {
      const stale = await stockCache.getStaleCached(cacheKey);
      if (stale) {
        await stockCache.recordStaleServed(provider);
        return { data: stale.data, source: stale.source, fromCache: true, stale: true, quotaReason: quota.reason };
      }
    }
    throw new ProviderQuotaError(provider, quota.reason);
  }

  // 3. Live call + persist
  let data;
  try {
    await stockCache.recordRequest(provider);
    data = await fetchFn();
  } catch (e) {
    logger.error(`[ProviderCall] ${provider} fetch failed: ${e.message}`);
    // On fetch failure we've already counted the request (the provider
    // likely received it). If a stale cache row exists, prefer it over
    // bubbling the error — a bad live call shouldn't kill the UX.
    if (allowStale) {
      const stale = await stockCache.getStaleCached(cacheKey);
      if (stale) {
        await stockCache.recordStaleServed(provider);
        return { data: stale.data, source: stale.source, fromCache: true, stale: true, fetchError: e.message };
      }
    }
    throw e;
  }

  await stockCache.setCache(cacheKey, cacheType, symbol || null, data, source, ttlSeconds);
  return { data, source, fromCache: false, stale: false };
}

export default { providerCall, ProviderQuotaError };
