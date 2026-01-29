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
 * 
 * Data Conservation Features:
 * - Per-provider rate limiting with quota tracking
 * - Intelligent caching with provider-specific TTLs
 * - Request deduplication for concurrent calls
 * - Automatic fallback when limits reached
 */

import type { StockData } from '../types/stock';
import type { DataProvider, QuoteData, NewsItem, DataSourceType, StockSearchResult } from './types';
import { FinnhubProvider } from './finnhubProvider';
import { AlphaVantageProvider } from './alphaVantageProvider';
import { TwelveDataProvider } from './twelveDataProvider';
import { YahooFinanceProvider } from './yahooFinanceProvider';
import { NewsApiProvider } from './newsApiProvider';
import { MarketauxProvider } from './marketauxProvider';
import { FMPProvider } from './fmpProvider';
import { TiingoProvider } from './tiingoProvider';
import { getRSSProvider, type RSSProvider } from './rssProvider';
import { getRateLimiter, PROVIDER_RATE_LIMITS, type RateLimiter } from './rateLimiter';

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
  // New provider API keys
  marketauxApiKey?: string;
  fmpApiKey?: string;
  tiingoApiKey?: string;
  enableRssFeeds?: boolean;
  preferredSource?: DataSourceType;
  useCorsProxy?: boolean;
  corsProxyUrl?: string;
  enableRateLimiting?: boolean;
}

export class DataService {
  private providers: Map<DataSourceType, DataProvider> = new Map();
  private newsProvider: NewsApiProvider | null = null;
  // New news providers
  private marketauxProvider: MarketauxProvider | null = null;
  private fmpProvider: FMPProvider | null = null;
  private tiingoProvider: TiingoProvider | null = null;
  private rssProvider: RSSProvider | null = null;
  private preferredSource: DataSourceType;
  private rateLimiter: RateLimiter;
  private enableRateLimiting: boolean;

  constructor(config: DataServiceConfig = {}) {
    this.preferredSource = config.preferredSource ?? 'yahoo';
    this.rateLimiter = getRateLimiter();
    this.enableRateLimiting = config.enableRateLimiting ?? true;

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

    // Initialize new news providers
    if (config.marketauxApiKey) {
      this.marketauxProvider = new MarketauxProvider(config.marketauxApiKey);
    }

    if (config.fmpApiKey) {
      this.fmpProvider = new FMPProvider(config.fmpApiKey);
    }

    if (config.tiingoApiKey) {
      this.tiingoProvider = new TiingoProvider(config.tiingoApiKey);
    }

    // RSS feeds don't require API key
    if (config.enableRssFeeds !== false) {
      this.rssProvider = getRSSProvider(true);
    }
  }

  /**
   * Get available data sources
   */
  getAvailableSources(): DataSourceType[] {
    const sources: DataSourceType[] = [];
    
    this.providers.forEach((provider, source) => {
      if (provider.isConfigured()) {
        sources.push(source);
      }
    });

    return sources;
  }

  /**
   * Get available news sources info
   */
  getAvailableNewsSources(): string[] {
    const sources: string[] = [];
    
    const finnhub = this.providers.get('finnhub');
    if (finnhub?.isConfigured()) {
      sources.push('Finnhub');
    }
    if (this.newsProvider?.isConfigured()) {
      sources.push('NewsAPI');
    }
    if (this.marketauxProvider?.isConfigured()) {
      sources.push('Marketaux');
    }
    if (this.fmpProvider?.isConfigured()) {
      sources.push('FMP');
    }
    if (this.tiingoProvider?.isConfigured()) {
      sources.push('Tiingo');
    }
    if (this.rssProvider?.isConfigured()) {
      sources.push('RSS Feeds (DE)');
    }

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
    if (this.providers.has(this.preferredSource)) {
      const order: DataSourceType[] = [this.preferredSource];
      this.providers.forEach((_, source) => {
        if (source !== this.preferredSource) {
          order.push(source);
        }
      });
      return order;
    }

    // Default order: yahoo -> finnhub -> twelveData -> alphaVantage (Yahoo requires no API key)
    return ['yahoo', 'finnhub', 'twelveData', 'alphaVantage'];
  }

