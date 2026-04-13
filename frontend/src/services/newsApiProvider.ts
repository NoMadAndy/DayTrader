/**
 * NewsAPI Provider for Financial News (via backend proxy)
 * 
 * Uses the backend proxy server to fetch news from NewsAPI,
 * because NewsAPI requires server-side requests for free tier.
 * 
 * API Documentation: https://newsapi.org/docs
 */

import type { NewsItem } from './types';
import { log } from '../utils/logger';
import { getAuthHeaders } from './authService';

const NEWS_API_PROXY_URL = '/api/news';

export class NewsApiProvider {
  name = 'NewsAPI';

  constructor(_apiKey?: string) {}

  isConfigured(): boolean {
    return true;
  }

  private async fetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
    try {
      const url = new URL(`${NEWS_API_PROXY_URL}${endpoint}`, window.location.origin);
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });

      const response = await fetch(url.toString(), { headers: { ...getAuthHeaders() } });
      
      if (!response.ok) {
        log.error(`NewsAPI error: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      
      if (data.status !== 'ok') {
        log.error('NewsAPI error:', data.message);
        return null;
      }

      return data;
    } catch (error) {
      log.error('NewsAPI fetch error:', error);
      return null;
    }
  }

  async fetchStockNews(symbol: string, companyName?: string): Promise<NewsItem[]> {
    interface NewsApiResponse {
      status: string;
      totalResults: number;
      articles: Array<{
        source: { id: string | null; name: string };
        author: string | null;
        title: string;
        description: string;
        url: string;
        urlToImage: string | null;
        publishedAt: string;
        content: string;
      }>;
    }

    // Search using symbol and optionally company name
    const searchQuery = companyName 
      ? `"${symbol}" OR "${companyName}"` 
      : `"${symbol}" stock`;

    const data = await this.fetch<NewsApiResponse>('/everything', {
      q: searchQuery,
      language: 'en',
      sortBy: 'publishedAt',
      pageSize: '10'
    });

    if (!data || !data.articles) {
      return [];
    }

    return data.articles.map((article, index) => ({
      id: `newsapi-${index}-${Date.now()}`,
      headline: article.title,
      summary: article.description || '',
      source: article.source.name,
      url: article.url,
      datetime: new Date(article.publishedAt).getTime(),
      image: article.urlToImage || undefined,
      related: [symbol]
    }));
  }

  async fetchMarketNews(category: string = 'business'): Promise<NewsItem[]> {
    interface NewsApiResponse {
      status: string;
      totalResults: number;
      articles: Array<{
        source: { id: string | null; name: string };
        author: string | null;
        title: string;
        description: string;
        url: string;
        urlToImage: string | null;
        publishedAt: string;
        content: string;
      }>;
    }

    const data = await this.fetch<NewsApiResponse>('/top-headlines', {
      category,
      language: 'en',
      pageSize: '10'
    });

    if (!data || !data.articles) {
      return [];
    }

    return data.articles.map((article, index) => ({
      id: `newsapi-market-${index}-${Date.now()}`,
      headline: article.title,
      summary: article.description || '',
      source: article.source.name,
      url: article.url,
      datetime: new Date(article.publishedAt).getTime(),
      image: article.urlToImage || undefined
    }));
  }
}
