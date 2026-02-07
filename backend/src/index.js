/**
 * DayTrader Backend Proxy
 * 
 * Proxies requests to external APIs (Yahoo Finance, etc.) to avoid CORS issues.
 * This server runs in Docker alongside the frontend.
 * 
 * Also provides authentication and user settings management with PostgreSQL.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import db from './db.js';
import stockCache from './stockCache.js';
import backgroundJobs from './backgroundJobs.js';
import * as sentimentArchive from './sentimentArchive.js';
import { registerUser, loginUser, logoutUser, authMiddleware, optionalAuthMiddleware } from './auth.js';
import { getUserSettings, updateUserSettings, getCustomSymbols, addCustomSymbol, removeCustomSymbol, syncCustomSymbols } from './userSettings.js';
import * as trading from './trading.js';
import * as aiTrader from './aiTrader.js';
import { aiTraderEvents, emitStatusChanged, emitDecisionMade, emitAnalyzing, emitTradeExecuted, emitError } from './aiTraderEvents.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Parser from 'rss-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json for accurate version info
let packageVersion = '1.9.0';
try {
  const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
  packageVersion = packageJson.version;
} catch (e) {
  console.warn('Could not read package.json version:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Build info from environment (set during Docker build), fallback to package.json version
const BUILD_VERSION = process.env.BUILD_VERSION || packageVersion;
const BUILD_COMMIT = process.env.BUILD_COMMIT || 'unknown';
const BUILD_TIME = process.env.BUILD_TIME || new Date().toISOString();

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(compression());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Finnhub-Token', 'X-AlphaVantage-Key', 'X-TwelveData-Key'],
  credentials: true,
}));
app.use(express.json());

// Disable caching for all API endpoints to ensure fresh data
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const dbHealthy = process.env.DATABASE_URL ? await db.checkHealth() : true;
  res.json({ 
    status: dbHealthy ? 'ok' : 'degraded', 
    timestamp: new Date().toISOString(),
    version: BUILD_VERSION,
    commit: BUILD_COMMIT,
    buildTime: BUILD_TIME,
    database: process.env.DATABASE_URL ? (dbHealthy ? 'connected' : 'error') : 'not configured'
  });
});

// Build info endpoint
app.get('/api/version', (req, res) => {
  res.json({
    version: BUILD_VERSION,
    commit: BUILD_COMMIT,
    buildTime: BUILD_TIME,
    service: 'daytrader-backend'
  });
});

// Changelog endpoint - serves parsed CHANGELOG.md
/**
 * Parse CHANGELOG.md into structured format
 */
function parseChangelog() {
  try {
    // Try multiple paths (Docker mounted volume, local dev, etc.)
    const possiblePaths = [
      '/app/CHANGELOG.md',                          // Docker mounted volume
      join(__dirname, '../../CHANGELOG.md'),         // Local dev: backend/src -> backend -> root
      join(__dirname, '../../../CHANGELOG.md'),      // Alternative structure
    ];
    
    let content;
    for (const changelogPath of possiblePaths) {
      try {
        content = readFileSync(changelogPath, 'utf8');
        console.log(`[Changelog] Loaded from: ${changelogPath}`);
        break;
      } catch {
        // Try next path
      }
    }
    
    if (!content) {
      console.warn('[Changelog] Could not find CHANGELOG.md in any expected location');
      return [];
    }
    
    const entries = [];
    const lines = content.split('\n');
    let currentEntry = null;
    let currentSection = null;
    let currentItem = null;
    
    for (const line of lines) {
      // Match version header: ## [1.9.0] - 2026-01-27
      const versionMatch = line.match(/^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?/);
      if (versionMatch) {
        // Save current item if exists
        if (currentItem && currentSection) {
          currentSection.items.push(currentItem);
          currentItem = null;
        }
        if (currentEntry) {
          entries.push(currentEntry);
        }
        currentEntry = {
          version: versionMatch[1],
          date: versionMatch[2] || null,
          sections: []
        };
        currentSection = null;
        continue;
      }
      
      // Match section header: ### Added, ### Changed, ### Fixed
      const sectionMatch = line.match(/^### (\w+)/);
      if (sectionMatch && currentEntry) {
        // Save current item if exists
        if (currentItem && currentSection) {
          currentSection.items.push(currentItem);
          currentItem = null;
        }
        currentSection = {
          title: sectionMatch[1],
          items: []
        };
        currentEntry.sections.push(currentSection);
        continue;
      }
      
      // Match main list item: - **Feature** - Description
      const itemMatch = line.match(/^- (.+)/);
      if (itemMatch && currentSection) {
        // Save previous item
        if (currentItem) {
          currentSection.items.push(currentItem);
        }
        currentItem = itemMatch[1].trim();
        continue;
      }
      
      // Match sub-list item (indented):   - Sub item
      const subItemMatch = line.match(/^  +- (.+)/);
      if (subItemMatch && currentItem) {
        // Append sub-item to current item
        currentItem += ' • ' + subItemMatch[1].trim();
        continue;
      }
    }
    
    // Save last item and entry
    if (currentItem && currentSection) {
      currentSection.items.push(currentItem);
    }
    if (currentEntry) {
      entries.push(currentEntry);
    }
    
    return entries;
  } catch (e) {
    console.error('Failed to parse changelog:', e.message);
    return [];
  }
}

app.get('/api/changelog', (req, res) => {
  const entries = parseChangelog();
  res.json({
    version: BUILD_VERSION,
    commit: BUILD_COMMIT,
    buildTime: BUILD_TIME,
    entries
  });
});

// ============================================================================
// Cache Status Endpoints
// ============================================================================

/**
 * Get cache statistics
 * GET /api/cache/stats
 */
app.get('/api/cache/stats', async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.json({ 
      enabled: false, 
      message: 'Database caching not configured',
      rateLimits: stockCache.getRateLimitStatus()
    });
  }
  
  try {
    const stats = await stockCache.getCacheStats();
    res.json({ enabled: true, ...stats });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get cache stats' });
  }
});

/**
 * Get rate limit status for all providers
 * GET /api/cache/rate-limits
 */
app.get('/api/cache/rate-limits', (req, res) => {
  res.json(stockCache.getRateLimitStatus());
});

/**
 * Invalidate cache for a symbol (admin/debug)
 * DELETE /api/cache/:symbol
 */
app.delete('/api/cache/:symbol', async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  
  const { symbol } = req.params;
  const count = await stockCache.invalidateSymbol(symbol);
  res.json({ success: true, invalidatedEntries: count });
});

// ============================================================================
// Background Jobs Endpoints
// ============================================================================

/**
 * Get background job status
 * GET /api/jobs/status
 */
app.get('/api/jobs/status', (req, res) => {
  res.json(backgroundJobs.getJobStatus());
});

/**
 * Manually trigger a quote update
 * POST /api/jobs/update-quotes
 */
app.post('/api/jobs/update-quotes', async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  
  const status = await backgroundJobs.triggerQuoteUpdate();
  res.json(status);
});

// ============================================================================
// Server-Sent Events (SSE) for Real-Time Updates
// ============================================================================

// Store active SSE connections
const sseClients = new Map();

/**
 * SSE endpoint for real-time quote updates
 * GET /api/stream/quotes
 * Query params: symbols (comma-separated)
 * 
 * Clients subscribe to specific symbols and receive updates
 * when the background job refreshes quotes
 */
app.get('/api/stream/quotes', (req, res) => {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean).map(s => s.toUpperCase());
  
  if (symbols.length === 0) {
    return res.status(400).json({ error: 'symbols query parameter required' });
  }
  
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();
  
  // Generate unique client ID
  const clientId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Store client connection
  sseClients.set(clientId, { res, symbols, connectedAt: new Date() });
  
  console.log(`[SSE] Client ${clientId} connected for symbols: ${symbols.join(', ')}`);
  
  // Send initial connection success
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, symbols })}\n\n`);
  
  // Send current cached quotes immediately
  (async () => {
    for (const symbol of symbols) {
      const cacheKey = `yahoo:quote:${symbol}`;
      const cached = await stockCache.getCached(cacheKey);
      if (cached) {
        res.write(`event: quote\ndata: ${JSON.stringify({ symbol, data: cached.data, cachedAt: cached.cachedAt })}\n\n`);
      }
    }
  })();
  
  // Keep-alive ping every 30 seconds
  const pingInterval = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);
  }, 30000);
  
  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    sseClients.delete(clientId);
    console.log(`[SSE] Client ${clientId} disconnected`);
  });
});

/**
 * Broadcast quote update to all subscribed SSE clients
 * Called by background jobs when quotes are updated
 */
function broadcastQuoteUpdate(symbol, data) {
  const upperSymbol = symbol.toUpperCase();
  let notified = 0;
  
  for (const [clientId, client] of sseClients.entries()) {
    if (client.symbols.includes(upperSymbol)) {
      try {
        client.res.write(`event: quote\ndata: ${JSON.stringify({ symbol: upperSymbol, data, updatedAt: new Date().toISOString() })}\n\n`);
        notified++;
      } catch (e) {
        console.error(`[SSE] Error sending to client ${clientId}:`, e);
        sseClients.delete(clientId);
      }
    }
  }
  
  if (notified > 0) {
    console.log(`[SSE] Broadcast ${upperSymbol} update to ${notified} clients`);
  }
}

// Export for use by background jobs
export { broadcastQuoteUpdate };

/**
 * Get SSE connection stats
 * GET /api/stream/stats
 */
app.get('/api/stream/stats', (req, res) => {
  // Quote stream clients
  const quoteClients = [];
  for (const [clientId, client] of sseClients.entries()) {
    quoteClients.push({
      clientId,
      symbols: client.symbols,
      connectedAt: client.connectedAt,
    });
  }
  
  // AI Trader stream clients
  const aiTraderStats = aiTraderEvents.getStats();
  
  res.json({ 
    activeConnections: sseClients.size + aiTraderStats.activeClients,
    quoteStreams: {
      count: sseClients.size,
      clients: quoteClients,
    },
    aiTraderStreams: {
      count: aiTraderStats.activeClients,
      clients: aiTraderStats.clients,
    },
  });
});

// ============================================================================
// Authentication Endpoints
// ============================================================================

/**
 * Register a new user
 * POST /api/auth/register
 * Body: { email, password, username? }
 */
app.post('/api/auth/register', express.json(), async (req, res) => {
  if (!process.env.DATABASE_URL) {
    console.log('Registration attempt failed: Database not configured');
    return res.status(503).json({ error: 'Database not configured' });
  }
  
  const { email, password, username } = req.body;
  
  console.log(`Registration attempt for email: ${email?.substring(0, 3)}***`);
  
  if (!email || !password) {
    console.log('Registration failed: Missing required fields');
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  const result = await registerUser(email, password, username);
  
  if (!result.success) {
    console.log(`Registration failed for ${email}: ${result.error}`);
    return res.status(400).json({ error: result.error });
  }
  
  console.log(`Registration successful for email: ${email?.substring(0, 3)}***`);
  res.status(201).json({ user: result.user });
});

/**
 * Login user
 * POST /api/auth/login
 * Body: { email, password }
 */
app.post('/api/auth/login', express.json(), async (req, res) => {
  if (!process.env.DATABASE_URL) {
    console.log('Login attempt failed: Database not configured');
    return res.status(503).json({ error: 'Database not configured' });
  }
  
  const { email, password } = req.body;
  
  console.log(`Login attempt for email: ${email?.substring(0, 3)}***`);
  
  if (!email || !password) {
    console.log('Login failed: Missing required fields');
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  const userAgent = req.headers['user-agent'];
  const ipAddress = req.ip || req.connection.remoteAddress;
  
  const result = await loginUser(email, password, userAgent, ipAddress);
  
  if (!result.success) {
    console.log(`Login failed for ${email}: ${result.error}`);
    return res.status(401).json({ error: result.error });
  }
  
  console.log(`Login successful for email: ${email?.substring(0, 3)}***`);
  res.json({ token: result.token, user: result.user });
});

/**
 * Logout user
 * POST /api/auth/logout
 * Headers: Authorization: Bearer <token>
 */
app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  const token = req.headers.authorization.substring(7);
  await logoutUser(token);
  res.json({ success: true });
});

/**
 * Get current user
 * GET /api/auth/me
 * Headers: Authorization: Bearer <token>
 */
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

/**
 * Check if database/auth is available
 * GET /api/auth/status
 */
app.get('/api/auth/status', async (req, res) => {
  const dbConfigured = !!process.env.DATABASE_URL;
  const dbHealthy = dbConfigured ? await db.checkHealth() : false;
  
  res.json({
    authAvailable: dbConfigured && dbHealthy,
    dbConfigured,
    dbHealthy
  });
});

// ============================================================================
// User Settings Endpoints
// ============================================================================

/**
 * Get user settings
 * GET /api/user/settings
 */
app.get('/api/user/settings', authMiddleware, async (req, res) => {
  try {
    const settings = await getUserSettings(req.user.id);
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

/**
 * Update user settings
 * PUT /api/user/settings
 * Body: { preferredDataSource?, apiKeys?, uiPreferences? }
 */
app.put('/api/user/settings', authMiddleware, express.json(), async (req, res) => {
  try {
    const settings = await updateUserSettings(req.user.id, req.body);
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * Get custom symbols
 * GET /api/user/symbols
 */
app.get('/api/user/symbols', authMiddleware, async (req, res) => {
  try {
    const symbols = await getCustomSymbols(req.user.id);
    res.json(symbols);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get symbols' });
  }
});

/**
 * Add custom symbol
 * POST /api/user/symbols
 * Body: { symbol, name? }
 */
app.post('/api/user/symbols', authMiddleware, express.json(), async (req, res) => {
  const { symbol, name } = req.body;
  
  if (!symbol) {
    return res.status(400).json({ error: 'Symbol is required' });
  }
  
  const result = await addCustomSymbol(req.user.id, symbol, name);
  
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  
  res.status(201).json(result.symbol);
});

/**
 * Remove custom symbol
 * DELETE /api/user/symbols/:symbol
 */
app.delete('/api/user/symbols/:symbol', authMiddleware, async (req, res) => {
  const removed = await removeCustomSymbol(req.user.id, req.params.symbol);
  
  if (!removed) {
    return res.status(404).json({ error: 'Symbol not found' });
  }
  
  res.json({ success: true });
});

/**
 * Sync custom symbols from localStorage
 * POST /api/user/symbols/sync
 * Body: { symbols: [{ symbol, name }, ...] }
 */
app.post('/api/user/symbols/sync', authMiddleware, express.json(), async (req, res) => {
  const { symbols } = req.body;
  
  if (!Array.isArray(symbols)) {
    return res.status(400).json({ error: 'Symbols array is required' });
  }
  
  try {
    const result = await syncCustomSymbols(req.user.id, symbols);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to sync symbols' });
  }
});

// Yahoo Finance proxy endpoints
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const YAHOO_QUOTE_URL = 'https://query2.finance.yahoo.com/v6/finance/quote';

// Import historical prices service for DB caching
import * as historicalPricesService from './historicalPrices.js';

/**
 * Convert period/range string to date range
 * @param {string} range - e.g., '1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'max'
 * @returns {{ startDate: string, endDate: string }} Date range in YYYY-MM-DD format
 */
function rangeToDateRange(range) {
  const endDate = new Date();
  let startDate = new Date();
  
  switch (range) {
    case '1d':
      startDate.setDate(startDate.getDate() - 1);
      break;
    case '5d':
      startDate.setDate(startDate.getDate() - 5);
      break;
    case '1mo':
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case '3mo':
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case '6mo':
      startDate.setMonth(startDate.getMonth() - 6);
      break;
    case '1y':
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    case '2y':
      startDate.setFullYear(startDate.getFullYear() - 2);
      break;
    case '5y':
      startDate.setFullYear(startDate.getFullYear() - 5);
      break;
    case '10y':
      startDate.setFullYear(startDate.getFullYear() - 10);
      break;
    case 'max':
      startDate.setFullYear(startDate.getFullYear() - 30);
      break;
    default:
      // Try to parse as period like '1y', '6mo'
      const match = range.match(/^(\d+)(d|mo|y)$/);
      if (match) {
        const num = parseInt(match[1]);
        const unit = match[2];
        if (unit === 'd') startDate.setDate(startDate.getDate() - num);
        else if (unit === 'mo') startDate.setMonth(startDate.getMonth() - num);
        else if (unit === 'y') startDate.setFullYear(startDate.getFullYear() - num);
      } else {
        // Default to 1 year
        startDate.setFullYear(startDate.getFullYear() - 1);
      }
  }
  
  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  };
}

/**
 * Convert historical prices from DB format to Yahoo Chart format
 * @param {string} symbol
 * @param {Array} prices - Array of {date, open, high, low, close, volume}
 * @returns {Object} Yahoo Chart API format
 */
function convertToYahooChartFormat(symbol, prices) {
  if (!prices || prices.length === 0) {
    return null;
  }
  
  const timestamps = [];
  const opens = [];
  const highs = [];
  const lows = [];
  const closes = [];
  const volumes = [];
  
  for (const p of prices) {
    // Convert date to Unix timestamp
    timestamps.push(Math.floor(new Date(p.date).getTime() / 1000));
    opens.push(p.open);
    highs.push(p.high);
    lows.push(p.low);
    closes.push(p.close);
    volumes.push(p.volume || 0);
  }
  
  return {
    chart: {
      result: [{
        meta: {
          symbol: symbol.toUpperCase(),
          currency: 'USD',
          exchangeName: 'UNKNOWN',
          instrumentType: 'EQUITY',
          regularMarketPrice: closes[closes.length - 1],
          previousClose: closes.length > 1 ? closes[closes.length - 2] : closes[0],
          dataGranularity: '1d',
          range: '',
        },
        timestamp: timestamps,
        indicators: {
          quote: [{
            open: opens,
            high: highs,
            low: lows,
            close: closes,
            volume: volumes,
          }],
          adjclose: [{
            adjclose: closes, // Use close as adjclose if not available
          }],
        },
      }],
      error: null,
    },
    _source: 'database_cache',
  };
}

/**
 * Proxy Yahoo Finance quote data (includes market cap, PE, etc.)
 * GET /api/yahoo/quote/:symbols
 * symbols can be comma-separated for batch requests
 * 
 * Uses server-side caching to reduce API calls
 */
app.get('/api/yahoo/quote/:symbols', async (req, res) => {
  const { symbols } = req.params;
  const cacheKey = `yahoo:quote:${symbols}`;
  
  // Check cache first (if database is configured)
  if (process.env.DATABASE_URL) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      return res.json({
        ...cached.data,
        _cache: { fromCache: true, cachedAt: cached.cachedAt, source: cached.source }
      });
    }
  }
  
  try {
    const url = `${YAHOO_QUOTE_URL}?symbols=${encodeURIComponent(symbols)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    
    if (!response.ok) {
      console.error(`Yahoo Finance quote error: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ 
        error: 'Yahoo Finance quote error',
        status: response.status,
        message: response.statusText
      });
    }
    
    const data = await response.json();
    
    // Cache the response (short TTL for quotes)
    if (process.env.DATABASE_URL) {
      await stockCache.setCache(cacheKey, 'quote', symbols.split(',')[0].toUpperCase(), data, 'yahoo', stockCache.CACHE_DURATIONS.quote);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Yahoo Finance quote proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch quote from Yahoo Finance',
      message: error.message 
    });
  }
});

/**
 * Proxy Yahoo Finance chart data
 * GET /api/yahoo/chart/:symbol
 * Query params: interval, range
 * 
 * Uses server-side caching to reduce API calls
 */
app.get('/api/yahoo/chart/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { interval = '1d', range = '1y', period } = req.query;
  
  // Support both 'range' and 'period' params (period takes precedence)
  const effectiveRange = period || range;
  const cacheKey = `yahoo:chart:${symbol}:${interval}:${effectiveRange}`;
  
  // For daily interval, try to use persistent historical_prices table first
  // This avoids repeated API calls for data that doesn't change
  if (interval === '1d' && process.env.DATABASE_URL) {
    try {
      const { startDate, endDate } = rangeToDateRange(effectiveRange);
      
      // Check if we have sufficient data in the database
      const availability = await historicalPricesService.checkHistoricalDataAvailability(
        symbol, startDate, endDate
      );
      
      if (availability.hasData) {
        // Serve from database
        const prices = await historicalPricesService.getHistoricalPrices(symbol, startDate, endDate);
        if (prices && prices.length > 0) {
          const chartData = convertToYahooChartFormat(symbol, prices);
          console.log(`[Yahoo Chart] Serving ${symbol} (${effectiveRange}) from database: ${prices.length} records`);
          return res.json({
            ...chartData,
            _cache: { 
              fromCache: true, 
              source: 'historical_prices_db',
              recordCount: prices.length,
              dateRange: { startDate, endDate }
            }
          });
        }
      }
      
      // Data not in DB or insufficient - fetch from Yahoo and store
      console.log(`[Yahoo Chart] Fetching ${symbol} (${effectiveRange}) from Yahoo Finance and storing in DB...`);
      const fetchResult = await historicalPricesService.fetchAndStoreHistoricalData(symbol, startDate, endDate);
      
      if (fetchResult.success) {
        // Now serve the freshly stored data
        const prices = await historicalPricesService.getHistoricalPrices(symbol, startDate, endDate);
        if (prices && prices.length > 0) {
          const chartData = convertToYahooChartFormat(symbol, prices);
          console.log(`[Yahoo Chart] Stored and serving ${symbol}: ${prices.length} records`);
          return res.json({
            ...chartData,
            _cache: { 
              fromCache: false, 
              source: 'freshly_fetched_and_stored',
              recordCount: prices.length,
              dateRange: { startDate, endDate }
            }
          });
        }
      }
      
      // Fall through to direct Yahoo API if DB storage failed
      console.log(`[Yahoo Chart] DB storage failed for ${symbol}, falling back to direct API`);
    } catch (dbError) {
      console.error(`[Yahoo Chart] Database error for ${symbol}:`, dbError.message);
      // Fall through to direct Yahoo API
    }
  }
  
  // Check short-term cache for non-daily intervals or as fallback
  if (process.env.DATABASE_URL) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      return res.json({
        ...cached.data,
        _cache: { fromCache: true, cachedAt: cached.cachedAt, source: cached.source }
      });
    }
  }
  
  try {
    const url = `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?interval=${interval}&range=${effectiveRange}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DayTrader/1.0)',
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.error(`Yahoo Finance API error: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ 
        error: 'Yahoo Finance API error',
        status: response.status,
        message: response.statusText
      });
    }
    
    const data = await response.json();
    
    // Cache the response (short-term)
    if (process.env.DATABASE_URL) {
      const ttl = interval === '1d' ? stockCache.CACHE_DURATIONS.candles_daily : stockCache.CACHE_DURATIONS.candles_intraday;
      await stockCache.setCache(cacheKey, 'candles', symbol.toUpperCase(), data, 'yahoo', ttl);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Yahoo Finance proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch from Yahoo Finance',
      message: error.message 
    });
  }
});

/**
 * Proxy Yahoo Finance quote summary (for company details)
 * GET /api/yahoo/quoteSummary/:symbol
 * Query params: modules (comma-separated list of modules)
 * 
 * Available modules: assetProfile, summaryProfile, summaryDetail, 
 * financialData, defaultKeyStatistics, price, etc.
 * 
 * Uses server-side caching (company info changes rarely)
 */
app.get('/api/yahoo/quoteSummary/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { modules = 'summaryDetail,price,defaultKeyStatistics' } = req.query;
  const cacheKey = `yahoo:summary:${symbol}:${modules}`;
  
  // Check cache first (if database is configured)
  if (process.env.DATABASE_URL) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      return res.json({
        ...cached.data,
        _cache: { fromCache: true, cachedAt: cached.cachedAt, source: cached.source }
      });
    }
  }
  
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DayTrader/1.0)',
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.error(`Yahoo Finance quoteSummary error: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ 
        error: 'Yahoo Finance quoteSummary error',
        status: response.status,
        message: response.statusText
      });
    }
    
    const data = await response.json();
    
    // Cache company info longer (it changes rarely)
    if (process.env.DATABASE_URL) {
      await stockCache.setCache(cacheKey, 'company_info', symbol.toUpperCase(), data, 'yahoo', stockCache.CACHE_DURATIONS.company_info);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Yahoo Finance quoteSummary proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch quote summary from Yahoo Finance',
      message: error.message 
    });
  }
});