  /**
   * Check rate limit and record request
   */
  private checkAndRecordRequest(source: DataSourceType, endpoint: string): boolean {
    if (!this.enableRateLimiting) {
      return true;
    }

    if (!this.rateLimiter.canMakeRequest(source)) {
      console.warn(`Rate limit reached for ${source}, will try fallback`);
      return false;
    }

    this.rateLimiter.recordRequest(source, endpoint);
    return true;
  }

  /**
   * Get rate limiter instance for external access
   */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  /**
   * Get quota info for all providers
   */
  getQuotaInfo(): Record<DataSourceType, { daily: number; perMinute: number; config: typeof PROVIDER_RATE_LIMITS[DataSourceType] }> {
    const result = {} as Record<DataSourceType, { daily: number; perMinute: number; config: typeof PROVIDER_RATE_LIMITS[DataSourceType] }>;
    for (const source of this.getProviderOrder()) {
      if (this.providers.get(source)?.isConfigured()) {
        const quota = this.rateLimiter.getRemainingQuota(source);
        result[source] = {
          ...quota,
          config: PROVIDER_RATE_LIMITS[source]
        };
      }
    }
    return result;
  }

  /**
   * Fetch real-time quote with fallback
   */
  async fetchQuote(symbol: string): Promise<QuoteData | null> {
    const cacheKey = `quote:${symbol}`;
    
    // Check cache first (using rate limiter's intelligent cache)
    const cached = this.rateLimiter.getCached<QuoteData>(cacheKey);
    if (cached) {
      console.log(`Cache hit for quote: ${symbol}`);
      return cached;
    }

    // Use request deduplication
    return this.rateLimiter.deduplicateRequest(cacheKey, async () => {
      // Try providers in order, respecting rate limits
      for (const source of this.getProviderOrder()) {
        const provider = this.providers.get(source);
        if (provider?.isConfigured()) {
          // Check if we can make a request
          if (!this.checkAndRecordRequest(source, `quote:${symbol}`)) {
            continue; // Try next provider
          }

          try {
            const quote = await provider.fetchQuote(symbol);
            if (quote) {
              this.rateLimiter.setCache(cacheKey, quote, source);
              return quote;
            }
          } catch (error) {
            console.warn(`${source} quote fetch failed:`, error);
          }
        }
      }

      return null;
    });
  }

  /**
   * Fetch historical candle data with fallback
   */
  async fetchStockData(symbol: string, days: number = 365): Promise<StockData | null> {
    const cacheKey = `candles:${symbol}:${days}`;
    
    // Historical data can be cached longer
    const cached = this.rateLimiter.getCached<StockData>(cacheKey);
    if (cached) {
      console.log(`Cache hit for candles: ${symbol}`);
      return cached;
    }

    // Use request deduplication
    return this.rateLimiter.deduplicateRequest(cacheKey, async () => {
      // Try providers in order, respecting rate limits
      for (const source of this.getProviderOrder()) {
        const provider = this.providers.get(source);
        if (provider?.isConfigured()) {
          // Check if we can make a request
          if (!this.checkAndRecordRequest(source, `candles:${symbol}`)) {
            continue; // Try next provider
          }

          try {
            const candles = await provider.fetchCandles(symbol, days);
            if (candles && candles.length > 0) {
              const stockData: StockData = {
                symbol,
                name: STOCK_NAMES[symbol] || symbol,
                data: candles
              };
              // Cache historical data longer (10 minutes for most providers)
              this.rateLimiter.setCacheWithDuration(cacheKey, stockData, source, 600000);
              return stockData;
            }
          } catch (error) {
            console.warn(`${source} candle fetch failed:`, error);
          }
        }
      }

      // All providers failed - return null (no fake data!)
      console.error('All providers failed for', symbol);
      return null;
    });
  }

