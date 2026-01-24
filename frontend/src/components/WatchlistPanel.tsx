/**
 * Watchlist Panel Component
 * 
 * Displays all user's symbols with trading recommendations per holding period.
 * Allows managing the watchlist (add/remove symbols).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getAvailableStocks, addCustomStock, removeCustomStock, stockExists } from '../utils/mockData';
import { useDataService } from '../hooks';
import { 
  calculateCombinedTradingSignals, 
  getSignalDisplay,
  type TradingSignalSummary,
  type CombinedSignalInput
} from '../utils/tradingSignals';
import { generateForecast } from '../utils/forecast';

interface WatchlistStock {
  symbol: string;
  name: string;
  isCustom: boolean;
}

interface WatchlistItem extends WatchlistStock {
  currentPrice?: number;
  priceChange?: number;
  signals?: TradingSignalSummary;
  isLoading: boolean;
  error?: string;
}

interface WatchlistPanelProps {
  onSelectSymbol?: (symbol: string) => void;
  currentSymbol?: string;
}

export function WatchlistPanel({ onSelectSymbol, currentSymbol }: WatchlistPanelProps) {
  const { dataService } = useDataService();
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'score'>('name');
  const [filterPeriod, setFilterPeriod] = useState<'hourly' | 'daily' | 'weekly' | 'longTerm'>('daily');

  // Load watchlist from mockData
  const loadWatchlist = useCallback(() => {
    const stocks = getAvailableStocks();
    setWatchlistItems(stocks.map(stock => ({
      symbol: stock.symbol,
      name: stock.name,
      isCustom: stock.isCustom ?? false,
      isLoading: true,
    })));
  }, []);

  // Initial load
  useEffect(() => {
    loadWatchlist();
  }, [loadWatchlist]);

  // Fetch data for a single symbol
  const fetchSymbolData = useCallback(async (symbol: string): Promise<Partial<WatchlistItem>> => {
    try {
      const stockData = await dataService.fetchStockData(symbol);
      
      if (!stockData || stockData.data.length === 0) {
        return { error: 'Keine Daten', isLoading: false };
      }

      const currentPrice = stockData.data[stockData.data.length - 1].close;
      const previousPrice = stockData.data.length > 1 
        ? stockData.data[stockData.data.length - 2].close 
        : currentPrice;
      const priceChange = ((currentPrice - previousPrice) / previousPrice) * 100;

      // Generate forecast for technical indicators
      const forecast = generateForecast(stockData.data);
      
      // Calculate trading signals (ohne News und ML für Watchlist-Übersicht)
      const signalInput: CombinedSignalInput = {
        newsItems: [],
        forecast,
        stockData: stockData.data,
        currentPrice,
      };
      
      const signals = calculateCombinedTradingSignals(signalInput);

      return {
        currentPrice,
        priceChange,
        signals,
        isLoading: false,
        error: undefined,
      };
    } catch (err) {
      return { 
        error: err instanceof Error ? err.message : 'Fehler beim Laden', 
        isLoading: false 
      };
    }
  }, []);

  // Refresh all watchlist data
  const refreshWatchlist = useCallback(async () => {
    setIsRefreshing(true);
    const stocks = getAvailableStocks();
    
    // Process in batches to avoid overwhelming the API
    const batchSize = 3;
    const newItems: WatchlistItem[] = [];
    
    for (let i = 0; i < stocks.length; i += batchSize) {
      const batch = stocks.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (stock) => {
          const data = await fetchSymbolData(stock.symbol);
          return { ...stock, ...data } as WatchlistItem;
        })
      );
      newItems.push(...results);
      
      // Update state progressively
      setWatchlistItems(prev => {
        const updated = [...prev];
        results.forEach(result => {
          const idx = updated.findIndex(item => item.symbol === result.symbol);
          if (idx !== -1) {
            updated[idx] = result;
          }
        });
        return updated;
      });
    }
    
    setIsRefreshing(false);
  }, [fetchSymbolData]);

  // Auto-refresh on mount
  useEffect(() => {
    refreshWatchlist();
  }, []);

  // Add new symbol
  const handleAddSymbol = useCallback(() => {
    const symbol = newSymbol.trim().toUpperCase();
    
    if (!symbol) {
      setAddError('Symbol ist erforderlich');
      return;
    }
    
    if (symbol.length > 10) {
      setAddError('Symbol zu lang (max. 10 Zeichen)');
      return;
    }
    
    if (stockExists(symbol)) {
      setAddError('Symbol existiert bereits');
      return;
    }
    
    const success = addCustomStock(symbol, newName.trim() || symbol);
    if (success) {
      setNewSymbol('');
      setNewName('');
      setShowAddForm(false);
      setAddError('');
      
      // Add to watchlist and fetch data
      const newItem: WatchlistItem = {
        symbol,
        name: newName.trim() || symbol,
        isCustom: true,
        isLoading: true,
      };
      setWatchlistItems(prev => [...prev, newItem]);
      
      // Fetch data for new symbol
      fetchSymbolData(symbol).then(data => {
        setWatchlistItems(prev => 
          prev.map(item => 
            item.symbol === symbol ? { ...item, ...data } : item
          )
        );
      });
    } else {
      setAddError('Fehler beim Hinzufügen');
    }
  }, [newSymbol, newName, fetchSymbolData]);

  // Remove symbol
  const handleRemoveSymbol = useCallback((symbol: string) => {
    if (removeCustomStock(symbol)) {
      setWatchlistItems(prev => prev.filter(item => item.symbol !== symbol));
    }
  }, []);

  // Sort and filter items
  const displayItems = useMemo(() => {
    let items = [...watchlistItems];
    
    if (sortBy === 'score') {
      items.sort((a, b) => {
        const scoreA = a.signals?.[filterPeriod]?.score ?? 0;
        const scoreB = b.signals?.[filterPeriod]?.score ?? 0;
        return scoreB - scoreA; // Highest score first
      });
    } else {
      items.sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
    
    return items;
  }, [watchlistItems, sortBy, filterPeriod]);

  // Signal badge component
  const SignalBadge = ({ signal, small = false }: { signal?: TradingSignalSummary; period?: string; small?: boolean }) => {
    if (!signal) return <span className="text-gray-500 text-xs">—</span>;
    
    const periodSignal = signal[filterPeriod];
    const display = getSignalDisplay(periodSignal.signal);
    
    return (
      <span 
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${display.bgColor} ${display.color} ${small ? 'text-xs' : 'text-sm'}`}
        title={periodSignal.reasoning}
      >
        <span>{display.emoji}</span>
        {!small && <span className="font-medium">{display.labelDe}</span>}
      </span>
    );
  };

  const periodLabels: Record<string, string> = {
    hourly: '1h',
    daily: '1d',
    weekly: '1w',
    longTerm: 'Long',
  };

  return (
    <div className="space-y-4">
      {/* Header with controls */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <span>📋</span>
          Watchlist ({watchlistItems.length})
        </h3>
        <button
          onClick={refreshWatchlist}
          disabled={isRefreshing}
          className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          title="Alle aktualisieren"
        >
          <svg 
            className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Filters and Sort */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-slate-700/50 rounded-lg p-1">
          {(['hourly', 'daily', 'weekly', 'longTerm'] as const).map(period => (
            <button
              key={period}
              onClick={() => setFilterPeriod(period)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                filterPeriod === period 
                  ? 'bg-blue-600 text-white' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {periodLabels[period]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-slate-700/50 rounded-lg p-1">
          <button
            onClick={() => setSortBy('name')}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              sortBy === 'name' 
                ? 'bg-slate-600 text-white' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            A-Z
          </button>
          <button
            onClick={() => setSortBy('score')}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              sortBy === 'score' 
                ? 'bg-slate-600 text-white' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Score
          </button>
        </div>
      </div>

      {/* Watchlist Items */}
      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
        {displayItems.map(item => (
          <div 
            key={item.symbol}
            className={`bg-slate-800/50 rounded-lg p-3 border transition-colors cursor-pointer ${
              currentSymbol === item.symbol 
                ? 'border-blue-500/50 bg-blue-500/10' 
                : 'border-slate-700/50 hover:border-slate-600'
            }`}
            onClick={() => onSelectSymbol?.(item.symbol)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
                  item.isCustom 
                    ? 'bg-gradient-to-br from-green-500 to-teal-600' 
                    : 'bg-gradient-to-br from-blue-500 to-purple-600'
                }`}>
                  {item.symbol.charAt(0)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{item.symbol}</span>
                    {item.isCustom && (
                      <span className="text-xs text-green-400 bg-green-500/20 px-1 py-0.5 rounded">
                        Custom
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 truncate">{item.name}</div>
                </div>
              </div>
              
              <div className="flex items-center gap-3 flex-shrink-0">
                {/* Price Info */}
                {item.isLoading ? (
                  <div className="w-16 h-4 bg-slate-700 rounded animate-pulse" />
                ) : item.error ? (
                  <span className="text-xs text-red-400">{item.error}</span>
                ) : (
                  <div className="text-right">
                    <div className="text-sm font-medium text-white">
                      ${item.currentPrice?.toFixed(2)}
                    </div>
                    <div className={`text-xs ${(item.priceChange ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {(item.priceChange ?? 0) >= 0 ? '+' : ''}{item.priceChange?.toFixed(2)}%
                    </div>
                  </div>
                )}

                {/* Signal Badge */}
                {!item.isLoading && !item.error && (
                  <SignalBadge signal={item.signals} />
                )}

                {/* Remove Button (for custom only) */}
                {item.isCustom && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveSymbol(item.symbol);
                    }}
                    className="p-1.5 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400 transition-colors"
                    title="Entfernen"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Signal Details Row */}
            {!item.isLoading && !item.error && item.signals && (
              <div className="mt-2 pt-2 border-t border-slate-700/50 flex items-center gap-2 text-xs">
                <span className="text-gray-500">Signale:</span>
                {(['hourly', 'daily', 'weekly', 'longTerm'] as const).map(period => {
                  const periodSignal = item.signals?.[period];
                  const display = periodSignal ? getSignalDisplay(periodSignal.signal) : null;
                  return (
                    <span
                      key={period}
                      className={`px-1.5 py-0.5 rounded ${
                        period === filterPeriod ? 'ring-1 ring-blue-500' : ''
                      } ${display?.bgColor || 'bg-slate-700'}`}
                      title={`${periodLabels[period]}: ${periodSignal?.reasoning || 'N/A'}`}
                    >
                      <span className={display?.color || 'text-gray-400'}>
                        {periodLabels[period]}: {display?.emoji || '—'}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Symbol Form */}
      <div className="border-t border-slate-700 pt-4">
        {!showAddForm ? (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-slate-700/50 hover:bg-slate-700 rounded-lg text-gray-300 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Symbol zur Watchlist hinzufügen
          </button>
        ) : (
          <div className="space-y-3 bg-slate-800/50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-white">Neues Symbol hinzufügen</h4>
            <input
              type="text"
              value={newSymbol}
              onChange={(e) => {
                setNewSymbol(e.target.value.toUpperCase());
                setAddError('');
              }}
              placeholder="Symbol (z.B. TSLA, BTC)"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-sm"
              autoFocus
              maxLength={10}
            />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name (optional, z.B. Tesla Inc.)"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-sm"
            />
            {addError && (
              <p className="text-red-400 text-xs">{addError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setNewSymbol('');
                  setNewName('');
                  setAddError('');
                }}
                className="flex-1 py-2 px-3 bg-slate-700 hover:bg-slate-600 rounded-lg text-gray-300 text-sm transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleAddSymbol}
                className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition-colors"
              >
                Hinzufügen
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="text-xs text-gray-500 space-y-1 pt-2 border-t border-slate-700">
        <p className="font-medium text-gray-400">Legende:</p>
        <div className="flex flex-wrap gap-2">
          <span className="flex items-center gap-1"><span className="text-green-400">🚀</span> Starker Kauf</span>
          <span className="flex items-center gap-1"><span className="text-green-400">📈</span> Kauf</span>
          <span className="flex items-center gap-1"><span className="text-yellow-400">➡️</span> Halten</span>
          <span className="flex items-center gap-1"><span className="text-red-400">📉</span> Verkauf</span>
          <span className="flex items-center gap-1"><span className="text-red-400">⚠️</span> Starker Verkauf</span>
        </div>
        <p className="mt-2">
          <strong>Haltedauer:</strong> 1h = Scalping, 1d = Daytrading, 1w = Swing, Long = Investment
        </p>
      </div>
    </div>
  );
}
