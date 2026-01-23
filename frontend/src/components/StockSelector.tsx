import { useState, useCallback } from 'react';
import { getAvailableStocks, searchStocks, addCustomStock, removeCustomStock, stockExists } from '../utils/mockData';

interface StockSelectorProps {
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
}

export function StockSelector({ selectedSymbol, onSelect }: StockSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [stocksVersion, setStocksVersion] = useState(0); // Force re-render when stocks change
  
  // Include stocksVersion in calculation to trigger re-render when stocks change
  const stocks = stocksVersion >= 0 ? (search ? searchStocks(search) : getAvailableStocks()) : [];
  const selectedStock = getAvailableStocks().find(s => s.symbol === selectedSymbol);

  const handleAddStock = useCallback(() => {
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
      setStocksVersion(v => v + 1); // Trigger re-render
      onSelect(symbol); // Select the newly added stock
    } else {
      setAddError('Fehler beim Hinzufügen');
    }
  }, [newSymbol, newName, onSelect]);

  const handleRemoveStock = useCallback((symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (removeCustomStock(symbol)) {
      setStocksVersion(v => v + 1);
      // If removing selected stock, select first available
      if (selectedSymbol === symbol) {
        const remaining = getAvailableStocks();
        if (remaining.length > 0) {
          onSelect(remaining[0].symbol);
        }
      }
    }
  }, [selectedSymbol, onSelect]);

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
          <div className="text-gray-400 text-sm truncate max-w-[120px]">{selectedStock?.name}</div>
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
                placeholder="Search stocks..."
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {stocks.map((stock) => (
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
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                    stock.isCustom 
                      ? 'bg-gradient-to-br from-green-500 to-teal-600' 
                      : 'bg-gradient-to-br from-blue-500 to-purple-600'
                  }`}>
                    {stock.symbol.charAt(0)}
                  </div>
                  <div className="text-left flex-1">
                    <div className="text-white font-medium flex items-center gap-2">
                      {stock.symbol}
                      {stock.isCustom && (
                        <span className="text-xs text-green-400 bg-green-500/20 px-1.5 py-0.5 rounded">Custom</span>
                      )}
                    </div>
                    <div className="text-gray-400 text-sm truncate">{stock.name}</div>
                  </div>
                  {stock.isCustom && (
                    <button
                      onClick={(e) => handleRemoveStock(stock.symbol, e)}
                      className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400 transition-colors"
                      title="Entfernen"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                  {stock.symbol === selectedSymbol && !stock.isCustom && (
                    <svg className="w-5 h-5 text-blue-500 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
            
            {/* Add Stock Section */}
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
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-green-500 text-sm"
                    autoFocus
                    maxLength={10}
                  />
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Name (optional)"
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-green-500 text-sm"
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
                      className="flex-1 py-2 px-3 bg-green-600 hover:bg-green-500 rounded-lg text-white text-sm font-medium transition-colors"
                    >
                      Hinzufügen
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
