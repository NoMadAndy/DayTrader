/**
 * NewsData.io News Provider
 * 
 * Multi-source news aggregator with category filters and multi-language support.
 * Provides business news with comprehensive filtering options.
 * 
 * API Documentation: https://newsdata.io/documentation
 */

import type { NewsItem } from './types';

// Backend proxy endpoint
const NEWSDATA_API_BASE = '/api/newsdata';

export class NewsdataProvider {
  name = 'NewsData.io';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  /**
   * Fetch news for specific stock symbols
   */
  async fetchStockNews(symbol: string): Promise<NewsItem[]> {
    if (!this.isConfigured()) {
      return [];
    }

    try {
      const url = new URL(`${NEWSDATA_API_BASE}/news`, window.location.origin);
      url.searchParams.set('apiKey', this.apiKey);
      url.searchParams.set('q', symbol);
      url.searchParams.set('language', 'en');
      url.searchParams.set('category', 'business');

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        console.error(`NewsData.io error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.articles || [];
    } catch (error) {
      console.error('NewsData.io fetch error:', error);
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
      const url = new URL(`${NEWSDATA_API_BASE}/news`, window.location.origin);
      url.searchParams.set('apiKey', this.apiKey);
      url.searchParams.set('q', 'stock OR market OR finance');
      url.searchParams.set('language', 'en');
      url.searchParams.set('category', 'business');

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        console.error(`NewsData.io error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.articles || [];
    } catch (error) {
      console.error('NewsData.io market news fetch error:', error);
      return [];
    }
  }
}

// Factory function
export function createNewsdataProvider(apiKey: string): NewsdataProvider {
  return new NewsdataProvider(apiKey);
}
