/**
 * Trade Reasoning Card Component
 * 
 * Displays AI trader decision with expandable reasoning.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AITraderDecision, DecisionType } from '../types/aiTrader';
import { SignalBreakdown } from './SignalBreakdown';
import { getDecisionExplanation, type DecisionExplanation } from '../services/aiTraderService';

/** Navigate to stock dashboard for a symbol */
function useNavigateToSymbol() {
  const navigate = useNavigate();
  return (symbol: string) => {
    window.dispatchEvent(new CustomEvent('selectSymbol', { detail: symbol }));
    navigate('/dashboard');
  };
}

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

const DEFAULT_SIGNAL_STYLE = { bg: 'bg-gray-500/15', text: 'text-gray-400', emoji: '❓' };

export function TradeReasoningCard({ decision, expanded: controlledExpanded, onToggle, isNew = false }: TradeReasoningCardProps) {
  const navigateToSymbol = useNavigateToSymbol();
  
  // Important decisions (executed buy/sell/close/short) should be expanded by default
  const isImportantDecision = decision.executed && ['buy', 'sell', 'close', 'short'].includes(decision.decisionType);
  
  const [internalExpanded, setInternalExpanded] = useState(isImportantDecision);
  
  // Use controlled expansion if provided, otherwise use internal state
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const handleToggle = onToggle || (() => setInternalExpanded(!internalExpanded));
  
  const signalStyle = SIGNAL_COLORS[decision.decisionType] || DEFAULT_SIGNAL_STYLE;
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
  
  return (
    <div className={`bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 transition-all duration-500 ${flashClass} ${importantClass}`}>
      {/* Header - Compact single line with signal markers */}
      <button
        onClick={handleToggle}
        className="w-full px-2 py-1.5 flex items-center gap-1 sm:gap-2 hover:bg-slate-700/30 transition-colors rounded-lg text-xs"
      >
        {/* Symbol & Decision */}
        <span className="text-base">{signalStyle.emoji}</span>
        <span
          onClick={(e) => { e.stopPropagation(); navigateToSymbol(decision.symbol); }}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); navigateToSymbol(decision.symbol); } }}
          className="font-bold text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors cursor-pointer"
          title={`${decision.symbol} im Dashboard anzeigen`}
        >
          {decision.symbol}
        </span>
        <span className={`px-1 py-0.5 rounded text-[10px] font-bold uppercase ${signalStyle.bg} ${signalStyle.text}`}>
          {decision.decisionType}
        </span>
        
        {/* Weighted Score */}
        <span className={`font-bold text-[11px] ${(decision.weightedScore || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {(decision.weightedScore || 0) >= 0 ? '+' : ''}{(decision.weightedScore || 0).toFixed(2)}
        </span>
        
        {/* Executed badge - compact */}
        {isImportantDecision ? (
          <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-blue-500/30 text-blue-300">⚡</span>
        ) : decision.executed && (
          <span className="text-[10px] text-blue-400">✓</span>
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
          {decision.outcomePnl != null && (
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

          {/* AI-Erklärung — lazy-loaded Haiku summary, only for closed trades */}
          {decision.outcomePnl != null && (
            <DecisionExplanationPanel decisionId={decision.id} isExpanded={isExpanded} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * AI explanation panel (RAG Phase 2B). Loads on first render while the parent
 * card is expanded, polls while status is pending/in_progress.
 */
function DecisionExplanationPanel({ decisionId, isExpanded }: { decisionId: number; isExpanded: boolean }) {
  const [data, setData] = useState<DecisionExplanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!isExpanded) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getDecisionExplanation(decisionId);
        if (cancelled) return;
        setData(res);
        const pending = res.status === 'pending' || res.status === 'in_progress';
        if (pending) {
          pollTimer.current = window.setTimeout(load, 10000);
        }
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || 'Laden fehlgeschlagen');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();

    return () => {
      cancelled = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [decisionId, isExpanded]);

  const header = (
    <div className="text-sm font-medium text-purple-300 mb-2 flex items-center gap-2">
      <span>🤖 AI-Erklärung</span>
      {data?.model && <span className="text-[10px] text-gray-500 font-normal">· {data.model}</span>}
    </div>
  );

  if (error) {
    return (
      <div className="pt-3 border-t border-slate-700/50">
        {header}
        <div className="text-sm text-red-400 bg-red-900/10 rounded-lg p-3">{error}</div>
      </div>
    );
  }

  if (!data || data.status === 'pending' || data.status === 'in_progress' || loading) {
    return (
      <div className="pt-3 border-t border-slate-700/50">
        {header}
        <div className="text-sm text-gray-500 italic bg-slate-900/50 rounded-lg p-3">
          Erklärung wird generiert…
        </div>
      </div>
    );
  }

  if (data.status === 'skipped_no_api_key') {
    return (
      <div className="pt-3 border-t border-slate-700/50">
        {header}
        <div className="text-sm text-gray-500 bg-slate-900/50 rounded-lg p-3">
          AI-Erklärungen deaktiviert (kein API-Key konfiguriert).
        </div>
      </div>
    );
  }

  if (data.status === 'error') {
    return (
      <div className="pt-3 border-t border-slate-700/50">
        {header}
        <div className="text-sm text-red-400 bg-red-900/10 rounded-lg p-3">
          {data.error || 'Unbekannter Fehler bei der Erklärung.'}
        </div>
      </div>
    );
  }

  return (
    <div className="pt-3 border-t border-slate-700/50">
      {header}
      <div className="text-sm text-gray-300 bg-slate-900/50 rounded-lg p-3 whitespace-pre-line">
        {data.explanation}
      </div>
    </div>
  );
}
