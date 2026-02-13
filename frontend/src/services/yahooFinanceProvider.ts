/**
 * Yahoo Finance Data Provider (via backend proxy)
 * 
 * Uses the backend proxy server to fetch data from Yahoo Finance,
 * avoiding CORS issues in the browser.
 * 
 * No API key required.
 */

import type { OHLCV } from '../types/stock';
import type { DataProvider, QuoteData, StockSearchResult } from './types';
import { log } from '../utils/logger';

// Use backend proxy API endpoints (relative URLs work with nginx proxy in prod, vite proxy in dev)
const API_BASE_URL = '/api/yahoo';

export class YahooFinanceProvider implements DataProvider {
  name = 'Yahoo Finance';

  constructor(_options?: { useCorsProxy?: boolean; corsProxyUrl?: string }) {
    // Options are now ignored - we always use the backend proxy
  }

  isConfigured(): boolean {
    // Yahoo Finance doesn't require an API key
    return true;
  }

  private async fetch<T>(url: string): Promise<T | null> {
    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        }
      });
      
      if (!response.ok) {
        log.error(`Yahoo Finance API error: ${response.status} ${response.statusText}`);
        return null;
      }

      return await response.json();
    } catch (error) {
      log.warn('Yahoo Finance fetch error:', error);
      return null;
    }
  }

  async fetchQuote(symbol: string): Promise<QuoteData | null> {
    interface YahooChartResponse {
      chart: {
        result: Array<{
          meta: {
            symbol: string;
            regularMarketPrice: number;
            previousClose: number;
            regularMarketVolume: number;
            regularMarketTime: number;
            regularMarketDayHigh: number;
            regularMarketDayLow: number;
            regularMarketOpen: number;
          };
        }>;
        error: null | { code: string; description: string };
      };
    }

    const url = `${API_BASE_URL}/chart/${symbol}?interval=1d&range=1d`;
    const data = await this.fetch<YahooChartResponse>(url);

    if (!data || !data.chart.result || data.chart.result.length === 0) {
      return null;
    }

    const meta = data.chart.result[0].meta;
    const change = meta.regularMarketPrice - meta.previousClose;
    const changePercent = (change / meta.previousClose) * 100;

    return {
      symbol: meta.symbol,
      price: meta.regularMarketPrice,
      change,
      changePercent,
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      open: meta.regularMarketOpen,
      previousClose: meta.previousClose,
      volume: meta.regularMarketVolume,
      timestamp: meta.regularMarketTime * 1000
    };
  }

  async fetchCandles(symbol: string, days: number = 365): Promise<OHLCV[] | null> {
    interface YahooChartResponse {
      chart: {
        result: Array<{
          timestamp: number[];
          indicators: {
            quote: Array<{
              open: (number | null)[];
              high: (number | null)[];
              low: (number | null)[];
              close: (number | null)[];
              volume: (number | null)[];
            }>;
          };
        }>;
        error: null | { code: string; description: string };
      };
    }

    // Map days to Yahoo's range parameter
    let range = '1y';
    if (days <= 7) range = '5d';
    else if (days <= 30) range = '1mo';
    else if (days <= 90) range = '3mo';
    else if (days <= 180) range = '6mo';
    else if (days <= 365) range = '1y';
    else if (days <= 730) range = '2y';
    else range = '5y';

    const url = `${API_BASE_URL}/chart/${symbol}?interval=1d&range=${range}`;
    const data = await this.fetch<YahooChartResponse>(url);

    if (!data || !data.chart.result || data.chart.result.length === 0) {
      return null;
    }

    const result = data.chart.result[0];
    const { timestamp, indicators } = result;
    const quote = indicators.quote[0];

    if (!timestamp || !quote) {
      return null;
    }

    const candles: OHLCV[] = [];
    for (let i = 0; i < timestamp.length; i++) {
      const openVal = quote.open[i];
      const highVal = quote.high[i];
      const lowVal = quote.low[i];
      const closeVal = quote.close[i];
      
      // Skip if any value is null or undefined
      if (
        openVal === null || openVal === undefined ||
        highVal === null || highVal === undefined ||
        lowVal === null || lowVal === undefined ||
        closeVal === null || closeVal === undefined
      ) {
        continue;
      }

      candles.push({
        time: timestamp[i],
        open: openVal,
        high: highVal,
        low: lowVal,
        close: closeVal,
        volume: quote.volume[i] ?? 0
      });
    }

    return candles;
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    interface YahooSearchResponse {
      quotes: Array<{
        symbol: string;
        shortname: string;
        longname?: string;
        quoteType: string;
        exchange: string;
      }>;
    }

    const url = `${API_BASE_URL}/search?q=${encodeURIComponent(query)}`;
    const data = await this.fetch<YahooSearchResponse>(url);

    if (!data || !data.quotes) {
      return [];
    }

    return data.quotes
      .filter(item => item.quoteType === 'EQUITY')
      .map(item => ({
        symbol: item.symbol,
        name: item.longname || item.shortname,
        type: item.quoteType,
        exchange: item.exchange
      }));
  }
}
