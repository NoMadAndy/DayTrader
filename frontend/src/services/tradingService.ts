/**
 * Paper Trading Service
 * 
 * API client for stock market simulation / paper trading features.
 * Requires authentication for most operations.
 */

import { getAuthState } from './authService';
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
 * Format currency value
 */
export function formatCurrency(value: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
  }).format(value);
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

export default {
  getBrokerProfiles,
  getProductTypes,
  calculateFees,
  getPortfolios,
  getOrCreatePortfolio,
  getPortfolio,
  updatePortfolioSettings,
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
};
