/**
 * ForexWidget - Small widget showing EUR/USD exchange rate
 * Can be placed in navbar or dashboard
 */

import { useState, useEffect, useCallback } from 'react';

interface ForexRate {
  pair: string;
  rate: number;
  change?: number;
  changePercent?: number;
  lastUpdate?: string;
}

interface ForexWidgetProps {
  compact?: boolean;
  className?: string;
}

export function ForexWidget({ compact = false, className = '' }: ForexWidgetProps) {
  const [forex, setForex] = useState<ForexRate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchForex = useCallback(async () => {
    try {
      const response = await fetch('/api/forex/eurusd');
      if (response.ok) {
        const data = await response.json();
        setForex({
          pair: 'EUR/USD',
          rate: data.rate || data.price,
          change: data.change,
          changePercent: data.changePercent,
          lastUpdate: new Date().toISOString(),
        });
        setError(false);
      } else {
        setError(true);
      }
    } catch (err) {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchForex();
    const interval = setInterval(fetchForex, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [fetchForex]);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 bg-slate-700/50 rounded-lg ${className}`}>
        <span className="animate-pulse">💱</span>
        <span className="text-sm text-gray-400">...</span>
      </div>
    );
  }

  if (error || !forex) {
    return (
      <div 
        className={`flex items-center gap-2 px-3 py-1.5 bg-slate-700/50 rounded-lg cursor-pointer hover:bg-slate-600/50 ${className}`}
        onClick={fetchForex}
        title="Klicken zum Aktualisieren"
      >
        <span>💱</span>
        <span className="text-sm text-gray-500">EUR/USD --</span>
      </div>
    );
  }

  const isPositive = (forex.changePercent ?? 0) >= 0;

  if (compact) {
    return (
      <div 
        className={`flex items-center gap-2 px-3 py-1.5 bg-slate-700/50 rounded-lg cursor-pointer hover:bg-slate-600/50 transition-colors ${className}`}
        onClick={fetchForex}
        title={`EUR/USD: ${forex.rate.toFixed(4)}${forex.changePercent !== undefined ? ` (${isPositive ? '+' : ''}${forex.changePercent.toFixed(2)}%)` : ''}\nKlicken zum Aktualisieren`}
      >
        <span>💱</span>
        <span className="text-sm font-medium">{forex.rate.toFixed(4)}</span>
        {forex.changePercent !== undefined && (
          <span className={`text-xs ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
            {isPositive ? '▲' : '▼'}
          </span>
        )}
      </div>
    );
  }

  return (
    <div 
      className={`bg-slate-800/50 rounded-xl p-4 border border-slate-700 ${className}`}
      onClick={fetchForex}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">💱</span>
          <span className="font-semibold">{forex.pair}</span>
        </div>
        <button 
          onClick={(e) => { e.stopPropagation(); fetchForex(); }}
          className="text-gray-400 hover:text-white transition-colors"
          title="Aktualisieren"
        >
          🔄
        </button>
      </div>
      
      <div className="flex items-end gap-3">
        <span className="text-2xl font-bold">{forex.rate.toFixed(4)}</span>
        {forex.changePercent !== undefined && (
          <span className={`text-sm font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
            {isPositive ? '+' : ''}{forex.changePercent.toFixed(2)}%
          </span>
        )}
      </div>

      {forex.lastUpdate && (
        <p className="text-xs text-gray-500 mt-2">
          Stand: {new Date(forex.lastUpdate).toLocaleTimeString('de-DE')}
        </p>
      )}
    </div>
  );
}
