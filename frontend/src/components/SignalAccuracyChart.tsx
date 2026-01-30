/**
 * Signal Accuracy Chart Component
 * 
 * Displays signal accuracy metrics in a visual bar chart format.
 */

import { useEffect, useState } from 'react';
import { getSignalAccuracy } from '../services/aiTraderService';
import type { SignalAccuracyData } from '../types/aiTrader';

interface SignalAccuracyChartProps {
  traderId: number;
  days?: number;
}

export default function SignalAccuracyChart({ traderId, days = 30 }: SignalAccuracyChartProps) {
  const [accuracy, setAccuracy] = useState<SignalAccuracyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAccuracy = async () => {
      try {
        setLoading(true);
        const data = await getSignalAccuracy(traderId, days);
        setAccuracy(data);
      } catch (error) {
        console.error('Error fetching signal accuracy:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAccuracy();
  }, [traderId, days]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4">Signal Accuracy ({days} Days)</h3>
        <div className="text-gray-500">Loading accuracy data...</div>
      </div>
    );
  }

  if (!accuracy) {
    return (
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4">Signal Accuracy ({days} Days)</h3>
        <div className="text-gray-500">No accuracy data available</div>
      </div>
    );
  }

  const signals = [
    { name: 'ML', data: accuracy.ml, color: 'bg-blue-500' },
    { name: 'RL', data: accuracy.rl, color: 'bg-purple-500' },
    { name: 'Sentiment', data: accuracy.sentiment, color: 'bg-green-500' },
    { name: 'Technical', data: accuracy.technical, color: 'bg-orange-500' },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4">Signal Accuracy ({days} Days)</h3>
      
      {/* Overall Accuracy */}
      {accuracy.overall.accuracy !== null && (
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold">Overall Accuracy</span>
            <span className="text-2xl font-bold">
              {(accuracy.overall.accuracy * 100).toFixed(1)}%
            </span>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {accuracy.overall.correct} correct / {accuracy.overall.totalTrades} trades
          </div>
        </div>
      )}

      {/* Individual Signal Accuracy */}
      <div className="space-y-4">
        {signals.map((signal) => (
          <div key={signal.name}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">{signal.name}</span>
              {signal.data.accuracy !== null ? (
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">
                    {(signal.data.accuracy * 100).toFixed(1)}%
                  </span>
                  {signal.data.accuracy > 0.6 ? (
                    <span className="text-green-500">↑</span>
                  ) : signal.data.accuracy < 0.5 ? (
                    <span className="text-red-500">↓</span>
                  ) : (
                    <span className="text-gray-500">→</span>
                  )}
                </div>
              ) : (
                <span className="text-sm text-gray-500">No data</span>
              )}
            </div>
            
            {signal.data.accuracy !== null && (
              <>
                {/* Progress Bar */}
                <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${signal.color} transition-all duration-300`}
                    style={{ width: `${signal.data.accuracy * 100}%` }}
                  />
                </div>
                
                {/* Stats */}
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {signal.data.correct} correct / {signal.data.totalSignals} signals
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="text-xs text-gray-600 dark:text-gray-400">
          <p className="mb-1">
            <span className="text-green-500">↑</span> Accuracy {'>'} 60%
          </p>
          <p className="mb-1">
            <span className="text-red-500">↓</span> Accuracy {'<'} 50%
          </p>
          <p>
            <span className="text-gray-500">→</span> Accuracy 50-60%
          </p>
        </div>
      </div>
    </div>
  );
}
