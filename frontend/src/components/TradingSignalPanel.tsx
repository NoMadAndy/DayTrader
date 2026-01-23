/**
 * Trading Signal Summary Component
 * 
 * Displays aggregated trading signals for different holding periods
 * based on news sentiment analysis.
 */

import { useMemo } from 'react';
import { 
  calculateTradingSignals, 
  getSignalDisplay, 
  getTimePeriodLabel,
  type TradingSignal 
} from '../utils/tradingSignals';
import type { SentimentResult } from '../utils/sentimentAnalysis';

interface TradingSignalPanelProps {
  newsItems: Array<{
    sentimentResult: SentimentResult;
    datetime: number;
  }>;
  symbol: string;
  className?: string;
}

function SignalCard({ 
  period, 
  signal 
}: { 
  period: 'hourly' | 'daily' | 'weekly' | 'longTerm'; 
  signal: TradingSignal;
}) {
  const periodInfo = getTimePeriodLabel(period);
  const display = getSignalDisplay(signal.signal);
  
  return (
    <div className={`p-3 rounded-lg ${display.bgColor} border border-slate-700/50`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">{periodInfo.label}</span>
        <span className={`text-lg ${display.color}`}>{display.emoji}</span>
      </div>
      <div className={`text-sm font-semibold ${display.color}`}>
        {display.labelDe}
      </div>
      <div className="flex items-center gap-2 mt-1">
        <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-300 ${
              signal.score >= 0 ? 'bg-green-500' : 'bg-red-500'
            }`}
            style={{ 
              width: `${Math.abs(signal.score)}%`,
              marginLeft: signal.score >= 0 ? '50%' : `${50 - Math.abs(signal.score)}%`
            }}
          />
        </div>
        <span className="text-xs text-gray-500 w-8 text-right">
          {signal.score > 0 ? '+' : ''}{signal.score}
        </span>
      </div>
      <p className="text-xs text-gray-500 mt-2 line-clamp-2" title={signal.reasoning}>
        {signal.reasoning}
      </p>
    </div>
  );
}

export function TradingSignalPanel({ newsItems, symbol, className = '' }: TradingSignalPanelProps) {
  const signals = useMemo(() => {
    return calculateTradingSignals(newsItems);
  }, [newsItems]);

  if (newsItems.length === 0) {
    return null;
  }

  const biasDisplay = {
    bullish: { emoji: '🐂', label: 'Bullish', color: 'text-green-400' },
    bearish: { emoji: '🐻', label: 'Bearish', color: 'text-red-400' },
    neutral: { emoji: '⚖️', label: 'Neutral', color: 'text-yellow-400' },
  }[signals.overallBias];

  const volatilityDisplay = {
    low: { label: 'Niedrig', color: 'text-green-400' },
    medium: { label: 'Mittel', color: 'text-yellow-400' },
    high: { label: 'Hoch', color: 'text-red-400' },
  }[signals.volatilityIndicator];

  return (
    <div className={`bg-slate-800/50 rounded-xl p-4 border border-slate-700 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h3 className="font-semibold text-white">Trading-Signale für {symbol}</h3>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={biasDisplay.color}>
            {biasDisplay.emoji} {biasDisplay.label}
          </span>
          <span className="text-gray-500">|</span>
          <span className="text-gray-400">
            Volatilität: <span className={volatilityDisplay.color}>{volatilityDisplay.label}</span>
          </span>
        </div>
      </div>

      {/* Signal Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SignalCard period="hourly" signal={signals.hourly} />
        <SignalCard period="daily" signal={signals.daily} />
        <SignalCard period="weekly" signal={signals.weekly} />
        <SignalCard period="longTerm" signal={signals.longTerm} />
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-slate-700/50 flex items-center justify-between text-xs text-gray-500">
        <span>Basiert auf {signals.newsCount} News-Artikeln</span>
        <span>
          Ø Sentiment: {' '}
          <span className={signals.avgSentiment >= 0 ? 'text-green-400' : 'text-red-400'}>
            {signals.avgSentiment >= 0 ? '+' : ''}{(signals.avgSentiment * 100).toFixed(0)}%
          </span>
        </span>
      </div>

      {/* Disclaimer */}
      <p className="mt-2 text-xs text-gray-600 italic">
        ⚠️ Nur zur Information - keine Anlageberatung. Eigene Recherche durchführen.
      </p>
    </div>
  );
}
