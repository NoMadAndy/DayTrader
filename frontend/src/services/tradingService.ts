/**
 * Paper Trading Service
 * 
 * API client for stock market simulation / paper trading features.
 * Requires authentication for most operations.
 */

import { getAuthState } from './authService';
import { formatCurrencyValue as formatFromSettings } from '../contexts';
import type {
  Portfolio,
  PortfolioSettings,
  Position,
  PositionWithPnL,
  Transaction,
  PortfolioMetrics,
  BrokerProfiles,
  ProductTypes,
  FeeCalculation,
  FeeSummary,
  ExecuteOrderRequest,
  ExecuteOrderResponse,
  ClosePositionResponse,
  CalculateFeesRequest,
  ProductType,
  Order,
  CreatePendingOrderRequest,
  CreatePendingOrderResponse,
  CancelOrderResponse,
  CheckTriggersResponse,
  EquityCurvePoint,
  LeaderboardEntry,
  UserRank,
} from '../types/trading';

// API_BASE should be empty for relative URLs or full URL for external backend
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

// ============================================================================
// Helper Functions
// ============================================================================

function getAuthHeaders(): HeadersInit {
  const { token } = getAuthState();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// ============================================================================
// Configuration APIs (no auth required)
// ============================================================================

/**
 * Get available broker profiles
 */
export async function getBrokerProfiles(): Promise<BrokerProfiles> {
  const response = await fetch(`${API_BASE}/trading/broker-profiles`);
  return handleResponse<BrokerProfiles>(response);
}

/**
 * Get available product types
 */
export async function getProductTypes(): Promise<ProductTypes> {
  const response = await fetch(`${API_BASE}/trading/product-types`);
  return handleResponse<ProductTypes>(response);
}

/**
 * Calculate fees preview
 */
export async function calculateFees(params: CalculateFeesRequest): Promise<FeeCalculation> {
  const response = await fetch(`${API_BASE}/trading/calculate-fees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleResponse<FeeCalculation>(response);
}

// ============================================================================
// Portfolio APIs
// ============================================================================

/**
 * Get all portfolios for current user
 */
export async function getPortfolios(): Promise<Portfolio[]> {
  const response = await fetch(`${API_BASE}/trading/portfolios`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<Portfolio[]>(response);
}

/**
 * Get or create the default portfolio
 */
export async function getOrCreatePortfolio(): Promise<Portfolio> {
  const response = await fetch(`${API_BASE}/trading/portfolio`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<Portfolio>(response);
}

/**
 * Get specific portfolio by ID
 */
export async function getPortfolio(portfolioId: number): Promise<Portfolio> {
  const response = await fetch(`${API_BASE}/trading/portfolio/${portfolioId}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<Portfolio>(response);
}

/**
 * Update portfolio settings
 */
export async function updatePortfolioSettings(
  portfolioId: number, 
  settings: PortfolioSettings
): Promise<Portfolio> {
  const response = await fetch(`${API_BASE}/trading/portfolio/${portfolioId}/settings`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(settings),
  });
  return handleResponse<Portfolio>(response);
}

/**
 * Set initial capital and reset portfolio
 * @param portfolioId Portfolio ID
 * @param initialCapital New initial capital (min: 1000, max: 10000000)
 */
export async function setInitialCapital(
  portfolioId: number, 
  initialCapital: number
): Promise<Portfolio> {
  const response = await fetch(`${API_BASE}/trading/portfolio/${portfolioId}/capital`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ initialCapital }),
  });
  return handleResponse<Portfolio>(response);
}

/**
 * Reset portfolio to initial state
 */