  /**
   * Fetch news for a symbol
   */
  async fetchNews(symbol: string, companyName?: string): Promise<NewsItem[]> {
    const cacheKey = `news:${symbol}`;
    
    // News can be cached longer (5 minutes)
    const cached = this.rateLimiter.getCached<NewsItem[]>(cacheKey);
    if (cached) {
      console.log(`Cache hit for news: ${symbol}`);
      return cached;
    }

    return this.rateLimiter.deduplicateRequest(cacheKey, async () => {
      const allNews: NewsItem[] = [];
      const newsPromises: Promise<void>[] = [];

      // Try Finnhub news (backend caches for 5 minutes)
      const finnhub = this.providers.get('finnhub');
      if (finnhub?.isConfigured() && finnhub instanceof FinnhubProvider) {
        newsPromises.push(
          finnhub.fetchNews(symbol)
            .then(news => allNews.push(...news))
            .catch(error => console.warn('Finnhub news fetch failed:', error))
        );
      }

      // Try NewsAPI (rate-limited at 100 requests/day)
      if (this.newsProvider?.isConfigured()) {
        newsPromises.push(
          this.newsProvider.fetchStockNews(symbol, companyName || STOCK_NAMES[symbol])
            .then(news => allNews.push(...news))
            .catch(error => console.warn('NewsAPI fetch failed:', error))
        );
      }

      // Try Marketaux (multi-language, sentiment data)
      if (this.marketauxProvider?.isConfigured()) {
        newsPromises.push(
          this.marketauxProvider.fetchStockNews(symbol)
            .then(news => allNews.push(...news))
            .catch(error => console.warn('Marketaux fetch failed:', error))
        );
      }

      // Try FMP (ticker-specific news)
      if (this.fmpProvider?.isConfigured()) {
        newsPromises.push(
          this.fmpProvider.fetchStockNews(symbol)
            .then(news => allNews.push(...news))
            .catch(error => console.warn('FMP fetch failed:', error))
        );
      }

      // Try Tiingo (institutional-grade news)
      if (this.tiingoProvider?.isConfigured()) {
        newsPromises.push(
          this.tiingoProvider.fetchStockNews(symbol)
            .then(news => allNews.push(...news))
            .catch(error => console.warn('Tiingo fetch failed:', error))
        );
      }

      // Try RSS feeds (German news sources - general market news, not ticker-specific)
      // RSS feeds provide broader market context
      if (this.rssProvider?.isConfigured()) {
        newsPromises.push(
          this.rssProvider.fetchAllNews()
            .then(news => {
              // Add RSS news but don't relate to specific symbol unless mentioned
              const rssNews = news.map(item => ({
                ...item,
                related: item.headline.toUpperCase().includes(symbol) ? [symbol] : undefined
              }));
              allNews.push(...rssNews.slice(0, 10)); // Limit RSS items
            })
            .catch(error => console.warn('RSS feeds fetch failed:', error))
        );
      }

      // Wait for all providers to complete (with timeout)
      await Promise.all(newsPromises);

      // Remove duplicates by headline using Set for O(n) complexity
      const seenHeadlines = new Set<string>();
      const uniqueNews = allNews.filter((item) => {
        const normalizedHeadline = item.headline.toLowerCase().trim();
        if (seenHeadlines.has(normalizedHeadline)) {
          return false;
        }
        seenHeadlines.add(normalizedHeadline);
        return true;
      });

      // Sort by date (newest first)
      uniqueNews.sort((a, b) => b.datetime - a.datetime);

      // Limit to 20 items (increased to accommodate more sources)
      const result = uniqueNews.slice(0, 20);
      
      // Cache news for 5 minutes
      this.rateLimiter.setCacheWithDuration(cacheKey, result, 'finnhub', 300000);
      
      return result;
    });
  }

  /**
   * Search for stock symbols
   */
  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    if (!query || query.length < 1) {
      return [];
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

    // All providers failed - return empty (no fake data!)
    return [];
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.rateLimiter.clearCache();
  }

  /**
   * Reset rate limiter stats (for testing)
   */
  resetRateLimiterStats(): void {
    this.rateLimiter.resetStats();
  }
}

// Singleton instance with default config (uses Yahoo Finance)
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
