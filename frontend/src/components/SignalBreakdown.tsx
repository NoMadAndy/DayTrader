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
  const agreementStyle = AGREEMENT_STYLES[aggregation.signalAgreement] || AGREEMENT_STYLES.mixed;
  
  // Safely extract aggregation values
  const weightedScore = typeof aggregation.weightedScore === 'number' && isFinite(aggregation.weightedScore) 
    ? aggregation.weightedScore : 0;
  const threshold = typeof aggregation.threshold === 'number' && isFinite(aggregation.threshold) 
    ? aggregation.threshold : 0.5;
  const confidence = typeof aggregation.confidence === 'number' && isFinite(aggregation.confidence) 
    ? aggregation.confidence : 0;
  
  const renderSignalBar = (label: string, signal?: SignalDetail) => {
    if (!signal) return null;
    
    // Safely extract values with defaults
    const score = typeof signal.score === 'number' && isFinite(signal.score) ? signal.score : 0;
    const weight = typeof signal.weight === 'number' && isFinite(signal.weight) ? signal.weight : 0;
    
    const scorePercent = ((score + 1) / 2) * 100; // Convert -1..1 to 0..100
    const isPositive = score > 0;
    const isNegative = score < 0;
    const isNeutral = Math.abs(score) < 0.1;
    
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
              {score > 0 ? '+' : ''}{score.toFixed(2)}
            </span>
            <span className="text-gray-500 text-xs" title="Gewichtung">
              {(weight * 100).toFixed(0)}%
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
              weightedScore > threshold 
                ? 'text-green-400' 
                : weightedScore < -threshold
                  ? 'text-red-400'
                  : 'text-gray-400'
            }`}>
              {weightedScore > 0 ? '+' : ''}{weightedScore.toFixed(3)}
            </span>
            <span className="text-xs text-gray-500">
              (Threshold: ±{threshold.toFixed(2)})
            </span>
          </div>
        </div>
        
        {/* Confidence Bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Overall Confidence</span>
            <span>{(confidence * 100).toFixed(0)}%</span>
          </div>
          <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
            <div 
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${confidence * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
