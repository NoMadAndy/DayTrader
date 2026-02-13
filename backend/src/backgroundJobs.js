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
import logger from './logger.js';

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
    logger.error('[BackgroundJobs] Failed to get watched symbols:', e);
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
        logger.error(`[BackgroundJobs] Yahoo quote error for ${symbol}: ${response.status}`);
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
      logger.error(`[BackgroundJobs] Yahoo fetch error for ${symbol}:`, e.message);
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
  logger.info('[BackgroundJobs] SSE broadcast callback registered');
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
  
  logger.info(`[BackgroundJobs] Updated ${data.quoteResponse.result.length} quotes`);
}

/**
 * Run a quote update cycle
 */
async function runQuoteUpdateCycle() {
  if (!process.env.DATABASE_URL) {
    logger.info('[BackgroundJobs] Database not configured, skipping quote update');
    return;
  }
  
  logger.info('[BackgroundJobs] Starting quote update cycle...');
  updateStats.cycleCount++;
  
  try {
    // Get all watched symbols
    const userSymbols = await getAllWatchedSymbols();
    
    // Combine with default symbols, remove duplicates
    const allSymbols = [...new Set([...CONFIG.defaultSymbols, ...userSymbols])];
    
    // Limit to max symbols per cycle
    const symbolsToUpdate = allSymbols.slice(0, CONFIG.maxSymbolsPerCycle);
    
    logger.info(`[BackgroundJobs] Updating ${symbolsToUpdate.length} symbols`);
    
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
    logger.info(`[BackgroundJobs] Quote update cycle complete. Success: ${updateStats.successfulUpdates}, Failed: ${updateStats.failedUpdates}`);
  } catch (e) {
    logger.error('[BackgroundJobs] Quote update cycle error:', e);
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
      logger.info(`[BackgroundJobs] Cache cleanup: removed ${removed} expired entries`);
    }
  } catch (e) {
    logger.error('[BackgroundJobs] Cache cleanup error:', e);
  }
}

/**
 * Start all background jobs
 */
export function startBackgroundJobs() {
  if (isRunning) {
    logger.info('[BackgroundJobs] Already running');
    return;
  }
  
  logger.info('[BackgroundJobs] Starting background jobs...');
  logger.info(`[BackgroundJobs] Quote update interval: ${CONFIG.quoteUpdateInterval / 1000}s`);
  logger.info(`[BackgroundJobs] Cache cleanup interval: ${CONFIG.cacheCleanupInterval / 1000}s`);
  
  isRunning = true;
  
  // Run initial update after a short delay (let server fully start)
  setTimeout(() => {
    runQuoteUpdateCycle();
    runCacheCleanup();
  }, 5000);
  
  // Schedule recurring updates
  quoteUpdateTimer = setInterval(runQuoteUpdateCycle, CONFIG.quoteUpdateInterval);
  cacheCleanupTimer = setInterval(runCacheCleanup, CONFIG.cacheCleanupInterval);
  
  // Start AI Trader jobs
  scheduleAITraderJobs();
  
  logger.info('[BackgroundJobs] Background jobs started');
}

/**
 * Stop all background jobs
 */
export function stopBackgroundJobs() {
  if (!isRunning) return;
  
  logger.info('[BackgroundJobs] Stopping background jobs...');
  
  if (quoteUpdateTimer) {
    clearInterval(quoteUpdateTimer);
    quoteUpdateTimer = null;
  }
  
  if (cacheCleanupTimer) {
    clearInterval(cacheCleanupTimer);
    cacheCleanupTimer = null;
  }
  
  // Stop AI Trader jobs
  stopAITraderJobs();
  
  isRunning = false;
  logger.info('[BackgroundJobs] Background jobs stopped');
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
  logger.info('[BackgroundJobs] Manual quote update triggered');
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
  
  logger.info('[BackgroundJobs] Configuration updated:', CONFIG);
}

// ============================================================================
// AI Trader Scheduled Jobs
// ============================================================================

/**
 * Run daily report generation for all running AI traders
 * Scheduled to run after market close (17:35 CET)
 */
