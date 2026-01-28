/**
 * Dashboard Page
 * 
 * Main trading view with stock chart, forecasts, news, and trading signals.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { StockChart, ForecastPanel, MLForecastPanel, StockSelector, IndicatorControls, NewsPanel, TradingSignalPanel, CompanyInfoPanel, RLAdvisorPanel, type NewsItemWithSentiment } from '../components';
import { type DataTimestamps } from '../components/StockSelector';
import { useStockData, useSimpleAutoRefresh } from '../hooks';
import { generateForecast } from '../utils/forecast';
import { getAuthState } from '../services/authService';
import { getOrCreatePortfolio, executeMarketOrder, getPortfolioMetrics } from '../services/tradingService';
import { useSettings } from '../contexts/SettingsContext';
import { getSignalSourceSettings, saveSignalSourceSettings } from '../services/userSettingsService';
import { rlTradingService } from '../services/rlTradingService';
import type { RLSignalInput, SignalSourceConfig } from '../utils/tradingSignals';
import type { Portfolio, PortfolioMetrics, OrderSide, ProductType } from '../types/trading';

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
  const { data: stockData, isLoading, refetch } = useStockData(selectedSymbol);
  const { t, formatCurrency } = useSettings();

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
        console.error('Failed to load portfolio:', err);
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
          console.warn('No valid RL agents found. Selected agents may have been deleted.');
          setRlSignals([]);
          return;
        }
        
        const response = await rlTradingService.getMultiSignals(
          validAgents,
          stockData.data
        );
        
        // Race condition check: Ensure symbol hasn't changed during async call
        if (currentSymbolRef.current !== requestSymbol) {
          console.log(`[Dashboard] Symbol changed during RL fetch (${requestSymbol} -> ${currentSymbolRef.current}), discarding stale results`);
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
        console.warn('Failed to load RL signals:', err);
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

  const currentPrice = useMemo(() => {
    if (!stockData || stockData.data.length === 0) return 0;
    return stockData.data[stockData.data.length - 1].close;
  }, [stockData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">{t('dashboard.loadingChart')}</p>
        </div>
      </div>
    );
  }

  if (!stockData || !forecast) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-400">{t('dashboard.noData')} {selectedSymbol}</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 flex-1 relative">
      {/* Floating Stock Selector - elegant eingebettet beim Scrollen */}
      <div className="sticky top-[62px] z-30 py-2 pointer-events-none">
        <div className="pointer-events-auto inline-flex items-center gap-2 relative">
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
        </div>
      </div>
      
      {/* Main Content */}
      <div className="">

      {/* Trading Signals - Full Width at Top */}
      <TradingSignalPanel 
        newsItems={newsWithSentiment.map(item => ({
          sentimentResult: item.sentimentResult,
          datetime: item.datetime
        }))}
        symbol={selectedSymbol}
        className="mb-6"
        forecast={forecast ?? undefined}
        stockData={stockData?.data}
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
            stockData={stockData?.data ?? []} 
            onPredictionsChange={handleMLPredictionsChange}
            onRefreshRegister={handleMLRefreshRegister}
          />
          {/* RL Advisor Panel - Shows agent explanations */}
          {rlServiceAvailable && stockData?.data && stockData.data.length >= 100 && (
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
    </div>
  );
}
