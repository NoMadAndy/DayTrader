/**
 * Real-Time Stock Updates Hook
 * 
 * Uses Server-Sent Events (SSE) to receive real-time quote updates
 * from the backend. The backend's background jobs continuously update
 * quotes in the database and broadcast changes to connected clients.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { QuoteData } from '../services/types';

interface QuoteUpdate {
  symbol: string;
  data: {
    quoteResponse: {
      result: Array<{
        symbol: string;
        regularMarketPrice: number;
        previousClose: number;
        regularMarketChange: number;
        regularMarketChangePercent: number;
        currency: string;
        exchangeName: string;
      }>;
    };
  };
  updatedAt: string;
}

interface UseRealTimeQuotesOptions {
  symbols: string[];
  enabled?: boolean;
  onUpdate?: (symbol: string, quote: QuoteData) => void;
}

interface UseRealTimeQuotesResult {
  quotes: Map<string, QuoteData>;
  isConnected: boolean;
  lastUpdate: Date | null;
  error: string | null;
  reconnect: () => void;
}

/**
 * Hook for real-time quote updates via Server-Sent Events
 */
export function useRealTimeQuotes({
  symbols,
  enabled = true,
  onUpdate,
}: UseRealTimeQuotesOptions): UseRealTimeQuotesResult {
  const [quotes, setQuotes] = useState<Map<string, QuoteData>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttempts = useRef(0);
  
  // Convert Yahoo quote format to our QuoteData format
  const convertQuote = useCallback((yahooQuote: QuoteUpdate['data']['quoteResponse']['result'][0]): QuoteData => {
    return {
      symbol: yahooQuote.symbol,
      price: yahooQuote.regularMarketPrice,
      change: yahooQuote.regularMarketChange,
      changePercent: yahooQuote.regularMarketChangePercent,
      high: 0, // Not provided in background update
      low: 0,
      open: 0,
      previousClose: yahooQuote.previousClose,
      volume: 0,
      timestamp: Date.now(),
    };
  }, []);
  
  const connect = useCallback(() => {
    if (!enabled || symbols.length === 0) return;
    
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    
    const symbolsParam = symbols.join(',');
    const url = `/api/stream/quotes?symbols=${encodeURIComponent(symbolsParam)}`;
    
    console.log('[SSE] Connecting to', url);
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;
    
    eventSource.onopen = () => {
      console.log('[SSE] Connected');
      setIsConnected(true);
      setError(null);
      reconnectAttempts.current = 0;
    };
    
    eventSource.addEventListener('connected', (event) => {
      const data = JSON.parse(event.data);
      console.log('[SSE] Connection confirmed:', data);
    });
    
    eventSource.addEventListener('quote', (event) => {
      const update: QuoteUpdate = JSON.parse(event.data);
      const yahooQuote = update.data?.quoteResponse?.result?.[0];
      
      if (yahooQuote) {
        const quote = convertQuote(yahooQuote);
        
        setQuotes(prev => {
          const next = new Map(prev);
          next.set(update.symbol, quote);
          return next;
        });
        
        setLastUpdate(new Date());
        
        if (onUpdate) {
          onUpdate(update.symbol, quote);
        }
      }
    });
    
    eventSource.addEventListener('ping', () => {
      // Keep-alive ping, no action needed
    });
    
    eventSource.onerror = (e) => {
      console.error('[SSE] Error:', e);
      setIsConnected(false);
      setError('Connection lost');
      
      eventSource.close();
      eventSourceRef.current = null;
      
      // Exponential backoff for reconnection
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
      reconnectAttempts.current++;
      
      console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);
      
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, delay);
    };
  }, [enabled, symbols, convertQuote, onUpdate]);
  
  const reconnect = useCallback(() => {
    reconnectAttempts.current = 0;
    connect();
  }, [connect]);
  
  // Connect on mount and when symbols change
  useEffect(() => {
    connect();
    
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connect]);
  
  return {
    quotes,
    isConnected,
    lastUpdate,
    error,
    reconnect,
  };
}

/**
 * Hook for checking background jobs status
 */
export function useBackgroundJobsStatus() {
  const [status, setStatus] = useState<{
    isRunning: boolean;
    lastQuoteUpdate: string | null;
    nextQuoteUpdate: string | null;
    stats: {
      cycleCount: number;
      successfulUpdates: number;
      failedUpdates: number;
    };
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/cache/jobs');
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (e) {
      console.error('Failed to fetch job status:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  useEffect(() => {
    fetchStatus();
    
    // Refresh status every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);
  
  return { status, isLoading, refresh: fetchStatus };
}

export default useRealTimeQuotes;
