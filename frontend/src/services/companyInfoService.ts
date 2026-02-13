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

import { formatCurrencyValue as formatFromSettings } from '../contexts';
import { log } from '../utils/logger';

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
  wkn?: string;              // German WKN identifier
  // Instrument type info
  instrumentType?: 'stock' | 'etf' | 'warrant' | 'certificate' | 'future' | 'cfd' | 'option' | 'bond' | 'unknown';
  instrumentTypeLabel?: string;  // Human-readable label
  // Derivative-specific properties
  leverage?: number;         // Hebel for warrants/certificates
  knockoutLevel?: number;    // Knock-out barrier
  strikePrice?: number;      // Strike price for options/warrants
  expirationDate?: string;   // Expiration date
  underlyingSymbol?: string; // Underlying asset symbol
  // Cost info (for CFDs etc.)
  overnightFee?: number;     // Overnight financing fee in %
  spreadPercent?: number;    // Typical spread in %
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
    log.warn('Failed to fetch EUR/USD rate:', error);
  }
  
  return 0.92; // Fallback
}

/**
 * Get API keys from localStorage
 * Reads from 'daytrader_api_config' which is the same storage used by ApiConfigPanel
 */
function getApiKeys(): { finnhub?: string; alphaVantage?: string; twelveData?: string } {
  try {
    const stored = localStorage.getItem('daytrader_api_config');
    if (stored) {
      const config = JSON.parse(stored);
      return {
        finnhub: config.finnhubApiKey || undefined,
        alphaVantage: config.alphaVantageApiKey || undefined,
        twelveData: config.twelveDataApiKey || undefined,
      };
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
    log.warn('Yahoo chart fetch error:', error);
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
 * Fetch company profile from Finnhub (via backend proxy with shared caching)
 */
async function fetchFinnhubProfile(symbol: string, apiKey: string): Promise<Partial<CompanyInfo> | null> {
  try {
    const response = await fetch(`/api/finnhub/profile/${encodeURIComponent(symbol)}`, {
      headers: { 'X-Finnhub-Token': apiKey }
    });
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
    log.warn('Finnhub profile error:', error);
    return null;
  }
}

/**
 * Fetch basic metrics from Finnhub (via backend proxy with shared caching)
 */
async function fetchFinnhubMetrics(symbol: string, apiKey: string): Promise<Partial<CompanyInfo> | null> {
  try {
    const response = await fetch(`/api/finnhub/metrics/${encodeURIComponent(symbol)}`, {
      headers: { 'X-Finnhub-Token': apiKey }
    });
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
    log.warn('Finnhub metrics error:', error);
    return null;
  }
}

/**
 * Fetch quote from Finnhub (via backend proxy with shared caching)
 */
async function fetchFinnhubQuote(symbol: string, apiKey: string): Promise<Partial<CompanyInfo> | null> {
  try {
    const response = await fetch(`/api/finnhub/quote/${encodeURIComponent(symbol)}`, {
      headers: { 'X-Finnhub-Token': apiKey }
    });
    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data || data.c === 0) return null;
    
    return {
      priceUSD: data.c,
      changeAbsolute: data.d,
      changePercent: data.dp,
    };
  } catch (error) {
    log.warn('Finnhub quote error:', error);
    return null;
  }
}

/**
 * Fetch from Alpha Vantage Overview (via backend proxy with shared caching)
 */
async function fetchAlphaVantageOverview(symbol: string, apiKey: string): Promise<Partial<CompanyInfo> | null> {
  try {
    const response = await fetch(`/api/alphavantage/overview/${encodeURIComponent(symbol)}`, {
      headers: { 'X-AlphaVantage-Key': apiKey }
    });
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
    log.warn('Alpha Vantage overview error:', error);
    return null;
  }
}

/**
 * Fetch from Twelve Data quote (via backend proxy with shared caching)
 */
async function fetchTwelveDataQuote(symbol: string, apiKey: string): Promise<Partial<CompanyInfo> | null> {
  try {
    const response = await fetch(`/api/twelvedata/quote/${encodeURIComponent(symbol)}`, {
      headers: { 'X-TwelveData-Key': apiKey }
    });
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
    log.warn('Twelve Data quote error:', error);
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
  
  // Debug: Log which API keys are available
  log.info(`[CompanyInfo] Fetching ${symbol}, API keys available:`, {
    finnhub: !!apiKeys.finnhub,
    alphaVantage: !!apiKeys.alphaVantage,
    twelveData: !!apiKeys.twelveData,
  });
  
  // Start Yahoo fetches in parallel (quote for fundamentals, chart for backup price data)
  const [yahooQuoteData, yahooChartData, eurRate] = await Promise.all([
    fetchYahooQuoteData(symbol),
    fetchYahooChartData(symbol),
    getEurUsdRate(),
  ]);
  
  if (yahooQuoteData || yahooChartData) dataSources.push('Yahoo');
  
  // Fetch from other providers if API keys are available
  const additionalFetches: Promise<Partial<CompanyInfo> | null>[] = [];
  const fetchLabels: string[] = [];
  
  if (apiKeys.finnhub) {
    additionalFetches.push(
      fetchFinnhubProfile(symbol, apiKeys.finnhub),
      fetchFinnhubMetrics(symbol, apiKeys.finnhub),
      fetchFinnhubQuote(symbol, apiKeys.finnhub)
    );
    fetchLabels.push('Finnhub Profile', 'Finnhub Metrics', 'Finnhub Quote');
  }
  
  if (apiKeys.alphaVantage) {
    additionalFetches.push(fetchAlphaVantageOverview(symbol, apiKeys.alphaVantage));
    fetchLabels.push('Alpha Vantage Overview');
  }
  
  if (apiKeys.twelveData) {
    additionalFetches.push(fetchTwelveDataQuote(symbol, apiKeys.twelveData));
    fetchLabels.push('Twelve Data Quote');
  }
  
  const additionalResults = await Promise.all(additionalFetches);
  
  // Debug: Log what each provider returned
  additionalResults.forEach((result, idx) => {
    if (result) {
      log.info(`[CompanyInfo] ${fetchLabels[idx]} returned:`, result);
    } else {
      log.info(`[CompanyInfo] ${fetchLabels[idx]} returned null`);
    }
  });
  
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
  
  // Detect instrument type and extract derivative info
  const instrumentType = detectInstrumentType(symbol, merged.name, merged.exchange);
  const derivativeInfo = extractDerivativeInfo(merged.name, symbol);
  
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
    wkn: deriveWKN(merged.isin),  // Derive WKN from ISIN if possible
    instrumentType,
    instrumentTypeLabel: getInstrumentTypeLabel(instrumentType),
    // Derivative-specific info from name parsing
    leverage: derivativeInfo.leverage,
    knockoutLevel: derivativeInfo.knockoutLevel,
    strikePrice: derivativeInfo.strikePrice,
    expirationDate: derivativeInfo.expirationDate,
    underlyingSymbol: derivativeInfo.underlyingSymbol,
    overnightFee: derivativeInfo.overnightFee,
    spreadPercent: derivativeInfo.spreadPercent,
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
 * Format currency value using global settings
 */
export function formatCurrency(value: number, _currency: string = 'USD'): string {
  // Use global currency setting from context
  return formatFromSettings(value);
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

/**
 * Detect instrument type based on symbol patterns and name
 */
function detectInstrumentType(
  symbol: string, 
  name?: string, 
  _exchange?: string
): CompanyInfo['instrumentType'] {
  const symbolUpper = symbol.toUpperCase();
  const nameUpper = (name || '').toUpperCase();
  
  // ETF detection
  if (
    nameUpper.includes('ETF') ||
    nameUpper.includes('EXCHANGE TRADED') ||
    nameUpper.includes('ISHARES') ||
    nameUpper.includes('SPDR') ||
    nameUpper.includes('VANGUARD') ||
    nameUpper.includes('INVESCO')
  ) {
    return 'etf';
  }
  
  // Warrant/Certificate detection (common in German markets)
  if (
    nameUpper.includes('WARRANT') ||
    nameUpper.includes('OPTIONSSCHEIN') ||
    nameUpper.includes('KNOCK-OUT') ||
    nameUpper.includes('KNOCKOUT') ||
    nameUpper.includes('TURBO') ||
    nameUpper.includes('MINI FUTURE') ||
    nameUpper.includes('FAKTOR')
  ) {
    return 'warrant';
  }
  
  // Certificate detection
  if (
    nameUpper.includes('ZERTIFIKAT') ||
    nameUpper.includes('CERTIFICATE') ||
    nameUpper.includes('TRACKER') ||
    nameUpper.includes('BONUS') ||
    nameUpper.includes('DISCOUNT')
  ) {
    return 'certificate';
  }
  
  // Bond detection
  if (
    nameUpper.includes('BOND') ||
    nameUpper.includes('ANLEIHE') ||
    nameUpper.includes('NOTE') ||
    nameUpper.includes('TREASURY')
  ) {
    return 'bond';
  }
  
  // Future detection (usually has specific month codes)
  if (
    symbolUpper.match(/[A-Z]{2,4}[FGHJKMNQUVXZ]\d{1,2}/) ||
    nameUpper.includes('FUTURE')
  ) {
    return 'future';
  }
  
  // Option detection
  if (
    nameUpper.includes('CALL') ||
    nameUpper.includes('PUT') ||
    nameUpper.includes('OPTION')
  ) {
    return 'option';
  }
  
  // Default to stock
  return 'stock';
}

/**
 * Get human-readable label for instrument type
 */
function getInstrumentTypeLabel(type?: CompanyInfo['instrumentType']): string {
  const labels: Record<NonNullable<CompanyInfo['instrumentType']>, string> = {
    stock: 'Aktie',
    etf: 'ETF',
    warrant: 'Optionsschein / Turbo',
    certificate: 'Zertifikat',
    future: 'Future',
    cfd: 'CFD',
    option: 'Option',
    bond: 'Anleihe',
    unknown: 'Unbekannt',
  };
  return type ? labels[type] : 'Unbekannt';
}

/**
 * Derive German WKN from ISIN if it's a German security
 * German ISINs start with DE and the WKN is typically characters 3-8
 */
function deriveWKN(isin?: string): string | undefined {
  if (!isin || !isin.startsWith('DE') || isin.length !== 12) {
    return undefined;
  }
  // WKN is positions 3-8 of German ISIN (0-indexed: 2-7)
  return isin.substring(2, 8);
}

/**
 * Extract derivative-specific information from product name
 * Many leveraged products encode info in their names like:
 * - "Leverage Shares 2X Long NVDA Daily ETF"
 * - "TURBO BULL NVIDIA KO 100.00 OPEN END"
 * - "MINI FUTURE LONG AUF DAX KO 15000"
 * - "FAKTOR 5X LONG TESLA"
 */
interface DerivativeInfo {
  leverage?: number;
  knockoutLevel?: number;
  strikePrice?: number;
  isLong?: boolean;
  isShort?: boolean;
  underlyingSymbol?: string;
  expirationDate?: string;
  overnightFee?: number;
  spreadPercent?: number;
  productType?: string;
}

function extractDerivativeInfo(name?: string, _symbol?: string): DerivativeInfo {
  if (!name) return {};
  
  const nameUpper = name.toUpperCase();
  const result: DerivativeInfo = {};
  
  // Extract leverage multiplier
  // Patterns: "2X", "3X", "5X", "FAKTOR 5", "LEVERAGE 2", etc.
  const leveragePatterns = [
    /(\d+)X\s*(LONG|SHORT|BULL|BEAR)?/i,
    /FAKTOR\s*(\d+)/i,
    /LEVERAGE\s*(\d+)/i,
    /(\d+)\s*FACH/i,
    /HEBEL\s*(\d+)/i,
  ];
  
  for (const pattern of leveragePatterns) {
    const match = nameUpper.match(pattern);
    if (match) {
      result.leverage = parseInt(match[1], 10);
      break;
    }
  }
  
  // Determine direction (Long/Short)
  if (nameUpper.includes('LONG') || nameUpper.includes('BULL') || nameUpper.includes('CALL')) {
    result.isLong = true;
    result.isShort = false;
  } else if (nameUpper.includes('SHORT') || nameUpper.includes('BEAR') || nameUpper.includes('PUT') || nameUpper.includes('INVERSE')) {
    result.isLong = false;
    result.isShort = true;
  }
  
  // Extract knockout level
  // Patterns: "KO 100", "KO 100.00", "KNOCK-OUT 150", "KNOCKOUT 200"
  const koPatterns = [
    /K(?:NOCK)?[-\s]?O(?:UT)?\s*[:\s]*(\d+(?:[.,]\d+)?)/i,
    /BARRIERE\s*[:\s]*(\d+(?:[.,]\d+)?)/i,
    /BARRIER\s*[:\s]*(\d+(?:[.,]\d+)?)/i,
  ];
  
  for (const pattern of koPatterns) {
    const match = nameUpper.match(pattern);
    if (match) {
      result.knockoutLevel = parseFloat(match[1].replace(',', '.'));
      break;
    }
  }
  
  // Extract strike price
  // Patterns: "STRIKE 100", "BASIS 150", "BASISPREIS 200"
  const strikePatterns = [
    /STRIKE\s*[:\s]*(\d+(?:[.,]\d+)?)/i,
    /BASIS(?:PREIS)?\s*[:\s]*(\d+(?:[.,]\d+)?)/i,
    /AUSÜBUNGSPREIS\s*[:\s]*(\d+(?:[.,]\d+)?)/i,
  ];
  
  for (const pattern of strikePatterns) {
    const match = nameUpper.match(pattern);
    if (match) {
      result.strikePrice = parseFloat(match[1].replace(',', '.'));
      break;
    }
  }
  
  // Extract underlying symbol
  // Common patterns: "AUF DAX", "ON NVIDIA", "NVDA", etc.
  const underlyingPatterns = [
    /AUF\s+([A-Z0-9]+)/i,
    /ON\s+([A-Z0-9]+)/i,
    /(?:LONG|SHORT|BULL|BEAR)\s+([A-Z]{2,5})\s/i,
  ];
  
  for (const pattern of underlyingPatterns) {
    const match = name.match(pattern);
    if (match) {
      result.underlyingSymbol = match[1].toUpperCase();
      break;
    }
  }
  
  // Extract expiration date
  // Patterns: "12/2026", "DEC 2026", "OPEN END"
  const expiryPatterns = [
    /(\d{1,2})[\/\-](\d{4})/,
    /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{4})/i,
    /VERFALL\s*[:\s]*(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/i,
  ];
  
  if (nameUpper.includes('OPEN END') || nameUpper.includes('OPEN-END') || nameUpper.includes('ENDLOS')) {
    result.expirationDate = 'Open End';
  } else {
    for (const pattern of expiryPatterns) {
      const match = name.match(pattern);
      if (match) {
        if (match.length === 3) {
          result.expirationDate = `${match[1]}/${match[2]}`;
        } else if (match.length === 4) {
          result.expirationDate = `${match[1]}.${match[2]}.${match[3]}`;
        }
        break;
      }
    }
  }
  
  // Detect product type and estimate typical costs
  if (nameUpper.includes('TURBO') || nameUpper.includes('KNOCK')) {
    result.productType = 'Turbo/Knock-Out';
    // Turbos typically have small overnight financing
    result.overnightFee = 0.01; // ~1% p.a. = 0.01% daily estimate
  } else if (nameUpper.includes('MINI FUTURE')) {
    result.productType = 'Mini Future';
    result.overnightFee = 0.02;
  } else if (nameUpper.includes('FAKTOR')) {
    result.productType = 'Faktor-Zertifikat';
    // Faktor certificates have path dependency costs built in
    result.overnightFee = 0.005;
  } else if (nameUpper.includes('OPTIONSSCHEIN') || nameUpper.includes('WARRANT')) {
    result.productType = 'Optionsschein';
    // No overnight fee for warrants, but time decay
  } else if (nameUpper.includes('CFD')) {
    result.productType = 'CFD';
    result.overnightFee = 0.02; // CFDs typically ~5-8% p.a.
  } else if (nameUpper.includes('LEVERAGE') && nameUpper.includes('ETF')) {
    result.productType = 'Leveraged ETF';
    // ETFs have expense ratio built in, no direct overnight fee
    result.spreadPercent = 0.1; // Typical ETF spread
  }
  
  // Estimate spread based on product type
  if (!result.spreadPercent) {
    if (result.productType?.includes('Turbo') || result.productType?.includes('Mini')) {
      result.spreadPercent = 0.05; // Relatively tight spreads
    } else if (result.productType?.includes('Optionsschein')) {
      result.spreadPercent = 0.5; // Wider spreads for warrants
    } else if (result.productType?.includes('Faktor')) {
      result.spreadPercent = 0.1;
    }
  }
  
  return result;
}

export default {
  fetchCompanyInfo,
  getEurUsdRate,
  formatMarketCap,
  formatCurrency,
  formatPercent,
  formatPE,
};
