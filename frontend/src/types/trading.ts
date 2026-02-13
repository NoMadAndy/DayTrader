/**
 * Paper Trading / Stock Market Simulation Types
 */

// ============================================================================
// Fee & Broker Types
// ============================================================================

export interface StockCommission {
  type: 'flat' | 'percentage' | 'mixed';
  flatFee: number;
  percentageFee: number;
  minimumFee: number;
  maximumFee: number;
}

export interface CfdOvernightFees {
  longRate: number;  // Daily percentage rate
  shortRate: number;
}

export interface LeverageLimits {
  stock: number;
  index: number;
  forex: number;
  crypto: number;
}

export interface BrokerProfile {
  name: string;
  description: string;
  stockCommission: StockCommission;
  spreadPercent: number;
  cfdOvernight: CfdOvernightFees;
  leverageLimits: LeverageLimits;
}

export type BrokerProfileId = 'discount' | 'standard' | 'premium' | 'marketMaker';

export interface BrokerProfiles {
  [key: string]: BrokerProfile;
}

// ============================================================================
// Product Types
// ============================================================================

export type ProductType = 'stock' | 'cfd' | 'knockout' | 'factor' | 'warrant';

export interface ProductTypeConfig {
  name: string;
  defaultLeverage: number;
  maxLeverage: number;
  marginRequired: number | null;
  overnightFee: boolean;
  canShort: boolean;
  hasKnockout?: boolean;
  dailyReset?: boolean;
  hasExpiry?: boolean;
  hasTimeDecay?: boolean;
}

export interface ProductTypes {
  [key: string]: ProductTypeConfig;
}

// ============================================================================
// Portfolio Types
// ============================================================================

export interface PortfolioSettings {
  brokerProfile?: BrokerProfileId;
  maxPositionPercent?: number;
  maxLeverage?: number;
  marginCallLevel?: number;
  liquidationLevel?: number;
}

export interface Portfolio {
  id: number;
  userId: number;
  name: string;
  initialCapital: number;
  cashBalance: number;
  currency: string;
  brokerProfile: BrokerProfileId;
  settings: PortfolioSettings;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Position Types
// ============================================================================

export type PositionSide = 'long' | 'short';
export type CloseReason = 'user' | 'stop_loss' | 'take_profit' | 'knockout' | 'margin_call' | 'expiry' | 'reset';

// Warrant/Option specific types
export type OptionType = 'call' | 'put';

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho?: number;
}

export interface WarrantPriceResult {
  success: boolean;
  warrant_price: number;
  intrinsic_value: number;
  time_value: number;
  greeks: Greeks;
  moneyness: 'ITM' | 'ATM' | 'OTM';
  leverage_ratio: number;
  break_even: number;
  days_to_expiry: number;
  implied_annual_cost: number;
}

export interface OptionChainEntry {
  strike: number;
  days: number;
  price: number;
  intrinsic: number;
  timeValue: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  moneyness: 'ITM' | 'ATM' | 'OTM';
  leverage: number;
  breakEven: number;
}

export interface OptionChainResult {
  success: boolean;
  underlying_price: number;
  volatility: number;
  ratio: number;
  strikes: number[];
  expiry_days: number[];
  calls: OptionChainEntry[];
  puts: OptionChainEntry[];
}

// ============================================================================
// Real Options Chain Types (Triple-Hybrid)
// ============================================================================

export type OptionDataSource = 'yahoo' | 'emittent' | 'theoretical';

export interface RealOptionEntry {
  strike: number;
  days: number;
  optionType: 'call' | 'put';
  expiryDate: string;           // ISO date (YYYY-MM-DD)
  // Prices
  lastPrice: number;
  bid: number;
  ask: number;
  // Market data
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  // Classification
  moneyness: 'ITM' | 'ATM' | 'OTM';
  inTheMoney: boolean;
  // Source info
  source: OptionDataSource;
  contractSymbol?: string;
  // Emittent-specific (German warrants)
  wkn?: string;
  isin?: string;
  emittent?: string;
  productName?: string;
  ratio?: number;
  spread?: number;
  // Theoretical fallback fields
  price?: number;
  intrinsic?: number;
  timeValue?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  leverage?: number;
  breakEven?: number;
}

