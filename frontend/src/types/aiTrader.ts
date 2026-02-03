/**
 * AI Trader Types
 * 
 * Types for AI trading agents and their decisions.
 */

// ============================================================================
// AI Trader Personality Configuration
// ============================================================================

export interface AITraderCapitalConfig {
  initialBudget: number;
  maxPositionSize: number;
  reserveCashPercent: number;
}

export interface AITraderRiskConfig {
  tolerance: 'conservative' | 'moderate' | 'aggressive';
  maxDrawdown: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  /** Allow short selling (betting on price decrease) */
  allowShortSelling?: boolean;
  maxShortPositions?: number;
  maxShortExposure?: number;
}

export interface AITraderSignalWeights {
  ml: number;
  rl: number;
  sentiment: number;
  technical: number;
}

export interface AITraderSignalsConfig {
  weights: AITraderSignalWeights;
  minAgreement: number;
  minSignalAgreement?: 'weak' | 'moderate' | 'strong';  // Agreement level string
  requireMultipleConfirmation?: boolean;  // Require multiple signals to confirm
}

export type TradingHorizon = 'scalping' | 'day' | 'swing' | 'position';

export interface AITraderTradingConfig {
  minConfidence: number;
  maxOpenPositions: number;
  diversification: boolean;
  /** Trading horizon: scalping (minutes), day (hours), swing (days), position (weeks) */
  horizon?: TradingHorizon;
  /** Target holding period in hours (auto-set based on horizon) */
  targetHoldingHours?: number;
  /** Maximum holding period in hours before forced close consideration */
  maxHoldingHours?: number;
}

export interface AITraderScheduleConfig {
  enabled: boolean;
  checkIntervalMinutes?: number;
  checkIntervalSeconds?: number;  // Alternative: interval in seconds
  tradingHoursOnly: boolean;
  timezone: string;
  tradingDays?: string[];
  tradingStart?: string;
  tradingEnd?: string;
  avoidMarketOpenMinutes?: number;
  avoidMarketCloseMinutes?: number;
}

export interface AITraderWatchlistConfig {
  symbols: string[];
  autoUpdate: boolean;
  useFullWatchlist?: boolean;  // If true, use user's entire watchlist
}

export interface AITraderSentimentConfig {
  enabled: boolean;
  minScore: number;
}

export interface AITraderLearningConfig {
  enabled: boolean;
  updateWeights: boolean;
  minSamples?: number;
}

export interface AITraderMLConfig {
  autoTrain?: boolean;
}

export interface AITraderSelfTrainingConfig {
  enabled: boolean;
  intervalMinutes: number;
  timesteps: number;
}

export interface AITraderPersonality {
  capital: AITraderCapitalConfig;
  risk: AITraderRiskConfig;
  signals: AITraderSignalsConfig;
  trading: AITraderTradingConfig;
  schedule: AITraderScheduleConfig;
  watchlist: AITraderWatchlistConfig;
  sentiment: AITraderSentimentConfig;
  learning: AITraderLearningConfig;
  /** ML service configuration */
  ml?: AITraderMLConfig;
  /** Self-training configuration */
  selfTraining?: AITraderSelfTrainingConfig;
  /** Name of the RL agent to use for signals (optional) */
  rlAgentName?: string;
  /** RL-specific settings (optional) */
  rl?: {
    enabled?: boolean;
    weight?: number;
    minConfidence?: number;
    selfTrainingEnabled?: boolean;
    selfTrainingIntervalMinutes?: number;
    selfTrainingTimesteps?: number;
  };
}

// ============================================================================
// AI Trader Main Interface
// ============================================================================

export type AITraderStatus = 'stopped' | 'running' | 'paused' | 'error';

export interface AITrader {
  id: number;
  portfolioId: number | null;
  name: string;
  avatar: string;
  description: string | null;
  personality: AITraderPersonality;
  status: AITraderStatus;
  statusMessage: string | null;
  tradingTime?: boolean; // Whether currently within trading hours
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  lastDecisionAt: string | null;
  lastTradeAt: string | null;
  totalDecisions: number;
  tradesExecuted: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  bestTradePnl: number | null;
  worstTradePnl: number | null;
  currentStreak: number;
  maxDrawdown: number;
}

// ============================================================================
// Decision & Reasoning Types
// ============================================================================

export type DecisionType = 'buy' | 'sell' | 'hold' | 'close' | 'skip' | 'short';
export type SignalAgreement = 'strong' | 'moderate' | 'weak' | 'mixed';

export interface TradeReasoning {
  summary?: string;
  signals?: {
    ml?: { score: number; confidence: number; prediction?: string };
    rl?: { score: number; confidence: number; action?: string };
    sentiment?: { score: number; confidence: number; sentiment?: string };
    technical?: { score: number; confidence: number; indicators?: Record<string, unknown> };
  };
  factors?: {
    positive?: string[];
    negative?: string[];
    neutral?: string[];
  };
  recommendation?: string;
  warnings?: string[];
  // Trade execution parameters (from Python backend)
  quantity?: number;
  price?: number;
  stop_loss?: number;
  take_profit?: number;
  // Risk assessment (from Python backend)
  risk_checks_passed?: boolean;
  risk_warnings?: string[];
  risk_blockers?: string[];
}

