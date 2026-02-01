/**
 * AITraderWeightHistoryChart - Visualizes how signal weights changed over time
 */

import { useState, useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';

interface WeightHistoryEntry {
  timestamp: string;
  weights?: {
    ml: number;
    rl: number;
    sentiment: number;
    technical: number;
  };
  // DB format
  new_weights?: {
    ml: number;
    rl: number;
    sentiment: number;
    technical: number;
  };
  old_weights?: {
    ml: number;
    rl: number;
    sentiment: number;
    technical: number;
  };
  reason?: string;
  accuracy_snapshot?: Record<string, number>;
  accuracy?: {
    ml?: number;
    rl?: number;
    sentiment?: number;
    technical?: number;
  };
}

interface AITraderWeightHistoryChartProps {
  traderId: number;
  className?: string;
}

export function AITraderWeightHistoryChart({ traderId, className = '' }: AITraderWeightHistoryChartProps) {
  const { } = useSettings();
  const [history, setHistory] = useState<WeightHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const response = await fetch(`/api/ai-traders/${traderId}/weight-history`);
        if (!response.ok) {
          throw new Error('Fehler beim Laden der Gewichtungshistorie');
        }
        const data = await response.json();
        // Backend returns either { history: [...] } or raw array
        const historyData = Array.isArray(data) ? data : (data.history || []);
        setHistory(historyData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [traderId]);

  if (loading) {
    return (
      <div className={`bg-slate-800/50 rounded-xl p-5 border border-slate-700 ${className}`}>
        <div className="text-center py-8">
          <div className="animate-spin text-3xl mb-3">⟳</div>
          <p className="text-gray-400">Lade Gewichtungshistorie...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-slate-800/50 rounded-xl p-5 border border-slate-700 ${className}`}>
        <div className="text-center py-8">
          <div className="text-3xl mb-3">⚠️</div>
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className={`bg-slate-800/50 rounded-xl p-5 border border-slate-700 ${className}`}>
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <span>📊</span>
          Gewichtungsverlauf
        </h3>
        <div className="text-center py-8 text-gray-400">
          <div className="text-3xl mb-3">📭</div>
          <p>Noch keine Gewichtungsänderungen aufgezeichnet</p>
        </div>
      </div>
    );
  }

  const colors = {
    ml: '#3B82F6',      // blue
    rl: '#10B981',      // green
    sentiment: '#F59E0B', // amber
    technical: '#8B5CF6', // purple
  };

  const labels = {
    ml: 'ML Prognose',
    rl: 'RL Advisor',
    sentiment: 'Sentiment',
    technical: 'Technisch',
  };

  // Get the max value for scaling
  const maxWeight = 1.0;

  // Calculate chart dimensions
  const chartHeight = 200;

  return (
    <div className={`bg-slate-800/50 rounded-xl p-5 border border-slate-700 ${className}`}>
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
        <span>📊</span>
        Gewichtungsverlauf
      </h3>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-4">
        {Object.entries(labels).map(([key, label]) => (
          <div key={key} className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: colors[key as keyof typeof colors] }}
            />
            <span className="text-sm text-gray-400">{label}</span>
          </div>
        ))}
      </div>

      {/* Simple Bar Chart */}
      <div className="overflow-x-auto">
        <div className="flex gap-2 min-w-fit pb-4">
          {history.slice(-10).map((entry, idx) => {
            // Support both formats: weights or new_weights from DB
            const weights = entry.weights || entry.new_weights || { ml: 0.25, rl: 0.25, sentiment: 0.25, technical: 0.25 };
            const date = new Date(entry.timestamp);
            
            return (
              <div key={idx} className="flex flex-col items-center" style={{ minWidth: '80px' }}>
                {/* Stacked Bar */}
                <div 
                  className="w-12 flex flex-col-reverse rounded-t overflow-hidden"
                  style={{ height: `${chartHeight}px` }}
                >
                  {Object.entries(weights).map(([key, value]) => (
                    <div
                      key={key}
                      className="w-full transition-all duration-300"
                      style={{
                        height: `${((value || 0) / maxWeight) * 25}%`,
                        backgroundColor: colors[key as keyof typeof colors],
                      }}
                      title={`${labels[key as keyof typeof labels]}: ${((value || 0) * 100).toFixed(0)}%`}
                    />
                  ))}
                </div>
                
                {/* Date Label */}
                <div className="text-xs text-gray-500 mt-2 text-center">
                  {date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Current Weights Table */}
      {history.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-700">
          <h4 className="text-sm font-medium text-gray-400 mb-3">Aktuelle Gewichtung</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(history[history.length - 1].weights || history[history.length - 1].new_weights || {}).map(([key, value]) => (
              <div key={key} className="bg-slate-700/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <div 
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: colors[key as keyof typeof colors] }}
                  />
                  <span className="text-xs text-gray-400">{labels[key as keyof typeof labels]}</span>
                </div>
                <div className="text-lg font-bold">{((value || 0) * 100).toFixed(0)}%</div>
              </div>
            ))}
          </div>

          {/* Last change reason */}
          {history[history.length - 1].reason && (
            <div className="mt-3 p-3 bg-slate-700/30 rounded-lg">
              <span className="text-xs text-gray-400">Letzte Anpassung: </span>
              <span className="text-sm">{history[history.length - 1].reason}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
