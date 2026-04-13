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
import { getAuthHeaders } from './authService';

// Backend proxy endpoint
const TIINGO_API_BASE = '/api/tiingo';

export class TiingoProvider {
  name = 'Tiingo';
  constructor(_apiKey?: string) {}

  isConfigured(): boolean {
    return true;
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
      url.searchParams.set('tickers', tickerParam);
      url.searchParams.set('limit', '15');

      const response = await fetch(url.toString(), { headers: { ...getAuthHeaders() } });
      
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
      url.searchParams.set('limit', '20');

      const response = await fetch(url.toString(), { headers: { ...getAuthHeaders() } });
      
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
export function createTiingoProvider(_apiKey?: string): TiingoProvider {
  return new TiingoProvider();
}
