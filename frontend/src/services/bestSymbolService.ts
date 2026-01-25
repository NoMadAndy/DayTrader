/**
 * Best Symbol Service
 * 
 * Determines the most promising stock from the user's watchlist
 * based on trading signals. Uses cached stock data for quick analysis.
 */

import { DEFAULT_STOCKS } from '../utils/mockData';
import { getAuthState } from './authService';
import { getCustomSymbols } from './userSettingsService';
import { getDataService } from './dataService';
import { 
  calculateCombinedTradingSignals, 
  type CombinedSignalInput 
} from '../utils/tradingSignals';
import { generateForecast } from '../utils/forecast';

const STORAGE_KEY = 'daytrader_best_symbol';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface CachedBestSymbol {
  symbol: string;
  score: number;
  timestamp: number;
}

/**
 * Get cached best symbol if still valid
 */
function getCachedBestSymbol(): CachedBestSymbol | null {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const data: CachedBestSymbol = JSON.parse(cached);
      if (Date.now() - data.timestamp < CACHE_DURATION) {
        return data;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Cache the best symbol result
 */
function cacheBestSymbol(symbol: string, score: number): void {
  try {
    const data: CachedBestSymbol = {
      symbol,
      score,
      timestamp: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Analyze a single symbol and return its score
 */
async function analyzeSymbol(symbol: string): Promise<{ symbol: string; score: number } | null> {
  try {
    const dataService = getDataService();
    const stockData = await dataService.fetchStockData(symbol);
    
    if (!stockData || stockData.data.length === 0) {
      return null;
    }

    const currentPrice = stockData.data[stockData.data.length - 1].close;
    const forecast = generateForecast(stockData.data);
    
    const signalInput: CombinedSignalInput = {
      newsItems: [],
      forecast,
      stockData: stockData.data,
      currentPrice,
    };
    
    const signals = calculateCombinedTradingSignals(signalInput);
    
    // Calculate overall score - weighted average of all timeframes
    // Daily trading is weighted highest
    const overallScore = (
      signals.hourly.score * 0.1 +
      signals.daily.score * 0.4 +
      signals.weekly.score * 0.3 +
      signals.longTerm.score * 0.2
    );
    
    return { symbol, score: overallScore };
  } catch {
    return null;
  }
}

/**
 * Get the most promising symbol from the watchlist
 * Returns the symbol with the highest combined trading signal score
 */
export async function getBestSymbolFromWatchlist(): Promise<string> {
  // Check cache first for quick response
  const cached = getCachedBestSymbol();
  if (cached) {
    console.log(`[BestSymbol] Using cached: ${cached.symbol} (score: ${cached.score.toFixed(1)})`);
    return cached.symbol;
  }

  // Get watchlist symbols
  const { isAuthenticated } = getAuthState();
  
  let symbols: string[];
  if (isAuthenticated) {
    const customSymbols = await getCustomSymbols();
    symbols = customSymbols.map(s => s.symbol);
  } else {
    symbols = DEFAULT_STOCKS.map(s => s.symbol);
  }
  
  if (symbols.length === 0) {
    return 'AAPL'; // Fallback
  }

  console.log(`[BestSymbol] Analyzing ${symbols.length} symbols...`);
  
  // Analyze symbols in parallel (batch of 3 to avoid rate limits)
  const results: { symbol: string; score: number }[] = [];
  const batchSize = 3;
  
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(analyzeSymbol));
    
    for (const result of batchResults) {
      if (result) {
        results.push(result);
      }
    }
  }
  
  if (results.length === 0) {
    return symbols[0] || 'AAPL'; // Fallback to first symbol
  }
  
  // Sort by score (highest first)
  results.sort((a, b) => b.score - a.score);
  
  const best = results[0];
  console.log(`[BestSymbol] Best: ${best.symbol} (score: ${best.score.toFixed(1)})`);
  console.log(`[BestSymbol] Top 3:`, results.slice(0, 3).map(r => `${r.symbol}: ${r.score.toFixed(1)}`).join(', '));
  
  // Cache the result
  cacheBestSymbol(best.symbol, best.score);
  
  return best.symbol;
}

/**
 * Clear the best symbol cache
 */
export function clearBestSymbolCache(): void {
  localStorage.removeItem(STORAGE_KEY);
}
