/**
 * mediastack News Provider
 * 
 * Multi-language news API with simple REST interface.
 * Provides headline retrieval with multi-language support and keyword filtering.
 * 
 * API Documentation: https://mediastack.com/documentation
 */

import type { NewsItem } from './types';

// Backend proxy endpoint
const MEDIASTACK_API_BASE = '/api/mediastack';

export class MediastackProvider {
  name = 'MediaStack';
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
      const url = new URL(`${MEDIASTACK_API_BASE}/news`, window.location.origin);
      url.searchParams.set('apiKey', this.apiKey);
      url.searchParams.set('keywords', symbol);
      url.searchParams.set('language', 'en');
      url.searchParams.set('limit', '15');

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        console.error(`mediastack error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      console.error('mediastack fetch error:', error);
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
      const url = new URL(`${MEDIASTACK_API_BASE}/news`, window.location.origin);
      url.searchParams.set('apiKey', this.apiKey);
      url.searchParams.set('keywords', 'stock,market,finance,trading');
      url.searchParams.set('language', 'en');
      url.searchParams.set('limit', '20');

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        console.error(`mediastack error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      console.error('mediastack market news fetch error:', error);
      return [];
    }
  }
}

// Factory function
export function createMediastackProvider(apiKey: string): MediastackProvider {
  return new MediastackProvider(apiKey);
}
