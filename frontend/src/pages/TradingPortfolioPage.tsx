/**
 * TradingPortfolioPage - Combined Paper Trading & Portfolio Management
 * 
 * Unified page for paper trading with virtual money and portfolio analytics.
 * Combines trading (order creation), open positions, portfolio overview,
 * transaction history, and settings in one organized view.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDataService } from '../hooks';
import { useSimpleAutoRefresh } from '../hooks';
import { getAuthState, subscribeToAuth, type AuthState } from '../services/authService';
import { useSettings } from '../contexts/SettingsContext';
import {
  getOrCreatePortfolio,
  getOpenPositions,
  getAllPositions,
  getPortfolioMetrics,
  getTransactionHistory,
  getFeeSummary,
  executeMarketOrder,
  closePosition,
  calculateFees,
  getProductTypes,
  calculatePositionPnL,
  formatPercent,
  getProductTypeName,
  getSideName,
  getOrderTypeName,
  validateOrder,
  createPendingOrder,
  checkTriggers,
  updatePositionLevels,
  resetPortfolio,
  updatePortfolioSettings,
  setInitialCapital,
  getBrokerProfiles,
} from '../services/tradingService';
import type {
  Portfolio,
  Position,
  PositionWithPnL,
  Transaction,
  PortfolioMetrics,
  FeeSummary,
  ProductTypes,
  FeeCalculation,
  ProductType,
  OrderSide,
  ExecuteOrderRequest,
  OrderType,
  BrokerProfiles,
  BrokerProfileId,
} from '../types/trading';
import { StockSelector, PendingOrders, EquityChart } from '../components';

type TabType = 'trading' | 'overview' | 'settings';

export function TradingPortfolioPage() {
  const { dataService } = useDataService();
  const [searchParams] = useSearchParams();
  const { t, formatCurrency } = useSettings();
  
  // Auth state
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  
  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('trading');
  
  // Portfolio state
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [openPositions, setOpenPositions] = useState<PositionWithPnL[]>([]);
  const [allPositions, setAllPositions] = useState<Position[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [metrics, setMetrics] = useState<PortfolioMetrics | null>(null);
  const [feeSummary, setFeeSummary] = useState<FeeSummary | null>(null);
  const [brokerProfiles, setBrokerProfiles] = useState<BrokerProfiles | null>(null);
  
  // Configuration
  const [productTypes, setProductTypes] = useState<ProductTypes | null>(null);
  
  // Trading form - initialize from URL param if present
  const [selectedSymbol, setSelectedSymbol] = useState(() => searchParams.get('symbol') || 'AAPL');
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [productType, setProductType] = useState<ProductType>('stock');
  const [side, setSide] = useState<OrderSide>('buy');
  const [quantity, setQuantity] = useState<string>('10');
  const [leverage, setLeverage] = useState<number>(1);
  const [stopLoss, setStopLoss] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [stopOrderPrice, setStopOrderPrice] = useState<string>('');
  
  // Position editing state
  const [editingPosition, setEditingPosition] = useState<number | null>(null);
  const [editStopLoss, setEditStopLoss] = useState<string>('');
  const [editTakeProfit, setEditTakeProfit] = useState<string>('');
  
  // Fee preview
  const [feePreview, setFeePreview] = useState<FeeCalculation | null>(null);
  
  // UI state
  const [loading, setLoading] = useState(true);
  const [orderLoading, setOrderLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showCapitalChange, setShowCapitalChange] = useState(false);
  const [newCapital, setNewCapital] = useState<string>('');
  
  // Ref for tracking price updates for trigger checks
  const priceCache = useRef<Record<string, number>>({});
  
  // Subscribe to auth changes
  useEffect(() => {
    return subscribeToAuth(setAuthState);
  }, []);
  
  // Update symbol from URL params when they change (only on initial load or URL navigation)
  useEffect(() => {
    const symbolFromUrl = searchParams.get('symbol');
    if (symbolFromUrl) {
      setSelectedSymbol(symbolFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  
  // Load configuration
  useEffect(() => {
    async function loadConfig() {
      try {
        const [products, brokers] = await Promise.all([
          getProductTypes(),
          getBrokerProfiles(),
        ]);
        setProductTypes(products);
        setBrokerProfiles(brokers);
      } catch (e) {
        console.error('Failed to load config:', e);
      }
    }
    loadConfig();
  }, []);
  
  // Load portfolio data
  const loadPortfolioData = useCallback(async () => {
    if (!authState.isAuthenticated) {
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      const portfolioData = await getOrCreatePortfolio();
      setPortfolio(portfolioData);
      
      const [metricsData, openPosData, allPosData, transactionsData, feeData] = await Promise.all([
        getPortfolioMetrics(portfolioData.id),
        getOpenPositions(portfolioData.id),
        getAllPositions(portfolioData.id),
        getTransactionHistory(portfolioData.id),
        getFeeSummary(portfolioData.id),
      ]);
      
      setMetrics(metricsData);
      setAllPositions(allPosData);
      setTransactions(transactionsData);
      setFeeSummary(feeData);
      
      // Update open positions with current prices
      const updatedPositions = openPosData.map(pos => 
        calculatePositionPnL(pos, pos.currentPrice || pos.entryPrice)
      );
      setOpenPositions(updatedPositions);
    } catch (e) {
      console.error('Failed to load portfolio:', e);
      setError(t('trading.loadError'));
    } finally {
      setLoading(false);
    }
  }, [authState.isAuthenticated]);
  
  useEffect(() => {
    loadPortfolioData();
  }, [loadPortfolioData]);

  // Lightweight metrics-only refresh
  const refreshMetricsOnly = useCallback(async () => {
    if (!portfolio || !authState.isAuthenticated) return;
    
    try {
      const newMetrics = await getPortfolioMetrics(portfolio.id);
      setMetrics(prev => {
        if (prev?.totalValue === newMetrics.totalValue && 
            prev?.netPnl === newMetrics.netPnl) {
          return prev;
        }
        return newMetrics;
      });
    } catch {
      // Silently ignore errors during auto-refresh
    }
  }, [portfolio, authState.isAuthenticated]);

  useSimpleAutoRefresh(refreshMetricsOnly, { interval: 2000, enabled: !!portfolio });
  
  // Load current price for selected symbol
  useEffect(() => {
    async function loadPrice() {
      try {
        const quote = await dataService.fetchQuote(selectedSymbol);
        if (quote) {
          setCurrentPrice(quote.price);
          priceCache.current[selectedSymbol] = quote.price;
        }
      } catch (e) {
        console.error('Failed to get quote:', e);
      }
    }
    loadPrice();
    
    const interval = setInterval(loadPrice, 30000);
    return () => clearInterval(interval);
  }, [selectedSymbol, dataService]);
  
  // Keep a ref to openPositions for use in interval callback
  const openPositionsRef = useRef(openPositions);
  useEffect(() => {
    openPositionsRef.current = openPositions;
  }, [openPositions]);
  
  // Fetch prices for all positions and check triggers periodically
  useEffect(() => {
    if (!authState.isAuthenticated || openPositions.length === 0) return;
    
    async function checkPositionTriggersCallback() {
      // Use ref to get current positions to avoid stale closure
      const currentPositions = openPositionsRef.current;
      if (currentPositions.length === 0) return;
      
      const symbols = [...new Set(currentPositions.map(p => p.symbol))];
      const prices: Record<string, number> = {};
      
      for (const symbol of symbols) {
        try {
          const quote = await dataService.fetchQuote(symbol);
          if (quote) {
            prices[symbol] = quote.price;
            priceCache.current[symbol] = quote.price;
          }
        } catch {
          if (priceCache.current[symbol]) {
            prices[symbol] = priceCache.current[symbol];
          }
        }
      }
      
      setOpenPositions(prev => prev.map(pos => 
        calculatePositionPnL(pos, prices[pos.symbol] || pos.currentPrice || pos.entryPrice)
      ));
      
      if (Object.keys(prices).length > 0) {
        try {
          const result = await checkTriggers(prices);
          
          if (result.executedOrders.length > 0 || result.triggeredPositions.length > 0) {
            const messages: string[] = [];
            
            result.executedOrders.forEach(o => {
              if (o.success && o.order) {
                messages.push(`Order ${o.order.symbol} ausgeführt`);
              }
            });
            
            result.triggeredPositions.forEach(t => {
              const reasons: Record<string, string> = {
                stop_loss: 'Stop-Loss',
                take_profit: 'Take-Profit',
                knockout: 'Knock-Out',
                margin_call: 'Margin-Call',
              };
              messages.push(`${t.symbol}: ${reasons[t.reason]} bei ${formatCurrency(t.closePrice)}, P&L: ${formatCurrency(t.realizedPnl)}`);
            });
            
            if (messages.length > 0) {
              setSuccessMessage(messages.join('\n'));
              setTimeout(() => setSuccessMessage(null), 10000);
              await loadPortfolioData();
            }
          }
        } catch (e) {
          console.error('Trigger check failed:', e);
        }
      }
    }
    
    checkPositionTriggersCallback();
    const interval = setInterval(checkPositionTriggersCallback, 60000);
    return () => clearInterval(interval);
  }, [authState.isAuthenticated, openPositions.length, dataService, loadPortfolioData]);
  
  // Calculate fee preview
  useEffect(() => {
    async function updateFeePreview() {
      const qty = parseInt(quantity) || 0;
      if (!currentPrice || qty <= 0) {
        setFeePreview(null);
        return;
      }
      
      try {
        const fees = await calculateFees({
          productType,
          side,
          quantity: qty,
          price: currentPrice,
          leverage,
          brokerProfile: portfolio?.brokerProfile || 'standard',
        });
        setFeePreview(fees);
      } catch (e) {
        console.error('Fee calculation error:', e);
      }
    }
    
    const debounce = setTimeout(updateFeePreview, 300);
    return () => clearTimeout(debounce);
  }, [productType, side, quantity, currentPrice, leverage, portfolio?.brokerProfile]);
  
  // Handle order submission
  const handleSubmitOrder = async () => {
    if (!portfolio || !feePreview) return;
    
    // For pending orders (limit/stop)
    if (orderType !== 'market') {
      try {
        setOrderLoading(true);
        setError(null);
        
        const parsedLimitPrice = parseFloat(limitPrice);
        const parsedStopPrice = parseFloat(stopOrderPrice);
        
        if (orderType === 'limit' && (isNaN(parsedLimitPrice) || parsedLimitPrice <= 0)) {
          setError(t('trading.enterValidLimitPrice'));
          return;
        }
        if (orderType === 'stop' && (isNaN(parsedStopPrice) || parsedStopPrice <= 0)) {
          setError(t('trading.enterValidStopPrice'));
          return;
        }
        if (orderType === 'stop_limit' && ((isNaN(parsedStopPrice) || parsedStopPrice <= 0) || (isNaN(parsedLimitPrice) || parsedLimitPrice <= 0))) {
          setError(t('trading.enterValidBothPrices'));
          return;
        }
        
        const qty = parseInt(quantity) || 0;
        if (qty <= 0) {
          setError(t('trading.enterValidQuantity'));
          return;
        }
        
        const result = await createPendingOrder({
          portfolioId: portfolio.id,
          symbol: selectedSymbol,
          side,
          quantity: qty,
          orderType: orderType as 'limit' | 'stop' | 'stop_limit',
          limitPrice: orderType === 'limit' || orderType === 'stop_limit' ? parsedLimitPrice : undefined,
          stopPrice: orderType === 'stop' || orderType === 'stop_limit' ? parsedStopPrice : undefined,
          productType,
          leverage: productType !== 'stock' ? leverage : 1,
        });
        
        if (result.success) {
          setSuccessMessage(`${t('trading.orderCreated')} ${selectedSymbol}`);
          await loadPortfolioData();
          setQuantity('10');
          setLimitPrice('');
          setStopOrderPrice('');
          setTimeout(() => setSuccessMessage(null), 5000);
        } else {
          setError(result.error || t('trading.orderFailed'));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t('trading.orderFailed'));
      } finally {
        setOrderLoading(false);
      }
      return;
    }
    
    // Market order
    const qty = parseInt(quantity) || 0;
    if (qty <= 0) {
      setError(t('trading.enterValidQuantity'));
      return;
    }
    
    const request: ExecuteOrderRequest = {
      portfolioId: portfolio.id,
      symbol: selectedSymbol,
      side,
      quantity: qty,
      currentPrice,
      productType,
      leverage: productType !== 'stock' ? leverage : 1,
      stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
      takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
    };
    
    const validation = validateOrder(request, portfolio, feePreview);
    if (!validation.valid) {
      setError(validation.errors.join('\n'));
      return;
    }
    
    try {
      setOrderLoading(true);
      setError(null);
      
      const result = await executeMarketOrder(request);
      
      if (result.success) {
        const sideLabel = side === 'buy' ? t('trading.buy') : side === 'sell' ? t('trading.sell') : t('trading.short');
        setSuccessMessage(`${t('trading.orderSuccess')}: ${sideLabel} ${qty}x ${selectedSymbol}`);
        await loadPortfolioData();
        setQuantity('10');
        setStopLoss('');
        setTakeProfit('');
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setError(result.error || t('trading.orderFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('trading.orderFailed'));
    } finally {
      setOrderLoading(false);
    }
  };
  
  // Handle position close
  const handleClosePosition = async (position: PositionWithPnL) => {
    try {
      setOrderLoading(true);
      setError(null);
      
      const quote = await dataService.fetchQuote(position.symbol);
      if (!quote) {
        throw new Error(t('trading.quoteError'));
      }
      
      const result = await closePosition(position.id, quote.price);
      
      if (result.success) {
        setSuccessMessage(
          `${t('trading.positionClosed')}: ${position.symbol} - P&L: ${formatCurrency(result.realizedPnl || 0)}`
        );
        await loadPortfolioData();
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setError(result.error || t('trading.closeError'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('trading.closeError'));
    } finally {
      setOrderLoading(false);
    }
  };
  
  // Handle position SL/TP update
  const handleUpdatePositionLevels = async (positionId: number) => {
    try {
      setOrderLoading(true);
      setError(null);
      
      const sl = editStopLoss ? parseFloat(editStopLoss) : undefined;
      const tp = editTakeProfit ? parseFloat(editTakeProfit) : undefined;
      
      const result = await updatePositionLevels(positionId, { stopLoss: sl, takeProfit: tp });
      
      if (result) {
        setSuccessMessage(t('trading.updateSuccess'));
        setEditingPosition(null);
        setEditStopLoss('');
        setEditTakeProfit('');
        await loadPortfolioData();
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('trading.updateError'));
    } finally {
      setOrderLoading(false);
    }
  };
  
  const startEditingPosition = (position: PositionWithPnL) => {
    setEditingPosition(position.id);
    setEditStopLoss(position.stopLoss?.toString() || '');
    setEditTakeProfit(position.takeProfit?.toString() || '');
  };
  
  // Portfolio settings handlers
  const handleReset = async () => {
    if (!portfolio) return;
    
    try {
      await resetPortfolio(portfolio.id);
      setSuccessMessage(t('trading.resetSuccess'));
      setShowResetConfirm(false);
      await loadPortfolioData();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch {
      setError(t('trading.resetError'));
    }
  };
  
  const handleCapitalChange = async () => {
    if (!portfolio) return;
    
    const capital = parseFloat(newCapital.replace(/[^\d.,]/g, '').replace(',', '.'));
    if (isNaN(capital)) {
      setError(t('trading.invalidAmount'));
      return;
    }
    
    try {
      setError(null);
      await setInitialCapital(portfolio.id, capital);
      setSuccessMessage(`${t('trading.capitalChanged').replace('{amount}', formatCurrency(capital))}`);
      setShowCapitalChange(false);
      setNewCapital('');
      await loadPortfolioData();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('trading.orderFailed'));
    }
  };
  
  const handleBrokerChange = async (brokerProfile: BrokerProfileId) => {
    if (!portfolio) return;
    
    try {
      await updatePortfolioSettings(portfolio.id, { brokerProfile });
      setPortfolio({ ...portfolio, brokerProfile });
      setSuccessMessage(t('trading.brokerChanged'));
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch {
      setError(t('trading.settingsError'));
    }
  };
  
  // Render login required message
  if (!authState.isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-8">
        <div className="bg-slate-800/50 rounded-xl p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">📊 {t('trading.title')}</h2>
          <p className="text-gray-400 mb-6">
            {t('trading.loginPrompt')}
          </p>
          <a 
            href="/settings" 
            className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
          >
            {t('settings.signIn')}
          </a>
        </div>
      </div>
    );
  }
  
  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }
  
  const maxLeverage = productTypes?.[productType]?.maxLeverage || 1;
  const canShort = productTypes?.[productType]?.canShort || false;
  
  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 space-y-3">
      {/* Compact Header with Key Metrics */}
      <div className="bg-slate-800/50 rounded-xl p-2 sm:p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Title - minimal */}
          <h1 className="text-base sm:text-lg font-bold flex items-center gap-1.5">
            📊 Trading
          </h1>
          
          {/* Key Metrics - inline */}
          {metrics && (
            <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm">
              <div className="flex items-center gap-1">
                <span className="text-gray-400 hidden sm:inline">Wert:</span>
                <span className="font-semibold">{formatCurrency(metrics.totalValue)}</span>
              </div>
              <div className={`flex items-center gap-1 ${metrics.netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                <span className="text-gray-400 hidden sm:inline">P&L:</span>
                <span className="font-semibold">{formatCurrency(metrics.netPnl)}</span>
                <span className="text-[10px] sm:text-xs">({formatPercent(metrics.totalReturn)})</span>
              </div>
              <div className="flex items-center gap-1 text-blue-400">
                <span className="text-gray-400 hidden sm:inline">Cash:</span>
                <span className="font-semibold">{formatCurrency(metrics.cashBalance)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Messages - compact */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-2 sm:p-3 text-red-300 text-sm">
          <div className="flex items-start gap-2">
            <span>⚠️</span>
            <div className="whitespace-pre-line flex-1 text-xs sm:text-sm">{error}</div>
            <button onClick={() => setError(null)} className="text-xs">×</button>
          </div>
        </div>
      )}
      
      {successMessage && (
        <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-2 sm:p-3 text-green-300 text-sm">
          <div className="flex items-center gap-2">
            <span>✅</span>
            <div className="whitespace-pre-line text-xs sm:text-sm">{successMessage}</div>
          </div>
        </div>
      )}
      
      {/* Tabs - kompakt */}
      <div className="flex border-b border-slate-700 overflow-x-auto scrollbar-hide">
        {[
          { id: 'trading', label: 'Handeln', icon: '📈', badge: openPositions.length || null },
          { id: 'overview', label: 'Übersicht', icon: '📊', badge: null },
          { id: 'settings', label: 'Settings', icon: '⚙️', badge: null },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            className={`flex-1 px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap flex items-center justify-center gap-1 ${
              activeTab === tab.id
                ? 'bg-slate-800 text-white border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <span>{tab.icon}</span>
            <span className="hidden xs:inline">{tab.label}</span>
            {tab.badge && (
              <span className="px-1 py-0.5 text-[10px] bg-blue-500 rounded-full min-w-[16px]">{tab.badge}</span>
            )}
          </button>
        ))}
      </div>
      
      {/* Tab Content */}
      <div className="min-h-[500px] w-full">
        {/* TRADING TAB */}
        {activeTab === 'trading' && (
          <div className="w-full space-y-3 sm:space-y-4">
            {/* Top Row: Order Panel + Pending Orders + Quick Stats */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
              {/* Order Panel */}
              <div className="bg-slate-800/50 rounded-xl p-3 sm:p-4 space-y-3 sm:space-y-4">
                <h2 className="text-base sm:text-lg font-semibold">Neue Order</h2>
                
                {/* Symbol Selection */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Symbol</label>
                  <StockSelector selectedSymbol={selectedSymbol} onSelect={setSelectedSymbol} />
                  {currentPrice > 0 && (
                    <div className="mt-2 text-sm text-gray-400">
                      Aktuell: <span className="text-white font-medium">{formatCurrency(currentPrice)}</span>
                    </div>
                  )}
                </div>
                
                {/* Product Type */}
                <div>
                  <label className="block text-xs sm:text-sm text-gray-400 mb-1">Produkttyp</label>
                  <div className="grid grid-cols-4 sm:grid-cols-2 gap-1 sm:gap-2">
                    {['stock', 'cfd', 'knockout', 'factor'].map((type) => (
                      <button
                        key={type}
                        onClick={() => {
                          setProductType(type as ProductType);
                          if (type === 'stock') {
                            setLeverage(1);
                            if (side === 'short') setSide('buy');
                          }
                        }}
                        className={`px-1.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-[10px] sm:text-sm font-medium transition-colors ${
                          productType === type
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                        }`}
                      >
                        {getProductTypeName(type as ProductType)}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Side */}
                <div>
                  <label className="block text-xs sm:text-sm text-gray-400 mb-1">Richtung</label>
                  <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                    <button
                      onClick={() => setSide('buy')}
                      className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-base font-medium transition-colors ${
                        side === 'buy'
                          ? 'bg-green-600 text-white'
                          : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                      }`}
                    >
                      📈 <span className="hidden sm:inline">Kauf </span>Long
                    </button>
                    <button
                      onClick={() => setSide('short')}
                      disabled={!canShort}
                      className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-base font-medium transition-colors ${
                        side === 'short'
                          ? 'bg-red-600 text-white'
                          : canShort 
                            ? 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                            : 'bg-slate-800 text-gray-600 cursor-not-allowed'
                      }`}
                    >
                      📉 Short
                    </button>
                  </div>
                </div>
                
                {/* Quantity & Order Type */}
                <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                  <div>
                    <label className="block text-xs sm:text-sm text-gray-400 mb-1">Menge</label>
                    <input
                      type="number"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      min="1"
                      className="w-full px-2 sm:px-3 py-1.5 sm:py-2 bg-slate-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-sm text-gray-400 mb-1">Order-Typ</label>
                    <select
                      value={orderType}
                      onChange={(e) => setOrderType(e.target.value as OrderType)}
                      className="w-full px-2 sm:px-3 py-1.5 sm:py-2 bg-slate-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="market">Market</option>
                      <option value="limit">Limit</option>
                      <option value="stop">Stop</option>
                      <option value="stop_limit">Stop-Limit</option>
                    </select>
                  </div>
                </div>
                
                {/* Limit/Stop Price Fields */}
                {orderType !== 'market' && (
                  <div className="space-y-2">
                    {(orderType === 'stop' || orderType === 'stop_limit') && (
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">Stop-Preis</label>
                        <input
                          type="number"
                          value={stopOrderPrice}
                          onChange={(e) => setStopOrderPrice(e.target.value)}
                          placeholder={`z.B. ${(currentPrice * 0.98).toFixed(2)}`}
                          step="0.01"
                          className="w-full px-3 py-2 bg-slate-700 rounded-lg text-white focus:ring-2 focus:ring-purple-500 outline-none"
                        />
                      </div>
                    )}
                    {(orderType === 'limit' || orderType === 'stop_limit') && (
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">Limit-Preis</label>
                        <input
                          type="number"
                          value={limitPrice}
                          onChange={(e) => setLimitPrice(e.target.value)}
                          placeholder={`z.B. ${(currentPrice * 0.95).toFixed(2)}`}
                          step="0.01"
                          className="w-full px-3 py-2 bg-slate-700 rounded-lg text-white focus:ring-2 focus:ring-purple-500 outline-none"
                        />
                      </div>
                    )}
                  </div>
                )}
                
                {/* Leverage */}
                {productType !== 'stock' && (
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      Hebel: <span className="text-white font-medium">1:{leverage}</span>
                    </label>
                    <input
                      type="range"
                      min="1"
                      max={maxLeverage}
                      value={leverage}
                      onChange={(e) => setLeverage(parseInt(e.target.value))}
                      className="w-full accent-blue-500"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>1:1</span>
                      <span>1:{maxLeverage}</span>
                    </div>
                  </div>
                )}
                
                {/* Stop Loss & Take Profit */}
                {orderType === 'market' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Stop-Loss</label>
                      <input
                        type="number"
                        value={stopLoss}
                        onChange={(e) => setStopLoss(e.target.value)}
                        placeholder="Optional"
                        step="0.01"
                        className="w-full px-3 py-2 bg-slate-700 rounded-lg text-white focus:ring-2 focus:ring-red-500 outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Take-Profit</label>
                      <input
                        type="number"
                        value={takeProfit}
                        onChange={(e) => setTakeProfit(e.target.value)}
                        placeholder="Optional"
                        step="0.01"
                        className="w-full px-3 py-2 bg-slate-700 rounded-lg text-white focus:ring-2 focus:ring-green-500 outline-none text-sm"
                      />
                    </div>
                  </div>
                )}
                
                {/* Fee Preview */}
                {feePreview && (
                  <div className="bg-slate-900/50 rounded-lg p-3 text-sm">
                    <div className="text-gray-400 mb-2 font-medium">Kostenvorschau</div>
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Ordervolumen:</span>
                        <span>{formatCurrency(feePreview.notionalValue)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Gebühren:</span>
                        <span className="text-yellow-400">{formatCurrency(feePreview.totalFees)}</span>
                      </div>
                      {productType !== 'stock' && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Margin:</span>
                          <span>{formatCurrency(feePreview.marginRequired)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Submit Button */}
                <button
                  onClick={handleSubmitOrder}
                  disabled={orderLoading || !feePreview || currentPrice <= 0}
                  className={`w-full py-2.5 sm:py-3 rounded-lg font-semibold text-sm sm:text-base text-white transition-colors ${
                    orderType !== 'market' 
                      ? 'bg-purple-600 hover:bg-purple-700 disabled:bg-purple-900'
                      : side === 'buy'
                        ? 'bg-green-600 hover:bg-green-700 disabled:bg-green-900'
                        : 'bg-red-600 hover:bg-red-700 disabled:bg-red-900'
                  } disabled:cursor-not-allowed`}
                >
                  {orderLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-white"></div>
                      <span className="hidden sm:inline">Wird ausgeführt...</span>
                      <span className="sm:hidden">...</span>
                    </span>
                  ) : orderType !== 'market' ? (
                    <span><span className="hidden sm:inline">📋 {getOrderTypeName(orderType)}-Order erstellen</span><span className="sm:hidden">{getOrderTypeName(orderType)}</span></span>
                  ) : (
                    `${side === 'buy' ? '📈' : '📉'} ${formatCurrency(feePreview?.marginRequired || 0)}`
                  )}
                </button>
              </div>
            
              {/* Pending Orders */}
              {portfolio && (
                <div className="bg-slate-800/50 rounded-xl p-3 sm:p-4">
                  <PendingOrders 
                    portfolioId={portfolio.id}
                    onOrderCancelled={loadPortfolioData}
                  />
                </div>
              )}
            
              {/* Quick Stats */}
              {metrics && (
                <div className="bg-slate-800/50 rounded-xl p-3 sm:p-4">
                  <h2 className="text-base sm:text-lg font-semibold mb-3">📊 Performance</h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Trades gesamt:</span>
                      <span>{metrics.totalTrades}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Gewinner / Verlierer:</span>
                      <span>
                        <span className="text-green-400">{metrics.winningTrades}</span>
                        {' / '}
                        <span className="text-red-400">{metrics.losingTrades}</span>
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Win-Rate:</span>
                      <span className={metrics.winRate >= 50 ? 'text-green-400' : 'text-red-400'}>
                        {metrics.winRate.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-700 pt-2 mt-2">
                      <span className="text-gray-400">Gebühren gesamt:</span>
                      <span className="text-yellow-400">{formatCurrency(metrics.totalFees)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Margin Warnings */}
            {metrics?.isMarginWarning && (
              <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-2.5 sm:p-4">
                <div className="flex items-center gap-2 text-yellow-300 text-xs sm:text-base">
                  <span>⚠️</span>
                  <span className="font-medium">Margin-Warnung: {metrics.marginLevel?.toFixed(1)}%</span>
                </div>
              </div>
            )}
            
            {metrics?.isLiquidationRisk && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-2.5 sm:p-4">
                <div className="flex items-center gap-2 text-red-300 text-xs sm:text-base">
                  <span>🚨</span>
                  <span className="font-medium">Liquidations-Risiko! Margin: {metrics.marginLevel?.toFixed(1)}%</span>
                </div>
              </div>
            )}
            
            {/* Open Positions - integrated into Trading Tab */}
            <div>
              <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">📈 Offene Positionen ({openPositions.length})</h3>
              {openPositions.length === 0 ? (
                <div className="text-center py-6 sm:py-8 text-gray-400 bg-slate-800/50 rounded-xl">
                  <div className="text-3xl sm:text-4xl mb-2">📭</div>
                  <p className="text-sm sm:text-base">Keine offenen Positionen</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-4">
                  {openPositions.map((position) => (
                    <div key={position.id} className="bg-slate-800/50 rounded-xl p-2.5 sm:p-4">
                      <div className="flex items-start justify-between mb-2 sm:mb-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                            <span className="font-semibold text-sm sm:text-xl">{position.symbol}</span>
                            <span className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium ${
                              position.side === 'long' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                            }`}>
                              {position.side.toUpperCase()}
                            </span>
                            <span className="hidden sm:inline px-2 py-0.5 rounded text-xs bg-slate-700 text-gray-300">
                              {getProductTypeName(position.productType)}
                            </span>
                            {position.leverage > 1 && (
                              <span className="px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs bg-blue-500/20 text-blue-400">
                                1:{position.leverage}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] sm:text-sm text-gray-400 mt-0.5 sm:mt-1">
                            {position.quantity}x @ {formatCurrency(position.entryPrice)}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-2">
                          <div className={`text-base sm:text-2xl font-bold ${
                            position.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {formatCurrency(position.unrealizedPnl)}
                          </div>
                          <div className={`text-[10px] sm:text-sm ${
                            position.leveragedPnlPercent >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {formatPercent(position.leveragedPnlPercent)}
                          </div>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-4 gap-1 sm:gap-3 text-[10px] sm:text-sm mb-2 sm:mb-3">
                        <div className="bg-slate-900/50 rounded p-1 sm:p-2">
                          <div className="text-gray-500 text-[9px] sm:text-xs">Kurs</div>
                          <div className="font-medium truncate text-[10px] sm:text-sm">{formatCurrency(position.currentPrice || position.entryPrice)}</div>
                        </div>
                        <div className="bg-slate-900/50 rounded p-1 sm:p-2">
                          <div className="text-gray-500 text-[9px] sm:text-xs">Wert</div>
                          <div className="font-medium truncate text-[10px] sm:text-sm">{formatCurrency((position.currentPrice || position.entryPrice) * position.quantity)}</div>
                        </div>
                        <div className="bg-slate-900/50 rounded p-1 sm:p-2">
                          <div className="text-gray-500 text-[9px] sm:text-xs">Margin</div>
                          <div className="font-medium truncate text-[10px] sm:text-sm">{formatCurrency(position.marginUsed || 0)}</div>
                        </div>
                        <div className="bg-slate-900/50 rounded p-1 sm:p-2">
                          <div className="text-gray-500 text-[9px] sm:text-xs">Gebühren</div>
                          <div className="font-medium text-yellow-400 truncate text-[10px] sm:text-sm">{formatCurrency(position.totalFeesPaid)}</div>
                        </div>
                      </div>
                      
                      {/* Second row of details - simpler on mobile */}
                      <div className="grid grid-cols-3 gap-1 sm:gap-3 text-[10px] sm:text-sm mb-2 sm:mb-3">
                        <div className="bg-slate-900/50 rounded p-1 sm:p-2">
                          <div className="text-gray-500 text-[9px] sm:text-xs">Datum</div>
                          <div className="font-medium text-[10px] sm:text-sm">{new Date(position.openedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</div>
                        </div>
                        <div className="bg-slate-900/50 rounded p-1 sm:p-2">
                          <div className="text-gray-500 text-[9px] sm:text-xs">Tage</div>
                          <div className="font-medium text-[10px] sm:text-sm">{position.daysHeld}</div>
                        </div>
                        <div className="bg-slate-900/50 rounded p-1 sm:p-2">
                          <div className="text-gray-500 text-[9px] sm:text-xs">Hebel</div>
                          <div className="font-medium text-[10px] sm:text-sm">{position.leverage > 1 ? `${position.leverage}x` : '—'}</div>
                        </div>
                      </div>
                      
                      {/* Liquidation Info for leveraged positions */}
                      {position.leverage > 1 && position.liquidationPrice && (
                        <div className="bg-red-500/10 rounded p-1.5 sm:p-2 mb-2 sm:mb-3">
                          <div className="flex items-center justify-between text-xs sm:text-sm">
                            <span className="text-gray-400">Liquidation:</span>
                            <span className="text-red-400 font-medium">{formatCurrency(position.liquidationPrice)}</span>
                          </div>
                          {position.distanceToLiquidation !== null && (
                            <div className="mt-1.5 sm:mt-2">
                              <div className="flex items-center justify-between text-[10px] sm:text-xs text-gray-500 mb-1">
                                <span>Abstand</span>
                                <span className={position.distanceToLiquidation > 20 ? 'text-green-400' : 'text-red-400'}>
                                  {position.distanceToLiquidation.toFixed(1)}%
                                </span>
                              </div>
                              <div className="h-1.5 sm:h-2 bg-slate-700 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full transition-all ${
                                    position.distanceToLiquidation > 50 ? 'bg-green-500' :
                                    position.distanceToLiquidation > 20 ? 'bg-yellow-500' : 'bg-red-500'
                                  }`}
                                  style={{ width: `${Math.min(100, position.distanceToLiquidation)}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* SL/TP Display & Edit */}
                      <div className="border-t border-slate-700 pt-2 sm:pt-3">
                        {editingPosition === position.id ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                              <div>
                                <label className="text-[10px] sm:text-xs text-gray-400">Stop-Loss</label>
                                <input
                                  type="number"
                                  value={editStopLoss}
                                  onChange={(e) => setEditStopLoss(e.target.value)}
                                  placeholder="Kein SL"
                                  step="0.01"
                                  className="w-full px-2 py-1 sm:py-1.5 bg-slate-800 rounded text-xs sm:text-sm text-white focus:ring-1 focus:ring-red-500 outline-none"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] sm:text-xs text-gray-400">Take-Profit</label>
                                <input
                                  type="number"
                                  value={editTakeProfit}
                                  onChange={(e) => setEditTakeProfit(e.target.value)}
                                  placeholder="Kein TP"
                                  step="0.01"
                                  className="w-full px-2 py-1 sm:py-1.5 bg-slate-800 rounded text-xs sm:text-sm text-white focus:ring-1 focus:ring-green-500 outline-none"
                                />
                              </div>
                            </div>
                            <div className="flex gap-1.5 sm:gap-2">
                              <button
                                onClick={() => {
                                  setEditingPosition(null);
                                  setEditStopLoss('');
                                  setEditTakeProfit('');
                                }}
                                className="flex-1 px-2 sm:px-3 py-1 sm:py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs sm:text-sm"
                              >
                                Abbrechen
                              </button>
                              <button
                                onClick={() => handleUpdatePositionLevels(position.id)}
                                disabled={orderLoading}
                                className="flex-1 px-2 sm:px-3 py-1 sm:py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs sm:text-sm disabled:opacity-50"
                              >
                                OK
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2">
                            <div className="flex gap-2 sm:gap-4 text-[10px] sm:text-sm">
                              <span className="text-gray-500">
                                SL: <span className={position.stopLoss ? 'text-red-400 font-medium' : 'text-gray-600'}>
                                  {position.stopLoss ? formatCurrency(position.stopLoss) : '—'}
                                </span>
                              </span>
                              <span className="text-gray-500">
                                TP: <span className={position.takeProfit ? 'text-green-400 font-medium' : 'text-gray-600'}>
                                  {position.takeProfit ? formatCurrency(position.takeProfit) : '—'}
                                </span>
                              </span>
                            </div>
                            <div className="flex gap-1.5 sm:gap-2">
                              <button
                                onClick={() => startEditingPosition(position)}
                                className="flex-1 sm:flex-none px-2 py-1 sm:py-1.5 text-[10px] sm:text-sm text-gray-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors"
                              >
                                ✏️ SL/TP
                              </button>
                              <button
                                onClick={() => handleClosePosition(position)}
                                disabled={orderLoading}
                                className="flex-1 sm:flex-none px-2 sm:px-3 py-1 sm:py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-[10px] sm:text-sm font-medium transition-colors disabled:opacity-50"
                              >
                                Schließen
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Closed Positions History - integrated into Trading Tab */}
            <div>
              <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">📜 Geschlossen ({allPositions.filter(p => !p.isOpen).length})</h3>
              {allPositions.filter(p => !p.isOpen).length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-sm bg-slate-800/50 rounded-xl">Noch keine geschlossenen Positionen</div>
              ) : (
                <>
                  {/* Mobile: Card Layout */}
                  <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {allPositions.filter(p => !p.isOpen).slice(0, 6).map((pos) => (
                      <div key={pos.id} className="bg-slate-800/50 rounded-xl p-2.5">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-sm">{pos.symbol}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${pos.side === 'long' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                              {pos.side.toUpperCase()}
                            </span>
                          </div>
                          <div className={`text-sm font-bold ${(pos.realizedPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatCurrency(pos.realizedPnl || 0)}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                          <div className="bg-slate-900/50 rounded p-1.5">
                            <div className="text-gray-500">Menge</div>
                            <div className="font-medium">{pos.quantity}x</div>
                          </div>
                          <div className="bg-slate-900/50 rounded p-1.5">
                            <div className="text-gray-500">Einstieg</div>
                            <div className="font-medium truncate">{formatCurrency(pos.entryPrice)}</div>
                          </div>
                          <div className="bg-slate-900/50 rounded p-1.5">
                            <div className="text-gray-500">Ausstieg</div>
                            <div className="font-medium truncate">{formatCurrency(pos.closePrice || pos.entryPrice)}</div>
                          </div>
                        </div>
                        <div className="text-[10px] text-gray-500 mt-1.5">
                          {pos.closedAt ? new Date(pos.closedAt).toLocaleDateString('de-DE') : '-'} • {getProductTypeName(pos.productType)}
                        </div>
                      </div>
                    ))}
                    {allPositions.filter(p => !p.isOpen).length > 6 && (
                      <div className="text-center text-xs text-gray-500 py-2 col-span-full">
                        + {allPositions.filter(p => !p.isOpen).length - 6} weitere
                      </div>
                    )}
                  </div>
                  {/* Desktop: Table Layout */}
                  <div className="hidden lg:block overflow-x-auto bg-slate-800/50 rounded-xl p-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-400 border-b border-slate-700">
                          <th className="pb-2 pr-4">Symbol</th>
                          <th className="pb-2 pr-4">Typ</th>
                          <th className="pb-2 pr-4">Seite</th>
                          <th className="pb-2 pr-4 text-right">Menge</th>
                          <th className="pb-2 pr-4 text-right">Einstieg</th>
                          <th className="pb-2 pr-4 text-right">Ausstieg</th>
                          <th className="pb-2 pr-4 text-right">P&L</th>
                          <th className="pb-2 text-right">Datum</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allPositions.filter(p => !p.isOpen).map((pos) => (
                          <tr key={pos.id} className="border-b border-slate-800 hover:bg-slate-800/30">
                            <td className="py-2.5 pr-4 font-medium">{pos.symbol}</td>
                            <td className="py-2.5 pr-4 text-gray-400">{getProductTypeName(pos.productType)}</td>
                            <td className="py-2.5 pr-4">
                              <span className={pos.side === 'long' ? 'text-green-400' : 'text-red-400'}>
                                {pos.side.toUpperCase()}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4 text-right">{pos.quantity}</td>
                            <td className="py-2.5 pr-4 text-right">{formatCurrency(pos.entryPrice)}</td>
                            <td className="py-2.5 pr-4 text-right">{formatCurrency(pos.closePrice || pos.entryPrice)}</td>
                            <td className={`py-2.5 pr-4 text-right font-medium ${(pos.realizedPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {formatCurrency(pos.realizedPnl || 0)}
                            </td>
                            <td className="py-2.5 text-right text-gray-400">
                              {pos.closedAt ? new Date(pos.closedAt).toLocaleDateString('de-DE') : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && metrics && (
          <div className="w-full space-y-3 sm:space-y-4">
            {/* Key Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
              <div className="bg-slate-800/50 rounded-lg p-2.5 sm:p-4">
                <div className="text-xs sm:text-sm text-gray-400">Gesamtwert</div>
                <div className="text-base sm:text-xl font-bold truncate">{formatCurrency(metrics.totalValue)}</div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-2.5 sm:p-4">
                <div className="text-xs sm:text-sm text-gray-400">Bargeld</div>
                <div className="text-base sm:text-xl font-bold text-blue-400 truncate">{formatCurrency(metrics.cashBalance)}</div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-2.5 sm:p-4">
                <div className="text-xs sm:text-sm text-gray-400">Unrealisiert</div>
                <div className={`text-base sm:text-xl font-bold truncate ${metrics.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatCurrency(metrics.unrealizedPnl)}
                </div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-2.5 sm:p-4">
                <div className="text-xs sm:text-sm text-gray-400">Realisiert</div>
                <div className={`text-base sm:text-xl font-bold truncate ${metrics.realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatCurrency(metrics.realizedPnl)}
                </div>
              </div>
            </div>
            
            {/* Trading Stats & Fees */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              <div className="bg-slate-800/50 rounded-xl p-3 sm:p-4">
                <h3 className="text-base sm:text-lg font-semibold mb-2 sm:mb-3">📊 Trading-Statistik</h3>
                <div className="space-y-1 sm:space-y-2 text-xs sm:text-sm">
                  <div className="flex justify-between py-2 border-b border-slate-700">
                    <span className="text-gray-400">Trades gesamt</span>
                    <span className="font-medium">{metrics.totalTrades}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-700">
                    <span className="text-gray-400">Gewinner / Verlierer</span>
                    <span>
                      <span className="text-green-400">{metrics.winningTrades}</span>
                      {' / '}
                      <span className="text-red-400">{metrics.losingTrades}</span>
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-700">
                    <span className="text-gray-400">Win-Rate</span>
                    <span className={`font-medium ${metrics.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                      {metrics.winRate.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-700">
                    <span className="text-gray-400">Ø Gewinn / Verlust</span>
                    <span>
                      <span className="text-green-400">{formatCurrency(metrics.avgWin)}</span>
                      {' / '}
                      <span className="text-red-400">{formatCurrency(metrics.avgLoss)}</span>
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="bg-slate-800/50 rounded-xl p-3 sm:p-4">
                <h3 className="text-base sm:text-lg font-semibold mb-2 sm:mb-3">💰 Gebühren</h3>
                {feeSummary && (
                  <div className="space-y-1 sm:space-y-2 text-xs sm:text-sm">
                    <div className="flex justify-between py-2 border-b border-slate-700">
                      <span className="text-gray-400">Kommissionen</span>
                      <span className="text-yellow-400">{formatCurrency(feeSummary.commission)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-700">
                      <span className="text-gray-400">Spread-Kosten</span>
                      <span className="text-yellow-400">{formatCurrency(feeSummary.spread)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-700">
                      <span className="text-gray-400">Overnight-Gebühren</span>
                      <span className="text-yellow-400">{formatCurrency(feeSummary.overnight)}</span>
                    </div>
                    <div className="flex justify-between py-2 font-medium">
                      <span>Gesamt</span>
                      <span className="text-yellow-400">{formatCurrency(feeSummary.total)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Margin Info */}
            {metrics.marginUsed > 0 && (
              <div className="bg-slate-800/50 rounded-xl p-3 sm:p-4">
                <h3 className="text-base sm:text-lg font-semibold mb-2 sm:mb-3">📊 Margin-Status</h3>
                <div className="grid grid-cols-3 gap-2 sm:gap-4">
                  <div>
                    <div className="text-xs sm:text-sm text-gray-400">Verwendet</div>
                    <div className="text-sm sm:text-lg font-medium truncate">{formatCurrency(metrics.marginUsed)}</div>
                  </div>
                  <div>
                    <div className="text-xs sm:text-sm text-gray-400">Frei</div>
                    <div className="text-sm sm:text-lg font-medium text-blue-400 truncate">{formatCurrency(metrics.freeMargin)}</div>
                  </div>
                  <div>
                    <div className="text-xs sm:text-sm text-gray-400">Level</div>
                    <div className={`text-sm sm:text-lg font-medium ${
                      (metrics.marginLevel || 0) > 150 ? 'text-green-400' :
                      (metrics.marginLevel || 0) > 100 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {metrics.marginLevel?.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Equity Chart & Transactions - 2 columns on desktop */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              {/* Equity Chart */}
              <div className="bg-slate-800/50 rounded-xl p-3 sm:p-4">
                <h3 className="text-base sm:text-lg font-semibold mb-2 sm:mb-3">📈 Portfolio-Entwicklung</h3>
                <EquityChart portfolioId={portfolio!.id} days={90} height={200} />
              </div>
              
              {/* Transaction History */}
              <div className="bg-slate-800/50 rounded-xl p-3 sm:p-4 overflow-hidden">
                <h3 className="text-base sm:text-lg font-semibold mb-2 sm:mb-3">📜 Transaktionen ({transactions.length})</h3>
                {transactions.length === 0 ? (
                  <div className="text-center py-6 sm:py-8 text-gray-400 text-sm">Noch keine Transaktionen</div>
                ) : (
                  <div className="space-y-1 sm:space-y-2 max-h-[300px] overflow-y-auto">
                    {transactions.slice(0, 20).map((tx) => {
                      // Kürze lange Beschreibungen für Mobile
                      const getShortDescription = () => {
                        if (tx.symbol) return `${getSideName(tx.transactionType)} ${tx.symbol}`;
                        if (tx.transactionType === 'reset') return 'Reset';
                        if (tx.transactionType === 'overnight_fee') return 'Overnight';
                        if (tx.description?.includes('Startkapital') || tx.description?.includes('Kapital')) return 'Kapital';
                        return tx.transactionType;
                      };
                      
                      return (
                        <div key={tx.id} className="bg-slate-900/50 rounded-lg p-1.5 sm:p-3 flex items-center gap-1.5 sm:gap-3">
                          {/* Icon */}
                          <div className={`w-5 h-5 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-[10px] sm:text-base flex-shrink-0 ${
                            tx.transactionType === 'buy' ? 'bg-green-500/20 text-green-400' :
                            tx.transactionType === 'sell' || tx.transactionType === 'close' ? 'bg-red-500/20 text-red-400' :
                            tx.transactionType === 'overnight_fee' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {tx.transactionType === 'buy' ? '📈' :
                             tx.transactionType === 'sell' || tx.transactionType === 'close' ? '📉' :
                             tx.transactionType === 'overnight_fee' ? '🌙' :
                             tx.transactionType === 'reset' ? '🔄' : '💰'}
                          </div>
                          
                          {/* Description */}
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="font-medium text-[11px] sm:text-sm truncate">
                              {getShortDescription()}
                            </div>
                            <div className="text-[9px] sm:text-xs text-gray-400">
                              {tx.quantity ? `${tx.quantity}x` : new Date(tx.executedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                            </div>
                          </div>
                          
                          {/* Amount & Date */}
                          <div className="text-right flex-shrink-0">
                            <div className={`font-bold text-[11px] sm:text-sm ${(tx.cashImpact || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {tx.cashImpact ? formatCurrency(tx.cashImpact) : '-'}
                            </div>
                            <div className="text-[9px] sm:text-xs text-gray-400">
                              {new Date(tx.executedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {transactions.length > 20 && (
                      <div className="text-center text-xs text-gray-500 py-2">
                        + {transactions.length - 20} weitere Transaktionen
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* SETTINGS TAB */}
        {activeTab === 'settings' && portfolio && (
          <div className="w-full space-y-2 sm:space-y-4">
            {/* Top Row: Capital + Danger Zone */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-4">
              {/* Capital */}
              <div className="bg-slate-800/50 rounded-xl p-2.5 sm:p-4">
                <h3 className="text-base sm:text-lg font-semibold mb-2 sm:mb-4">💰 Startkapital</h3>
                <div className="flex items-center justify-between gap-2 sm:gap-3 mb-2 sm:mb-4">
                  <div>
                    <div className="text-[10px] sm:text-sm text-gray-400">Aktuelles Startkapital</div>
                    <div className="text-lg sm:text-2xl font-bold">{formatCurrency(portfolio.initialCapital)}</div>
                  </div>
                  {!showCapitalChange && (
                    <button
                      onClick={() => {
                        setNewCapital(portfolio.initialCapital.toString());
                        setShowCapitalChange(true);
                      }}
                      className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-xs sm:text-base"
                    >
                      Ändern
                    </button>
                  )}
                </div>
                
                {showCapitalChange && (
                  <div className="border-t border-slate-700 pt-3 sm:pt-4">
                    <p className="text-xs sm:text-sm text-yellow-400 mb-2 sm:mb-3">
                      ⚠️ Änderung setzt Portfolio zurück.
                    </p>
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        value={newCapital}
                        onChange={(e) => setNewCapital(e.target.value)}
                        placeholder="z.B. 50000"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
                      />
                      <div className="flex gap-1.5 flex-wrap">
                        {[1000, 5000, 10000, 25000, 50000, 100000].map((amount) => (
                          <button
                            key={amount}
                            onClick={() => setNewCapital(amount.toString())}
                            className={`px-2 py-1 text-[10px] sm:text-xs rounded transition-colors ${
                              newCapital === amount.toString()
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-700 hover:bg-slate-600 text-gray-300'
                            }`}
                          >
                            {amount >= 1000000 ? `${amount / 1000000}M` : `${amount / 1000}k`}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleCapitalChange}
                          className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded-lg transition-colors text-xs sm:text-sm"
                        >
                          Speichern
                        </button>
                        <button
                          onClick={() => { setShowCapitalChange(false); setNewCapital(''); }}
                          className="flex-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-xs sm:text-sm"
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Danger Zone */}
              <div className="bg-slate-800/50 rounded-xl p-2.5 sm:p-4">
                <h3 className="text-base sm:text-lg font-semibold mb-2 sm:mb-4 text-red-400">⚠️ Gefahrenzone</h3>
                {!showResetConfirm ? (
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors text-xs sm:text-sm"
                  >
                    Portfolio zurücksetzen
                  </button>
                ) : (
                  <div className="bg-red-500/20 rounded-lg p-2.5 sm:p-4">
                    <p className="text-red-300 mb-2 text-[10px] sm:text-sm">
                      Alle Positionen werden geschlossen und das Kapital auf {formatCurrency(portfolio.initialCapital)} zurückgesetzt.
                    </p>
                    <div className="flex gap-1.5 sm:gap-2">
                      <button
                        onClick={handleReset}
                        className="px-2.5 sm:px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-[10px] sm:text-sm"
                      >
                        Ja, zurücksetzen
                      </button>
                      <button
                        onClick={() => setShowResetConfirm(false)}
                        className="px-2.5 sm:px-4 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-[10px] sm:text-sm"
                      >
                        Abbrechen
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Broker Profile - Full Width */}
            <div className="bg-slate-800/50 rounded-xl p-2.5 sm:p-4">
              <h3 className="text-base sm:text-lg font-semibold mb-2 sm:mb-4">🏦 Broker-Profil</h3>
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-1.5 sm:gap-3">
                {brokerProfiles && Object.entries(brokerProfiles).map(([id, profile]) => (
                  <button
                    key={id}
                    onClick={() => handleBrokerChange(id as BrokerProfileId)}
                    className={`p-2 sm:p-4 rounded-lg text-left transition-colors ${
                      portfolio.brokerProfile === id
                        ? 'bg-blue-600 ring-2 ring-blue-400'
                        : 'bg-slate-900/50 hover:bg-slate-700'
                    }`}
                  >
                    <div className="font-semibold text-xs sm:text-base">{profile.name}</div>
                    <div className="text-[10px] sm:text-sm text-gray-400 mt-0.5 line-clamp-2">{profile.description}</div>
                    <div className="text-[9px] sm:text-xs text-gray-500 mt-1">
                      Spread: {profile.spreadPercent}%
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TradingPortfolioPage;
