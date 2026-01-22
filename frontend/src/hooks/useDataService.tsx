/**
 * React Hooks for Data Service
 * 
 * Provides React hooks for fetching stock data, quotes, and news
 * using the unified data service.
 */

import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import type { StockData } from '../types/stock';
import type { QuoteData, NewsItem, DataSourceType, StockSearchResult } from '../services/types';
import { DataService, type DataServiceConfig } from '../services/dataService';

// Context for sharing data service configuration
interface DataServiceContextValue {
  config: DataServiceConfig;
  setConfig: (config: DataServiceConfig) => void;
  dataService: DataService;
  availableSources: DataSourceType[];
  preferredSource: DataSourceType;
  setPreferredSource: (source: DataSourceType) => void;
}

const DataServiceContext = createContext<DataServiceContextValue | null>(null);

// Get environment variables for API keys
function getEnvConfig(): DataServiceConfig {
  return {
    finnhubApiKey: import.meta.env.VITE_FINNHUB_API_KEY as string | undefined,
    alphaVantageApiKey: import.meta.env.VITE_ALPHA_VANTAGE_API_KEY as string | undefined,
    twelveDataApiKey: import.meta.env.VITE_TWELVE_DATA_API_KEY as string | undefined,
    newsApiKey: import.meta.env.VITE_NEWS_API_KEY as string | undefined,
    preferredSource: (import.meta.env.VITE_PREFERRED_DATA_SOURCE as DataSourceType) || 'mock',
  };
}

export function DataServiceProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<DataServiceConfig>(() => getEnvConfig());
  const [dataService, setDataService] = useState(() => new DataService(config));

  const setConfig = useCallback((newConfig: DataServiceConfig) => {
    setConfigState(newConfig);
    setDataService(new DataService(newConfig));
  }, []);

  const availableSources = useMemo(() => dataService.getAvailableSources(), [dataService]);
  const preferredSource = dataService.getPreferredSource();

  const setPreferredSource = useCallback((source: DataSourceType) => {
    dataService.setPreferredSource(source);
    // Force re-render by creating new service with same config
    setDataService(new DataService({ ...config, preferredSource: source }));
  }, [config, dataService]);

  const value = useMemo(() => ({
    config,
    setConfig,
    dataService,
    availableSources,
    preferredSource,
    setPreferredSource,
  }), [config, setConfig, dataService, availableSources, preferredSource, setPreferredSource]);

  return (
    <DataServiceContext.Provider value={value}>
      {children}
    </DataServiceContext.Provider>
  );
}

export function useDataService(): DataServiceContextValue {
  const context = useContext(DataServiceContext);
  if (!context) {
    throw new Error('useDataService must be used within a DataServiceProvider');
  }
  return context;
}

/**
 * Hook for fetching stock data
 */
export function useStockData(symbol: string, days: number = 365) {
  const { dataService, preferredSource } = useDataService();
  const [data, setData] = useState<StockData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [source, setSource] = useState<DataSourceType>('mock');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const stockData = await dataService.fetchStockData(symbol, days);
      setData(stockData);
      setSource(preferredSource);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch stock data'));
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [dataService, symbol, days, preferredSource]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refetch = useCallback(() => {
    dataService.clearCache();
    fetchData();
  }, [dataService, fetchData]);

  return { data, isLoading, error, source, refetch };
}

/**
 * Hook for fetching real-time quote
 */
export function useQuote(symbol: string, refreshInterval: number = 60000) {
  const { dataService, preferredSource } = useDataService();
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchQuote = useCallback(async () => {
    try {
      const quoteData = await dataService.fetchQuote(symbol);
      setQuote(quoteData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch quote'));
    } finally {
      setIsLoading(false);
    }
  }, [dataService, symbol]);

  useEffect(() => {
    fetchQuote();

    // Set up refresh interval if not using mock data
    if (preferredSource !== 'mock' && refreshInterval > 0) {
      const interval = setInterval(fetchQuote, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchQuote, preferredSource, refreshInterval]);

  return { quote, isLoading, error, refetch: fetchQuote };
}

/**
 * Hook for fetching news
 */
export function useNews(symbol: string) {
  const { dataService } = useDataService();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchNews = useCallback(async () => {
    setIsLoading(true);
    try {
      const newsData = await dataService.fetchNews(symbol);
      setNews(newsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch news'));
    } finally {
      setIsLoading(false);
    }
  }, [dataService, symbol]);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  return { news, isLoading, error, refetch: fetchNews };
}

/**
 * Hook for searching symbols
 */
export function useSymbolSearch() {
  const { dataService } = useDataService();
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const search = useCallback(async (query: string) => {
    if (!query || query.length < 1) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    try {
      const searchResults = await dataService.searchSymbols(query);
      setResults(searchResults);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to search'));
    } finally {
      setIsLoading(false);
    }
  }, [dataService]);

  const clear = useCallback(() => {
    setResults([]);
  }, []);

  return { results, isLoading, error, search, clear };
}
