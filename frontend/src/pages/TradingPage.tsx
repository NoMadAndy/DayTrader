/**
 * TradingPage - Paper Trading / Stock Market Simulation
 * 
 * Main page for paper trading with virtual money.
 * Supports stocks, CFDs, knock-out certificates, and factor certificates.
 */

import { useState, useEffect, useCallback } from 'react';
import { useDataService } from '../hooks';
import { getAuthState, subscribeToAuth, type AuthState } from '../services/authService';
import {
  getOrCreatePortfolio,
  getOpenPositions,
  getPortfolioMetrics,
  executeMarketOrder,
  closePosition,
  calculateFees,
  getProductTypes,
  calculatePositionPnL,
  formatCurrency,
  formatPercent,
  getProductTypeName,
  getSideName,
  validateOrder,
  createPendingOrder,
  getOrderTypeName,
} from '../services/tradingService';
import type {
  Portfolio,
  PositionWithPnL,
  PortfolioMetrics,
  ProductTypes,
  FeeCalculation,
  ProductType,
  OrderSide,
  ExecuteOrderRequest,
  OrderType,
} from '../types/trading';
import { StockSelector, PendingOrders } from '../components';

export function TradingPage() {
  const { dataService } = useDataService();
  
  // Auth state
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  
  // Portfolio state
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [positions, setPositions] = useState<PositionWithPnL[]>([]);
  const [metrics, setMetrics] = useState<PortfolioMetrics | null>(null);
  
  // Configuration
  const [productTypes, setProductTypes] = useState<ProductTypes | null>(null);
  
  // Trading form
  const [selectedSymbol, setSelectedSymbol] = useState('AAPL');
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [productType, setProductType] = useState<ProductType>('stock');
  const [side, setSide] = useState<OrderSide>('buy');
  const [quantity, setQuantity] = useState<number>(10);
  const [leverage, setLeverage] = useState<number>(1);
  const [stopLoss, setStopLoss] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [stopOrderPrice, setStopOrderPrice] = useState<string>('');
  
  // Fee preview
  const [feePreview, setFeePreview] = useState<FeeCalculation | null>(null);
  
  // UI state
  const [loading, setLoading] = useState(true);
  const [orderLoading, setOrderLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Subscribe to auth changes
  useEffect(() => {
    return subscribeToAuth(setAuthState);
  }, []);
  
  // Load configuration
  useEffect(() => {
    async function loadConfig() {
      try {
        const products = await getProductTypes();
        setProductTypes(products);
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
      const [portfolioData, positionsData, metricsData] = await Promise.all([
        getOrCreatePortfolio(),
        getOrCreatePortfolio().then(p => getOpenPositions(p.id)),
        getOrCreatePortfolio().then(p => getPortfolioMetrics(p.id)),
      ]);
      
      setPortfolio(portfolioData);
      setMetrics(metricsData);
      
      // Update positions with current prices
      const updatedPositions = positionsData.map(pos => 
        calculatePositionPnL(pos, pos.currentPrice || pos.entryPrice)
      );
      setPositions(updatedPositions);
    } catch (e) {
      console.error('Failed to load portfolio:', e);
      setError('Portfolio konnte nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, [authState.isAuthenticated]);
  
  useEffect(() => {
    loadPortfolioData();
  }, [loadPortfolioData]);
  
  // Load current price for selected symbol
  useEffect(() => {
    async function loadPrice() {
      try {
        const quote = await dataService.fetchQuote(selectedSymbol);
        if (quote) {
          setCurrentPrice(quote.price);
        }
      } catch (e) {
        console.error('Failed to get quote:', e);
      }
    }
    loadPrice();
    
    // Refresh price every 30 seconds
    const interval = setInterval(loadPrice, 30000);
    return () => clearInterval(interval);
  }, [selectedSymbol, dataService]);
  
  // Calculate fee preview
  useEffect(() => {
    async function updateFeePreview() {
      if (!currentPrice || quantity <= 0) {
        setFeePreview(null);
        return;
      }
      
      try {
        const fees = await calculateFees({
          productType,
          side,
          quantity,
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
        
        // Validate required prices
        if (orderType === 'limit' && (isNaN(parsedLimitPrice) || parsedLimitPrice <= 0)) {
          setError('Bitte gültigen Limit-Preis eingeben');
          return;
        }
        if (orderType === 'stop' && (isNaN(parsedStopPrice) || parsedStopPrice <= 0)) {
          setError('Bitte gültigen Stop-Preis eingeben');
          return;
        }
        if (orderType === 'stop_limit' && ((isNaN(parsedStopPrice) || parsedStopPrice <= 0) || (isNaN(parsedLimitPrice) || parsedLimitPrice <= 0))) {
          setError('Bitte gültigen Stop- und Limit-Preis eingeben');
          return;
        }
        
        const result = await createPendingOrder({
          portfolioId: portfolio.id,
          symbol: selectedSymbol,
          side,
          quantity,
          orderType: orderType as 'limit' | 'stop' | 'stop_limit',
          limitPrice: orderType === 'limit' || orderType === 'stop_limit' ? parsedLimitPrice : undefined,
          stopPrice: orderType === 'stop' || orderType === 'stop_limit' ? parsedStopPrice : undefined,
          productType,
          leverage: productType !== 'stock' ? leverage : 1,
        });
        
        if (result.success) {
          setSuccessMessage(`${getOrderTypeName(orderType)}-Order erstellt für ${selectedSymbol}`);
          await loadPortfolioData();
          setQuantity(10);
          setLimitPrice('');
          setStopOrderPrice('');
          setTimeout(() => setSuccessMessage(null), 5000);
        } else {
          setError(result.error || 'Order konnte nicht erstellt werden');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Order fehlgeschlagen');
      } finally {
        setOrderLoading(false);
      }
      return;
    }
    
    // Market order
    const request: ExecuteOrderRequest = {
      portfolioId: portfolio.id,
      symbol: selectedSymbol,
      side,
      quantity,
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
        setSuccessMessage(`Order erfolgreich: ${getSideName(side)} ${quantity}x ${selectedSymbol}`);
        await loadPortfolioData();
        
        // Clear form
        setQuantity(10);
        setStopLoss('');
        setTakeProfit('');
        
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setError(result.error || 'Order fehlgeschlagen');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Order fehlgeschlagen');
    } finally {
      setOrderLoading(false);
    }
  };
  
  // Handle position close
  const handleClosePosition = async (position: PositionWithPnL) => {
    try {
      setOrderLoading(true);
      setError(null);
      
      // Get current price
      const quote = await dataService.fetchQuote(position.symbol);
      if (!quote) {
        throw new Error('Kurs konnte nicht abgerufen werden');
      }
      
      const result = await closePosition(position.id, quote.price);
      
      if (result.success) {
        setSuccessMessage(
          `Position geschlossen: ${position.symbol} - P&L: ${formatCurrency(result.realizedPnl || 0)}`
        );
        await loadPortfolioData();
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setError(result.error || 'Position konnte nicht geschlossen werden');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Schließen');
    } finally {
      setOrderLoading(false);
    }
  };
  
  // Render login required message
  if (!authState.isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-slate-800/50 rounded-xl p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">🎮 Paper Trading</h2>
          <p className="text-gray-400 mb-6">
            Melde dich an, um mit virtuellem Geld zu handeln und deine Strategien zu testen.
          </p>
          <a 
            href="/settings" 
            className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
          >
            Anmelden
          </a>
        </div>
      </div>
    );
  }
  
  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }
  
  const maxLeverage = productTypes?.[productType]?.maxLeverage || 1;
  const canShort = productTypes?.[productType]?.canShort || false;
  
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            🎮 Paper Trading
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Handeln Sie mit virtuellem Geld - kein echtes Risiko
          </p>
        </div>
        
        {/* Portfolio Summary */}
        {metrics && (
          <div className="flex items-center gap-6 bg-slate-800/50 rounded-lg px-4 py-3">
            <div>
              <div className="text-xs text-gray-400">Portfolio-Wert</div>
              <div className="text-lg font-semibold">{formatCurrency(metrics.totalValue)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">P&L</div>
              <div className={`text-lg font-semibold ${metrics.netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatCurrency(metrics.netPnl)} ({formatPercent(metrics.totalReturn)})
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Verfügbar</div>
              <div className="text-lg font-semibold text-blue-400">{formatCurrency(metrics.cashBalance)}</div>
            </div>
          </div>
        )}
      </div>
      
      {/* Messages */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 text-red-300">
          <div className="flex items-start gap-2">
            <span>⚠️</span>
            <div className="whitespace-pre-line">{error}</div>
          </div>
          <button onClick={() => setError(null)} className="mt-2 text-sm underline">Schließen</button>
        </div>
      )}
      
      {successMessage && (
        <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-4 text-green-300">
          <div className="flex items-center gap-2">
            <span>✅</span>
            <div>{successMessage}</div>
          </div>
        </div>
      )}
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Order Panel */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-slate-800/50 rounded-xl p-4">
            <h2 className="text-lg font-semibold mb-4">📈 Neue Order</h2>
            
            {/* Symbol Selection */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Symbol</label>
              <StockSelector
                selectedSymbol={selectedSymbol}
                onSelect={setSelectedSymbol}
              />
              {currentPrice > 0 && (
                <div className="mt-2 text-sm text-gray-400">
                  Aktueller Kurs: <span className="text-white font-medium">{formatCurrency(currentPrice)}</span>
                </div>
              )}
            </div>
            
            {/* Product Type */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Produkttyp</label>
              <div className="grid grid-cols-2 gap-2">
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
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
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
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Richtung</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSide('buy')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    side === 'buy'
                      ? 'bg-green-600 text-white'
                      : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                  }`}
                >
                  📈 Kauf (Long)
                </button>
                <button
                  onClick={() => setSide('short')}
                  disabled={!canShort}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
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
            
            {/* Quantity */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Menge</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 0))}
                min="1"
                className="w-full px-3 py-2 bg-slate-700 rounded-lg text-white focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            
            {/* Order Type */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Order-Typ</label>
              <div className="grid grid-cols-2 gap-2">
                {(['market', 'limit', 'stop', 'stop_limit'] as OrderType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setOrderType(type)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      orderType === type
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                    }`}
                  >
                    {getOrderTypeName(type)}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Limit/Stop Price Fields */}
            {orderType !== 'market' && (
              <div className="mb-4 space-y-2">
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
                    <label className="block text-sm text-gray-400 mb-1">
                      {orderType === 'limit' ? 'Limit-Preis' : 'Limit-Preis (nach Stop)'}
                    </label>
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
                <div className="text-xs text-gray-500 p-2 bg-slate-900/50 rounded">
                  {orderType === 'limit' && '📌 Order wird ausgeführt wenn der Preis das Limit erreicht oder unterschreitet'}
                  {orderType === 'stop' && '📌 Order wird zum Marktpreis ausgeführt wenn der Stop-Preis erreicht wird'}
                  {orderType === 'stop_limit' && '📌 Bei Erreichen des Stop-Preises wird eine Limit-Order platziert'}
                </div>
              </div>
            )}
            
            {/* Leverage (for non-stock products) */}
            {productType !== 'stock' && (
              <div className="mb-4">
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
            <div className="grid grid-cols-2 gap-2 mb-4">
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
            
            {/* Fee Preview */}
            {feePreview && (
              <div className="bg-slate-900/50 rounded-lg p-3 mb-4 text-sm">
                <div className="text-gray-400 mb-2 font-medium">Kostenvorschau</div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Ordervolumen:</span>
                    <span>{formatCurrency(feePreview.notionalValue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Kommission:</span>
                    <span>{formatCurrency(feePreview.commission)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Spread:</span>
                    <span>{formatCurrency(feePreview.spreadCost)}</span>
                  </div>
                  <div className="flex justify-between font-medium border-t border-slate-700 pt-1 mt-1">
                    <span>Gesamtgebühren:</span>
                    <span className="text-yellow-400">{formatCurrency(feePreview.totalFees)}</span>
                  </div>
                  {productType !== 'stock' && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Margin:</span>
                      <span>{formatCurrency(feePreview.marginRequired)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs text-gray-500 pt-1">
                    <span>Break-Even:</span>
                    <span>{formatPercent(feePreview.breakEvenMove)} Bewegung</span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Submit Button */}
            <button
              onClick={handleSubmitOrder}
              disabled={orderLoading || !feePreview || currentPrice <= 0 || (orderType !== 'market' && !limitPrice && !stopOrderPrice)}
              className={`w-full py-3 rounded-lg font-semibold text-white transition-colors ${
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
                  Wird ausgeführt...
                </span>
              ) : orderType !== 'market' ? (
                `📋 ${getOrderTypeName(orderType)}-Order erstellen`
              ) : (
                `${side === 'buy' ? '📈 KAUFEN' : '📉 SHORT'} - ${formatCurrency(feePreview?.marginRequired || 0)}`
              )}
            </button>
          </div>
          
          {/* Metrics Card */}
          {metrics && (
            <div className="bg-slate-800/50 rounded-xl p-4">
              <h2 className="text-lg font-semibold mb-3">📊 Performance</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Trades gesamt:</span>
                  <span>{metrics.totalTrades}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Gewinner:</span>
                  <span className="text-green-400">{metrics.winningTrades}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Verlierer:</span>
                  <span className="text-red-400">{metrics.losingTrades}</span>
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
        
        {/* Positions Panel */}
        <div className="lg:col-span-2">
          <div className="bg-slate-800/50 rounded-xl p-4">
            <h2 className="text-lg font-semibold mb-4">📋 Offene Positionen ({positions.length})</h2>
            
            {positions.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <div className="text-4xl mb-2">📭</div>
                <p>Keine offenen Positionen</p>
                <p className="text-sm mt-1">Eröffne eine Position um zu beginnen</p>
              </div>
            ) : (
              <div className="space-y-3">
                {positions.map((position) => (
                  <div 
                    key={position.id}
                    className="bg-slate-900/50 rounded-lg p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-lg">{position.symbol}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            position.side === 'long' 
                              ? 'bg-green-500/20 text-green-400' 
                              : 'bg-red-500/20 text-red-400'
                          }`}>
                            {position.side.toUpperCase()}
                          </span>
                          <span className="px-2 py-0.5 rounded text-xs bg-slate-700 text-gray-300">
                            {getProductTypeName(position.productType)}
                          </span>
                          {position.leverage > 1 && (
                            <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">
                              1:{position.leverage}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-400 mt-1">
                          {position.quantity}x @ {formatCurrency(position.entryPrice)}
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <div className={`text-lg font-semibold ${
                          position.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {formatCurrency(position.unrealizedPnl)}
                        </div>
                        <div className={`text-sm ${
                          position.leveragedPnlPercent >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {formatPercent(position.leveragedPnlPercent)}
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-4 gap-4 mt-3 text-sm">
                      <div>
                        <div className="text-gray-500">Aktuell</div>
                        <div>{formatCurrency(position.currentPrice || position.entryPrice)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Margin</div>
                        <div>{formatCurrency(position.marginUsed || 0)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Gebühren</div>
                        <div className="text-yellow-400">{formatCurrency(position.totalFeesPaid)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Tage</div>
                        <div>{position.daysHeld}</div>
                      </div>
                    </div>
                    
                    {/* Risk indicators for leveraged positions */}
                    {position.leverage > 1 && position.liquidationPrice && (
                      <div className="mt-3 pt-3 border-t border-slate-700">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-500">Liquidation bei:</span>
                          <span className="text-red-400">{formatCurrency(position.liquidationPrice)}</span>
                        </div>
                        {position.distanceToLiquidation !== null && (
                          <div className="mt-1">
                            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                              <span>Abstand zur Liquidation</span>
                              <span>{position.distanceToLiquidation.toFixed(1)}%</span>
                            </div>
                            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
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
                    
                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={() => handleClosePosition(position)}
                        disabled={orderLoading}
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        Position schließen
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Margin Warning */}
          {metrics?.isMarginWarning && (
            <div className="mt-4 bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-4">
              <div className="flex items-center gap-2 text-yellow-300">
                <span>⚠️</span>
                <span className="font-medium">Margin-Warnung</span>
              </div>
              <p className="text-sm text-yellow-200 mt-1">
                Ihr Margin-Level beträgt {metrics.marginLevel?.toFixed(1)}%. 
                Bitte reduzieren Sie Ihre Positionen oder fügen Sie mehr Kapital hinzu.
              </p>
            </div>
          )}
          
          {metrics?.isLiquidationRisk && (
            <div className="mt-4 bg-red-500/20 border border-red-500/50 rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-300">
                <span>🚨</span>
                <span className="font-medium">Liquidations-Risiko!</span>
              </div>
              <p className="text-sm text-red-200 mt-1">
                Kritisches Margin-Level: {metrics.marginLevel?.toFixed(1)}%. 
                Positionen können automatisch geschlossen werden!
              </p>
            </div>
          )}
          
          {/* Pending Orders */}
          {portfolio && (
            <div className="mt-4">
              <PendingOrders 
                portfolioId={portfolio.id}
                onOrderCancelled={loadPortfolioData}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TradingPage;
