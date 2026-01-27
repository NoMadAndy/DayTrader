import { useState, useCallback, useEffect, useMemo } from 'react';
import { DEFAULT_STOCKS } from '../utils/defaultStocks';
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
import { fetchCompanyInfo } from '../services/companyInfoService';

// Re-export DataTimestamps type for external use
export interface DataTimestamps {
  financial?: Date | null;
  news?: Date | null;
  mlModel?: Date | null;
}

interface Stock {
  symbol: string;
  name: string;
  fullName?: string;
  // Extended info from API
  price?: number;
  change?: number;
  changePercent?: number;
  volume?: number;
  marketCap?: number;
  peRatio?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
}

interface StockSelectorProps {
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
  // Optional freshness integration
  timestamps?: DataTimestamps;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

// Freshness helpers
type FreshnessLevel = 'fresh' | 'stale' | 'old' | 'unknown';

function getAgeInMs(timestamp: Date | null | undefined): number | null {
  if (!timestamp) return null;
  return Date.now() - timestamp.getTime();
}

function getFreshnessLevel(ageMs: number | null, thresholds: { fresh: number; stale: number }): FreshnessLevel {
  if (ageMs === null) return 'unknown';
  if (ageMs < thresholds.fresh) return 'fresh';
  if (ageMs < thresholds.stale) return 'stale';
  return 'old';
}

function formatAge(ageMs: number | null): string {
  if (ageMs === null) return '—';
  const seconds = Math.floor(ageMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

const THRESHOLDS = {
  financial: { fresh: 5 * 60 * 1000, stale: 30 * 60 * 1000 },
  news: { fresh: 15 * 60 * 1000, stale: 60 * 60 * 1000 },
  mlModel: { fresh: 24 * 60 * 60 * 1000, stale: 7 * 24 * 60 * 60 * 1000 },
};

const FRESHNESS_COLORS: Record<FreshnessLevel, string> = {
  fresh: 'text-green-400',
  stale: 'text-yellow-400',
  old: 'text-red-400',
  unknown: 'text-gray-500',
};

// Format large numbers (1.5M, 2.3B, etc.)
function formatCompactNumber(num: number | undefined): string {
  if (!num) return '-';
  if (num >= 1e12) return (num / 1e12).toFixed(1) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toFixed(0);
}

// Format price with appropriate decimals
function formatPrice(price: number | undefined): string {
  if (!price) return '-';
  if (price >= 1000) return price.toFixed(0);
  if (price >= 100) return price.toFixed(1);
  return price.toFixed(2);
}

// Get 52-week position as percentage
function get52WeekPosition(price: number | undefined, low: number | undefined, high: number | undefined): number | null {
  if (!price || !low || !high || high === low) return null;
  return Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
}

export function StockSelector({ 
  selectedSymbol, 
  onSelect,
  timestamps,
  onRefresh,
  isRefreshing = false
}: StockSelectorProps) {
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Freshness tick for live updates
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (timestamps) {
      const interval = setInterval(() => setTick(t => t + 1), 1000);
      return () => clearInterval(interval);
    }
  }, [timestamps]);
  
  // Subscribe to auth state
  useEffect(() => {
    const unsubscribe = subscribeToAuth(setAuthState);
    return () => unsubscribe();
  }, []);

  // Load stocks based on auth state
  useEffect(() => {
    async function loadStocks() {
      setIsLoading(true);
      
      let loadedStocks: Stock[];
      
      if (authState.isAuthenticated) {
        // Load user's symbols from server
        const serverSymbols = await getCustomSymbols();
        loadedStocks = serverSymbols.map(s => ({ symbol: s.symbol, name: s.name || s.symbol }));
      } else {
        // Use default stocks for non-authenticated users
        loadedStocks = DEFAULT_STOCKS.map(s => ({ symbol: s.symbol, name: s.name }));
      }
      
      setStocks(loadedStocks);
      setIsLoading(false);
      
      // Load full company info including prices in background
      loadedStocks.forEach(async (stock) => {
        try {
          const info = await fetchCompanyInfo(stock.symbol);
          if (info) {
            setStocks(prev => prev.map(s => 
              s.symbol === stock.symbol 
                ? { 
                    ...s, 
                    fullName: info.name || s.fullName,
                    price: info.priceUSD,
                    change: info.changeAbsolute,
                    changePercent: info.changePercent,
                    volume: info.volume,
                    marketCap: info.marketCapUSD,
                    peRatio: info.peRatio,
                    fiftyTwoWeekHigh: info.fiftyTwoWeekHigh,
                    fiftyTwoWeekLow: info.fiftyTwoWeekLow,
                  }
                : s
            ));
          }
        } catch {
          // Ignore errors for individual stocks
        }
      });
    }
    
    loadStocks();
  }, [authState.isAuthenticated]);

  // Refresh prices periodically when dropdown is open
  useEffect(() => {
    if (!isOpen) return;
    
    const refreshPrices = async () => {
      for (const stock of stocks) {
        try {
          const info = await fetchCompanyInfo(stock.symbol);
          if (info) {
            setStocks(prev => prev.map(s => 
              s.symbol === stock.symbol 
                ? { 
                    ...s, 
                    price: info.priceUSD ?? s.price,
                    change: info.changeAbsolute ?? s.change,
                    changePercent: info.changePercent ?? s.changePercent,
                  }
                : s
            ));
          }
        } catch {
          // Ignore
        }
      }
    };

    // Refresh immediately when opened
    refreshPrices();
    
    // Then refresh every 30 seconds while open
    const interval = setInterval(refreshPrices, 30000);
    return () => clearInterval(interval);
  }, [isOpen, stocks.length]);

  // Filter stocks based on search
  const filteredStocks = search 
    ? stocks.filter(s => 
        s.symbol.toLowerCase().includes(search.toLowerCase()) || 
        s.name.toLowerCase().includes(search.toLowerCase())
      )
    : stocks;
    
  const selectedStock = stocks.find(s => s.symbol === selectedSymbol);

  const handleAddStock = useCallback(async () => {
    if (!authState.isAuthenticated) {
      setAddError('Bitte melden Sie sich an');
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
    
    if (stocks.some(s => s.symbol === symbol)) {
      setAddError('Symbol existiert bereits');
      return;
    }
    
    const result = await addCustomSymbolToServer(symbol, newName.trim() || symbol);
    
    if (result.success) {
      setNewSymbol('');
      setNewName('');
      setShowAddForm(false);
      setAddError('');
      // Add to local list
      setStocks(prev => [...prev, { symbol, name: newName.trim() || symbol }]);
      onSelect(symbol); // Select the newly added stock
    } else {
      setAddError(result.error || 'Fehler beim Hinzufügen');
    }
  }, [newSymbol, newName, onSelect, authState.isAuthenticated, stocks]);

  const handleRemoveStock = useCallback(async (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!authState.isAuthenticated) return;
    
    const success = await removeCustomSymbolFromServer(symbol);
    if (success) {
      setStocks(prev => prev.filter(s => s.symbol !== symbol));
      // If removing selected stock, select first available
      if (selectedSymbol === symbol && stocks.length > 1) {
        const remaining = stocks.filter(s => s.symbol !== symbol);
        if (remaining.length > 0) {
          onSelect(remaining[0].symbol);
        }
      }
    }
  }, [selectedSymbol, onSelect, authState.isAuthenticated, stocks]);

  // Calculate freshness data
  const freshnessData = useMemo(() => {
    if (!timestamps) return null;
    void tick; // Force recalculation on tick
    
    const financialAge = getAgeInMs(timestamps.financial);
    const newsAge = getAgeInMs(timestamps.news);
    const mlAge = getAgeInMs(timestamps.mlModel);
    
    const items = [
      { key: 'financial', icon: '📊', age: financialAge, level: getFreshnessLevel(financialAge, THRESHOLDS.financial) },
      { key: 'news', icon: '📰', age: newsAge, level: getFreshnessLevel(newsAge, THRESHOLDS.news) },
      { key: 'ml', icon: '🤖', age: mlAge, level: getFreshnessLevel(mlAge, THRESHOLDS.mlModel) },
    ];
    
    const levels = items.map(i => i.level);
    const overall: FreshnessLevel = levels.includes('old') ? 'old' : 
                                    levels.includes('stale') ? 'stale' : 
                                    levels.includes('unknown') ? 'unknown' : 'fresh';
    
    const ages = items.map(i => i.age).filter((a): a is number => a !== null);
    const oldestAge = ages.length > 0 ? Math.max(...ages) : null;
    
    return { items, overall, oldestAge };
  }, [timestamps, tick]);

  return (
    <div className="relative inline-block">
      {/* Combined Stock Selector Button with integrated Freshness - Mobile Responsive */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 sm:gap-2 bg-slate-800/70 border border-slate-600/50 rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 hover:bg-slate-700/60 hover:border-slate-500/50 hover:shadow-blue-500/10 transition-all duration-300 shadow-xl shadow-black/20 backdrop-blur-md ring-1 ring-white/5 max-w-[180px] sm:max-w-none"
      >
        {/* Symbol Icon - smaller on mobile */}
        <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs sm:text-sm flex-shrink-0">
          {selectedSymbol.charAt(0)}
        </div>
        
        {/* Symbol & Price Info */}
        <div className="text-left min-w-0 flex-1">
          <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
            <span className="text-white font-semibold text-xs sm:text-sm truncate">{selectedSymbol}</span>
            {/* Price - show on mobile but smaller */}
            {selectedStock?.price !== undefined && (
              <span className="text-white font-bold text-xs sm:text-sm">
                {formatPrice(selectedStock.price)}
              </span>
            )}
            {/* Change percent - hidden on mobile */}
            {selectedStock?.changePercent !== undefined && (
              <span className={`hidden md:inline text-xs font-medium px-1 py-0.5 rounded ${selectedStock.changePercent >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {selectedStock.changePercent >= 0 ? '+' : ''}{selectedStock.changePercent.toFixed(1)}%
              </span>
            )}
          </div>
        </div>

        {/* Freshness Indicator - hidden on mobile, compact on tablet+ */}
        {freshnessData && (
          <div className={`hidden md:flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-xs ${freshnessData.overall === 'fresh' ? 'bg-green-500/10' : freshnessData.overall === 'stale' ? 'bg-yellow-500/10' : freshnessData.overall === 'old' ? 'bg-red-500/10' : 'bg-slate-700/50'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${freshnessData.overall === 'fresh' ? 'bg-green-400' : freshnessData.overall === 'stale' ? 'bg-yellow-400' : freshnessData.overall === 'old' ? 'bg-red-400' : 'bg-gray-400'}`} />
            <span className={`font-medium ${FRESHNESS_COLORS[freshnessData.overall]}`}>
              {formatAge(freshnessData.oldestAge)}
            </span>
          </div>
        )}
        
        {/* Dropdown Arrow */}
        <svg className={`w-3 h-3 sm:w-4 sm:h-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 mt-2 w-auto min-w-[280px] sm:w-[400px] max-w-[400px] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
            
            {/* Freshness Details Section - hidden on mobile for more space */}
            {freshnessData && onRefresh && (
              <div className="hidden sm:block p-2 sm:p-3 border-b border-slate-700 bg-slate-900/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-400">Daten-Aktualität</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRefresh(); }}
                    disabled={isRefreshing}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    {isRefreshing ? (
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                    Aktualisieren
                  </button>
                </div>
                <div className="flex gap-2">
                  {freshnessData.items.map((item) => (
                    <div key={item.key} className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg ${FRESHNESS_COLORS[item.level] === 'text-green-400' ? 'bg-green-500/10' : FRESHNESS_COLORS[item.level] === 'text-yellow-400' ? 'bg-yellow-500/10' : FRESHNESS_COLORS[item.level] === 'text-red-400' ? 'bg-red-500/10' : 'bg-slate-700/50'}`}>
                      <span className="text-sm">{item.icon}</span>
                      <div className="flex flex-col">
                        <span className="text-[10px] text-gray-500">{item.key === 'financial' ? 'Kurse' : item.key === 'news' ? 'News' : 'ML'}</span>
                        <span className={`text-xs font-medium ${FRESHNESS_COLORS[item.level]}`}>{formatAge(item.age)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Search - more compact on mobile */}
            <div className="p-2 sm:p-3 border-b border-slate-700">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Symbol suchen..."
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 text-white text-base sm:text-sm placeholder-gray-400 focus:outline-none focus:border-blue-500"
                autoFocus
              />
            </div>
            
            {/* Stock List */}
            <div className="max-h-[400px] sm:max-h-[350px] overflow-y-auto">
                {isLoading ? (
                  <div className="p-4 text-center text-gray-400">Lade...</div>
                ) : filteredStocks.length === 0 ? (
                  <div className="p-4 text-center text-gray-400">
                    {search ? 'Keine Treffer' : 'Keine Symbole'}
                  </div>
                ) : (
                  filteredStocks.map((stock) => (
                    <button
                      key={stock.symbol}
                      onClick={() => {
                        onSelect(stock.symbol);
                        setIsOpen(false);
                        setSearch('');
                      }}
                      className={`w-full px-2 sm:px-4 py-2 sm:py-3 hover:bg-slate-700/50 transition-colors ${
                        stock.symbol === selectedSymbol ? 'bg-blue-500/20' : ''
                      }`}
                    >
                      {/* Mobile: Compact single-line layout */}
                      <div className="sm:hidden flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                          {stock.symbol.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-white font-semibold text-sm">{stock.symbol}</span>
                            {stock.price !== undefined && (
                              <span className="text-gray-400 text-xs">{formatPrice(stock.price)}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {stock.changePercent !== undefined && (
                              <span className={`text-[10px] font-medium px-1 py-0.5 rounded ${
                                stock.changePercent >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                              }`}>
                                {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(1)}%
                              </span>
                            )}
                            {authState.isAuthenticated && (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => handleRemoveStock(stock.symbol, e)}
                                onKeyDown={(e) => e.key === 'Enter' && handleRemoveStock(stock.symbol, e as unknown as React.MouseEvent)}
                                className="p-0.5 hover:bg-red-500/20 rounded text-gray-500 hover:text-red-400 transition-colors cursor-pointer"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </span>
                            )}
                            {stock.symbol === selectedSymbol && (
                              <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {/* Desktop: Full detailed layout */}
                      <div className="hidden sm:flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                          {stock.symbol.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* Row 1: Symbol, Name, Price, Change */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-white font-semibold">{stock.symbol}</span>
                              <span className="text-gray-400 text-sm truncate" title={stock.fullName || stock.name}>
                                {stock.fullName || stock.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {stock.price !== undefined && (
                                <span className="text-white font-medium">{formatPrice(stock.price)}</span>
                              )}
                              {stock.changePercent !== undefined && (
                                <span className={`text-sm font-medium px-1.5 py-0.5 rounded ${
                                  stock.changePercent >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                                }`}>
                                  {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                                </span>
                              )}
                            </div>
                          </div>
                          
                          {/* Row 2: Market Cap, P/E, Volume */}
                          <div className="flex items-center gap-3 mt-1 text-xs">
                            {stock.marketCap !== undefined && stock.marketCap > 0 && (
                              <span className="text-gray-500">
                                <span className="text-gray-600">MCap:</span> {formatCompactNumber(stock.marketCap)}
                              </span>
                            )}
                            {stock.peRatio !== undefined && stock.peRatio > 0 && (
                              <span className="text-gray-500">
                                <span className="text-gray-600">P/E:</span> {stock.peRatio.toFixed(1)}
                              </span>
                            )}
                            {stock.volume !== undefined && stock.volume > 0 && (
                              <span className="text-gray-500">
                                <span className="text-gray-600">Vol:</span> {formatCompactNumber(stock.volume)}
                              </span>
                            )}
                          </div>
                          
                          {/* Row 3: 52-Week Range Bar */}
                          {stock.fiftyTwoWeekLow !== undefined && stock.fiftyTwoWeekHigh !== undefined && stock.price !== undefined && (
                            <div className="mt-2">
                              <div className="flex items-center gap-2 text-xs">
                                <span className="text-gray-600 w-14 text-right">{formatPrice(stock.fiftyTwoWeekLow)}</span>
                                <div className="flex-1 h-1.5 bg-slate-700 rounded-full relative">
                                  <div 
                                    className="absolute h-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full opacity-30"
                                    style={{ width: '100%' }}
                                  />
                                  <div 
                                    className="absolute w-2 h-2 bg-white rounded-full -top-0.5 shadow-lg border border-slate-600"
                                    style={{ left: `calc(${get52WeekPosition(stock.price, stock.fiftyTwoWeekLow, stock.fiftyTwoWeekHigh)}% - 4px)` }}
                                  />
                                </div>
                                <span className="text-gray-600 w-14">{formatPrice(stock.fiftyTwoWeekHigh)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {authState.isAuthenticated && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => handleRemoveStock(stock.symbol, e)}
                              onKeyDown={(e) => e.key === 'Enter' && handleRemoveStock(stock.symbol, e as unknown as React.MouseEvent)}
                              className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400 transition-colors cursor-pointer"
                              title="Entfernen"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </span>
                          )}
                          {stock.symbol === selectedSymbol && (
                            <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            
            {/* Add Stock Section - only for authenticated users */}
            {authState.isAuthenticated && (
              <div className="border-t border-slate-700 p-3">
                {!showAddForm ? (
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-slate-700/50 hover:bg-slate-700 rounded-lg text-gray-300 hover:text-white transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Symbol hinzufügen
                  </button>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newSymbol}
                      onChange={(e) => {
                        setNewSymbol(e.target.value.toUpperCase());
                        setAddError('');
                      }}
                      placeholder="Symbol (z.B. BTC)"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-base sm:text-sm"
                      autoFocus
                      maxLength={10}
                    />
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Name (optional)"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-base sm:text-sm"
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
                        onClick={handleAddStock}
                        className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition-colors"
                      >
                        Hinzufügen
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {/* Info for non-authenticated */}
            {!authState.isAuthenticated && (
              <div className="border-t border-slate-700 p-3">
                <p className="text-gray-400 text-xs text-center">
                  Anmelden, um eigene Symbole zu verwalten
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
