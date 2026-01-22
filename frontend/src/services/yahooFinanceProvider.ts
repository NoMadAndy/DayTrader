/**
 * Yahoo Finance Data Provider (via public endpoints)
 * 
 * Uses Yahoo Finance's public chart API for stock data.
 * No API key required, but may have rate limits.
 * 
 * Note: This uses Yahoo's publicly available endpoints.
 * For production use, consider using official APIs.
 */

import type { OHLCV } from '../types/stock';
import type { DataProvider, QuoteData, StockSearchResult } from './types';

// CORS proxy may be needed in browser environment
// For production, use a backend proxy
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';

export class YahooFinanceProvider implements DataProvider {
  name = 'Yahoo Finance';
  private useCorsProxy: boolean;
  private corsProxyUrl: string;

  constructor(options?: { useCorsProxy?: boolean; corsProxyUrl?: string }) {
    this.useCorsProxy = options?.useCorsProxy ?? false;
    this.corsProxyUrl = options?.corsProxyUrl ?? '';
  }

  isConfigured(): boolean {
    // Yahoo Finance doesn't require an API key
    return true;
  }

  private buildUrl(baseUrl: string): string {
    if (this.useCorsProxy && this.corsProxyUrl) {
      return `${this.corsProxyUrl}${encodeURIComponent(baseUrl)}`;
    }
    return baseUrl;
  }

  private async fetch<T>(url: string): Promise<T | null> {
    try {
      const response = await fetch(this.buildUrl(url), {
        headers: {
          'Accept': 'application/json',
        }
      });
      
      if (!response.ok) {
        console.error(`Yahoo Finance API error: ${response.status} ${response.statusText}`);
        return null;
      }

      return await response.json();
    } catch (error) {
      // CORS errors are expected in browser without proxy
      console.warn('Yahoo Finance fetch error (CORS issue expected in browser):', error);
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

    const url = `${YAHOO_CHART_URL}/${symbol}?interval=1d&range=1d`;
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

    const url = `${YAHOO_CHART_URL}/${symbol}?interval=1d&range=${range}`;
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
      // Skip if any value is null
      if (
        quote.open[i] == null ||
        quote.high[i] == null ||
        quote.low[i] == null ||
        quote.close[i] == null
      ) {
        continue;
      }

      candles.push({
        time: timestamp[i],
        open: quote.open[i]!,
        high: quote.high[i]!,
        low: quote.low[i]!,
        close: quote.close[i]!,
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

    const url = `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
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
