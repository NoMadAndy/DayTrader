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
export { DataService, getDataService, configureDataService } from './dataService';
export { mlService } from './mlService';
export type { MLPrediction, MLPredictResponse, MLTrainStatus, MLModelInfo, MLServiceHealth } from './mlService';

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
} from './userSettingsService';
export type { UserSettings, CustomSymbol } from './userSettingsService';

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
  DataProviderConfig,
  DataProviderConfigs,
  QuoteData,
  NewsItem,
  StockSearchResult,
  DataSourceType,
} from './types';
