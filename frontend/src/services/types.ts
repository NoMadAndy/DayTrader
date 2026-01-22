/**
 * Types for data provider services
 */

import type { OHLCV } from '../types/stock';

export interface DataProviderConfig {
  apiKey?: string;
  enabled: boolean;
}

export interface DataProviderConfigs {
  finnhub: DataProviderConfig;
  alphaVantage: DataProviderConfig;
  twelveData: DataProviderConfig;
  newsApi: DataProviderConfig;
}

export interface QuoteData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  volume: number;
  timestamp: number;
}

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number;
  image?: string;
  related?: string[];
  sentiment?: 'positive' | 'negative' | 'neutral';
}

export interface DataProvider {
  name: string;
  isConfigured(): boolean;
  fetchQuote(symbol: string): Promise<QuoteData | null>;
  fetchCandles(symbol: string, days: number): Promise<OHLCV[] | null>;
  fetchNews?(symbol: string): Promise<NewsItem[]>;
  searchSymbols?(query: string): Promise<Array<{ symbol: string; name: string }>>;
}

export interface StockSearchResult {
  symbol: string;
  name: string;
  type?: string;
  exchange?: string;
}

export type DataSourceType = 'mock' | 'finnhub' | 'alphaVantage' | 'twelveData' | 'yahoo';
