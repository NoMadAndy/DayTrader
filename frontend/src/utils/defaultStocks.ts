/**
 * Default Stock Symbols
 * 
 * A list of well-known stock symbols displayed by default in the watchlist.
 * These are real stock symbols - actual price data is fetched from live APIs.
 */

export interface StockSymbol {
  symbol: string;
  name: string;
}

/**
 * Default stocks shown in the watchlist for non-authenticated users
 * and as initial suggestions for new users.
 */
export const DEFAULT_STOCKS: StockSymbol[] = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corporation' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation' },
  { symbol: 'META', name: 'Meta Platforms Inc.' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
];
