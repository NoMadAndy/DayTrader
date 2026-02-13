/**
 * Dashboard Page
 * 
 * Unified trading view with Live Trading and Backtesting modes.
 * Includes stock chart, forecasts, news, trading signals, and historical simulations.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StockChart, ForecastPanel, MLForecastPanel, StockSelector, IndicatorControls, NewsPanel, TradingSignalPanel, CompanyInfoPanel, RLAdvisorPanel, type NewsItemWithSentiment } from '../components';
import { type DataTimestamps } from '../components/StockSelector';
import { useStockData, useSimpleAutoRefresh } from '../hooks';
import { generateForecast } from '../utils/forecast';
import { getAuthState, subscribeToAuth, type AuthState } from '../services/authService';
import { 
  getOrCreatePortfolio, executeMarketOrder, getPortfolioMetrics, getHistoricalPrices,
  createBacktestSession, getBacktestSessions, getBacktestSession,
  executeBacktestOrder, closeBacktestPosition, advanceBacktestTime,
  getBacktestResults, deleteBacktestSession,
  formatCurrency as formatCurrencyBacktest, formatPercent,
  type BacktestSession, type BacktestPosition, type BacktestResults,
} from '../services/tradingService';
import { useSettings } from '../contexts/SettingsContext';
import { getSignalSourceSettings, saveSignalSourceSettings, getCustomSymbols } from '../services/userSettingsService';
import { rlTradingService } from '../services/rlTradingService';
import { POPULAR_STOCKS } from '../utils/defaultStocks';
import type { RLSignalInput, SignalSourceConfig } from '../utils/tradingSignals';
import type { Portfolio, PortfolioMetrics, OrderSide, ProductType } from '../types/trading';
import type { OHLCV, ForecastResult } from '../types/stock';
import { log } from '../utils/logger';

// Mode type for unified dashboard
type DashboardMode = 'live' | 'backtest';

// ML Prediction type for trading signals
interface MLPrediction {
  date: string;
  day: number;
  predicted_price: number;
  confidence: number;
  change_pct: number;
}

interface DashboardPageProps {
  selectedSymbol: string;
  onSymbolChange: (symbol: string) => void;
}

export function DashboardPage({ selectedSymbol, onSymbolChange }: DashboardPageProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, formatCurrency } = useSettings();
  
  // Mode state - can be set via URL param (?mode=backtest)
  const [mode, setMode] = useState<DashboardMode>(() => {
    const urlMode = searchParams.get('mode');
    return urlMode === 'backtest' ? 'backtest' : 'live';
  });

  // Update URL when mode changes
  const handleModeChange = useCallback((newMode: DashboardMode) => {
    setMode(newMode);
    if (newMode === 'backtest') {
      setSearchParams({ mode: 'backtest' });
    } else {
      setSearchParams({});
    }
  }, [setSearchParams]);

  // Auth state for backtest
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  useEffect(() => {
    return subscribeToAuth(setAuthState);
  }, []);

  // Live mode data
  const { data: stockData, isLoading, refetch } = useStockData(selectedSymbol);

  // Quick Trade State
  const [showQuickTrade, setShowQuickTrade] = useState(false);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [metrics, setMetrics] = useState<PortfolioMetrics | null>(null);
  const [tradeQuantity, setTradeQuantity] = useState('1');
  const [tradeSide, setTradeSide] = useState<OrderSide>('buy');
  const [productType, setProductType] = useState<ProductType>('stock');
  const [isExecuting, setIsExecuting] = useState(false);
  const [tradeResult, setTradeResult] = useState<{ success: boolean; message: string } | null>(null);
  const quickTradeButtonRef = useRef<HTMLButtonElement>(null);
  const [dropdownTop, setDropdownTop] = useState<number>(0);

  // Calculate dropdown position when opening on mobile
  useEffect(() => {
    if (showQuickTrade && quickTradeButtonRef.current) {
      const rect = quickTradeButtonRef.current.getBoundingClientRect();
      // Position dropdown just below the button
      setDropdownTop(rect.bottom + 8);
    }
  }, [showQuickTrade]);

  // Load portfolio data when quick trade is opened
  useEffect(() => {
    const loadPortfolio = async () => {
      const { isAuthenticated } = getAuthState();
      if (!isAuthenticated) return;
      try {
        const p = await getOrCreatePortfolio();
        setPortfolio(p);
        if (p) {
          const m = await getPortfolioMetrics(p.id);
          setMetrics(m);
        }
      } catch (err) {
        log.error('Failed to load portfolio:', err);
      }
    };
    if (showQuickTrade) {
      loadPortfolio();
    }
  }, [showQuickTrade]);

  // Execute quick trade
  const handleQuickTrade = async () => {
    if (!portfolio || !currentPrice) return;
    setIsExecuting(true);
    setTradeResult(null);
    try {
      const qty = parseFloat(tradeQuantity);
      if (isNaN(qty) || qty <= 0) {
        setTradeResult({ success: false, message: t('dashboard.invalidQuantity') });
        return;
      }
      const result = await executeMarketOrder({
        portfolioId: portfolio.id,
        symbol: selectedSymbol,
        side: tradeSide,
        quantity: qty,
        currentPrice: currentPrice,
        productType: productType,
      });
      if (result.success) {
        const actionKey = tradeSide === 'buy' ? 'dashboard.purchaseSuccess' : tradeSide === 'sell' ? 'dashboard.sellSuccess' : 'dashboard.shortSuccess';
        setTradeResult({ success: true, message: `${t(actionKey)} ${formatCurrency(result.newBalance || 0)}` });
        // Refresh metrics
        const m = await getPortfolioMetrics(portfolio.id);
        setMetrics(m);
      } else {
        setTradeResult({ success: false, message: result.error || t('dashboard.tradeFailed') });
      }
    } catch (err) {
      setTradeResult({ success: false, message: err instanceof Error ? err.message : 'Unbekannter Fehler' });
    } finally {
      setIsExecuting(false);
    }
  };

  // Local state for live price updates (doesn't cause full re-render)
  const [_livePrice, setLivePrice] = useState<{ price: number; change: number } | null>(null);
  
  // Lightweight price refresh - only updates the displayed price
  const refreshPriceOnly = useCallback(async () => {
    if (!stockData || stockData.data.length === 0) return;
    
    // Get latest cached data
    const lastPoint = stockData.data[stockData.data.length - 1];
    const prevPoint = stockData.data.length > 1 ? stockData.data[stockData.data.length - 2] : lastPoint;
    const change = ((lastPoint.close - prevPoint.close) / prevPoint.close) * 100;
    
    // Only update state if price changed
    setLivePrice(prev => {
      if (prev?.price === lastPoint.close) return prev;
      return { price: lastPoint.close, change };
    });
  }, [stockData]);

  // Auto-refresh price every second (lightweight, UI-friendly)
  useSimpleAutoRefresh(refreshPriceOnly, { interval: 1000, enabled: !!stockData });

  // State for ML predictions (shared with NewsPanel for combined trading signals)
  const [mlPredictions, setMlPredictions] = useState<MLPrediction[] | null>(null);
  
  // State for news sentiment (from NewsPanel callback)
  const [newsWithSentiment, setNewsWithSentiment] = useState<NewsItemWithSentiment[]>([]);

  // State for RL signal configuration and signals
  const [signalConfig, setSignalConfig] = useState<SignalSourceConfig>(() => {
    const settings = getSignalSourceSettings();
    return {
      enableSentiment: settings.enableSentiment,
      enableTechnical: settings.enableTechnical,
      enableMLPrediction: settings.enableMLPrediction,
      enableRLAgents: settings.enableRLAgents,
      customWeights: settings.customWeights,
    };
  });
  const [rlSignals, setRlSignals] = useState<RLSignalInput[]>([]);
  const [selectedRLAgents, setSelectedRLAgents] = useState<string[]>(() => {
    const settings = getSignalSourceSettings();
    return settings.selectedRLAgents || [];
  });
  const [rlServiceAvailable, setRlServiceAvailable] = useState(false);

  // Handler for signal config changes from TradingSignalPanel
  const handleSignalConfigChange = useCallback((newConfig: SignalSourceConfig) => {
    setSignalConfig(newConfig);
    // Persist to localStorage
    const currentSettings = getSignalSourceSettings();
    saveSignalSourceSettings({
      ...currentSettings,
      ...newConfig,
    });
  }, []);

  // Check RL service availability on mount
  useEffect(() => {
    const checkRLService = async () => {
      const available = await rlTradingService.isAvailable();
      setRlServiceAvailable(available);
    };
    checkRLService();
  }, []);

  // Data freshness timestamps
  const [dataTimestamps, setDataTimestamps] = useState<DataTimestamps>({
    financial: null,
    news: null,
    mlModel: null,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Refs for refresh callbacks from child components
  const newsRefreshRef = useRef<(() => void) | null>(null);
  const mlRefreshRef = useRef<(() => void) | null>(null);
  
  // Track last loaded data to detect actual changes
  const lastStockDataRef = useRef<string | null>(null);

  // Update financial data timestamp when stock data actually changes
  useEffect(() => {
    if (stockData && !isLoading) {
      // Create a simple fingerprint of the data
      const dataFingerprint = `${stockData.symbol}-${stockData.data.length}-${stockData.data[stockData.data.length - 1]?.close}`;
      
      if (lastStockDataRef.current !== dataFingerprint) {
        lastStockDataRef.current = dataFingerprint;
        setDataTimestamps(prev => ({
          ...prev,
          financial: new Date(),
        }));
      }
    }
  }, [stockData, isLoading]);

  // Reload signal config when it changes in settings
  useEffect(() => {
    const checkSettings = () => {
      const settings = getSignalSourceSettings();
      setSignalConfig({
        enableSentiment: settings.enableSentiment,
        enableTechnical: settings.enableTechnical,
        enableMLPrediction: settings.enableMLPrediction,
        enableRLAgents: settings.enableRLAgents,
        customWeights: settings.customWeights,
      });
      setSelectedRLAgents(settings.selectedRLAgents || []);
    };
    
    // Check settings on storage events (when changed in another tab or settings page)
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'daytrader_signal_sources') {
        checkSettings();
      }
    };
    
    window.addEventListener('storage', handleStorage);
    
    // Also check periodically (for same-tab changes)
    const interval = setInterval(checkSettings, 5000);
    
    return () => {
      window.removeEventListener('storage', handleStorage);
      clearInterval(interval);
    };
  }, []);

  // Track last stock data fingerprint to avoid unnecessary RL signal reloads
  const lastRLDataFingerprintRef = useRef<string | null>(null);
  // Track current symbol for race condition prevention
  const currentSymbolRef = useRef<string>(selectedSymbol);
  
  // Keep symbol ref updated
  useEffect(() => {
    currentSymbolRef.current = selectedSymbol;
    // Clear stale data when symbol changes
    setRlSignals([]);
    setMlPredictions(null);
    lastRLDataFingerprintRef.current = null;
  }, [selectedSymbol]);

  // Load RL signals when enabled and data is available
  // Only reload when data actually changes (not on every stockData reference change)
  useEffect(() => {
    const loadRLSignals = async () => {
      if (!signalConfig.enableRLAgents || selectedRLAgents.length === 0) {
        setRlSignals([]);
        lastRLDataFingerprintRef.current = null;
        return;
      }
      
      if (!stockData || stockData.data.length < 100) {
        return;
      }

      // Create fingerprint to detect actual data changes
      const lastPoint = stockData.data[stockData.data.length - 1];
      const dataFingerprint = `${stockData.symbol}-${stockData.data.length}-${lastPoint?.time}`;
      const requestSymbol = stockData.symbol; // Capture for race condition check
      
      // Skip if data hasn't actually changed
      if (lastRLDataFingerprintRef.current === dataFingerprint) {
        return;
      }
      lastRLDataFingerprintRef.current = dataFingerprint;
      
      try {
        // First, validate that selected agents actually exist
        const availableAgents = await rlTradingService.listAgents();
        const availableNames = new Set(availableAgents.filter(a => a.is_trained).map(a => a.name));
        const validAgents = selectedRLAgents.filter(name => availableNames.has(name));
        
        if (validAgents.length === 0) {
          log.warn('No valid RL agents found. Selected agents may have been deleted.');
          setRlSignals([]);
          return;
        }
        
        const response = await rlTradingService.getMultiSignals(
          validAgents,
          stockData.data
        );
        
        // Race condition check: Ensure symbol hasn't changed during async call
        if (currentSymbolRef.current !== requestSymbol) {
          log.info(`[Dashboard] Symbol changed during RL fetch (${requestSymbol} -> ${currentSymbolRef.current}), discarding stale results`);
          return;
        }
        
        if (response && response.signals) {
          const signals: RLSignalInput[] = Object.entries(response.signals)
            .filter(([_, signal]) => !signal.error)
            .map(([agentName, signal]) => {
              // Aggregate detailed action probabilities into buy/sell/hold
              // RL service returns: hold, buy_small, buy_medium, buy_large, sell_small, sell_medium, sell_all
              const probs = signal.action_probabilities;
              const aggregatedProbs = {
                buy: (probs.buy_small || 0) + (probs.buy_medium || 0) + (probs.buy_large || 0),
                sell: (probs.sell_small || 0) + (probs.sell_medium || 0) + (probs.sell_all || 0),
                hold: probs.hold || 0,
              };
              
              return {
                signal: signal.signal,
                confidence: signal.confidence,
                action_probabilities: aggregatedProbs,
                agent_name: agentName,
                agent_style: signal.agent_style,
                holding_period: signal.holding_period,
              };
            });
          setRlSignals(signals);
        }
      } catch (err) {
        log.warn('Failed to load RL signals:', err);
        setRlSignals([]);
      }
    };
    
    loadRLSignals();
  }, [signalConfig.enableRLAgents, selectedRLAgents, stockData]);

  // Track last news data to detect actual changes
  const lastNewsFingerprintRef = useRef<string | null>(null);
  
  // Track last ML predictions to detect actual changes  
  const lastMLPredictionRef = useRef<string | null>(null);

  // Callback to receive ML predictions from MLForecastPanel
  const handleMLPredictionsChange = useCallback((predictions: MLPrediction[] | null) => {
    setMlPredictions(predictions);
    if (predictions && predictions.length > 0) {
      const predFingerprint = `${predictions[0].date}-${predictions[0].predicted_price}`;
      if (lastMLPredictionRef.current !== predFingerprint) {
        lastMLPredictionRef.current = predFingerprint;
        setDataTimestamps(prev => ({
          ...prev,
          mlModel: new Date(),
        }));
      }
    } else {
      // Clear ML timestamp when no model/predictions available for current symbol
      lastMLPredictionRef.current = null;
      setDataTimestamps(prev => ({
        ...prev,
        mlModel: null,
      }));
    }
  }, []);

  // Callback to receive sentiment data from NewsPanel
  const handleSentimentChange = useCallback((items: NewsItemWithSentiment[]) => {
    setNewsWithSentiment(items);
    if (items.length > 0) {
      // Only update timestamp when news actually changes (count or first headline)
      const newsFingerprint = `${items.length}-${items[0]?.headline?.substring(0, 30) || ''}`;
      if (lastNewsFingerprintRef.current !== newsFingerprint) {
        lastNewsFingerprintRef.current = newsFingerprint;
        setDataTimestamps(prev => ({
          ...prev,
          news: new Date(),
        }));
      }
    } else {
      // Clear fingerprint when no news
      lastNewsFingerprintRef.current = null;
    }
  }, []);

  // Callback to register news refresh function
  const handleNewsRefreshRegister = useCallback((refreshFn: () => void) => {
    newsRefreshRef.current = refreshFn;
  }, []);

  // Callback to register ML refresh function
  const handleMLRefreshRegister = useCallback((refreshFn: () => void) => {
    mlRefreshRef.current = refreshFn;
  }, []);

  // Unified refresh all data
  const handleRefreshAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Refresh financial data
      refetch();
      
      // Refresh news if callback registered
      if (newsRefreshRef.current) {
        newsRefreshRef.current();
      }
      
      // Refresh ML predictions if callback registered
      if (mlRefreshRef.current) {
        mlRefreshRef.current();
      }
    } finally {
      // Give some time for visual feedback
      setTimeout(() => setIsRefreshing(false), 1000);
    }
  }, [refetch]);

  // Collapsible section states (default: collapsed)
  const [showChart, setShowChart] = useState(false);

  // Chart indicator toggles (Bollinger, MACD, RSI, Volume enabled by default)
  const [showSMA20, setShowSMA20] = useState(false);
  const [showSMA50, setShowSMA50] = useState(false);
  const [showEMA12, setShowEMA12] = useState(false);
  const [showEMA26, setShowEMA26] = useState(false);
  const [showBollingerBands, setShowBollingerBands] = useState(true);
  const [showMACD, setShowMACD] = useState(true);
  const [showRSI, setShowRSI] = useState(true);
  const [showVolume, setShowVolume] = useState(true);

  // Generate forecast when stock data changes (derived state)
  const forecast = useMemo(() => {
    if (stockData && stockData.data.length > 0) {
      return generateForecast(stockData.data);
    }
    return null;
  }, [stockData]);

  const handleIndicatorToggle = (indicator: string, value: boolean) => {
    switch (indicator) {
      case 'showSMA20': setShowSMA20(value); break;
      case 'showSMA50': setShowSMA50(value); break;
      case 'showEMA12': setShowEMA12(value); break;
      case 'showEMA26': setShowEMA26(value); break;
      case 'showBollingerBands': setShowBollingerBands(value); break;
      case 'showMACD': setShowMACD(value); break;
      case 'showRSI': setShowRSI(value); break;
      case 'showVolume': setShowVolume(value); break;
    }
  };

  // ============================================================================
  // BACKTEST MODE STATE (declared before currentPrice which depends on it)
  // ============================================================================

  const [sessions, setSessions] = useState<BacktestSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [activeSession, setActiveSession] = useState<BacktestSession | null>(null);
  const [results, setResults] = useState<BacktestResults | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [newStartDate, setNewStartDate] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [newCapital, setNewCapital] = useState(100000);

  const [backtestSymbol, setBacktestSymbol] = useState('AAPL');
  const [customSymbol, setCustomSymbol] = useState('');
  const [userSymbols, setUserSymbols] = useState<string[]>([]);
  const [backtestTradeSide, setBacktestTradeSide] = useState<'buy' | 'sell'>('buy');
  const [backtestTradeQuantity, setBacktestTradeQuantity] = useState(10);
  const [backtestCurrentPrice, setBacktestCurrentPrice] = useState<number | null>(null);
  const [historicalData, setHistoricalData] = useState<any[]>([]);

  const allSymbols = useMemo(() => {
    const popularSymbols = POPULAR_STOCKS.map(s => s.symbol);
    const combined = [...new Set([...userSymbols, ...popularSymbols])];
    return combined.sort();
  }, [userSymbols]);

  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(true);
  const [showIndicators, setShowIndicators] = useState(false);
  const [showBacktestChart, setShowBacktestChart] = useState(false);
  const [backtestMlPredictions, setBacktestMlPredictions] = useState<MLPrediction[] | null>(null);

  // ============================================================================
  // CURRENT PRICE (shared by live and backtest modes)
  // ============================================================================

  const currentPrice = useMemo(() => {
    if (mode === 'backtest' && backtestCurrentPrice) {
      return backtestCurrentPrice;
    }
    if (!stockData || stockData.data.length === 0) return 0;
    return stockData.data[stockData.data.length - 1].close;
  }, [stockData, mode, backtestCurrentPrice]);

  // ============================================================================
  // BACKTEST MODE LOGIC (effects and handlers)
  // ============================================================================

  const handleBacktestMLPredictionsChange = useCallback((predictions: MLPrediction[] | null) => {
    setBacktestMlPredictions(predictions);
  }, []);

  // Load user's custom symbols
  useEffect(() => {
    async function loadUserSymbols() {
      if (authState.isAuthenticated && authState.user) {
        try {
          const symbols = await getCustomSymbols();
          setUserSymbols(symbols.map(s => s.symbol));
        } catch (err) {
          log.warn('Failed to load user symbols:', err);
        }
      }
    }
    loadUserSymbols();
  }, [authState.isAuthenticated, authState.user]);

  // Load sessions on mount when in backtest mode
  useEffect(() => {
    if (authState.user && mode === 'backtest') {
      loadSessions();
    }
  }, [authState.user, mode]);

  // Load session details when selected
  useEffect(() => {
    if (selectedSessionId && mode === 'backtest') {
      loadSessionDetails(selectedSessionId);
    }
  }, [selectedSessionId, mode]);

  // Load historical data when session or symbol changes
  useEffect(() => {
    if (activeSession && backtestSymbol && mode === 'backtest') {
      loadHistoricalData();
    }
  }, [activeSession?.id, backtestSymbol, activeSession?.currentDate, mode]);

  // Auto-play functionality
  useEffect(() => {
    if (isAutoPlaying && activeSession?.status === 'active') {
      const timer = setInterval(() => {
        handleAdvanceTime(1);
      }, 2000);
      return () => clearInterval(timer);
    }
  }, [isAutoPlaying, activeSession]);

  const loadSessions = async () => {
    try {
      const data = await getBacktestSessions();
      setSessions(data);
    } catch {
      setBacktestError('Fehler beim Laden der Backtests');
    }
  };

  const loadSessionDetails = async (sessionId: number) => {
    try {
      setBacktestLoading(true);
      const session = await getBacktestSession(sessionId);
      setActiveSession(session);
      if (session.status === 'completed') {
        const resultsData = await getBacktestResults(sessionId);
        setResults(resultsData);
      } else {
        setResults(null);
      }
    } catch {
      setBacktestError('Fehler beim Laden der Session');
    } finally {
      setBacktestLoading(false);
    }
  };

  const loadHistoricalData = async () => {
    if (!activeSession) return;
    try {
      setBacktestLoading(true);
      const bufferStart = new Date(activeSession.startDate);
      bufferStart.setDate(bufferStart.getDate() - 60);
      const startDateStr = bufferStart.toISOString().split('T')[0];
      const endDateStr = activeSession.endDate.split('T')[0];
      const response = await getHistoricalPrices(backtestSymbol, startDateStr, endDateStr);
      if (response?.prices && response.prices.length > 0) {
        setHistoricalData(response.prices);
        const currentDateData = response.prices.find((d: any) => d.date === activeSession.currentDate);
        setBacktestCurrentPrice(currentDateData?.close || null);
      } else {
        setHistoricalData([]);
        setBacktestCurrentPrice(null);
      }
    } catch (e) {
      setBacktestError(`Fehler beim Laden historischer Daten für ${backtestSymbol}`);
      setHistoricalData([]);
    } finally {
      setBacktestLoading(false);
    }
  };

  const backtestChartData: OHLCV[] = useMemo(() => {
    if (!activeSession || historicalData.length === 0) return [];
    const dataUntilNow = historicalData.filter((d: any) => d.date <= activeSession.currentDate);
    return dataUntilNow.map((d: any) => ({
      time: Math.floor(new Date(d.date).getTime() / 1000),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));
  }, [historicalData, activeSession?.currentDate]);

  const backtestForecast: ForecastResult | null = useMemo(() => {
    if (backtestChartData.length < 50) return null;
    return generateForecast(backtestChartData);
  }, [backtestChartData]);

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setBacktestError(null);
    try {
      setBacktestLoading(true);
      const session = await createBacktestSession({
        name: newSessionName,
        startDate: newStartDate,
        endDate: newEndDate,
        initialCapital: newCapital,
      });
      setSessions([session, ...sessions]);
      setSelectedSessionId(session.id);
      setShowCreateForm(false);
      setNewSessionName('');
      setNewStartDate('');
      setNewEndDate('');
      setSuccessMessage('Backtest-Session erstellt!');
    } catch (e: any) {
      setBacktestError(e.message || 'Fehler beim Erstellen der Session');
    } finally {
      setBacktestLoading(false);
    }
  };

  const handleBacktestExecuteOrder = async () => {
    if (!activeSession || !backtestCurrentPrice) return;
    setBacktestError(null);
    try {
      setBacktestLoading(true);
      const result = await executeBacktestOrder({
        sessionId: activeSession.id,
        symbol: backtestSymbol,
        side: backtestTradeSide,
        quantity: backtestTradeQuantity,
        price: backtestCurrentPrice,
      });
      if (result.success) {
        setSuccessMessage(
          `${backtestTradeSide === 'buy' ? 'Gekauft' : 'Verkauft'}: ${backtestTradeQuantity}x ${backtestSymbol} @ ${formatCurrencyBacktest(backtestCurrentPrice)}`
        );
        loadSessionDetails(activeSession.id);
      } else {
        setBacktestError(result.error || 'Order fehlgeschlagen');
      }
    } catch (e: any) {
      setBacktestError(e.message || 'Fehler beim Ausführen der Order');
    } finally {
      setBacktestLoading(false);
    }
  };

  const handleClosePosition = async (position: BacktestPosition) => {
    if (!activeSession || !backtestCurrentPrice) return;
    setBacktestError(null);
    try {
      setBacktestLoading(true);
      const result = await closeBacktestPosition(position.id, backtestCurrentPrice);
      if (result.success) {
        const pnlText = (result.realizedPnl || 0) >= 0 ? 'Gewinn' : 'Verlust';
        setSuccessMessage(`Position geschlossen: ${pnlText} ${formatCurrencyBacktest(Math.abs(result.realizedPnl || 0))}`);
        loadSessionDetails(activeSession.id);
      } else {
        setBacktestError(result.error || 'Fehler beim Schließen');
      }
    } catch (e: any) {
      setBacktestError(e.message || 'Fehler beim Schließen der Position');
    } finally {
      setBacktestLoading(false);
    }
  };

  const handleAdvanceTime = useCallback(async (days: number = 1) => {
    if (!activeSession || activeSession.status !== 'active') {
      setIsAutoPlaying(false);
      return;
    }
    setBacktestError(null);
    try {
      const currentDate = new Date(activeSession.currentDate);
      currentDate.setDate(currentDate.getDate() + days);
      const newDate = currentDate.toISOString().split('T')[0];
      const priceUpdates: Record<string, number> = {};
      const openPositions = activeSession.positions?.filter((p: BacktestPosition) => p.isOpen) || [];
      for (const pos of openPositions) {
        const posData = historicalData.find((d: any) => d.date === newDate);
        if (posData) priceUpdates[pos.symbol] = posData.close;
      }
      const newDateData = historicalData.find((d: any) => d.date === newDate);
      if (newDateData) {
        priceUpdates[backtestSymbol] = newDateData.close;
        setBacktestCurrentPrice(newDateData.close);
      }
      const result = await advanceBacktestTime(activeSession.id, { newDate, priceUpdates });
      if (result.success) {
        if (result.completed) {
          setIsAutoPlaying(false);
          setSuccessMessage('Backtest abgeschlossen!');
          loadSessionDetails(activeSession.id);
          const resultsData = await getBacktestResults(activeSession.id);
          setResults(resultsData);
        } else {
          setActiveSession(prev => prev ? { ...prev, currentDate: newDate } : null);
          if (result.triggeredPositions && result.triggeredPositions.length > 0) {
            const triggers = result.triggeredPositions.map((t: any) => 
              `${t.symbol}: ${t.reason === 'stop_loss' ? 'Stop-Loss' : 'Take-Profit'} @ ${formatCurrencyBacktest(t.triggerPrice)}`
            ).join(', ');
            setSuccessMessage(`Ausgelöst: ${triggers}`);
          }
          if (Math.random() < 0.2) loadSessionDetails(activeSession.id);
        }
      } else {
        setBacktestError(result.error || 'Fehler beim Zeitfortschritt');
        setIsAutoPlaying(false);
      }
    } catch (e: any) {
      setBacktestError(e.message || 'Fehler beim Zeitfortschritt');
      setIsAutoPlaying(false);
    }
  }, [activeSession, historicalData, backtestSymbol]);

  const handleDeleteSession = async (sessionId: number) => {
    if (!confirm('Backtest-Session wirklich löschen?')) return;
    try {
      await deleteBacktestSession(sessionId);
      setSessions(sessions.filter(s => s.id !== sessionId));
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
        setActiveSession(null);
        setResults(null);
      }
      setSuccessMessage('Session gelöscht');
    } catch (e: any) {
      setBacktestError(e.message || 'Fehler beim Löschen');
    }
  };

  const getUnrealizedPnl = (position: BacktestPosition): number => {
    if (!position.isOpen) return position.realizedPnl || 0;
    const priceDiff = position.currentPrice - position.entryPrice;
    const multiplier = position.side === 'long' ? 1 : -1;
    return priceDiff * position.quantity * position.leverage * multiplier;
  };

  // Clear messages after a few seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // ============================================================================
  // RENDER
  // ============================================================================

  // Loading state for live mode only
  if (mode === 'live' && isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">{t('dashboard.loadingChart')}</p>
        </div>
      </div>
    );
  }

  // No data state for live mode only
  if (mode === 'live' && (!stockData || !forecast)) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-400">{t('dashboard.noData')} {selectedSymbol}</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 flex-1 relative">
      {/* Mode Toggle + Controls Header */}
      <div className="sticky top-[62px] z-30 py-2 flex items-center gap-2 flex-wrap">
        {/* Mode Tabs */}
        <div className="flex bg-slate-800/90 rounded-lg p-1 border border-slate-700">
          <button
            onClick={() => handleModeChange('live')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === 'live'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <span>📡</span>
            <span className="hidden sm:inline">Live Trading</span>
            <span className="sm:hidden">Live</span>
          </button>
          <button
            onClick={() => handleModeChange('backtest')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === 'backtest'
                ? 'bg-purple-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <span>⏰</span>
            <span className="hidden sm:inline">Backtest</span>
          </button>
        </div>

        {/* Live Mode: Stock Selector + Quick Trade */}
        {mode === 'live' && (
          <>
            <StockSelector 
              selectedSymbol={selectedSymbol} 
              onSelect={onSymbolChange}
              timestamps={dataTimestamps}
              onRefresh={handleRefreshAll}
              isRefreshing={isRefreshing}
            />
            {/* Quick Trade Button with Dropdown */}
            <div className="relative">
              <button
                ref={quickTradeButtonRef}
                onClick={() => setShowQuickTrade(!showQuickTrade)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all text-sm font-medium ${
                  showQuickTrade 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-slate-800/90 hover:bg-slate-700 text-gray-300 border border-slate-600'
                }`}
                title={t('dashboard.quickTrade')}
              >
                <span className="text-lg">💹</span>
                <span className="hidden sm:inline">{t('dashboard.quickTrade')}</span>
                <svg
                  className={`w-4 h-4 transition-transform ${showQuickTrade ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {/* Quick Trade Dropdown Panel */}
              {showQuickTrade && (
                <div 
                  className="fixed sm:absolute sm:top-full left-2 right-2 sm:left-auto sm:right-0 sm:mt-2 sm:w-80 bg-slate-800/95 backdrop-blur-sm rounded-xl border border-slate-700 p-3 shadow-xl z-50"
                  style={{ top: window.innerWidth < 640 ? `${dropdownTop}px` : undefined }}
                >
                  {!getAuthState().isAuthenticated ? (
                    <div className="text-center py-3">
                      <p className="text-gray-400 mb-2 text-sm">{t('dashboard.loginToTrade')}</p>
                      <button
                        onClick={() => navigate('/trading')}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-xs"
                    >
                      {t('trading.goToSettings')} →
                    </button>
                  </div>
                ) : !portfolio ? (
                  <div className="text-center py-3">
                    <p className="text-gray-400 mb-2 text-sm">{t('dashboard.noPortfolio')}</p>
                    <button
                      onClick={() => navigate('/trading')}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-xs"
                    >
                      {t('trading.goToSettings')} →
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Header with portfolio info */}
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-700">
                      <div className="flex items-center gap-2">
                        <span>💼</span>
                        <div>
                          <div className="text-[10px] text-gray-400">{t('dashboard.available')}</div>
                          <div className="font-semibold text-green-400 text-sm">
                            {metrics ? formatCurrency(metrics.cashBalance) : '---'}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-gray-400">{selectedSymbol}</div>
                        <div className="font-semibold text-sm">
                          {currentPrice ? formatCurrency(currentPrice) : '---'}
                        </div>
                      </div>
                    </div>

                    {/* Trade Form - Compact */}
                    <div className="grid grid-cols-4 gap-1.5">
                      {/* Side Selection */}
                      <div className="col-span-2">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setTradeSide('buy')}
                            className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                              tradeSide === 'buy' ? 'bg-green-600 text-white' : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                            }`}
                          >
                            {t('trading.buy')}
                          </button>
                          <button
                            onClick={() => setTradeSide('short')}
                            className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                              tradeSide === 'short' ? 'bg-red-600 text-white' : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                            }`}
                          >
                            {t('trading.short')}
                          </button>
                        </div>
                      </div>

                      {/* Product Type */}
                      <div>
                        <select
                          value={productType}
                          onChange={(e) => setProductType(e.target.value as ProductType)}
                          className="w-full px-1.5 py-1.5 bg-slate-900 border border-slate-600 rounded text-xs focus:border-blue-500 focus:outline-none"
                        >
                          <option value="stock">{t('trading.stock')}</option>
                          <option value="cfd">CFD</option>
                        </select>
                      </div>

                      {/* Quantity */}
                      <div>
                        <input
                          type="number"
                          value={tradeQuantity}
                          onChange={(e) => setTradeQuantity(e.target.value)}
                          min="1"
                          step="1"
                          placeholder={t('trading.quantity')}
                          className="w-full px-1.5 py-1.5 bg-slate-900 border border-slate-600 rounded text-xs focus:border-blue-500 focus:outline-none text-center"
                        />
                      </div>
                    </div>

                    {/* Order Preview + Execute */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] text-gray-400 flex-1">
                        {currentPrice && tradeQuantity && (
                          <span>
                            {parseFloat(tradeQuantity) || 0}× @ {currentPrice.toFixed(2)} = <span className="text-white font-medium">{formatCurrency((parseFloat(tradeQuantity) || 0) * currentPrice)}</span>
                          </span>
                        )}
                      </div>
                      <button
                        onClick={handleQuickTrade}
                        disabled={isExecuting || !currentPrice}
                        className={`px-4 py-1.5 rounded font-medium text-xs transition-colors ${
                          tradeSide === 'buy' 
                            ? 'bg-green-600 hover:bg-green-700 disabled:bg-green-800' 
                            : 'bg-red-600 hover:bg-red-700 disabled:bg-red-800'
                        } text-white disabled:opacity-50`}
                      >
                        {isExecuting ? '...' : tradeSide === 'buy' ? t('trading.buy') : t('trading.short')}
                      </button>
                    </div>

                    {/* Result Message */}
                    {tradeResult && (
                      <div className={`text-[10px] px-2 py-1.5 rounded ${
                        tradeResult.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {tradeResult.message}
                      </div>
                    )}

                    {/* Link to full trading page */}
                    <div className="text-center pt-1 border-t border-slate-700">
                      <button
                        onClick={() => navigate('/trading')}
                        className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        {t('nav.trading')} →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          </>
        )}

        {/* Backtest Mode: Create Button */}
        {mode === 'backtest' && authState.user && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors flex items-center gap-1.5 text-sm"
          >
            <span>+</span>
            <span className="hidden sm:inline">Neuer Backtest</span>
          </button>
        )}
      </div>

      {/* ============================================================================ */}
      {/* LIVE MODE CONTENT */}
      {/* ============================================================================ */}
      {mode === 'live' && stockData && forecast && (
        <div className="mt-4">
          {/* Trading Signals - Full Width at Top */}
          <TradingSignalPanel 
            newsItems={newsWithSentiment.map(item => ({
              sentimentResult: item.sentimentResult,
              datetime: item.datetime
            }))}
            symbol={selectedSymbol}
            className="mb-6"
            forecast={forecast}
            stockData={stockData.data}
            mlPredictions={mlPredictions ?? undefined}
            currentPrice={currentPrice}
            rlSignals={rlSignals.length > 0 ? rlSignals : undefined}
            signalConfig={signalConfig}
            onConfigChange={handleSignalConfigChange}
            rlServiceAvailable={rlServiceAvailable}
            mlServiceAvailable={true}
          />

          {/* AI Forecast and News Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 items-stretch">
            {/* Forecast Panels */}
            <div className="space-y-4">
              <ForecastPanel forecast={forecast} currentPrice={currentPrice} />
              <MLForecastPanel 
                symbol={selectedSymbol} 
                stockData={stockData.data} 
                onPredictionsChange={handleMLPredictionsChange}
                onRefreshRegister={handleMLRefreshRegister}
              />
              {/* RL Advisor Panel - Shows agent explanations */}
              {rlServiceAvailable && stockData.data.length >= 100 && (
                <RLAdvisorPanel 
                  symbol={selectedSymbol}
                  historicalData={stockData.data}
                />
              )}
            </div>

            {/* News Panel */}
            <div className="h-full">
              <NewsPanel 
                symbol={selectedSymbol} 
                className="h-full"
                onSentimentChange={handleSentimentChange}
                onRefreshRegister={handleNewsRefreshRegister}
              />
            </div>
          </div>

          {/* Chart - Collapsible, Full Width with integrated Indicator Controls */}
          <div className="mb-6">
            <div className="bg-slate-800/50 rounded-xl border border-slate-700">
              <button
                onClick={() => setShowChart(!showChart)}
                className="w-full flex items-center justify-between p-4 text-left"
              >
                <h3 className="text-white font-semibold">📈 Chart</h3>
                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform ${showChart ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showChart && (
                <div className="px-3 sm:px-6 pb-4 sm:pb-6">
                  {/* Indicator Controls - Always visible inline */}
                  <div className="mb-3">
                    <IndicatorControls
                      showSMA20={showSMA20}
                      showSMA50={showSMA50}
                      showEMA12={showEMA12}
                      showEMA26={showEMA26}
                      showBollingerBands={showBollingerBands}
                      showMACD={showMACD}
                      showRSI={showRSI}
                      showVolume={showVolume}
                      onToggle={handleIndicatorToggle}
                    />
                  </div>
                  
                  {/* Stock Chart */}
                  <StockChart
                    data={stockData.data}
                    symbol={stockData.symbol}
                    showSMA20={showSMA20}
                    showSMA50={showSMA50}
                    showEMA12={showEMA12}
                    showEMA26={showEMA26}
                    showBollingerBands={showBollingerBands}
                    showMACD={showMACD}
                    showRSI={showRSI}
                    showVolume={showVolume}
                    supportLevel={forecast.supportLevel}
                    resistanceLevel={forecast.resistanceLevel}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Company Info Panel - Key metrics, identifiers, and instrument details */}
          <CompanyInfoPanel symbol={selectedSymbol} />
        </div>
      )}

      {/* ============================================================================ */}
      {/* BACKTEST MODE CONTENT */}
      {/* ============================================================================ */}
      {mode === 'backtest' && (
        <div className="mt-4">
          {/* Not authenticated */}
          {!authState.user ? (
            <div className="bg-slate-800/50 rounded-xl p-8 text-center">
              <h2 className="text-2xl font-bold mb-4">📈 Backtesting</h2>
              <p className="text-gray-400 mb-6">Melde dich an, um historische Trading-Simulationen durchzuführen.</p>
              <a href="/settings" className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors">
                Anmelden
              </a>
            </div>
          ) : (
            <>
              {/* Messages */}
              {backtestError && (
                <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 text-red-300 flex justify-between items-center mb-4">
                  <span>{backtestError}</span>
                  <button onClick={() => setBacktestError(null)} className="text-red-300 hover:text-red-100 text-xl">×</button>
                </div>
              )}
              {successMessage && (
                <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-4 text-green-300 mb-4">
                  ✅ {successMessage}
                </div>
              )}

              {/* Create Session Modal */}
              {showCreateForm && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowCreateForm(false)}>
                  <div className="bg-slate-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl border border-slate-700" onClick={e => e.stopPropagation()}>
                    <h2 className="text-xl font-bold mb-4">Neuen Backtest erstellen</h2>
                    <form onSubmit={handleCreateSession}>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-2">Name</label>
                          <input type="text" value={newSessionName} onChange={e => setNewSessionName(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                            placeholder="z.B. Tech-Strategie 2023" required autoFocus />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">Startdatum</label>
                            <input type="date" value={newStartDate} onChange={e => setNewStartDate(e.target.value)}
                              className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" required />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">Enddatum</label>
                            <input type="date" value={newEndDate} onChange={e => setNewEndDate(e.target.value)}
                              max={new Date().toISOString().split('T')[0]}
                              className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" required />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-2">Startkapital (€)</label>
                          <input type="number" value={newCapital} onChange={e => setNewCapital(Number(e.target.value))} min={1000} max={10000000}
                            className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
                        </div>
                      </div>
                      <div className="flex justify-end gap-3 mt-6">
                        <button type="button" onClick={() => setShowCreateForm(false)}
                          className="px-4 py-2.5 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
                          Abbrechen
                        </button>
                        <button type="submit" disabled={backtestLoading}
                          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors">
                          {backtestLoading ? 'Wird erstellt...' : 'Erstellen'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Sessions List */}
                <div className="lg:col-span-1">
                  <div className="bg-slate-800/50 rounded-xl p-4">
                    <h2 className="font-semibold text-lg mb-4">Meine Backtests</h2>
                    {sessions.length === 0 ? (
                      <p className="text-gray-500 text-sm py-4 text-center">Noch keine Backtests vorhanden.</p>
                    ) : (
                      <div className="space-y-2 max-h-[600px] overflow-y-auto">
                        {sessions.map(session => (
                          <div key={session.id} onClick={() => setSelectedSessionId(session.id)}
                            className={`p-3 rounded-lg cursor-pointer transition-all ${
                              selectedSessionId === session.id
                                ? 'bg-purple-600/20 border border-purple-500/50'
                                : 'bg-slate-900/50 hover:bg-slate-700/50 border border-transparent'
                            }`}>
                            <div className="flex justify-between items-start gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-white truncate">{session.name}</p>
                                <p className="text-xs text-gray-400 mt-1">{session.startDate} → {session.endDate}</p>
                                <span className={`inline-block mt-2 px-2 py-0.5 text-xs rounded font-medium ${
                                  session.status === 'active' ? 'bg-green-500/20 text-green-400'
                                    : session.status === 'completed' ? 'bg-blue-500/20 text-blue-400'
                                    : 'bg-gray-500/20 text-gray-400'
                                }`}>
                                  {session.status === 'active' ? '● Aktiv' : session.status === 'completed' ? '✓ Fertig' : '○ Abgebrochen'}
                                </span>
                              </div>
                              <button onClick={e => { e.stopPropagation(); handleDeleteSession(session.id); }}
                                className="text-gray-500 hover:text-red-400 transition-colors p-1" title="Löschen">🗑️</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Main Content */}
                <div className="lg:col-span-3">
                  {!activeSession ? (
                    <div className="bg-slate-800/50 rounded-xl p-12 text-center">
                      <div className="text-6xl mb-4">📊</div>
                      <p className="text-gray-400 text-lg">Wähle einen Backtest aus oder erstelle einen neuen.</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* Session Header */}
                      <div className="bg-slate-800/50 rounded-xl p-5">
                        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                          <div>
                            <h2 className="text-xl font-bold">{activeSession.name}</h2>
                            <p className="text-gray-400 text-sm mt-1">Zeitraum: {activeSession.startDate} → {activeSession.endDate}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-2xl font-bold text-purple-400">{formatCurrencyBacktest(activeSession.currentCapital)}</div>
                            <div className="text-sm text-gray-400">Aktuelles Kapital</div>
                          </div>
                        </div>

                        {/* Time Simulation */}
                        {activeSession.status === 'active' && (
                          <div className="mt-5 pt-5 border-t border-slate-700">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                              <span className="text-gray-400">Simulationsdatum:</span>
                              <span className="font-bold text-xl text-purple-400">📅 {activeSession.currentDate}</span>
                            </div>
                            <div className="mb-4">
                              <div className="w-full bg-slate-700 rounded-full h-2.5">
                                <div className="bg-purple-500 h-2.5 rounded-full transition-all duration-300"
                                  style={{ width: `${((new Date(activeSession.currentDate).getTime() - new Date(activeSession.startDate).getTime()) /
                                    (new Date(activeSession.endDate).getTime() - new Date(activeSession.startDate).getTime())) * 100}%` }} />
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button onClick={() => handleAdvanceTime(1)} disabled={backtestLoading}
                                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">+1 Tag</button>
                              <button onClick={() => handleAdvanceTime(7)} disabled={backtestLoading}
                                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">+1 Woche</button>
                              <button onClick={() => handleAdvanceTime(30)} disabled={backtestLoading}
                                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">+1 Monat</button>
                              <button onClick={() => setIsAutoPlaying(!isAutoPlaying)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                  isAutoPlaying ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                }`}>
                                {isAutoPlaying ? '⏸️ Stopp' : '▶️ Auto-Play'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Analysis Panel */}
                      {activeSession.status === 'active' && backtestChartData.length > 0 && (
                        <div className="bg-slate-800/50 rounded-xl border border-slate-700">
                          <button onClick={() => setShowAnalysisPanel(!showAnalysisPanel)}
                            className="w-full flex items-center justify-between p-5 text-left">
                            <div className="flex items-center gap-2">
                              <span className="text-xl">📊</span>
                              <h3 className="font-semibold text-lg">Marktanalyse zum {activeSession.currentDate}</h3>
                            </div>
                            <svg className={`w-5 h-5 text-gray-400 transition-transform ${showAnalysisPanel ? 'rotate-180' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {showAnalysisPanel && (
                            <div className="px-5 pb-5 space-y-4">
                              {backtestForecast && backtestCurrentPrice && (
                                <>
                                  <TradingSignalPanel newsItems={[]} symbol={backtestSymbol} forecast={backtestForecast}
                                    stockData={backtestChartData} mlPredictions={backtestMlPredictions ?? undefined} currentPrice={backtestCurrentPrice} />
                                  <ForecastPanel forecast={backtestForecast} currentPrice={backtestCurrentPrice} />
                                </>
                              )}
                              {backtestChartData.length >= 60 && backtestCurrentPrice && (
                                <MLForecastPanel symbol={backtestSymbol} stockData={backtestChartData} onPredictionsChange={handleBacktestMLPredictionsChange} />
                              )}
                              <div className="bg-slate-900/50 rounded-xl border border-slate-700">
                                <button onClick={() => setShowIndicators(!showIndicators)} className="w-full flex items-center justify-between p-4 text-left">
                                  <h4 className="text-white font-semibold">Chart-Indikatoren</h4>
                                  <svg className={`w-5 h-5 text-gray-400 transition-transform ${showIndicators ? 'rotate-180' : ''}`}
                                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                                {showIndicators && (
                                  <div className="px-4 pb-4">
                                    <IndicatorControls showSMA20={showSMA20} showSMA50={showSMA50} showEMA12={showEMA12} showEMA26={showEMA26}
                                      showBollingerBands={showBollingerBands} showMACD={showMACD} showRSI={showRSI} showVolume={showVolume}
                                      onToggle={handleIndicatorToggle} />
                                  </div>
                                )}
                              </div>
                              <div className="bg-slate-900/50 rounded-xl border border-slate-700">
                                <button onClick={() => setShowBacktestChart(!showBacktestChart)} className="w-full flex items-center justify-between p-4 text-left">
                                  <h4 className="text-white font-semibold">📈 Chart bis {activeSession.currentDate}</h4>
                                  <svg className={`w-5 h-5 text-gray-400 transition-transform ${showBacktestChart ? 'rotate-180' : ''}`}
                                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                                {showBacktestChart && backtestChartData.length > 0 && (
                                  <div className="px-4 pb-4">
                                    <StockChart data={backtestChartData} symbol={backtestSymbol}
                                      showSMA20={showSMA20} showSMA50={showSMA50} showEMA12={showEMA12} showEMA26={showEMA26}
                                      showBollingerBands={showBollingerBands} showMACD={showMACD} showRSI={showRSI} showVolume={showVolume}
                                      supportLevel={backtestForecast?.supportLevel} resistanceLevel={backtestForecast?.resistanceLevel} />
                                  </div>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 text-center">
                                ⏱️ Analyse basiert auf historischen Daten bis zum Simulationsdatum.
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Trading Panel */}
                      {activeSession.status === 'active' && (
                        <div className="bg-slate-800/50 rounded-xl p-5">
                          <h3 className="font-semibold text-lg mb-4">🛒 Handeln</h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">Symbol</label>
                              <select value={backtestSymbol} onChange={e => setBacktestSymbol(e.target.value)}
                                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none">
                                {allSymbols.map(s => (<option key={s} value={s}>{s}</option>))}
                              </select>
                              <input type="text" value={customSymbol} onChange={e => setCustomSymbol(e.target.value.toUpperCase())}
                                onKeyDown={e => { if (e.key === 'Enter' && customSymbol) { setBacktestSymbol(customSymbol); setCustomSymbol(''); } }}
                                placeholder="Anderes Symbol..."
                                className="w-full mt-2 px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-gray-500 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none" />
                            </div>
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">Seite</label>
                              <div className="flex gap-2">
                                <button onClick={() => setBacktestTradeSide('buy')}
                                  className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${backtestTradeSide === 'buy' ? 'bg-green-500 text-white' : 'bg-slate-700 text-gray-400 hover:bg-slate-600'}`}>
                                  📈 Kaufen
                                </button>
                                <button onClick={() => setBacktestTradeSide('sell')}
                                  className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${backtestTradeSide === 'sell' ? 'bg-red-500 text-white' : 'bg-slate-700 text-gray-400 hover:bg-slate-600'}`}>
                                  📉 Verkaufen
                                </button>
                              </div>
                            </div>
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">Menge</label>
                              <input type="number" value={backtestTradeQuantity} onChange={e => setBacktestTradeQuantity(Number(e.target.value))} min={1}
                                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none" />
                            </div>
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">Aktueller Preis</label>
                              <div className="text-xl font-bold text-white mb-2">
                                {backtestCurrentPrice ? formatCurrencyBacktest(backtestCurrentPrice) : <span className="text-gray-500">Laden...</span>}
                              </div>
                              <button onClick={handleBacktestExecuteOrder} disabled={backtestLoading || !backtestCurrentPrice}
                                className={`w-full py-2.5 rounded-lg font-medium text-white transition-colors disabled:opacity-50 ${
                                  backtestTradeSide === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                                }`}>
                                {backtestLoading ? '...' : backtestTradeSide === 'buy' ? '📈 Kaufen' : '📉 Verkaufen'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Positions */}
                      <div className="bg-slate-800/50 rounded-xl p-5">
                        <h3 className="font-semibold text-lg mb-4">📋 Positionen</h3>
                        {!activeSession.positions || activeSession.positions.length === 0 ? (
                          <div className="text-center py-8 text-gray-500">
                            <div className="text-4xl mb-2">📭</div>
                            Keine Positionen vorhanden.
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-slate-700">
                                  <th className="px-4 py-3 text-left text-gray-400 font-medium">Symbol</th>
                                  <th className="px-4 py-3 text-left text-gray-400 font-medium">Seite</th>
                                  <th className="px-4 py-3 text-right text-gray-400 font-medium">Menge</th>
                                  <th className="px-4 py-3 text-right text-gray-400 font-medium">Einstieg</th>
                                  <th className="px-4 py-3 text-right text-gray-400 font-medium">Aktuell</th>
                                  <th className="px-4 py-3 text-right text-gray-400 font-medium">P&L</th>
                                  <th className="px-4 py-3 text-center text-gray-400 font-medium">Status</th>
                                  <th className="px-4 py-3"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-700/50">
                                {activeSession.positions.map((pos: BacktestPosition) => {
                                  const pnl = getUnrealizedPnl(pos);
                                  return (
                                    <tr key={pos.id} className="hover:bg-slate-700/30 transition-colors">
                                      <td className="px-4 py-3 font-semibold text-white">{pos.symbol}</td>
                                      <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded text-xs font-medium ${pos.side === 'long' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                          {pos.side === 'long' ? '📈 Long' : '📉 Short'}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3 text-right text-white">{pos.quantity}</td>
                                      <td className="px-4 py-3 text-right text-gray-300">{formatCurrencyBacktest(pos.entryPrice)}</td>
                                      <td className="px-4 py-3 text-right text-white">{formatCurrencyBacktest(pos.currentPrice)}</td>
                                      <td className={`px-4 py-3 text-right font-semibold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        {pnl >= 0 ? '+' : ''}{formatCurrencyBacktest(pnl)}
                                      </td>
                                      <td className="px-4 py-3 text-center">
                                        <span className={`px-2 py-1 rounded text-xs font-medium ${pos.isOpen ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-400'}`}>
                                          {pos.isOpen ? '● Offen' : '○ Geschlossen'}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3">
                                        {pos.isOpen && activeSession.status === 'active' && (
                                          <button onClick={() => handleClosePosition(pos)} disabled={backtestLoading}
                                            className="text-red-400 hover:text-red-300 text-sm font-medium transition-colors disabled:opacity-50">
                                            Schließen
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* Results */}
                      {results && activeSession.status === 'completed' && (
                        <div className="bg-slate-800/50 rounded-xl p-5">
                          <h3 className="font-semibold text-lg mb-4">📊 Backtest-Ergebnisse</h3>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                            <div className="bg-slate-900/50 rounded-lg p-4">
                              <div className="text-sm text-gray-400">Gesamtrendite</div>
                              <div className={`text-2xl font-bold mt-1 ${results.metrics.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {formatPercent(results.metrics.totalReturn)}
                              </div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-4">
                              <div className="text-sm text-gray-400">Netto P&L</div>
                              <div className={`text-2xl font-bold mt-1 ${results.metrics.netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {formatCurrencyBacktest(results.metrics.netPnl)}
                              </div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-4">
                              <div className="text-sm text-gray-400">Gewinnrate</div>
                              <div className="text-2xl font-bold mt-1 text-white">{formatPercent(results.metrics.winRate)}</div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-4">
                              <div className="text-sm text-gray-400">Max. Drawdown</div>
                              <div className="text-2xl font-bold mt-1 text-red-400">{formatPercent(results.metrics.maxDrawdown)}</div>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                            <div className="flex justify-between items-center py-2 border-b border-slate-700">
                              <span className="text-gray-400">Trades gesamt</span>
                              <span className="font-semibold text-white">{results.metrics.totalTrades}</span>
                            </div>
                            <div className="flex justify-between items-center py-2 border-b border-slate-700">
                              <span className="text-gray-400">Gewinner / Verlierer</span>
                              <span className="font-semibold">
                                <span className="text-green-400">{results.metrics.winningTrades}</span>
                                <span className="text-gray-500"> / </span>
                                <span className="text-red-400">{results.metrics.losingTrades}</span>
                              </span>
                            </div>
                            <div className="flex justify-between items-center py-2 border-b border-slate-700">
                              <span className="text-gray-400">Profit Factor</span>
                              <span className="font-semibold text-white">{results.metrics.profitFactor.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center py-2 border-b border-slate-700">
                              <span className="text-gray-400">Ø Gewinn</span>
                              <span className="font-semibold text-green-400">{formatCurrencyBacktest(results.metrics.avgWin)}</span>
                            </div>
                            <div className="flex justify-between items-center py-2 border-b border-slate-700">
                              <span className="text-gray-400">Ø Verlust</span>
                              <span className="font-semibold text-red-400">{formatCurrencyBacktest(results.metrics.avgLoss)}</span>
                            </div>
                            <div className="flex justify-between items-center py-2 border-b border-slate-700">
                              <span className="text-gray-400">Gebühren gesamt</span>
                              <span className="font-semibold text-orange-400">{formatCurrencyBacktest(results.metrics.totalFees)}</span>
                            </div>
                          </div>
                          {results.equityCurve.length > 1 && (
                            <div>
                              <h4 className="font-medium text-white mb-3">📈 Equity-Kurve</h4>
                              <div className="h-48 bg-slate-900/50 rounded-lg p-4">
                                <svg viewBox="0 0 100 50" className="w-full h-full" preserveAspectRatio="none">
                                  {(() => {
                                    const values = results.equityCurve.map((p: any) => p.totalValue);
                                    const min = Math.min(...values);
                                    const max = Math.max(...values);
                                    const range = max - min || 1;
                                    const points = values.map((v: number, i: number) => {
                                      const x = (i / (values.length - 1)) * 100;
                                      const y = 50 - ((v - min) / range) * 45;
                                      return `${x},${y}`;
                                    }).join(' ');
                                    const isPositive = values[values.length - 1] >= values[0];
                                    const strokeColor = isPositive ? '#4ade80' : '#f87171';
                                    const fillColor = isPositive ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)';
                                    return (
                                      <>
                                        <polyline fill="none" stroke={strokeColor} strokeWidth="0.8" points={points} />
                                        <polyline fill={fillColor} stroke="none" points={`0,50 ${points} 100,50`} />
                                      </>
                                    );
                                  })()}
                                </svg>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