/**
 * Get EUR/USD exchange rate
 * GET /api/forex/eurusd
 */
app.get('/api/forex/eurusd', async (req, res) => {
  try {
    // Use Yahoo Finance to get EUR/USD rate
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=1d&range=1d`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DayTrader/1.0)',
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      // Fallback rate if API fails
      return res.json({ rate: 0.92, source: 'fallback' });
    }
    
    const data = await response.json();
    const rate = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    
    if (rate) {
      // EUR/USD gives us how many USD per EUR, we want USD to EUR (inverse)
      res.json({ rate: 1 / rate, source: 'yahoo' });
    } else {
      res.json({ rate: 0.92, source: 'fallback' });
    }
  } catch (error) {
    console.error('Forex rate error:', error);
    res.json({ rate: 0.92, source: 'fallback' });
  }
});

/**
 * Proxy Yahoo Finance search
 * GET /api/yahoo/search
 * Query params: q (search query)
 */
app.get('/api/yahoo/search', async (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Search query (q) is required' });
  }
  
  try {
    const url = `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DayTrader/1.0)',
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.error(`Yahoo Finance search error: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ 
        error: 'Yahoo Finance search error',
        status: response.status,
        message: response.statusText
      });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Yahoo Finance search proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to search Yahoo Finance',
      message: error.message 
    });
  }
});

// ============================================================================
// Finnhub Proxy Endpoints (with shared caching)
// ============================================================================
const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';

/**
 * Proxy Finnhub quote
 * GET /api/finnhub/quote/:symbol
 * Header: X-Finnhub-Token (API key from user)
 * 
 * Results are cached in PostgreSQL for all users
 */
app.get('/api/finnhub/quote/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const apiKey = req.headers['x-finnhub-token'];
  const cacheKey = `finnhub:quote:${symbol.toUpperCase()}`;
  
  // Check cache first (shared across all users)
  if (process.env.DATABASE_URL) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      console.log(`[Finnhub] Cache hit for quote ${symbol}`);
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
  }
  
  if (!apiKey) {
    return res.status(400).json({ error: 'Finnhub API key required (X-Finnhub-Token header)' });
  }
  
  try {
    const url = `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Finnhub error: ${response.statusText}` });
    }
    
    const data = await response.json();
    
    // Cache the result for all users
    if (process.env.DATABASE_URL && data && data.c !== 0) {
      await stockCache.setCache(cacheKey, 'quote', symbol.toUpperCase(), data, 'finnhub', stockCache.CACHE_DURATIONS.quote);
      console.log(`[Finnhub] Cached quote for ${symbol}`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Finnhub quote proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch from Finnhub', message: error.message });
  }
});

/**
 * Proxy Finnhub candles (historical data)
 * GET /api/finnhub/candles/:symbol
 * Query: resolution, from, to
 * Header: X-Finnhub-Token
 */
app.get('/api/finnhub/candles/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { resolution = 'D', from, to } = req.query;
  const apiKey = req.headers['x-finnhub-token'];
  const cacheKey = `finnhub:candles:${symbol.toUpperCase()}:${resolution}:${from}:${to}`;
  
  // Check cache first
  if (process.env.DATABASE_URL) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      console.log(`[Finnhub] Cache hit for candles ${symbol}`);
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
  }
  
  if (!apiKey) {
    return res.status(400).json({ error: 'Finnhub API key required (X-Finnhub-Token header)' });
  }
  
  try {
    const url = `${FINNHUB_BASE_URL}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}&token=${apiKey}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Finnhub error: ${response.statusText}` });
    }
    
    const data = await response.json();
    
    // Cache candles (longer TTL)
    if (process.env.DATABASE_URL && data && data.s === 'ok') {
      const ttl = resolution === 'D' ? stockCache.CACHE_DURATIONS.candles_daily : stockCache.CACHE_DURATIONS.candles_intraday;
      await stockCache.setCache(cacheKey, 'candles', symbol.toUpperCase(), data, 'finnhub', ttl);
      console.log(`[Finnhub] Cached candles for ${symbol}`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Finnhub candles proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch candles from Finnhub', message: error.message });
  }
});

/**
 * Proxy Finnhub company profile
 * GET /api/finnhub/profile/:symbol
 * Header: X-Finnhub-Token
 */
app.get('/api/finnhub/profile/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const apiKey = req.headers['x-finnhub-token'];
  const cacheKey = `finnhub:profile:${symbol.toUpperCase()}`;
  
  // Check cache first (company info cached for 24h)
  if (process.env.DATABASE_URL) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      console.log(`[Finnhub] Cache hit for profile ${symbol}`);
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
  }
  
  if (!apiKey) {
    return res.status(400).json({ error: 'Finnhub API key required (X-Finnhub-Token header)' });
  }
  
  try {
    const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Finnhub error: ${response.statusText}` });
    }
    
    const data = await response.json();
    
    // Cache company info for 24 hours
    if (process.env.DATABASE_URL && data && data.name) {
      await stockCache.setCache(cacheKey, 'company_info', symbol.toUpperCase(), data, 'finnhub', stockCache.CACHE_DURATIONS.company_info);
      console.log(`[Finnhub] Cached profile for ${symbol}`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Finnhub profile proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch profile from Finnhub', message: error.message });
  }
});

/**
 * Proxy Finnhub metrics (financials)
 * GET /api/finnhub/metrics/:symbol
 * Header: X-Finnhub-Token
 */
app.get('/api/finnhub/metrics/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const apiKey = req.headers['x-finnhub-token'];
  const cacheKey = `finnhub:metrics:${symbol.toUpperCase()}`;
  
  if (process.env.DATABASE_URL) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      console.log(`[Finnhub] Cache hit for metrics ${symbol}`);
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
  }
  
  if (!apiKey) {
    return res.status(400).json({ error: 'Finnhub API key required (X-Finnhub-Token header)' });
  }
  
  try {
    const url = `${FINNHUB_BASE_URL}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${apiKey}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Finnhub error: ${response.statusText}` });
    }
    
    const data = await response.json();
    
    if (process.env.DATABASE_URL && data && data.metric) {
      await stockCache.setCache(cacheKey, 'company_info', symbol.toUpperCase(), data, 'finnhub', stockCache.CACHE_DURATIONS.company_info);
      console.log(`[Finnhub] Cached metrics for ${symbol}`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Finnhub metrics proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch metrics from Finnhub', message: error.message });
  }
});

/**
 * Proxy Finnhub company news
 * GET /api/finnhub/news/:symbol
 * Query: from, to (dates YYYY-MM-DD) - defaults to last 7 days if not provided
 * Header: X-Finnhub-Token
 */
app.get('/api/finnhub/news/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const apiKey = req.headers['x-finnhub-token'];
  
  // Default to last 7 days if from/to not provided
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const from = req.query.from || sevenDaysAgo.toISOString().split('T')[0];
  const to = req.query.to || now.toISOString().split('T')[0];
  
  const cacheKey = `finnhub:news:${symbol.toUpperCase()}:${from}:${to}`;
  
  if (process.env.DATABASE_URL) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      console.log(`[Finnhub] Cache hit for news ${symbol}`);
      return res.json({ data: cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
  }
  
  if (!apiKey) {
    return res.status(400).json({ error: 'Finnhub API key required (X-Finnhub-Token header)' });
  }
  
  try {
    const url = `${FINNHUB_BASE_URL}/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${apiKey}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Finnhub error: ${response.statusText}` });
    }
    
    const data = await response.json();
    
    // Cache news for 5 minutes
    if (process.env.DATABASE_URL && Array.isArray(data)) {
      await stockCache.setCache(cacheKey, 'news', symbol.toUpperCase(), data, 'finnhub', 300);
      console.log(`[Finnhub] Cached news for ${symbol}`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Finnhub news proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch news from Finnhub', message: error.message });
  }
});

/**
 * Proxy Finnhub symbol search
 * GET /api/finnhub/search
 * Query: q
 * Header: X-Finnhub-Token
 */
app.get('/api/finnhub/search', async (req, res) => {
  const { q } = req.query;
  const apiKey = req.headers['x-finnhub-token'];
  const cacheKey = `finnhub:search:${q?.toLowerCase()}`;
  
  if (process.env.DATABASE_URL && q) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      console.log(`[Finnhub] Cache hit for search ${q}`);
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
  }
  
  if (!apiKey) {
    return res.status(400).json({ error: 'Finnhub API key required (X-Finnhub-Token header)' });
  }
  
  if (!q) {
    return res.status(400).json({ error: 'Search query (q) is required' });
  }
  
  try {
    const url = `${FINNHUB_BASE_URL}/search?q=${encodeURIComponent(q)}&token=${apiKey}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Finnhub error: ${response.statusText}` });
    }
    
    const data = await response.json();
    
    // Cache search results for 24 hours
    if (process.env.DATABASE_URL && data && data.result) {
      await stockCache.setCache(cacheKey, 'search', q.toUpperCase(), data, 'finnhub', stockCache.CACHE_DURATIONS.search);
      console.log(`[Finnhub] Cached search for ${q}`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Finnhub search proxy error:', error);
    res.status(500).json({ error: 'Failed to search Finnhub', message: error.message });
  }
});

// ============================================================================
// Alpha Vantage Proxy Endpoints (with shared caching)
// ============================================================================
const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';

/**
 * Proxy Alpha Vantage quote (Global Quote)
 * GET /api/alphavantage/quote/:symbol
 * Header: X-AlphaVantage-Key
 */
app.get('/api/alphavantage/quote/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const apiKey = req.headers['x-alphavantage-key'];
  const cacheKey = `alphavantage:quote:${symbol.toUpperCase()}`;
  
  if (process.env.DATABASE_URL) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      console.log(`[AlphaVantage] Cache hit for quote ${symbol}`);
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
  }
  
  if (!apiKey) {
    return res.status(400).json({ error: 'Alpha Vantage API key required (X-AlphaVantage-Key header)' });
  }
  
  try {
    const url = `${ALPHA_VANTAGE_BASE_URL}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Alpha Vantage error: ${response.statusText}` });
    }
    
    const data = await response.json();
    
    // Check for rate limit message
    if (data.Note || data.Information) {
      return res.status(429).json({ error: 'Alpha Vantage rate limit exceeded', message: data.Note || data.Information });
    }
    
    if (process.env.DATABASE_URL && data['Global Quote'] && data['Global Quote']['05. price']) {
      await stockCache.setCache(cacheKey, 'quote', symbol.toUpperCase(), data, 'alphavantage', stockCache.CACHE_DURATIONS.quote);
      console.log(`[AlphaVantage] Cached quote for ${symbol}`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Alpha Vantage quote proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch from Alpha Vantage', message: error.message });
  }
});

/**
 * Proxy Alpha Vantage daily candles
 * GET /api/alphavantage/daily/:symbol
 * Query: outputsize (compact|full)
 * Header: X-AlphaVantage-Key
 */
app.get('/api/alphavantage/daily/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { outputsize = 'compact' } = req.query;
  const apiKey = req.headers['x-alphavantage-key'];
  const cacheKey = `alphavantage:daily:${symbol.toUpperCase()}:${outputsize}`;
  
  if (process.env.DATABASE_URL) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      console.log(`[AlphaVantage] Cache hit for daily ${symbol}`);
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
  }
  
  if (!apiKey) {
    return res.status(400).json({ error: 'Alpha Vantage API key required (X-AlphaVantage-Key header)' });
  }
  
  try {
    const url = `${ALPHA_VANTAGE_BASE_URL}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=${outputsize}&apikey=${apiKey}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Alpha Vantage error: ${response.statusText}` });
    }
    
    const data = await response.json();
    
    if (data.Note || data.Information) {
      return res.status(429).json({ error: 'Alpha Vantage rate limit exceeded', message: data.Note || data.Information });
    }
    
    if (process.env.DATABASE_URL && data['Time Series (Daily)']) {
      await stockCache.setCache(cacheKey, 'candles', symbol.toUpperCase(), data, 'alphavantage', stockCache.CACHE_DURATIONS.candles_daily);
      console.log(`[AlphaVantage] Cached daily for ${symbol}`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Alpha Vantage daily proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch daily from Alpha Vantage', message: error.message });
  }
});

/**
 * Proxy Alpha Vantage intraday candles
 * GET /api/alphavantage/intraday/:symbol
 * Query: interval (1min, 5min, 15min, 30min, 60min), outputsize
 * Header: X-AlphaVantage-Key
 */
app.get('/api/alphavantage/intraday/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { interval = '5min', outputsize = 'compact' } = req.query;
  const apiKey = req.headers['x-alphavantage-key'];
  const cacheKey = `alphavantage:intraday:${symbol.toUpperCase()}:${interval}:${outputsize}`;
  
  if (process.env.DATABASE_URL) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      console.log(`[AlphaVantage] Cache hit for intraday ${symbol}`);
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
  }
  
  if (!apiKey) {
    return res.status(400).json({ error: 'Alpha Vantage API key required (X-AlphaVantage-Key header)' });
  }
  
  try {
    const url = `${ALPHA_VANTAGE_BASE_URL}?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Alpha Vantage error: ${response.statusText}` });
    }
    
    const data = await response.json();
    
    if (data.Note || data.Information) {
      return res.status(429).json({ error: 'Alpha Vantage rate limit exceeded', message: data.Note || data.Information });
    }
    
    if (process.env.DATABASE_URL && data[`Time Series (${interval})`]) {
      await stockCache.setCache(cacheKey, 'candles', symbol.toUpperCase(), data, 'alphavantage', stockCache.CACHE_DURATIONS.candles_intraday);
      console.log(`[AlphaVantage] Cached intraday for ${symbol}`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Alpha Vantage intraday proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch intraday from Alpha Vantage', message: error.message });
  }
});

/**
 * Proxy Alpha Vantage company overview
 * GET /api/alphavantage/overview/:symbol
 * Header: X-AlphaVantage-Key
 */
app.get('/api/alphavantage/overview/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const apiKey = req.headers['x-alphavantage-key'];
  const cacheKey = `alphavantage:overview:${symbol.toUpperCase()}`;
  
  if (process.env.DATABASE_URL) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      console.log(`[AlphaVantage] Cache hit for overview ${symbol}`);
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
  }
  
  if (!apiKey) {
    return res.status(400).json({ error: 'Alpha Vantage API key required (X-AlphaVantage-Key header)' });
  }
  
  try {
    const url = `${ALPHA_VANTAGE_BASE_URL}?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Alpha Vantage error: ${response.statusText}` });
    }
    
    const data = await response.json();
    
    if (data.Note || data.Information) {
      return res.status(429).json({ error: 'Alpha Vantage rate limit exceeded', message: data.Note || data.Information });
    }
    
    // Cache company info for 24 hours
    if (process.env.DATABASE_URL && data && data.Symbol) {
      await stockCache.setCache(cacheKey, 'company_info', symbol.toUpperCase(), data, 'alphavantage', stockCache.CACHE_DURATIONS.company_info);
      console.log(`[AlphaVantage] Cached overview for ${symbol}`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Alpha Vantage overview proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch overview from Alpha Vantage', message: error.message });
  }
});

/**
 * Proxy Alpha Vantage symbol search
 * GET /api/alphavantage/search
 * Query: keywords
 * Header: X-AlphaVantage-Key
 */
app.get('/api/alphavantage/search', async (req, res) => {
  const { keywords } = req.query;
  const apiKey = req.headers['x-alphavantage-key'];
  const cacheKey = `alphavantage:search:${keywords?.toLowerCase()}`;
  
  if (process.env.DATABASE_URL && keywords) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      console.log(`[AlphaVantage] Cache hit for search ${keywords}`);
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
  }
  
  if (!apiKey) {
    return res.status(400).json({ error: 'Alpha Vantage API key required (X-AlphaVantage-Key header)' });
  }
  
  if (!keywords) {
    return res.status(400).json({ error: 'Search keywords required' });
  }
  
  try {
    const url = `${ALPHA_VANTAGE_BASE_URL}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(keywords)}&apikey=${apiKey}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Alpha Vantage error: ${response.statusText}` });
    }
    
    const data = await response.json();
    
    if (data.Note || data.Information) {
      return res.status(429).json({ error: 'Alpha Vantage rate limit exceeded', message: data.Note || data.Information });
    }
    
    if (process.env.DATABASE_URL && data && data.bestMatches) {
      await stockCache.setCache(cacheKey, 'search', keywords.toUpperCase(), data, 'alphavantage', stockCache.CACHE_DURATIONS.search);
      console.log(`[AlphaVantage] Cached search for ${keywords}`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Alpha Vantage search proxy error:', error);
    res.status(500).json({ error: 'Failed to search Alpha Vantage', message: error.message });
  }
});

// ============================================================================
// Twelve Data Proxy Endpoints (with shared caching)
// ============================================================================
const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com';

/**
 * Proxy Twelve Data quote
 * GET /api/twelvedata/quote/:symbol
 * Header: X-TwelveData-Key
 */
app.get('/api/twelvedata/quote/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const apiKey = req.headers['x-twelvedata-key'];
  const cacheKey = `twelvedata:quote:${symbol.toUpperCase()}`;
  
  if (process.env.DATABASE_URL) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      console.log(`[TwelveData] Cache hit for quote ${symbol}`);
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
  }
  
  if (!apiKey) {
    return res.status(400).json({ error: 'Twelve Data API key required (X-TwelveData-Key header)' });
  }
  
  try {
    const url = `${TWELVE_DATA_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Twelve Data error: ${response.statusText}` });
    }
    
    const data = await response.json();
    
    if (data.code || data.status === 'error') {
      return res.status(400).json({ error: data.message || 'Twelve Data error' });
    }
    
    if (process.env.DATABASE_URL && data && data.close) {
      await stockCache.setCache(cacheKey, 'quote', symbol.toUpperCase(), data, 'twelvedata', stockCache.CACHE_DURATIONS.quote);
      console.log(`[TwelveData] Cached quote for ${symbol}`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Twelve Data quote proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch from Twelve Data', message: error.message });
  }
});

/**
 * Proxy Twelve Data time series
 * GET /api/twelvedata/timeseries/:symbol
 * Query: interval, outputsize
 * Header: X-TwelveData-Key
 */
