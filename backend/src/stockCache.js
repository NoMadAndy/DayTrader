/**
 * Stock Data Cache Module
 * 
 * Provides server-side caching for stock market data to:
 * - Reduce API calls across all users (shared cache)
 * - Centrally manage rate limits
 * - Persist data across server restarts
 * 
 * Cache is NOT tenant-scoped - stock prices are public data
 * that can be shared across all users.
 */

import db from './db.js';
import logger from './logger.js';

// Cache durations in seconds
const CACHE_DURATIONS = {
  quote: 60,           // 1 minute for real-time quotes
  candles_intraday: 300, // 5 minutes for intraday data
  candles_daily: 3600,  // 1 hour for daily historical data
  search: 86400,       // 24 hours for symbol search results
  news: 900,           // 15 minutes for news
  company_info: 86400, // 24 hours for company info
};

function getDayStart() {
  // UTC day-start so counters rollover consistently across timezones/containers.
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function getMonthStart() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Provider free-tier limits. Override per ENV:
 *   PROVIDER_LIMIT_<PROVIDER>_PER_DAY
 *   PROVIDER_LIMIT_<PROVIDER>_PER_MINUTE
 *   PROVIDER_LIMIT_<PROVIDER>_PER_MONTH
 *   PROVIDER_LIMIT_<PROVIDER>_COOLDOWN_MS
 * Use Infinity (pass -1 via ENV) to disable a dimension.
 */
function buildLimits(provider, defaults) {
  const upper = provider.replace(/([A-Z])/g, '_$1').toUpperCase();
  const raw = (name) => envInt(`PROVIDER_LIMIT_${upper}_${name}`, null);
  const merge = (envVal, def) => {
    if (envVal === null) return def;
    if (envVal < 0) return Infinity;
    return envVal;
  };
  return {
    perDay: merge(raw('PER_DAY'), defaults.perDay ?? Infinity),
    perMinute: merge(raw('PER_MINUTE'), defaults.perMinute ?? Infinity),
    perMonth: merge(raw('PER_MONTH'), defaults.perMonth ?? Infinity),
    cooldownMs: merge(raw('COOLDOWN_MS'), defaults.cooldownMs ?? 0),
  };
}

// Provider limits (free-tier defaults, ENV-overridable)
const PROVIDER_LIMITS = {
  alphaVantage: buildLimits('alphaVantage', { perDay: 25, perMinute: 5, cooldownMs: 12000 }),
  twelveData:   buildLimits('twelveData',   { perDay: 800, perMinute: 8, cooldownMs: 8000 }),
  finnhub:      buildLimits('finnhub',      { perMinute: 60, cooldownMs: 1000 }),
  yahoo:        buildLimits('yahoo',        { perMinute: 100, cooldownMs: 500 }),
  newsapi:      buildLimits('newsapi',      { perDay: 100 }),
  newsdata:     buildLimits('newsdata',     { perDay: 200 }),
  marketaux:    buildLimits('marketaux',    { perDay: 100 }),
  fmp:          buildLimits('fmp',          { perDay: 250 }),
  tiingo:       buildLimits('tiingo',       { perMonth: 50000 }),
  mediastack:   buildLimits('mediastack',   { perMonth: 500 }),
};

function freshState() {
  return {
    requestsToday: 0,
    requestsThisMinute: 0,
    requestsThisMonth: 0,
    blockedToday: 0,
    staleServedToday: 0,
    lastRequest: 0,
    minuteWindowStart: 0,
    dayStart: getDayStart(),
    monthStart: getMonthStart(),
  };
}

// Rate-limit tracking (in-memory write-through; DB is source of truth on startup)
const rateLimitState = {};
for (const name of Object.keys(PROVIDER_LIMITS)) {
  rateLimitState[name] = freshState();
}

/**
 * Initialize cache table in database
 */
export async function initializeCacheTable() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Create stock_data_cache table
    // This is NOT tenant-scoped - stock data is public
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_data_cache (
        id SERIAL PRIMARY KEY,
        cache_key VARCHAR(255) UNIQUE NOT NULL,
        cache_type VARCHAR(50) NOT NULL,
        symbol VARCHAR(20),
        data JSONB NOT NULL,
        source VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        hit_count INTEGER DEFAULT 0
      );
    `);

    // Create indexes for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cache_key ON stock_data_cache(cache_key);
      CREATE INDEX IF NOT EXISTS idx_cache_expires ON stock_data_cache(expires_at);
      CREATE INDEX IF NOT EXISTS idx_cache_symbol ON stock_data_cache(symbol);
      CREATE INDEX IF NOT EXISTS idx_cache_type ON stock_data_cache(cache_type);
    `);

    // Create rate_limit_stats table for persistent tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_rate_limit_stats (
        id SERIAL PRIMARY KEY,
        provider VARCHAR(50) UNIQUE NOT NULL,
        requests_today INTEGER DEFAULT 0,
        day_start TIMESTAMP WITH TIME ZONE,
        last_request TIMESTAMP WITH TIME ZONE,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Additive columns for monthly budget + governance counters.
    await client.query(`
      ALTER TABLE api_rate_limit_stats
        ADD COLUMN IF NOT EXISTS requests_this_month INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS month_start TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS blocked_today INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS stale_served_today INTEGER DEFAULT 0
    `);

    await client.query('COMMIT');
    logger.info('Cache tables initialized successfully');

    // Hydrate in-memory counters from DB (survives container restart).
    await loadRateLimitStateFromDB().catch((err) => {
      logger.warn(`[RateLimit] hydrate from DB failed: ${err.message}`);
    });
  } catch (e) {
    await client.query('ROLLBACK');
    logger.error('Cache table initialization error:', e);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Get cached data if valid
 * @param {string} cacheKey - Unique cache key
 * @returns {Promise<object|null>} Cached data or null
 */
export async function getCached(cacheKey) {
  try {
    const result = await db.query(
      `UPDATE stock_data_cache 
       SET hit_count = hit_count + 1 
       WHERE cache_key = $1 AND expires_at > CURRENT_TIMESTAMP 
       RETURNING data, source, created_at`,
      [cacheKey]
    );
    
    if (result.rows.length > 0) {
      logger.info(`Cache HIT: ${cacheKey}`);
      return {
        data: result.rows[0].data,
        source: result.rows[0].source,
        cachedAt: result.rows[0].created_at,
        fromCache: true,
      };
    }
    
    logger.info(`Cache MISS: ${cacheKey}`);
    return null;
  } catch (e) {
    logger.error('Cache get error:', e);
    return null;
  }
}

/**
 * Store data in cache
 * @param {string} cacheKey - Unique cache key
 * @param {string} cacheType - Type of cache (quote, candles, etc.)
 * @param {string} symbol - Stock symbol
 * @param {object} data - Data to cache
 * @param {string} source - Data source provider
 * @param {number} ttlSeconds - Time to live in seconds
 */
export async function setCache(cacheKey, cacheType, symbol, data, source, ttlSeconds) {
  try {
    await db.query(
      `INSERT INTO stock_data_cache (cache_key, cache_type, symbol, data, source, expires_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + INTERVAL '1 second' * $6)
       ON CONFLICT (cache_key) 
       DO UPDATE SET 
         data = EXCLUDED.data,
         source = EXCLUDED.source,
         created_at = CURRENT_TIMESTAMP,
         expires_at = CURRENT_TIMESTAMP + INTERVAL '1 second' * $6,
         hit_count = 0`,
      [cacheKey, cacheType, symbol, JSON.stringify(data), source, ttlSeconds]
    );
    logger.info(`Cache SET: ${cacheKey} (TTL: ${ttlSeconds}s)`);
  } catch (e) {
    logger.error('Cache set error:', e);
  }
}

/**
 * Clean up expired cache entries
 */
export async function cleanupExpiredCache() {
  try {
    const result = await db.query(
      'DELETE FROM stock_data_cache WHERE expires_at < CURRENT_TIMESTAMP'
    );
    if (result.rowCount > 0) {
      logger.info(`Cleaned up ${result.rowCount} expired cache entries`);
    }
    return result.rowCount;
  } catch (e) {
    logger.error('Cache cleanup error:', e);
    return 0;
  }
}

function rolloverIfNeeded(provider) {
  const state = rateLimitState[provider];
  if (!state) return;
  const day = getDayStart();
  const month = getMonthStart();
  if (state.dayStart !== day) {
    state.requestsToday = 0;
    state.blockedToday = 0;
    state.staleServedToday = 0;
    state.dayStart = day;
  }
  if (state.monthStart !== month) {
    state.requestsThisMonth = 0;
    state.monthStart = month;
  }
}

/**
 * Hydrate in-memory rate-limit counters from DB so container restarts
 * don't reset the daily/monthly quota. Silently ignores missing rows.
 */
export async function loadRateLimitStateFromDB() {
  const { rows } = await db.query(
    `SELECT provider, requests_today, requests_this_month, blocked_today, stale_served_today,
            day_start, month_start, last_request
       FROM api_rate_limit_stats`
  );
  const day = getDayStart();
  const month = getMonthStart();
  for (const r of rows) {
    const state = rateLimitState[r.provider];
    if (!state) continue;
    const dbDay = r.day_start ? new Date(r.day_start).getTime() : 0;
    const dbMonth = r.month_start ? new Date(r.month_start).getTime() : 0;
    state.requestsToday = dbDay === day ? (r.requests_today || 0) : 0;
    state.blockedToday = dbDay === day ? (r.blocked_today || 0) : 0;
    state.staleServedToday = dbDay === day ? (r.stale_served_today || 0) : 0;
    state.dayStart = day;
    state.requestsThisMonth = dbMonth === month ? (r.requests_this_month || 0) : 0;
    state.monthStart = month;
    state.lastRequest = r.last_request ? new Date(r.last_request).getTime() : 0;
  }
  logger.info(`[RateLimit] hydrated ${rows.length} provider counters from DB`);
}

async function persistProviderStats(provider) {
  const state = rateLimitState[provider];
  if (!state) return;
  try {
    await db.query(
      `INSERT INTO api_rate_limit_stats
         (provider, requests_today, day_start, last_request, updated_at,
          requests_this_month, month_start, blocked_today, stale_served_today)
       VALUES ($1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0), CURRENT_TIMESTAMP, $5, to_timestamp($6 / 1000.0), $7, $8)
       ON CONFLICT (provider) DO UPDATE SET
         requests_today = EXCLUDED.requests_today,
         day_start = EXCLUDED.day_start,
         last_request = EXCLUDED.last_request,
         updated_at = CURRENT_TIMESTAMP,
         requests_this_month = EXCLUDED.requests_this_month,
         month_start = EXCLUDED.month_start,
         blocked_today = EXCLUDED.blocked_today,
         stale_served_today = EXCLUDED.stale_served_today`,
      [
        provider,
        state.requestsToday,
        state.dayStart,
        state.lastRequest || Date.now(),
        state.requestsThisMonth,
        state.monthStart,
        state.blockedToday,
        state.staleServedToday,
      ]
    );
  } catch (e) {
    logger.error(`[RateLimit] persist ${provider} failed: ${e.message}`);
  }
}

/**
 * Check if we can make a request to a provider.
 * Returns {ok, reason} — reason is one of 'perDay' | 'perMonth' | 'perMinute' | 'cooldown' | null.
 * The simpler boolean form `canMakeRequest(provider)` is preserved for backward compat.
 */
export function checkQuota(provider) {
  const limits = PROVIDER_LIMITS[provider];
  const state = rateLimitState[provider];
  if (!limits || !state) return { ok: true, reason: null };

  rolloverIfNeeded(provider);
  const now = Date.now();
  if (now - state.minuteWindowStart > 60_000) {
    state.requestsThisMinute = 0;
    state.minuteWindowStart = now;
  }

  if (state.requestsToday >= limits.perDay) return { ok: false, reason: 'perDay' };
  if (state.requestsThisMonth >= limits.perMonth) return { ok: false, reason: 'perMonth' };
  if (state.requestsThisMinute >= limits.perMinute) return { ok: false, reason: 'perMinute' };
  if (limits.cooldownMs > 0 && now - state.lastRequest < limits.cooldownMs) {
    return { ok: false, reason: 'cooldown' };
  }
  return { ok: true, reason: null };
}

export function canMakeRequest(provider) {
  return checkQuota(provider).ok;
}

/**
 * Record a successful outbound call to a provider (increments counters +
 * writes the updated counts to api_rate_limit_stats).
 */
export async function recordRequest(provider) {
  const state = rateLimitState[provider];
  if (!state) return;
  rolloverIfNeeded(provider);
  const now = Date.now();
  if (now - state.minuteWindowStart > 60_000) {
    state.requestsThisMinute = 0;
    state.minuteWindowStart = now;
  }
  state.requestsToday++;
  state.requestsThisMonth++;
  state.requestsThisMinute++;
  state.lastRequest = now;
  await persistProviderStats(provider);
}

/** Counter for "would have called but blocked by quota". */
export async function recordBlock(provider) {
  const state = rateLimitState[provider];
  if (!state) return;
  rolloverIfNeeded(provider);
  state.blockedToday++;
  await persistProviderStats(provider);
}

/** Counter for "served expired cache because quota blocked us". */
export async function recordStaleServed(provider) {
  const state = rateLimitState[provider];
  if (!state) return;
  rolloverIfNeeded(provider);
  state.staleServedToday++;
  await persistProviderStats(provider);
}

/**
 * Stale-While-Revalidate fallback: return the most recent cached row for
 * this key even if it's expired. Only used by providerCall.js when quota
 * blocks a live call.
 */
export async function getStaleCached(cacheKey) {
  try {
    const { rows } = await db.query(
      `SELECT data, source, created_at, expires_at
         FROM stock_data_cache
        WHERE cache_key = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [cacheKey]
    );
    if (rows.length === 0) return null;
    return {
      data: rows[0].data,
      source: rows[0].source,
      cachedAt: rows[0].created_at,
      expiresAt: rows[0].expires_at,
      stale: new Date(rows[0].expires_at).getTime() < Date.now(),
    };
  } catch (e) {
    logger.error(`[Cache] getStaleCached error: ${e.message}`);
    return null;
  }
}

/**
 * Get rate limit status for all providers
 * @returns {object} Rate limit status
 */
export function getRateLimitStatus() {
  const now = Date.now();
  const status = {};

  for (const [provider, limits] of Object.entries(PROVIDER_LIMITS)) {
    const state = rateLimitState[provider];
    rolloverIfNeeded(provider);
    if (now - state.minuteWindowStart > 60_000) {
      state.requestsThisMinute = 0;
      state.minuteWindowStart = now;
    }

    const pct = (used, cap) => (cap === Infinity ? 0 : cap > 0 ? Number((used / cap).toFixed(3)) : 0);
    const cooldownRemaining = limits.cooldownMs > 0
      ? Math.max(0, limits.cooldownMs - (now - state.lastRequest))
      : 0;

    status[provider] = {
      perDay: limits.perDay === Infinity ? null : limits.perDay,
      usedToday: state.requestsToday,
      remainingToday: limits.perDay === Infinity ? null : Math.max(0, limits.perDay - state.requestsToday),
      percentOfDayCap: pct(state.requestsToday, limits.perDay),
      perMinute: limits.perMinute === Infinity ? null : limits.perMinute,
      usedThisMinute: state.requestsThisMinute,
      remainingThisMinute: limits.perMinute === Infinity ? null : Math.max(0, limits.perMinute - state.requestsThisMinute),
      perMonth: limits.perMonth === Infinity ? null : limits.perMonth,
      usedThisMonth: state.requestsThisMonth,
      remainingThisMonth: limits.perMonth === Infinity ? null : Math.max(0, limits.perMonth - state.requestsThisMonth),
      percentOfMonthCap: pct(state.requestsThisMonth, limits.perMonth),
      cooldownMs: limits.cooldownMs || 0,
      cooldownRemainingMs: cooldownRemaining,
      lastRequestAt: state.lastRequest ? new Date(state.lastRequest).toISOString() : null,
      blockedToday: state.blockedToday,
      staleServedToday: state.staleServedToday,
      canRequest: canMakeRequest(provider),
    };
  }

  return status;
}

/**
 * Get cache statistics
 * @returns {Promise<object>} Cache statistics
 */
export async function getCacheStats() {
  try {
    const result = await db.query(`
      SELECT 
        cache_type,
        COUNT(*) as entries,
        SUM(hit_count) as total_hits,
        AVG(hit_count) as avg_hits_per_entry,
        MIN(created_at) as oldest_entry,
        MAX(created_at) as newest_entry
      FROM stock_data_cache 
      WHERE expires_at > CURRENT_TIMESTAMP
      GROUP BY cache_type
    `);
    
    const totalResult = await db.query(`
      SELECT 
        COUNT(*) as total_entries,
        SUM(hit_count) as total_hits,
        pg_size_pretty(pg_total_relation_size('stock_data_cache')) as cache_size
      FROM stock_data_cache 
      WHERE expires_at > CURRENT_TIMESTAMP
    `);
    
    return {
      byType: result.rows,
      total: totalResult.rows[0],
      rateLimits: getRateLimitStatus(),
    };
  } catch (e) {
    logger.error('Cache stats error:', e);
    return { error: e.message };
  }
}

/**
 * Invalidate cache for a symbol
 * @param {string} symbol - Stock symbol
 */
export async function invalidateSymbol(symbol) {
  try {
    const result = await db.query(
      'DELETE FROM stock_data_cache WHERE symbol = $1',
      [symbol.toUpperCase()]
    );
    logger.info(`Invalidated ${result.rowCount} cache entries for ${symbol}`);
    return result.rowCount;
  } catch (e) {
    logger.error('Cache invalidation error:', e);
    return 0;
  }
}

// Export cache durations for use in routes
export { CACHE_DURATIONS };

export default {
  initializeCacheTable,
  getCached,
  setCache,
  cleanupExpiredCache,
  canMakeRequest,
  checkQuota,
  recordRequest,
  recordBlock,
  recordStaleServed,
  getRateLimitStatus,
  getStaleCached,
  getCacheStats,
  invalidateSymbol,
  loadRateLimitStateFromDB,
  CACHE_DURATIONS,
  PROVIDER_LIMITS,
};
