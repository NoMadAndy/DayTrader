/**
 * Company Information Service
 * 
 * Aggregates company data from multiple providers:
 * - Yahoo Finance (basic price data, 52-week range)
 * - Finnhub (company profile, fundamentals)
 * - Alpha Vantage (overview data)
 * - Twelve Data (quote data)
 * 
 * Uses best available data from all sources.
 */

const API_BASE = '/api';

export interface CompanyInfo {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  country?: string;
  sector?: string;
  industry?: string;
  // Identifiers
  isin?: string;
  cusip?: string;
  // Financials in original currency (usually USD)
  priceUSD: number;
  priceEUR: number;
  marketCapUSD?: number;
  marketCapEUR?: number;
  peRatio?: number;          // KGV (Kurs-Gewinn-Verhältnis)
  forwardPE?: number;        // Forward P/E
  eps?: number;              // Earnings per share
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
  // Data source info
  dataSources: string[];
}

// Cache for EUR/USD rate (refreshes every 5 minutes)
let cachedEurRate: { rate: number; timestamp: number } | null = null;
const RATE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Cache for company info (refreshes every 2 minutes)
const companyInfoCache = new Map<string, { data: CompanyInfo; timestamp: number }>();
const INFO_CACHE_DURATION = 2 * 60 * 1000;

/**
 * Get current EUR/USD exchange rate
 */
export async function getEurUsdRate(): Promise<number> {
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
  
  return 0.92; // Fallback
}

/**
 * Get API keys from localStorage
 */
function getApiKeys(): { finnhub?: string; alphaVantage?: string; twelveData?: string } {
  try {
    const stored = localStorage.getItem('daytrader_api_keys');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore
  }
  return {};
}

/**
 * Fetch data from Yahoo Finance chart endpoint (basic price data)
 */
async function fetchYahooChartData(symbol: string): Promise<Partial<CompanyInfo> | null> {
  try {
    const response = await fetch(`${API_BASE}/yahoo/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
    if (!response.ok) return null;
    
    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    
    const currentPrice = meta.regularMarketPrice ?? 0;
    const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? currentPrice;
    const change = currentPrice - previousClose;
    const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;
    
    return {
      symbol: meta.symbol,
      name: meta.longName || meta.shortName,
      currency: meta.currency || 'USD',
      exchange: meta.fullExchangeName || meta.exchangeName,
      priceUSD: currentPrice,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      volume: meta.regularMarketVolume,
      changePercent,
      changeAbsolute: change,
    };
  } catch (error) {
    console.warn('Yahoo chart fetch error:', error);
    return null;
  }
}

/**
 * Fetch data from Yahoo Finance quote endpoint (includes market cap, PE, dividends)
 * NOTE: Yahoo has restricted this endpoint - may return 401/404
 * Fundamentals now primarily come from Finnhub or Alpha Vantage
 */
async function fetchYahooQuoteData(symbol: string): Promise<Partial<CompanyInfo> | null> {
  try {
    const response = await fetch(`${API_BASE}/yahoo/quote/${encodeURIComponent(symbol)}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    const quote = data?.quoteResponse?.result?.[0];
    if (!quote) return null;
    
    return {
      symbol: quote.symbol,
      name: quote.longName || quote.shortName,
      currency: quote.currency || 'USD',
      exchange: quote.fullExchangeName || quote.exchange,
      priceUSD: quote.regularMarketPrice,
      marketCapUSD: quote.marketCap,
      peRatio: quote.trailingPE,
      forwardPE: quote.forwardPE,
      eps: quote.epsTrailingTwelveMonths,
      dividendYield: quote.trailingAnnualDividendYield ? quote.trailingAnnualDividendYield * 100 : undefined,
      dividendRate: quote.trailingAnnualDividendRate,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
      volume: quote.regularMarketVolume,
      avgVolume: quote.averageDailyVolume10Day,
      changePercent: quote.regularMarketChangePercent,
      changeAbsolute: quote.regularMarketChange,
    };
  } catch {
    // Expected to fail - Yahoo has restricted this endpoint
    return null;
  }
}

/**
 * Fetch company profile from Finnhub
 */
async function fetchFinnhubProfile(symbol: string, apiKey: string): Promise<Partial<CompanyInfo> | null> {
  try {
    const response = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${apiKey}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data || !data.name) return null;
    
    return {
      name: data.name,
      country: data.country,
      exchange: data.exchange,
      industry: data.finnhubIndustry,
      marketCapUSD: data.marketCapitalization ? data.marketCapitalization * 1e6 : undefined, // Finnhub returns in millions
      isin: data.isin,
      cusip: data.cusip,
    };
  } catch (error) {
    console.warn('Finnhub profile error:', error);
    return null;
  }
}

/**
 * Fetch basic metrics from Finnhub
 */