app.get('/api/twelvedata/timeseries/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { interval = '1day', outputsize = '100' } = req.query;
  const apiKey = req.headers['x-twelvedata-key'];
  const cacheKey = `twelvedata:timeseries:${symbol.toUpperCase()}:${interval}:${outputsize}`;
  
  if (process.env.DATABASE_URL) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      console.log(`[TwelveData] Cache hit for timeseries ${symbol}`);
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
  }
  
  if (!apiKey) {
    return res.status(400).json({ error: 'Twelve Data API key required (X-TwelveData-Key header)' });
  }
  
  try {
    const url = `${TWELVE_DATA_BASE_URL}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Twelve Data error: ${response.statusText}` });
    }
    
    const data = await response.json();
    
    if (data.code || data.status === 'error') {
      return res.status(400).json({ error: data.message || 'Twelve Data error' });
    }
    
    if (process.env.DATABASE_URL && data && data.values) {
      const ttl = interval.includes('day') || interval.includes('week') || interval.includes('month') 
        ? stockCache.CACHE_DURATIONS.candles_daily 
        : stockCache.CACHE_DURATIONS.candles_intraday;
      await stockCache.setCache(cacheKey, 'candles', symbol.toUpperCase(), data, 'twelvedata', ttl);
      console.log(`[TwelveData] Cached timeseries for ${symbol}`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Twelve Data timeseries proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch timeseries from Twelve Data', message: error.message });
  }
});

/**
 * Proxy Twelve Data symbol search
 * GET /api/twelvedata/search
 * Query: symbol (search query)
 * Header: X-TwelveData-Key (optional for search)
 */
