/**
 * Background Job Service for Automatic Stock Updates
 * 
 * Runs periodic tasks to:
 * - Update stock quotes for all watched symbols
 * - Clean up expired cache entries
 * - Track and report system health
 * 
 * This service runs server-side without any browser connection,
 * ensuring data is always fresh when users access the app.
 */

import { query } from './db.js';
import stockCache from './stockCache.js';

// Configuration
const CONFIG = {
  // How often to update quotes (in milliseconds)
  quoteUpdateInterval: 60 * 1000, // 1 minute
  
  // How often to clean expired cache (in milliseconds)
  cacheCleanupInterval: 5 * 60 * 1000, // 5 minutes
  
  // Batch size for quote updates (to avoid overwhelming APIs)
  quoteBatchSize: 10,
  
  // Delay between batches (in milliseconds)
  batchDelayMs: 2000,
  
  // Maximum symbols to update per cycle
  maxSymbolsPerCycle: 50,
  
  // Default symbols to always keep updated (popular stocks)
  defaultSymbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'AMD', 'INTC', 'NFLX'],
};

// Job state
let isRunning = false;
let lastQuoteUpdate = null;
let lastCacheCleanup = null;
let updateStats = {
  cycleCount: 0,
  successfulUpdates: 0,
  failedUpdates: 0,
  lastError: null,
};

// Timers
let quoteUpdateTimer = null;
let cacheCleanupTimer = null;

/**
 * Get all unique symbols from all users' watchlists
 * @returns {Promise<string[]>} Array of unique symbols
 */
async function getAllWatchedSymbols() {
  try {
    const result = await query(
      `SELECT DISTINCT symbol FROM custom_symbols ORDER BY symbol`
    );
    return result.rows.map(row => row.symbol);
  } catch (e) {
    console.error('[BackgroundJobs] Failed to get watched symbols:', e);
    return [];
  }
}

/**
 * Fetch quote from Yahoo Finance using Chart API
 * @param {string[]} symbols - Array of symbols to fetch
 * @returns {Promise<object|null>} Quote data or null
 */