async function fetchFinnhubMetrics(symbol: string, apiKey: string): Promise<Partial<CompanyInfo> | null> {
  try {
    const response = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${apiKey}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    const metrics = data?.metric;
    if (!metrics) return null;
    
    return {
      peRatio: metrics.peBasicExclExtraTTM || metrics.peExclExtraTTM,
      eps: metrics.epsBasicExclExtraItemsTTM,
      dividendYield: metrics.dividendYieldIndicatedAnnual,
      beta: metrics['beta'],
      fiftyTwoWeekHigh: metrics['52WeekHigh'],
      fiftyTwoWeekLow: metrics['52WeekLow'],
    };
  } catch (error) {
    console.warn('Finnhub metrics error:', error);
    return null;
  }
}

/**
 * Fetch quote from Finnhub
 */
async function fetchFinnhubQuote(symbol: string, apiKey: string): Promise<Partial<CompanyInfo> | null> {
  try {
    const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data || data.c === 0) return null;
    
    return {
      priceUSD: data.c,
      changeAbsolute: data.d,
      changePercent: data.dp,
    };
  } catch (error) {
    console.warn('Finnhub quote error:', error);
    return null;
  }
}

/**
 * Fetch from Alpha Vantage Overview
 */
async function fetchAlphaVantageOverview(symbol: string, apiKey: string): Promise<Partial<CompanyInfo> | null> {
  try {
    const response = await fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${apiKey}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data || data['Error Message'] || data['Note'] || !data.Symbol) return null;
    
    return {
      name: data.Name,
      exchange: data.Exchange,
      currency: data.Currency,
      country: data.Country,
      sector: data.Sector,
      industry: data.Industry,
      marketCapUSD: data.MarketCapitalization ? parseFloat(data.MarketCapitalization) : undefined,
      peRatio: data.PERatio && data.PERatio !== 'None' ? parseFloat(data.PERatio) : undefined,
      forwardPE: data.ForwardPE && data.ForwardPE !== 'None' ? parseFloat(data.ForwardPE) : undefined,
      eps: data.EPS && data.EPS !== 'None' ? parseFloat(data.EPS) : undefined,
      dividendYield: data.DividendYield && data.DividendYield !== 'None' ? parseFloat(data.DividendYield) * 100 : undefined,
      beta: data.Beta && data.Beta !== 'None' ? parseFloat(data.Beta) : undefined,
      fiftyTwoWeekHigh: data['52WeekHigh'] ? parseFloat(data['52WeekHigh']) : undefined,
      fiftyTwoWeekLow: data['52WeekLow'] ? parseFloat(data['52WeekLow']) : undefined,
    };
  } catch (error) {
    console.warn('Alpha Vantage overview error:', error);
    return null;
  }
}

/**
 * Fetch from Twelve Data quote
 */
