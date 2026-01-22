/**
 * Unified Data Service
 * 
 * Orchestrates multiple data providers with automatic fallback.
 * Prioritizes providers based on availability and configuration.
 * 
 * Provider Priority (configurable):
 * 1. Finnhub (if API key available)
 * 2. Twelve Data (if API key available)
 * 3. Alpha Vantage (if API key available)
 * 4. Yahoo Finance (no key required, but may have CORS issues)
 * 5. Mock data (fallback)
 */

import type { StockData } from '../types/stock';
import type { DataProvider, QuoteData, NewsItem, DataSourceType, StockSearchResult } from './types';
import { FinnhubProvider } from './finnhubProvider';
import { AlphaVantageProvider } from './alphaVantageProvider';
import { TwelveDataProvider } from './twelveDataProvider';
import { YahooFinanceProvider } from './yahooFinanceProvider';
import { NewsApiProvider } from './newsApiProvider';
import { getStockData as getMockData, searchStocks as searchMockStocks } from '../utils/mockData';

// Stock name mappings for display
const STOCK_NAMES: Record<string, string> = {
  'AAPL': 'Apple Inc.',
  'GOOGL': 'Alphabet Inc.',
  'GOOG': 'Alphabet Inc.',
  'MSFT': 'Microsoft Corporation',
  'AMZN': 'Amazon.com Inc.',
  'TSLA': 'Tesla Inc.',
  'NVDA': 'NVIDIA Corporation',
  'META': 'Meta Platforms Inc.',
  'JPM': 'JPMorgan Chase & Co.',
  'V': 'Visa Inc.',
  'JNJ': 'Johnson & Johnson',
  'WMT': 'Walmart Inc.',
  'PG': 'Procter & Gamble Co.',
  'MA': 'Mastercard Inc.',
  'UNH': 'UnitedHealth Group Inc.',
  'HD': 'The Home Depot Inc.',
  'DIS': 'The Walt Disney Company',
  'BAC': 'Bank of America Corp.',
  'NFLX': 'Netflix Inc.',
  'ADBE': 'Adobe Inc.',
  'CRM': 'Salesforce Inc.',
  'PFE': 'Pfizer Inc.',
  'INTC': 'Intel Corporation',
  'AMD': 'Advanced Micro Devices Inc.',
};