export interface RealOptionChainResult {
  success: boolean;
  source: OptionDataSource;
  source_priority?: string[];
  symbol: string;
  underlying_price: number;
  strikes: number[];
  expiry_days: number[];
  calls: RealOptionEntry[];
  puts: RealOptionEntry[];
  cached?: boolean;
  // Optional fields
  expiry_dates?: string[];
  volatility?: number;
  ratio?: number;
  emittent?: string;
}

export interface Position {
  id: number;
  portfolioId: number;
  userId: number;
  symbol: string;
  productType: ProductType;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  currentPrice: number | null;
  leverage: number;
  marginUsed: number | null;
  knockoutLevel: number | null;
  expiryDate: string | null;
  stopLoss: number | null;
  takeProfit: number | null;
  totalFeesPaid: number;
  totalOvernightFees: number;
  daysHeld: number;
  openedAt: string;
  closedAt: string | null;
  closeReason: CloseReason | null;
  closePrice: number | null;
  realizedPnl: number | null;
  isOpen: boolean;
  // Warrant-specific fields
  strikePrice: number | null;
  optionType: OptionType | null;
  underlyingSymbol: string | null;
  warrantRatio: number;
  impliedVolatility: number | null;
  greeks: Greeks | null;
  underlyingPrice: number | null;
}

// Extended position with calculated fields
export interface PositionWithPnL extends Position {
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  leveragedPnlPercent: number;
  notionalValue: number;
  distanceToLiquidation: number | null;
  liquidationPrice: number | null;
  // Additional calculated fields from backend
  hoursHeld?: number;
  distanceToStopLoss?: number | null;
  distanceToTakeProfit?: number | null;
  breakEvenPrice?: number | null;
  dailyPnl?: number | null;
  dailyPnlPercent?: number | null;
  marketState?: string;
  priceChange?: number | null;
  priceChangePercent?: number | null;
  investedValue?: number;
  openFee?: number;
}

// ============================================================================
// Order Types
// ============================================================================

export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type OrderSide = 'buy' | 'sell' | 'short';
export type OrderStatus = 'pending' | 'filled' | 'cancelled' | 'rejected';

export interface Order {
  id: number;
  portfolioId: number;
  userId: number;
  positionId: number | null;
  symbol: string;
  productType: ProductType;
  orderType: OrderType;
  side: OrderSide;
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  leverage: number;
  knockoutLevel: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  commissionFee: number;
  spreadCost: number;
  totalFees: number;
  status: OrderStatus;
  errorMessage: string | null;
  createdAt: string;
  filledAt: string | null;
  filledPrice: number | null;
  cancelledAt: string | null;
}

// ============================================================================
// Transaction Types
// ============================================================================

export type TransactionType = 'buy' | 'sell' | 'close' | 'overnight_fee' | 'reset' | 'deposit' | 'withdrawal';

export interface Transaction {
  id: number;
  portfolioId: number;
  orderId: number | null;
  positionId: number | null;
  transactionType: TransactionType;
  symbol: string | null;
  side: OrderSide | null;
  productType: ProductType | null;
  quantity: number | null;
  price: number | null;
  totalValue: number | null;
  commissionFee: number;
  spreadCost: number;
  overnightFee: number;
  otherFees: number;
  totalFees: number;
  realizedPnl: number | null;
  cashImpact: number | null;
  balanceAfter: number | null;
  description: string | null;
  executedAt: string;
}

// ============================================================================
// Fee Types
// ============================================================================

export interface FeeCalculation {
  commission: number;
  spreadCost: number;
  totalFees: number;
  effectivePrice: number;
  breakEvenMove: number;
  marginRequired: number;
  notionalValue: number;
  leveragedValue: number;
}

export interface FeeSummary {
  commission: number;
  spread: number;
  overnight: number;
  other: number;
  total: number;
}

// ============================================================================
// Metrics Types
// ============================================================================

