import { useState } from 'react';
import { getAvailableStocks, searchStocks } from '../utils/mockData';

interface StockSelectorProps {
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
}

export function StockSelector({ selectedSymbol, onSelect }: StockSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  
  const stocks = search ? searchStocks(search) : getAvailableStocks();
  const selectedStock = getAvailableStocks().find(s => s.symbol === selectedSymbol);

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
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                    {stock.symbol.charAt(0)}
                  </div>
                  <div className="text-left">
                    <div className="text-white font-medium">{stock.symbol}</div>
                    <div className="text-gray-400 text-sm truncate">{stock.name}</div>
                  </div>
                  {stock.symbol === selectedSymbol && (
                    <svg className="w-5 h-5 text-blue-500 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
