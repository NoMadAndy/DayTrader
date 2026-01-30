/**
 * Data Services Index
 * 
 * Exports all data provider services and the unified data service.
 */

export { FinnhubProvider } from './finnhubProvider';
export { AlphaVantageProvider } from './alphaVantageProvider';
export { TwelveDataProvider } from './twelveDataProvider';
export { YahooFinanceProvider } from './yahooFinanceProvider';
export { NewsApiProvider } from './newsApiProvider';
// New news providers
export { MarketauxProvider, createMarketauxProvider } from './marketauxProvider';
export { FMPProvider, createFMPProvider } from './fmpProvider';
export { TiingoProvider, createTiingoProvider } from './tiingoProvider';
export { MediastackProvider, createMediastackProvider } from './mediastackProvider';
export { NewsdataProvider, createNewsdataProvider } from './newsdataProvider';
export { RSSProvider, getRSSProvider } from './rssProvider';
export type { RSSFeedConfig, RSSNewsItem } from './rssProvider';
export type { MarketauxNewsItem } from './marketauxProvider';

export { DataService, getDataService, configureDataService } from './dataService';
export { mlService } from './mlService';
export type { MLPrediction, MLPredictResponse, MLTrainStatus, MLModelInfo, MLServiceHealth } from './mlService';
export { getRateLimiter, PROVIDER_RATE_LIMITS, type RateLimitConfig, type RateLimiter } from './rateLimiter';

// RL Trading Service
export { rlTradingService } from './rlTradingService';
export type {
  AgentConfig,
  AgentStatus,
  TrainingStatus,
  TradingSignal,
  MultiSignalResponse,
  RLServiceHealth,
  HoldingPeriod,
  RiskProfile,
  TradingStyle,
  BrokerProfile,
  ConfigOption,
} from './rlTradingService';

// Auth Service
export {
  subscribeToAuth,
  getAuthState,
  initializeAuth,
  checkAuthStatus,
  register,
  login,
  logout,
  getAuthHeaders,
} from './authService';
export type { User, AuthState, AuthResult, AuthStatus } from './authService';

// User Settings Service
export {
  getUserSettings,
  updateUserSettings,
  getCustomSymbols,
  addCustomSymbolToServer,
  removeCustomSymbolFromServer,
  syncLocalSymbolsToServer,
  getWatchlistSettings,
  saveWatchlistSettings,
  DEFAULT_WATCHLIST_SETTINGS,
} from './userSettingsService';
export type { UserSettings, CustomSymbol, WatchlistSettings } from './userSettingsService';

// Watchlist Cache Service
export {
  getCachedSignals,
  setCachedSignals,
  getBatchCachedSignals,
  clearCachedSignals,
  isCacheValid,
} from './watchlistCacheService';
export type { CachedWatchlistSignals } from './watchlistCacheService';

// Best Symbol Service
export {
  getBestSymbolFromWatchlist,
  clearBestSymbolCache,
} from './bestSymbolService';

// ML Sentiment Service
export {
  checkMLSentimentAvailable,
  getMLSentimentStatus,
  analyzeMLSentiment,
  analyzeMLSentimentBatch,
  analyzeSentimentWithFallback,
  analyzeBatchWithFallback,
  resetMLServiceCache,
} from './mlSentimentService';
export type { MLSentimentResult, MLSentimentStatus } from './mlSentimentService';

export type {
  DataProvider,
  NewsProvider,
  DataProviderConfig,
  DataProviderConfigs,
  QuoteData,
  NewsItem,
  StockSearchResult,
  DataSourceType,
  NewsSourceType,
} from './types';

// Trading Service (Paper Trading / Börsenspiel)
export {
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
} from './tradingService';

// AI Trader Service
export {
  getAITraders,
  getAITrader,
  createAITrader,
  updateAITrader,
  deleteAITrader,
  startAITrader,
  stopAITrader,
  pauseAITrader,
  getAITraderDecisions,
  getAITraderDecision,
  getAITraderPositions,
  getAITraderReports,
  getDefaultPersonality,
} from './aiTraderService';
export type {
  AITrader,
  AITraderPersonality,
  AITraderDecision,
  AITraderDailyReport,
  AITraderStatus,
  DecisionType,
  SignalAgreement,
  CreateAITraderRequest,
  UpdateAITraderRequest,
  TradeReasoning,
  MarketContext,
  PortfolioSnapshot,
  AITraderCapitalConfig,
  AITraderRiskConfig,
  AITraderSignalWeights,
  AITraderSignalsConfig,
  AITraderTradingConfig,
  AITraderScheduleConfig,
  AITraderWatchlistConfig,
  AITraderSentimentConfig,
  AITraderLearningConfig,
  AITraderNotificationPrefs,
} from '../types/aiTrader';