export interface DataServiceConfig {
  finnhubApiKey?: string;
  alphaVantageApiKey?: string;
  twelveDataApiKey?: string;
  newsApiKey?: string;
  preferredSource?: DataSourceType;
  useCorsProxy?: boolean;
  corsProxyUrl?: string;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class DataService {
  private providers: Map<DataSourceType, DataProvider> = new Map();
  private newsProvider: NewsApiProvider | null = null;
  private preferredSource: DataSourceType;
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private cacheDuration = 60000; // 1 minute cache

  constructor(config: DataServiceConfig = {}) {
    this.preferredSource = config.preferredSource ?? 'mock';

    // Initialize providers based on available API keys
    if (config.finnhubApiKey) {
      this.providers.set('finnhub', new FinnhubProvider(config.finnhubApiKey));
    }
    
    if (config.alphaVantageApiKey) {
      this.providers.set('alphaVantage', new AlphaVantageProvider(config.alphaVantageApiKey));
    }
    
    if (config.twelveDataApiKey) {
      this.providers.set('twelveData', new TwelveDataProvider(config.twelveDataApiKey));
    }

    // Yahoo Finance doesn't require API key
    this.providers.set('yahoo', new YahooFinanceProvider({
      useCorsProxy: config.useCorsProxy,
      corsProxyUrl: config.corsProxyUrl
    }));

    if (config.newsApiKey) {
      this.newsProvider = new NewsApiProvider(config.newsApiKey);
    }
  }

  /**
   * Get available data sources
   */
  getAvailableSources(): DataSourceType[] {
    const sources: DataSourceType[] = ['mock'];
    
    this.providers.forEach((provider, source) => {
      if (provider.isConfigured()) {
        sources.push(source);
      }
    });

    return sources;
  }

  /**
   * Set preferred data source
   */
  setPreferredSource(source: DataSourceType): void {
    this.preferredSource = source;
  }

  /**
   * Get current preferred source
   */
  getPreferredSource(): DataSourceType {
    return this.preferredSource;
  }

  /**
   * Get provider priority order
   */
  private getProviderOrder(): DataSourceType[] {
    // If a specific source is preferred and available, use it first
    if (this.preferredSource !== 'mock' && this.providers.has(this.preferredSource)) {
      const order: DataSourceType[] = [this.preferredSource];
      this.providers.forEach((_, source) => {
        if (source !== this.preferredSource) {
          order.push(source);
        }
      });
      return order;
    }

    // Default order: finnhub -> twelveData -> alphaVantage -> yahoo
    return ['finnhub', 'twelveData', 'alphaVantage', 'yahoo'];
  }

  /**
   * Get cached data if available and not expired
   */
  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.cacheDuration) {
      return entry.data as T;
    }
    return null;
  }

  /**
   * Set cache entry
   */
  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Fetch real-time quote with fallback
   */
  async fetchQuote(symbol: string): Promise<QuoteData | null> {
    const cacheKey = `quote:${symbol}`;
    const cached = this.getCached<QuoteData>(cacheKey);
    if (cached) return cached;

    if (this.preferredSource === 'mock') {
      // Return mock quote
      const mockData = getMockData(symbol);
      if (mockData && mockData.data.length > 0) {
        const latest = mockData.data[mockData.data.length - 1];
        const previous = mockData.data[mockData.data.length - 2];
        const quote: QuoteData = {
          symbol,
          price: latest.close,
          change: latest.close - previous.close,
          changePercent: ((latest.close - previous.close) / previous.close) * 100,
          high: latest.high,
          low: latest.low,
          open: latest.open,
          previousClose: previous.close,
          volume: latest.volume,
          timestamp: latest.time * 1000
        };
        return quote;
      }
      return null;
    }

    // Try providers in order
    for (const source of this.getProviderOrder()) {
      const provider = this.providers.get(source);
      if (provider?.isConfigured()) {
        try {
          const quote = await provider.fetchQuote(symbol);
          if (quote) {
            this.setCache(cacheKey, quote);
            return quote;
          }
        } catch (error) {
          console.warn(`${source} quote fetch failed:`, error);
        }
      }
    }

    return null;
  }

  /**
   * Fetch historical candle data with fallback
   */
  async fetchStockData(symbol: string, days: number = 365): Promise<StockData | null> {
    const cacheKey = `candles:${symbol}:${days}`;
    const cached = this.getCached<StockData>(cacheKey);
    if (cached) return cached;

    // Use mock data if preferred or as fallback
    if (this.preferredSource === 'mock') {
      return getMockData(symbol, days);
    }

    // Try providers in order
    for (const source of this.getProviderOrder()) {
      const provider = this.providers.get(source);
      if (provider?.isConfigured()) {
        try {
          const candles = await provider.fetchCandles(symbol, days);
          if (candles && candles.length > 0) {
            const stockData: StockData = {
              symbol,
              name: STOCK_NAMES[symbol] || symbol,
              data: candles
            };
            this.setCache(cacheKey, stockData);
            return stockData;
          }
        } catch (error) {
          console.warn(`${source} candle fetch failed:`, error);
        }
      }
    }

    // Fallback to mock data
    console.log('All providers failed, falling back to mock data');
    return getMockData(symbol, days);
  }

  /**
   * Fetch news for a symbol
   */
  async fetchNews(symbol: string, companyName?: string): Promise<NewsItem[]> {
    const cacheKey = `news:${symbol}`;
    const cached = this.getCached<NewsItem[]>(cacheKey);
    if (cached) return cached;

    const allNews: NewsItem[] = [];

    // Try Finnhub news first
    const finnhub = this.providers.get('finnhub') as FinnhubProvider | undefined;
    if (finnhub?.isConfigured() && 'fetchNews' in finnhub) {
      try {
        const finnhubNews = await finnhub.fetchNews(symbol);
        allNews.push(...finnhubNews);
      } catch (error) {
        console.warn('Finnhub news fetch failed:', error);
      }
    }

    // Try NewsAPI
    if (this.newsProvider?.isConfigured()) {
      try {
        const newsApiNews = await this.newsProvider.fetchStockNews(
          symbol, 
          companyName || STOCK_NAMES[symbol]
        );
        allNews.push(...newsApiNews);
      } catch (error) {
        console.warn('NewsAPI fetch failed:', error);
      }
    }

    // Remove duplicates by headline
    const uniqueNews = allNews.filter((item, index, self) => 
      index === self.findIndex(t => t.headline === item.headline)
    );

    // Sort by date (newest first)
    uniqueNews.sort((a, b) => b.datetime - a.datetime);

    // Limit to 15 items
    const result = uniqueNews.slice(0, 15);
    this.setCache(cacheKey, result);
    
    return result;
  }

  /**
   * Search for stock symbols
   */
  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    if (!query || query.length < 1) {
      return [];
    }

    // If using mock data, use mock search
    if (this.preferredSource === 'mock') {
      return searchMockStocks(query).map(s => ({
        symbol: s.symbol,
        name: s.name
      }));
    }

    // Try providers in order
    for (const source of this.getProviderOrder()) {
      const provider = this.providers.get(source);
      if (provider?.isConfigured() && provider.searchSymbols) {
        try {
          const results = await provider.searchSymbols(query);
          if (results && results.length > 0) {
            return results;
          }
        } catch (error) {
          console.warn(`${source} search failed:`, error);
        }
      }
    }

    // Fallback to mock search
    return searchMockStocks(query).map(s => ({
      symbol: s.symbol,
      name: s.name
    }));
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Singleton instance with default config (uses mock data)
let dataServiceInstance: DataService | null = null;

/**
 * Get or create the data service singleton
 */
export function getDataService(config?: DataServiceConfig): DataService {
  if (!dataServiceInstance || config) {
    dataServiceInstance = new DataService(config);
  }
  return dataServiceInstance;
}

/**
 * Configure the data service with API keys
 */
export function configureDataService(config: DataServiceConfig): DataService {
  dataServiceInstance = new DataService(config);
  return dataServiceInstance;
}
