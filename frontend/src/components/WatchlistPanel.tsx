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
import { DEFAULT_STOCKS } from '../utils/defaultStocks';
import { useDataService, useSimpleAutoRefresh } from '../hooks';
import { 
  calculateCombinedTradingSignals, 
  getSignalDisplay,
  type TradingSignalSummary,
  type CombinedSignalInput,
  type SignalContribution
} from '../utils/tradingSignals';
import { generateForecast } from '../utils/forecast';
import { analyzeSentiment } from '../utils/sentimentAnalysis';
import { 
  getAuthState, 
  subscribeToAuth, 
  type AuthState 
} from '../services/authService';
import { 
  getCustomSymbols, 
  addCustomSymbolToServer, 
  removeCustomSymbolFromServer,
  getWatchlistSettings,
  getSignalSourceSettings
} from '../services/userSettingsService';
import { fetchCompanyInfo, type CompanyInfo } from '../services/companyInfoService';
import { mlService } from '../services/mlService';
import { rlTradingService } from '../services/rlTradingService';
import { 
  getCachedSignals, 
  setCachedSignals, 
  isCacheValid,
  type CachedWatchlistSignals 
} from '../services/watchlistCacheService';
import type { NewsItem } from '../services/types';
import { getOrCreatePortfolio, executeMarketOrder, getPortfolioMetrics } from '../services/tradingService';
import { useSettings } from '../contexts/SettingsContext';
import type { Portfolio, PortfolioMetrics, OrderSide, ProductType } from '../types/trading';

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
  // Extended signal sources
  signalSources?: {
    hasNews: boolean;
    hasML: boolean;
    hasRL: boolean;
  };
}

interface WatchlistPanelProps {
  onSelectSymbol?: (symbol: string) => void;
  currentSymbol?: string;
}

