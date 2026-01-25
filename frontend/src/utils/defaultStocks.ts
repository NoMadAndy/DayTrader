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

/**
 * Extended list of popular/well-known stocks for backtesting and analysis.
 * Includes major US stocks across different sectors.
 */
export const POPULAR_STOCKS: StockSymbol[] = [
  // Technology
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corporation' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'META', name: 'Meta Platforms Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'AMD', name: 'Advanced Micro Devices' },
  { symbol: 'INTC', name: 'Intel Corporation' },
  { symbol: 'CRM', name: 'Salesforce Inc.' },
  { symbol: 'ORCL', name: 'Oracle Corporation' },
  { symbol: 'ADBE', name: 'Adobe Inc.' },
  { symbol: 'NFLX', name: 'Netflix Inc.' },
  { symbol: 'CSCO', name: 'Cisco Systems Inc.' },
  { symbol: 'AVGO', name: 'Broadcom Inc.' },
  { symbol: 'QCOM', name: 'Qualcomm Inc.' },
  { symbol: 'IBM', name: 'IBM Corporation' },
  { symbol: 'NOW', name: 'ServiceNow Inc.' },
  { symbol: 'UBER', name: 'Uber Technologies' },
  { symbol: 'SHOP', name: 'Shopify Inc.' },
  { symbol: 'SQ', name: 'Block Inc.' },
  { symbol: 'PYPL', name: 'PayPal Holdings' },
  { symbol: 'SNOW', name: 'Snowflake Inc.' },
  { symbol: 'PLTR', name: 'Palantir Technologies' },
  { symbol: 'MU', name: 'Micron Technology' },
  { symbol: 'AMAT', name: 'Applied Materials' },
  { symbol: 'LRCX', name: 'Lam Research' },
  { symbol: 'KLAC', name: 'KLA Corporation' },
  
  // Finance
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
  { symbol: 'V', name: 'Visa Inc.' },
  { symbol: 'MA', name: 'Mastercard Inc.' },
  { symbol: 'BAC', name: 'Bank of America' },
  { symbol: 'WFC', name: 'Wells Fargo' },
  { symbol: 'GS', name: 'Goldman Sachs' },
  { symbol: 'MS', name: 'Morgan Stanley' },
  { symbol: 'C', name: 'Citigroup Inc.' },
  { symbol: 'AXP', name: 'American Express' },
  { symbol: 'BLK', name: 'BlackRock Inc.' },
  { symbol: 'SCHW', name: 'Charles Schwab' },
  { symbol: 'USB', name: 'U.S. Bancorp' },
  { symbol: 'PNC', name: 'PNC Financial' },
  { symbol: 'COF', name: 'Capital One' },
  
  // Healthcare
  { symbol: 'UNH', name: 'UnitedHealth Group' },
  { symbol: 'JNJ', name: 'Johnson & Johnson' },
  { symbol: 'PFE', name: 'Pfizer Inc.' },
  { symbol: 'ABBV', name: 'AbbVie Inc.' },
  { symbol: 'MRK', name: 'Merck & Co.' },
  { symbol: 'LLY', name: 'Eli Lilly' },
  { symbol: 'TMO', name: 'Thermo Fisher Scientific' },
  { symbol: 'ABT', name: 'Abbott Laboratories' },
  { symbol: 'DHR', name: 'Danaher Corporation' },
  { symbol: 'BMY', name: 'Bristol-Myers Squibb' },
  { symbol: 'AMGN', name: 'Amgen Inc.' },
  { symbol: 'GILD', name: 'Gilead Sciences' },
  { symbol: 'MRNA', name: 'Moderna Inc.' },
  { symbol: 'REGN', name: 'Regeneron Pharma' },
  { symbol: 'VRTX', name: 'Vertex Pharmaceuticals' },
  
  // Consumer
  { symbol: 'WMT', name: 'Walmart Inc.' },
  { symbol: 'PG', name: 'Procter & Gamble' },
  { symbol: 'KO', name: 'Coca-Cola Company' },
  { symbol: 'PEP', name: 'PepsiCo Inc.' },
  { symbol: 'COST', name: 'Costco Wholesale' },
  { symbol: 'HD', name: 'Home Depot' },
  { symbol: 'MCD', name: "McDonald's Corp." },
  { symbol: 'NKE', name: 'Nike Inc.' },
  { symbol: 'SBUX', name: 'Starbucks Corp.' },
  { symbol: 'TGT', name: 'Target Corporation' },
  { symbol: 'LOW', name: "Lowe's Companies" },
  { symbol: 'DIS', name: 'Walt Disney Co.' },
  { symbol: 'CMCSA', name: 'Comcast Corporation' },
  
  // Industrial & Energy
  { symbol: 'XOM', name: 'Exxon Mobil' },
  { symbol: 'CVX', name: 'Chevron Corporation' },
  { symbol: 'COP', name: 'ConocoPhillips' },
  { symbol: 'SLB', name: 'Schlumberger' },
  { symbol: 'BA', name: 'Boeing Company' },
  { symbol: 'CAT', name: 'Caterpillar Inc.' },
  { symbol: 'GE', name: 'General Electric' },
  { symbol: 'HON', name: 'Honeywell International' },
  { symbol: 'UPS', name: 'United Parcel Service' },
  { symbol: 'RTX', name: 'RTX Corporation' },
  { symbol: 'LMT', name: 'Lockheed Martin' },
  { symbol: 'DE', name: 'Deere & Company' },
  { symbol: 'MMM', name: '3M Company' },
  
  // Communication & Media
  { symbol: 'T', name: 'AT&T Inc.' },
  { symbol: 'VZ', name: 'Verizon Communications' },
  { symbol: 'TMUS', name: 'T-Mobile US' },
  { symbol: 'CHTR', name: 'Charter Communications' },
  
  // ETFs (popular for backtesting)
  { symbol: 'SPY', name: 'S&P 500 ETF' },
  { symbol: 'QQQ', name: 'Nasdaq 100 ETF' },
  { symbol: 'IWM', name: 'Russell 2000 ETF' },
  { symbol: 'DIA', name: 'Dow Jones ETF' },
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF' },
  { symbol: 'VTI', name: 'Vanguard Total Market ETF' },
  { symbol: 'ARKK', name: 'ARK Innovation ETF' },
  { symbol: 'XLF', name: 'Financial Select SPDR' },
  { symbol: 'XLK', name: 'Technology Select SPDR' },
  { symbol: 'XLE', name: 'Energy Select SPDR' },
  { symbol: 'XLV', name: 'Health Care Select SPDR' },
  { symbol: 'GLD', name: 'SPDR Gold Trust' },
  { symbol: 'SLV', name: 'iShares Silver Trust' },
  { symbol: 'TLT', name: 'iShares 20+ Year Treasury' },
];