async function generateDailyReports() {
  try {
    logger.info('[BackgroundJobs] Starting daily report generation...');
    
    // Import dynamically to avoid circular dependencies
    const { generateDailyReport, getRunningAITraders } = await import('./aiTraderReports.js');
    
    const traders = await getRunningAITraders();
    const date = new Date();
    
    logger.info(`[BackgroundJobs] Generating reports for ${traders.length} traders`);
    
    for (const trader of traders) {
      try {
        await generateDailyReport(trader.id, date);
        logger.info(`[BackgroundJobs] Generated daily report for trader ${trader.name}`);
      } catch (error) {
        logger.error(`[BackgroundJobs] Error generating report for trader ${trader.id}:`, error);
      }
    }
    
    logger.info('[BackgroundJobs] Daily report generation complete');
  } catch (error) {
    logger.error('[BackgroundJobs] Error in daily report generation:', error);
  }
}

/**
 * Update pending decision outcomes
 * Scheduled to run hourly
 */
async function updateOutcomes() {
  try {
    logger.info('[BackgroundJobs] Starting outcome tracking update...');
    
    // Import dynamically to avoid circular dependencies
    const { updatePendingOutcomes } = await import('./aiTrader.js');
    
    const updated = await updatePendingOutcomes();
    
    if (updated > 0) {
      logger.info(`[BackgroundJobs] Updated ${updated} decision outcomes`);
    }
  } catch (error) {
    logger.error('[BackgroundJobs] Error updating outcomes:', error);
  }
}

/**
 * Check if current time is outside trading hours for adaptive learning
 * Uses default trading hours (17:30 end) or can check individual trader schedules
 * @returns {boolean} True if outside trading hours (safe to run learning)
 */
function isOutsideTradingHours() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const weekday = (parts.find(p => p.type === 'weekday')?.value || '').toLowerCase().substring(0, 3);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const currentMinutes = hour * 60 + minute;
  
  // Weekend = outside trading hours
  if (!['mon', 'tue', 'wed', 'thu', 'fri'].includes(weekday)) {
    return true;
  }
  
  // Default trading hours: 09:00 - 17:30 (Berlin)
  const tradingStartMinutes = 9 * 60; // 09:00
  const tradingEndMinutes = 17 * 60 + 30; // 17:30
  
  // Outside trading hours = before 09:00 or after 17:30
  return currentMinutes < tradingStartMinutes || currentMinutes > tradingEndMinutes;
}

/**
 * Adjust weights for AI traders with adaptive learning enabled
 * Runs daily after market close (17:45) and checks if outside trading hours
 * @param {boolean} force - Force run even during trading hours (for manual trigger)
 */