async function fetchTwelveDataQuote(symbol: string, apiKey: string): Promise<Partial<CompanyInfo> | null> {
  try {
    const response = await fetch(`https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${apiKey}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data || data.status === 'error' || !data.close) return null;
    
    const price = parseFloat(data.close);
    const change = parseFloat(data.change);
    const changePercent = parseFloat(data.percent_change);
    
    return {
      name: data.name,
      exchange: data.exchange,
      currency: data.currency,
      priceUSD: price,
      changeAbsolute: change,
      changePercent,
      volume: data.volume ? parseInt(data.volume) : undefined,
    };
  } catch (error) {
    console.warn('Twelve Data quote error:', error);
    return null;
  }
}

/**
 * Fetch and aggregate company information from all available providers
 */
export async function fetchCompanyInfo(symbol: string): Promise<CompanyInfo | null> {
  // Check cache first
  const cached = companyInfoCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < INFO_CACHE_DURATION) {
    return cached.data;
  }
  
  const apiKeys = getApiKeys();
  const dataSources: string[] = [];
  
  // Start Yahoo fetches in parallel (quote for fundamentals, chart for backup price data)
  const [yahooQuoteData, yahooChartData, eurRate] = await Promise.all([
    fetchYahooQuoteData(symbol),
    fetchYahooChartData(symbol),
    getEurUsdRate(),
  ]);
  
  if (yahooQuoteData || yahooChartData) dataSources.push('Yahoo');
  
  // Fetch from other providers if API keys are available
  const additionalFetches: Promise<Partial<CompanyInfo> | null>[] = [];
  
  if (apiKeys.finnhub) {
    additionalFetches.push(
      fetchFinnhubProfile(symbol, apiKeys.finnhub),
      fetchFinnhubMetrics(symbol, apiKeys.finnhub),
      fetchFinnhubQuote(symbol, apiKeys.finnhub)
    );
  }
  
  if (apiKeys.alphaVantage) {
    additionalFetches.push(fetchAlphaVantageOverview(symbol, apiKeys.alphaVantage));
  }
  
  if (apiKeys.twelveData) {
    additionalFetches.push(fetchTwelveDataQuote(symbol, apiKeys.twelveData));
  }
  
  const additionalResults = await Promise.all(additionalFetches);
  
  // Track which sources provided data
  let finnhubIdx = 0;
  if (apiKeys.finnhub) {
    if (additionalResults[finnhubIdx] || additionalResults[finnhubIdx + 1] || additionalResults[finnhubIdx + 2]) {
      dataSources.push('Finnhub');
    }
    finnhubIdx += 3;
  }
  if (apiKeys.alphaVantage && additionalResults[finnhubIdx]) {
    dataSources.push('Alpha Vantage');
    finnhubIdx += 1;
  }
  if (apiKeys.twelveData && additionalResults[finnhubIdx]) {
    dataSources.push('Twelve Data');
  }
  
  // Merge all data, preferring non-null values
  // Priority: Finnhub profile > Alpha Vantage > Yahoo > Twelve Data for names
  // Priority: Finnhub metrics > Alpha Vantage > Yahoo for fundamentals
  // Priority: Yahoo > Finnhub > Twelve Data for current price (most reliable free source)
  
  const merged: Partial<CompanyInfo> = {};
  
  // Helper to set value if not already set
  const setIfMissing = <K extends keyof CompanyInfo>(key: K, value: CompanyInfo[K] | undefined | null) => {
    if (value !== undefined && value !== null && merged[key] === undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  };
  
  // Apply Yahoo quote data first (best source for fundamentals like market cap, PE, dividends)
  if (yahooQuoteData) {
    Object.entries(yahooQuoteData).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        (merged as Record<string, unknown>)[key] = value;
      }
    });
  }
  
  // Apply Yahoo chart data as fallback for basic price data
  if (yahooChartData) {
    Object.entries(yahooChartData).forEach(([key, value]) => {
      if (value !== undefined && value !== null && merged[key as keyof CompanyInfo] === undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    });
  }
  
  // Apply additional results (will override with better data where available)
  additionalResults.forEach(result => {
    if (result) {
      // Name: prefer longer, more descriptive names
      if (result.name && (!merged.name || result.name.length > (merged.name?.length || 0))) {
        merged.name = result.name;
      }
      
      // Other fields: set if missing
      setIfMissing('country', result.country);
      setIfMissing('sector', result.sector);
      setIfMissing('industry', result.industry);
      setIfMissing('isin', result.isin);
      setIfMissing('cusip', result.cusip);
      setIfMissing('marketCapUSD', result.marketCapUSD);
      setIfMissing('peRatio', result.peRatio);
      setIfMissing('forwardPE', result.forwardPE);
      setIfMissing('eps', result.eps);
      setIfMissing('dividendYield', result.dividendYield);
      setIfMissing('dividendRate', result.dividendRate);
      setIfMissing('beta', result.beta);
      setIfMissing('avgVolume', result.avgVolume);
      
      // 52-week range: prefer values if not set
      setIfMissing('fiftyTwoWeekHigh', result.fiftyTwoWeekHigh);
      setIfMissing('fiftyTwoWeekLow', result.fiftyTwoWeekLow);
      
      // Exchange: prefer more descriptive
      if (result.exchange && (!merged.exchange || result.exchange.length > (merged.exchange?.length || 0))) {
        merged.exchange = result.exchange;
      }
    }
  });
  
  // Ensure we have at least basic data
  if (!merged.priceUSD && merged.priceUSD !== 0) {
    return null;
  }
  
  // Calculate EUR values
  const priceUSD = merged.priceUSD || 0;
  const priceEUR = priceUSD * eurRate;
  const marketCapEUR = merged.marketCapUSD ? merged.marketCapUSD * eurRate : undefined;
  
  const result: CompanyInfo = {
    symbol,
    name: merged.name || symbol,
    currency: merged.currency || 'USD',
    exchange: merged.exchange || '',
    country: merged.country,
    sector: merged.sector,
    industry: merged.industry,
    isin: merged.isin,
    cusip: merged.cusip,
    priceUSD,
    priceEUR,
    marketCapUSD: merged.marketCapUSD,
    marketCapEUR,
    peRatio: merged.peRatio,
    forwardPE: merged.forwardPE,
    eps: merged.eps,
    dividendYield: merged.dividendYield,
    dividendRate: merged.dividendRate,
    fiftyTwoWeekHigh: merged.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: merged.fiftyTwoWeekLow,
    avgVolume: merged.avgVolume,
    volume: merged.volume,
    beta: merged.beta,
    changePercent: merged.changePercent || 0,
    changeAbsolute: merged.changeAbsolute || 0,
    dataSources,
  };
  
  // Cache result
  companyInfoCache.set(symbol, { data: result, timestamp: Date.now() });
  
  return result;
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
