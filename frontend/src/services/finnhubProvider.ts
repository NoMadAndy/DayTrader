/**
 * Finnhub Data Provider
 * 
 * Provides real-time stock quotes, historical candles, and company news.
 * 
 * API Documentation: https://finnhub.io/docs/api
 * 
 * Endpoints used:
 * - /quote: Real-time quote data
 * - /stock/candle: OHLCV candlestick data
 * - /company-news: Company-specific news
 * - /search: Symbol search
 */

import type { OHLCV } from '../types/stock';
import type { DataProvider, QuoteData, NewsItem, StockSearchResult } from './types';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';

export class FinnhubProvider implements DataProvider {
  name = 'Finnhub';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  private async fetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
    try {
      const url = new URL(`${FINNHUB_BASE_URL}${endpoint}`);
      url.searchParams.set('token', this.apiKey);
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });

      const response = await fetch(url.toString());
      
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
    }

    const data = await this.fetch<FinnhubQuote>('/quote', { symbol });
    
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
    }

    const now = Math.floor(Date.now() / 1000);
    const from = now - (days * 24 * 60 * 60);

    const data = await this.fetch<FinnhubCandles>('/stock/candle', {
      symbol,
      resolution: 'D',
      from: from.toString(),
      to: now.toString()
    });

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
    
    const data = await this.fetch<FinnhubNews[]>('/company-news', {
      symbol,
      from: from.toISOString().split('T')[0],
      to: now.toISOString().split('T')[0]
    });

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
    }

    const data = await this.fetch<FinnhubSearchResult>('/search', { q: query });

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
