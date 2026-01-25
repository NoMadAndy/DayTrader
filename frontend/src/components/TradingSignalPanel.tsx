/**
 * Trading Signal Summary Component
 * 
 * Displays aggregated trading signals for different holding periods
 * combining news sentiment, technical indicators, and ML predictions.
 */

import { useMemo } from 'react';
import { 
  calculateCombinedTradingSignals, 
  getSignalDisplay, 
  getTimePeriodLabel,
  type TradingSignal,
  type CombinedSignalInput,
  type SignalContribution
} from '../utils/tradingSignals';
import type { SentimentResult } from '../utils/sentimentAnalysis';
import type { ForecastResult, OHLCV } from '../types/stock';

// ML Prediction Interface
interface MLPrediction {
  date: string;
  day: number;
  predicted_price: number;
  confidence: number;
  change_pct: number;
}

interface TradingSignalPanelProps {
  newsItems: Array<{
    sentimentResult: SentimentResult;
    datetime: number;
  }>;
  symbol: string;
  className?: string;
  // Neue Props für kombinierte Analyse
  forecast?: ForecastResult;
  stockData?: OHLCV[];
  mlPredictions?: MLPrediction[];
  currentPrice?: number;
}

function SignalCard({ 
  period, 
  signal,
  contributions
}: { 
  period: 'hourly' | 'daily' | 'weekly' | 'longTerm'; 
  signal: TradingSignal;
  contributions?: SignalContribution[];
}) {
  const periodInfo = getTimePeriodLabel(period);
  const display = getSignalDisplay(signal.signal);
  
  // Source icons
  const sourceIcon: Record<string, string> = {
    sentiment: '📰',
    technical: '📊',
    ml: '🤖'
  };

  // Agreement styling
  const getAgreementStyle = (agreement: SignalContribution['agreement']) => {
    switch (agreement) {
      case 'strong':
        return {
          border: 'border-green-500/50 border',
          ring: 'ring-1 ring-green-500/30',
          indicator: '●',
          indicatorColor: 'text-green-400',
          tooltip: 'Starke Übereinstimmung'
        };
      case 'moderate':
        return {
          border: '',
          ring: '',
          indicator: '◐',
          indicatorColor: 'text-blue-400',
          tooltip: 'Moderate Übereinstimmung'
        };
      case 'weak':
        return {
          border: 'border-yellow-500/30 border-dashed',
          ring: '',
          indicator: '○',
          indicatorColor: 'text-yellow-400',
          tooltip: 'Schwache Übereinstimmung'
        };
      case 'conflicting':
        return {
          border: 'border-red-500/30 border-dashed',
          ring: '',
          indicator: '⚠',
          indicatorColor: 'text-red-400',
          tooltip: 'Widersprüchliche Signale'
        };
    }
  };
  
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
      
      {/* Contributions breakdown with Agreement */}
      {contributions && contributions.length > 0 && (
        <div className="mt-2 flex gap-1 flex-wrap">
          {contributions.map((contrib, idx) => {
            const agreementStyle = getAgreementStyle(contrib.agreement);
            const weightReduced = contrib.effectiveWeight < contrib.weight * 0.9;
            
            return (
              <span 
                key={idx}
                className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 ${
                  contrib.score >= 20 ? 'bg-green-500/20 text-green-400' :
                  contrib.score <= -20 ? 'bg-red-500/20 text-red-400' :
                  'bg-slate-600/50 text-gray-400'
                } ${agreementStyle.border} ${agreementStyle.ring}`}
                title={`${contrib.description}\nGewicht: ${Math.round(contrib.weight * 100)}%${weightReduced ? ` → ${Math.round(contrib.effectiveWeight * 100)}%` : ''}\n${agreementStyle.tooltip}`}
              >
                {sourceIcon[contrib.source]}
                <span>{contrib.score > 0 ? '+' : ''}{contrib.score}</span>
                <span className={`${agreementStyle.indicatorColor} text-[10px]`} title={agreementStyle.tooltip}>
                  {agreementStyle.indicator}
                </span>
              </span>
            );
          })}
        </div>
      )}
      
      <p className="text-xs text-gray-500 mt-2 line-clamp-2" title={signal.reasoning}>
        {signal.reasoning}
      </p>
    </div>
  );
}

export function TradingSignalPanel({ 
  newsItems, 
  symbol, 
  className = '',
  forecast,
  stockData,
  mlPredictions,
  currentPrice
}: TradingSignalPanelProps) {
  const signals = useMemo(() => {
    const input: CombinedSignalInput = {
      newsItems,
      forecast,
      stockData,
      mlPredictions,
      currentPrice
    };
    return calculateCombinedTradingSignals(input);
  }, [newsItems, forecast, stockData, mlPredictions, currentPrice]);

  // Show panel if we have any data source
  if (newsItems.length === 0 && !forecast && (!mlPredictions || mlPredictions.length === 0)) {
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
        <SignalCard period="hourly" signal={signals.hourly} contributions={signals.contributions?.hourly} />
        <SignalCard period="daily" signal={signals.daily} contributions={signals.contributions?.daily} />
        <SignalCard period="weekly" signal={signals.weekly} contributions={signals.contributions?.weekly} />
        <SignalCard period="longTerm" signal={signals.longTerm} contributions={signals.contributions?.longTerm} />
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-slate-700/50 flex flex-col gap-2 text-xs text-gray-500">
        <div className="flex items-center justify-between">
          <span>
            Datenquellen: {signals.dataSourcesUsed.length > 0 
              ? signals.dataSourcesUsed.map((source, idx) => (
                <span key={idx} className="inline-flex items-center gap-1">
                  {idx > 0 && ', '}
                  <span className="text-blue-400">{source}</span>
                </span>
              ))
              : 'Keine'
            }
          </span>
          {signals.newsCount > 0 && (
            <span>
              Ø Sentiment: {' '}
              <span className={signals.avgSentiment >= 0 ? 'text-green-400' : 'text-red-400'}>
                {signals.avgSentiment >= 0 ? '+' : ''}{(signals.avgSentiment * 100).toFixed(0)}%
              </span>
            </span>
          )}
        </div>
        
        {/* Legend */}
        <div className="flex items-center gap-3 text-gray-600 flex-wrap">
          <span className="text-gray-500">Quellen:</span>
          <span>📰 News</span>
          <span>📊 Technisch</span>
          <span>🤖 ML-Prognose</span>
          <span className="text-gray-500 ml-2">|</span>
          <span className="text-gray-500">Agreement:</span>
          <span className="text-green-400">● stark</span>
          <span className="text-blue-400">◐ moderat</span>
          <span className="text-yellow-400">○ schwach</span>
          <span className="text-red-400">⚠ widerspr.</span>
        </div>
      </div>

      {/* Disclaimer */}
      <p className="mt-2 text-xs text-gray-600 italic">
        ⚠️ Nur zur Information - keine Anlageberatung. Eigene Recherche durchführen.
      </p>
    </div>
  );
}
