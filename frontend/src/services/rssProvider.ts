/**
 * RSS Feed Provider for German Financial News
 * 
 * Fetches news from German financial RSS feeds via the backend proxy.
 * Supports Börse Frankfurt, BaFin, ECB, and Deutsche Bundesbank feeds.
 */

import type { NewsItem } from './types';
import { log } from '../utils/logger';

// Backend RSS API endpoints
const RSS_API_BASE = '/api/rss';

export interface RSSFeedConfig {
  id: string;
  name: string;
  language: 'de' | 'en';
  category: 'market' | 'regulatory' | 'macro';
}

export interface RSSNewsItem extends NewsItem {
  feedId?: string;
  category?: string;
  language?: string;
}

export class RSSProvider {
  name = 'RSS Feeds';
  private enabled: boolean;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  isConfigured(): boolean {
    // RSS feeds don't require API keys
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Get available RSS feed configurations
   */
  async getAvailableFeeds(): Promise<RSSFeedConfig[]> {
    try {
      const response = await fetch(`${RSS_API_BASE}/feeds`);
      if (!response.ok) {
        log.error('Failed to fetch RSS feeds config');
        return [];
      }
      const data = await response.json();
      return data.feeds || [];
    } catch (error) {
      log.error('RSS feeds config error:', error);
      return [];
    }
  }

  /**
   * Fetch news from a specific RSS feed
   */
  async fetchFeedNews(feedId: string): Promise<RSSNewsItem[]> {
    if (!this.enabled) {
      return [];
    }

    try {
      const response = await fetch(`${RSS_API_BASE}/feed/${feedId}`);
      
      if (!response.ok) {
        log.error(`RSS feed ${feedId} error: ${response.status}`);
        return [];
      }
      
      const data = await response.json();
      return (data.items || []).map((item: RSSNewsItem) => ({
        ...item,
        feedId,
      }));
    } catch (error) {
      log.error(`RSS feed ${feedId} fetch error:`, error);
      return [];
    }
  }

  /**
   * Fetch news from all RSS feeds
   */
  async fetchAllNews(): Promise<RSSNewsItem[]> {
    if (!this.enabled) {
      return [];
    }

    try {
      const response = await fetch(`${RSS_API_BASE}/all`);
      
      if (!response.ok) {
        log.error(`RSS all feeds error: ${response.status}`);
        return [];
      }
      
      const data = await response.json();
      return data.items || [];
    } catch (error) {
      log.error('RSS all feeds fetch error:', error);
      return [];
    }
  }

  /**
   * Fetch German market news (Börse Frankfurt)
   */
  async fetchGermanMarketNews(): Promise<RSSNewsItem[]> {
    return this.fetchFeedNews('boerse-frankfurt');
  }

  /**
   * Fetch regulatory news (BaFin)
   */
  async fetchRegulatoryNews(): Promise<RSSNewsItem[]> {
    return this.fetchFeedNews('bafin');
  }

  /**
   * Fetch ECB/macro news
   */
  async fetchMacroNews(): Promise<RSSNewsItem[]> {
    const [ecbNews, bundesbankNews] = await Promise.all([
      this.fetchFeedNews('ecb'),
      this.fetchFeedNews('bundesbank')
    ]);
    
    // Combine and sort by datetime
    return [...ecbNews, ...bundesbankNews]
      .sort((a, b) => b.datetime - a.datetime);
  }
}

// Singleton instance
let rssProviderInstance: RSSProvider | null = null;

export function getRSSProvider(enabled?: boolean): RSSProvider {
  if (!rssProviderInstance) {
    rssProviderInstance = new RSSProvider(enabled ?? true);
  } else if (enabled !== undefined) {
    rssProviderInstance.setEnabled(enabled);
  }
  return rssProviderInstance;
}
