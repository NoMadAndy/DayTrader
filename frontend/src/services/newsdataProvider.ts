/**
 * NewsData.io News Provider
 * 
 * Multi-source news aggregator with category filters and multi-language support.
 * Provides business news with comprehensive filtering options.
 * 
 * API Documentation: https://newsdata.io/documentation
 */

import type { NewsItem } from './types';
import { log } from '../utils/logger';
import { getAuthHeaders } from './authService';

const NEWSDATA_API_BASE = '/api/newsdata';

export class NewsdataProvider {
  name = 'NewsData.io';

  constructor(_apiKey?: string) {}

  isConfigured(): boolean {
    return true;
  }

  async fetchStockNews(symbol: string): Promise<NewsItem[]> {
    try {
      const url = new URL(`${NEWSDATA_API_BASE}/news`, window.location.origin);
      url.searchParams.set('q', symbol);
      url.searchParams.set('language', 'en');
      url.searchParams.set('category', 'business');

      const response = await fetch(url.toString(), { headers: { ...getAuthHeaders() } });
      
      if (!response.ok) {
        log.error(`NewsData.io error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      log.error('NewsData.io fetch error:', error);
      return [];
    }
  }

  /**
   * Fetch general market news
   */
  async fetchMarketNews(): Promise<NewsItem[]> {
    try {
      const url = new URL(`${NEWSDATA_API_BASE}/news`, window.location.origin);
      url.searchParams.set('q', 'stock OR market OR finance');
      url.searchParams.set('language', 'en');
      url.searchParams.set('category', 'business');

      const response = await fetch(url.toString(), { headers: { ...getAuthHeaders() } });
      
      if (!response.ok) {
        log.error(`NewsData.io error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      log.error('NewsData.io market news fetch error:', error);
      return [];
    }
  }
}

export function createNewsdataProvider(_apiKey?: string): NewsdataProvider {
  return new NewsdataProvider();
}
