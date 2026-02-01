/**
 * AI Trader Insights Component
 * 
 * Displays auto-generated insights about trader performance.
 */

import { useEffect, useState } from 'react';
import { getAITraderInsights } from '../services/aiTraderService';

interface AITraderInsightsProps {
  traderId: number;
}

export default function AITraderInsights({ traderId }: AITraderInsightsProps) {
  const [insights, setInsights] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInsights = async () => {
      try {
        setLoading(true);
        const data = await getAITraderInsights(traderId);
        setInsights(data.insights);
      } catch (error) {
        console.error('Error fetching insights:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchInsights();
  }, [traderId]);

  if (loading) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 p-4 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4">🔍 Insights</h3>
        <div className="text-gray-500">Loading insights...</div>
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 p-4 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4">🔍 Insights</h3>
        <div className="text-gray-500">No insights available yet. Keep trading to generate insights!</div>
      </div>
    );
  }

  // Categorize insights by icon
  const getInsightStyle = (insight: string) => {
    if (insight.includes('🎯') || insight.includes('⚡') || insight.includes('📈') || insight.includes('🎉')) {
      return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
    } else if (insight.includes('⚠️') || insight.includes('📉')) {
      return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
    } else if (insight.includes('💡')) {
      return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
    } else if (insight.includes('📰') || insight.includes('📊')) {
      return 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800';
    } else {
      return 'bg-slate-900/50 border-slate-700';
    }
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 p-4 rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4">🔍 Insights & Recommendations</h3>
      
      <div className="space-y-3">
        {insights.map((insight, index) => (
          <div
            key={index}
            className={`p-3 rounded-lg border ${getInsightStyle(insight)} transition-all duration-200 hover:shadow-md`}
          >
            <p className="text-sm leading-relaxed">{insight}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-slate-700">
        <p className="text-xs text-gray-400">
          Insights are automatically generated based on trading performance and signal accuracy.
        </p>
      </div>
    </div>
  );
}
