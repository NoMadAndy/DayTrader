/**
 * AI Trader Insights Component
 * 
 * Displays auto-generated insights about trader performance.
 */

import { useEffect, useState } from 'react';
import { getAITraderInsights } from '../services/aiTraderService';
import { log } from '../utils/logger';

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
        log.error('Error fetching insights:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchInsights();
  }, [traderId]);

  if (loading) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-lg">
        <div className="px-4 py-3 border-b border-slate-700/50">
          <h3 className="text-lg font-bold">🔍 Insights</h3>
        </div>
        <div className="p-4 text-gray-500 text-sm">Lade Insights...</div>
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-lg">
        <div className="px-4 py-3 border-b border-slate-700/50">
          <h3 className="text-lg font-bold">🔍 Insights</h3>
        </div>
        <div className="p-4 text-center text-gray-500">
          <div className="text-2xl mb-2">📊</div>
          <div className="text-sm">Noch keine Insights verfügbar</div>
          <div className="text-xs mt-1">Insights werden generiert sobald genug Trades vorhanden sind</div>
        </div>
      </div>
    );
  }

  // Get insight styling based on icon
  const getInsightStyle = (insight: string) => {
    if (insight.includes('🎯') || insight.includes('⚡') || insight.includes('📈') || insight.includes('🎉') || insight.includes('🏆') || insight.includes('💰')) {
      return 'bg-green-500/10 border-green-500/30 text-green-400';
    } else if (insight.includes('⚠️') || insight.includes('📉')) {
      return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
    } else if (insight.includes('💡')) {
      return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
    } else if (insight.includes('📰') || insight.includes('📊')) {
      return 'bg-purple-500/10 border-purple-500/30 text-purple-400';
    } else if (insight.includes('🧠')) {
      return 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400';
    } else {
      return 'bg-slate-900/50 border-slate-700 text-gray-300';
    }
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-lg">
      <div className="px-4 py-3 border-b border-slate-700/50">
        <h3 className="text-lg font-bold">🔍 Insights & Empfehlungen</h3>
      </div>
      
      <div className="p-3 space-y-2">
        {insights.map((insight, index) => (
          <div
            key={index}
            className={`p-2 rounded-lg border ${getInsightStyle(insight)}`}
          >
            <p className="text-sm">{insight}</p>
          </div>
        ))}
      </div>

      <div className="px-4 py-2 border-t border-slate-700/50">
        <p className="text-xs text-gray-500">
          Automatisch generiert basierend auf Trading-Performance
        </p>
      </div>
    </div>
  );
}