export async function resetPortfolio(portfolioId: number): Promise<Portfolio> {
  const response = await fetch(`${API_BASE}/trading/portfolio/${portfolioId}/reset`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return handleResponse<Portfolio>(response);
}

/**
 * Get portfolio metrics and performance
 */
export async function getPortfolioMetrics(portfolioId: number): Promise<PortfolioMetrics> {
  const response = await fetch(`${API_BASE}/trading/portfolio/${portfolioId}/metrics`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<PortfolioMetrics>(response);
}

// ============================================================================
// Position APIs
// ============================================================================

/**
 * Get open positions
 */
export async function getOpenPositions(portfolioId: number): Promise<Position[]> {
  const response = await fetch(`${API_BASE}/trading/portfolio/${portfolioId}/positions`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<Position[]>(response);
}

/**
 * Get all positions (including closed)
 */
export async function getAllPositions(portfolioId: number, limit = 100): Promise<Position[]> {
  const response = await fetch(
    `${API_BASE}/trading/portfolio/${portfolioId}/positions/all?limit=${limit}`, 
    { headers: getAuthHeaders() }
  );
  return handleResponse<Position[]>(response);
}

/**
 * Update position current price
 */
export async function updatePositionPrice(
  positionId: number, 
  currentPrice: number
): Promise<Position> {
  const response = await fetch(`${API_BASE}/trading/position/${positionId}/price`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ currentPrice }),
  });
  return handleResponse<Position>(response);
}

/**
 * Close a position
 */
export async function closePosition(
  positionId: number, 
  currentPrice: number
): Promise<ClosePositionResponse> {
  const response = await fetch(`${API_BASE}/trading/position/${positionId}/close`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ currentPrice }),
  });
  return handleResponse<ClosePositionResponse>(response);
}

// ============================================================================
// Order APIs
// ============================================================================

/**
 * Execute a market order
 */
export async function executeMarketOrder(
  request: ExecuteOrderRequest
): Promise<ExecuteOrderResponse> {
  const response = await fetch(`${API_BASE}/trading/order/market`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(request),
  });
  return handleResponse<ExecuteOrderResponse>(response);
}

// ============================================================================
// Transaction & Fee APIs
// ============================================================================

/**
 * Get transaction history
 */
export async function getTransactionHistory(
  portfolioId: number, 
  limit = 50, 
  offset = 0
): Promise<Transaction[]> {
  const response = await fetch(
    `${API_BASE}/trading/portfolio/${portfolioId}/transactions?limit=${limit}&offset=${offset}`,
    { headers: getAuthHeaders() }
  );
  return handleResponse<Transaction[]>(response);
}

/**
 * Get fee summary
 */
