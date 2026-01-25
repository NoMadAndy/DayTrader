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

const app = express();
const PORT = process.env.PORT || 3001;

// Build info from environment (set during Docker build)
const BUILD_VERSION = process.env.BUILD_VERSION || '1.4.0';
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
