/**
 * Finnhub Data Provider (via backend proxy with shared caching)
 * 
 * All requests go through the backend proxy, which:
 * - Caches results in PostgreSQL for all users
 * - Reduces total API calls across the platform
 * - Avoids CORS issues
 * 
 * API Documentation: https://finnhub.io/docs/api
 */

import type { OHLCV } from '../types/stock';
import type { DataProvider, QuoteData, NewsItem, StockSearchResult } from './types';

// Use backend proxy (relative URLs work with nginx/vite proxy)
const API_BASE_URL = '/api/finnhub';

export class FinnhubProvider implements DataProvider {
  name = 'Finnhub';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  private async fetch<T>(url: string): Promise<T | null> {
    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'X-Finnhub-Token': this.apiKey,
        }
      });
      
      if (!response.ok) {
        console.error(`Finnhub API error: ${response.status} ${response.statusText}`);
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('Finnhub fetch error:', error);
      return null;
    }
  }

  async fetchQuote(symbol: string): Promise<QuoteData | null> {
    interface FinnhubQuote {
      c: number;  // Current price
      d: number;  // Change
      dp: number; // Percent change
      h: number;  // High
      l: number;  // Low
      o: number;  // Open
      pc: number; // Previous close
      t: number;  // Timestamp
      _cached?: boolean;
      _cachedAt?: string;
    }

    const url = `${API_BASE_URL}/quote/${encodeURIComponent(symbol)}`;
    const data = await this.fetch<FinnhubQuote>(url);
    
    if (!data || data.c === 0) {
      return null;
    }

    return {
      symbol,
      price: data.c,
      change: data.d,
      changePercent: data.dp,
      high: data.h,
      low: data.l,
      open: data.o,
      previousClose: data.pc,
      volume: 0, // Not provided in basic quote
      timestamp: data.t * 1000
    };
  }

  async fetchCandles(symbol: string, days: number = 365): Promise<OHLCV[] | null> {
    interface FinnhubCandles {
      c: number[];  // Close prices
      h: number[];  // High prices
      l: number[];  // Low prices
      o: number[];  // Open prices
      t: number[];  // Timestamps
      v: number[];  // Volumes
      s: string;    // Status
      _cached?: boolean;
      _cachedAt?: string;
    }

    const now = Math.floor(Date.now() / 1000);
    const from = now - (days * 24 * 60 * 60);

    const url = `${API_BASE_URL}/candles/${encodeURIComponent(symbol)}?resolution=D&from=${from}&to=${now}`;
    const data = await this.fetch<FinnhubCandles>(url);

    if (!data || data.s !== 'ok' || !data.t || data.t.length === 0) {
      return null;
    }

    const candles: OHLCV[] = [];
    for (let i = 0; i < data.t.length; i++) {
      candles.push({
        time: data.t[i],
        open: data.o[i],
        high: data.h[i],
        low: data.l[i],
        close: data.c[i],
        volume: data.v[i]
      });
    }

    return candles;
  }

  async fetchNews(symbol: string): Promise<NewsItem[]> {
    interface FinnhubNews {
      category: string;
      datetime: number;
      headline: string;
      id: number;
      image: string;
      related: string;
      source: string;
      summary: string;
      url: string;
    }

    const now = new Date();
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const url = `${API_BASE_URL}/news/${encodeURIComponent(symbol)}?from=${from.toISOString().split('T')[0]}&to=${now.toISOString().split('T')[0]}`;
    const response = await this.fetch<FinnhubNews[] | { data: FinnhubNews[], _cached?: boolean }>(url);

    // Handle both direct array and wrapped response from cache
    const data = Array.isArray(response) ? response : response?.data;
    
    if (!data || !Array.isArray(data)) {
      return [];
    }

    return data.slice(0, 10).map(item => ({
      id: item.id.toString(),
      headline: item.headline,
      summary: item.summary,
      source: item.source,
      url: item.url,
      datetime: item.datetime * 1000,
      image: item.image || undefined,
      related: item.related ? item.related.split(',').map(s => s.trim()) : undefined
    }));
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    interface FinnhubSearchResult {
      count: number;
      result: Array<{
        description: string;
        displaySymbol: string;
        symbol: string;
        type: string;
      }>;
      _cached?: boolean;
      _cachedAt?: string;
    }

    const url = `${API_BASE_URL}/search?q=${encodeURIComponent(query)}`;
    const data = await this.fetch<FinnhubSearchResult>(url);

    if (!data || !data.result) {
      return [];
    }

    return data.result
      .filter(item => item.type === 'Common Stock')
      .slice(0, 10)
      .map(item => ({
        symbol: item.symbol,
        name: item.description,
        type: item.type
      }));
  }
}