export async function getFeeSummary(portfolioId: number): Promise<FeeSummary> {
  const response = await fetch(`${API_BASE}/trading/portfolio/${portfolioId}/fees`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<FeeSummary>(response);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate position P&L and other derived values
 */
export function calculatePositionPnL(position: Position, currentPrice: number): PositionWithPnL {
  const price = currentPrice || position.currentPrice || position.entryPrice;
  const entryValue = position.quantity * position.entryPrice;
  const currentValue = position.quantity * price;
  const pnlMultiplier = position.side === 'long' ? 1 : -1;
  
  const unrealizedPnl = (currentValue - entryValue) * pnlMultiplier;
  const unrealizedPnlPercent = (unrealizedPnl / entryValue) * 100;
  const leveragedPnlPercent = unrealizedPnlPercent * position.leverage;
  const notionalValue = currentValue * position.leverage;
  
  // Calculate liquidation price
  let liquidationPrice: number | null = null;
  let distanceToLiquidation: number | null = null;
  
  if (position.leverage > 1 && position.marginUsed) {
    const maxLossPercent = (1 / position.leverage) * 100;
    if (position.side === 'long') {
      liquidationPrice = position.entryPrice * (1 - maxLossPercent / 100);
      distanceToLiquidation = ((price - liquidationPrice) / price) * 100;
    } else {
      liquidationPrice = position.entryPrice * (1 + maxLossPercent / 100);
      distanceToLiquidation = ((liquidationPrice - price) / price) * 100;
    }
  }
  
  return {
    ...position,
    currentPrice: price,
    unrealizedPnl,
    unrealizedPnlPercent,
    leveragedPnlPercent,
    notionalValue,
    liquidationPrice,
    distanceToLiquidation,
  };
}

/**
 * Format currency value using global settings
 */
export function formatCurrency(value: number, _currency = 'USD'): string {
  // Use global currency setting from context
  return formatFromSettings(value);
}

/**
 * Format percentage value
 */
export function formatPercent(value: number, decimals = 2): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/**
 * Get product type display name
 */
export function getProductTypeName(productType: ProductType): string {
  const names: Record<ProductType, string> = {
    stock: 'Aktie',
    cfd: 'CFD',
    knockout: 'Knock-Out',
    factor: 'Faktor-Zertifikat',
    warrant: 'Optionsschein',
  };
  return names[productType] || productType;
}

/**
 * Get side display name
 */
export function getSideName(side: string): string {
  const names: Record<string, string> = {
    buy: 'Kauf',
    sell: 'Verkauf',
    short: 'Short',
    long: 'Long',
  };
  return names[side] || side;
}

/**
 * Calculate break-even price including fees
 */
export function calculateBreakEvenPrice(
  entryPrice: number,
  fees: FeeCalculation,
  _side: 'buy' | 'sell' | 'short',
  quantity: number
): number {
  const feesPerShare = (fees.totalFees * 2) / quantity; // *2 for round-trip
  
  if (_side === 'buy') {
    return entryPrice + feesPerShare;
  } else {
    return entryPrice - feesPerShare;
  }
}

/**
 * Calculate risk-reward ratio
 */
export function calculateRiskReward(
  entryPrice: number,
  stopLoss: number | null,
  takeProfit: number | null,
  _side: 'buy' | 'sell' | 'short'
): number | null {
  if (!stopLoss || !takeProfit) return null;
  
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(takeProfit - entryPrice);
  
  if (risk === 0) return null;
  
  return reward / risk;
}

/**
 * Validate order before submission
 */
export function validateOrder(
  request: ExecuteOrderRequest,
  portfolio: Portfolio,
  fees: FeeCalculation
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (request.quantity <= 0) {
    errors.push('Menge muss größer als 0 sein');
  }
  
  if (request.currentPrice <= 0) {
    errors.push('Preis muss größer als 0 sein');
  }
  
  const requiredCash = request.side === 'buy' 
    ? fees.marginRequired + fees.totalFees 
    : fees.totalFees;
  
  if (requiredCash > portfolio.cashBalance) {
    errors.push(`Unzureichendes Guthaben. Benötigt: ${formatCurrency(requiredCash)}, Verfügbar: ${formatCurrency(portfolio.cashBalance)}`);
  }
  
  if (request.leverage && request.leverage > 30) {
    errors.push('Maximaler Hebel ist 30');
  }
  
  if (request.stopLoss) {
    if (request.side === 'buy' && request.stopLoss >= request.currentPrice) {
      errors.push('Stop-Loss muss unter dem aktuellen Preis liegen (Long)');
    }
    if (request.side === 'short' && request.stopLoss <= request.currentPrice) {
      errors.push('Stop-Loss muss über dem aktuellen Preis liegen (Short)');
    }
  }
  
  if (request.takeProfit) {
    if (request.side === 'buy' && request.takeProfit <= request.currentPrice) {
      errors.push('Take-Profit muss über dem aktuellen Preis liegen (Long)');
    }
    if (request.side === 'short' && request.takeProfit >= request.currentPrice) {
      errors.push('Take-Profit muss unter dem aktuellen Preis liegen (Short)');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Extended Features: Pending Orders, Equity Curve, Leaderboard
// ============================================================================

/**
 * Create a pending limit or stop order
 */
export async function createPendingOrder(
  request: CreatePendingOrderRequest
): Promise<CreatePendingOrderResponse> {
  const response = await fetch(`${API_BASE}/trading/order/pending`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(request),
  });
  return handleResponse<CreatePendingOrderResponse>(response);
}

/**
 * Cancel a pending order
 */
export async function cancelOrder(orderId: number): Promise<CancelOrderResponse> {
  const response = await fetch(`${API_BASE}/trading/order/${orderId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return handleResponse<CancelOrderResponse>(response);
}

/**
 * Get pending orders for portfolio
 */
export async function getPendingOrders(portfolioId: number): Promise<Order[]> {
  const response = await fetch(`${API_BASE}/trading/portfolio/${portfolioId}/orders/pending`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<Order[]>(response);
}

/**
 * Update position stop-loss and take-profit levels
 */
export async function updatePositionLevels(
  positionId: number,
  levels: { stopLoss?: number; takeProfit?: number }
): Promise<Position> {
  const response = await fetch(`${API_BASE}/trading/position/${positionId}/levels`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(levels),
  });
  return handleResponse<Position>(response);
}

/**
 * Check pending orders and position triggers with current prices
 * This triggers limit/stop orders and stop-loss/take-profit/knockout
 */
export async function checkTriggers(
  prices: Record<string, number>
): Promise<CheckTriggersResponse> {
  const response = await fetch(`${API_BASE}/trading/check-triggers`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ prices }),
  });
  return handleResponse<CheckTriggersResponse>(response);
}

/**
 * Get equity curve (portfolio value history)
 */
export async function getEquityCurve(
  portfolioId: number,
  days = 30
): Promise<EquityCurvePoint[]> {
  const response = await fetch(
    `${API_BASE}/trading/portfolio/${portfolioId}/equity-curve?days=${days}`,
    { headers: getAuthHeaders() }
  );
  return handleResponse<EquityCurvePoint[]>(response);
}

/**
 * Get global leaderboard
 */
export async function getLeaderboard(
  limit = 50,
  timeframe: 'all' | 'day' | 'week' | 'month' = 'all',
  filter: 'all' | 'humans' | 'ai' = 'all'
): Promise<LeaderboardEntry[]> {
  const response = await fetch(
    `${API_BASE}/trading/leaderboard?limit=${limit}&timeframe=${timeframe}&filter=${filter}`
  );
  return handleResponse<LeaderboardEntry[]>(response);
}

/**
 * Get current user's rank in leaderboard
 */
export async function getUserRank(): Promise<UserRank> {
  const response = await fetch(`${API_BASE}/trading/leaderboard/rank`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<UserRank>(response);
}

// ============================================================================
// Backtesting APIs
// ============================================================================

export interface BacktestSession {
  id: number;
  userId: number;
  name: string;
  startDate: string;
  endDate: string;
  currentDate: string;
  initialCapital: number;
  currentCapital: number;
  brokerProfile: string;
  symbols: string[];
  status: 'active' | 'completed' | 'cancelled';
  createdAt: string;
  positions?: BacktestPosition[];
  orders?: BacktestOrder[];
  trades?: BacktestTrade[];
  openPositions?: number;
  totalTrades?: number;
}

export interface BacktestPosition {
  id: number;
  sessionId: number;
  symbol: string;
  productType: string;
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  marginUsed: number;
  stopLoss: number | null;
  takeProfit: number | null;
  totalFeesPaid: number;
  realizedPnl: number | null;
  isOpen: boolean;
  openedAt: string;
  closedAt: string | null;
}

export interface BacktestOrder {
  id: number;
  sessionId: number;
  symbol: string;
  side: string;
  productType: string;
  quantity: number;
  price: number;
  leverage: number;
  status: string;
  createdAt: string;
  executedAt: string;
}

export interface BacktestTrade {
  id: number;
  sessionId: number;
  orderId: number | null;
  positionId: number | null;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  fees: number;
  pnl: number | null;
  executedAt: string;
}

export interface BacktestResults {
  session: BacktestSession;
  equityCurve: Array<{
    date: string;
    totalValue: number;
    cashBalance: number;
    unrealizedPnl: number;
  }>;
  metrics: {
    initialCapital: number;
    finalValue: number;
    totalReturn: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    totalPnl: number;
    totalFees: number;
    netPnl: number;
    maxDrawdown: number;
  };
}

export interface CreateBacktestSessionRequest {
  name: string;
  startDate: string;
  endDate: string;
  initialCapital?: number;
  brokerProfile?: string;
  symbols?: string[];
}

export interface ExecuteBacktestOrderRequest {
  sessionId: number;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  productType?: string;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface AdvanceBacktestTimeRequest {
  newDate: string;
  priceUpdates?: Record<string, number>;
}

export interface AdvanceBacktestTimeResponse {
  success: boolean;
  completed?: boolean;
  newDate?: string;
  triggeredPositions?: Array<{
    positionId: number;
    realizedPnl: number;
    symbol: string;
    reason: 'stop_loss' | 'take_profit';
    triggerPrice: number;
  }>;
  metrics?: {
    totalValue: number;
    cashBalance: number;
    unrealizedPnl: number;
    marginUsed: number;
  };
  message?: string;
  error?: string;
}

/**
 * Create a new backtest session
 */
export async function createBacktestSession(
  params: CreateBacktestSessionRequest
): Promise<BacktestSession> {
  const response = await fetch(`${API_BASE}/trading/backtest/session`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(params),
  });
  return handleResponse<BacktestSession>(response);
}

/**
 * Get all backtest sessions for current user
 */
export async function getBacktestSessions(): Promise<BacktestSession[]> {
  const response = await fetch(`${API_BASE}/trading/backtest/sessions`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<BacktestSession[]>(response);
}

/**
 * Get specific backtest session with positions and trades
 */
export async function getBacktestSession(sessionId: number): Promise<BacktestSession> {
  const response = await fetch(`${API_BASE}/trading/backtest/session/${sessionId}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<BacktestSession>(response);
}

/**
 * Execute an order in a backtest session
 */
export async function executeBacktestOrder(
  params: ExecuteBacktestOrderRequest
): Promise<{ success: boolean; order?: BacktestOrder; position?: BacktestPosition; fees?: FeeCalculation; newCapital?: number; error?: string }> {
  const response = await fetch(`${API_BASE}/trading/backtest/order`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(params),
  });
  return handleResponse(response);
}

/**
 * Close a backtest position
 */
export async function closeBacktestPosition(
  positionId: number,
  closePrice: number
): Promise<{ success: boolean; realizedPnl?: number; closingFees?: number; totalFees?: number; error?: string }> {
  const response = await fetch(`${API_BASE}/trading/backtest/position/${positionId}/close`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ price: closePrice }),
  });
  return handleResponse(response);
}

/**
 * Advance backtest time to a new date
 */
export async function advanceBacktestTime(
  sessionId: number,
  params: AdvanceBacktestTimeRequest
): Promise<AdvanceBacktestTimeResponse> {
  const response = await fetch(`${API_BASE}/trading/backtest/session/${sessionId}/advance`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(params),
  });
  return handleResponse<AdvanceBacktestTimeResponse>(response);
}