export interface PortfolioMetrics {
  portfolioId: number;
  totalValue: number;
  cashBalance: number;
  positionsValue: number;
  marginUsed: number;
  freeMargin: number;
  marginLevel: number | null;
  
  unrealizedPnl: number;
  realizedPnl: number;
  grossPnl: number;
  netPnl: number;
  totalReturn: number;
  
  totalFees: number;
  feeBreakdown: FeeSummary;
  
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  
  isMarginWarning: boolean;
  isLiquidationRisk: boolean;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ExecuteOrderRequest {
  portfolioId: number;
  symbol: string;
  side: OrderSide;
  quantity: number;
  currentPrice: number;
  productType?: ProductType;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
  knockoutLevel?: number;
  // Warrant-specific
  strikePrice?: number;
  optionType?: OptionType;
  underlyingSymbol?: string;
  warrantRatio?: number;
  expiryDate?: string;
  impliedVolatility?: number;
  greeks?: Greeks;
  underlyingPrice?: number; // The stock/underlying price at time of warrant trade
}

export interface ExecuteOrderResponse {
  success: boolean;
  error?: string;
  order?: Order;
  position?: Position;
  fees?: FeeCalculation;
  cashImpact?: number;
  realizedPnl?: number;
  newBalance?: number;
}

export interface ClosePositionRequest {
  currentPrice: number;
}

export interface ClosePositionResponse {
  success: boolean;
  error?: string;
  realizedPnl?: number;
  fees?: number;
  cashImpact?: number;
  newBalance?: number;
}

export interface CalculateFeesRequest {
  productType: ProductType;
  side: OrderSide;
  quantity: number;
  price: number;
  leverage?: number;
  brokerProfile?: BrokerProfileId;
}

// ============================================================================
// Extended Features: Pending Orders, Equity Curve, Leaderboard
// ============================================================================

export interface CreatePendingOrderRequest {
  portfolioId: number;
  symbol: string;
  side: OrderSide;
  quantity: number;
  orderType: 'limit' | 'stop' | 'stop_limit';
  limitPrice?: number;
  stopPrice?: number;
  productType?: ProductType;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
  knockoutLevel?: number;
}

export interface CreatePendingOrderResponse {
  success: boolean;
  error?: string;
  order?: Order;
  reservedCash?: number;
}

export interface CancelOrderResponse {
  success: boolean;
  error?: string;
  returnedCash?: number;
}

export interface CheckTriggersRequest {
  prices: Record<string, number>;
}

export interface CheckTriggersResponse {
  executedOrders: Array<{
    orderId: number;
    success: boolean;
    order?: Order;
    position?: Position;
  }>;
  triggeredPositions: Array<{
    positionId: number;
    symbol: string;
    reason: 'stop_loss' | 'take_profit' | 'knockout' | 'margin_call';
    closePrice: number;
    realizedPnl: number;
  }>;
}

export interface EquityCurvePoint {
  date: string;
  totalValue: number;
  cashBalance: number;
  positionsValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  marginUsed: number;
  totalFeesPaid?: number;
}

export interface LeaderboardEntry {
  rank: number;
  portfolioId: number;
  name: string;
  username: string;
  initialCapital: number;
  currentValue: number;
  totalReturnPct: number;
  totalTrades: number;
  winningTrades: number;
  winRate: number;
  isAITrader: boolean;
  avatar?: string;
  aiTraderId?: number;
}

export interface UserRank {
  rank: number | null;
  totalParticipants: number;
  currentValue: number;
  totalReturnPct: number;
  message?: string;
}

// ============================================================================
// UI State Types
// ============================================================================

export interface TradingFormState {
  symbol: string;
  productType: ProductType;
  side: OrderSide;
  quantity: number;
  leverage: number;
  stopLoss: number | null;
  takeProfit: number | null;
  knockoutLevel: number | null;
}

export interface OrderPreview {
  fees: FeeCalculation;
  estimatedCost: number;
  estimatedMargin: number;
  breakEvenPrice: number;
  riskRewardRatio: number | null;
  maxLoss: number | null;
  maxProfit: number | null;
}
