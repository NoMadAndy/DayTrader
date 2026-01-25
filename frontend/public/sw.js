/**
 * Service Worker for DayTrader
 * 
 * Provides background sync for stock price updates and caching.
 * Uses Periodic Background Sync API where available.
 */

const CACHE_NAME = 'daytrader-v1';
const QUOTE_CACHE_NAME = 'daytrader-quotes-v1';

// URLs to cache for offline support
const STATIC_ASSETS = [
  '/',
  '/index.html',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== QUOTE_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  const { type, payload } = event.data;
  
  switch (type) {
    case 'UPDATE_WATCHLIST':
      // Store watchlist symbols for background updates
      updateWatchlist(payload.symbols);
      break;
    case 'MANUAL_SYNC':
      // Trigger manual sync
      performBackgroundSync();
      break;
    case 'GET_CACHED_QUOTES':
      // Return cached quotes
      getCachedQuotes().then((quotes) => {
        event.ports[0].postMessage({ type: 'CACHED_QUOTES', quotes });
      });
      break;
  }
});

// Store watchlist in IndexedDB
async function updateWatchlist(symbols) {
  try {
    const db = await openDatabase();
    const tx = db.transaction('config', 'readwrite');
    const store = tx.objectStore('config');
    await store.put({ key: 'watchlist', value: symbols, updatedAt: Date.now() });
  } catch (e) {
    console.error('[SW] Failed to update watchlist:', e);
  }
}

// Get watchlist from IndexedDB
async function getWatchlist() {
  try {
    const db = await openDatabase();
    const tx = db.transaction('config', 'readonly');
    const store = tx.objectStore('config');
    const result = await store.get('watchlist');
    return result?.value || [];
  } catch (e) {
    console.error('[SW] Failed to get watchlist:', e);
    return [];
  }
}

// Open IndexedDB
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('DayTraderSW', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Store for configuration (watchlist, API keys, etc.)
      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config', { keyPath: 'key' });
      }
      
      // Store for cached quotes
      if (!db.objectStoreNames.contains('quotes')) {
        const quotesStore = db.createObjectStore('quotes', { keyPath: 'symbol' });
        quotesStore.createIndex('updatedAt', 'updatedAt');
      }
    };
  });
}

// Store quote in IndexedDB
async function storeQuote(symbol, quoteData) {
  try {
    const db = await openDatabase();
    const tx = db.transaction('quotes', 'readwrite');
    const store = tx.objectStore('quotes');
    await store.put({
      symbol,
      data: quoteData,
      updatedAt: Date.now()
    });
  } catch (e) {
    console.error('[SW] Failed to store quote:', e);
  }
}

// Get cached quotes from IndexedDB
async function getCachedQuotes() {
  try {
    const db = await openDatabase();
    const tx = db.transaction('quotes', 'readonly');
    const store = tx.objectStore('quotes');
    const all = await store.getAll();
    return all.reduce((acc, item) => {
      acc[item.symbol] = { data: item.data, updatedAt: item.updatedAt };
      return acc;
    }, {});
  } catch (e) {
    console.error('[SW] Failed to get cached quotes:', e);
    return {};
  }
}

// Perform background sync - fetch quotes for watchlist
async function performBackgroundSync() {
  console.log('[SW] Performing background sync');
  
  const symbols = await getWatchlist();
  if (symbols.length === 0) {
    console.log('[SW] No symbols in watchlist for background sync');
    return;
  }
  
  // Get API config from IndexedDB
  const db = await openDatabase();
  const tx = db.transaction('config', 'readonly');
  const store = tx.objectStore('config');
  const apiConfig = await store.get('apiConfig');
  
  // Fetch quotes using Yahoo Finance (no API key required)
  for (const symbol of symbols.slice(0, 10)) { // Limit to 10 symbols in background
    try {
      // Using a simple proxy or direct Yahoo endpoint
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
        { 
          headers: { 'Accept': 'application/json' },
          mode: 'cors'
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        const result = data.chart?.result?.[0];
        if (result) {
          const meta = result.meta;
          const quote = {
            symbol,
            price: meta.regularMarketPrice,
            change: meta.regularMarketPrice - meta.previousClose,
            changePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
            previousClose: meta.previousClose,
            timestamp: Date.now()
          };
          await storeQuote(symbol, quote);
        }
      }
    } catch (e) {
      console.warn(`[SW] Failed to fetch quote for ${symbol}:`, e);
    }
    
    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Notify all clients about updated quotes
  const clients = await self.clients.matchAll();
  const cachedQuotes = await getCachedQuotes();
  
  clients.forEach(client => {
    client.postMessage({
      type: 'QUOTES_UPDATED',
      quotes: cachedQuotes
    });
  });
  
  console.log('[SW] Background sync complete');
}

// Periodic Background Sync (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-quotes') {
    console.log('[SW] Periodic sync triggered');
    event.waitUntil(performBackgroundSync());
  }
});

// Regular Background Sync (fallback)
self.addEventListener('sync', (event) => {
  if (event.tag === 'update-quotes') {
    console.log('[SW] Sync triggered');
    event.waitUntil(performBackgroundSync());
  }
});

// Handle fetch events for caching
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  
  // Cache API responses for stock data
  if (url.hostname.includes('yahoo') || 
      url.hostname.includes('finnhub') || 
      url.hostname.includes('alphavantage')) {
    event.respondWith(
      caches.open(QUOTE_CACHE_NAME).then(async (cache) => {
        try {
          const response = await fetch(event.request);
          // Cache for 1 minute
          if (response.ok) {
            cache.put(event.request, response.clone());
          }
          return response;
        } catch (e) {
          // Return cached version if network fails
          const cached = await cache.match(event.request);
          if (cached) return cached;
          throw e;
        }
      })
    );
    return;
  }
  
  // Network-first for other requests
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