/**
 * Get backtest results and performance metrics
 */
export async function getBacktestResults(sessionId: number): Promise<BacktestResults> {
  const response = await fetch(`${API_BASE}/trading/backtest/session/${sessionId}/results`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<BacktestResults>(response);
}

/**
 * Delete a backtest session
 */
export async function deleteBacktestSession(sessionId: number): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE}/trading/backtest/session/${sessionId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return handleResponse(response);
}

// ============================================================================
// Historical Prices API (for Backtesting)
// ============================================================================

/**
 * Historical price record from database
 */
export interface HistoricalPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Response from historical prices API
 */
export interface HistoricalPricesResponse {
  symbol: string;
  startDate: string;
  endDate: string;
  recordCount: number;
  prices: HistoricalPrice[];
}

/**
 * Data availability check response
 */
export interface HistoricalDataAvailability {
  symbol: string;
  hasData: boolean;
  existingDates: number;
  requiredDates: number;
}

/**
 * Symbol with historical data info
 */
export interface AvailableSymbol {
  symbol: string;
  minDate: string;
  maxDate: string;
  recordCount: number;
}

/**
 * Get historical prices for a symbol
 * Automatically fetches from Yahoo Finance if not in database
 */
export async function getHistoricalPrices(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<HistoricalPricesResponse> {
  const response = await fetch(
    `${API_BASE}/historical-prices/${encodeURIComponent(symbol)}?startDate=${startDate}&endDate=${endDate}`,
    { headers: { 'Content-Type': 'application/json' } }
  );
  return handleResponse<HistoricalPricesResponse>(response);
}

/**
 * Check if historical data is available in database
 */
export async function checkHistoricalDataAvailability(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<HistoricalDataAvailability> {
  const response = await fetch(
    `${API_BASE}/historical-prices/${encodeURIComponent(symbol)}/availability?startDate=${startDate}&endDate=${endDate}`,
    { headers: { 'Content-Type': 'application/json' } }
  );
  return handleResponse<HistoricalDataAvailability>(response);
}

/**
 * Get all symbols with historical data in database
 */
export async function getAvailableHistoricalSymbols(): Promise<{ symbols: AvailableSymbol[] }> {
  const response = await fetch(`${API_BASE}/historical-prices/symbols/available`, {
    headers: { 'Content-Type': 'application/json' },
  });
  return handleResponse<{ symbols: AvailableSymbol[] }>(response);
}

/**
 * Force refresh historical data for a symbol
 */
export async function refreshHistoricalData(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<{ success: boolean; recordsInserted?: number; error?: string }> {
  const response = await fetch(`${API_BASE}/historical-prices/${encodeURIComponent(symbol)}/refresh`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ startDate, endDate }),
  });
  return handleResponse(response);
}