async function adjustAdaptiveWeights(force = false) {
  try {
    const outsideHours = isOutsideTradingHours();
    
    if (!force && !outsideHours) {
      logger.info('[BackgroundJobs] Adaptive learning skipped - still within trading hours');
      return { skipped: true, reason: 'Within trading hours' };
    }
    
    logger.info('[BackgroundJobs] ====== ADAPTIVE LEARNING START ======');
    logger.info(`[BackgroundJobs] Time: ${new Date().toISOString()}`);
    logger.info(`[BackgroundJobs] Outside trading hours: ${outsideHours}, Force: ${force}`);
    
    // Import dynamically to avoid circular dependencies
    const { getTradersWithLearningEnabled, adjustSignalWeights } = await import('./aiTraderLearning.js');
    
    const traders = await getTradersWithLearningEnabled();
    
    logger.info(`[BackgroundJobs] Found ${traders.length} traders with learning enabled`);
    
    if (traders.length === 0) {
      logger.info('[BackgroundJobs] No traders have learning enabled. Enable via Settings -> Learning -> "Lernmodus aktivieren"');
      return { adjusted: 0, skipped: 0, reason: 'No traders with learning enabled' };
    }
    
    let adjustedCount = 0;
    let skippedCount = 0;
    const results = [];
    
    for (const trader of traders) {
      try {
        logger.info(`[BackgroundJobs] Processing trader: ${trader.name} (ID: ${trader.id})`);
        const result = await adjustSignalWeights(trader.id);
        
        if (result.adjusted) {
          adjustedCount++;
          logger.info(`[BackgroundJobs] ✓ Adjusted weights for trader ${trader.name}:`);
          logger.info(`[BackgroundJobs]   Old: ML=${(result.oldWeights?.ml * 100).toFixed(1)}%, RL=${(result.oldWeights?.rl * 100).toFixed(1)}%, Sentiment=${(result.oldWeights?.sentiment * 100).toFixed(1)}%, Technical=${(result.oldWeights?.technical * 100).toFixed(1)}%`);
          logger.info(`[BackgroundJobs]   New: ML=${(result.newWeights?.ml * 100).toFixed(1)}%, RL=${(result.newWeights?.rl * 100).toFixed(1)}%, Sentiment=${(result.newWeights?.sentiment * 100).toFixed(1)}%, Technical=${(result.newWeights?.technical * 100).toFixed(1)}%`);
        } else {
          skippedCount++;
          logger.info(`[BackgroundJobs] - No adjustment for trader ${trader.name}: ${result.reason}`);
        }
        
        results.push({ traderId: trader.id, name: trader.name, ...result });
      } catch (error) {
        logger.error(`[BackgroundJobs] ✗ Error adjusting weights for trader ${trader.id}:`, error.message);
        results.push({ traderId: trader.id, name: trader.name, error: error.message });
      }
    }
    
    logger.info(`[BackgroundJobs] ====== ADAPTIVE LEARNING COMPLETE ======`);
    logger.info(`[BackgroundJobs] Summary: ${adjustedCount} adjusted, ${skippedCount} skipped`);
    
    return { adjusted: adjustedCount, skipped: skippedCount, results };
  } catch (error) {
    logger.error('[BackgroundJobs] Error in adaptive weight adjustments:', error);
    return { error: error.message };
  }
}

// Timers for AI Trader jobs
let dailyReportTimer = null;
let outcomeTrackingTimer = null;
let adaptiveWeightsTimer = null;
let adaptiveLearningCheckTimer = null;
let warrantJobTimer = null;

/**
 * Run daily warrant maintenance jobs:
 * 1. Settle expired warrants (at intrinsic value or worthless)
 * 2. Apply theta (time value) decay to open warrant positions
 */
async function runWarrantDailyJobs() {
  try {
    logger.info('[BackgroundJobs] ====== WARRANT DAILY JOBS START ======');
    
    const { processWarrantTimeDecay, settleExpiredWarrants } = await import('./trading.js');
    
    // 1. Settle expired warrants first
    const settled = await settleExpiredWarrants();
    if (settled.length > 0) {
      logger.info(`[BackgroundJobs] Settled ${settled.length} expired warrants`);
    }
    
    // 2. Apply theta decay to remaining open warrants
    const decayResult = await processWarrantTimeDecay();
    logger.info(`[BackgroundJobs] Theta decay: ${decayResult.processed} warrants updated`);
    
    logger.info('[BackgroundJobs] ====== WARRANT DAILY JOBS COMPLETE ======');
    return { settled, decay: decayResult };
  } catch (error) {
    logger.error('[BackgroundJobs] Warrant daily jobs error:', error);
    return { error: error.message };
  }
}

/**
 * Schedule AI Trader background jobs
 */