export function WatchlistPanel({ onSelectSymbol, currentSymbol }: WatchlistPanelProps) {
  const { dataService } = useDataService();
  const navigate = useNavigate();
  const { t, formatCurrency } = useSettings();
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'score'>('score');  // Default to score sorting
  const [filterPeriod, setFilterPeriod] = useState<'hourly' | 'daily' | 'weekly' | 'longTerm'>('daily');
  
  // Source filter state for inline toggling
  const [sourceFilters, setSourceFilters] = useState({
    technical: true,
    sentiment: true,
    ml: true,
    rl: true,
  });
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);
  
  // Track loading progress for signals
  const [signalLoadProgress, setSignalLoadProgress] = useState(0);
  
  // Track expanded items for mobile detail view
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  
  // Quick Trade State
  const [quickTradeSymbol, setQuickTradeSymbol] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [metrics, setMetrics] = useState<PortfolioMetrics | null>(null);
  const [tradeQuantity, setTradeQuantity] = useState('1');
  const [tradeSide, setTradeSide] = useState<OrderSide>('buy');
  const [productType, setProductType] = useState<ProductType>('stock');
  const [isExecuting, setIsExecuting] = useState(false);
  const [tradeResult, setTradeResult] = useState<{ success: boolean; message: string } | null>(null);

  // Subscribe to auth state changes
  useEffect(() => {
    const unsubscribe = subscribeToAuth(setAuthState);
    return () => unsubscribe();
  }, []);

  // Load portfolio data once on mount for authenticated users
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
    if (authState.isAuthenticated) {
      loadPortfolio();
    }
  }, [authState.isAuthenticated]);

  // Execute quick trade
  const handleQuickTrade = async (symbol: string, price: number) => {
    if (!portfolio || !price) return;
    setIsExecuting(true);
    setTradeResult(null);
    try {
      const qty = parseFloat(tradeQuantity);
      if (isNaN(qty) || qty <= 0) {
        setTradeResult({ success: false, message: t('dashboard.invalidQuantity') });
        setIsExecuting(false);
        return;
      }
      const result = await executeMarketOrder({
        portfolioId: portfolio.id,
        symbol: symbol,
        side: tradeSide,
        quantity: qty,
        currentPrice: price,
        productType: productType,
      });
      if (result.success) {
        const actionKey = tradeSide === 'buy' ? 'dashboard.purchaseSuccess' : 'dashboard.shortSuccess';
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

  // Fetch data for a single symbol - ALWAYS loads signals
  const fetchSymbolData = useCallback(async (symbol: string): Promise<Partial<WatchlistItem>> => {
    try {
      const watchlistSettings = getWatchlistSettings();
      const signalSourceSettings = getSignalSourceSettings();
      
      // ALWAYS enable all signal sources for comprehensive trading signals
      const effectiveSettings = {
        enableSentiment: true,
        enableMLPrediction: true,
        enableRLAgents: true,
        selectedRLAgents: signalSourceSettings.selectedRLAgents,
      };
      
      // Check cache first - but validate it contains all expected sources
      const cached = await getCachedSignals(symbol);
      
      // Cache is only valid if it contains extended signal sources (ML/RL/News)
      // If the cache only has tech signals, we need to reload to get extended sources
      const cacheHasAllSources = cached?.sources?.hasML || cached?.sources?.hasRL || cached?.sources?.hasNews;
      
      if (cached && isCacheValid(cached) && cacheHasAllSources) {
        // We still need fresh price and company info, but can use cached signals
        const [stockData, companyInfo] = await Promise.all([
          dataService.fetchStockData(symbol),
          fetchCompanyInfo(symbol)
        ]);
        
        if (stockData && stockData.data.length > 0) {
          const currentPrice = stockData.data[stockData.data.length - 1].close;
          const previousPrice = stockData.data.length > 1 
            ? stockData.data[stockData.data.length - 2].close 
            : currentPrice;
          const priceChange = ((currentPrice - previousPrice) / previousPrice) * 100;
          
          return {
            currentPrice,
            priceEUR: companyInfo?.priceEUR,
            priceChange,
            signals: cached.signals as unknown as TradingSignalSummary,
            companyInfo: companyInfo ?? undefined,
            signalSources: cached.sources,
            isLoading: false,
            error: undefined,
          };
        }
      }
      
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
      
      // Initialize signal sources tracking
      const signalSources = { hasNews: false, hasML: false, hasRL: false };
      
      // Prepare signal input with config that enables all sources
      const signalInput: CombinedSignalInput = {
        newsItems: [],
        forecast,
        stockData: stockData.data,
        currentPrice,
        signalConfig: {
          enableSentiment: true,
          enableTechnical: true,
          enableMLPrediction: true,
          enableRLAgents: true,  // Enable RL in signal calculation
          customWeights: null,
        },
      };
      
      // Always fetch ALL signal sources for comprehensive trading signals
      const extendedPromises: Promise<void>[] = [];
      
      // News signals
      if (effectiveSettings.enableSentiment) {
        extendedPromises.push(
          dataService.fetchNews(symbol).then((news: NewsItem[]) => {
            if (news && news.length > 0) {
              // Analyze sentiment for each news item
              signalInput.newsItems = news.map(n => {
                const text = `${n.headline} ${n.summary || ''}`;
                const sentimentResult = analyzeSentiment(text);
                return {
                  sentimentResult,
                  datetime: n.datetime || Date.now(),
                };
              });
              signalSources.hasNews = true;
            }
          }).catch(() => { /* ignore news errors */ })
        );
      }
      
      // ML signals
      if (effectiveSettings.enableMLPrediction) {
        extendedPromises.push(
          mlService.predict(symbol, stockData?.data).then(prediction => {
            if (prediction && prediction.predictions) {
              signalInput.mlPredictions = prediction.predictions;
              signalSources.hasML = true;
            }
          }).catch(() => { /* ignore ML errors - model may not be trained */ })
        );
      }
      
      // RL signals
      if (effectiveSettings.enableRLAgents && stockData) {
        extendedPromises.push(
          (async () => {
            try {
              let agentsToUse = effectiveSettings.selectedRLAgents;
              
              // If no agents selected, use all trained agents
              if (agentsToUse.length === 0) {
                const allAgents = await rlTradingService.listAgents();
                agentsToUse = allAgents
                  .filter(a => a.is_trained)
                  .map(a => a.name);
              }
              
              if (agentsToUse.length === 0) return;
              
              const result = await rlTradingService.getMultiSignals(agentsToUse, stockData.data);
              if (result && result.signals) {
                const signalsArray = Object.entries(result.signals);
                if (signalsArray.length > 0) {
                  // Map action_probabilities - sum buy/sell variants from RL service
                  signalInput.rlSignals = signalsArray.map(([agentName, signal]) => {
                    const probs = signal.action_probabilities || {};
                    // Sum buy variants (buy, buy_small, buy_medium, buy_large)
                    const buyProb = (probs.buy ?? 0) + (probs.buy_small ?? 0) + (probs.buy_medium ?? 0) + (probs.buy_large ?? 0);
                    // Sum sell variants (sell, sell_small, sell_medium, sell_all)
                    const sellProb = (probs.sell ?? 0) + (probs.sell_small ?? 0) + (probs.sell_medium ?? 0) + (probs.sell_all ?? 0);
                    // Hold probability
                    const holdProb = probs.hold ?? 0.34;
                    
                    return {
                      signal: signal.signal as 'buy' | 'sell' | 'hold',
                      confidence: signal.confidence,
                      action_probabilities: {
                        buy: buyProb || 0.33,
                        sell: sellProb || 0.33,
                        hold: holdProb,
                      },
                      agent_name: agentName,
                      agent_style: signal.agent_style,
                      holding_period: signal.holding_period,
                    };
                  });
                  signalSources.hasRL = true;
                }
              }
            } catch {
              /* ignore RL errors - service may be unavailable */
            }
          })()
        );
      }
      
      // Wait for all signal fetches (each with individual timeout of 15s)
      const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> => {
        return Promise.race([
          promise,
          new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), timeoutMs))
        ]) as Promise<T | undefined>;
      };
      
      // Wait for all promises with timeout
      await Promise.all(extendedPromises.map(p => withTimeout(p, 15000)));
      
      const signals = calculateCombinedTradingSignals(signalInput);
      
      // Cache signals only if we have comprehensive data:
      // - Always require RL signals (since we enabled it and service is running)
      // - News is optional but preferred - we cache anyway since Finnhub might not have news for all symbols
      // - ML is always 404 (no trained model), so we don't require it
      const shouldCache = signalSources.hasRL; // Minimum requirement: RL signals
      
      if (shouldCache) {
        const ttlSeconds = watchlistSettings.cacheDurationMinutes * 60 || 900;
        setCachedSignals(symbol, signals as unknown as CachedWatchlistSignals['signals'], signalSources, ttlSeconds);
      }

      return {
        currentPrice,
        priceEUR: companyInfo?.priceEUR,
        priceChange,
        signals,
        companyInfo: companyInfo ?? undefined,
        signalSources,
        isLoading: false,
        error: undefined,
      };
    } catch (err) {
      return { 
        error: err instanceof Error ? err.message : 'Fehler beim Laden', 
        isLoading: false 
      };
    }
  }, [dataService]);

  // Refresh all watchlist data with progress tracking
  const refreshWatchlist = useCallback(async () => {
    setIsRefreshing(true);
    setSignalLoadProgress(0);
    
    // Reload symbols from appropriate source first
    let stocks: Array<{ symbol: string; name: string }>;
    
    if (authState.isAuthenticated) {
      const serverSymbols = await getCustomSymbols();
      stocks = serverSymbols.map(s => ({ symbol: s.symbol, name: s.name || s.symbol }));
    } else {
      stocks = DEFAULT_STOCKS.map(s => ({ symbol: s.symbol, name: s.name }));
    }
    
    const totalSymbols = stocks.length;
    let loadedCount = 0;
    
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
      
      // Update progress
      loadedCount += batch.length;
      setSignalLoadProgress((loadedCount / totalSymbols) * 100);
    }
    
    setSignalLoadProgress(100);
    setIsRefreshing(false);
  }, [fetchSymbolData, authState.isAuthenticated]);

  // Auto-refresh on mount
  useEffect(() => {
    refreshWatchlist();
  }, []);

  // Lightweight price-only refresh (doesn't reload company info or signals)
  // Use a ref to get current symbols to avoid stale closure issues
  const watchlistSymbolsRef = useRef<string[]>([]);
  
  // Keep ref in sync with watchlistItems
  useEffect(() => {
    watchlistSymbolsRef.current = watchlistItems.map(item => item.symbol);
  }, [watchlistItems]);
  
  const refreshPricesOnly = useCallback(async () => {
    const symbols = watchlistSymbolsRef.current;
    if (symbols.length === 0) return;
    
    // Update prices one by one without blocking UI
    for (const symbol of symbols) {
      try {
        const stockData = await dataService.fetchStockData(symbol);
        if (stockData && stockData.data.length > 0) {
          const currentPrice = stockData.data[stockData.data.length - 1].close;
          const previousPrice = stockData.data.length > 1 
            ? stockData.data[stockData.data.length - 2].close 
            : currentPrice;
          const priceChange = ((currentPrice - previousPrice) / previousPrice) * 100;
          
          // Only update if price actually changed
          setWatchlistItems(prev => prev.map(item => 
            item.symbol === symbol && item.currentPrice !== currentPrice
              ? { ...item, currentPrice, priceChange }
              : item
          ));
        }
      } catch {
        // Silently ignore errors during price refresh
      }
    }
  }, [dataService]); // dataService is stable, no stale closure

  // Auto-refresh prices every 2 seconds (lightweight, UI-friendly)
  useSimpleAutoRefresh(refreshPricesOnly, { interval: 2000, enabled: watchlistItems.length > 0 });

  // Auto-refresh signals based on user settings
  useEffect(() => {
    const watchlistSettings = getWatchlistSettings();
    
    // Only set up interval if auto-refresh is enabled
    if (watchlistSettings.autoRefreshSeconds === 0) {
      return;
    }
    
    const intervalMs = watchlistSettings.autoRefreshSeconds * 1000;
    console.log(`[Watchlist] Signals auto-refresh every ${watchlistSettings.autoRefreshSeconds}s`);
    
    const interval = setInterval(() => {
      console.log('[Watchlist] Auto-refreshing signals...');
      refreshWatchlist();
    }, intervalMs);
    
    return () => clearInterval(interval);
  }, [refreshWatchlist]);

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
    
    // Clear quick trade state if removing the symbol that has its dropdown open
    if (quickTradeSymbol === symbol) {
      setQuickTradeSymbol(null);
      setTradeResult(null);
    }
    
    const success = await removeCustomSymbolFromServer(symbol);
    if (success) {
      setWatchlistItems(prev => prev.filter(item => item.symbol !== symbol));
    }
  }, [authState.isAuthenticated, quickTradeSymbol]);

  // Helper: Check if a source is enabled in filters
  const isSourceEnabled = useCallback((source: string): boolean => {
    const sourceMap: Record<string, boolean> = {
      technical: sourceFilters.technical,
      sentiment: sourceFilters.sentiment,
      ml: sourceFilters.ml,
      rl: sourceFilters.rl,
    };
    return sourceMap[source] ?? true;
  }, [sourceFilters]);

  // Helper: Determine signal display based on score
  const getSignalDisplayFromScore = useCallback((score: number) => {
    if (score >= 50) return getSignalDisplay('STRONG_BUY');
    if (score >= 20) return getSignalDisplay('BUY');
    if (score > -20) return getSignalDisplay('HOLD');
    if (score > -50) return getSignalDisplay('SELL');
    return getSignalDisplay('STRONG_SELL');
  }, []);

  // Helper: Calculate filtered score based on selected sources for a specific period
  const getFilteredScoreForPeriod = useCallback((signals: TradingSignalSummary | undefined, period: 'hourly' | 'daily' | 'weekly' | 'longTerm'): number => {
    if (!signals) return 0;
    const contributions = signals.contributions?.[period];
    if (!contributions || contributions.length === 0) return signals[period]?.score ?? 0;
    
    let filteredScore = 0;
    contributions.forEach(c => {
      if (isSourceEnabled(c.source)) {
        filteredScore += c.score;
      }
    });
    return filteredScore;
  }, [isSourceEnabled]);

  // Helper: Calculate filtered score for current period
  const getFilteredScore = useCallback((signals?: TradingSignalSummary) => {
    return getFilteredScoreForPeriod(signals, filterPeriod);
  }, [filterPeriod, getFilteredScoreForPeriod]);

  // Sort and filter items
  const displayItems = useMemo(() => {
    const items = [...watchlistItems];
    
    if (sortBy === 'score') {
      items.sort((a, b) => {
        const scoreA = getFilteredScore(a.signals);
        const scoreB = getFilteredScore(b.signals);
        return scoreB - scoreA; // Highest score first
      });
    } else {
      items.sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
    
    return items;
  }, [watchlistItems, sortBy, getFilteredScore]);

  // Signal badge component - shows cumulative signal with filtered score
  const SignalBadge = ({ signal, small = false }: { signal?: TradingSignalSummary; period?: string; small?: boolean }) => {
    if (!signal) return <span className="text-gray-500 text-xs">—</span>;
    
    const periodSignal = signal[filterPeriod];
    const filteredScore = Math.round(getFilteredScore(signal));
    const adjustedDisplay = getSignalDisplayFromScore(filteredScore);
    
    return (
      <span 
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${adjustedDisplay.bgColor} ${adjustedDisplay.color} ${small ? 'text-xs' : 'text-sm'}`}
        title={periodSignal?.reasoning || ''}
      >
        <span className="text-base">{adjustedDisplay.emoji}</span>
        <span className="font-bold">{filteredScore > 0 ? '+' : ''}{filteredScore}</span>
      </span>
    );
  };

  // Signal Source Mini Badges - zeigt die einzelnen Quellen kompakt an (filtered)
  const SignalSourceBadges = ({ contributions, compact = false }: { contributions?: SignalContribution[]; compact?: boolean }) => {
    if (!contributions || contributions.length === 0) return null;
    
    // Filter contributions based on sourceFilters
    const filteredContributions = contributions.filter(c => isSourceEnabled(c.source));
    
    if (filteredContributions.length === 0) return null;
    
    const getSourceInfo = (source: string) => {
      switch (source) {
        case 'technical': return { icon: '📊', label: 'Tech', color: 'text-blue-400', bgColor: 'bg-blue-500/20 border-blue-500/30' };
        case 'sentiment': return { icon: '📰', label: 'News', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20 border-yellow-500/30' };
        case 'ml': return { icon: '🤖', label: 'ML', color: 'text-purple-400', bgColor: 'bg-purple-500/20 border-purple-500/30' };
        case 'rl': return { icon: '🎯', label: 'RL', color: 'text-green-400', bgColor: 'bg-green-500/20 border-green-500/30' };
        default: return { icon: '•', label: source, color: 'text-gray-400', bgColor: 'bg-slate-500/20 border-slate-500/30' };
      }
    };
    
    const getScoreColor = (score: number) => {
      if (score > 30) return 'text-green-400';
      if (score > 10) return 'text-green-300';
      if (score < -30) return 'text-red-400';
      if (score < -10) return 'text-red-300';
      return 'text-gray-400';
    };
    
    if (compact) {
      // Ultra-compact view for mobile: just dots with colors
      return (
        <div className="flex items-center gap-0.5">
          {filteredContributions.map((contrib, idx) => {
            const info = getSourceInfo(contrib.source);
            return (
              <span 
                key={idx}
                className={`w-1.5 h-1.5 rounded-full ${info.bgColor.replace('/20', '')} ${getScoreColor(contrib.score).replace('text-', 'bg-')}`}
                title={`${info.label}: ${contrib.score > 0 ? '+' : ''}${contrib.score.toFixed(0)}`}
              />
            );
          })}
        </div>
      );
    }
    
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {filteredContributions.map((contrib, idx) => {
          const info = getSourceInfo(contrib.source);
          return (
            <span 
              key={idx}
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] ${info.bgColor} ${info.color}`}
              title={`${info.label}: ${contrib.description} (Score: ${contrib.score.toFixed(0)})`}
            >
              <span>{info.icon}</span>
              <span className="font-medium">{info.label}</span>
              <span className={`font-bold ${getScoreColor(contrib.score)}`}>
                {contrib.score > 0 ? '+' : ''}{Math.round(contrib.score)}
              </span>
            </span>
          );
        })}
      </div>
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
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
          <span>📋</span>
          <span className="hidden sm:inline">Watchlist</span>
          <span className="text-gray-400 font-normal text-sm">({watchlistItems.length})</span>
        </h3>
        
        <div className="flex items-center gap-2">
          {/* Progress indicator during load */}
          {isRefreshing && signalLoadProgress < 100 && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${signalLoadProgress}%` }}
                />
              </div>
              <span className="min-w-[2rem] text-right">{Math.round(signalLoadProgress)}%</span>
            </div>
          )}
          
          <button
            onClick={refreshWatchlist}
            disabled={isRefreshing}
            className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
            title="Alle Signale neu laden"
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
        
        {/* Source Filters - Interactive toggles to filter signals by source */}
        <div className="flex items-center gap-1 sm:gap-1.5 ml-auto">
          <span className="text-[10px] text-gray-500 hidden sm:inline mr-1">Quellen:</span>
          <button
            onClick={() => setSourceFilters(f => ({ ...f, technical: !f.technical }))}
            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] sm:text-xs transition-all border ${
              sourceFilters.technical 
                ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' 
                : 'bg-slate-800/50 border-slate-700 text-gray-500 opacity-50'
            }`}
            title="Technische Analyse (RSI, MACD, Bollinger)"
          >
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="hidden sm:inline">Tech</span>
          </button>
          <button
            onClick={() => setSourceFilters(f => ({ ...f, sentiment: !f.sentiment }))}
            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] sm:text-xs transition-all border ${
              sourceFilters.sentiment 
                ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' 
                : 'bg-slate-800/50 border-slate-700 text-gray-500 opacity-50'
            }`}
            title="News Sentiment"
          >
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
            <span className="hidden sm:inline">News</span>
          </button>
          <button
            onClick={() => setSourceFilters(f => ({ ...f, ml: !f.ml }))}
            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] sm:text-xs transition-all border ${
              sourceFilters.ml 
                ? 'bg-purple-500/20 border-purple-500/50 text-purple-400' 
                : 'bg-slate-800/50 border-slate-700 text-gray-500 opacity-50'
            }`}
            title="ML-Vorhersage (LSTM)"
          >
            <span className="w-2 h-2 rounded-full bg-purple-400" />
            <span className="hidden sm:inline">ML</span>
          </button>
          <button
            onClick={() => setSourceFilters(f => ({ ...f, rl: !f.rl }))}
            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] sm:text-xs transition-all border ${
              sourceFilters.rl 
                ? 'bg-green-500/20 border-green-500/50 text-green-400' 
                : 'bg-slate-800/50 border-slate-700 text-gray-500 opacity-50'
            }`}
            title="RL-Agenten"
          >
            <span className="w-2 h-2 rounded-full bg-green-400" />
            <span className="hidden sm:inline">RL</span>
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
        ) : displayItems.map(item => {
          const isExpanded = expandedSymbol === item.symbol;
          
          return (
          <div 
            key={item.symbol}
            className={`bg-slate-800/50 rounded-lg border transition-all ${
              currentSymbol === item.symbol 
                ? 'border-blue-500/50 bg-blue-500/10' 
                : 'border-slate-700/50 hover:border-slate-600'
            }`}
          >
            {/* Main row: Symbol + Price + Signal */}
            <div 
              className="p-2.5 sm:p-3 cursor-pointer"
              onClick={() => {
                // On mobile: toggle expand. On desktop: always select.
                if (window.innerWidth < 640) {
                  setExpandedSymbol(isExpanded ? null : item.symbol);
                }
                onSelectSymbol?.(item.symbol);
              }}
            >
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
                  <div className="flex items-center gap-1">
                    <SignalBadge signal={item.signals} small />
                    {/* Mobile expand indicator */}
                    <button 
                      className="sm:hidden p-0.5 text-gray-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedSymbol(isExpanded ? null : item.symbol);
                      }}
                    >
                      <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                )}

                {/* Quick Trade Button with Dropdown (only for authenticated users, on desktop) */}
                {authState.isAuthenticated && !item.isLoading && !item.error && (
                  <div className="relative hidden sm:block">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setQuickTradeSymbol(quickTradeSymbol === item.symbol ? null : item.symbol);
                        setTradeResult(null);
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all text-sm font-medium ${
                        quickTradeSymbol === item.symbol 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-green-600/20 hover:bg-green-600/40 text-green-400 border border-green-600/30'
                      }`}
                      title={t('dashboard.quickTrade')}
                    >
                      <span className="text-base">💹</span>
                      <span>Handeln</span>
                      <svg
                        className={`w-3.5 h-3.5 transition-transform ${quickTradeSymbol === item.symbol ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    
                    {/* Quick Trade Dropdown Panel */}
                    {quickTradeSymbol === item.symbol && (
                      <div 
                        className="absolute top-full right-0 mt-2 w-72 bg-slate-800/95 backdrop-blur-sm rounded-xl border border-slate-700 p-3 shadow-xl z-50"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!portfolio ? (
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
                                <div className="text-[10px] text-gray-400">{item.symbol}</div>
                                <div className="font-semibold text-sm">
                                  {item.currentPrice ? formatCurrency(item.currentPrice) : '---'}
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
                                {item.currentPrice && tradeQuantity && (
                                  <span>
                                    {parseFloat(tradeQuantity) || 0}× @ {item.currentPrice.toFixed(2)} = <span className="text-white font-medium">{formatCurrency((parseFloat(tradeQuantity) || 0) * item.currentPrice)}</span>
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={() => item.currentPrice && handleQuickTrade(item.symbol, item.currentPrice)}
                                disabled={isExecuting || !item.currentPrice}
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
                                onClick={() => navigate(`/trading?symbol=${item.symbol}`)}
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
            </div>

            {/* Signal Details Row - Desktop: always visible, Mobile: collapsed by default */}
            {!item.isLoading && !item.error && item.signals && (
              <div className={`border-t border-slate-700/50 px-2.5 sm:px-3 pb-2.5 sm:pb-3 pt-2 ${
                isExpanded ? 'block' : 'hidden sm:block'
              }`}>
                {/* Signal Source Breakdown - shown prominently at the top */}
                {item.signals.contributions?.[filterPeriod] && item.signals.contributions[filterPeriod].length > 0 && (
                  <div className="mb-2">
                    <SignalSourceBadges contributions={item.signals.contributions[filterPeriod]} />
                  </div>
                )}
                
                {/* Period Signals - compact inline view */}
                <div className="flex items-center gap-1.5 text-[10px] sm:text-xs">
                  <span className="text-gray-500 text-[10px]">Perioden:</span>
                  {(['hourly', 'daily', 'weekly', 'longTerm'] as const).map(period => {
                    // Use the shared helper function for filtered score calculation
                    const score = Math.round(getFilteredScoreForPeriod(item.signals, period));
                    const display = getSignalDisplayFromScore(score);
                    
                    return (
                      <button
                        key={period}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFilterPeriod(period);
                        }}
                        className={`px-1 sm:px-1.5 py-0.5 rounded transition-all ${
                          period === filterPeriod ? 'ring-1 ring-blue-500' : ''
                        } ${display?.bgColor || 'bg-slate-700'}`}
                        title={`${periodLabels[period]}: Score ${score > 0 ? '+' : ''}${score}`}
                      >
                        <span className={`${display?.color || 'text-gray-400'} flex items-center gap-0.5`}>
                          <span className="text-[10px]">{periodLabels[period]}</span>
                          <span className="font-medium">{score > 0 ? '+' : ''}{score}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                
                {/* Mobile-only: Quick action buttons */}
                {authState.isAuthenticated && (
                  <div className="sm:hidden flex items-center gap-2 mt-2 pt-2 border-t border-slate-700/30">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/trading?symbol=${item.symbol}`);
                      }}
                      className="flex-1 py-1.5 px-3 bg-green-600/20 hover:bg-green-600/40 rounded text-green-400 text-xs font-medium transition-colors"
                    >
                      💰 Handeln
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveSymbol(item.symbol);
                      }}
                      className="py-1.5 px-3 bg-red-600/20 hover:bg-red-600/40 rounded text-red-400 text-xs transition-colors"
                    >
                      ✕ Entfernen
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Company Info Row - KGV, Market Cap, Dividende - Desktop only */}
            {!item.isLoading && !item.error && item.companyInfo && (
              <div className={`border-t border-slate-700/50 px-2.5 sm:px-3 pb-2.5 sm:pb-3 pt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] sm:text-xs text-gray-400 ${
                isExpanded ? 'block' : 'hidden sm:block'
              }`}>
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
          );
        })}
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

      {/* Legend - compact signal explanation only */}
      <div className="text-[10px] sm:text-xs text-gray-500 pt-2 border-t border-slate-700 flex-shrink-0">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="flex items-center gap-0.5"><span>🚀</span> Stark Kauf (≥50)</span>
          <span className="flex items-center gap-0.5"><span>📈</span> Kauf (≥20)</span>
          <span className="flex items-center gap-0.5"><span>➡️</span> Halten (±19)</span>
          <span className="flex items-center gap-0.5"><span>📉</span> Verkauf (≤-20)</span>
          <span className="flex items-center gap-0.5"><span>⚠️</span> Stark Verk. (≤-50)</span>
        </div>
      </div>
    </div>
  );
}
