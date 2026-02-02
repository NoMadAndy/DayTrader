/**
 * Trade Reasoning Card Component
 * 
 * Displays AI trader decision with expandable reasoning.
 */

import { useState } from 'react';
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
  hold: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', emoji: '➖' },
  close: { bg: 'bg-orange-500/15', text: 'text-orange-400', emoji: '🔒' },
  skip: { bg: 'bg-gray-500/15', text: 'text-gray-400', emoji: '⏭️' },
};

export function TradeReasoningCard({ decision, expanded: controlledExpanded, onToggle, isNew = false }: TradeReasoningCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  
  // Use controlled expansion if provided, otherwise use internal state
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const handleToggle = onToggle || (() => setInternalExpanded(!internalExpanded));
  
  const signalStyle = SIGNAL_COLORS[decision.decisionType];
  const timestamp = new Date(decision.timestamp).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  
  // Flash animation classes for new decisions
  const flashClass = isNew 
    ? 'animate-pulse ring-2 ring-yellow-400/60 shadow-lg shadow-yellow-400/20' 
    : '';
  
  return (
    <div className={`bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 transition-all duration-500 ${flashClass}`}>
      {/* Header - Always visible - Compact version */}
      <button
        onClick={handleToggle}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-slate-700/30 transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{signalStyle.emoji}</span>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="font-bold">{decision.symbol}</span>
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium uppercase ${signalStyle.bg} ${signalStyle.text}`}>
                {decision.decisionType}
              </span>
              {decision.executed && (
                <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
                  ✓
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500">
              {timestamp} • {((decision.confidence || 0) * 100).toFixed(0)}%
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {decision.summaryShort && (
            <span className="text-sm text-gray-400 hidden md:block max-w-md truncate">
              {decision.summaryShort}
            </span>
          )}
          <svg 
            className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
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
