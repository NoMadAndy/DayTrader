/**
 * Signal Breakdown Component
 * 
 * Visualizes signal analysis with scores and confidence levels.
 */

import type { SignalAgreement, SignalDetail } from '../types/aiTrader';

interface SignalBreakdownProps {
  signals: {
    ml?: SignalDetail;
    rl?: SignalDetail;
    sentiment?: SignalDetail;
    technical?: SignalDetail;
  };
  aggregation: {
    weightedScore: number;
    threshold: number;
    confidence: number;
    signalAgreement: SignalAgreement;
  };
}

const AGREEMENT_STYLES: Record<SignalAgreement, { indicator: string; color: string; label: string }> = {
  strong: { indicator: '●●●●', color: 'text-green-400', label: 'Stark' },
  moderate: { indicator: '●●●○', color: 'text-blue-400', label: 'Moderat' },
  weak: { indicator: '●●○○', color: 'text-yellow-400', label: 'Schwach' },
  mixed: { indicator: '●○●○', color: 'text-red-400', label: 'Gemischt' },
};

export function SignalBreakdown({ signals, aggregation }: SignalBreakdownProps) {
  const agreementStyle = AGREEMENT_STYLES[aggregation.signalAgreement];
  
  const renderSignalBar = (label: string, signal?: SignalDetail) => {
    if (!signal) return null;
    
    const scorePercent = ((signal.score + 1) / 2) * 100; // Convert -1..1 to 0..100
    const isPositive = signal.score > 0;
    const isNegative = signal.score < 0;
    const isNeutral = Math.abs(signal.score) < 0.1;
    
    const colorClass = isNeutral 
      ? 'bg-gray-500' 
      : isPositive 
        ? 'bg-green-500' 
        : 'bg-red-500';
    
    return (
      <div key={label} className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{label}</span>
          <div className="flex items-center gap-2">
            <span className={isPositive ? 'text-green-400' : isNegative ? 'text-red-400' : 'text-gray-400'}>
              {signal.score > 0 ? '+' : ''}{signal.score.toFixed(2)}
            </span>
            <span className="text-gray-500 text-xs">
              {(signal.confidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
          <div 
            className={`h-full ${colorClass} transition-all duration-300`}
            style={{ width: `${scorePercent}%` }}
          />
        </div>
      </div>
    );
  };
  
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-bold">📊 Signal Analysis</h3>
        <div className="flex items-center gap-2">
          <span className={`${agreementStyle.color} font-mono text-sm`}>
            {agreementStyle.indicator}
          </span>
          <span className="text-xs text-gray-400">{agreementStyle.label}</span>
        </div>
      </div>
      
      {/* Individual Signals */}
      <div className="space-y-3">
        {renderSignalBar('ML Model', signals.ml)}
        {renderSignalBar('RL Agent', signals.rl)}
        {renderSignalBar('Sentiment', signals.sentiment)}
        {renderSignalBar('Technical', signals.technical)}
      </div>
      
      {/* Aggregation */}
      <div className="pt-3 border-t border-slate-700/50">
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold">Weighted Score</span>
          <div className="flex items-center gap-2">
            <span className={`font-bold ${
              aggregation.weightedScore > aggregation.threshold 
                ? 'text-green-400' 
                : aggregation.weightedScore < -aggregation.threshold
                  ? 'text-red-400'
                  : 'text-gray-400'
            }`}>
              {aggregation.weightedScore > 0 ? '+' : ''}{aggregation.weightedScore.toFixed(3)}
            </span>
            <span className="text-xs text-gray-500">
              (Threshold: ±{aggregation.threshold.toFixed(2)})
            </span>
          </div>
        </div>
        
        {/* Confidence Bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Overall Confidence</span>
            <span>{(aggregation.confidence * 100).toFixed(0)}%</span>
          </div>
          <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
            <div 
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${aggregation.confidence * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