async function fetchYahooQuotes(symbols) {
  const results = [];
  
  // Yahoo Chart API only supports one symbol at a time
  for (const symbol of symbols) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      
      if (!response.ok) {
        console.error(`[BackgroundJobs] Yahoo quote error for ${symbol}: ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      const chartResult = data.chart?.result?.[0];
      
      if (chartResult?.meta) {
        const meta = chartResult.meta;
        results.push({
          symbol: meta.symbol,
          regularMarketPrice: meta.regularMarketPrice,
          previousClose: meta.previousClose,
          regularMarketChange: meta.regularMarketPrice - meta.previousClose,
          regularMarketChangePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
          currency: meta.currency,
          exchangeName: meta.exchangeName,
        });
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (e) {
      console.error(`[BackgroundJobs] Yahoo fetch error for ${symbol}:`, e.message);
    }
  }
  
  return results.length > 0 ? { quoteResponse: { result: results } } : null;
}

// Callback for broadcasting updates to SSE clients
let broadcastCallback = null;

/**
 * Set the broadcast callback function
 * Called from index.js to register the SSE broadcast function
 * @param {Function} callback - Function to broadcast updates
 */
export function setBroadcastCallback(callback) {
  broadcastCallback = callback;
  console.log('[BackgroundJobs] SSE broadcast callback registered');
}

/**
 * Update quotes for a batch of symbols
 * @param {string[]} symbols - Symbols to update
 */
async function updateQuoteBatch(symbols) {
  if (symbols.length === 0) return;
  
  const data = await fetchYahooQuotes(symbols);
  
  if (!data || !data.quoteResponse?.result) {
    updateStats.failedUpdates += symbols.length;
    return;
  }
  
  // Cache each quote individually and broadcast to SSE clients
  for (const quote of data.quoteResponse.result) {
    const cacheKey = `yahoo:quote:${quote.symbol}`;
    const quoteData = { quoteResponse: { result: [quote] } };
    
    await stockCache.setCache(
      cacheKey,
      'quote',
      quote.symbol,
      quoteData,
      'yahoo-background',
      stockCache.CACHE_DURATIONS.quote
    );
    
    // Broadcast to SSE clients
    if (broadcastCallback) {
      broadcastCallback(quote.symbol, quoteData);
    }
    
    updateStats.successfulUpdates++;
  }
  
  console.log(`[BackgroundJobs] Updated ${data.quoteResponse.result.length} quotes`);
}

/**
 * Run a quote update cycle
 */
async function runQuoteUpdateCycle() {
  if (!process.env.DATABASE_URL) {
    console.log('[BackgroundJobs] Database not configured, skipping quote update');
    return;
  }
  
  console.log('[BackgroundJobs] Starting quote update cycle...');
  updateStats.cycleCount++;
  
  try {
    // Get all watched symbols
    const userSymbols = await getAllWatchedSymbols();
    
    // Combine with default symbols, remove duplicates
    const allSymbols = [...new Set([...CONFIG.defaultSymbols, ...userSymbols])];
    
    // Limit to max symbols per cycle
    const symbolsToUpdate = allSymbols.slice(0, CONFIG.maxSymbolsPerCycle);
    
    console.log(`[BackgroundJobs] Updating ${symbolsToUpdate.length} symbols`);
    
    // Process in batches
    for (let i = 0; i < symbolsToUpdate.length; i += CONFIG.quoteBatchSize) {
      const batch = symbolsToUpdate.slice(i, i + CONFIG.quoteBatchSize);
      await updateQuoteBatch(batch);
      
      // Delay between batches
      if (i + CONFIG.quoteBatchSize < symbolsToUpdate.length) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.batchDelayMs));
      }
    }
    
    lastQuoteUpdate = new Date();
    console.log(`[BackgroundJobs] Quote update cycle complete. Success: ${updateStats.successfulUpdates}, Failed: ${updateStats.failedUpdates}`);
  } catch (e) {
    console.error('[BackgroundJobs] Quote update cycle error:', e);
    updateStats.lastError = e.message;
  }
}

/**
 * Run cache cleanup
 */
async function runCacheCleanup() {
  if (!process.env.DATABASE_URL) {
    return;
  }
  
  try {
    const removed = await stockCache.cleanupExpiredCache();
    lastCacheCleanup = new Date();
    if (removed > 0) {
      console.log(`[BackgroundJobs] Cache cleanup: removed ${removed} expired entries`);
    }
  } catch (e) {
    console.error('[BackgroundJobs] Cache cleanup error:', e);
  }
}

/**
 * Start all background jobs
 */
export function startBackgroundJobs() {
  if (isRunning) {
    console.log('[BackgroundJobs] Already running');
    return;
  }
  
  console.log('[BackgroundJobs] Starting background jobs...');
  console.log(`[BackgroundJobs] Quote update interval: ${CONFIG.quoteUpdateInterval / 1000}s`);
  console.log(`[BackgroundJobs] Cache cleanup interval: ${CONFIG.cacheCleanupInterval / 1000}s`);
  
  isRunning = true;
  
  // Run initial update after a short delay (let server fully start)
  setTimeout(() => {
    runQuoteUpdateCycle();
    runCacheCleanup();
  }, 5000);
  
  // Schedule recurring updates
  quoteUpdateTimer = setInterval(runQuoteUpdateCycle, CONFIG.quoteUpdateInterval);
  cacheCleanupTimer = setInterval(runCacheCleanup, CONFIG.cacheCleanupInterval);
  
  console.log('[BackgroundJobs] Background jobs started');
}

/**
 * Stop all background jobs
 */
export function stopBackgroundJobs() {
  if (!isRunning) return;
  
  console.log('[BackgroundJobs] Stopping background jobs...');
  
  if (quoteUpdateTimer) {
    clearInterval(quoteUpdateTimer);
    quoteUpdateTimer = null;
  }
  
  if (cacheCleanupTimer) {
    clearInterval(cacheCleanupTimer);
    cacheCleanupTimer = null;
  }
  
  isRunning = false;
  console.log('[BackgroundJobs] Background jobs stopped');
}

/**
 * Get status of background jobs
 * @returns {object} Job status
 */
export function getJobStatus() {
  return {
    isRunning,
    lastQuoteUpdate,
    lastCacheCleanup,
    nextQuoteUpdate: lastQuoteUpdate 
      ? new Date(lastQuoteUpdate.getTime() + CONFIG.quoteUpdateInterval)
      : null,
    config: {
      quoteUpdateIntervalSeconds: CONFIG.quoteUpdateInterval / 1000,
      cacheCleanupIntervalSeconds: CONFIG.cacheCleanupInterval / 1000,
      quoteBatchSize: CONFIG.quoteBatchSize,
      maxSymbolsPerCycle: CONFIG.maxSymbolsPerCycle,
      defaultSymbols: CONFIG.defaultSymbols,
    },
    stats: updateStats,
  };
}

/**
 * Manually trigger a quote update cycle
 */
export async function triggerQuoteUpdate() {
  console.log('[BackgroundJobs] Manual quote update triggered');
  await runQuoteUpdateCycle();
  return getJobStatus();
}

/**
 * Update configuration
 * @param {object} newConfig - New configuration values
 */
export function updateConfig(newConfig) {
  if (newConfig.quoteUpdateInterval !== undefined) {
    CONFIG.quoteUpdateInterval = newConfig.quoteUpdateInterval;
    // Restart timer with new interval
    if (quoteUpdateTimer) {
      clearInterval(quoteUpdateTimer);
      quoteUpdateTimer = setInterval(runQuoteUpdateCycle, CONFIG.quoteUpdateInterval);
    }
  }
  
  if (newConfig.maxSymbolsPerCycle !== undefined) {
    CONFIG.maxSymbolsPerCycle = newConfig.maxSymbolsPerCycle;
  }
  
  if (newConfig.quoteBatchSize !== undefined) {
    CONFIG.quoteBatchSize = newConfig.quoteBatchSize;
  }
  
  console.log('[BackgroundJobs] Configuration updated:', CONFIG);
}

export default {
  startBackgroundJobs,
  stopBackgroundJobs,
  getJobStatus,
  triggerQuoteUpdate,
  updateConfig,
  setBroadcastCallback,
};
