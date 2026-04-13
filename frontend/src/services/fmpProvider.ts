/**
 * Financial Modeling Prep (FMP) News Provider
 * 
 * Comprehensive financial data and news API with ticker-specific news,
 * market news, and press releases.
 * 
 * API Documentation: https://financialmodelingprep.com/developer/docs/
 */

import type { NewsItem } from './types';
import { log } from '../utils/logger';
import { getAuthHeaders } from './authService';

// Backend proxy endpoint
const FMP_API_BASE = '/api/fmp';

export class FMPProvider {
  name = 'Financial Modeling Prep';
  constructor(_apiKey?: string) {}

  isConfigured(): boolean {
    return true;
  }

  /**
   * Fetch stock-specific news
   */
  async fetchStockNews(tickers: string | string[]): Promise<NewsItem[]> {
    if (!this.isConfigured()) {
      return [];
    }

    try {
      const tickerParam = Array.isArray(tickers) ? tickers.join(',') : tickers;
      const url = new URL(`${FMP_API_BASE}/news/stock`, window.location.origin);
      url.searchParams.set('tickers', tickerParam);
      url.searchParams.set('limit', '15');

      const response = await fetch(url.toString(), { headers: { ...getAuthHeaders() } });
      
      if (!response.ok) {
        log.error(`FMP error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      log.error('FMP stock news fetch error:', error);
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
      const url = new URL(`${FMP_API_BASE}/news/general`, window.location.origin);
      url.searchParams.set('limit', '20');

      const response = await fetch(url.toString(), { headers: { ...getAuthHeaders() } });
      
      if (!response.ok) {
        log.error(`FMP error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      log.error('FMP market news fetch error:', error);
      return [];
    }
  }
}

// Factory function
export function createFMPProvider(_apiKey?: string): FMPProvider {
  return new FMPProvider();
}
