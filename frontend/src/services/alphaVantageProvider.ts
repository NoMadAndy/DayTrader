/**
 * Alpha Vantage Data Provider (via backend proxy with shared caching)
 * 
 * All requests go through the backend proxy, which:
 * - Caches results in PostgreSQL for all users
 * - Reduces total API calls across the platform
 * - Handles rate limiting gracefully
 * 
 * API Documentation: https://www.alphavantage.co/documentation/
 */

import type { OHLCV } from '../types/stock';
import type { DataProvider, QuoteData, StockSearchResult } from './types';
import { log } from '../utils/logger';

// Use backend proxy (relative URLs work with nginx/vite proxy)
const API_BASE_URL = '/api/alphavantage';

export class AlphaVantageProvider implements DataProvider {
  name = 'Alpha Vantage';
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
          'X-AlphaVantage-Key': this.apiKey,
        }
      });
      
      if (!response.ok) {
        if (response.status === 429) {
          log.warn('Alpha Vantage rate limit exceeded (cached data may be available)');
        }
        log.error(`Alpha Vantage API error: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      
      // Check for rate limit or error messages
      if (data['Error Message'] || data['Note']) {
        log.error('Alpha Vantage API message:', data['Error Message'] || data['Note']);
        return null;
      }

      return data;
    } catch (error) {
      log.error('Alpha Vantage fetch error:', error);
      return null;
    }
  }

  async fetchQuote(symbol: string): Promise<QuoteData | null> {
    interface AlphaVantageQuote {
      'Global Quote': {
        '01. symbol': string;
        '02. open': string;
        '03. high': string;
        '04. low': string;
        '05. price': string;
        '06. volume': string;
        '07. latest trading day': string;
        '08. previous close': string;
        '09. change': string;
        '10. change percent': string;
      };
      _cached?: boolean;
      _cachedAt?: string;
    }

    const url = `${API_BASE_URL}/quote/${encodeURIComponent(symbol)}`;
    const data = await this.fetch<AlphaVantageQuote>(url);

    if (!data || !data['Global Quote'] || !data['Global Quote']['05. price']) {
      return null;
    }

    const quote = data['Global Quote'];
    const price = parseFloat(quote['05. price']);
    const previousClose = parseFloat(quote['08. previous close']);
    const change = parseFloat(quote['09. change']);
    const changePercent = parseFloat(quote['10. change percent'].replace('%', ''));

    return {
      symbol: quote['01. symbol'],
      price,
      change,
      changePercent,
      high: parseFloat(quote['03. high']),
      low: parseFloat(quote['04. low']),
      open: parseFloat(quote['02. open']),
      previousClose,
      volume: parseInt(quote['06. volume'], 10),
      timestamp: new Date(quote['07. latest trading day']).getTime()
    };
  }

  async fetchCandles(symbol: string, days: number = 365): Promise<OHLCV[] | null> {
    interface AlphaVantageDaily {
      'Time Series (Daily)': {
        [date: string]: {
          '1. open': string;
          '2. high': string;
          '3. low': string;
          '4. close': string;
          '5. volume': string;
        };
      };
      _cached?: boolean;
      _cachedAt?: string;
    }

    // Alpha Vantage provides compact (100 days) or full (20+ years)
    const outputsize = days > 100 ? 'full' : 'compact';

    const url = `${API_BASE_URL}/daily/${encodeURIComponent(symbol)}?outputsize=${outputsize}`;
    const data = await this.fetch<AlphaVantageDaily>(url);

    if (!data || !data['Time Series (Daily)']) {
      return null;
    }

    const timeSeries = data['Time Series (Daily)'];
    const candles: OHLCV[] = [];

    // Get entries and sort by date
    const entries = Object.entries(timeSeries).sort(([a], [b]) => a.localeCompare(b));
    
    // Take only the requested number of days
    const recentEntries = entries.slice(-days);

    for (const [date, values] of recentEntries) {
      candles.push({
        time: Math.floor(new Date(date).getTime() / 1000),
        open: parseFloat(values['1. open']),
        high: parseFloat(values['2. high']),
        low: parseFloat(values['3. low']),
        close: parseFloat(values['4. close']),
        volume: parseInt(values['5. volume'], 10)
      });
    }

    return candles;
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    interface AlphaVantageSearch {
      bestMatches: Array<{
        '1. symbol': string;
        '2. name': string;
        '3. type': string;
        '4. region': string;
        '8. currency': string;
      }>;
      _cached?: boolean;
      _cachedAt?: string;
    }

    const url = `${API_BASE_URL}/search?keywords=${encodeURIComponent(query)}`;
    const data = await this.fetch<AlphaVantageSearch>(url);

    if (!data || !data.bestMatches) {
      return [];
    }

    return data.bestMatches
      .filter(item => item['3. type'] === 'Equity')
      .slice(0, 10)
      .map(item => ({
        symbol: item['1. symbol'],
        name: item['2. name'],
        type: item['3. type'],
        exchange: item['4. region']
      }));
  }
}