export interface MarketContext {
  timestamp?: string;
  marketPhase?: string;
  volatility?: number;
  trend?: string;
  volume?: number;
  indicators?: Record<string, number>;
  newsCount?: number;
  sentimentAvg?: number;
}

export interface PortfolioSnapshot {
  timestamp?: string;
  totalValue?: number;
  cashBalance?: number;
  positionsValue?: number;
  openPositions?: number;
  totalPnl?: number;
  dailyPnl?: number;
  marginUsed?: number;
  availableCapital?: number;
}

export interface AITraderDecision {
  id: number;
  aiTraderId: number;
  timestamp: string;
  symbol: string;
  symbolsAnalyzed: string[];
  decisionType: DecisionType;
  reasoning: TradeReasoning;
  executed: boolean;
  positionId: number | null;
  orderId: number | null;
  executionError: string | null;
  confidence: number | null;
  weightedScore: number | null;
  mlScore: number | null;
  rlScore: number | null;
  sentimentScore: number | null;
  technicalScore: number | null;
  signalAgreement: SignalAgreement | null;
  summaryShort: string | null;
  marketContext: MarketContext;
  portfolioSnapshot: PortfolioSnapshot;
  outcomePnl: number | null;
  outcomePnlPercent: number | null;
  outcomeHoldingDays: number | null;
  outcomeWasCorrect: boolean | null;
}

// ============================================================================
// Daily Report Types
// ============================================================================

export interface TradeDetail {
  symbol: string;
  pnl: number;
  pnl_percent: number;
  holding_days: number | null;
}

export interface AITraderDailyReport {
  id: number;
  aiTraderId: number;
  reportDate: string;
  startValue: number | null;
  endValue: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  feesPaid: number | null;
  checksPerformed: number;
  decisionsAnalyzed: number;
  tradesExecuted: number;
  positionsOpened: number;
  positionsClosed: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  bestTrade: TradeDetail | null;
  worstTrade: TradeDetail | null;
  signalAccuracy: Record<string, unknown> | null;
  openPositions: Record<string, unknown> | null;
  insights: string[];
  createdAt: string;
}

// ============================================================================
// Signal Accuracy Types
// ============================================================================

export interface SignalAccuracyMetrics {
  accuracy: number | null;
  totalSignals: number;
  correct: number;
  incorrect: number;
}

export interface SignalAccuracyData {
  ml: SignalAccuracyMetrics;
  rl: SignalAccuracyMetrics;
  sentiment: SignalAccuracyMetrics;
  technical: SignalAccuracyMetrics;
  overall: {
    accuracy: number | null;
    totalTrades: number;
    correct: number;
    incorrect: number;
  };
}

// ============================================================================
// Weight History Types
// ============================================================================

export interface WeightHistoryEntry {
  id: number;
  aiTraderId: number;
  timestamp: string;
  oldWeights: AITraderSignalWeights;
  newWeights: AITraderSignalWeights;
  reason: string;
  accuracySnapshot: SignalAccuracyData | null;
}

// ============================================================================
// Insights Types
// ============================================================================

export interface AITraderInsightsResponse {
  insights: string[];
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface CreateAITraderRequest {
  name: string;
  description?: string;
  personality?: AITraderPersonality;
  initialCapital?: number;
}

export interface UpdateAITraderRequest {
  name?: string;
  avatar?: string;
  description?: string;
  personality?: AITraderPersonality;
  status?: AITraderStatus;
  statusMessage?: string;
}

export interface AITraderListResponse {
  traders: AITrader[];
  total: number;
}

// ============================================================================
// Notification Preferences Types
// ============================================================================

export interface AITraderNotificationPrefs {
  id: number;
  userId: number;
  aiTraderId: number;
  notifyTrades: boolean;
  notifyPositionOpened: boolean;
  notifyPositionClosed: boolean;
  notifyStopLossTriggered: boolean;
  notifyReasoning: boolean;
  notifyDailySummary: boolean;
  notifyWeeklySummary: boolean;
  notifySignificantPnl: boolean;
  significantPnlThreshold: number;
  channelBrowser: boolean;
  channelBrowserSound: boolean;
  channelEmail: boolean;
  emailAddress: string | null;
  batchNotifications: boolean;
  batchIntervalMinutes: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// SSE Event Types
// ============================================================================

export type AITraderEventType = 
  | 'connected' 
  | 'heartbeat' 
  | 'status_changed'
  | 'status_update'  // Used by polling fallback
  | 'analyzing' 
  | 'decision_made' 
  | 'trade_executed' 
  | 'position_closed' 
  | 'error';

export interface AITraderEvent {
  type: AITraderEventType;
  traderId?: number;
  all?: boolean;
  timestamp?: string;
  data?: {
    traderId?: number;
    traderName?: string;
    oldStatus?: AITraderStatus;
    newStatus?: AITraderStatus;
    message?: string;
    symbols?: string[];
    phase?: string;
    progress?: number;
    timestamp?: string;
    error?: string;
    [key: string]: unknown;
  };
}

export interface SignalDetail {
  score: number;
  confidence: number;
  weight?: number;
  prediction?: string;
  action?: string;
  sentiment?: string;
  indicators?: Record<string, unknown>;
}

