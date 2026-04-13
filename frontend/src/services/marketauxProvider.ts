/**
 * Marketaux News Provider
 * 
 * Finance-specific news API with multi-language support and sentiment data.
 * Provides ticker-based filtering and entity recognition.
 * 
 * API Documentation: https://www.marketaux.com/documentation
 */

import type { NewsItem } from './types';
import { log } from '../utils/logger';
import { getAuthHeaders } from './authService';

// Backend proxy endpoint
const MARKETAUX_API_BASE = '/api/marketaux';

export interface MarketauxNewsItem extends NewsItem {
  sentimentScore?: number;
  language?: string;
}

export class MarketauxProvider {
  name = 'Marketaux';
  constructor(_apiKey?: string) {}

  isConfigured(): boolean {
    return true;
  }

  /**
   * Fetch news for specific stock symbols
   */
  async fetchStockNews(symbols: string | string[], language: string = 'en'): Promise<MarketauxNewsItem[]> {
    if (!this.isConfigured()) {
      return [];
    }

    try {
      const symbolParam = Array.isArray(symbols) ? symbols.join(',') : symbols;
      const url = new URL(`${MARKETAUX_API_BASE}/news`, window.location.origin);
      url.searchParams.set('symbols', symbolParam);
      url.searchParams.set('language', language);
      url.searchParams.set('limit', '15');

      const response = await fetch(url.toString(), { headers: { ...getAuthHeaders() } });
      
      if (!response.ok) {
        log.error(`Marketaux error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return (data.items || []).map((item: MarketauxNewsItem) => {
        const sentimentValue = Number(item.sentiment);
        return {
          ...item,
          sentimentScore: !isNaN(sentimentValue) ? sentimentValue : undefined,
        };
      });
    } catch (error) {
      log.error('Marketaux fetch error:', error);
      return [];
    }
  }

  /**
   * Fetch general market news
   */
  async fetchMarketNews(language: string = 'en'): Promise<MarketauxNewsItem[]> {
    if (!this.isConfigured()) {
      return [];
    }

    try {
      const url = new URL(`${MARKETAUX_API_BASE}/news`, window.location.origin);
      url.searchParams.set('language', language);
      url.searchParams.set('limit', '20');

      const response = await fetch(url.toString(), { headers: { ...getAuthHeaders() } });
      
      if (!response.ok) {
        log.error(`Marketaux error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      log.error('Marketaux market news fetch error:', error);
      return [];
    }
  }

  /**
   * Fetch German finance news
   */
  async fetchGermanNews(symbols?: string | string[]): Promise<MarketauxNewsItem[]> {
    return this.fetchStockNews(symbols || '', 'de');
  }
}

// Factory function
export function createMarketauxProvider(_apiKey?: string): MarketauxProvider {
  return new MarketauxProvider();
}
