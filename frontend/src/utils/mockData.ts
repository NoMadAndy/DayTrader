/**
 * Mock Stock Data Generator
 * 
 * Generates realistic-looking stock price data for testing purposes.
 * In production, this would be replaced with actual market data APIs.
 */

import type { OHLCV, StockData } from '../types/stock';

const POPULAR_STOCKS = [
  { symbol: 'AAPL', name: 'Apple Inc.', basePrice: 175 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', basePrice: 140 },
  { symbol: 'MSFT', name: 'Microsoft Corporation', basePrice: 380 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', basePrice: 180 },
  { symbol: 'TSLA', name: 'Tesla Inc.', basePrice: 250 },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', basePrice: 480 },
  { symbol: 'META', name: 'Meta Platforms Inc.', basePrice: 500 },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', basePrice: 195 },
];

/**
 * Generate random walk with trend and volatility
 */
function generateOHLCV(
  basePrice: number,
  days: number,
  volatility: number = 0.02,
  trend: number = 0.0001
): OHLCV[] {
  const data: OHLCV[] = [];
  let price = basePrice;
  
  // Start from 'days' days ago
  const now = new Date();
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    
    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    // Random walk with drift
    const dailyReturn = (Math.random() - 0.5) * volatility * 2 + trend;
    const open = price;
    price = price * (1 + dailyReturn);
    
    // Generate high, low based on volatility
    const intraVolatility = volatility * Math.random();
    const high = Math.max(open, price) * (1 + intraVolatility);
    const low = Math.min(open, price) * (1 - intraVolatility);
    const close = price;
    
    // Volume with some randomness
    const avgVolume = 50000000;
    const volume = Math.floor(avgVolume * (0.5 + Math.random()));
    
    data.push({
      time: Math.floor(date.getTime() / 1000),
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume
    });
  }
  
  return data;
}

/**
 * Get stock data for a specific symbol
 */
export function getStockData(symbol: string, days: number = 365): StockData | null {
  const stock = POPULAR_STOCKS.find(s => s.symbol === symbol);
  if (!stock) return null;
  
  // Vary volatility and trend by stock
  const volatilityMap: Record<string, number> = {
    'TSLA': 0.035,
    'NVDA': 0.03,
    'META': 0.025,
    'AAPL': 0.015,
    'MSFT': 0.015,
    'GOOGL': 0.02,
    'AMZN': 0.02,
    'JPM': 0.015,
  };
  
  const trendMap: Record<string, number> = {
    'NVDA': 0.0008,
    'META': 0.0005,
    'MSFT': 0.0003,
    'AAPL': 0.0002,
    'TSLA': 0.0001,
    'GOOGL': 0.0002,
    'AMZN': 0.0003,
    'JPM': 0.0001,
  };
  
  const volatility = volatilityMap[symbol] ?? 0.02;
  const trend = trendMap[symbol] ?? 0.0001;
  
  return {
    symbol: stock.symbol,
    name: stock.name,
    data: generateOHLCV(stock.basePrice, days, volatility, trend)
  };
}

/**
 * Get list of available stocks
 */
export function getAvailableStocks(): Array<{ symbol: string; name: string }> {
  return POPULAR_STOCKS.map(s => ({ symbol: s.symbol, name: s.name }));
}

/**
 * Search stocks by symbol or name
 */
export function searchStocks(query: string): Array<{ symbol: string; name: string }> {
  const lowerQuery = query.toLowerCase();
  return POPULAR_STOCKS.filter(
    s => s.symbol.toLowerCase().includes(lowerQuery) ||
         s.name.toLowerCase().includes(lowerQuery)
  ).map(s => ({ symbol: s.symbol, name: s.name }));
}
