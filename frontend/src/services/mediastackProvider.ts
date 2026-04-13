/**
 * mediastack News Provider
 * 
 * Multi-language news API with simple REST interface.
 * Provides headline retrieval with multi-language support and keyword filtering.
 * 
 * API Documentation: https://mediastack.com/documentation
 */

import type { NewsItem } from './types';
import { log } from '../utils/logger';
import { getAuthHeaders } from './authService';

// Backend proxy endpoint
const MEDIASTACK_API_BASE = '/api/mediastack';

export class MediastackProvider {
  name = 'MediaStack';
  constructor(_apiKey?: string) {}

  isConfigured(): boolean {
    return true;
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
      url.searchParams.set('keywords', symbol);
      url.searchParams.set('language', 'en');
      url.searchParams.set('limit', '15');

      const response = await fetch(url.toString(), { headers: { ...getAuthHeaders() } });
      
      if (!response.ok) {
        log.error(`mediastack error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      log.error('mediastack fetch error:', error);
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
      url.searchParams.set('keywords', 'stock,market,finance,trading');
      url.searchParams.set('language', 'en');
      url.searchParams.set('limit', '20');

      const response = await fetch(url.toString(), { headers: { ...getAuthHeaders() } });
      
      if (!response.ok) {
        log.error(`mediastack error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      log.error('mediastack market news fetch error:', error);
      return [];
    }
  }
}

// Factory function
export function createMediastackProvider(_apiKey?: string): MediastackProvider {
  return new MediastackProvider();
}
