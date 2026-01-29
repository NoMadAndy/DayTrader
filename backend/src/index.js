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
import { registerUser, loginUser, logoutUser, authMiddleware, optionalAuthMiddleware } from './auth.js';
import { getUserSettings, updateUserSettings, getCustomSymbols, addCustomSymbol, removeCustomSymbol, syncCustomSymbols } from './userSettings.js';
import * as trading from './trading.js';
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
  methods: ['GET', 'OPTIONS'],
}));
app.use(express.json());

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
  const clients = [];
  for (const [clientId, client] of sseClients.entries()) {
    clients.push({
      clientId,
      symbols: client.symbols,
      connectedAt: client.connectedAt,
    });
  }
  res.json({ 
    activeConnections: sseClients.size,
    clients,
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
    return res.status(503).json({ error: 'Database not configured' });
  }
  
  const { email, password, username } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  const result = await registerUser(email, password, username);
  
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  
  res.status(201).json({ user: result.user });
});

/**
 * Login user
 * POST /api/auth/login
 * Body: { email, password }
 */
app.post('/api/auth/login', express.json(), async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  const userAgent = req.headers['user-agent'];
  const ipAddress = req.ip || req.connection.remoteAddress;
  
  const result = await loginUser(email, password, userAgent, ipAddress);
  
  if (!result.success) {
    return res.status(401).json({ error: result.error });
  }
  
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
  const { interval = '1d', range = '1y' } = req.query;
  const cacheKey = `yahoo:chart:${symbol}:${interval}:${range}`;
  
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
    const url = `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    
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
    
    // Cache the response
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
    const data = await trading.getEquityCurve(parseInt(req.params.id), req.user.id, days);
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
    const leaderboard = await trading.getLeaderboard(limit, timeframe);
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

import * as historicalPrices from './historicalPrices.js';

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
    
    // Normalize feed items to NewsItem format
    const items = (feed.items || []).slice(0, 20).map((item, index) => ({
      id: `rss-${feedId}-${index}-${Date.now()}`,
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
      feedId,
      message: error.message 
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
    
    // Fetch all feeds in parallel
    const feedPromises = Object.entries(RSS_FEEDS).map(async ([feedId, config]) => {
      try {
        const feed = await rssParser.parseURL(config.url);
        return (feed.items || []).slice(0, 10).map((item, index) => ({
          id: `rss-${feedId}-${index}-${Date.now()}`,
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
    res.status(500).json({ error: 'Failed to fetch RSS feeds', message: error.message });
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
        error: 'Marketaux API error',
        message: data.error || response.statusText
      });
    }
    
    // Normalize to NewsItem format
    const normalizedData = {
      items: (data.data || []).map((item, index) => ({
        id: item.uuid || `marketaux-${index}-${Date.now()}`,
        headline: item.title || '',
        summary: item.description || item.snippet || '',
        source: item.source || 'Marketaux',
        url: item.url || '',
        datetime: item.published_at ? new Date(item.published_at).getTime() : Date.now(),
        image: item.image_url || undefined,
        related: item.entities?.map(e => e.symbol).filter(Boolean) || [],
        sentiment: item.sentiment_score != null ? item.sentiment_score : undefined,
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
    res.status(500).json({ error: 'Failed to fetch from Marketaux', message: error.message });
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
        error: 'FMP API error',
        message: data.Error || response.statusText
      });
    }
    
    // Normalize to NewsItem format
    const normalizedData = {
      items: (data || []).map((item, index) => ({
        id: `fmp-${index}-${Date.now()}`,
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
    res.status(500).json({ error: 'Failed to fetch from FMP', message: error.message });
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
        error: 'FMP API error',
        message: data.Error || response.statusText
      });
    }
    
    // Normalize to NewsItem format
    const normalizedData = {
      items: (data || []).map((item, index) => ({
        id: `fmp-general-${index}-${Date.now()}`,
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
    res.status(500).json({ error: 'Failed to fetch from FMP', message: error.message });
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
        error: 'Tiingo API error',
        message: data.detail || response.statusText
      });
    }
    
    // Normalize to NewsItem format
    const normalizedData = {
      items: (data || []).map((item, index) => ({
        id: item.id?.toString() || `tiingo-${index}-${Date.now()}`,
        headline: item.title || '',
        summary: item.description || '',
        source: item.source || 'Tiingo',
        url: item.url || '',
        datetime: item.publishedDate ? new Date(item.publishedDate).getTime() : Date.now(),
        image: undefined, // Tiingo doesn't provide images
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
    res.status(500).json({ error: 'Failed to fetch from Tiingo', message: error.message });
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
      await stockCache.initializeCacheTable();
      console.log('Database connected and initialized');
      
      // Schedule session cleanup every hour
      setInterval(() => {
        db.cleanupExpiredSessions();
      }, 60 * 60 * 1000);
      
      // Schedule cache cleanup every 15 minutes
      setInterval(() => {
        stockCache.cleanupExpiredCache();
      }, 15 * 60 * 1000);
      
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
