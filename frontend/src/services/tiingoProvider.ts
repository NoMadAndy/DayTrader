/**
 * Tiingo News Provider
 * 
 * Institutional-grade news API with historical archive.
 * Provides ticker-based filtering and comprehensive coverage.
 * 
 * API Documentation: https://api.tiingo.com/documentation/news
 */

import type { NewsItem } from './types';
import { log } from '../utils/logger';

// Backend proxy endpoint
const TIINGO_API_BASE = '/api/tiingo';

export class TiingoProvider {
  name = 'Tiingo';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  /**
   * Fetch news for specific stock tickers
   */
  async fetchStockNews(tickers: string | string[]): Promise<NewsItem[]> {
    if (!this.isConfigured()) {
      return [];
    }

    try {
      const tickerParam = Array.isArray(tickers) ? tickers.join(',') : tickers;
      const url = new URL(`${TIINGO_API_BASE}/news`, window.location.origin);
      url.searchParams.set('apiKey', this.apiKey);
      url.searchParams.set('tickers', tickerParam);
      url.searchParams.set('limit', '15');

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        log.error(`Tiingo error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      log.error('Tiingo stock news fetch error:', error);
      return [];
    }
  }

  /**
   * Fetch general market news
   */
  async fetchMarketNews(): Promise<NewsItem[]> {
    if (!this.isConfigured()) {
      return [];
    }

    try {
      const url = new URL(`${TIINGO_API_BASE}/news`, window.location.origin);
      url.searchParams.set('apiKey', this.apiKey);
      url.searchParams.set('limit', '20');

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        log.error(`Tiingo error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      log.error('Tiingo market news fetch error:', error);
      return [];
    }
  }
}

// Factory function
export function createTiingoProvider(apiKey: string): TiingoProvider {
  return new TiingoProvider(apiKey);
}
