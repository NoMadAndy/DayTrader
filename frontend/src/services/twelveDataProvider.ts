/**
 * Twelve Data Provider
 * 
 * A reliable free-tier stock data API with good coverage.
 * 
 * API Documentation: https://twelvedata.com/docs
 * 
 * Endpoints used:
 * - /quote: Real-time quote
 * - /time_series: OHLCV data
 * - /symbol_search: Symbol search
 */

import type { OHLCV } from '../types/stock';
import type { DataProvider, QuoteData, StockSearchResult } from './types';

const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com';

export class TwelveDataProvider implements DataProvider {
  name = 'Twelve Data';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  private async fetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
    try {
      const url = new URL(`${TWELVE_DATA_BASE_URL}${endpoint}`);
      url.searchParams.set('apikey', this.apiKey);
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        console.error(`Twelve Data API error: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      
      // Check for error status
      if (data.status === 'error') {
        console.error('Twelve Data API error:', data.message);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Twelve Data fetch error:', error);
      return null;
    }
  }

  async fetchQuote(symbol: string): Promise<QuoteData | null> {
    interface TwelveDataQuote {
      symbol: string;
      name: string;
      exchange: string;
      currency: string;
      datetime: string;
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
      previous_close: string;
      change: string;
      percent_change: string;
    }

    const data = await this.fetch<TwelveDataQuote>('/quote', { symbol });

    if (!data || !data.close) {
      return null;
    }

    return {
      symbol: data.symbol,
      price: parseFloat(data.close),
      change: parseFloat(data.change),
      changePercent: parseFloat(data.percent_change),
      high: parseFloat(data.high),
      low: parseFloat(data.low),
      open: parseFloat(data.open),
      previousClose: parseFloat(data.previous_close),
      volume: parseInt(data.volume, 10),
      timestamp: new Date(data.datetime).getTime()
    };
  }

  async fetchCandles(symbol: string, days: number = 365): Promise<OHLCV[] | null> {
    interface TwelveDataTimeSeries {
      meta: {
        symbol: string;
        interval: string;
      };
      values: Array<{
        datetime: string;
        open: string;
        high: string;
        low: string;
        close: string;
        volume: string;
      }>;
    }

    const data = await this.fetch<TwelveDataTimeSeries>('/time_series', {
      symbol,
      interval: '1day',
      outputsize: days.toString()
    });

    if (!data || !data.values || data.values.length === 0) {
      return null;
    }

    // Twelve Data returns newest first, we need oldest first
    const candles: OHLCV[] = data.values
      .map(item => ({
        time: Math.floor(new Date(item.datetime).getTime() / 1000),
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        close: parseFloat(item.close),
        volume: parseInt(item.volume, 10)
      }))
      .reverse();

    return candles;
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    interface TwelveDataSearch {
      data: Array<{
        symbol: string;
        instrument_name: string;
        exchange: string;
        exchange_timezone: string;
        instrument_type: string;
        country: string;
      }>;
    }

    const data = await this.fetch<TwelveDataSearch>('/symbol_search', {
      symbol: query
    });

    if (!data || !data.data) {
      return [];
    }

    return data.data
      .filter(item => item.instrument_type === 'Common Stock')
      .slice(0, 10)
      .map(item => ({
        symbol: item.symbol,
        name: item.instrument_name,
        type: item.instrument_type,
        exchange: item.exchange
      }));
  }
}