function scheduleAITraderJobs() {
  // Daily reports at 17:35 (after market close)
  const now = new Date();
  const nextReportRun = new Date(now);
  nextReportRun.setHours(17, 35, 0, 0);
  
  if (nextReportRun <= now) {
    nextReportRun.setDate(nextReportRun.getDate() + 1);
  }
  
  const msUntilNextReport = nextReportRun.getTime() - now.getTime();
  
  // Schedule first run
  dailyReportTimer = setTimeout(() => {
    generateDailyReports();
    // Then run daily
    dailyReportTimer = setInterval(generateDailyReports, 24 * 60 * 60 * 1000);
  }, msUntilNextReport);
  
  logger.info(`[BackgroundJobs] Daily reports scheduled for ${nextReportRun.toISOString()}`);
  
  // Outcome tracking hourly
  outcomeTrackingTimer = setInterval(updateOutcomes, 60 * 60 * 1000);
  logger.info('[BackgroundJobs] Outcome tracking scheduled hourly');
  
  // Run immediately on startup
  updateOutcomes();
  
  // =========================================
  // ADAPTIVE LEARNING - Daily after market close
  // =========================================
  // Primary run at 17:45 (15 min after market close)
  const nextLearningRun = new Date(now);
  nextLearningRun.setHours(17, 45, 0, 0);
  
  if (nextLearningRun <= now) {
    nextLearningRun.setDate(nextLearningRun.getDate() + 1);
  }
  
  const msUntilLearning = nextLearningRun.getTime() - now.getTime();
  
  adaptiveWeightsTimer = setTimeout(() => {
    adjustAdaptiveWeights();
    // Then run daily at 17:45
    adaptiveWeightsTimer = setInterval(adjustAdaptiveWeights, 24 * 60 * 60 * 1000);
  }, msUntilLearning);
  
  logger.info(`[BackgroundJobs] Adaptive learning scheduled for ${nextLearningRun.toISOString()} (daily after market close)`);
  
  // Also check every 2 hours if we're outside trading hours (catches weekends, holidays)
  adaptiveLearningCheckTimer = setInterval(() => {
    if (isOutsideTradingHours()) {
      logger.info('[BackgroundJobs] Periodic check: Outside trading hours, running adaptive learning...');
      adjustAdaptiveWeights();
    }
  }, 2 * 60 * 60 * 1000); // Every 2 hours
  
  logger.info('[BackgroundJobs] Adaptive learning periodic check scheduled every 2 hours');
  
  // Run immediately on startup if outside trading hours
  setTimeout(async () => {
    if (isOutsideTradingHours()) {
      logger.info('[BackgroundJobs] Startup: Outside trading hours, running initial adaptive learning...');
      await adjustAdaptiveWeights();
    } else {
      logger.info('[BackgroundJobs] Startup: Within trading hours, adaptive learning will run after market close');
    }
  }, 10000); // 10 seconds after startup

  // =========================================
  // WARRANT JOBS - Daily theta decay & expiry settlement
  // =========================================
  const nextWarrantRun = new Date(now);
  nextWarrantRun.setHours(17, 40, 0, 0); // 17:40 after market close
  if (nextWarrantRun <= now) {
    nextWarrantRun.setDate(nextWarrantRun.getDate() + 1);
  }
  const msUntilWarrantJob = nextWarrantRun.getTime() - now.getTime();
  
  warrantJobTimer = setTimeout(() => {
    runWarrantDailyJobs();
    warrantJobTimer = setInterval(runWarrantDailyJobs, 24 * 60 * 60 * 1000);
  }, msUntilWarrantJob);

  logger.info(`[BackgroundJobs] Warrant jobs (theta decay + expiry) scheduled for ${nextWarrantRun.toISOString()}`);
}

/**
 * Stop AI Trader scheduled jobs
 */
function stopAITraderJobs() {
  if (dailyReportTimer) {
    clearInterval(dailyReportTimer);
    clearTimeout(dailyReportTimer);
    dailyReportTimer = null;
  }
  
  if (outcomeTrackingTimer) {
    clearInterval(outcomeTrackingTimer);
    outcomeTrackingTimer = null;
  }
  
  if (adaptiveWeightsTimer) {
    clearInterval(adaptiveWeightsTimer);
    clearTimeout(adaptiveWeightsTimer);
    adaptiveWeightsTimer = null;
  }
  
  if (adaptiveLearningCheckTimer) {
    clearInterval(adaptiveLearningCheckTimer);
    adaptiveLearningCheckTimer = null;
  }
  
  if (warrantJobTimer) {
    clearInterval(warrantJobTimer);
    clearTimeout(warrantJobTimer);
    warrantJobTimer = null;
  }
  
  logger.info('[BackgroundJobs] AI Trader jobs stopped');
}

export default {
  startBackgroundJobs,
  stopBackgroundJobs,
  getJobStatus,
  triggerQuoteUpdate,
  updateConfig,
  setBroadcastCallback,
  scheduleAITraderJobs,
  stopAITraderJobs,
  generateDailyReports,
  updateOutcomes,
  adjustAdaptiveWeights,
  isOutsideTradingHours,
};
