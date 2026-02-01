/**
 * HistoricalDataPage - Historical Price Data Management
 * Shows available symbols, data availability, and allows data refresh
 */

import { getAuthState, getAuthHeaders } from '../services/authService';
import { useState, useEffect, useCallback } from 'react';

interface SymbolAvailability {
  symbol: string;
  available: boolean;
  recordCount?: number;
  startDate?: string;
  endDate?: string;
  lastRefresh?: string;
  status: 'available' | 'partial' | 'missing' | 'error';
}

interface AvailableSymbol {
  symbol: string;
  name?: string;
  recordCount: number;
  dateRange?: {
    start: string;
    end: string;
  };
}

export function HistoricalDataPage() {
  const authState = getAuthState();
  const user = authState.user;
  
  const [availableSymbols, setAvailableSymbols] = useState<AvailableSymbol[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [searchSymbol, setSearchSymbol] = useState('');
  const [checkResult, setCheckResult] = useState<SymbolAvailability | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);

  const fetchAvailableSymbols = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/historical-prices/symbols/available');
      if (response.ok) {
        const data = await response.json();
        setAvailableSymbols(data.symbols || []);
      }
    } catch (error) {
      console.error('Failed to fetch available symbols:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAvailableSymbols();
  }, [fetchAvailableSymbols]);

  const checkSymbolAvailability = async () => {
    if (!searchSymbol.trim()) return;
    
    setCheckLoading(true);
    setCheckResult(null);
    
    try {
      const response = await fetch(`/api/historical-prices/${encodeURIComponent(searchSymbol.toUpperCase())}/availability`);
      if (response.ok) {
        const data = await response.json();
        setCheckResult({
          symbol: searchSymbol.toUpperCase(),
          available: data.available,
          recordCount: data.recordCount,
          startDate: data.startDate,
          endDate: data.endDate,
          status: data.available 
            ? (data.recordCount > 200 ? 'available' : 'partial')
            : 'missing',
        });
      } else {
        setCheckResult({
          symbol: searchSymbol.toUpperCase(),
          available: false,
          status: 'missing',
        });
      }
    } catch (error) {
      setCheckResult({
        symbol: searchSymbol.toUpperCase(),
        available: false,
        status: 'error',
      });
    } finally {
      setCheckLoading(false);
    }
  };

  const refreshSymbolData = async (symbol: string) => {
    if (!user) {
      alert('Bitte einloggen um Daten zu aktualisieren');
      return;
    }
    
    setRefreshing(prev => ({ ...prev, [symbol]: true }));
    
    // Default: last 1 year of data
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    try {
      const response = await fetch(`/api/historical-prices/${encodeURIComponent(symbol)}/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ startDate, endDate }),
      });
      
      if (response.ok) {
        // Refresh the list
        await fetchAvailableSymbols();
        
        // If this was from a search, update the check result
        if (checkResult?.symbol === symbol) {
          await checkSymbolAvailability();
        }
      }
    } catch (error) {
      console.error(`Failed to refresh ${symbol}:`, error);
    } finally {
      setRefreshing(prev => ({ ...prev, [symbol]: false }));
    }
  };

  const getStatusBadge = (status: string, recordCount?: number) => {
    switch (status) {
      case 'available':
        return (
          <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs flex items-center gap-1">
            ✅ Vollständig
            {recordCount && <span className="text-gray-400">({recordCount})</span>}
          </span>
        );
      case 'partial':
        return (
          <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs flex items-center gap-1">
            ⚠️ Teilweise
            {recordCount && <span className="text-gray-400">({recordCount})</span>}
          </span>
        );
      case 'missing':
        return (
          <span className="px-2 py-1 bg-gray-500/20 text-gray-400 rounded text-xs">
            📭 Nicht vorhanden
          </span>
        );
      default:
        return (
          <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs">
            ❌ Fehler
          </span>
        );
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('de-DE');
  };

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-3">
            <span className="text-3xl">📊</span>
            Historische Daten
          </h1>
          <p className="text-gray-400 mt-1">
            Verwalte historische Kursdaten für Backtesting und ML-Training
          </p>
        </div>
        
        <button
          onClick={fetchAvailableSymbols}
          disabled={loading}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 rounded-lg transition-colors flex items-center gap-2"
        >
          {loading ? <span className="animate-spin">⟳</span> : <span>🔄</span>}
          Aktualisieren
        </button>
      </div>

      {/* Search / Check Symbol */}
      <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700 mb-6">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <span>🔍</span>
          Symbol prüfen
        </h2>
        
        <div className="flex gap-3 mb-4">
          <input
            type="text"
            value={searchSymbol}
            onChange={(e) => setSearchSymbol(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && checkSymbolAvailability()}
            placeholder="Symbol eingeben (z.B. AAPL, MSFT)"
            className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={checkSymbolAvailability}
            disabled={checkLoading || !searchSymbol.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {checkLoading ? '⟳' : '🔍'} Prüfen
          </button>
        </div>

        {/* Check Result */}
        {checkResult && (
          <div className={`rounded-lg p-4 ${
            checkResult.status === 'available' 
              ? 'bg-green-500/10 border border-green-500/30'
              : checkResult.status === 'partial'
                ? 'bg-yellow-500/10 border border-yellow-500/30'
                : 'bg-slate-700/50'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-xl font-bold">{checkResult.symbol}</span>
                {getStatusBadge(checkResult.status, checkResult.recordCount)}
              </div>
              
              {user && (
                <button
                  onClick={() => refreshSymbolData(checkResult.symbol)}
                  disabled={refreshing[checkResult.symbol]}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 rounded-lg text-sm transition-colors flex items-center gap-2"
                >
                  {refreshing[checkResult.symbol] ? (
                    <span className="animate-spin">⟳</span>
                  ) : (
                    <span>📥</span>
                  )}
                  {checkResult.available ? 'Aktualisieren' : 'Herunterladen'}
                </button>
              )}
            </div>
            
            {checkResult.available && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-gray-400">Datenpunkte:</span>
                  <span className="ml-2 font-medium">{checkResult.recordCount?.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-gray-400">Von:</span>
                  <span className="ml-2 font-medium">{formatDate(checkResult.startDate)}</span>
                </div>
                <div>
                  <span className="text-gray-400">Bis:</span>
                  <span className="ml-2 font-medium">{formatDate(checkResult.endDate)}</span>
                </div>
              </div>
            )}
            
            {!checkResult.available && (
              <p className="text-sm text-gray-400">
                Keine historischen Daten für dieses Symbol vorhanden. 
                {user ? ' Klicke "Herunterladen" um Daten zu laden.' : ' Bitte einloggen um Daten zu laden.'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Available Symbols List */}
      <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <span>📁</span>
          Verfügbare Daten
          <span className="text-sm font-normal text-gray-400">
            ({availableSymbols.length} Symbole)
          </span>
        </h2>

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin text-4xl mb-4">⟳</div>
            <p className="text-gray-400">Lade verfügbare Symbole...</p>
          </div>
        ) : availableSymbols.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <div className="text-5xl mb-4">📭</div>
            <h3 className="text-xl font-bold mb-2">Noch keine Daten vorhanden</h3>
            <p>Suche nach einem Symbol oben und lade historische Daten herunter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-slate-700">
                  <th className="pb-3 font-semibold">Symbol</th>
                  <th className="pb-3 font-semibold">Datenpunkte</th>
                  <th className="pb-3 font-semibold">Zeitraum</th>
                  <th className="pb-3 font-semibold">Status</th>
                  <th className="pb-3 font-semibold text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {availableSymbols.map((symbol) => (
                  <tr key={symbol.symbol} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="py-3">
                      <span className="font-bold">{symbol.symbol}</span>
                      {symbol.name && (
                        <span className="text-sm text-gray-400 ml-2">{symbol.name}</span>
                      )}
                    </td>
                    <td className="py-3">
                      {symbol.recordCount.toLocaleString()}
                    </td>
                    <td className="py-3 text-sm text-gray-400">
                      {symbol.dateRange 
                        ? `${formatDate(symbol.dateRange.start)} - ${formatDate(symbol.dateRange.end)}`
                        : 'N/A'
                      }
                    </td>
                    <td className="py-3">
                      {getStatusBadge(
                        symbol.recordCount > 200 ? 'available' : 'partial',
                        undefined
                      )}
                    </td>
                    <td className="py-3 text-right">
                      {user && (
                        <button
                          onClick={() => refreshSymbolData(symbol.symbol)}
                          disabled={refreshing[symbol.symbol]}
                          className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 rounded text-sm transition-colors"
                        >
                          {refreshing[symbol.symbol] ? (
                            <span className="animate-spin">⟳</span>
                          ) : (
                            '🔄'
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="mt-6 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-2">
          <span>ℹ️</span>
          Hinweis
        </h3>
        <ul className="text-sm text-gray-300 space-y-1">
          <li>• Historische Daten werden für Backtesting und ML-Training verwendet</li>
          <li>• Die Daten werden von Yahoo Finance geladen (täglich aktualisiert)</li>
          <li>• Für optimales ML-Training werden mindestens 250 Datenpunkte empfohlen</li>
          <li>• Das Aktualisieren von Daten kann einige Sekunden dauern</li>
        </ul>
      </div>
    </div>
  );
}
