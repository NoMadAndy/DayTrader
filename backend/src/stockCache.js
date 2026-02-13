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

// Rate limit tracking (in-memory, resets on restart)
const rateLimitState = {
  alphaVantage: { requestsToday: 0, requestsThisMinute: 0, lastRequest: 0, dayStart: getDayStart() },
  twelveData: { requestsToday: 0, requestsThisMinute: 0, lastRequest: 0, dayStart: getDayStart() },
  finnhub: { requestsThisMinute: 0, lastRequest: 0 },
  yahoo: { requestsThisMinute: 0, lastRequest: 0 },
};

// Provider limits
const PROVIDER_LIMITS = {
  alphaVantage: { perDay: 25, perMinute: 5, cooldownMs: 12000 },
  twelveData: { perDay: 800, perMinute: 8, cooldownMs: 8000 },
  finnhub: { perDay: Infinity, perMinute: 60, cooldownMs: 1000 },
  yahoo: { perDay: Infinity, perMinute: 100, cooldownMs: 500 },
};

function getDayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
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

    await client.query('COMMIT');
    logger.info('Cache tables initialized successfully');
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

/**
 * Check if we can make a request to a provider
 * @param {string} provider - Provider name
 * @returns {boolean}
 */
export function canMakeRequest(provider) {
  const limits = PROVIDER_LIMITS[provider];
  const state = rateLimitState[provider];
  
  if (!limits || !state) return true;
  
  const now = Date.now();
  
  // Reset daily counter if new day
  if (state.dayStart !== getDayStart()) {
    state.requestsToday = 0;
    state.dayStart = getDayStart();
  }
  
  // Reset minute counter if more than a minute has passed
  if (now - state.lastRequest > 60000) {
    state.requestsThisMinute = 0;
  }
  
  // Check limits
  if (state.requestsToday >= limits.perDay) {
    logger.warn(`${provider}: Daily limit reached (${limits.perDay})`);
    return false;
  }
  
  if (state.requestsThisMinute >= limits.perMinute) {
    logger.warn(`${provider}: Minute limit reached (${limits.perMinute})`);
    return false;
  }
  
  // Check cooldown
  if (now - state.lastRequest < limits.cooldownMs) {
    logger.warn(`${provider}: Cooldown active`);
    return false;
  }
  
  return true;
}

/**
 * Record a request to a provider
 * @param {string} provider - Provider name
 */
export function recordRequest(provider) {
  const state = rateLimitState[provider];
  if (!state) return;
  
  state.requestsToday++;
  state.requestsThisMinute++;
  state.lastRequest = Date.now();
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
    
    // Reset counters for accurate status
    if (state.dayStart !== getDayStart()) {
      state.requestsToday = 0;
      state.dayStart = getDayStart();
    }
    if (now - state.lastRequest > 60000) {
      state.requestsThisMinute = 0;
    }
    
    status[provider] = {
      requestsToday: state.requestsToday,
      requestsThisMinute: state.requestsThisMinute,
      limitsPerDay: limits.perDay,
      limitsPerMinute: limits.perMinute,
      remainingToday: limits.perDay === Infinity ? Infinity : limits.perDay - state.requestsToday,
      remainingThisMinute: limits.perMinute - state.requestsThisMinute,
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
  recordRequest,
  getRateLimitStatus,
  getCacheStats,
  invalidateSymbol,
  CACHE_DURATIONS,
};