app.get('/api/twelvedata/search', async (req, res) => {
  const { symbol } = req.query;
  const apiKey = req.headers['x-twelvedata-key'];
  const cacheKey = `twelvedata:search:${symbol?.toLowerCase()}`;
  
  if (process.env.DATABASE_URL && symbol) {
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      console.log(`[TwelveData] Cache hit for search ${symbol}`);
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
  }
  
  if (!symbol) {
    return res.status(400).json({ error: 'Search symbol required' });
  }
  
  try {
    let url = `${TWELVE_DATA_BASE_URL}/symbol_search?symbol=${encodeURIComponent(symbol)}`;
    if (apiKey) {
      url += `&apikey=${apiKey}`;
    }
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Twelve Data error: ${response.statusText}` });
    }
    
    const data = await response.json();
    
    if (process.env.DATABASE_URL && data && data.data) {
      await stockCache.setCache(cacheKey, 'search', symbol.toUpperCase(), data, 'twelvedata', stockCache.CACHE_DURATIONS.search);
      console.log(`[TwelveData] Cached search for ${symbol}`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Twelve Data search proxy error:', error);
    res.status(500).json({ error: 'Failed to search Twelve Data', message: error.message });
  }
});

// NewsAPI proxy endpoints
const NEWS_API_BASE_URL = 'https://newsapi.org/v2';

/**
 * Proxy NewsAPI everything endpoint
 * GET /api/news/everything
 * Query params: q, language, sortBy, pageSize, apiKey
 * 
 * NewsAPI requires server-side requests for free tier (426 error from browser)
 */
app.get('/api/news/everything', async (req, res) => {
  const { q, language = 'en', sortBy = 'publishedAt', pageSize = '10', apiKey } = req.query;
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }
  
  if (!q) {
    return res.status(400).json({ error: 'Search query (q) is required' });
  }
  
  try {
    const url = new URL(`${NEWS_API_BASE_URL}/everything`);
    url.searchParams.set('apiKey', apiKey);
    url.searchParams.set('q', q);
    url.searchParams.set('language', language);
    url.searchParams.set('sortBy', sortBy);
    url.searchParams.set('pageSize', pageSize);
    
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DayTrader/1.0)',
        'Accept': 'application/json',
      },
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error(`NewsAPI error: ${response.status} ${data.message || response.statusText}`);
      return res.status(response.status).json({ 
        error: 'NewsAPI error',
        status: response.status,
        message: data.message || response.statusText
      });
    }
    
    res.json(data);
  } catch (error) {
    console.error('NewsAPI proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch from NewsAPI',
      message: error.message 
    });
  }
});

// ML Service proxy endpoints
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml-service:8000';

/**
 * Proxy ML Service health check
 */
app.get('/api/ml/health', async (req, res) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/health`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('ML Service health check error:', error);
    res.status(503).json({ 
      error: 'ML Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy ML Service version
 */
app.get('/api/ml/version', async (req, res) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/version`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('ML Service version error:', error);
    res.status(503).json({ 
      error: 'ML Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy ML Service models list
 */
app.get('/api/ml/models', async (req, res) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/models`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('ML Service models error:', error);
    res.status(503).json({ 
      error: 'ML Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy ML Service model info
 */
app.get('/api/ml/models/:symbol', async (req, res) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/models/${req.params.symbol}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('ML Service model info error:', error);
    res.status(503).json({ 
      error: 'ML Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy ML Service training
 */
app.post('/api/ml/train', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('ML Service training error:', error);
    res.status(503).json({ 
      error: 'ML Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy ML Service training status
 */
app.get('/api/ml/train/:symbol/status', async (req, res) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/train/${req.params.symbol}/status`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('ML Service training status error:', error);
    res.status(503).json({ 
      error: 'ML Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy ML Service prediction
 */
app.post('/api/ml/predict', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('ML Service prediction error:', error);
    res.status(503).json({ 
      error: 'ML Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy ML Service model deletion
 */
app.delete('/api/ml/models/:symbol', async (req, res) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/models/${req.params.symbol}`, {
      method: 'DELETE'
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('ML Service model deletion error:', error);
    res.status(503).json({ 
      error: 'ML Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy ML Service sentiment status
 */
app.get('/api/ml/sentiment/status', async (req, res) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/sentiment/status`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('ML Service sentiment status error:', error);
    res.status(503).json({ 
      error: 'ML Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy ML Service sentiment load
 */
app.post('/api/ml/sentiment/load', async (req, res) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/sentiment/load`, {
      method: 'POST'
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('ML Service sentiment load error:', error);
    res.status(503).json({ 
      error: 'ML Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy ML Service sentiment analyze (single)
 */
app.post('/api/ml/sentiment/analyze', express.json(), async (req, res) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/sentiment/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('ML Service sentiment analyze error:', error);
    res.status(503).json({ 
      error: 'ML Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy ML Service sentiment analyze batch
 */
app.post('/api/ml/sentiment/analyze/batch', express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/sentiment/analyze/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('ML Service sentiment batch analyze error:', error);
    res.status(503).json({ 
      error: 'ML Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Combined Sentiment Analysis for Symbol
 * 
 * Fetches news for a symbol and analyzes sentiment using FinBERT.
 * Used by AI Trader for sentiment signals.
 * Falls back to sentiment archive if no fresh data available.
 * 
 * GET /api/ml/sentiment/:symbol
 */
app.get('/api/ml/sentiment/:symbol', async (req, res) => {
  const { symbol } = req.params;
  
  // Helper to get archived sentiment as fallback
  const getArchivedFallback = async () => {
    try {
      const archived = await sentimentArchive.getLatestSentiment(symbol);
      if (archived && archived.score !== undefined) {
        const ageMinutes = (Date.now() - new Date(archived.analyzedAt).getTime()) / (1000 * 60);
        // Use archive if less than 24 hours old
        if (ageMinutes < 60 * 24) {
          console.log(`[Sentiment] Using archived sentiment for ${symbol} (${Math.round(ageMinutes)} min old)`);
          return {
            symbol: symbol.toUpperCase(),
            sentiment: archived.sentiment,
            score: archived.score,
            confidence: archived.confidence * 0.9, // Slightly reduce confidence for archived data
            news_count: archived.newsCount,
            sources: archived.sources || [],
            message: `Using archived sentiment (${Math.round(ageMinutes)} min old)`,
            is_archived: true
          };
        }
      }
    } catch (archiveErr) {
      console.warn(`[Sentiment] Archive fallback error:`, archiveErr.message);
    }
    return null;
  };
  
  try {
    // Check cache first
    const cacheKey = `sentiment:combined:${symbol.toUpperCase()}`;
    const cached = await stockCache.getCached(cacheKey);
    if (cached && cached.data) {
      console.log(`[Sentiment] Cache hit for ${symbol}`);
      return res.json(cached.data);
    }
    
    // For international symbols (e.g., MRK.DE, SAP.DE), extract base symbol and get company name
    const baseSymbol = symbol.split('.')[0].toUpperCase();
    let companyName = null;
    
    // Try to get company name from Yahoo Finance for better news search
    if (symbol.includes('.')) {
      try {
        const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
        const quoteRes = await fetch(quoteUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (quoteRes.ok) {
          const quoteData = await quoteRes.json();
          const result = quoteData?.quoteResponse?.result?.[0];
          if (result) {
            // Extract company name without legal suffixes
            companyName = (result.longName || result.shortName || '')
              .replace(/\s*(Inc\.?|Corp\.?|Ltd\.?|PLC|AG|SE|KGaA|N\.V\.|S\.A\.|GmbH|Co\.|& Co|Holdings?|Group|International)\s*/gi, '')
              .trim();
            console.log(`[Sentiment] International symbol ${symbol} -> base: ${baseSymbol}, company: ${companyName}`);
          }
        }
      } catch (err) {
        console.warn(`[Sentiment] Could not fetch company name for ${symbol}:`, err.message);
      }
    }
    
    // Fetch news from multiple sources
    const newsTexts = [];
    const sources = [];
    
    // Get API keys from any user settings (for internal AI Trader use)
    let finnhubApiKey = null;
    let marketauxApiKey = null;
    
    try {
      const apiKeyResult = await db.query(
        `SELECT api_keys FROM user_settings WHERE api_keys IS NOT NULL LIMIT 1`
      );
      if (apiKeyResult.rows.length > 0) {
        const apiKeys = apiKeyResult.rows[0].api_keys || {};
        finnhubApiKey = apiKeys.finnhub || null;
        marketauxApiKey = apiKeys.marketaux || null;
      }
    } catch (dbErr) {
      console.warn(`[Sentiment] Could not fetch API keys from DB:`, dbErr.message);
    }
    
    // Build list of symbols/terms to search for
    const searchTerms = [symbol.toUpperCase()];
    if (baseSymbol !== symbol.toUpperCase()) {
      searchTerms.push(baseSymbol);
    }
    
    // Try Finnhub first
    if (finnhubApiKey) {
      const to = new Date().toISOString().split('T')[0];
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      // Try each search term until we find news
      for (const term of searchTerms) {
        if (newsTexts.length >= 5) break;
        try {
          const finnhubUrl = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(term)}&from=${from}&to=${to}&token=${finnhubApiKey}`;
          const response = await fetch(finnhubUrl);
          if (response.ok) {
            const news = await response.json();
            if (Array.isArray(news) && news.length > 0) {
              console.log(`[Sentiment] Finnhub found ${news.length} news for term "${term}"`);
              news.slice(0, 10).forEach(item => {
                if (item.headline && !newsTexts.includes(item.headline)) {
                  newsTexts.push(item.headline);
                  sources.push({ source: 'finnhub', headline: item.headline });
                }
              });
            }
          }
        } catch (err) {
          console.warn(`[Sentiment] Finnhub error for ${term}:`, err.message);
        }
      }
    }
    
    // Try Marketaux as backup (supports company name search)
    if (marketauxApiKey && newsTexts.length < 5) {
      // Marketaux can search by symbol or by search query
      const marketauxSearches = [symbol.toUpperCase()];
      if (baseSymbol !== symbol.toUpperCase()) {
        marketauxSearches.push(baseSymbol);
      }
      if (companyName && companyName.length > 2) {
        marketauxSearches.push(companyName);
      }
      
      for (const term of marketauxSearches) {
        if (newsTexts.length >= 10) break;
        try {
          // Use symbols parameter for ticker, search parameter for company name
          const isCompanyName = term === companyName;
          const marketauxUrl = isCompanyName
            ? `https://api.marketaux.com/v1/news/all?search=${encodeURIComponent(term)}&filter_entities=true&language=en&api_token=${marketauxApiKey}`
            : `https://api.marketaux.com/v1/news/all?symbols=${encodeURIComponent(term)}&filter_entities=true&language=en&api_token=${marketauxApiKey}`;
          
          const response = await fetch(marketauxUrl);
          if (response.ok) {
            const data = await response.json();
            if (data.data && Array.isArray(data.data) && data.data.length > 0) {
              console.log(`[Sentiment] Marketaux found ${data.data.length} news for term "${term}"`);
              data.data.slice(0, 10).forEach(item => {
                if (item.title && !newsTexts.includes(item.title)) {
                  newsTexts.push(item.title);
                  sources.push({ source: 'marketaux', headline: item.title });
                }
              });
            }
          }
        } catch (err) {
          console.warn(`[Sentiment] Marketaux error for ${term}:`, err.message);
        }
      }
    }
    
    // If no news found, try archived sentiment first
    if (newsTexts.length === 0) {
      const archivedFallback = await getArchivedFallback();
      if (archivedFallback) {
        return res.json(archivedFallback);
      }
      
      const neutralResult = {
        symbol: symbol.toUpperCase(),
        sentiment: 'neutral',
        score: 0,
        confidence: 0,
        news_count: 0,
        sources: [],
        message: 'No recent news found for sentiment analysis (no API keys or no news available)'
      };
      // Cache for only 15 minutes if no news (try again sooner)
      await stockCache.setCache(cacheKey, 'sentiment', symbol.toUpperCase(), neutralResult, 'combined', 900);
      return res.json(neutralResult);
    }
    
    // Check if ML service sentiment model is loaded first
    let mlModelLoaded = false;
    try {
      const statusResponse = await fetch(`${ML_SERVICE_URL}/api/ml/sentiment/status`);
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        mlModelLoaded = statusData.loaded === true;
      }
    } catch (statusErr) {
      console.warn(`[Sentiment] ML service status check failed:`, statusErr.message);
    }
    
    // If ML model not loaded, try archived sentiment first
    if (!mlModelLoaded) {
      console.warn(`[Sentiment] FinBERT model not loaded for ${symbol}`);
      
      const archivedFallback = await getArchivedFallback();
      if (archivedFallback) {
        return res.json(archivedFallback);
      }
      
      const neutralResult = {
        symbol: symbol.toUpperCase(),
        sentiment: 'neutral',
        score: 0,
        confidence: 0.3,
        news_count: newsTexts.length,
        sources: sources.slice(0, 5),
        message: 'Sentiment model not available (FinBERT not loaded)'
      };
      // Cache for only 10 minutes (model might load soon)
      await stockCache.setCache(cacheKey, 'sentiment', symbol.toUpperCase(), neutralResult, 'combined', 600);
      return res.json(neutralResult);
    }
    
    // Analyze sentiment using ML service batch endpoint
    const mlResponse = await fetch(`${ML_SERVICE_URL}/api/ml/sentiment/analyze/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: newsTexts })
    });
    
    if (!mlResponse.ok) {
      throw new Error(`ML Service returned ${mlResponse.status}`);
    }
    
    const mlData = await mlResponse.json();
    const results = (mlData.results || []).filter(r => r !== null);
    
    // If all results failed, try archived sentiment
    if (results.length === 0) {
      const archivedFallback = await getArchivedFallback();
      if (archivedFallback) {
        return res.json(archivedFallback);
      }
      
      const neutralResult = {
        symbol: symbol.toUpperCase(),
        sentiment: 'neutral',
        score: 0,
        confidence: 0.3,
        news_count: newsTexts.length,
        sources: sources.slice(0, 5),
        message: 'Sentiment analysis returned no valid results'
      };
      // Cache for only 15 minutes
      await stockCache.setCache(cacheKey, 'sentiment', symbol.toUpperCase(), neutralResult, 'combined', 900);
      return res.json(neutralResult);
    }
    
    // Aggregate sentiment scores
    let totalScore = 0;
    let totalConfidence = 0;
    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;
    
    results.forEach(r => {
      totalScore += r.score || 0;
      totalConfidence += r.confidence || 0;
      if (r.sentiment === 'positive') positiveCount++;
      else if (r.sentiment === 'negative') negativeCount++;
      else neutralCount++;
    });
    
    const avgScore = results.length > 0 ? totalScore / results.length : 0;
    const avgConfidence = results.length > 0 ? totalConfidence / results.length : 0;
    
    // Determine overall sentiment
    let overallSentiment = 'neutral';
    if (avgScore > 0.1) overallSentiment = 'positive';
    else if (avgScore < -0.1) overallSentiment = 'negative';
    
    const result = {
      symbol: symbol.toUpperCase(),
      sentiment: overallSentiment,
      score: parseFloat(avgScore.toFixed(4)),
      confidence: parseFloat(avgConfidence.toFixed(4)),
      news_count: newsTexts.length,
      positive_count: positiveCount,
      negative_count: negativeCount,
      neutral_count: neutralCount,
      sources: sources.slice(0, 5)  // Limit to first 5 sources
    };
    
    // Cache for 60 minutes (was 10 min)
    await stockCache.setCache(cacheKey, 'sentiment', symbol.toUpperCase(), result, 'combined', 3600);
    console.log(`[Sentiment] Analyzed ${newsTexts.length} news items for ${symbol}: ${overallSentiment} (${avgScore.toFixed(3)})`);
    
    // Archive sentiment for historical analysis
    try {
      await sentimentArchive.archiveSentiment(result);
    } catch (archiveError) {
      console.warn(`[Sentiment] Failed to archive sentiment: ${archiveError.message}`);
    }
    
    res.json(result);
    
  } catch (error) {
    console.error(`[Sentiment] Error analyzing ${symbol}:`, error.message);
    
    // Try archived sentiment as final fallback
    const archivedFallback = await getArchivedFallback();
    if (archivedFallback) {
      archivedFallback.error_recovered = true;
      archivedFallback.original_error = error.message;
      return res.json(archivedFallback);
    }
    
    res.status(500).json({
      symbol: symbol.toUpperCase(),
      sentiment: 'neutral',
      score: 0,
      confidence: 0,
      news_count: 0,
      error: error.message
    });
  }
});

// ============================================================================
// Sentiment Archive endpoints
// ============================================================================

/**
 * Get sentiment history for a symbol
 */
app.get('/api/sentiment/history/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { days = 30, limit = 100 } = req.query;
    const history = await sentimentArchive.getSentimentHistory(symbol, parseInt(days), parseInt(limit));
    res.json({
      symbol: symbol.toUpperCase(),
      history,
      count: history.length,
      days_requested: parseInt(days)
    });
  } catch (error) {
    console.error(`[Sentiment Archive] Error fetching history for ${req.params.symbol}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get sentiment trend for a symbol
 */
app.get('/api/sentiment/trend/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { days = 7 } = req.query;
    const trend = await sentimentArchive.getSentimentTrend(symbol, parseInt(days));
    res.json({
      symbol: symbol.toUpperCase(),
      ...trend
    });
  } catch (error) {
    console.error(`[Sentiment Archive] Error fetching trend for ${req.params.symbol}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get list of symbols with archived sentiments
 */
app.get('/api/sentiment/symbols', async (req, res) => {
  try {
    const symbols = await sentimentArchive.getArchivedSymbols();
    res.json({ symbols, count: symbols.length });
  } catch (error) {
    console.error('[Sentiment Archive] Error fetching symbols:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// RL Trading Service proxy endpoints
// ============================================================================

const RL_SERVICE_URL = process.env.RL_SERVICE_URL || 'http://rl-trading-service:8001';

/**
 * Proxy RL Trading Service health check
 */
app.get('/api/rl/health', async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/health`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('RL Trading Service health check error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service info
 */
app.get('/api/rl/info', async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/info`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('RL Trading Service info error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - list agents
 */
app.get('/api/rl/agents', async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/agents`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('RL Trading Service agents list error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - get agent status
 */
app.get('/api/rl/agents/:agentName', async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/agents/${req.params.agentName}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('RL Trading Service agent status error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - delete agent
 */
app.delete('/api/rl/agents/:agentName', authMiddleware, async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/agents/${req.params.agentName}`, {
      method: 'DELETE'
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('RL Trading Service agent deletion error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - list presets
 */
app.get('/api/rl/presets', async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/presets`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('RL Trading Service presets error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - get preset
 */
app.get('/api/rl/presets/:presetName', async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/presets/${req.params.presetName}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('RL Trading Service preset error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - train agent
 */
app.post('/api/rl/train', authMiddleware, express.json({ limit: '100mb' }), async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('RL Trading Service train error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - train agent from backend data
 */
app.post('/api/rl/train/from-backend', authMiddleware, express.json(), async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/train/from-backend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('RL Trading Service train from backend error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - get training status
 */
app.get('/api/rl/train/status/:agentName', async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/train/status/${req.params.agentName}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('RL Trading Service training status error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - get training logs
 */
app.get('/api/rl/train/logs/:agentName', async (req, res) => {
  try {
    const since = req.query.since || 0;
    const response = await fetch(`${RL_SERVICE_URL}/train/logs/${req.params.agentName}?since=${since}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('RL Trading Service training logs error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - get trading signal
 */
app.post('/api/rl/signal', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('RL Trading Service signal error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - get signal with explanation
 */
app.post('/api/rl/signal/explain', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/signal/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('RL Trading Service explain error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - get signals from multiple agents
 */
app.post('/api/rl/signals/multi', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/signals/multi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('RL Trading Service multi-signal error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - quick signal (auto fetches data)
 */
app.get('/api/rl/signal/:agentName/quick', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'AAPL';
    const response = await fetch(`${RL_SERVICE_URL}/signal/${req.params.agentName}/quick?symbol=${symbol}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('RL Trading Service quick signal error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - configuration options
 */
app.get('/api/rl/options/:optionType', async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/options/${req.params.optionType}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('RL Trading Service options error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

/**
 * Proxy RL Trading Service - AI Trader self-training status
 */
app.get('/api/rl/ai-trader/:traderId/self-training-status', async (req, res) => {
  try {
    const response = await fetch(`${RL_SERVICE_URL}/ai-trader/${req.params.traderId}/self-training-status`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('RL Trading Service self-training status error:', error);
    res.status(503).json({ 
      error: 'RL Trading Service unavailable',
      message: error.message 
    });
  }
});

// ============================================================================
// Watchlist Signal Cache Endpoints
// ============================================================================

const WATCHLIST_SIGNAL_CACHE_TTL = 900; // 15 minutes

/**
 * Get cached trading signals for a symbol (extended signals with all sources)
 * GET /api/watchlist/signals/:symbol
 * Returns cached signal data including news sentiment, ML predictions, RL signals
 */
app.get('/api/watchlist/signals/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const cacheKey = `watchlist:signals:${symbol}`;
  
  try {
    // Check cache first
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      return res.json({ ...cached.data, fromCache: true, cachedAt: cached.cachedAt });
    }
    
    // Not in cache - return empty so frontend knows to fetch fresh data
    res.json({ cached: false, symbol });
  } catch (error) {
    console.error('Watchlist signal cache error:', error);
    res.status(500).json({ error: 'Cache lookup failed' });
  }
});

/**
 * Store computed trading signals in cache
 * POST /api/watchlist/signals/:symbol
 * Body: { signals, sources, ttlSeconds } - sources contains {hasNews, hasML, hasRL}
 */
app.post('/api/watchlist/signals/:symbol', express.json({ limit: '1mb' }), async (req, res) => {
  const { symbol } = req.params;
  const { signals, sources, ttlSeconds: requestTTL } = req.body;
  const cacheKey = `watchlist:signals:${symbol}`;
  
  // Custom TTL or default (15 minutes)
  const ttlSeconds = requestTTL || WATCHLIST_SIGNAL_CACHE_TTL;
  
  try {
    await stockCache.setCache(
      cacheKey,
      'watchlist_signals',
      symbol,
      { signals, sources, updatedAt: new Date().toISOString() },
      'aggregated',
      ttlSeconds
    );
    
    res.json({ success: true, ttlSeconds, cacheKey });
  } catch (error) {
    console.error('Watchlist signal cache store error:', error);
    res.status(500).json({ error: 'Cache store failed' });
  }
});

/**
 * Batch get cached signals for multiple symbols
 * POST /api/watchlist/signals/batch
 * Body: { symbols: string[] }
 */
app.post('/api/watchlist/signals/batch', express.json(), async (req, res) => {
  const { symbols } = req.body;
  
  if (!symbols || !Array.isArray(symbols)) {
    return res.status(400).json({ error: 'symbols array required' });
  }
  
  try {
    const results = {};
    
    // Fetch all symbols in parallel
    await Promise.all(symbols.map(async (symbol) => {
      const cacheKey = `watchlist:signals:${symbol}`;
      const cached = await stockCache.getCached(cacheKey);
      
      if (cached) {
        results[symbol] = { ...cached.data, fromCache: true, cachedAt: cached.cachedAt };
      } else {
        results[symbol] = { cached: false, symbol };
      }
    }));
    
    res.json({ results, requestedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Watchlist batch cache error:', error);
    res.status(500).json({ error: 'Batch cache lookup failed' });
  }
});

/**
 * Clear cached signals for a symbol
 * DELETE /api/watchlist/signals/:symbol
 */
app.delete('/api/watchlist/signals/:symbol', async (req, res) => {
  const { symbol } = req.params;
  
  try {
    await stockCache.clearSymbolCache(symbol);
    res.json({ success: true, symbol });
  } catch (error) {
    console.error('Watchlist signal cache clear error:', error);
    res.status(500).json({ error: 'Cache clear failed' });
  }
});

// ============================================================================
// Paper Trading / Stock Market Simulation Endpoints
// ============================================================================

/**
 * Get broker profiles configuration
 * GET /api/trading/broker-profiles
 */
app.get('/api/trading/broker-profiles', (req, res) => {
  res.json(trading.BROKER_PROFILES);
});

/**
 * Get product types configuration
 * GET /api/trading/product-types
 */
app.get('/api/trading/product-types', (req, res) => {
  res.json(trading.PRODUCT_TYPES);
});

/**
 * Calculate fees preview (no auth required for preview)
 * POST /api/trading/calculate-fees
 * Body: { productType, side, quantity, price, leverage?, brokerProfile? }
 */
app.post('/api/trading/calculate-fees', express.json(), (req, res) => {
  try {
    const fees = trading.calculateFees(req.body);
    res.json(fees);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * Get user's portfolios
 * GET /api/trading/portfolios
 */
app.get('/api/trading/portfolios', authMiddleware, async (req, res) => {
  try {
    const portfolios = await trading.getUserPortfolios(req.user.id);
    res.json(portfolios);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get portfolios' });
  }
});

/**
 * Get or create default portfolio
 * GET /api/trading/portfolio
 */
app.get('/api/trading/portfolio', authMiddleware, async (req, res) => {
  try {
    const portfolio = await trading.getOrCreatePortfolio(req.user.id);
    res.json(portfolio);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get portfolio' });
  }
});

/**
 * Get specific portfolio by ID
 * GET /api/trading/portfolio/:id
 */
app.get('/api/trading/portfolio/:id', authMiddleware, async (req, res) => {
  try {
    const portfolio = await trading.getPortfolio(parseInt(req.params.id), req.user.id);
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    res.json(portfolio);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get portfolio' });
  }
});

/**
 * Update portfolio settings
 * PUT /api/trading/portfolio/:id/settings
 * Body: { brokerProfile?, maxPositionPercent?, maxLeverage?, ... }
 */
app.put('/api/trading/portfolio/:id/settings', authMiddleware, express.json(), async (req, res) => {
  try {
    const portfolio = await trading.updatePortfolioSettings(
      parseInt(req.params.id), 
      req.user.id, 
      req.body
    );
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    res.json(portfolio);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update portfolio settings' });
  }
});

/**
 * Set initial capital (and reset portfolio)
 * PUT /api/trading/portfolio/:id/capital
 * Body: { initialCapital: number }
 */
app.put('/api/trading/portfolio/:id/capital', authMiddleware, express.json(), async (req, res) => {
  try {
    console.log('Set capital request:', { body: req.body, params: req.params, userId: req.user?.id });
    
    let { initialCapital } = req.body;
    
    // Accept both string and number
    if (typeof initialCapital === 'string') {
      initialCapital = parseFloat(initialCapital);
    }
    
    if (typeof initialCapital !== 'number' || isNaN(initialCapital)) {
      console.log('Invalid capital value:', { initialCapital, type: typeof initialCapital, body: req.body });
      return res.status(400).json({ error: 'initialCapital must be a valid number' });
    }
    
    const portfolio = await trading.setInitialCapital(
      parseInt(req.params.id), 
      req.user.id, 
      initialCapital
    );
    console.log('Capital set successfully:', { portfolioId: portfolio.id, newCapital: initialCapital });
    res.json(portfolio);
  } catch (e) {
    console.error('Set capital error:', e.message);
    res.status(400).json({ error: e.message || 'Failed to set initial capital' });
  }
});

/**
 * Reset portfolio
 * POST /api/trading/portfolio/:id/reset
 */
app.post('/api/trading/portfolio/:id/reset', authMiddleware, async (req, res) => {
  try {
    const portfolio = await trading.resetPortfolio(parseInt(req.params.id), req.user.id);
    res.json(portfolio);
  } catch (e) {
    res.status(500).json({ error: 'Failed to reset portfolio' });
  }
});

/**
 * Get portfolio metrics and performance
 * GET /api/trading/portfolio/:id/metrics
 */
app.get('/api/trading/portfolio/:id/metrics', authMiddleware, async (req, res) => {
  try {
    const metrics = await trading.getPortfolioMetrics(parseInt(req.params.id), req.user.id);
    res.json(metrics);
  } catch (e) {
    console.error('Get metrics error:', e);
    res.status(500).json({ error: 'Failed to get portfolio metrics' });
  }
});

/**
 * Get open positions
 * GET /api/trading/portfolio/:id/positions
 */
app.get('/api/trading/portfolio/:id/positions', authMiddleware, async (req, res) => {
  try {
    const positions = await trading.getOpenPositions(parseInt(req.params.id), req.user.id);
    res.json(positions);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get positions' });
  }
});

/**
 * Get all positions (including closed)
 * GET /api/trading/portfolio/:id/positions/all
 */
app.get('/api/trading/portfolio/:id/positions/all', authMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const positions = await trading.getAllPositions(parseInt(req.params.id), req.user.id, limit);
    res.json(positions);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get positions' });
  }
});

/**
 * Update position current price
 * PUT /api/trading/position/:id/price
 * Body: { currentPrice }
 */
app.put('/api/trading/position/:id/price', authMiddleware, express.json(), async (req, res) => {
  try {
    const { currentPrice } = req.body;
    if (typeof currentPrice !== 'number') {
      return res.status(400).json({ error: 'currentPrice is required' });
    }
    
    const position = await trading.updatePositionPrice(
      parseInt(req.params.id), 
      req.user.id, 
      currentPrice
    );
    
    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }
    res.json(position);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update position price' });
  }
});

/**
 * Close a position
 * POST /api/trading/position/:id/close
 * Body: { currentPrice }
 */
app.post('/api/trading/position/:id/close', authMiddleware, express.json(), async (req, res) => {
  try {
    const { currentPrice } = req.body;
    if (typeof currentPrice !== 'number') {
      return res.status(400).json({ error: 'currentPrice is required' });
    }
    
    const result = await trading.closePosition(
      parseInt(req.params.id), 
      req.user.id, 
      currentPrice
    );
    
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to close position' });
  }
});

/**
 * Execute a market order
 * POST /api/trading/order/market
 * Body: { portfolioId, symbol, side, quantity, currentPrice, productType?, leverage?, stopLoss?, takeProfit?, knockoutLevel? }
 */
app.post('/api/trading/order/market', authMiddleware, express.json(), async (req, res) => {
  try {
    const { portfolioId, symbol, side, quantity, currentPrice, ...options } = req.body;
    
    if (!portfolioId || !symbol || !side || !quantity || !currentPrice) {
      return res.status(400).json({ 
        error: 'Missing required fields: portfolioId, symbol, side, quantity, currentPrice' 
      });
    }
    
    if (!['buy', 'sell', 'short'].includes(side)) {
      return res.status(400).json({ error: 'Invalid side. Must be buy, sell, or short' });
    }
    
    const result = await trading.executeMarketOrder({
      userId: req.user.id,
      portfolioId,
      symbol: symbol.toUpperCase(),
      side,
      quantity,
      currentPrice,
      ...options
    });
    
    res.json(result);
  } catch (e) {
    console.error('Market order error:', e);
    res.status(500).json({ error: 'Failed to execute market order' });
  }
});

/**
 * Get transaction history
 * GET /api/trading/portfolio/:id/transactions
 */
app.get('/api/trading/portfolio/:id/transactions', authMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const transactions = await trading.getTransactionHistory(
      parseInt(req.params.id), 
      req.user.id, 
      limit, 
      offset
    );
    res.json(transactions);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get transactions' });
  }
});

/**
 * Get fee summary
 * GET /api/trading/portfolio/:id/fees
 */
app.get('/api/trading/portfolio/:id/fees', authMiddleware, async (req, res) => {
  try {
    const summary = await trading.getFeeSummary(parseInt(req.params.id), req.user.id);
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get fee summary' });
  }
});

// ============================================================================
// Extended Trading Features: Limit/Stop Orders, Automation, Leaderboard
// ============================================================================

/**
 * Create a pending limit or stop order
 * POST /api/trading/order/pending
 * Body: { portfolioId, symbol, side, quantity, orderType, limitPrice?, stopPrice?, ... }
 */
app.post('/api/trading/order/pending', authMiddleware, express.json(), async (req, res) => {
  try {
    const { portfolioId, symbol, side, quantity, orderType, limitPrice, stopPrice, ...options } = req.body;
    
    if (!portfolioId || !symbol || !side || !quantity || !orderType) {
      return res.status(400).json({ 
        error: 'Missing required fields: portfolioId, symbol, side, quantity, orderType' 
      });
    }
    
    if (!['limit', 'stop', 'stop_limit'].includes(orderType)) {
      return res.status(400).json({ error: 'Invalid orderType. Must be limit, stop, or stop_limit' });
    }
    
    const result = await trading.createPendingOrder({
      userId: req.user.id,
      portfolioId,
      symbol: symbol.toUpperCase(),
      side,
      quantity,
      orderType,
      limitPrice,
      stopPrice,
      ...options
    });
    
    res.json(result);
  } catch (e) {
    console.error('Create pending order error:', e);
    res.status(500).json({ error: 'Failed to create pending order' });
  }
});

/**
 * Cancel a pending order
 * DELETE /api/trading/order/:id
 */
app.delete('/api/trading/order/:id', authMiddleware, async (req, res) => {
  try {
    const result = await trading.cancelOrder(parseInt(req.params.id), req.user.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

/**
 * Get pending orders for portfolio
 * GET /api/trading/portfolio/:id/orders/pending
 */
app.get('/api/trading/portfolio/:id/orders/pending', authMiddleware, async (req, res) => {
  try {
    const orders = await trading.getPendingOrders(parseInt(req.params.id), req.user.id);
    res.json(orders);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get pending orders' });
  }
});

/**
 * Update position stop-loss and take-profit levels
 * PUT /api/trading/position/:id/levels
 * Body: { stopLoss?, takeProfit? }
 */
app.put('/api/trading/position/:id/levels', authMiddleware, express.json(), async (req, res) => {
  try {
    const { stopLoss, takeProfit } = req.body;
    
    const position = await trading.updatePositionLevels(
      parseInt(req.params.id),
      req.user.id,
      { stopLoss, takeProfit }
    );
    
    res.json(position);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update position levels' });
  }
});

/**
 * Check pending orders and position triggers with price updates
 * POST /api/trading/check-triggers
 * Body: { prices: { symbol: price, ... } }
 * This endpoint processes all automated triggers
 */
app.post('/api/trading/check-triggers', authMiddleware, express.json(), async (req, res) => {
  try {
    const { prices } = req.body;
    
    if (!prices || typeof prices !== 'object') {
      return res.status(400).json({ error: 'prices object required' });
    }
    
    const [executedOrders, triggeredPositions] = await Promise.all([
      trading.checkPendingOrders(prices),
      trading.checkPositionTriggers(prices),
    ]);
    
    res.json({
      executedOrders,
      triggeredPositions,
    });
  } catch (e) {
    console.error('Check triggers error:', e);
    res.status(500).json({ error: 'Failed to check triggers' });
  }
});

/**
 * Get equity curve data
 * GET /api/trading/portfolio/:id/equity-curve
 */
app.get('/api/trading/portfolio/:id/equity-curve', authMiddleware, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const portfolioId = parseInt(req.params.id);
    
    // Try with user's ID first, then without (for AI trader portfolios)
    let data;
    try {
      data = await trading.getEquityCurve(portfolioId, req.user.id, days);
    } catch (e) {
      // Fallback: AI trader portfolios have user_id=NULL
      data = await trading.getEquityCurve(portfolioId, null, days);
    }
    
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get equity curve' });
  }
});

/**
 * Get global leaderboard
 * GET /api/trading/leaderboard
 */
app.get('/api/trading/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const timeframe = req.query.timeframe || 'all'; // all, day, week, month
    const filter = req.query.filter || 'all'; // all, humans, ai
    const leaderboard = await trading.getLeaderboard(limit, timeframe, filter);
    res.json(leaderboard);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

/**
 * Get user's rank in leaderboard
 * GET /api/trading/leaderboard/rank
 */
app.get('/api/trading/leaderboard/rank', authMiddleware, async (req, res) => {
  try {
    const rank = await trading.getUserRank(req.user.id);
    res.json(rank || { rank: null, message: 'No trading history yet' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get user rank' });
  }
});

// ============================================================================
// Historical Prices Endpoints (for Backtesting)
// ============================================================================

// Note: historicalPricesService is already imported above for Yahoo Chart caching
const historicalPrices = historicalPricesService;

/**
 * Get all symbols with historical data in database
 * GET /api/historical-prices/symbols/available
 * NOTE: This route MUST be defined BEFORE the :symbol route to avoid "symbols" being parsed as a symbol
 */
app.get('/api/historical-prices/symbols/available', async (req, res) => {
  try {
    const symbols = await historicalPrices.getAvailableSymbols();
    res.json({ symbols });
  } catch (e) {
    console.error('Get available symbols error:', e);
    res.status(500).json({ error: e.message || 'Failed to get available symbols' });
  }
});

/**
 * Check if historical data is available
 * GET /api/historical-prices/:symbol/availability
 */
app.get('/api/historical-prices/:symbol/availability', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    
    const availability = await historicalPrices.checkHistoricalDataAvailability(symbol, startDate, endDate);
    res.json({
      symbol: symbol.toUpperCase(),
      ...availability
    });
  } catch (e) {
    console.error('Check availability error:', e);
    res.status(500).json({ error: e.message || 'Failed to check data availability' });
  }
});

/**
 * Force refresh historical data for a symbol
 * POST /api/historical-prices/:symbol/refresh
 */
app.post('/api/historical-prices/:symbol/refresh', authMiddleware, async (req, res) => {
  try {
    const { symbol } = req.params;
    const { startDate, endDate } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required in body' });
    }
    
    const result = await historicalPrices.fetchAndStoreHistoricalData(symbol, startDate, endDate);
    
    if (result.success) {
      res.json({
        success: true,
        symbol: symbol.toUpperCase(),
        recordsInserted: result.recordsInserted
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (e) {
    console.error('Refresh historical data error:', e);
    res.status(500).json({ error: e.message || 'Failed to refresh historical data' });
  }
});

/**
 * Get historical prices for a symbol and date range
 * GET /api/historical-prices/:symbol
 * Query params: startDate, endDate (YYYY-MM-DD format)
 * NOTE: This route MUST be defined AFTER the more specific routes above
 */
app.get('/api/historical-prices/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    
    // Normalize dates to YYYY-MM-DD format (strip any time component)
    const normalizedStartDate = startDate.split('T')[0];
    const normalizedEndDate = endDate.split('T')[0];
    
    // Check if data exists in database
    const availability = await historicalPrices.checkHistoricalDataAvailability(symbol, normalizedStartDate, normalizedEndDate);
    
    if (!availability.hasData) {
      // Fetch from Yahoo Finance and store in database
      console.log(`[API] Fetching historical data for ${symbol} (${normalizedStartDate} to ${normalizedEndDate})`);
      const fetchResult = await historicalPrices.fetchAndStoreHistoricalData(symbol, normalizedStartDate, normalizedEndDate);
      
      if (!fetchResult.success) {
        return res.status(404).json({ 
          error: 'Could not fetch historical data',
          details: fetchResult.error,
          symbol,
          startDate: normalizedStartDate,
          endDate: normalizedEndDate
        });
      }
    }
    
    // Get data from database
    const prices = await historicalPrices.getHistoricalPrices(symbol, normalizedStartDate, normalizedEndDate);
    
    res.json({
      symbol: symbol.toUpperCase(),
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
      recordCount: prices.length,
      prices
    });
  } catch (e) {
    console.error('Get historical prices error:', e);
    res.status(500).json({ error: e.message || 'Failed to get historical prices' });
  }
});

// ============================================================================
// Backtesting Endpoints
// ============================================================================

/**
 * Create a new backtest session
 * POST /api/trading/backtest/session
 */
app.post('/api/trading/backtest/session', authMiddleware, async (req, res) => {
  try {
    const { name, startDate, endDate, initialCapital, brokerProfile, symbols } = req.body;
    
    if (!name || !startDate || !endDate) {
      return res.status(400).json({ error: 'Name, startDate, and endDate are required' });
    }
    
    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    const now = new Date();
    
    if (start >= end) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }
    
    if (end > now) {
      return res.status(400).json({ error: 'End date cannot be in the future' });
    }
    
    const session = await trading.createBacktestSession({
      userId: req.user.id,
      name,
      startDate,
      endDate,
      initialCapital: initialCapital || 100000,
      brokerProfile: brokerProfile || 'standard',
      symbols: symbols || [],
    });
    
    res.status(201).json(session);
  } catch (e) {
    console.error('Create backtest session error:', e);
    res.status(500).json({ error: e.message || 'Failed to create backtest session' });
  }
});

/**
 * Get user's backtest sessions
 * GET /api/trading/backtest/sessions
 */
app.get('/api/trading/backtest/sessions', authMiddleware, async (req, res) => {
  try {
    const sessions = await trading.getUserBacktestSessions(req.user.id);
    res.json(sessions);
  } catch (e) {
    console.error('Get backtest sessions error:', e);
    res.status(500).json({ error: e.message || 'Failed to get backtest sessions' });
  }
});

/**
 * Get specific backtest session
 * GET /api/trading/backtest/session/:id
 */
app.get('/api/trading/backtest/session/:id', authMiddleware, async (req, res) => {
  try {
    const session = await trading.getBacktestSession(parseInt(req.params.id), req.user.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get backtest session' });
  }
});

/**
 * Execute order in backtest
 * POST /api/trading/backtest/order
 */
app.post('/api/trading/backtest/order', authMiddleware, async (req, res) => {
  try {
    const { sessionId, symbol, side, quantity, price, productType, leverage, stopLoss, takeProfit } = req.body;
    
    if (!sessionId || !symbol || !side || !quantity || !price) {
      return res.status(400).json({ error: 'sessionId, symbol, side, quantity, and price are required' });
    }
    
    const result = await trading.executeBacktestOrder({
      sessionId,
      userId: req.user.id,
      symbol,
      side,
      quantity,
      price,
      productType: productType || 'stock',
      leverage: leverage || 1,
      stopLoss,
      takeProfit,
    });
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json(result);
  } catch (e) {
    console.error('Execute backtest order error:', e);
    res.status(500).json({ error: 'Failed to execute backtest order' });
  }
});

/**
 * Close backtest position
 * POST /api/trading/backtest/position/:id/close
 */
app.post('/api/trading/backtest/position/:id/close', authMiddleware, async (req, res) => {
  try {
    const { price } = req.body;
    
    if (!price) {
      return res.status(400).json({ error: 'Close price is required' });
    }
    
    const result = await trading.closeBacktestPosition(
      parseInt(req.params.id),
      req.user.id,
      price
    );
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to close backtest position' });
  }
});

/**
 * Advance backtest time
 * POST /api/trading/backtest/session/:id/advance
 */
app.post('/api/trading/backtest/session/:id/advance', authMiddleware, async (req, res) => {
  try {
    const { newDate, priceUpdates } = req.body;
    
    if (!newDate) {
      return res.status(400).json({ error: 'New date is required' });
    }
    
    const result = await trading.advanceBacktestTime(
      parseInt(req.params.id),
      req.user.id,
      newDate,
      priceUpdates || {}
    );
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to advance backtest time' });
  }
});

/**
 * Get backtest results
 * GET /api/trading/backtest/session/:id/results
 */
app.get('/api/trading/backtest/session/:id/results', authMiddleware, async (req, res) => {
  try {
    const results = await trading.getBacktestResults(
      parseInt(req.params.id),
      req.user.id
    );
    
    if (!results) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get backtest results' });
  }
});

/**
 * Delete backtest session
 * DELETE /api/trading/backtest/session/:id
 */
app.delete('/api/trading/backtest/session/:id', authMiddleware, async (req, res) => {
  try {
    const result = await trading.deleteBacktestSession(
      parseInt(req.params.id),
      req.user.id
    );
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete backtest session' });
  }
});

// ============================================================================
// AI Trader Endpoints
// ============================================================================

/**
 * Get all AI traders
 * GET /api/ai-traders
 */
app.get('/api/ai-traders', async (req, res) => {
  try {
    const traders = await aiTrader.getAllAITraders();
    res.json(traders.map(t => aiTrader.formatTraderForApi(t)));
  } catch (e) {
    console.error('Get AI traders error:', e);
    res.status(500).json({ error: 'Failed to fetch AI traders' });
  }
});

/**
 * Get adaptive learning status (MUST be before /:id route)
 * GET /api/ai-traders/learning-status
 */
app.get('/api/ai-traders/learning-status', async (req, res) => {
  try {
    const aiTraderLearningModule = await import('./aiTraderLearning.js');
    const traders = await aiTraderLearningModule.getTradersWithLearningEnabled();
    
    res.json({
      outsideTradingHours: backgroundJobs.isOutsideTradingHours(),
      tradersWithLearningEnabled: traders.length,
      traders: traders.map(t => ({
        id: t.id,
        name: t.name,
        learningConfig: t.personality?.learning
      }))
    });
  } catch (e) {
    console.error('Get learning status error:', e);
    res.status(500).json({ error: e.message || 'Failed to get learning status' });
  }
});

/**
 * Trigger adaptive learning for ALL traders (MUST be before /:id route)
 * POST /api/ai-traders/trigger-learning-all
 */
app.post('/api/ai-traders/trigger-learning-all', authMiddleware, async (req, res) => {
  try {
    const force = req.body.force === true;
    console.log(`[API] Manual adaptive learning trigger for all traders (force: ${force})`);
    
    const result = await backgroundJobs.adjustAdaptiveWeights(force);
    
    res.json({
      success: true,
      outsideTradingHours: backgroundJobs.isOutsideTradingHours(),
      ...result
    });
  } catch (e) {
    console.error('Trigger learning all error:', e);
    res.status(500).json({ error: e.message || 'Failed to trigger adaptive learning' });
  }
});

/**
 * Get training status for an AI trader (MUST be before /:id route)
 * GET /api/ai-traders/:id/training-status
 */
app.get('/api/ai-traders/:id/training-status', async (req, res) => {
  try {
    const traderId = parseInt(req.params.id);
    const trader = await aiTrader.getAITrader(traderId);
    
    if (!trader) {
      return res.status(404).json({ error: 'AI trader not found' });
    }
    
    const personality = trader.personality || {};
    const rlAgentName = personality.rlAgentName || null;
    
    // Fetch RL agent status from RL service
    let rlAgentStatus = {
      status: 'not_configured',
      isTrained: false,
      lastTrained: null,
      trainingProgress: 0,
      totalEpisodes: 0,
      bestReward: null,
      performanceMetrics: null
    };
    
    if (rlAgentName) {
      try {
        const rlServiceUrl = process.env.RL_SERVICE_URL || 'http://rl-trading-service:8001';
        const rlResponse = await fetch(`${rlServiceUrl}/agents/${encodeURIComponent(rlAgentName)}`);
        
        if (rlResponse.ok) {
          const rlData = await rlResponse.json();
          rlAgentStatus = {
            status: rlData.status || 'not_trained',
            isTrained: rlData.is_trained || false,
            lastTrained: rlData.last_trained || null,
            trainingProgress: rlData.training_progress || 0,
            totalEpisodes: rlData.total_episodes || 0,
            bestReward: rlData.best_reward || null,
            performanceMetrics: rlData.performance_metrics ? {
              meanReward: rlData.performance_metrics.mean_reward,
              meanReturnPct: rlData.performance_metrics.mean_return_pct,
              maxReturnPct: rlData.performance_metrics.max_return_pct,
              minReturnPct: rlData.performance_metrics.min_return_pct
            } : null
          };
        }
      } catch (rlError) {
        console.warn('Failed to fetch RL agent status:', rlError.message);
      }
    }
    
    // Get self-training config
    const rlConfig = personality.rl || {};
    const selfTraining = {
      enabled: rlConfig.selfTrainingEnabled ?? true,
      intervalMinutes: rlConfig.selfTrainingIntervalMinutes || 60,
      timesteps: rlConfig.selfTrainingTimesteps || 10000,
      lastTrainingAt: null // Would need to track this in DB
    };
    
    // Get ML config
    const mlConfig = personality.ml || {};
    const mlModel = {
      autoTrain: mlConfig.autoTrain ?? true,
      trainedSymbols: [] // Would need to query ML service for this
    };
    
    // Get learning mode config
    const learningConfig = personality.learning || {};
    const learningMode = {
      enabled: learningConfig.enabled ?? false,
      updateWeights: learningConfig.updateWeights ?? false,
      minSamples: learningConfig.minSamples || 5
    };
    
    res.json({
      traderId,
      traderName: trader.name,
      rlAgentName,
      rlAgent: rlAgentStatus,
      selfTraining,
      mlModel,
      learningMode
    });
  } catch (e) {
    console.error('Get training status error:', e);
    res.status(500).json({ error: e.message || 'Failed to get training status' });
  }
});

/**
 * Get AI trader by ID
 * GET /api/ai-traders/:id
 */
app.get('/api/ai-traders/:id', async (req, res) => {
  try {
    const trader = await aiTrader.getAITrader(parseInt(req.params.id));
    if (!trader) {
      return res.status(404).json({ error: 'AI trader not found' });
    }
    res.json(aiTrader.formatTraderForApi(trader));
  } catch (e) {
    console.error('Get AI trader error:', e);
    res.status(500).json({ error: 'Failed to fetch AI trader' });
  }
});

/**
 * Create new AI trader
 * POST /api/ai-traders
 */
app.post('/api/ai-traders', authMiddleware, async (req, res) => {
  try {
    const { name, description, personality, initialCapital } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    // Create AI trader
    const trader = await aiTrader.createAITrader(
      name,
      description,
      personality || aiTrader.DEFAULT_PERSONALITY
    );
    
    // Create portfolio for the AI trader
    const brokerProfileCreate = personality?.capital?.brokerProfile || 'flatex';
    if (initialCapital) {
      await aiTrader.createAITraderPortfolio(trader.id, initialCapital, brokerProfileCreate);
    }
    
    // Re-fetch to get complete data including portfolio_id
    const completeTrader = await aiTrader.getAITrader(trader.id);
    res.json(aiTrader.formatTraderForApi(completeTrader));
  } catch (e) {
    console.error('Create AI trader error:', e);
    if (e.message.includes('duplicate key')) {
      res.status(400).json({ error: 'AI trader with this name already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create AI trader' });
    }
  }
});

/**
 * Update AI trader
 * PUT /api/ai-traders/:id
 */
app.put('/api/ai-traders/:id', authMiddleware, async (req, res) => {
  try {
    const traderId = parseInt(req.params.id);
    const { brokerProfile, ...traderUpdates } = req.body;
    
    // Update AI trader fields (name, personality, etc.) if any provided
    let trader;
    if (Object.keys(traderUpdates).length > 0) {
      trader = await aiTrader.updateAITrader(traderId, traderUpdates);
    } else {
      // Only brokerProfile change — just fetch current trader
      const existingResult = await aiTrader.getAITrader(traderId);
      trader = existingResult;
    }
    
    // If brokerProfile is being changed, update portfolio DB column AND personality
    if (brokerProfile) {
      const portfolio = await aiTrader.getAITraderPortfolio(traderId);
      if (portfolio) {
        await trading.updatePortfolioSettings(portfolio.id, portfolio.user_id || null, {
          brokerProfile
        });
      }
      // Sync personality.capital.brokerProfile
      const currentTrader = trader || await aiTrader.getAITrader(traderId);
      if (currentTrader) {
        const updatedPersonality = JSON.parse(JSON.stringify(currentTrader.personality || {}));
        if (!updatedPersonality.capital) updatedPersonality.capital = {};
        updatedPersonality.capital.brokerProfile = brokerProfile;
        trader = await aiTrader.updateAITrader(traderId, { personality: updatedPersonality });
      }
    }
    
    res.json(aiTrader.formatTraderForApi(trader));
  } catch (e) {
    console.error('Update AI trader error:', e);
    res.status(500).json({ error: 'Failed to update AI trader' });
  }
});

/**
 * Delete AI trader
 * DELETE /api/ai-traders/:id
 */
app.delete('/api/ai-traders/:id', authMiddleware, async (req, res) => {
  try {
    const success = await aiTrader.deleteAITrader(parseInt(req.params.id));
    if (!success) {
      return res.status(404).json({ error: 'AI trader not found' });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Delete AI trader error:', e);
    res.status(500).json({ error: 'Failed to delete AI trader' });
  }
});

/**
 * Start AI trader
 * POST /api/ai-traders/:id/start
 */
app.post('/api/ai-traders/:id/start', authMiddleware, async (req, res) => {
  try {
    const traderId = parseInt(req.params.id);
    
    // Get trader details first
    const traderBefore = await aiTrader.getAITrader(traderId);
    if (!traderBefore) {
      return res.status(404).json({ error: 'AI trader not found' });
    }
    
    // Update status in database
    const trader = await aiTrader.startAITrader(traderId);
    
    // Build config from trader.personality (nested structure)
    const p = trader.personality || {};
    const config = {
      name: trader.name,
      // Capital
      initial_budget: p.capital?.initialBudget || 100000,
      max_position_size: (p.capital?.maxPositionSize || 25) / 100, // Convert percent to decimal
      reserve_cash: (p.capital?.reserveCashPercent || 10) / 100,
      // Symbols from watchlist
      symbols: p.watchlist?.symbols || ['AAPL', 'MSFT', 'GOOGL'],
      // RL agent
      rl_agent_name: p.rlAgentName || null,
      // Trading settings
      min_confidence: p.trading?.minConfidence || 0.6,
      max_positions: p.trading?.maxOpenPositions || 5,
      // Signal agreement settings
      require_multiple_confirmation: p.signals?.requireMultipleConfirmation ?? false,
      min_signal_agreement: p.signals?.minSignalAgreement || 'weak',
      // Risk settings
      risk_tolerance: p.risk?.tolerance || 'moderate',
      max_drawdown: (p.risk?.maxDrawdown || 15) / 100,
      stop_loss_percent: (p.risk?.stopLossPercent || 5) / 100,
      take_profit_percent: (p.risk?.takeProfitPercent || 10) / 100,
      sl_tp_mode: p.risk?.slTpMode || 'dynamic',
      atr_period: p.risk?.atrPeriod || 14,
      atr_sl_multiplier: p.risk?.atrSlMultiplier || 1.5,
      min_risk_reward: p.risk?.minRiskReward || 2.0,
      // Signal weights
      ml_weight: p.signals?.weights?.ml || 0.25,
      rl_weight: p.signals?.weights?.rl || 0.25,
      sentiment_weight: p.signals?.weights?.sentiment || 0.25,
      technical_weight: p.signals?.weights?.technical || 0.25,
      // Schedule settings
      // schedule_enabled = enabled AND tradingHoursOnly (both must be true for schedule to apply)
      schedule_enabled: (p.schedule?.enabled ?? true) && (p.schedule?.tradingHoursOnly ?? true),
      check_interval_seconds: p.schedule?.checkIntervalSeconds || 60,
      trading_start: p.schedule?.tradingStart || '09:00',
      trading_end: p.schedule?.tradingEnd || '17:30',
      timezone: p.schedule?.timezone || 'Europe/Berlin',
      trading_days: p.schedule?.tradingDays || ['mon', 'tue', 'wed', 'thu', 'fri'],
      avoid_market_open: p.schedule?.avoidMarketOpenMinutes || 15,
      avoid_market_close: p.schedule?.avoidMarketCloseMinutes || 15,
      // ML Auto-Training
      auto_train_ml: p.ml?.autoTrain ?? true,
      // RL Self-Training
      self_training_enabled: p.rl?.selfTrainingEnabled ?? true,
      self_training_interval_minutes: p.rl?.selfTrainingIntervalMinutes || 60,
      self_training_timesteps: p.rl?.selfTrainingTimesteps || 10000,
      // Short Selling
      allow_short_selling: p.risk?.allowShortSelling ?? false,
      max_short_positions: p.risk?.maxShortPositions || 3,
      max_short_exposure: p.risk?.maxShortExposure || 0.30,
      // Trading Horizon (affects decision sensitivity)
      trading_horizon: p.trading?.horizon || 'day',
      target_holding_hours: p.trading?.targetHoldingHours || 8,
      max_holding_hours: p.trading?.maxHoldingHours || 24,
    };
    
    // Log the config being sent (for debugging)
    console.log(`[AI-Trader Start] Sending config for trader ${traderId}:`, JSON.stringify({
      rl_agent_name: config.rl_agent_name,
      symbols: config.symbols,
      schedule_enabled: config.schedule_enabled
    }));
    
    // Call RL Trading Service to start the trading loop
    try {
      const rlResponse = await fetch(`${RL_SERVICE_URL}/ai-trader/start/${traderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      
      if (!rlResponse.ok) {
        const errorText = await rlResponse.text();
        console.error(`RL service start failed: ${rlResponse.status} ${errorText}`);
        // Don't fail the request - DB status was updated, user can retry
      } else {
        console.log(`AI Trader ${traderId} started in RL service`);
      }
    } catch (rlError) {
      console.error('Error calling RL service:', rlError);
      // Don't fail the request - DB status was updated, user can retry
    }
    
    // Emit SSE event for status change
    emitStatusChanged(traderId, trader.name, traderBefore.status, trader.status, 'AI Trader started');
    
    res.json(aiTrader.formatTraderForApi(trader));
  } catch (e) {
    console.error('Start AI trader error:', e);
    res.status(500).json({ error: 'Failed to start AI trader' });
  }
});

/**
 * Stop AI trader
 * POST /api/ai-traders/:id/stop
 */
app.post('/api/ai-traders/:id/stop', authMiddleware, async (req, res) => {
  try {
    const traderId = parseInt(req.params.id);
    
    // Get trader details first
    const traderBefore = await aiTrader.getAITrader(traderId);
    if (!traderBefore) {
      return res.status(404).json({ error: 'AI trader not found' });
    }
    
    // Update status in database
    const trader = await aiTrader.stopAITrader(traderId);
    
    // Call RL Trading Service to stop the trading loop
    try {
      const rlResponse = await fetch(`${RL_SERVICE_URL}/ai-trader/stop/${traderId}`, {
        method: 'POST'
      });
      
      if (!rlResponse.ok) {
        const errorText = await rlResponse.text();
        console.error(`RL service stop failed: ${rlResponse.status} ${errorText}`);
        // Don't fail the request - DB status was updated, user can retry
      } else {
        console.log(`AI Trader ${traderId} stopped in RL service`);
      }
    } catch (rlError) {
      console.error('Error calling RL service:', rlError);
      // Don't fail the request - DB status was updated, user can retry
    }
    
    // Emit SSE event for status change
    emitStatusChanged(traderId, trader.name, traderBefore.status, trader.status, 'AI Trader stopped');
    
    res.json(aiTrader.formatTraderForApi(trader));
  } catch (e) {
    console.error('Stop AI trader error:', e);
    res.status(500).json({ error: 'Failed to stop AI trader' });
  }
});

/**
 * Pause AI trader
 * POST /api/ai-traders/:id/pause
 */
app.post('/api/ai-traders/:id/pause', authMiddleware, async (req, res) => {
  try {
    const traderId = parseInt(req.params.id);
    
    // Get trader details first
    const traderBefore = await aiTrader.getAITrader(traderId);
    if (!traderBefore) {
      return res.status(404).json({ error: 'AI trader not found' });
    }
    
    // Update status in database
    const trader = await aiTrader.pauseAITrader(traderId);
    
    // Call RL Trading Service to stop the trading loop (pause is same as stop in RL service)
    try {
      const rlResponse = await fetch(`${RL_SERVICE_URL}/ai-trader/stop/${traderId}`, {
        method: 'POST'
      });
      
      if (!rlResponse.ok) {
        const errorText = await rlResponse.text();
        console.error(`RL service stop failed: ${rlResponse.status} ${errorText}`);
        // Don't fail the request - DB status was updated, user can retry
      } else {
        console.log(`AI Trader ${traderId} paused in RL service`);
      }
    } catch (rlError) {
      console.error('Error calling RL service:', rlError);
      // Don't fail the request - DB status was updated, user can retry
    }
    
    // Emit SSE event for status change
    emitStatusChanged(traderId, trader.name, traderBefore.status, trader.status, 'AI Trader paused');
    
    res.json(aiTrader.formatTraderForApi(trader));
  } catch (e) {
    console.error('Pause AI trader error:', e);
    res.status(500).json({ error: 'Failed to pause AI trader' });
  }
});

/**
 * Get AI trader decisions
 * GET /api/ai-traders/:id/decisions
 */
app.get('/api/ai-traders/:id/decisions', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const decisions = await aiTrader.getDecisions(
      parseInt(req.params.id),
      parseInt(limit),
      parseInt(offset)
    );
    res.json(decisions);
  } catch (e) {
    console.error('Get decisions error:', e);
    res.status(500).json({ error: 'Failed to fetch decisions' });
  }
});

/**
 * Record AI trader decision (from RL service)
 * POST /api/ai-traders/:id/decisions
 */
app.post('/api/ai-traders/:id/decisions', async (req, res) => {
  try {
    const traderId = parseInt(req.params.id);
    const {
      symbol,
      decision_type,
      confidence,
      weighted_score,
      ml_score,
      rl_score,
      sentiment_score,
      technical_score,
      signal_agreement,
      reasoning,
      summary,
      quantity,
      price,
      stop_loss,
      take_profit,
      risk_checks_passed,
      risk_warnings,
      risk_blockers,
      timestamp
    } = req.body;
    
    const decision = await aiTrader.logDecision(traderId, {
      symbol,
      decisionType: decision_type,
      reasoning: {
        ...reasoning,
        quantity,
        price,
        stop_loss,
        take_profit,
        risk_checks_passed,
        risk_warnings,
        risk_blockers
      },
      confidence,
      weightedScore: weighted_score,
      mlScore: ml_score,
      rlScore: rl_score,
      sentimentScore: sentiment_score,
      technicalScore: technical_score,
      signalAgreement: signal_agreement,
      summaryShort: summary
    });
    
    // Emit SSE event for real-time UI updates
    const trader = await aiTrader.getAITrader(traderId);
    const traderName = trader?.name || `Trader #${traderId}`;
    emitDecisionMade(traderId, traderName, {
      symbol,
      decisionType: decision_type,
      confidence,
      weightedScore: weighted_score,
      mlScore: ml_score,
      rlScore: rl_score,
      sentimentScore: sentiment_score,
      technicalScore: technical_score,
      summary: summary || `${decision_type.toUpperCase()} ${symbol}`,
    });
    
    res.status(201).json(decision);
  } catch (e) {
    console.error('Record decision error:', e);
    res.status(500).json({ error: 'Failed to record decision' });
  }
});

/**
 * Get specific AI trader decision
 * GET /api/ai-traders/:id/decisions/:did
 */
app.get('/api/ai-traders/:id/decisions/:did', async (req, res) => {
  try {
    const decision = await aiTrader.getDecision(parseInt(req.params.did));
    if (!decision || decision.ai_trader_id !== parseInt(req.params.id)) {
      return res.status(404).json({ error: 'Decision not found' });
    }
    res.json(decision);
  } catch (e) {
    console.error('Get decision error:', e);
    res.status(500).json({ error: 'Failed to fetch decision' });
  }
});

/**
 * Delete AI trader decision
 * DELETE /api/ai-traders/:id/decisions/:did
 */
app.delete('/api/ai-traders/:id/decisions/:did', async (req, res) => {
  try {
    const traderId = parseInt(req.params.id);
    const decisionId = parseInt(req.params.did);
    
    // Verify the decision belongs to this trader
    const decision = await aiTrader.getDecision(decisionId);
    if (!decision || decision.ai_trader_id !== traderId) {
      return res.status(404).json({ error: 'Decision not found' });
    }
    
    // Delete the decision
    await db.query('DELETE FROM ai_trader_decisions WHERE id = $1', [decisionId]);
    
    console.log(`[AI Trader] Deleted decision ${decisionId} for trader ${traderId}`);
    res.json({ success: true, message: 'Decision deleted' });
  } catch (e) {
    console.error('Delete decision error:', e);
    res.status(500).json({ error: 'Failed to delete decision' });
  }
});

/**
 * Force recalculate stats for all AI traders
 * POST /api/ai-traders/recalculate-stats
 */
app.post('/api/ai-traders/recalculate-stats', async (req, res) => {
  try {
    // First update any pending outcomes
    const outcomesUpdated = await aiTrader.updatePendingOutcomes();
    
    // Then recalculate stats for ALL traders
    const traders = await aiTrader.getAllAITraders();
    for (const trader of traders) {
      await aiTrader.updateTraderStats(trader.id);
    }
    
    res.json({ success: true, tradersUpdated: traders.length, outcomesUpdated });
  } catch (e) {
    console.error('Recalculate stats error:', e);
    res.status(500).json({ error: 'Failed to recalculate stats' });
  }
});

/**
 * Mark AI trader decision as executed
 * PATCH /api/ai-traders/:id/decisions/mark-executed
 */
app.patch('/api/ai-traders/:id/decisions/mark-executed', async (req, res) => {
  try {
    const traderId = parseInt(req.params.id);
    const { symbol, decision_type, timestamp } = req.body;
    
    // Find the most recent decision matching the criteria
    const result = await db.query(
      `UPDATE ai_trader_decisions 
       SET executed = true, 
           updated_at = NOW()
       WHERE id = (
         SELECT id FROM ai_trader_decisions 
         WHERE ai_trader_id = $1 
           AND symbol = $2 
           AND decision_type = $3
         ORDER BY timestamp DESC 
         LIMIT 1
       )
       RETURNING id`,
      [traderId, symbol, decision_type]
    );
    
    if (result.rows.length === 0) {
      console.log(`[AI Trader] No matching decision found to mark as executed: ${traderId}/${symbol}/${decision_type}`);
      return res.status(404).json({ error: 'Decision not found' });
    }
    
    // Update trader statistics
    await aiTrader.updateTraderStats(traderId);
    
    console.log(`[AI Trader] Marked decision ${result.rows[0].id} as executed for trader ${traderId}`);
    res.status(204).send();
  } catch (e) {
    console.error('Mark decision executed error:', e);
    res.status(500).json({ error: 'Failed to mark decision as executed' });
  }
});

/**
 * Get AI trader portfolio summary with live prices
 * GET /api/ai-traders/:id/portfolio
 */
app.get('/api/ai-traders/:id/portfolio', async (req, res) => {
  try {
    const traderId = parseInt(req.params.id);
    const portfolio = await aiTrader.getAITraderPortfolio(traderId);
    
    if (!portfolio) {
      // Create portfolio if it doesn't exist
      const trader = await aiTrader.getAITrader(traderId);
      if (!trader) {
        return res.status(404).json({ error: 'AI trader not found' });
      }
      
      const initialCapital = trader.personality?.capital?.initialBudget || 100000;
      const brokerProfileReset = trader.personality?.capital?.brokerProfile || 'flatex';
      const newPortfolio = await aiTrader.createAITraderPortfolio(traderId, initialCapital, brokerProfileReset);
      
      return res.json({
        cash: newPortfolio.cash_balance,
        total_value: newPortfolio.cash_balance,
        total_invested: 0,
        positions_count: 0,
        positions: {},
        daily_pnl: 0,
        daily_pnl_pct: 0,
        max_value: newPortfolio.cash_balance,
        unrealized_pnl: 0
      });
    }
    
    // Get positions
    const positions = await trading.getOpenPositionsByPortfolio(portfolio.id);
    
    // Fetch live prices for all symbols
    const symbols = [...new Set(positions.map(p => p.symbol))];
    const liveQuotes = {};
    
    for (const symbol of symbols) {
      try {
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
        const response = await fetch(yahooUrl);
        if (response.ok) {
          const data = await response.json();
          const quote = data?.chart?.result?.[0];
          if (quote) {
            const meta = quote.meta || {};
            const closes = quote.indicators?.quote?.[0]?.close || [];
            const currentPrice = meta.regularMarketPrice || closes[closes.length - 1] || null;
            const previousClose = meta.chartPreviousClose || meta.previousClose || null;
            if (currentPrice) {
              liveQuotes[symbol] = { currentPrice, previousClose };
            }
          }
        }
      } catch (e) {
        console.warn(`Failed to fetch live quote for ${symbol}:`, e.message);
      }
    }
    
    // Calculate totals with live prices
    let totalInvested = 0;  // Entry value
    let totalCurrentValue = 0;  // Current market value
    let totalUnrealizedPnl = 0;
    let dailyPnl = 0;
    const positionsMap = {};
    
    for (const pos of positions) {
      const live = liveQuotes[pos.symbol];
      const currentPrice = live?.currentPrice || pos.currentPrice || pos.entryPrice || 0;
      const entryPrice = pos.entryPrice || 0;
      const quantity = pos.quantity || 0;
      const side = pos.side || 'long';
      const openFee = parseFloat(pos.openFee || pos.open_fee || 0);
      
      const entryValue = entryPrice * quantity;
      const currentValue = currentPrice * quantity;
      
      // === REALISM: Calculate unrealized P&L NET of fees ===
      // Include already-paid open fee + estimated close fee
      let grossUnrealizedPnl;
      if (side === 'short') {
        grossUnrealizedPnl = (entryPrice - currentPrice) * quantity;
      } else {
        grossUnrealizedPnl = (currentPrice - entryPrice) * quantity;
      }
      
      // Estimate close fee (same broker, sell side)
      const brokerKey = portfolio.broker_profile || 'flatex';
      const estCloseFees = trading.calculateFees({
        productType: pos.productType || pos.product_type || 'stock',
        side: 'sell',
        quantity,
        price: currentPrice,
        brokerProfile: brokerKey,
      });
      const estimatedCloseFee = estCloseFees.totalFees;
      
      // Net unrealized P&L = gross - open fee - estimated close fee
      const unrealizedPnl = grossUnrealizedPnl - openFee - estimatedCloseFee;
      
      // Calculate daily P&L
      if (live?.previousClose) {
        if (side === 'short') {
          dailyPnl += (live.previousClose - currentPrice) * quantity;
        } else {
          dailyPnl += (currentPrice - live.previousClose) * quantity;
        }
      }
      
      totalInvested += entryValue;
      totalCurrentValue += currentValue;
      totalUnrealizedPnl += unrealizedPnl;
      
      positionsMap[pos.symbol] = {
        quantity: quantity,
        side: side,
        avg_price: entryPrice,
        current_price: currentPrice,
        unrealized_pnl: unrealizedPnl,
        unrealized_pnl_pct: entryPrice > 0 ? (unrealizedPnl / entryValue) * 100 : 0,
        entry_value: entryValue,
        current_value: currentValue,
        stop_loss: pos.stopLoss || null,
        take_profit: pos.takeProfit || null,
        opened_at: pos.openedAt || null,
        open_fee: openFee,
        estimated_close_fee: estimatedCloseFee,
      };
    }
    
    const cashBalance = parseFloat(portfolio.cash_balance);
    const totalValue = cashBalance + totalCurrentValue;
    const initialCapital = parseFloat(portfolio.initial_capital) || 100000;
    const totalPnl = totalValue - initialCapital;
    const totalPnlPct = initialCapital > 0 ? (totalPnl / initialCapital) * 100 : 0;
    const dailyPnlPct = totalCurrentValue > 0 ? (dailyPnl / totalCurrentValue) * 100 : 0;
    
    // Calculate trade stats from closed positions (more reliable than decisions)
    const closedPositionsResult = await db.query(
      `SELECT 
         COUNT(*) as total_trades,
         COUNT(*) FILTER (WHERE realized_pnl > 0) as winning_trades,
         COUNT(*) FILTER (WHERE realized_pnl <= 0) as losing_trades,
         COALESCE(SUM(realized_pnl), 0) as realized_pnl_total,
         COALESCE(SUM(total_fees_paid), 0) as total_fees_closed
       FROM positions 
       WHERE portfolio_id = $1 AND is_open = false`,
      [portfolio.id]
    );
    // Also get fees from open positions
    const openFeeResult = await db.query(
      `SELECT COALESCE(SUM(total_fees_paid), 0) as total_fees_open
       FROM positions
       WHERE portfolio_id = $1 AND is_open = true`,
      [portfolio.id]
    );
    const closedStats = closedPositionsResult.rows[0] || {};
    const totalTrades = parseInt(closedStats.total_trades) || 0;
    const winningTrades = parseInt(closedStats.winning_trades) || 0;
    const losingTrades = parseInt(closedStats.losing_trades) || 0;
    const realizedPnlTotal = parseFloat(closedStats.realized_pnl_total) || 0;
    const totalFeesClosed = parseFloat(closedStats.total_fees_closed) || 0;
    const totalFeesOpen = parseFloat(openFeeResult.rows[0]?.total_fees_open) || 0;
    const totalFeesAll = totalFeesClosed + totalFeesOpen;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : null;
    
    // Determine broker name (source of truth: DB column, fallback: personality)
    const traderObj = await aiTrader.getAITrader(parseInt(req.params.id));
    const brokerKey = portfolio.broker_profile || traderObj?.personality?.capital?.brokerProfile || 'flatex';
    const brokerName = trading.BROKER_PROFILES[brokerKey]?.name || brokerKey;
    
    // === REALISM: Persist high-water-mark for accurate drawdown tracking ===
    const previousMaxValue = parseFloat(portfolio.max_value) || initialCapital;
    const currentMaxValue = Math.max(previousMaxValue, totalValue);
    if (currentMaxValue > previousMaxValue) {
      // New all-time high — update DB
      await db.query(
        `UPDATE portfolios SET max_value = $1, updated_at = NOW() WHERE id = $2`,
        [currentMaxValue, portfolio.id]
      );
    }
    const currentDrawdown = currentMaxValue > 0 ? ((currentMaxValue - totalValue) / currentMaxValue) * 100 : 0;
    
    res.json({
      cash: cashBalance,
      total_value: totalValue,
      total_invested: totalInvested,
      total_current_value: totalCurrentValue,
      positions_count: positions.length,
      positions: positionsMap,
      unrealized_pnl: totalUnrealizedPnl,
      unrealized_pnl_pct: totalInvested > 0 ? (totalUnrealizedPnl / totalInvested) * 100 : 0,
      total_pnl: totalPnl,
      total_pnl_pct: totalPnlPct,
      daily_pnl: dailyPnl,
      daily_pnl_pct: dailyPnlPct,
      initial_capital: initialCapital,
      max_value: currentMaxValue,
      current_drawdown: currentDrawdown,
      // Trade stats from closed positions
      trades_executed: totalTrades,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
      win_rate: winRate,
      realized_pnl: realizedPnlTotal,
      // Broker fees
      total_fees: totalFeesAll,
      broker_name: brokerName,
      broker_profile: brokerKey,
    });
  } catch (e) {
    console.error('Get portfolio error:', e);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

/**
 * Execute trade for AI trader
 * POST /api/ai-traders/:id/execute
 */
app.post('/api/ai-traders/:id/execute', async (req, res) => {
  try {
    const traderId = parseInt(req.params.id);
    const { symbol, action, quantity, stop_loss, take_profit, reasoning } = req.body;
    let { price } = req.body;
    
    // Validate quantity
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Invalid quantity', quantity });
    }
    
    // === REALISM: Reject trades outside market hours ===
    if (backgroundJobs.isOutsideTradingHours()) {
      return res.status(400).json({ error: 'Market is closed. Trades can only be executed during trading hours (Mon-Fri 09:00-17:30 CET).' });
    }
    
    // === REALISM: Verify price with live market data ===
    // Don't blindly trust the price from the RL service — fetch the actual current price
    try {
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
      const liveRes = await fetch(yahooUrl);
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        const liveMeta = liveData?.chart?.result?.[0]?.meta;
        const livePrice = liveMeta?.regularMarketPrice;
        if (livePrice && livePrice > 0) {
          const priceDiff = Math.abs(price - livePrice) / livePrice * 100;
          if (priceDiff > 1.0) {
            console.warn(`[AI Trader ${traderId}] Price correction: ${symbol} requested $${price.toFixed(2)}, market is $${livePrice.toFixed(2)} (${priceDiff.toFixed(1)}% diff)`);
          }
          price = livePrice;  // Always use the live market price
        }
      }
    } catch (priceErr) {
      console.warn(`[AI Trader ${traderId}] Could not verify live price for ${symbol}, using submitted price:`, priceErr.message);
    }
    
    // Get AI trader
    const trader = await aiTrader.getAITrader(traderId);
    const traderName = trader?.name || `Trader #${traderId}`;
    
    // Get AI trader's portfolio
    let portfolio = await aiTrader.getAITraderPortfolio(traderId);
    
    // Determine broker profile (source of truth: DB column, fallback: personality)
    const brokerProfile = portfolio?.broker_profile || trader?.personality?.capital?.brokerProfile || 'flatex';
    if (!portfolio) {
      if (!trader) {
        return res.status(404).json({ error: 'AI trader not found' });
      }
      const initialCapital = trader.personality?.capital?.initialBudget || 100000;
      portfolio = await aiTrader.createAITraderPortfolio(traderId, initialCapital, brokerProfile);
    }
    
    // Use direct SQL queries for AI trader position management
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      if (action === 'buy' || action === 'short') {
        // === REALISM: Use correct product type for short positions ===
        // Short selling stocks requires margin/CFD in reality
        const productType = action === 'short' ? 'cfd' : 'stock';
        
        // Calculate broker fees (includes spread cost)
        const fees = trading.calculateFees({
          productType,
          side: action === 'short' ? 'sell' : 'buy',
          quantity: Math.abs(quantity),
          price,
          brokerProfile,
        });
        const orderFee = fees.totalFees;  // commission + spread
        
        // === REALISM: Use effective price (includes bid-ask spread) ===
        // In real markets, buy orders fill at the ask price (higher than mid)
        // and sell/short orders fill at the bid price (lower than mid)
        const executionPrice = fees.effectivePrice;
        
        // === REALISM: Add random slippage (0.01-0.05% for liquid stocks) ===
        const slippagePct = 0.0001 + Math.random() * 0.0004; // 0.01% to 0.05%
        const slippageDirection = (action === 'buy') ? 1 : -1; // buy = worse (higher), short = worse (lower)
        const finalPrice = executionPrice * (1 + slippageDirection * slippagePct);
        
        // Check if we have enough cash (cost + fee)
        const cost = Math.abs(quantity) * finalPrice;
        const totalCost = cost + orderFee;
        if (totalCost > parseFloat(portfolio.cash_balance)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Insufficient funds', required: totalCost, available: portfolio.cash_balance, fee: orderFee });
        }
        
        // Check if position already exists
        const existingPos = await client.query(
          `SELECT * FROM positions WHERE portfolio_id = $1 AND symbol = $2 AND is_open = true`,
          [portfolio.id, symbol]
        );
        
        let position;
        const side = action === 'short' ? 'short' : 'long';
        
        if (existingPos.rows.length > 0 && existingPos.rows[0].side === side) {
          // Add to existing position (average up/down)
          const existing = existingPos.rows[0];
          const newQuantity = parseFloat(existing.quantity) + Math.abs(quantity);
          const newAvgPrice = ((parseFloat(existing.quantity) * parseFloat(existing.entry_price)) + (Math.abs(quantity) * finalPrice)) / newQuantity;
          
          const updateResult = await client.query(
            `UPDATE positions SET quantity = $1, entry_price = $2, total_fees_paid = COALESCE(total_fees_paid, 0) + $3, open_fee = COALESCE(open_fee, 0) + $4, updated_at = NOW()
             WHERE id = $5 RETURNING *`,
            [newQuantity, newAvgPrice, orderFee, orderFee, existing.id]
          );
          position = updateResult.rows[0];
        } else {
          // Create new position with effective price (spread + slippage included)
          const insertResult = await client.query(
            `INSERT INTO positions (portfolio_id, symbol, side, quantity, entry_price, current_price, 
             stop_loss, take_profit, product_type, is_open, close_reason, total_fees_paid, open_fee, opened_at)
             VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, true, $9, $10, $10, NOW())
             RETURNING *`,
            [portfolio.id, symbol, side, Math.abs(quantity), finalPrice, stop_loss, take_profit, productType, reasoning, orderFee]
          );
          position = insertResult.rows[0];
        }
        
        // Update portfolio cash (cost of shares + broker fee)
        await client.query(
          `UPDATE portfolios SET cash_balance = cash_balance - $1, updated_at = NOW() WHERE id = $2`,
          [totalCost, portfolio.id]
        );
        
        await client.query('COMMIT');
        
        // Log with realistic execution details
        const slippageCents = Math.abs(finalPrice - price) * Math.abs(quantity);
        await aiTrader.updateAITrader(traderId, {
          status_message: `${action === 'short' ? 'Shorted' : 'Bought'} ${quantity} ${symbol} @ $${finalPrice.toFixed(2)} (Mid: $${price.toFixed(2)}, Spread+Slip: $${slippageCents.toFixed(2)}, Gebühr: $${orderFee.toFixed(2)})`
        });
        
        // Update trader stats (trades_executed counter)
        try {
          await aiTrader.updateTraderStats(traderId);
        } catch (statsErr) {
          console.error(`[AI Trader ${traderId}] Stats update error (non-fatal):`, statsErr.message);
        }
        
        // Emit SSE event for real-time UI updates
        emitTradeExecuted(traderId, traderName, {
          symbol,
          action,
          quantity,
          price: finalPrice,
          midPrice: price,
          cost,
          fee: orderFee,
          slippage: slippageCents,
        });
        
        res.status(201).json({ success: true, position, action, fee: orderFee, executionPrice: finalPrice, requestedPrice: price });
        
      } else if (action === 'sell' || action === 'close') {
        // Get existing position
        const positionsResult = await client.query(
          `SELECT * FROM positions WHERE portfolio_id = $1 AND symbol = $2 AND is_open = true`,
          [portfolio.id, symbol]
        );
        
        if (positionsResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'No position to sell' });
        }
        
        const position = positionsResult.rows[0];
        const entryPrice = parseFloat(position.entry_price);
        const positionQty = parseFloat(position.quantity);
        const posProductType = position.product_type || 'stock';
        
        // === REALISM: Calculate close fees with correct product type ===
        const closeFees = trading.calculateFees({
          productType: posProductType,
          side: 'sell',
          quantity: positionQty,
          price,
          brokerProfile,
        });
        const closeFee = closeFees.totalFees;
        
        // === REALISM: Apply spread + slippage to close price ===
        // Sell orders fill at bid (lower), buy-to-cover (short) at ask (higher)
        const closeEffectivePrice = closeFees.effectivePrice;
        const closeSlippagePct = 0.0001 + Math.random() * 0.0004; // 0.01-0.05%
        const closeSlippageDir = (position.side === 'long') ? -1 : 1; // selling long = worse (lower), covering short = worse (higher)
        const closePrice = closeEffectivePrice * (1 + closeSlippageDir * closeSlippagePct);
        
        const totalFeesPaid = parseFloat(position.total_fees_paid || 0) + closeFee;
        
        // Calculate P&L based on position side (AFTER fees) using realistic close price
        let grossPnl, pnl, pnlPercent;
        if (position.side === 'short') {
          grossPnl = (entryPrice - closePrice) * positionQty;
        } else {
          grossPnl = (closePrice - entryPrice) * positionQty;
        }
        pnl = grossPnl - totalFeesPaid;  // Net P&L after all fees (open + close)
        pnlPercent = (entryPrice * positionQty) > 0 ? (pnl / (entryPrice * positionQty) * 100) : 0;
        
        // Close position with realistic execution price
        await client.query(
          `UPDATE positions SET is_open = false, close_price = $1, closed_at = NOW(),
           realized_pnl = $2, close_reason = $3, total_fees_paid = $5
           WHERE id = $4`,
          [closePrice, pnl, reasoning || action, position.id, totalFeesPaid]
        );
        
        // Update portfolio cash (add back cost basis + gross P&L - close fee)
        const proceeds = Math.max(0, (entryPrice * positionQty) + grossPnl - closeFee);
        if (proceeds === 0) {
          console.warn(`[AI Trader ${traderId}] Proceeds capped at 0 for ${symbol} (gross: ${grossPnl.toFixed(2)}, closeFee: ${closeFee.toFixed(2)})`);
        }
        await client.query(
          `UPDATE portfolios SET cash_balance = cash_balance + $1, updated_at = NOW() WHERE id = $2`,
          [proceeds, portfolio.id]
        );
        
        await client.query('COMMIT');
        
        // Update trader stats with realistic details
        const closeSlipCents = Math.abs(closePrice - price) * positionQty;
        await aiTrader.updateAITrader(traderId, {
          status_message: `Closed ${position.side} ${positionQty} ${symbol} @ $${closePrice.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%, Gebühren: $${totalFeesPaid.toFixed(2)}, Slip: $${closeSlipCents.toFixed(2)})`
        });
        
        // Update outcomes and recalculate trader stats
        try {
          await aiTrader.updatePendingOutcomes();
          await aiTrader.updateTraderStats(traderId);
        } catch (statsErr) {
          console.error(`[AI Trader ${traderId}] Stats update error (non-fatal):`, statsErr.message);
        }
        
        // Emit SSE event for real-time UI updates
        emitTradeExecuted(traderId, traderName, {
          symbol,
          action: action === 'close' ? 'close' : 'sell',
          quantity: positionQty,
          price: closePrice,
          midPrice: price,
          proceeds,
          pnl: pnlPercent.toFixed(2),
          fee: closeFee,
          totalFees: totalFeesPaid,
          slippage: closeSlipCents,
        });
        
        res.status(200).json({ success: true, position: { ...position, close_price: closePrice, realized_pnl: pnl, total_fees_paid: totalFeesPaid }, action, pnl, pnlPercent, fee: closeFee, totalFees: totalFeesPaid });
      } else {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Invalid action. Use buy, sell, short, or close.' });
      }
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Execute trade error:', e);
    res.status(500).json({ error: 'Failed to execute trade', details: e.message });
  }
});

/**
 * Get AI trader positions with live prices
 * GET /api/ai-traders/:id/positions
 */
app.get('/api/ai-traders/:id/positions', async (req, res) => {
  try {
    const portfolio = await aiTrader.getAITraderPortfolio(parseInt(req.params.id));
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    
    const positions = await trading.getOpenPositionsByPortfolio(portfolio.id);
    
    // Fetch live prices for all symbols
    const symbols = [...new Set(positions.map(p => p.symbol))];
    const liveQuotes = {};
    
    for (const symbol of symbols) {
      try {
        // Use Yahoo chart endpoint to get current price
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
        const response = await fetch(yahooUrl);
        if (response.ok) {
          const data = await response.json();
          const quote = data?.chart?.result?.[0];
          if (quote) {
            const meta = quote.meta || {};
            const closes = quote.indicators?.quote?.[0]?.close || [];
            const currentPrice = meta.regularMarketPrice || closes[closes.length - 1] || null;
            const previousClose = meta.chartPreviousClose || meta.previousClose || null;
            const marketState = meta.marketState || 'UNKNOWN';
            
            liveQuotes[symbol] = {
              currentPrice,
              previousClose,
              marketState,
              change: currentPrice && previousClose ? currentPrice - previousClose : null,
              changePercent: currentPrice && previousClose ? ((currentPrice - previousClose) / previousClose) * 100 : null
            };
          }
        }
      } catch (e) {
        console.warn(`Failed to fetch live quote for ${symbol}:`, e.message);
      }
    }
    
    // Enhance positions with live data
    const enhancedPositions = positions.map(pos => {
      const live = liveQuotes[pos.symbol];
      const currentPrice = live?.currentPrice || pos.currentPrice || pos.entryPrice;
      const entryPrice = pos.entryPrice || 0;
      const quantity = pos.quantity || 0;
      const side = pos.side || 'long';
      
      // Calculate P&L based on position side
      let unrealizedPnl, unrealizedPnlPercent;
      if (side === 'short') {
        unrealizedPnl = (entryPrice - currentPrice) * quantity;
        unrealizedPnlPercent = entryPrice > 0 ? ((entryPrice - currentPrice) / entryPrice) * 100 : 0;
      } else {
        unrealizedPnl = (currentPrice - entryPrice) * quantity;
        unrealizedPnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
      }
      
      // Calculate days held
      const openedAt = pos.openedAt ? new Date(pos.openedAt) : new Date();
      const now = new Date();
      const daysHeld = Math.floor((now.getTime() - openedAt.getTime()) / (1000 * 60 * 60 * 24));
      const hoursHeld = Math.floor((now.getTime() - openedAt.getTime()) / (1000 * 60 * 60));
      
      // Calculate daily P&L (change since previous close)
      let dailyPnl = null;
      let dailyPnlPercent = null;
      if (live?.previousClose && currentPrice) {
        if (side === 'short') {
          dailyPnl = (live.previousClose - currentPrice) * quantity;
          dailyPnlPercent = ((live.previousClose - currentPrice) / live.previousClose) * 100;
        } else {
          dailyPnl = (currentPrice - live.previousClose) * quantity;
          dailyPnlPercent = ((currentPrice - live.previousClose) / live.previousClose) * 100;
        }
      }
      
      // Calculate distance to stop loss / take profit
      const distanceToStopLoss = pos.stopLoss ? 
        (side === 'short' 
          ? ((pos.stopLoss - currentPrice) / currentPrice) * 100
          : ((currentPrice - pos.stopLoss) / currentPrice) * 100) 
        : null;
      
      const distanceToTakeProfit = pos.takeProfit ? 
        (side === 'short'
          ? ((currentPrice - pos.takeProfit) / currentPrice) * 100
          : ((pos.takeProfit - currentPrice) / currentPrice) * 100)
        : null;
      
      // Fee data and break-even price
      const openFee = pos.openFee || 0;
      const totalFeesPaid = pos.totalFeesPaid || 0;
      // Break-even = entry price adjusted by total fees per share
      const feePerShare = quantity > 0 ? totalFeesPaid / quantity : 0;
      const breakEvenPrice = side === 'short'
        ? entryPrice - feePerShare
        : entryPrice + feePerShare;

      return {
        ...pos,
        currentPrice,
        unrealizedPnl,
        unrealizedPnlPercent,
        daysHeld,
        hoursHeld,
        dailyPnl,
        dailyPnlPercent,
        distanceToStopLoss,
        distanceToTakeProfit,
        marketState: live?.marketState || 'UNKNOWN',
        priceChange: live?.change || null,
        priceChangePercent: live?.changePercent || null,
        notionalValue: currentPrice * quantity,
        investedValue: entryPrice * quantity,
        openFee,
        totalFeesPaid,
        breakEvenPrice
      };
    });
    
    res.json(enhancedPositions);
  } catch (e) {
    console.error('Get positions error:', e);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

/**
 * Get AI trader executed trades (opens + closes)
 * GET /api/ai-traders/:id/trades
 */
app.get('/api/ai-traders/:id/trades', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const portfolio = await aiTrader.getAITraderPortfolio(parseInt(req.params.id));
    if (!portfolio) {
      return res.json([]);
    }
    
    // Get ALL positions with matching decision reasoning (JOIN on symbol + trader + closest timestamp)
    const result = await db.query(
      `SELECT 
         p.id, p.symbol, p.side, p.quantity, p.entry_price, p.close_price,
         p.opened_at, p.closed_at, p.realized_pnl, p.close_reason,
         p.stop_loss, p.take_profit, p.is_open, p.total_fees_paid, p.open_fee,
         -- Buy/open decision reasoning (closest executed decision for this symbol around open time)
         open_d.summary_short AS open_summary,
         open_d.reasoning AS open_reasoning,
         open_d.confidence AS open_confidence,
         open_d.weighted_score AS open_weighted_score,
         open_d.ml_score AS open_ml_score,
         open_d.rl_score AS open_rl_score,
         open_d.sentiment_score AS open_sentiment_score,
         open_d.technical_score AS open_technical_score,
         open_d.signal_agreement AS open_signal_agreement,
         -- Close decision reasoning
         close_d.summary_short AS close_summary,
         close_d.reasoning AS close_reasoning,
         close_d.confidence AS close_confidence
       FROM positions p
       LEFT JOIN LATERAL (
         SELECT summary_short, reasoning, confidence, weighted_score,
                ml_score, rl_score, sentiment_score, technical_score, signal_agreement
         FROM ai_trader_decisions
         WHERE ai_trader_id = $2
           AND symbol = p.symbol
           AND executed = true
           AND decision_type IN ('buy', 'short')
         ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - p.opened_at)))
         LIMIT 1
       ) open_d ON true
       LEFT JOIN LATERAL (
         SELECT summary_short, reasoning, confidence
         FROM ai_trader_decisions
         WHERE ai_trader_id = $2
           AND symbol = p.symbol
           AND executed = true
           AND decision_type IN ('sell', 'close')
           AND p.closed_at IS NOT NULL
         ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - p.closed_at)))
         LIMIT 1
       ) close_d ON true
       WHERE p.portfolio_id = $1
       ORDER BY COALESCE(p.closed_at, p.opened_at) DESC
       LIMIT $3`,
      [portfolio.id, parseInt(req.params.id), parseInt(limit)]
    );
    
    // Build trade entries: each position generates 1 open trade + optionally 1 close trade
    const trades = [];
    
    for (const row of result.rows) {
      const qty = parseFloat(row.quantity);
      const entryPrice = parseFloat(row.entry_price);
      const entryValue = entryPrice * qty;
      
      // Build human-readable explanation from reasoning
      const buildExplanation = (reasoning, summary, decisionType) => {
        if (!reasoning && !summary) return null;
        const parts = [];
        
        if (reasoning) {
          const r = typeof reasoning === 'string' ? JSON.parse(reasoning) : reasoning;
          
          // Trigger-based close reasons (most understandable)
          if (r.trigger === 'stop_loss') {
            parts.push('🛑 Stop-Loss wurde ausgelöst – Verlustbegrenzung aktiv');
          } else if (r.trigger === 'take_profit') {
            parts.push('🎯 Take-Profit erreicht – Gewinn gesichert');
          } else if (r.trigger === 'max_holding') {
            parts.push('⏰ Maximale Haltezeit überschritten');
          }
          
          // Signal-based reasoning in plain language
          if (r.signals) {
            const sigs = r.signals;
            const bullish = [];
            const bearish = [];
            
            if (sigs.ml?.score != null) {
              const pct = Math.abs(sigs.ml.score * 100).toFixed(0);
              if (sigs.ml.score > 0.2) bullish.push(`KI-Prognose positiv (${pct}%)`);
              else if (sigs.ml.score < -0.2) bearish.push(`KI-Prognose negativ (${pct}%)`);
            }
            if (sigs.rl?.score != null) {
              const pct = Math.abs(sigs.rl.score * 100).toFixed(0);
              if (sigs.rl.score > 0.2) bullish.push(`Handelsagent empfiehlt Kauf (${pct}%)`);
              else if (sigs.rl.score < -0.2) bearish.push(`Handelsagent empfiehlt Verkauf (${pct}%)`);
            }
            if (sigs.sentiment?.score != null) {
              const pct = Math.abs(sigs.sentiment.score * 100).toFixed(0);
              if (sigs.sentiment.score > 0.15) bullish.push(`Marktstimmung positiv (${pct}%)`);
              else if (sigs.sentiment.score < -0.15) bearish.push(`Marktstimmung negativ (${pct}%)`);
            }
            if (sigs.technical?.score != null) {
              const pct = Math.abs(sigs.technical.score * 100).toFixed(0);
              if (sigs.technical.score > 0.2) bullish.push(`Technische Indikatoren bullisch (${pct}%)`);
              else if (sigs.technical.score < -0.2) bearish.push(`Technische Indikatoren bärisch (${pct}%)`);
            }
            
            if (decisionType === 'buy' || decisionType === 'short') {
              // For opening: show why we entered
              if (decisionType === 'buy' && bullish.length > 0) {
                parts.push(...bullish);
              } else if (decisionType === 'short' && bearish.length > 0) {
                parts.push(...bearish);
              }
            } else {
              // For closing: show what changed
              if (bearish.length > 0) parts.push(...bearish);
              if (bullish.length > 0) parts.push(...bullish);
            }
          }
          
          // Agreement info
          if (r.agreement === 'strong') parts.push('Alle Signale stimmen überein');
          else if (r.agreement === 'moderate') parts.push('Mehrheit der Signale stimmt überein');
          
          // Risk blockers
          if (r.risk_checks && !r.risk_checks.passed) {
            parts.push('⚠️ Risiko-Checks nicht bestanden');
          }
        }
        
        // Fallback to summary if no detailed explanation built
        if (parts.length === 0 && summary) {
          parts.push(summary);
        }
        
        return parts.length > 0 ? parts : null;
      };

      // BUY/SHORT entry trade
      const openReasoning = row.open_reasoning ? (typeof row.open_reasoning === 'string' ? JSON.parse(row.open_reasoning) : row.open_reasoning) : null;
      trades.push({
        id: row.id,
        tradeType: 'open',
        symbol: row.symbol,
        side: row.side,
        action: row.side === 'short' ? 'short' : 'buy',
        quantity: qty,
        price: entryPrice,
        cost: entryValue,
        timestamp: row.opened_at,
        pnl: null,
        pnlPercent: null,
        stopLoss: row.stop_loss ? parseFloat(row.stop_loss) : null,
        takeProfit: row.take_profit ? parseFloat(row.take_profit) : null,
        isOpen: row.is_open,
        positionId: row.id,
        // Decision data
        summary: row.open_summary || null,
        confidence: row.open_confidence ? parseFloat(row.open_confidence) : null,
        weightedScore: row.open_weighted_score ? parseFloat(row.open_weighted_score) : null,
        mlScore: row.open_ml_score ? parseFloat(row.open_ml_score) : null,
        rlScore: row.open_rl_score ? parseFloat(row.open_rl_score) : null,
        sentimentScore: row.open_sentiment_score ? parseFloat(row.open_sentiment_score) : null,
        technicalScore: row.open_technical_score ? parseFloat(row.open_technical_score) : null,
        signalAgreement: row.open_signal_agreement || null,
        explanation: buildExplanation(openReasoning, row.open_summary, row.side === 'short' ? 'short' : 'buy'),
        fees: row.open_fee != null ? parseFloat(row.open_fee) : 
              (row.total_fees_paid != null ? (row.is_open 
                ? parseFloat(row.total_fees_paid) 
                : parseFloat(row.total_fees_paid) / 2
              ) : null),
      });
      
      // CLOSE/SELL trade (only for closed positions)
      if (!row.is_open && row.closed_at) {
        const closePrice = parseFloat(row.close_price);
        const pnl = parseFloat(row.realized_pnl) || 0;
        const pnlPercent = entryValue > 0 ? (pnl / entryValue) * 100 : 0;
        const holdingMs = new Date(row.closed_at).getTime() - new Date(row.opened_at).getTime();
        
        const closeReasoning = row.close_reasoning ? (typeof row.close_reasoning === 'string' ? JSON.parse(row.close_reasoning) : row.close_reasoning) : null;
        trades.push({
          id: row.id * 100000,  // unique ID for close trade
          tradeType: 'close',
          symbol: row.symbol,
          side: row.side,
          action: 'close',
          quantity: qty,
          price: closePrice,
          cost: closePrice * qty,
          timestamp: row.closed_at,
          pnl: pnl,
          pnlPercent: pnlPercent,
          holdingHours: Math.round(holdingMs / (1000 * 60 * 60)),
          holdingDays: Math.round(holdingMs / (1000 * 60 * 60 * 24)),
          closeReason: row.close_reason,
          wasWinner: pnl > 0,
          entryPrice: entryPrice,
          stopLoss: row.stop_loss ? parseFloat(row.stop_loss) : null,
          takeProfit: row.take_profit ? parseFloat(row.take_profit) : null,
          isOpen: false,
          positionId: row.id,
          // Decision data
          summary: row.close_summary || null,
          confidence: row.close_confidence ? parseFloat(row.close_confidence) : null,
          explanation: buildExplanation(closeReasoning, row.close_summary, 'close'),
          fees: (row.open_fee != null && row.total_fees_paid != null) 
            ? parseFloat(row.total_fees_paid) - parseFloat(row.open_fee)
            : (row.total_fees_paid != null ? parseFloat(row.total_fees_paid) / 2 : null),  // Fallback for legacy positions
        });
      }
    }
    
    // Sort all trades by timestamp descending
    trades.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    res.json(trades.slice(0, parseInt(limit)));
  } catch (e) {
    console.error('Get trades error:', e);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

/**
 * Get AI trader daily reports
 * GET /api/ai-traders/:id/reports
 */
app.get('/api/ai-traders/:id/reports', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const reports = await aiTrader.getDailyReports(
      parseInt(req.params.id),
      startDate,
      endDate
    );
    res.json(reports);
  } catch (e) {
    console.error('Get reports error:', e);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

/**
 * Get a specific report by date
 * GET /api/ai-traders/:id/reports/:date
 */
app.get('/api/ai-traders/:id/reports/:date', async (req, res) => {
  try {
    const aiTraderReportsModule = await import('./aiTraderReports.js');
    const report = await aiTraderReportsModule.getReportByDate(
      parseInt(req.params.id),
      req.params.date
    );
    
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    res.json(report);
  } catch (e) {
    console.error('Get report by date error:', e);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

/**
 * Generate daily report manually
 * POST /api/ai-traders/:id/reports/generate
 */
app.post('/api/ai-traders/:id/reports/generate', authMiddleware, async (req, res) => {
  try {
    const aiTraderReportsModule = await import('./aiTraderReports.js');
    const { date } = req.body;
    const reportDate = date ? new Date(date) : new Date();
    
    const report = await aiTraderReportsModule.generateDailyReport(
      parseInt(req.params.id),
      reportDate
    );
    
    res.json(report);
  } catch (e) {
    console.error('Generate report error:', e);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

/**
 * Get signal accuracy for an AI trader
 * GET /api/ai-traders/:id/signal-accuracy
 */
app.get('/api/ai-traders/:id/signal-accuracy', async (req, res) => {
  try {
    const aiTraderSignalAccuracyModule = await import('./aiTraderSignalAccuracy.js');
    const days = parseInt(req.query.days) || 30;
    
    const accuracy = await aiTraderSignalAccuracyModule.calculateSignalAccuracy(
      parseInt(req.params.id),
      days
    );
    
    res.json(accuracy);
  } catch (e) {
    console.error('Get signal accuracy error:', e);
    res.status(500).json({ error: 'Failed to calculate signal accuracy' });
  }
});

/**
 * Get insights for an AI trader
 * GET /api/ai-traders/:id/insights
 */
app.get('/api/ai-traders/:id/insights', async (req, res) => {
  try {
    const aiTraderInsightsModule = await import('./aiTraderInsights.js');
    
    const insights = await aiTraderInsightsModule.getInsights(
      parseInt(req.params.id)
    );
    
    res.json({ insights });
  } catch (e) {
    console.error('Get insights error:', e);
    res.status(500).json({ error: 'Failed to fetch insights' });
  }
});

/**
 * Get weight history for an AI trader
 * GET /api/ai-traders/:id/weight-history
 */
app.get('/api/ai-traders/:id/weight-history', async (req, res) => {
  try {
    const aiTraderLearningModule = await import('./aiTraderLearning.js');
    const limit = parseInt(req.query.limit) || 20;
    
    const history = await aiTraderLearningModule.getWeightHistory(
      parseInt(req.params.id),
      limit
    );
    
    res.json(history);
  } catch (e) {
    console.error('Get weight history error:', e);
    res.status(500).json({ error: 'Failed to fetch weight history' });
  }
});

/**
 * Manually adjust weights
 * POST /api/ai-traders/:id/adjust-weights
 */
app.post('/api/ai-traders/:id/adjust-weights', authMiddleware, async (req, res) => {
  try {
    const aiTraderLearningModule = await import('./aiTraderLearning.js');
    const { weights, reason } = req.body;
    
    const result = await aiTraderLearningModule.manuallyAdjustWeights(
      parseInt(req.params.id),
      weights,
      reason || 'manual_adjustment'
    );
    
    res.json(result);
  } catch (e) {
    console.error('Adjust weights error:', e);
    res.status(400).json({ error: e.message || 'Failed to adjust weights' });
  }
});

/**
 * Get training history for an AI trader
 * GET /api/ai-traders/:id/training-history
 */
app.get('/api/ai-traders/:id/training-history', async (req, res) => {
  try {
    const traderId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit) || 20;
    
    const history = await aiTrader.getTrainingHistory(traderId, limit);
    res.json(history);
  } catch (e) {
    console.error('Get training history error:', e);
    res.status(500).json({ error: 'Failed to fetch training history' });
  }
});

/**
 * Record a training session for an AI trader
 * POST /api/ai-traders/:id/training-history
 */
app.post('/api/ai-traders/:id/training-history', async (req, res) => {
  try {
    const traderId = parseInt(req.params.id);
    const record = await aiTrader.recordTrainingSession(traderId, req.body);
    
    res.json(record);
  } catch (e) {
    console.error('Record training session error:', e);
    res.status(500).json({ error: 'Failed to record training session' });
  }
});

/**
 * Get training statistics for an AI trader
 * GET /api/ai-traders/:id/training-stats
 */
app.get('/api/ai-traders/:id/training-stats', async (req, res) => {
  try {
    const traderId = parseInt(req.params.id);
    const stats = await aiTrader.getTrainingStats(traderId);
    res.json(stats);
  } catch (e) {
    console.error('Get training stats error:', e);
    res.status(500).json({ error: 'Failed to fetch training stats' });
  }
});

/**
 * Trigger adaptive learning for a specific AI trader
 * POST /api/ai-traders/:id/trigger-learning
 */
app.post('/api/ai-traders/:id/trigger-learning', authMiddleware, async (req, res) => {
  try {
    const traderId = parseInt(req.params.id);
    const aiTraderLearningModule = await import('./aiTraderLearning.js');
    
    // Check if trader exists and has learning enabled
    const trader = await aiTrader.getAITrader(traderId);
    if (!trader) {
      return res.status(404).json({ error: 'AI Trader not found' });
    }
    
    const learning = trader.personality?.learning;
    if (!learning?.enabled || !learning?.updateWeights) {
      return res.status(400).json({ 
        error: 'Learning not enabled for this trader',
        hint: 'Enable "Lernmodus aktivieren" and "Gewichte automatisch anpassen" in trader settings'
      });
    }
    
    console.log(`[API] Manual adaptive learning trigger for trader ${traderId}`);
    const result = await aiTraderLearningModule.adjustSignalWeights(traderId);
    
    res.json({
      success: true,
      traderId,
      traderName: trader.name,
      ...result
    });
  } catch (e) {
    console.error('Trigger learning error:', e);
    res.status(500).json({ error: e.message || 'Failed to trigger adaptive learning' });
  }
});

/**
 * Get default personality configuration
 * GET /api/ai-traders/config/default-personality
 */
app.get('/api/ai-traders/config/default-personality', (req, res) => {
  res.json(aiTrader.DEFAULT_PERSONALITY);
});

/**
 * SSE: Stream for individual AI Trader
 * GET /api/stream/ai-trader/:id
 */
app.get('/api/stream/ai-trader/:id', optionalAuthMiddleware, (req, res) => {
  const traderId = parseInt(req.params.id);
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  const clientId = `${req.user?.id || 'anon'}-${timestamp}-${random}`;
  
  // Disable Node.js socket timeout for SSE
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);
  
  aiTraderEvents.addClient(clientId, res, [traderId]);
  
  // Initial status message using named event type
  res.write(`event: message\ndata: ${JSON.stringify({ type: 'connected', traderId })}\n\n`);
});

/**
 * SSE: Stream for all AI Traders
 * GET /api/stream/ai-traders
 */
app.get('/api/stream/ai-traders', optionalAuthMiddleware, (req, res) => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  const clientId = `${req.user?.id || 'anon'}-${timestamp}-${random}`;
  
  // Disable Node.js socket timeout for SSE
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);
  
  aiTraderEvents.addClient(clientId, res, []);
  
  res.write(`event: message\ndata: ${JSON.stringify({ type: 'connected', all: true })}\n\n`);
});

// ============================================================================
// RSS Feed Endpoints (German News Sources)
// ============================================================================

// Initialize RSS Parser
const rssParser = new Parser({
  customFields: {
    item: [
      ['dc:creator', 'creator'],
      ['dc:date', 'dcDate'],
      ['pubDate', 'pubDate'],
    ]
  },
  timeout: 10000, // 10 second timeout
});

// RSS Feed configurations
const RSS_FEEDS = {
  'boerse-frankfurt': {
    name: 'Börse Frankfurt',
    url: 'https://www.boerse-frankfurt.de/nachrichten/rss',
    language: 'de',
    category: 'market'
  },
  'bafin': {
    name: 'BaFin',
    url: 'https://www.bafin.de/SiteGlobals/Functions/RSSFeed/DE/RSSNewsfeed/Verbraucher/rssVerbraucher.xml',
    language: 'de',
    category: 'regulatory'
  },
  'ecb': {
    name: 'European Central Bank',
    url: 'https://www.ecb.europa.eu/rss/press.html',
    language: 'en',
    category: 'macro'
  },
  'bundesbank': {
    name: 'Deutsche Bundesbank',
    url: 'https://www.bundesbank.de/resource/feed/rss/de/aktuelles',
    language: 'de',
    category: 'macro'
  }
};

// RSS Feed cache TTL (5 minutes)
const RSS_CACHE_TTL = 5 * 60;

/**
 * Get available RSS feeds configuration
 * GET /api/rss/feeds
 */
app.get('/api/rss/feeds', (req, res) => {
  const feeds = Object.entries(RSS_FEEDS).map(([id, config]) => ({
    id,
    name: config.name,
    language: config.language,
    category: config.category
  }));
  res.json({ feeds });
});

/**
 * Fetch news from a specific RSS feed
 * GET /api/rss/feed/:feedId
 */
app.get('/api/rss/feed/:feedId', async (req, res) => {
  const { feedId } = req.params;
  const feedConfig = RSS_FEEDS[feedId];
  
  if (!feedConfig) {
    return res.status(400).json({ error: 'Unknown feed ID', availableFeeds: Object.keys(RSS_FEEDS) });
  }
  
  const cacheKey = `rss:${feedId}`;
  
  try {
    // Check cache first
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      return res.json({ 
        ...cached.data, 
        _cached: true, 
        _cachedAt: cached.cachedAt 
      });
    }
    
    // Fetch and parse RSS feed
    const feed = await rssParser.parseURL(feedConfig.url);
    
    // Generate unique timestamp base for this batch
    const batchTimestamp = Date.now();
    
    // Normalize feed items to NewsItem format
    const items = (feed.items || []).slice(0, 20).map((item, index) => ({
      id: `rss-${feedId}-${batchTimestamp}-${index}`,
      headline: item.title || '',
      summary: item.contentSnippet || item.content || '',
      source: feedConfig.name,
      url: item.link || '',
      datetime: item.pubDate ? new Date(item.pubDate).getTime() : 
               item.isoDate ? new Date(item.isoDate).getTime() : Date.now(),
      image: item.enclosure?.url || undefined,
      language: feedConfig.language,
      category: feedConfig.category
    }));
    
    const result = {
      feedId,
      feedName: feedConfig.name,
      language: feedConfig.language,
      category: feedConfig.category,
      items,
      fetchedAt: new Date().toISOString()
    };
    
    // Cache the result
    await stockCache.setCache(cacheKey, result, RSS_CACHE_TTL);
    
    res.json(result);
  } catch (error) {
    console.error(`RSS feed fetch error for ${feedId}:`, error.message);
    res.status(500).json({ 
      error: 'Failed to fetch RSS feed',
      feedId
    });
  }
});

/**
 * Fetch news from all RSS feeds
 * GET /api/rss/all
 */
app.get('/api/rss/all', async (req, res) => {
  const cacheKey = 'rss:all';
  
  try {
    // Check cache first
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      return res.json({ 
        ...cached.data, 
        _cached: true, 
        _cachedAt: cached.cachedAt 
      });
    }
    
    // Generate unique timestamp base for this batch request
    const batchTimestamp = Date.now();
    
    // Fetch all feeds in parallel
    const feedPromises = Object.entries(RSS_FEEDS).map(async ([feedId, config], feedIndex) => {
      try {
        const feed = await rssParser.parseURL(config.url);
        return (feed.items || []).slice(0, 10).map((item, index) => ({
          id: `rss-${feedId}-${batchTimestamp}-${feedIndex}-${index}`,
          headline: item.title || '',
          summary: item.contentSnippet || item.content || '',
          source: config.name,
          url: item.link || '',
          datetime: item.pubDate ? new Date(item.pubDate).getTime() : 
                   item.isoDate ? new Date(item.isoDate).getTime() : Date.now(),
          image: item.enclosure?.url || undefined,
          language: config.language,
          category: config.category,
          feedId
        }));
      } catch (error) {
        console.error(`RSS fetch failed for ${feedId}:`, error.message);
        return [];
      }
    });
    
    const allFeeds = await Promise.all(feedPromises);
    const allItems = allFeeds.flat().sort((a, b) => b.datetime - a.datetime);
    
    const result = {
      items: allItems.slice(0, 50),
      feedCount: Object.keys(RSS_FEEDS).length,
      fetchedAt: new Date().toISOString()
    };
    
    // Cache the result
    await stockCache.setCache(cacheKey, result, RSS_CACHE_TTL);
    
    res.json(result);
  } catch (error) {
    console.error('RSS all feeds fetch error:', error.message);
    res.status(500).json({ error: 'Failed to fetch RSS feeds' });
  }
});

// ============================================================================
// Marketaux API Proxy Endpoints
// ============================================================================

const MARKETAUX_API_BASE = 'https://api.marketaux.com/v1';

/**
 * Proxy Marketaux news endpoint
 * GET /api/marketaux/news
 * Query params: symbols, language, limit, apiKey
 */
app.get('/api/marketaux/news', async (req, res) => {
  const { symbols, language = 'en', limit = '10', apiKey } = req.query;
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }
  
  const cacheKey = `marketaux:news:${symbols || 'all'}:${language}`;
  
  try {
    // Check cache first
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
    
    const url = new URL(`${MARKETAUX_API_BASE}/news/all`);
    url.searchParams.set('api_token', apiKey);
    url.searchParams.set('language', language);
    url.searchParams.set('limit', limit);
    if (symbols) {
      url.searchParams.set('symbols', symbols);
    }
    
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DayTrader/1.0'
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'Marketaux API error'
      });
    }
    
    // Generate unique timestamp base for this batch
    const batchTimestamp = Date.now();
    
    // Normalize to NewsItem format
    const normalizedData = {
      items: (data.data || []).map((item, index) => ({
        id: item.uuid || `marketaux-${batchTimestamp}-${index}`,
        headline: item.title || '',
        summary: item.description || item.snippet || '',
        source: item.source || 'Marketaux',
        url: item.url || '',
        datetime: item.published_at ? new Date(item.published_at).getTime() : Date.now(),
        image: item.image_url || undefined,
        related: item.entities?.map(e => e.symbol).filter(Boolean) || [],
        sentiment: typeof item.sentiment_score === 'number' ? item.sentiment_score : undefined,
        language: item.language || language
      })),
      meta: data.meta,
      fetchedAt: new Date().toISOString()
    };
    
    // Cache for 5 minutes
    await stockCache.setCache(cacheKey, normalizedData, 300);
    
    res.json(normalizedData);
  } catch (error) {
    console.error('Marketaux proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch from Marketaux' });
  }
});

// ============================================================================
// Financial Modeling Prep (FMP) API Proxy Endpoints
// ============================================================================

const FMP_API_BASE = 'https://financialmodelingprep.com/api/v3';

/**
 * Proxy FMP stock news endpoint
 * GET /api/fmp/news/stock
 * Query params: tickers, limit, apiKey
 */
app.get('/api/fmp/news/stock', async (req, res) => {
  const { tickers, limit = '10', apiKey } = req.query;
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }
  
  const cacheKey = `fmp:stocknews:${tickers || 'all'}`;
  
  try {
    // Check cache first
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
    
    const url = new URL(`${FMP_API_BASE}/stock_news`);
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('limit', limit);
    if (tickers) {
      url.searchParams.set('tickers', tickers);
    }
    
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DayTrader/1.0'
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'FMP API error'
      });
    }
    
    // Generate unique timestamp base for this batch
    const batchTimestamp = Date.now();
    
    // Normalize to NewsItem format
    const normalizedData = {
      items: (data || []).map((item, index) => ({
        id: `fmp-${batchTimestamp}-${index}`,
        headline: item.title || '',
        summary: item.text || '',
        source: item.site || 'FMP',
        url: item.url || '',
        datetime: item.publishedDate ? new Date(item.publishedDate).getTime() : Date.now(),
        image: item.image || undefined,
        related: item.symbol ? [item.symbol] : [],
        language: 'en'
      })),
      fetchedAt: new Date().toISOString()
    };
    
    // Cache for 5 minutes
    await stockCache.setCache(cacheKey, normalizedData, 300);
    
    res.json(normalizedData);
  } catch (error) {
    console.error('FMP proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch from FMP' });
  }
});

/**
 * Proxy FMP general market news endpoint
 * GET /api/fmp/news/general
 * Query params: limit, apiKey
 */
app.get('/api/fmp/news/general', async (req, res) => {
  const { limit = '20', apiKey } = req.query;
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }
  
  const cacheKey = `fmp:generalnews`;
  
  try {
    // Check cache first
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
    
    const url = new URL(`${FMP_API_BASE}/stock-market-news`);
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('limit', limit);
    
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DayTrader/1.0'
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'FMP API error'
      });
    }
    
    // Generate unique timestamp base for this batch
    const batchTimestamp = Date.now();
    
    // Normalize to NewsItem format
    const normalizedData = {
      items: (data || []).map((item, index) => ({
        id: `fmp-general-${batchTimestamp}-${index}`,
        headline: item.title || '',
        summary: item.text || '',
        source: item.site || 'FMP',
        url: item.url || '',
        datetime: item.publishedDate ? new Date(item.publishedDate).getTime() : Date.now(),
        image: item.image || undefined,
        related: item.symbol ? [item.symbol] : [],
        language: 'en'
      })),
      fetchedAt: new Date().toISOString()
    };
    
    // Cache for 5 minutes
    await stockCache.setCache(cacheKey, normalizedData, 300);
    
    res.json(normalizedData);
  } catch (error) {
    console.error('FMP general news proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch from FMP' });
  }
});

// ============================================================================
// Tiingo News API Proxy Endpoints
// ============================================================================

const TIINGO_API_BASE = 'https://api.tiingo.com';

/**
 * Proxy Tiingo news endpoint
 * GET /api/tiingo/news
 * Query params: tickers, limit, apiKey
 */
app.get('/api/tiingo/news', async (req, res) => {
  const { tickers, limit = '10', apiKey } = req.query;
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }
  
  const cacheKey = `tiingo:news:${tickers || 'all'}`;
  
  try {
    // Check cache first
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
    
    const url = new URL(`${TIINGO_API_BASE}/tiingo/news`);
    url.searchParams.set('token', apiKey);
    url.searchParams.set('limit', limit);
    if (tickers) {
      url.searchParams.set('tickers', tickers);
    }
    
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'DayTrader/1.0'
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'Tiingo API error'
      });
    }
    
    // Generate unique timestamp base for this batch
    const batchTimestamp = Date.now();
    
    // Normalize to NewsItem format
    const normalizedData = {
      items: (data || []).map((item, index) => ({
        id: item.id?.toString() || `tiingo-${batchTimestamp}-${index}`,
        headline: item.title || '',
        summary: item.description || '',
        source: item.source || 'Tiingo',
        url: item.url || '',
        datetime: item.publishedDate ? new Date(item.publishedDate).getTime() : Date.now(),
        related: item.tickers || [],
        language: 'en'
      })),
      fetchedAt: new Date().toISOString()
    };
    
    // Cache for 5 minutes
    await stockCache.setCache(cacheKey, normalizedData, 300);
    
    res.json(normalizedData);
  } catch (error) {
    console.error('Tiingo proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch from Tiingo' });
  }
});

// ============================================================================
// mediastack News API Proxy Endpoints
// ============================================================================

const MEDIASTACK_API_BASE = 'http://api.mediastack.com/v1';

/**
 * Proxy mediastack news endpoint
 * GET /api/mediastack/news
 * Query params: apiKey, keywords, language, limit
 */
app.get('/api/mediastack/news', async (req, res) => {
  const { apiKey, keywords = '', language = 'en', limit = '20' } = req.query;
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }
  
  const cacheKey = `mediastack:news:${keywords || 'all'}:${language}`;
  
  try {
    // Check cache first
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
    
    const url = new URL(`${MEDIASTACK_API_BASE}/news`);
    url.searchParams.set('access_key', apiKey);
    url.searchParams.set('languages', language);
    url.searchParams.set('limit', limit);
    if (keywords) {
      url.searchParams.set('keywords', keywords);
    }
    
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DayTrader/1.0'
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'mediastack API error',
        message: data.error?.message || 'Unknown error'
      });
    }
    
    // Generate unique timestamp base for this batch
    const batchTimestamp = Date.now();
    
    // Normalize to NewsItem format
    const normalizedData = {
      items: (data.data || []).map((item, index) => ({
        id: `mediastack-${batchTimestamp}-${index}`,
        headline: item.title || '',
        summary: item.description || '',
        source: item.source || 'mediastack',
        url: item.url || '',
        datetime: item.published_at ? new Date(item.published_at).getTime() : Date.now(),
        image: item.image || undefined,
        language: item.language || language,
        category: item.category || undefined
      })),
      fetchedAt: new Date().toISOString()
    };
    
    // Cache for 5 minutes
    await stockCache.setCache(cacheKey, normalizedData, 300);
    
    res.json(normalizedData);
  } catch (error) {
    console.error('mediastack proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch from mediastack' });
  }
});

// ============================================================================
// NewsData.io News API Proxy Endpoints
// ============================================================================

const NEWSDATA_API_BASE = 'https://newsdata.io/api/1';

/**
 * Proxy NewsData.io news endpoint
 * GET /api/newsdata/news
 * Query params: apiKey, q, language, category
 */
app.get('/api/newsdata/news', async (req, res) => {
  const { apiKey, q = '', language = 'en', category = 'business' } = req.query;
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }
  
  const cacheKey = `newsdata:news:${q || 'all'}:${language}:${category}`;
  
  try {
    // Check cache first
    const cached = await stockCache.getCached(cacheKey);
    if (cached) {
      return res.json({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt });
    }
    
    const url = new URL(`${NEWSDATA_API_BASE}/news`);
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('language', language);
    url.searchParams.set('category', category);
    if (q) {
      url.searchParams.set('q', q);
    }
    
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DayTrader/1.0'
      }
    });
    
    const data = await response.json();
    
    if (!response.ok || data.status === 'error') {
      return res.status(response.status || 400).json({ 
        error: 'NewsData.io API error',
        message: data.message || 'Unknown error'
      });
    }
    
    // Generate unique timestamp base for this batch
    const batchTimestamp = Date.now();
    
    // Normalize to NewsItem format
    const normalizedData = {
      items: (data.results || []).map((item, index) => ({
        id: item.article_id || `newsdata-${batchTimestamp}-${index}`,
        headline: item.title || '',
        summary: item.description || item.content || '',
        source: item.source_id || 'NewsData.io',
        url: item.link || '',
        datetime: item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
        image: item.image_url || undefined,
        language: item.language || language,
        category: item.category?.[0] || category
      })),
      fetchedAt: new Date().toISOString()
    };
    
    // Cache for 5 minutes
    await stockCache.setCache(cacheKey, normalizedData, 300);
    
    res.json(normalizedData);
  } catch (error) {
    console.error('NewsData.io proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch from NewsData.io' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const startServer = async () => {
  // Initialize database if configured
  if (process.env.DATABASE_URL) {
    try {
      await db.initializeDatabase();
      await trading.initializeTradingSchema();
      await aiTrader.initializeAITraderSchema();
      await stockCache.initializeCacheTable();
      await sentimentArchive.initializeSentimentArchive();
      console.log('Database connected and initialized');
      
      // Schedule session cleanup every hour
      setInterval(() => {
        db.cleanupExpiredSessions();
      }, 60 * 60 * 1000);
      
      // Schedule cache cleanup every 15 minutes
      setInterval(() => {
        stockCache.cleanupExpiredCache();
      }, 15 * 60 * 1000);
      
      // Schedule sentiment archive cleanup daily (keep 90 days)
      setInterval(() => {
        sentimentArchive.cleanupOldEntries(90);
      }, 24 * 60 * 60 * 1000);
      
      // Schedule overnight fee processing daily at 00:00 UTC
      const scheduleOvernightFees = () => {
        const now = new Date();
        const midnight = new Date(now);
        midnight.setUTCHours(24, 0, 0, 0);
        const msUntilMidnight = midnight.getTime() - now.getTime();
        
        setTimeout(() => {
          trading.processOvernightFees();
          // Then run every 24 hours
          setInterval(() => {
            trading.processOvernightFees();
          }, 24 * 60 * 60 * 1000);
        }, msUntilMidnight);
      };
      scheduleOvernightFees();
      
      // Schedule daily portfolio snapshots at 22:00 UTC (after US market close)
      const scheduleDailySnapshots = () => {
        const now = new Date();
        const snapshotTime = new Date(now);
        snapshotTime.setUTCHours(22, 0, 0, 0);
        if (snapshotTime <= now) {
          snapshotTime.setDate(snapshotTime.getDate() + 1);
        }
        const msUntilSnapshot = snapshotTime.getTime() - now.getTime();
        
        setTimeout(() => {
          trading.saveDailySnapshots();
          // Then run every 24 hours
          setInterval(() => {
            trading.saveDailySnapshots();
          }, 24 * 60 * 60 * 1000);
        }, msUntilSnapshot);
      };
      scheduleDailySnapshots();
      
      // Register SSE broadcast callback with background jobs
      backgroundJobs.setBroadcastCallback(broadcastQuoteUpdate);
      
      // Start background jobs for automatic quote updates
      backgroundJobs.startBackgroundJobs();
    } catch (e) {
      console.error('Database initialization failed:', e.message);
      console.log('Server will start without database features');
    }
  } else {
    console.log('DATABASE_URL not set - running without database features');
  }
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DayTrader Backend Proxy running on port ${PORT}`);
    console.log(`Version: ${BUILD_VERSION} (${BUILD_COMMIT})`);
    console.log(`Build time: ${BUILD_TIME}`);
  });
};

startServer();
