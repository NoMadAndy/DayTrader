/**
 * Adaptive Weights Panel Component
 * 
 * Displays current signal weights, history of adjustments, and learning status.
 */

import { useEffect, useState } from 'react';
import { getWeightHistory } from '../services/aiTraderService';
import type { AITrader, WeightHistoryEntry, AITraderSignalWeights } from '../types/aiTrader';
import { log } from '../utils/logger';

interface AdaptiveWeightsPanelProps {
  trader: AITrader;
}

export default function AdaptiveWeightsPanel({ trader }: AdaptiveWeightsPanelProps) {
  const [history, setHistory] = useState<WeightHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setLoading(true);
        const data = await getWeightHistory(trader.id, 10);
        setHistory(data);
      } catch (error) {
        log.error('Error fetching weight history:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [trader.id]);

  const currentWeights = trader.personality?.signals?.weights || {
    ml: 0.25,
    rl: 0.25,
    sentiment: 0.25,
    technical: 0.25,
  };

  const learningEnabled = trader.personality?.learning?.enabled || false;
  const autoAdjust = trader.personality?.learning?.updateWeights || false;

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(0)}%`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('de-DE', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const getWeightColor = (weight: number) => {
    if (weight > 0.35) return 'bg-green-500';
    if (weight > 0.25) return 'bg-blue-500';
    if (weight > 0.15) return 'bg-yellow-500';
    return 'bg-gray-500';
  };

  const signals: Array<{ key: keyof AITraderSignalWeights; label: string; color: string }> = [
    { key: 'ml', label: 'ML', color: 'text-blue-600 dark:text-blue-400' },
    { key: 'rl', label: 'RL', color: 'text-purple-600 dark:text-purple-400' },
    { key: 'sentiment', label: 'Sentiment', color: 'text-green-600 dark:text-green-400' },
    { key: 'technical', label: 'Technical', color: 'text-orange-600 dark:text-orange-400' },
  ];

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 p-6 rounded-lg shadow-lg">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xl font-bold">Signal Weights</h3>
          {learningEnabled && (
            <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs font-semibold rounded-full">
              🧠 Learning Mode
            </span>
          )}
        </div>
        {autoAdjust && (
          <p className="text-sm text-gray-400">
            Weights adjust automatically based on signal accuracy
          </p>
        )}
      </div>

      {/* Current Weights */}
      <div className="mb-6">
        <h4 className="font-semibold mb-4">Current Weights</h4>
        <div className="space-y-4">
          {signals.map((signal) => {
            const weight = currentWeights[signal.key];
            return (
              <div key={signal.key}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-medium ${signal.color}`}>{signal.label}</span>
                  <span className="text-lg font-bold">{formatPercent(weight)}</span>
                </div>
                <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getWeightColor(weight)} transition-all duration-300`}
                    style={{ width: formatPercent(weight) }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Weight History */}
      {history.length > 0 && (
        <div className="mb-6">
          <h4 className="font-semibold mb-4">Adjustment History</h4>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="p-3 bg-slate-900/50 rounded-lg border border-slate-700"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{formatDate(entry.timestamp)}</span>
                  <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded">
                    {entry.reason === 'adaptive_learning' ? '🤖 Auto' : '✋ Manual'}
                  </span>
                </div>
                
                <div className="grid grid-cols-4 gap-2 text-xs">
                  {signals.map((signal) => {
                    const oldWeight = entry.oldWeights[signal.key];
                    const newWeight = entry.newWeights[signal.key];
                    const change = newWeight - oldWeight;
                    
                    return (
                      <div key={signal.key} className="text-center">
                        <div className="text-gray-400">{signal.label}</div>
                        <div className="font-mono">
                          {formatPercent(oldWeight)}
                          {change !== 0 && (
                            <span className={change > 0 ? 'text-green-600' : 'text-red-600'}>
                              {' → '}
                              {formatPercent(newWeight)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Learning Settings Info */}
      {!learningEnabled && (
        <div className="p-4 bg-slate-700/50 rounded-lg border border-slate-600">
          <p className="text-sm text-gray-300">
            💡 Aktiviere den Learning-Modus in den Trader-Einstellungen (⚙️), um Gewichtungen automatisch basierend auf der Signal-Performance anzupassen.
          </p>
        </div>
      )}

      {loading && history.length === 0 && (
        <div className="text-center text-gray-500 py-4">
          Loading history...
        </div>
      )}
    </div>
  );
}
