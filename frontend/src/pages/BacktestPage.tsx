/**
 * Backtesting Page
 * 
 * Allows users to trade with historical data, simulating what would have happened
 * if they had traded at a specific time in the past.
 * 
 * Now includes Dashboard-style analysis:
 * - Trading Signal Panel (combined signals)
 * - AI Forecast Panel  
 * - Stock Chart with technical indicators
 * - Indicator Controls
 * 
 * Redesigned to match the consistent dark slate theme of the application.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getAuthState, subscribeToAuth, type AuthState } from '../services/authService';
import { getCustomSymbols } from '../services/userSettingsService';
import { POPULAR_STOCKS } from '../utils/defaultStocks';
import {
  createBacktestSession,
  getBacktestSessions,
  getBacktestSession,
  executeBacktestOrder,
  closeBacktestPosition,
  advanceBacktestTime,
  getBacktestResults,
  deleteBacktestSession,
  formatCurrency,
  formatPercent,
  getHistoricalPrices,
  type BacktestSession,
  type BacktestPosition,
  type BacktestResults,
} from '../services/tradingService';
import { StockChart, ForecastPanel, TradingSignalPanel, IndicatorControls, MLForecastPanel } from '../components';
import { generateForecast } from '../utils/forecast';
import type { OHLCV, ForecastResult } from '../types/stock';

// ML Prediction type for trading signals
interface MLPrediction {
  date: string;
  day: number;
  predicted_price: number;
  confidence: number;
  change_pct: number;
}

export default function BacktestPage() {
  const [authState, setAuthState] = useState<AuthState>(getAuthState());

  // Sessions list
  const [sessions, setSessions] = useState<BacktestSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [activeSession, setActiveSession] = useState<BacktestSession | null>(null);
  const [results, setResults] = useState<BacktestResults | null>(null);

  // Create session form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [newStartDate, setNewStartDate] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [newCapital, setNewCapital] = useState(100000);

  // Trading form
  const [selectedSymbol, setSelectedSymbol] = useState('AAPL');
  const [customSymbol, setCustomSymbol] = useState('');
  const [userSymbols, setUserSymbols] = useState<string[]>([]);
  const [tradeSide, setTradeSide] = useState<'buy' | 'sell'>('buy');
  const [tradeQuantity, setTradeQuantity] = useState(10);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [historicalData, setHistoricalData] = useState<any[]>([]);

  // Combined symbol list (user symbols + popular stocks, deduplicated)
  const allSymbols = useMemo(() => {
    const popularSymbols = POPULAR_STOCKS.map(s => s.symbol);
    const combined = [...new Set([...userSymbols, ...popularSymbols])];
    return combined.sort();
  }, [userSymbols]);

  // Time controls
  const [advanceDays] = useState(1);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Dashboard-style analysis state
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(true);
  const [showIndicators, setShowIndicators] = useState(false);
  const [showChart, setShowChart] = useState(false);
  
  // Chart indicator toggles
  const [showSMA20, setShowSMA20] = useState(true);
  const [showSMA50, setShowSMA50] = useState(true);
  const [showEMA12, setShowEMA12] = useState(false);
  const [showEMA26, setShowEMA26] = useState(false);
  const [showBollingerBands, setShowBollingerBands] = useState(false);
  const [showMACD, setShowMACD] = useState(true);
  const [showRSI, setShowRSI] = useState(true);
  const [showVolume, setShowVolume] = useState(true);

  // ML Predictions state
  const [mlPredictions, setMlPredictions] = useState<MLPrediction[] | null>(null);

  // Callback to receive ML predictions from MLForecastPanel
  const handleMLPredictionsChange = useCallback((predictions: MLPrediction[] | null) => {
    setMlPredictions(predictions);
  }, []);

  // Subscribe to auth changes
  useEffect(() => {
    return subscribeToAuth(setAuthState);
  }, []);

  // Load user's custom symbols
  useEffect(() => {
    async function loadUserSymbols() {
      if (authState.isAuthenticated && authState.user) {
        try {
          const symbols = await getCustomSymbols();
          setUserSymbols(symbols.map(s => s.symbol));
        } catch (err) {
          console.warn('Failed to load user symbols:', err);
        }
      }
    }
    loadUserSymbols();
  }, [authState.isAuthenticated, authState.user]);

  // Load sessions on mount
  useEffect(() => {
    if (authState.user) {
      loadSessions();
    }
  }, [authState.user]);

  // Load session details when selected
  useEffect(() => {
    if (selectedSessionId) {
      loadSessionDetails(selectedSessionId);
    }
  }, [selectedSessionId]);

  // Load historical data when session or symbol changes
  useEffect(() => {
    if (activeSession && selectedSymbol) {
      loadHistoricalData();
    }
  }, [activeSession?.id, selectedSymbol, activeSession?.currentDate]);

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
    } catch (e) {
      setError('Fehler beim Laden der Backtests');
    }
  };

  const loadSessionDetails = async (sessionId: number) => {
    try {
      setLoading(true);
      const session = await getBacktestSession(sessionId);
      setActiveSession(session);

      if (session.status === 'completed') {
        const resultsData = await getBacktestResults(sessionId);
        setResults(resultsData);
      } else {
        setResults(null);
      }
    } catch (e) {
      setError('Fehler beim Laden der Session');
    } finally {
      setLoading(false);
    }
  };

  const loadHistoricalData = async () => {
    if (!activeSession) return;

    try {
      setLoading(true);
      
      // Use backend API for historical data (supports long-term data from DB)
      // Add 60 days buffer before start date for indicator calculations
      const bufferStart = new Date(activeSession.startDate);
      bufferStart.setDate(bufferStart.getDate() - 60); // 60 days buffer for SMA50, etc.
      const startDateStr = bufferStart.toISOString().split('T')[0];
      
      // Ensure endDate is in YYYY-MM-DD format (strip time component if present)
      const endDateStr = activeSession.endDate.split('T')[0];
      
      console.log(`[Backtest] Loading historical data for ${selectedSymbol} from ${startDateStr} to ${endDateStr}`);
      
      const response = await getHistoricalPrices(selectedSymbol, startDateStr, endDateStr);
      
      if (response?.prices && response.prices.length > 0) {
        setHistoricalData(response.prices);

        const currentDateData = response.prices.find(
          d => d.date === activeSession.currentDate
        );
        setCurrentPrice(currentDateData?.close || null);
        
        console.log(`[Backtest] Loaded ${response.prices.length} price records for ${selectedSymbol}`);
      } else {
        console.warn(`[Backtest] No historical data found for ${selectedSymbol}`);
        setHistoricalData([]);
        setCurrentPrice(null);
      }
    } catch (e) {
      console.error('Failed to load historical data:', e);
      setError(`Fehler beim Laden historischer Daten für ${selectedSymbol}: ${e instanceof Error ? e.message : 'Unknown error'}`);
      setHistoricalData([]);
    } finally {
      setLoading(false);
    }
  };

  // Convert historical data to OHLCV format for charts (up to current simulation date)
  const chartData: OHLCV[] = useMemo(() => {
    if (!activeSession || historicalData.length === 0) return [];
    
    // Filter data up to and including current simulation date
    const dataUntilNow = historicalData.filter(d => d.date <= activeSession.currentDate);
    
    return dataUntilNow.map(d => ({
      time: Math.floor(new Date(d.date).getTime() / 1000),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));
  }, [historicalData, activeSession?.currentDate]);

  // Generate AI Forecast based on historical data up to current simulation date
  const forecast: ForecastResult | null = useMemo(() => {
    if (chartData.length < 50) return null; // Need enough data for indicators
    return generateForecast(chartData);
  }, [chartData]);

  // Indicator toggle handler
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

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      setLoading(true);
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
      setError(e.message || 'Fehler beim Erstellen der Session');
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteOrder = async () => {
    if (!activeSession || !currentPrice) return;
    setError(null);

    try {
      setLoading(true);
      const result = await executeBacktestOrder({
        sessionId: activeSession.id,
        symbol: selectedSymbol,
        side: tradeSide,
        quantity: tradeQuantity,
        price: currentPrice,
      });

      if (result.success) {
        setSuccessMessage(
          `${tradeSide === 'buy' ? 'Gekauft' : 'Verkauft'}: ${tradeQuantity}x ${selectedSymbol} @ ${formatCurrency(currentPrice)}`
        );
        loadSessionDetails(activeSession.id);
      } else {
        setError(result.error || 'Order fehlgeschlagen');
      }
    } catch (e: any) {
      setError(e.message || 'Fehler beim Ausführen der Order');
    } finally {
      setLoading(false);
    }
  };

  const handleClosePosition = async (position: BacktestPosition) => {
    if (!activeSession || !currentPrice) return;
    setError(null);

    try {
      setLoading(true);
      const result = await closeBacktestPosition(position.id, currentPrice);

      if (result.success) {
        const pnlText = (result.realizedPnl || 0) >= 0 ? 'Gewinn' : 'Verlust';
        setSuccessMessage(
          `Position geschlossen: ${pnlText} ${formatCurrency(Math.abs(result.realizedPnl || 0))}`
        );
        loadSessionDetails(activeSession.id);
      } else {
        setError(result.error || 'Fehler beim Schließen');
      }
    } catch (e: any) {
      setError(e.message || 'Fehler beim Schließen der Position');
    } finally {
      setLoading(false);
    }
  };

  const handleAdvanceTime = useCallback(async (days: number = advanceDays) => {
    if (!activeSession || activeSession.status !== 'active') {
      setIsAutoPlaying(false);
      return;
    }
    setError(null);

    try {
      const currentDate = new Date(activeSession.currentDate);
      currentDate.setDate(currentDate.getDate() + days);
      const newDate = currentDate.toISOString().split('T')[0];

      const priceUpdates: Record<string, number> = {};
      const openPositions = activeSession.positions?.filter(p => p.isOpen) || [];

      for (const pos of openPositions) {
        const posData = historicalData.find(d => d.date === newDate);
        if (posData) {
          priceUpdates[pos.symbol] = posData.close;
        }
      }

      const newDateData = historicalData.find(d => d.date === newDate);
      if (newDateData) {
        priceUpdates[selectedSymbol] = newDateData.close;
        setCurrentPrice(newDateData.close);
      }

      const result = await advanceBacktestTime(activeSession.id, {
        newDate,
        priceUpdates,
      });

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
            const triggers = result.triggeredPositions.map(t => 
              `${t.symbol}: ${t.reason === 'stop_loss' ? 'Stop-Loss' : 'Take-Profit'} @ ${formatCurrency(t.triggerPrice)}`
            ).join(', ');
            setSuccessMessage(`Ausgelöst: ${triggers}`);
          }

          if (Math.random() < 0.2) {
            loadSessionDetails(activeSession.id);
          }
        }
      } else {
        setError(result.error || 'Fehler beim Zeitfortschritt');
        setIsAutoPlaying(false);
      }
    } catch (e: any) {
      setError(e.message || 'Fehler beim Zeitfortschritt');
      setIsAutoPlaying(false);
    }
  }, [activeSession, advanceDays, historicalData, selectedSymbol]);

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
      setError(e.message || 'Fehler beim Löschen');
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

  // Not authenticated view
  if (!authState.user) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-slate-800/50 rounded-xl p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">📈 Backtesting</h2>
          <p className="text-gray-400 mb-6">
            Melde dich an, um historische Trading-Simulationen durchzuführen.
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

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">📈 Historisches Backtesting</h1>
          <p className="text-gray-400 text-sm mt-1">
            Teste deine Strategien mit echten historischen Daten
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <span className="text-lg">+</span> Neuer Backtest
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 text-red-300 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-300 hover:text-red-100 text-xl">×</button>
        </div>
      )}
      {successMessage && (
        <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-4 text-green-300">
          ✅ {successMessage}
        </div>
      )}

      {/* Create Session Modal */}
      {showCreateForm && (
        <div 
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => setShowCreateForm(false)}
        >
          <div 
            className="bg-slate-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl border border-slate-700"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold mb-4">Neuen Backtest erstellen</h2>
            <form onSubmit={handleCreateSession}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">
                    Name
                  </label>
                  <input
                    type="text"
                    value={newSessionName}
                    onChange={e => setNewSessionName(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    placeholder="z.B. Tech-Strategie 2023"
                    required
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                      Startdatum
                    </label>
                    <input
                      type="date"
                      value={newStartDate}
                      onChange={e => setNewStartDate(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                      Enddatum
                    </label>
                    <input
                      type="date"
                      value={newEndDate}
                      onChange={e => setNewEndDate(e.target.value)}
                      max={new Date().toISOString().split('T')[0]}
                      className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">
                    Startkapital (€)
                  </label>
                  <input
                    type="number"
                    value={newCapital}
                    onChange={e => setNewCapital(Number(e.target.value))}
                    min={1000}
                    max={10000000}
                    className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2.5 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Wird erstellt...' : 'Erstellen'}
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
              <p className="text-gray-500 text-sm py-4 text-center">
                Noch keine Backtests vorhanden.
              </p>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {sessions.map(session => (
                  <div
                    key={session.id}
                    onClick={() => setSelectedSessionId(session.id)}
                    className={`p-3 rounded-lg cursor-pointer transition-all ${
                      selectedSessionId === session.id
                        ? 'bg-blue-600/20 border border-blue-500/50'
                        : 'bg-slate-900/50 hover:bg-slate-700/50 border border-transparent'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white truncate">
                          {session.name}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {session.startDate} → {session.endDate}
                        </p>
                        <span
                          className={`inline-block mt-2 px-2 py-0.5 text-xs rounded font-medium ${
                            session.status === 'active'
                              ? 'bg-green-500/20 text-green-400'
                              : session.status === 'completed'
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-gray-500/20 text-gray-400'
                          }`}
                        >
                          {session.status === 'active' ? '● Aktiv' : session.status === 'completed' ? '✓ Fertig' : '○ Abgebrochen'}
                        </span>
                      </div>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleDeleteSession(session.id);
                        }}
                        className="text-gray-500 hover:text-red-400 transition-colors p-1"
                        title="Löschen"
                      >
                        🗑️
                      </button>
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
              <p className="text-gray-400 text-lg">
                Wähle einen Backtest aus oder erstelle einen neuen.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Session Header */}
              <div className="bg-slate-800/50 rounded-xl p-5">
                <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                  <div>
                    <h2 className="text-xl font-bold">{activeSession.name}</h2>
                    <p className="text-gray-400 text-sm mt-1">
                      Zeitraum: {activeSession.startDate} → {activeSession.endDate}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-blue-400">
                      {formatCurrency(activeSession.currentCapital)}
                    </div>
                    <div className="text-sm text-gray-400">Aktuelles Kapital</div>
                  </div>
                </div>

                {/* Time Simulation Bar */}
                {activeSession.status === 'active' && (
                  <div className="mt-5 pt-5 border-t border-slate-700">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                      <span className="text-gray-400">Simulationsdatum:</span>
                      <span className="font-bold text-xl text-blue-400">
                        📅 {activeSession.currentDate}
                      </span>
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="mb-4">
                      <div className="w-full bg-slate-700 rounded-full h-2.5">
                        <div
                          className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                          style={{
                            width: `${
                              ((new Date(activeSession.currentDate).getTime() -
                                new Date(activeSession.startDate).getTime()) /
                                (new Date(activeSession.endDate).getTime() -
                                  new Date(activeSession.startDate).getTime())) *
                              100
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                    
                    {/* Time Controls */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => handleAdvanceTime(1)}
                        disabled={loading}
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        +1 Tag
                      </button>
                      <button
                        onClick={() => handleAdvanceTime(7)}
                        disabled={loading}
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        +1 Woche
                      </button>
                      <button
                        onClick={() => handleAdvanceTime(30)}
                        disabled={loading}
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        +1 Monat
                      </button>
                      <button
                        onClick={() => setIsAutoPlaying(!isAutoPlaying)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isAutoPlaying
                            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                            : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                        }`}
                      >
                        {isAutoPlaying ? '⏸️ Stopp' : '▶️ Auto-Play'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Analysis Panel - Dashboard-style analysis for historical data */}
              {activeSession.status === 'active' && chartData.length > 0 && (
                <div className="bg-slate-800/50 rounded-xl border border-slate-700">
                  <button
                    onClick={() => setShowAnalysisPanel(!showAnalysisPanel)}
                    className="w-full flex items-center justify-between p-5 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xl">📊</span>
                      <h3 className="font-semibold text-lg">Marktanalyse zum {activeSession.currentDate}</h3>
                    </div>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform ${showAnalysisPanel ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {showAnalysisPanel && (
                    <div className="px-5 pb-5 space-y-4">
                      {/* Trading Signals Panel */}
                      {forecast && currentPrice && (
                        <TradingSignalPanel
                          newsItems={[]}
                          symbol={selectedSymbol}
                          className=""
                          forecast={forecast}
                          stockData={chartData}
                          mlPredictions={mlPredictions ?? undefined}
                          currentPrice={currentPrice}
                        />
                      )}

                      {/* AI Forecast (Technical Analysis) */}
                      {forecast && currentPrice && (
                        <ForecastPanel
                          forecast={forecast}
                          currentPrice={currentPrice}
                        />
                      )}

                      {/* ML Forecast Panel (LSTM Neural Network) */}
                      {chartData.length >= 60 && currentPrice && (
                        <MLForecastPanel
                          symbol={selectedSymbol}
                          stockData={chartData}
                          onPredictionsChange={handleMLPredictionsChange}
                        />
                      )}

                      {/* Indicator Controls - Collapsible */}
                      <div className="bg-slate-900/50 rounded-xl border border-slate-700">
                        <button
                          onClick={() => setShowIndicators(!showIndicators)}
                          className="w-full flex items-center justify-between p-4 text-left"
                        >
                          <h4 className="text-white font-semibold">Chart-Indikatoren</h4>
                          <svg
                            className={`w-5 h-5 text-gray-400 transition-transform ${showIndicators ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {showIndicators && (
                          <div className="px-4 pb-4">
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
                        )}
                      </div>

                      {/* Stock Chart - Collapsible */}
                      <div className="bg-slate-900/50 rounded-xl border border-slate-700">
                        <button
                          onClick={() => setShowChart(!showChart)}
                          className="w-full flex items-center justify-between p-4 text-left"
                        >
                          <h4 className="text-white font-semibold">📈 Chart bis {activeSession.currentDate}</h4>
                          <svg
                            className={`w-5 h-5 text-gray-400 transition-transform ${showChart ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {showChart && chartData.length > 0 && (
                          <div className="px-4 pb-4">
                            <StockChart
                              data={chartData}
                              symbol={selectedSymbol}
                              showSMA20={showSMA20}
                              showSMA50={showSMA50}
                              showEMA12={showEMA12}
                              showEMA26={showEMA26}
                              showBollingerBands={showBollingerBands}
                              showMACD={showMACD}
                              showRSI={showRSI}
                              showVolume={showVolume}
                              supportLevel={forecast?.supportLevel}
                              resistanceLevel={forecast?.resistanceLevel}
                            />
                          </div>
                        )}
                      </div>

                      {/* Analysis Info */}
                      <div className="text-xs text-gray-500 text-center">
                        ⏱️ Analyse basiert auf historischen Daten bis zum Simulationsdatum.
                        Nutze diese Informationen, um deine Trading-Entscheidungen zu treffen.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Trading Panel (only for active sessions) */}
              {activeSession.status === 'active' && (
                <div className="bg-slate-800/50 rounded-xl p-5">
                  <h3 className="font-semibold text-lg mb-4">🛒 Handeln</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Symbol Selection */}
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">Symbol ({allSymbols.length} verfügbar)</label>
                      <select
                        value={selectedSymbol}
                        onChange={e => setSelectedSymbol(e.target.value)}
                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      >
                        {allSymbols.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={customSymbol}
                        onChange={e => setCustomSymbol(e.target.value.toUpperCase())}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && customSymbol) {
                            setSelectedSymbol(customSymbol);
                            setCustomSymbol('');
                          }
                        }}
                        placeholder="Anderes Symbol..."
                        className="w-full mt-2 px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-gray-500 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      />
                    </div>

                    {/* Side */}
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">Seite</label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setTradeSide('buy')}
                          className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${
                            tradeSide === 'buy'
                              ? 'bg-green-500 text-white'
                              : 'bg-slate-700 text-gray-400 hover:bg-slate-600'
                          }`}
                        >
                          📈 Kaufen
                        </button>
                        <button
                          onClick={() => setTradeSide('sell')}
                          className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${
                            tradeSide === 'sell'
                              ? 'bg-red-500 text-white'
                              : 'bg-slate-700 text-gray-400 hover:bg-slate-600'
                          }`}
                        >
                          📉 Verkaufen
                        </button>
                      </div>
                    </div>

                    {/* Quantity */}
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">Menge</label>
                      <input
                        type="number"
                        value={tradeQuantity}
                        onChange={e => setTradeQuantity(Number(e.target.value))}
                        min={1}
                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      />
                    </div>

                    {/* Execute */}
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">Aktueller Preis</label>
                      <div className="text-xl font-bold text-white mb-2">
                        {currentPrice ? formatCurrency(currentPrice) : (
                          <span className="text-gray-500">Laden...</span>
                        )}
                      </div>
                      <button
                        onClick={handleExecuteOrder}
                        disabled={loading || !currentPrice}
                        className={`w-full py-2.5 rounded-lg font-medium text-white transition-colors disabled:opacity-50 ${
                          tradeSide === 'buy'
                            ? 'bg-green-600 hover:bg-green-700'
                            : 'bg-red-600 hover:bg-red-700'
                        }`}
                      >
                        {loading ? '...' : tradeSide === 'buy' ? '📈 Kaufen' : '📉 Verkaufen'}
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
                        {activeSession.positions.map(pos => {
                          const pnl = getUnrealizedPnl(pos);
                          return (
                            <tr key={pos.id} className="hover:bg-slate-700/30 transition-colors">
                              <td className="px-4 py-3 font-semibold text-white">{pos.symbol}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-1 rounded text-xs font-medium ${
                                  pos.side === 'long' 
                                    ? 'bg-green-500/20 text-green-400' 
                                    : 'bg-red-500/20 text-red-400'
                                }`}>
                                  {pos.side === 'long' ? '📈 Long' : '📉 Short'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right text-white">{pos.quantity}</td>
                              <td className="px-4 py-3 text-right text-gray-300">
                                {formatCurrency(pos.entryPrice)}
                              </td>
                              <td className="px-4 py-3 text-right text-white">
                                {formatCurrency(pos.currentPrice)}
                              </td>
                              <td className={`px-4 py-3 text-right font-semibold ${
                                pnl >= 0 ? 'text-green-400' : 'text-red-400'
                              }`}>
                                {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`px-2 py-1 rounded text-xs font-medium ${
                                  pos.isOpen
                                    ? 'bg-blue-500/20 text-blue-400'
                                    : 'bg-gray-500/20 text-gray-400'
                                }`}>
                                  {pos.isOpen ? '● Offen' : '○ Geschlossen'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {pos.isOpen && activeSession.status === 'active' && (
                                  <button
                                    onClick={() => handleClosePosition(pos)}
                                    disabled={loading}
                                    className="text-red-400 hover:text-red-300 text-sm font-medium transition-colors disabled:opacity-50"
                                  >
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

              {/* Results (for completed sessions) */}
              {results && activeSession.status === 'completed' && (
                <div className="bg-slate-800/50 rounded-xl p-5">
                  <h3 className="font-semibold text-lg mb-4">📊 Backtest-Ergebnisse</h3>
                  
                  {/* Key Metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-slate-900/50 rounded-lg p-4">
                      <div className="text-sm text-gray-400">Gesamtrendite</div>
                      <div className={`text-2xl font-bold mt-1 ${
                        results.metrics.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {formatPercent(results.metrics.totalReturn)}
                      </div>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-4">
                      <div className="text-sm text-gray-400">Netto P&L</div>
                      <div className={`text-2xl font-bold mt-1 ${
                        results.metrics.netPnl >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {formatCurrency(results.metrics.netPnl)}
                      </div>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-4">
                      <div className="text-sm text-gray-400">Gewinnrate</div>
                      <div className="text-2xl font-bold mt-1 text-white">
                        {formatPercent(results.metrics.winRate)}
                      </div>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-4">
                      <div className="text-sm text-gray-400">Max. Drawdown</div>
                      <div className="text-2xl font-bold mt-1 text-red-400">
                        {formatPercent(results.metrics.maxDrawdown)}
                      </div>
                    </div>
                  </div>

                  {/* Detailed Stats */}
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
                      <span className="font-semibold text-green-400">{formatCurrency(results.metrics.avgWin)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-slate-700">
                      <span className="text-gray-400">Ø Verlust</span>
                      <span className="font-semibold text-red-400">{formatCurrency(results.metrics.avgLoss)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-slate-700">
                      <span className="text-gray-400">Gebühren gesamt</span>
                      <span className="font-semibold text-orange-400">{formatCurrency(results.metrics.totalFees)}</span>
                    </div>
                  </div>

                  {/* Equity Curve */}
                  {results.equityCurve.length > 1 && (
                    <div>
                      <h4 className="font-medium text-white mb-3">📈 Equity-Kurve</h4>
                      <div className="h-48 bg-slate-900/50 rounded-lg p-4">
                        <svg viewBox="0 0 100 50" className="w-full h-full" preserveAspectRatio="none">
                          {(() => {
                            const values = results.equityCurve.map(p => p.totalValue);
                            const min = Math.min(...values);
                            const max = Math.max(...values);
                            const range = max - min || 1;

                            const points = values
                              .map((v, i) => {
                                const x = (i / (values.length - 1)) * 100;
                                const y = 50 - ((v - min) / range) * 45;
                                return `${x},${y}`;
                              })
                              .join(' ');

                            const isPositive = values[values.length - 1] >= values[0];
                            const strokeColor = isPositive ? '#4ade80' : '#f87171';
                            const fillColor = isPositive ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)';

                            return (
                              <>
                                <polyline
                                  fill="none"
                                  stroke={strokeColor}
                                  strokeWidth="0.8"
                                  points={points}
                                />
                                <polyline
                                  fill={fillColor}
                                  stroke="none"
                                  points={`0,50 ${points} 100,50`}
                                />
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
    </div>
  );
}
