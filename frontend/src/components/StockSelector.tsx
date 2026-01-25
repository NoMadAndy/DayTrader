import { useState, useCallback, useEffect } from 'react';
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

interface Stock {
  symbol: string;
  name: string;
  fullName?: string; // Loaded from CompanyInfo
}

interface StockSelectorProps {
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
}

export function StockSelector({ selectedSymbol, onSelect }: StockSelectorProps) {
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
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
      
      // Load full company names in background
      loadedStocks.forEach(async (stock) => {
        try {
          const info = await fetchCompanyInfo(stock.symbol);
          if (info?.name && info.name !== stock.symbol) {
            setStocks(prev => prev.map(s => 
              s.symbol === stock.symbol 
                ? { ...s, fullName: info.name }
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

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 hover:bg-slate-700/50 transition-colors min-w-[200px]"
      >
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold">
          {selectedSymbol.charAt(0)}
        </div>
        <div className="text-left">
          <div className="text-white font-semibold">{selectedSymbol}</div>
          <div className="text-gray-400 text-sm truncate max-w-[120px]" title={selectedStock?.fullName || selectedStock?.name || selectedSymbol}>
            {selectedStock?.fullName || selectedStock?.name || selectedSymbol}
          </div>
        </div>
        <svg className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 mt-2 w-72 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
            <div className="p-3 border-b border-slate-700">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Suchen..."
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto">
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
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-700/50 transition-colors ${
                      stock.symbol === selectedSymbol ? 'bg-blue-500/20' : ''
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                      {stock.symbol.charAt(0)}
                    </div>
                    <div className="text-left flex-1 min-w-0">
                      <div className="text-white font-medium">{stock.symbol}</div>
                      <div className="text-gray-400 text-sm truncate" title={stock.fullName || stock.name}>
                        {stock.fullName || stock.name}
                      </div>
                    </div>
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
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-sm"
                      autoFocus
                      maxLength={10}
                    />
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Name (optional)"
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
