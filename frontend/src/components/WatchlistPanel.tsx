/**
 * Watchlist Panel Component
 * 
 * Displays all user's symbols with trading recommendations per holding period.
 * Shows comprehensive company data aggregated from multiple providers.
 * Allows managing the watchlist (add/remove symbols).
 * 
 * - Non-authenticated users see default symbols only (read-only)
 * - Authenticated users manage their own symbols completely
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_STOCKS } from '../utils/mockData';
import { useDataService, useAutoRefresh, formatRefreshInterval } from '../hooks';
import type { QuoteData } from '../services/types';
import { 
  calculateCombinedTradingSignals, 
  getSignalDisplay,
  type TradingSignalSummary,
  type CombinedSignalInput
} from '../utils/tradingSignals';
import { generateForecast } from '../utils/forecast';
import { 
  getAuthState, 
  subscribeToAuth, 
  type AuthState 
} from '../services/authService';
import { 
  getCustomSymbols, 
  addCustomSymbolToServer, 
  removeCustomSymbolFromServer 
} from '../services/userSettingsService';
import { fetchCompanyInfo, type CompanyInfo } from '../services/companyInfoService';

// Helper function to format market cap
function formatMarketCap(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}Mrd`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}Mio`;
  return value.toLocaleString('de-DE');
}

interface WatchlistStock {
  symbol: string;
  name: string;
}

interface WatchlistItem extends WatchlistStock {
  currentPrice?: number;
  priceEUR?: number;
  priceChange?: number;
  signals?: TradingSignalSummary;
  companyInfo?: CompanyInfo;
  isLoading: boolean;
  error?: string;
}

interface WatchlistPanelProps {
  onSelectSymbol?: (symbol: string) => void;
  currentSymbol?: string;
}

export function WatchlistPanel({ onSelectSymbol, currentSymbol }: WatchlistPanelProps) {
  const { dataService } = useDataService();
  const navigate = useNavigate();
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'score'>('name');
  const [filterPeriod, setFilterPeriod] = useState<'hourly' | 'daily' | 'weekly' | 'longTerm'>('daily');
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);
  
  // Track all symbols for auto-refresh
  const symbolsRef = useRef<string[]>([]);

  // Subscribe to auth state changes
  useEffect(() => {
    const unsubscribe = subscribeToAuth(setAuthState);
    return () => unsubscribe();
  }, []);

  // Load watchlist based on auth state
  const loadWatchlist = useCallback(async () => {
    setIsLoadingSymbols(true);
    
    let stocks: Array<{ symbol: string; name: string }>;
    
    if (authState.isAuthenticated) {
      // Authenticated: Load user's symbols from server
      const serverSymbols = await getCustomSymbols();
      stocks = serverSymbols.map(s => ({ symbol: s.symbol, name: s.name || s.symbol }));
    } else {
      // Not authenticated: Show default stocks only
      stocks = DEFAULT_STOCKS.map(s => ({ symbol: s.symbol, name: s.name }));
    }
    
    setWatchlistItems(stocks.map(stock => ({
      symbol: stock.symbol,
      name: stock.name,
      isLoading: true,
    })));
    
    setIsLoadingSymbols(false);
  }, [authState.isAuthenticated]);

  // Reload watchlist when auth state changes
  useEffect(() => {
    loadWatchlist();
  }, [loadWatchlist, authState.isAuthenticated]);

  // Fetch data for a single symbol
  const fetchSymbolData = useCallback(async (symbol: string): Promise<Partial<WatchlistItem>> => {
    try {
      // Fetch stock data and company info in parallel
      const [stockData, companyInfo] = await Promise.all([
        dataService.fetchStockData(symbol),
        fetchCompanyInfo(symbol)
      ]);
      
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
        priceEUR: companyInfo?.priceEUR,
        priceChange,
        signals,
        companyInfo: companyInfo ?? undefined,
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
    
    // Reload symbols from appropriate source first
    let stocks: Array<{ symbol: string; name: string }>;
    
    if (authState.isAuthenticated) {
      const serverSymbols = await getCustomSymbols();
      stocks = serverSymbols.map(s => ({ symbol: s.symbol, name: s.name || s.symbol }));
    } else {
      stocks = DEFAULT_STOCKS.map(s => ({ symbol: s.symbol, name: s.name }));
    }
    
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
  
  // Auto-refresh using the hook - update symbols when watchlist changes
  useEffect(() => {
    symbolsRef.current = watchlistItems.map(item => item.symbol);
  }, [watchlistItems]);
  
  // Auto-refresh hook for background updates
  const [autoRefreshState] = useAutoRefresh({
    symbols: symbolsRef.current,
    enabled: watchlistItems.length > 0,
    onQuotesUpdate: useCallback((quotes: Map<string, QuoteData>) => {
      // Update prices in watchlist from auto-refresh
      setWatchlistItems(prev => prev.map(item => {
        const quote = quotes.get(item.symbol);
        if (quote) {
          return {
            ...item,
            currentPrice: quote.price,
            priceChange: quote.changePercent,
          };
        }
        return item;
      }));
    }, []),
  });

  // Add new symbol (only for authenticated users)
  const handleAddSymbol = useCallback(async () => {
    if (!authState.isAuthenticated) {
      setAddError('Bitte melden Sie sich an, um Symbole hinzuzufügen');
      return;
    }
    
    const symbol = newSymbol.trim().toUpperCase();
    
    if (!symbol) {
      setAddError('Symbol ist erforderlich');
      return;
    }
    
    if (symbol.length > 10) {
      setAddError('Symbol zu lang (max. 10 Zeichen)');
      return;
    }
    
    // Check if symbol already exists in watchlist
    if (watchlistItems.some(item => item.symbol === symbol)) {
      setAddError('Symbol existiert bereits in Ihrer Watchlist');
      return;
    }
    
    // Add to server
    const result = await addCustomSymbolToServer(symbol, newName.trim() || symbol);
    
    if (result.success) {
      setNewSymbol('');
      setNewName('');
      setShowAddForm(false);
      setAddError('');
      
      // Add to watchlist and fetch data
      const newItem: WatchlistItem = {
        symbol,
        name: newName.trim() || symbol,
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
      setAddError(result.error || 'Fehler beim Hinzufügen');
    }
  }, [newSymbol, newName, fetchSymbolData, authState.isAuthenticated, watchlistItems]);

  // Remove symbol (only for authenticated users)
  const handleRemoveSymbol = useCallback(async (symbol: string) => {
    if (!authState.isAuthenticated) return;
    
    const success = await removeCustomSymbolFromServer(symbol);
    if (success) {
      setWatchlistItems(prev => prev.filter(item => item.symbol !== symbol));
    }
  }, [authState.isAuthenticated]);

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
    <div className="space-y-3 sm:space-y-4 h-full flex flex-col">
      {/* Header with controls */}
      <div className="flex items-center justify-between">
        <h3 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
          <span>📋</span>
          <span className="hidden sm:inline">Watchlist</span>
          <span className="text-gray-400 font-normal">({watchlistItems.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          {/* Auto-refresh status indicator */}
          {autoRefreshState.nextUpdate && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400 bg-slate-700/30 px-2 py-1 rounded">
              <span className={`w-1.5 h-1.5 rounded-full ${autoRefreshState.isRefreshing ? 'bg-blue-400 animate-pulse' : 'bg-green-400'}`} />
              <span>{formatRefreshInterval(autoRefreshState.refreshInterval)}</span>
            </div>
          )}
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
      </div>

      {/* Filters and Sort - responsive */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 sm:gap-1 bg-slate-700/50 rounded-lg p-0.5 sm:p-1">
          {(['hourly', 'daily', 'weekly', 'longTerm'] as const).map(period => (
            <button
              key={period}
              onClick={() => setFilterPeriod(period)}
              className={`px-1.5 sm:px-2 py-1 rounded text-xs font-medium transition-colors ${
                filterPeriod === period 
                  ? 'bg-blue-600 text-white' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {periodLabels[period]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1 bg-slate-700/50 rounded-lg p-0.5 sm:p-1">
          <button
            onClick={() => setSortBy('name')}
            className={`px-1.5 sm:px-2 py-1 rounded text-xs font-medium transition-colors ${
              sortBy === 'name' 
                ? 'bg-slate-600 text-white' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            A-Z
          </button>
          <button
            onClick={() => setSortBy('score')}
            className={`px-1.5 sm:px-2 py-1 rounded text-xs font-medium transition-colors ${
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
      <div className="space-y-2 flex-1 overflow-y-auto pr-1 -mr-1">
        {isLoadingSymbols ? (
          <div className="text-center py-8 text-gray-400">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
            <p>Lade Watchlist...</p>
          </div>
        ) : displayItems.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            {authState.isAuthenticated ? (
              <>
                <p className="text-lg mb-2">Ihre Watchlist ist leer</p>
                <p className="text-sm">Fügen Sie Symbole hinzu, um loszulegen!</p>
              </>
            ) : (
              <>
                <p className="text-lg mb-2">Keine Symbole verfügbar</p>
                <p className="text-sm">Melden Sie sich an, um Ihre eigene Watchlist zu erstellen.</p>
              </>
            )}
          </div>
        ) : displayItems.map(item => (
          <div 
            key={item.symbol}
            className={`bg-slate-800/50 rounded-lg p-2.5 sm:p-3 border transition-colors cursor-pointer ${
              currentSymbol === item.symbol 
                ? 'border-blue-500/50 bg-blue-500/10' 
                : 'border-slate-700/50 hover:border-slate-600'
            }`}
            onClick={() => onSelectSymbol?.(item.symbol)}
          >
            {/* Main row: Symbol + Price + Signal */}
            <div className="flex items-center justify-between gap-2">
              {/* Left: Symbol & Name */}
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-white font-bold text-xs sm:text-sm flex-shrink-0 bg-gradient-to-br from-blue-500 to-purple-600">
                  {item.symbol.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-white text-sm sm:text-base">{item.symbol}</span>
                  </div>
                  <div className="text-xs text-gray-400 truncate" title={item.companyInfo?.name || item.name}>
                    {item.companyInfo?.name || item.name}
                  </div>
                </div>
              </div>
              
              {/* Right: Price + Signal + Actions */}
              <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                {/* Price Info */}
                {item.isLoading ? (
                  <div className="w-14 h-8 bg-slate-700 rounded animate-pulse" />
                ) : item.error ? (
                  <span className="text-[10px] text-red-400">{item.error}</span>
                ) : (
                  <div className="text-right">
                    <div className="text-sm font-medium text-white flex items-center gap-1">
                      <span className="text-green-400">€{item.priceEUR?.toFixed(2) || '—'}</span>
                      <span className="text-gray-500 text-xs">${item.currentPrice?.toFixed(2)}</span>
                    </div>
                    <div className={`text-[10px] sm:text-xs ${(item.priceChange ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {(item.priceChange ?? 0) >= 0 ? '+' : ''}{item.priceChange?.toFixed(2)}%
                    </div>
                  </div>
                )}

                {/* Signal Badge - compact on mobile */}
                {!item.isLoading && !item.error && (
                  <SignalBadge signal={item.signals} small />
                )}

                {/* Trade Button (only for authenticated users) */}
                {authState.isAuthenticated && !item.isLoading && !item.error && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      // Navigate to trading page with symbol as URL param
                      navigate(`/trading?symbol=${item.symbol}`);
                    }}
                    className="p-1.5 bg-green-600/20 hover:bg-green-600/40 rounded text-green-400 transition-colors"
                    title="Handeln"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                    </svg>
                  </button>
                )}

                {/* Remove Button (only for authenticated users) */}
                {authState.isAuthenticated && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveSymbol(item.symbol);
                    }}
                    className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400 transition-colors"
                    title="Entfernen"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Signal Details Row - hidden on very small screens */}
            {!item.isLoading && !item.error && item.signals && (
              <div className="mt-2 pt-2 border-t border-slate-700/50 hidden sm:flex items-center gap-1.5 text-[10px] sm:text-xs">
                <span className="text-gray-500">Signale:</span>
                {(['hourly', 'daily', 'weekly', 'longTerm'] as const).map(period => {
                  const periodSignal = item.signals?.[period];
                  const display = periodSignal ? getSignalDisplay(periodSignal.signal) : null;
                  return (
                    <span
                      key={period}
                      className={`px-1 sm:px-1.5 py-0.5 rounded ${
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

            {/* Company Info Row - KGV, Market Cap, Dividende */}
            {!item.isLoading && !item.error && item.companyInfo && (
              <div className="mt-2 pt-2 border-t border-slate-700/50 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] sm:text-xs text-gray-400">
                {item.companyInfo.marketCapEUR !== undefined && (
                  <span title="Marktkapitalisierung">
                    <span className="text-gray-500">MKap:</span>{' '}
                    <span className="text-gray-300">
                      €{formatMarketCap(item.companyInfo.marketCapEUR)}
                    </span>
                  </span>
                )}
                {item.companyInfo.peRatio !== undefined && (
                  <span title="Kurs-Gewinn-Verhältnis">
                    <span className="text-gray-500">KGV:</span>{' '}
                    <span className={`${item.companyInfo.peRatio > 30 ? 'text-yellow-400' : item.companyInfo.peRatio < 15 ? 'text-green-400' : 'text-gray-300'}`}>
                      {item.companyInfo.peRatio.toFixed(1)}
                    </span>
                  </span>
                )}
                {item.companyInfo.dividendYield !== undefined && item.companyInfo.dividendYield > 0 && (
                  <span title="Dividendenrendite">
                    <span className="text-gray-500">Div:</span>{' '}
                    <span className={`${item.companyInfo.dividendYield > 3 ? 'text-green-400' : 'text-gray-300'}`}>
                      {item.companyInfo.dividendYield.toFixed(2)}%
                    </span>
                  </span>
                )}
                {item.companyInfo.industry && (
                  <span className="text-gray-500 truncate max-w-[120px]" title={item.companyInfo.industry}>
                    {item.companyInfo.industry}
                  </span>
                )}
                {item.companyInfo.dataSources && item.companyInfo.dataSources.length > 0 && (
                  <span className="text-gray-600 text-[9px]" title={`Daten von: ${item.companyInfo.dataSources.join(', ')}`}>
                    [{item.companyInfo.dataSources.length} Quellen]
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Symbol Form - only for authenticated users */}
      {authState.isAuthenticated && (
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
      )}

      {/* Info for non-authenticated users */}
      {!authState.isAuthenticated && (
        <div className="border-t border-slate-700 pt-4">
          <div className="bg-slate-800/50 rounded-lg p-3 text-center">
            <p className="text-gray-400 text-sm">
              Melden Sie sich an, um Ihre eigene Watchlist zu erstellen und zu verwalten.
            </p>
          </div>
        </div>
      )}

      {/* Legend - compact */}
      <div className="text-[10px] sm:text-xs text-gray-500 pt-2 border-t border-slate-700 flex-shrink-0">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="flex items-center gap-0.5"><span>🚀</span> Stark Kauf</span>
          <span className="flex items-center gap-0.5"><span>📈</span> Kauf</span>
          <span className="flex items-center gap-0.5"><span>➡️</span> Halten</span>
          <span className="flex items-center gap-0.5"><span>📉</span> Verkauf</span>
          <span className="flex items-center gap-0.5"><span>⚠️</span> Stark Verk.</span>
        </div>
      </div>
    </div>
  );
}
