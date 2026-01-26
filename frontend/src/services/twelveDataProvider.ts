/**
 * Twelve Data Provider (via backend proxy with shared caching)
 * 
 * All requests go through the backend proxy, which:
 * - Caches results in PostgreSQL for all users
 * - Reduces total API calls across the platform
 * - Handles rate limiting gracefully
 * 
 * API Documentation: https://twelvedata.com/docs
 */

import type { OHLCV } from '../types/stock';
import type { DataProvider, QuoteData, StockSearchResult } from './types';

// Use backend proxy (relative URLs work with nginx/vite proxy)
const API_BASE_URL = '/api/twelvedata';

export class TwelveDataProvider implements DataProvider {
  name = 'Twelve Data';
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
          'X-TwelveData-Key': this.apiKey,
        }
      });
      
      if (!response.ok) {
        console.error(`Twelve Data API error: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      
      // Check for error status
      if (data.status === 'error') {
        console.error('Twelve Data API error:', data.message);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Twelve Data fetch error:', error);
      return null;
    }
  }

  async fetchQuote(symbol: string): Promise<QuoteData | null> {
    interface TwelveDataQuote {
      symbol: string;
      name: string;
      exchange: string;
      currency: string;
      datetime: string;
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
      previous_close: string;
      change: string;
      percent_change: string;
      _cached?: boolean;
      _cachedAt?: string;
    }

    const url = `${API_BASE_URL}/quote/${encodeURIComponent(symbol)}`;
    const data = await this.fetch<TwelveDataQuote>(url);

    if (!data || !data.close) {
      return null;
    }

    return {
      symbol: data.symbol,
      price: parseFloat(data.close),
      change: parseFloat(data.change),
      changePercent: parseFloat(data.percent_change),
      high: parseFloat(data.high),
      low: parseFloat(data.low),
      open: parseFloat(data.open),
      previousClose: parseFloat(data.previous_close),
      volume: parseInt(data.volume, 10),
      timestamp: new Date(data.datetime).getTime()
    };
  }

  async fetchCandles(symbol: string, days: number = 365): Promise<OHLCV[] | null> {
    interface TwelveDataTimeSeries {
      meta: {
        symbol: string;
        interval: string;
      };
      values: Array<{
        datetime: string;
        open: string;
        high: string;
        low: string;
        close: string;
        volume: string;
      }>;
      _cached?: boolean;
      _cachedAt?: string;
    }

    const url = `${API_BASE_URL}/timeseries/${encodeURIComponent(symbol)}?interval=1day&outputsize=${days}`;
    const data = await this.fetch<TwelveDataTimeSeries>(url);

    if (!data || !data.values || data.values.length === 0) {
      return null;
    }

    // Twelve Data returns newest first, we need oldest first
    const candles: OHLCV[] = data.values
      .map(item => ({
        time: Math.floor(new Date(item.datetime).getTime() / 1000),
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        close: parseFloat(item.close),
        volume: parseInt(item.volume, 10)
      }))
      .reverse();

    return candles;
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    interface TwelveDataSearch {
      data: Array<{
        symbol: string;
        instrument_name: string;
        exchange: string;
        exchange_timezone: string;
        instrument_type: string;
        country: string;
      }>;
      _cached?: boolean;
      _cachedAt?: string;
    }

    const url = `${API_BASE_URL}/search?symbol=${encodeURIComponent(query)}`;
    const data = await this.fetch<TwelveDataSearch>(url);

    if (!data || !data.data) {
      return [];
    }

    return data.data
      .filter(item => item.instrument_type === 'Common Stock')
      .slice(0, 10)
      .map(item => ({
        symbol: item.symbol,
        name: item.instrument_name,
        type: item.instrument_type,
        exchange: item.exchange
      }));
  }
}
