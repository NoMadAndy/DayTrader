/**
 * Trade Reasoning Card Component
 * 
 * Displays AI trader decision with expandable reasoning.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AITraderDecision, DecisionType } from '../types/aiTrader';
import { SignalBreakdown } from './SignalBreakdown';

interface TradeReasoningCardProps {
  decision: AITraderDecision;
  expanded?: boolean;
  onToggle?: () => void;
  isNew?: boolean;
}

const SIGNAL_COLORS: Record<DecisionType, { bg: string; text: string; emoji: string }> = {
  buy: { bg: 'bg-green-500/15', text: 'text-green-400', emoji: '📈' },
  sell: { bg: 'bg-red-500/15', text: 'text-red-400', emoji: '📉' },
  short: { bg: 'bg-purple-500/15', text: 'text-purple-400', emoji: '📉🔻' },
  hold: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', emoji: '➖' },
  close: { bg: 'bg-orange-500/15', text: 'text-orange-400', emoji: '🔒' },
  skip: { bg: 'bg-gray-500/15', text: 'text-gray-400', emoji: '⏭️' },
};

export function TradeReasoningCard({ decision, expanded: controlledExpanded, onToggle, isNew = false }: TradeReasoningCardProps) {
  // Important decisions (executed buy/sell/close/short) should be expanded by default
  const isImportantDecision = decision.executed && ['buy', 'sell', 'close', 'short'].includes(decision.decisionType);
  
  const [internalExpanded, setInternalExpanded] = useState(isImportantDecision);
  
  // Use controlled expansion if provided, otherwise use internal state
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const handleToggle = onToggle || (() => setInternalExpanded(!internalExpanded));
  
  const signalStyle = SIGNAL_COLORS[decision.decisionType];
  const timestamp = new Date(decision.timestamp).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  
  // Flash animation classes for new decisions
  const flashClass = isNew 
    ? 'animate-pulse ring-2 ring-yellow-400/60 shadow-lg shadow-yellow-400/20' 
    : '';
  
  // Important decision styling - highlighted border
  const importantClass = isImportantDecision 
    ? 'border-l-4 border-l-blue-500 bg-slate-800/70' 
    : '';
  
  // Extract signal scores for compact display
  const signals = decision.reasoning?.signals;
  const getSignalColor = (score: number) => {
    if (score >= 0.3) return 'text-green-400';
    if (score <= -0.3) return 'text-red-400';
    return 'text-gray-400';
  };
  const formatScore = (score: number) => score >= 0 ? `+${score.toFixed(2)}` : score.toFixed(2);
  
  return (
    <div className={`bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 transition-all duration-500 ${flashClass} ${importantClass}`}>
      {/* Header - Compact single line with signal markers */}
      <button
        onClick={handleToggle}
        className="w-full px-2 py-1.5 flex items-center gap-1 sm:gap-2 hover:bg-slate-700/30 transition-colors rounded-lg text-xs"
      >
        {/* Symbol & Decision */}
        <span className="text-base">{signalStyle.emoji}</span>
        <button
          onClick={(e) => { e.stopPropagation(); navigateToSymbol(decision.symbol); }}
          className="font-bold text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors"
          title={`${decision.symbol} im Dashboard anzeigen`}
        >
          {decision.symbol}
        </button>
        <span className={`px-1 py-0.5 rounded text-[10px] font-bold uppercase ${signalStyle.bg} ${signalStyle.text}`}>
          {decision.decisionType}
        </span>
        
        {/* Signal Markers - Hidden on mobile */}
        {signals && (
          <div className="hidden sm:flex items-center gap-1 text-[10px] font-mono">
            {signals.ml !== undefined && (
              <span className={`px-1 rounded ${getSignalColor(signals.ml.score)}`} title={`ML: ${formatScore(signals.ml.score)}`}>
                ML{formatScore(signals.ml.score)}
              </span>
            )}
            {signals.rl !== undefined && (
              <span className={`px-1 rounded ${getSignalColor(signals.rl.score)}`} title={`RL: ${formatScore(signals.rl.score)}`}>
                RL{formatScore(signals.rl.score)}
              </span>
            )}
            {signals.sentiment !== undefined && (
              <span className={`px-1 rounded ${getSignalColor(signals.sentiment.score)}`} title={`Sentiment: ${formatScore(signals.sentiment.score)}`}>
                S{formatScore(signals.sentiment.score)}
              </span>
            )}
            {signals.technical !== undefined && (
              <span className={`px-1 rounded ${getSignalColor(signals.technical.score)}`} title={`Technical: ${formatScore(signals.technical.score)}`}>
                T{formatScore(signals.technical.score)}
              </span>
            )}
          </div>
        )}
        
        {/* Weighted Score & Confidence */}
        <span className="hidden sm:inline text-gray-500">→</span>
        <span className={`font-bold ${(decision.weightedScore || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {(decision.weightedScore || 0) >= 0 ? '+' : ''}{(decision.weightedScore || 0).toFixed(2)}
        </span>
        <span className="hidden sm:inline text-gray-500 text-[10px]">{((decision.confidence || 0) * 100).toFixed(0)}%</span>
        
        {/* Important/Executed badge */}
        {isImportantDecision ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/30 text-blue-300 border border-blue-500/50">
            ⚡ AUSGEFÜHRT
          </span>
        ) : decision.executed && (
          <span className="hidden sm:inline px-1 py-0.5 rounded text-[10px] font-medium bg-blue-500/20 text-blue-400">✓</span>
        )}
        
        {/* Timestamp - pushed to right */}
        <span className="ml-auto text-gray-500">{timestamp}</span>
        
        {/* Expand arrow */}
        <svg 
          className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-700/50">
          {/* Summary */}
          {decision.reasoning?.summary && (
            <div className="pt-4">
              <div className="text-sm font-medium text-gray-300 mb-2">💭 Summary</div>
              <div className="text-sm text-gray-400 bg-slate-900/50 rounded-lg p-3">
                {decision.reasoning.summary}
              </div>
            </div>
          )}
          
          {/* Signal Breakdown */}
          {decision.reasoning?.signals && (
            <SignalBreakdown
              signals={decision.reasoning.signals}
              aggregation={{
                weightedScore: decision.weightedScore || 0,
                threshold: 0.5, // Default threshold
                confidence: decision.confidence || 0,
                signalAgreement: decision.signalAgreement || 'mixed',
              }}
            />
          )}
          
          {/* Factors */}
          {decision.reasoning?.factors && (
            <div className="space-y-3">
              {decision.reasoning.factors.positive && decision.reasoning.factors.positive.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-green-400 mb-2">✅ Positive Factors</div>
                  <ul className="space-y-1">
                    {decision.reasoning.factors.positive.map((factor, idx) => (
                      <li key={idx} className="text-sm text-gray-400 bg-slate-900/50 rounded-lg p-2 flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">•</span>
                        <span>{factor}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              {decision.reasoning.factors.negative && decision.reasoning.factors.negative.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-red-400 mb-2">⚠️ Negative Factors</div>
                  <ul className="space-y-1">
                    {decision.reasoning.factors.negative.map((factor, idx) => (
                      <li key={idx} className="text-sm text-gray-400 bg-slate-900/50 rounded-lg p-2 flex items-start gap-2">
                        <span className="text-red-500 mt-0.5">•</span>
                        <span>{factor}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              {decision.reasoning.factors.neutral && decision.reasoning.factors.neutral.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-gray-400 mb-2">ℹ️ Neutral Factors</div>
                  <ul className="space-y-1">
                    {decision.reasoning.factors.neutral.map((factor, idx) => (
                      <li key={idx} className="text-sm text-gray-400 bg-slate-900/50 rounded-lg p-2 flex items-start gap-2">
                        <span className="text-gray-500 mt-0.5">•</span>
                        <span>{factor}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          
          {/* Recommendation */}
          {decision.reasoning?.recommendation && (
            <div>
              <div className="text-sm font-medium text-blue-400 mb-2">💡 Recommendation</div>
              <div className="text-sm text-gray-400 bg-slate-900/50 rounded-lg p-3">
                {decision.reasoning.recommendation}
              </div>
            </div>
          )}
          
          {/* Warnings */}
          {decision.reasoning?.warnings && decision.reasoning.warnings.length > 0 && (
            <div>
              <div className="text-sm font-medium text-yellow-400 mb-2">⚠️ Warnings</div>
              <ul className="space-y-1">
                {decision.reasoning.warnings.map((warning, idx) => (
                  <li key={idx} className="text-sm text-gray-400 bg-yellow-900/20 rounded-lg p-2 flex items-start gap-2">
                    <span className="text-yellow-500 mt-0.5">⚠️</span>
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Execution Result */}
          {decision.executed && decision.orderId && (
            <div className="pt-3 border-t border-slate-700/50">
              <div className="text-xs text-gray-500">
                Order ID: #{decision.orderId}
                {decision.executionError && (
                  <span className="ml-2 text-red-400">Error: {decision.executionError}</span>
                )}
              </div>
            </div>
          )}
          
          {/* Outcome (if available) */}
          {decision.outcomePnl !== null && (
            <div className="pt-3 border-t border-slate-700/50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Outcome</span>
                <div className="flex items-center gap-3">
                  <span className={`font-bold ${decision.outcomePnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {decision.outcomePnl >= 0 ? '+' : ''}{decision.outcomePnl}%
                  </span>
                  {decision.outcomeHoldingDays && (
                    <span className="text-xs text-gray-500">
                      {decision.outcomeHoldingDays}d
                    </span>
                  )}
                  {decision.outcomeWasCorrect !== null && (
                    <span className={decision.outcomeWasCorrect ? 'text-green-400' : 'text-red-400'}>
                      {decision.outcomeWasCorrect ? '✓' : '✗'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
