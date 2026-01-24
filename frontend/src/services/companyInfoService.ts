/**
 * Company Information Service
 * 
 * Fetches detailed company information including:
 * - Name, Symbol
 * - WKN, ISIN (where available)
 * - Market Cap
 * - P/E Ratio (KGV)
 * - Dividend Yield
 * - Currency conversion (USD to EUR)
 */

const API_BASE = '/api';

export interface CompanyInfo {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  // Identifiers
  isin?: string;
  wkn?: string;
  // Financials in original currency (usually USD)
  priceUSD: number;
  priceEUR: number;
  marketCapUSD?: number;
  marketCapEUR?: number;
  peRatio?: number;          // KGV (Kurs-Gewinn-Verhältnis)
  forwardPE?: number;        // Forward P/E
  dividendYield?: number;    // in percent
  dividendRate?: number;     // annual dividend per share
  // Additional info
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  avgVolume?: number;
  volume?: number;
  beta?: number;
  // Change info
  changePercent: number;
  changeAbsolute: number;
}

// Cache for EUR/USD rate (refreshes every 5 minutes)
let cachedEurRate: { rate: number; timestamp: number } | null = null;
const RATE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get current EUR/USD exchange rate
 */
export async function getEurUsdRate(): Promise<number> {
  // Return cached rate if still valid
  if (cachedEurRate && Date.now() - cachedEurRate.timestamp < RATE_CACHE_DURATION) {
    return cachedEurRate.rate;
  }
  
  try {
    const response = await fetch(`${API_BASE}/forex/eurusd`);
    if (response.ok) {
      const data = await response.json();
      cachedEurRate = { rate: data.rate, timestamp: Date.now() };
      return data.rate;
    }
  } catch (error) {
    console.warn('Failed to fetch EUR/USD rate:', error);
  }
  
  // Fallback rate
  return 0.92;
}

/**
 * Fetch detailed company information using Yahoo Finance chart endpoint
 * (quoteSummary requires authentication, chart is publicly accessible)
 */
export async function fetchCompanyInfo(symbol: string): Promise<CompanyInfo | null> {
  try {
    // Use chart endpoint which contains meta data with company info
    const response = await fetch(`${API_BASE}/yahoo/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
    
    if (!response.ok) {
      console.error(`Failed to fetch company info for ${symbol}:`, response.status);
      return null;
    }
    
    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;
    
    if (!meta) {
      return null;
    }
    
    // Get EUR rate for conversion
    const eurRate = await getEurUsdRate();
    
    const currentPrice = meta.regularMarketPrice ?? 0;
    const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? currentPrice;
    const change = currentPrice - previousClose;
    const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;
    
    // Calculate rough market cap estimate if not provided (price * avg volume as proxy)
    // Note: This is a rough estimate; actual market cap would need additional API
    const volume = meta.regularMarketVolume ?? 0;
    
    return {
      symbol: meta.symbol || symbol,
      name: meta.longName || meta.shortName || symbol,
      currency: meta.currency || 'USD',
      exchange: meta.fullExchangeName || meta.exchangeName || '',
      
      // Price in both currencies
      priceUSD: currentPrice,
      priceEUR: currentPrice * eurRate,
      
      // Market cap - not available in chart endpoint, will show as undefined
      marketCapUSD: undefined,
      marketCapEUR: undefined,
      
      // Valuation metrics - not available in chart endpoint
      peRatio: undefined,
      forwardPE: undefined,
      dividendYield: undefined,
      dividendRate: undefined,
      
      // Additional info from chart meta
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      avgVolume: undefined,
      volume: volume,
      beta: undefined,
      
      // Change
      changePercent,
      changeAbsolute: change,
    };
  } catch (error) {
    console.error(`Error fetching company info for ${symbol}:`, error);
    return null;
  }
}

/**
 * Format market cap for display
 */
export function formatMarketCap(value?: number): string {
  if (!value) return '—';
  
  if (value >= 1e12) {
    return `${(value / 1e12).toFixed(2)} Bio.`;
  } else if (value >= 1e9) {
    return `${(value / 1e9).toFixed(2)} Mrd.`;
  } else if (value >= 1e6) {
    return `${(value / 1e6).toFixed(2)} Mio.`;
  }
  return value.toLocaleString('de-DE');
}

/**
 * Format currency value
 */
export function formatCurrency(value: number, currency: string = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format percentage value
 */
export function formatPercent(value?: number): string {
  if (value === undefined || value === null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/**
 * Format P/E ratio
 */
export function formatPE(value?: number): string {
  if (value === undefined || value === null) return '—';
  if (value < 0) return 'Negativ';
  return value.toFixed(1);
}

export default {
  fetchCompanyInfo,
  getEurUsdRate,
  formatMarketCap,
  formatCurrency,
  formatPercent,
  formatPE,
};
