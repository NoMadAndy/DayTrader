/**
 * DayTrader Backend Proxy
 * 
 * Proxies requests to external APIs (Yahoo Finance, etc.) to avoid CORS issues.
 * This server runs in Docker alongside the frontend.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';

const app = express();
const PORT = process.env.PORT || 3001;

// Build info from environment (set during Docker build)
const BUILD_VERSION = process.env.BUILD_VERSION || '0.1.0';
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
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: BUILD_VERSION,
    commit: BUILD_COMMIT,
    buildTime: BUILD_TIME
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

// Yahoo Finance proxy endpoints
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';

/**
 * Proxy Yahoo Finance chart data
 * GET /api/yahoo/chart/:symbol
 * Query params: interval, range
 */
app.get('/api/yahoo/chart/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { interval = '1d', range = '1y' } = req.query;
  
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`DayTrader Backend Proxy running on port ${PORT}`);
  console.log(`Version: ${BUILD_VERSION} (${BUILD_COMMIT})`);
  console.log(`Build time: ${BUILD_TIME}`);
});