/**
 * Get order type display name
 */
export function getOrderTypeName(orderType: string): string {
  const names: Record<string, string> = {
    market: 'Market',
    limit: 'Limit',
    stop: 'Stop',
    stop_limit: 'Stop-Limit',
  };
  return names[orderType] || orderType;
}

// ============================================================================
// Warrant Pricing Functions
// ============================================================================

export interface WarrantPriceRequest {
  underlyingPrice: number;
  strikePrice: number;
  daysToExpiry: number;
  volatility?: number;
  riskFreeRate?: number;
  optionType?: 'call' | 'put';
  ratio?: number;
}

/**
 * Get Black-Scholes warrant price and Greeks from ML service
 */
export async function getWarrantPrice(params: WarrantPriceRequest): Promise<import('../types/trading').WarrantPriceResult> {
  const response = await fetch(`${API_BASE}/trading/warrant/price`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleResponse(response);
}

/**
 * Get implied volatility from warrant market price
 */
export async function getImpliedVolatility(params: {
  marketPrice: number;
  underlyingPrice: number;
  strikePrice: number;
  daysToExpiry: number;
  riskFreeRate?: number;
  optionType?: 'call' | 'put';
  ratio?: number;
}): Promise<{ success: boolean; implied_volatility: number; implied_volatility_pct: number }> {
  const response = await fetch(`${API_BASE}/trading/warrant/implied-volatility`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleResponse(response);
}

export default {
  getBrokerProfiles,
  getProductTypes,
  calculateFees,
  getPortfolios,
  getOrCreatePortfolio,
  getPortfolio,
  updatePortfolioSettings,
  setInitialCapital,
  resetPortfolio,
  getPortfolioMetrics,
  getOpenPositions,
  getAllPositions,
  updatePositionPrice,
  closePosition,
  executeMarketOrder,
  getTransactionHistory,
  getFeeSummary,
  calculatePositionPnL,
  formatCurrency,
  formatPercent,
  getProductTypeName,
  getSideName,
  calculateBreakEvenPrice,
  calculateRiskReward,
  validateOrder,
  // Extended features
  createPendingOrder,
  cancelOrder,
  getPendingOrders,
  updatePositionLevels,
  checkTriggers,
  getEquityCurve,
  getLeaderboard,
  getUserRank,
  getOrderTypeName,
  // Backtesting
  createBacktestSession,
  getBacktestSessions,
  getBacktestSession,
  executeBacktestOrder,
  closeBacktestPosition,
  advanceBacktestTime,
  getBacktestResults,
  deleteBacktestSession,
  // Historical Prices
  getHistoricalPrices,
  checkHistoricalDataAvailability,
  getAvailableHistoricalSymbols,
  refreshHistoricalData,
  // Warrant Pricing
  getWarrantPrice,
  getImpliedVolatility,
};
