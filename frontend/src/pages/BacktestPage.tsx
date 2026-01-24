/**
 * Backtesting Page
 * 
 * Allows users to trade with historical data, simulating what would have happened
 * if they had traded at a specific time in the past.
 */

import { useState, useEffect, useCallback } from 'react';
import { getAuthState, subscribeToAuth, type AuthState } from '../services/authService';
import { useDataService } from '../hooks/useDataService';
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
  type BacktestSession,
  type BacktestPosition,
  type BacktestResults,
} from '../services/tradingService';

// Popular symbols for backtesting
const POPULAR_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'JPM', 'V', 'WMT'];

export default function BacktestPage() {
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const dataService = useDataService();

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
  const [tradeSide, setTradeSide] = useState<'buy' | 'sell'>('buy');
  const [tradeQuantity, setTradeQuantity] = useState(10);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [historicalData, setHistoricalData] = useState<any[]>([]);

  // Time controls
  const [advanceDays] = useState(1);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Subscribe to auth changes
  useEffect(() => {
    return subscribeToAuth(setAuthState);
  }, []);

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
      }, 2000); // Advance every 2 seconds
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
      // Fetch historical data using dataService
      // Calculate days from start to end
      const startDate = new Date(activeSession.startDate);
      const endDate = new Date(activeSession.endDate);
      const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 30;

      const stockData = await dataService.dataService.fetchStockData(selectedSymbol, days);

      if (stockData?.data && stockData.data.length > 0) {
        // Convert OHLCV data to simple format with date strings
        const converted = stockData.data.map(d => ({
          date: new Date(d.time * 1000).toISOString().split('T')[0],
          close: d.close,
          open: d.open,
          high: d.high,
          low: d.low,
          volume: d.volume,
        }));
        
        // Filter to session date range
        const filtered = converted.filter(d => {
          return d.date >= activeSession.startDate && d.date <= activeSession.endDate;
        });
        setHistoricalData(filtered);

        // Find current price at simulation date
        const currentDateData = filtered.find(
          d => d.date === activeSession.currentDate
        );
        setCurrentPrice(currentDateData?.close || null);
      } else {
        setHistoricalData([]);
      }
    } catch (e) {
      console.error('Failed to load historical data:', e);
      setHistoricalData([]);
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
      // Calculate new date
      const currentDate = new Date(activeSession.currentDate);
      currentDate.setDate(currentDate.getDate() + days);
      const newDate = currentDate.toISOString().split('T')[0];

      // Get price updates for open positions
      const priceUpdates: Record<string, number> = {};
      const openPositions = activeSession.positions?.filter(p => p.isOpen) || [];

      for (const pos of openPositions) {
        const posData = historicalData.find(
          d => d.date === newDate
        );
        if (posData) {
          priceUpdates[pos.symbol] = posData.close;
        }
      }

      // Also add current symbol price
      const newDateData = historicalData.find(
        d => d.date === newDate
      );
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
          // Update local state
          setActiveSession(prev => prev ? { ...prev, currentDate: newDate } : null);

          // Show triggered positions
          if (result.triggeredPositions && result.triggeredPositions.length > 0) {
            const triggers = result.triggeredPositions.map(t => 
              `${t.symbol}: ${t.reason === 'stop_loss' ? 'Stop-Loss' : 'Take-Profit'} @ ${formatCurrency(t.triggerPrice)}`
            ).join(', ');
            setSuccessMessage(`Ausgelöst: ${triggers}`);
          }

          // Reload full session periodically
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

  // Calculate unrealized PnL for position
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

  if (!authState.user) {
    return (
      <div className="p-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800">Bitte einloggen, um Backtesting zu nutzen.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            📈 Historisches Backtesting
          </h1>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            + Neuer Backtest
          </button>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-300">
            {successMessage}
          </div>
        )}

        {/* Create Session Modal */}
        {showCreateForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
              <h2 className="text-xl font-bold mb-4 dark:text-white">Neuen Backtest erstellen</h2>
              <form onSubmit={handleCreateSession}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Name
                    </label>
                    <input
                      type="text"
                      value={newSessionName}
                      onChange={e => setNewSessionName(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      placeholder="z.B. Tech-Strategie 2023"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Startdatum
                      </label>
                      <input
                        type="date"
                        value={newStartDate}
                        onChange={e => setNewStartDate(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Enddatum
                      </label>
                      <input
                        type="date"
                        value={newEndDate}
                        onChange={e => setNewEndDate(e.target.value)}
                        max={new Date().toISOString().split('T')[0]}
                        className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Startkapital (€)
                    </label>
                    <input
                      type="number"
                      value={newCapital}
                      onChange={e => setNewCapital(Number(e.target.value))}
                      min={1000}
                      max={10000000}
                      className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
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
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <h2 className="font-semibold text-gray-900 dark:text-white mb-3">
                Meine Backtests
              </h2>
              {sessions.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  Noch keine Backtests vorhanden.
                </p>
              ) : (
                <div className="space-y-2">
                  {sessions.map(session => (
                    <div
                      key={session.id}
                      onClick={() => setSelectedSessionId(session.id)}
                      className={`p-3 rounded-lg cursor-pointer transition ${
                        selectedSessionId === session.id
                          ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-500'
                          : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                      } border`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 dark:text-white text-sm">
                            {session.name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {session.startDate} → {session.endDate}
                          </p>
                          <span
                            className={`inline-block mt-1 px-2 py-0.5 text-xs rounded ${
                              session.status === 'active'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                                : session.status === 'completed'
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
                                : 'bg-gray-100 text-gray-800 dark:bg-gray-600 dark:text-gray-300'
                            }`}
                          >
                            {session.status === 'active' ? 'Aktiv' : session.status === 'completed' ? 'Abgeschlossen' : 'Abgebrochen'}
                          </span>
                        </div>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleDeleteSession(session.id);
                          }}
                          className="text-red-500 hover:text-red-700 text-sm"
                        >
                          ✕
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
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
                <p className="text-gray-500 dark:text-gray-400">
                  Wähle einen Backtest aus oder erstelle einen neuen.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Session Header */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        {activeSession.name}
                      </h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Zeitraum: {activeSession.startDate} → {activeSession.endDate}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {formatCurrency(activeSession.currentCapital)}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Kapital
                      </p>
                    </div>
                  </div>

                  {/* Time Simulation Bar */}
                  {activeSession.status === 'active' && (
                    <div className="mt-4 pt-4 border-t dark:border-gray-700">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          Simulationsdatum:
                        </span>
                        <span className="font-bold text-blue-600 dark:text-blue-400">
                          📅 {activeSession.currentDate}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleAdvanceTime(1)}
                          disabled={loading}
                          className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm"
                        >
                          +1 Tag
                        </button>
                        <button
                          onClick={() => handleAdvanceTime(7)}
                          disabled={loading}
                          className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm"
                        >
                          +1 Woche
                        </button>
                        <button
                          onClick={() => handleAdvanceTime(30)}
                          disabled={loading}
                          className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm"
                        >
                          +1 Monat
                        </button>
                        <button
                          onClick={() => setIsAutoPlaying(!isAutoPlaying)}
                          className={`px-3 py-1.5 rounded text-sm ${
                            isAutoPlaying
                              ? 'bg-red-500 text-white hover:bg-red-600'
                              : 'bg-green-500 text-white hover:bg-green-600'
                          }`}
                        >
                          {isAutoPlaying ? '⏸ Stopp' : '▶ Auto-Play'}
                        </button>
                      </div>
                      <div className="mt-2">
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all"
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
                    </div>
                  )}
                </div>

                {/* Trading Panel (only for active sessions) */}
                {activeSession.status === 'active' && (
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
                      Handeln
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      {/* Symbol Selection */}
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                          Symbol
                        </label>
                        <select
                          value={selectedSymbol}
                          onChange={e => setSelectedSymbol(e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        >
                          {POPULAR_SYMBOLS.map(s => (
                            <option key={s} value={s}>
                              {s}
                            </option>
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
                          className="w-full mt-2 px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm"
                        />
                      </div>

                      {/* Side */}
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                          Seite
                        </label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setTradeSide('buy')}
                            className={`flex-1 py-2 rounded-lg font-medium ${
                              tradeSide === 'buy'
                                ? 'bg-green-500 text-white'
                                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            Kaufen
                          </button>
                          <button
                            onClick={() => setTradeSide('sell')}
                            className={`flex-1 py-2 rounded-lg font-medium ${
                              tradeSide === 'sell'
                                ? 'bg-red-500 text-white'
                                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            Verkaufen
                          </button>
                        </div>
                      </div>

                      {/* Quantity */}
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                          Menge
                        </label>
                        <input
                          type="number"
                          value={tradeQuantity}
                          onChange={e => setTradeQuantity(Number(e.target.value))}
                          min={1}
                          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        />
                      </div>

                      {/* Execute */}
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                          Aktueller Preis
                        </label>
                        <div className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                          {currentPrice ? formatCurrency(currentPrice) : 'Laden...'}
                        </div>
                        <button
                          onClick={handleExecuteOrder}
                          disabled={loading || !currentPrice}
                          className={`w-full py-2 rounded-lg font-medium text-white ${
                            tradeSide === 'buy'
                              ? 'bg-green-600 hover:bg-green-700'
                              : 'bg-red-600 hover:bg-red-700'
                          } disabled:opacity-50`}
                        >
                          {tradeSide === 'buy' ? 'Kaufen' : 'Verkaufen'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Positions */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
                    Positionen
                  </h3>
                  {!activeSession.positions || activeSession.positions.length === 0 ? (
                    <p className="text-gray-500 dark:text-gray-400 text-sm">
                      Keine Positionen vorhanden.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                          <tr>
                            <th className="px-3 py-2 text-left">Symbol</th>
                            <th className="px-3 py-2 text-left">Seite</th>
                            <th className="px-3 py-2 text-right">Menge</th>
                            <th className="px-3 py-2 text-right">Einstieg</th>
                            <th className="px-3 py-2 text-right">Aktuell</th>
                            <th className="px-3 py-2 text-right">P&L</th>
                            <th className="px-3 py-2 text-center">Status</th>
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y dark:divide-gray-700">
                          {activeSession.positions.map(pos => {
                            const pnl = getUnrealizedPnl(pos);
                            return (
                              <tr key={pos.id}>
                                <td className="px-3 py-2 font-medium">{pos.symbol}</td>
                                <td className="px-3 py-2">
                                  <span
                                    className={
                                      pos.side === 'long' ? 'text-green-600' : 'text-red-600'
                                    }
                                  >
                                    {pos.side === 'long' ? 'Long' : 'Short'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right">{pos.quantity}</td>
                                <td className="px-3 py-2 text-right">
                                  {formatCurrency(pos.entryPrice)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {formatCurrency(pos.currentPrice)}
                                </td>
                                <td
                                  className={`px-3 py-2 text-right font-medium ${
                                    pnl >= 0 ? 'text-green-600' : 'text-red-600'
                                  }`}
                                >
                                  {pnl >= 0 ? '+' : ''}
                                  {formatCurrency(pnl)}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span
                                    className={`px-2 py-0.5 text-xs rounded ${
                                      pos.isOpen
                                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                                        : 'bg-gray-100 text-gray-800 dark:bg-gray-600 dark:text-gray-300'
                                    }`}
                                  >
                                    {pos.isOpen ? 'Offen' : 'Geschlossen'}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  {pos.isOpen && activeSession.status === 'active' && (
                                    <button
                                      onClick={() => handleClosePosition(pos)}
                                      disabled={loading}
                                      className="text-red-500 hover:text-red-700 text-sm"
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
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
                      📊 Backtest-Ergebnisse
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Gesamtrendite
                        </p>
                        <p
                          className={`text-xl font-bold ${
                            results.metrics.totalReturn >= 0
                              ? 'text-green-600'
                              : 'text-red-600'
                          }`}
                        >
                          {formatPercent(results.metrics.totalReturn)}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Netto P&L
                        </p>
                        <p
                          className={`text-xl font-bold ${
                            results.metrics.netPnl >= 0
                              ? 'text-green-600'
                              : 'text-red-600'
                          }`}
                        >
                          {formatCurrency(results.metrics.netPnl)}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Gewinnrate
                        </p>
                        <p className="text-xl font-bold text-gray-900 dark:text-white">
                          {formatPercent(results.metrics.winRate)}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Max. Drawdown
                        </p>
                        <p className="text-xl font-bold text-red-600">
                          {formatPercent(results.metrics.maxDrawdown)}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Trades gesamt
                        </p>
                        <p className="font-medium dark:text-white">
                          {results.metrics.totalTrades}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Gewinner / Verlierer
                        </p>
                        <p className="font-medium dark:text-white">
                          <span className="text-green-600">{results.metrics.winningTrades}</span>
                          {' / '}
                          <span className="text-red-600">{results.metrics.losingTrades}</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Profit Factor
                        </p>
                        <p className="font-medium dark:text-white">
                          {results.metrics.profitFactor.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Ø Gewinn
                        </p>
                        <p className="font-medium text-green-600">
                          {formatCurrency(results.metrics.avgWin)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Ø Verlust
                        </p>
                        <p className="font-medium text-red-600">
                          {formatCurrency(results.metrics.avgLoss)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Gebühren gesamt
                        </p>
                        <p className="font-medium text-orange-600">
                          {formatCurrency(results.metrics.totalFees)}
                        </p>
                      </div>
                    </div>

                    {/* Equity Curve */}
                    {results.equityCurve.length > 1 && (
                      <div className="mt-6">
                        <h4 className="font-medium text-gray-900 dark:text-white mb-2">
                          Equity-Kurve
                        </h4>
                        <div className="h-64 bg-gray-50 dark:bg-gray-700 rounded-lg p-2">
                          {/* Simple SVG chart */}
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

                              return (
                                <>
                                  <polyline
                                    fill="none"
                                    stroke={values[values.length - 1] >= values[0] ? '#22c55e' : '#ef4444'}
                                    strokeWidth="0.5"
                                    points={points}
                                  />
                                  <polyline
                                    fill={values[values.length - 1] >= values[0] ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}
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
    </div>
  );
}
