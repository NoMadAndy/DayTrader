/**
 * Trade Detail Card Component
 * 
 * An expandable card that shows full details of a trade decision.
 * Used in the Activity tab's trade history.
 */

import { useState } from 'react';
import type { AITraderDecision } from '../types/aiTrader';

interface TradeDetailCardProps {
  decision: AITraderDecision;
  isNew?: boolean;
  onDelete?: () => void;
}

export default function TradeDetailCard({ decision, isNew = false, onDelete }: TradeDetailCardProps) {
  const [expanded, setExpanded] = useState(false);

  const isBuyAction = decision.decisionType === 'buy' || decision.decisionType === 'short';
  const isSellAction = decision.decisionType === 'sell' || decision.decisionType === 'close';
  const isExecuted = decision.executed;

  const getActionStyle = () => {
    if (!isExecuted) return 'border-slate-600 bg-slate-800/30';
    if (isBuyAction) return 'border-green-600/50 bg-green-900/20';
    if (isSellAction) return 'border-red-600/50 bg-red-900/20';
    return 'border-slate-600 bg-slate-800/30';
  };

  const getActionIcon = () => {
    switch (decision.decisionType) {
      case 'buy': return '📈';
      case 'sell': return '📉';
      case 'short': return '📉';
      case 'close': return '🔒';
      case 'hold': return '⏸️';
      case 'skip': return '⏭️';
      default: return '📊';
    }
  };

  const getActionBadge = () => {
    const base = 'px-2 py-0.5 rounded text-xs font-bold uppercase';
    switch (decision.decisionType) {
      case 'buy': return `${base} bg-green-600 text-white`;
      case 'sell': return `${base} bg-red-600 text-white`;
      case 'short': return `${base} bg-orange-600 text-white`;
      case 'close': return `${base} bg-purple-600 text-white`;
      case 'hold': return `${base} bg-blue-600 text-white`;
      case 'skip': return `${base} bg-gray-600 text-white`;
      default: return `${base} bg-gray-600 text-white`;
    }
  };

  const formatScore = (score: number | null | undefined, label: string) => {
    if (score === null || score === undefined) return null;
    const percentage = score * 100;
    const color = percentage > 0 ? 'text-green-400' : percentage < 0 ? 'text-red-400' : 'text-gray-400';
    const sign = percentage > 0 ? '+' : '';
    return (
      <div className="flex items-center justify-between">
        <span className="text-gray-400 text-sm">{label}</span>
        <span className={`font-mono text-sm ${color}`}>{sign}{percentage.toFixed(0)}%</span>
      </div>
    );
  };

  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined) return 'N/A';
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return {
      date: date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      time: date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
  };

  const { date, time } = formatTime(decision.timestamp);

  // Parse reasoning if it's a JSON object
  const getReasoning = () => {
    if (typeof decision.reasoning === 'string') return decision.reasoning;
    if (typeof decision.reasoning === 'object') {
      return JSON.stringify(decision.reasoning, null, 2);
    }
    return decision.summaryShort || 'No reasoning available';
  };

  // Extract risk info from reasoning if available
  const riskInfo = typeof decision.reasoning === 'object' ? decision.reasoning : null;

  return (
    <div 
      className={`rounded-lg border-2 transition-all duration-200 ${getActionStyle()} ${isNew ? 'ring-2 ring-yellow-400 ring-opacity-50' : ''}`}
    >
      {/* Header - always visible */}
      <div 
        className="p-3 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between gap-3">
          {/* Left: Action info */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className="text-xl">{getActionIcon()}</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className={getActionBadge()}>{decision.decisionType}</span>
              <span className="font-mono font-bold text-white">{decision.symbol}</span>
              {isExecuted && (
                <span className="text-xs text-green-400 bg-green-900/30 px-1.5 py-0.5 rounded">
                  ✓ Executed
                </span>
              )}
            </div>
          </div>

          {/* Center: Quick stats */}
          <div className="hidden md:flex items-center gap-4 text-sm">
            <div className="text-center">
              <div className="text-gray-500 text-xs">Confidence</div>
              <div className={`font-bold ${(decision.confidence || 0) > 0.5 ? 'text-green-400' : 'text-yellow-400'}`}>
                {((decision.confidence || 0) * 100).toFixed(0)}%
              </div>
            </div>
            <div className="text-center">
              <div className="text-gray-500 text-xs">Score</div>
              <div className={`font-bold ${(decision.weightedScore || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {((decision.weightedScore || 0) * 100).toFixed(0)}%
              </div>
            </div>
            <div className="text-center">
              <div className="text-gray-500 text-xs">Agreement</div>
              <div className="text-gray-300 capitalize">{decision.signalAgreement || 'N/A'}</div>
            </div>
          </div>

          {/* Right: Delete, Time & expand */}
          <div className="flex items-center gap-2">
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="w-6 h-6 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/40 flex items-center justify-center opacity-50 hover:opacity-100 transition-opacity"
                title="Entscheidung löschen"
              >
                ✕
              </button>
            )}
            <div className="text-right text-xs text-gray-500">
              <div>{date}</div>
              <div>{time}</div>
            </div>
            <svg 
              className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Mobile quick stats */}
        <div className="flex md:hidden items-center gap-4 mt-2 text-xs">
          <span className={`${(decision.confidence || 0) > 0.5 ? 'text-green-400' : 'text-yellow-400'}`}>
            Conf: {((decision.confidence || 0) * 100).toFixed(0)}%
          </span>
          <span className={`${(decision.weightedScore || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
            Score: {((decision.weightedScore || 0) * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-slate-700/50 p-4 space-y-4">
          {/* Signal Scores Grid */}
          <div>
            <h4 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-2">
              <span>📊</span> Signal Breakdown
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-800/50 rounded-lg p-2">
                {formatScore(decision.mlScore, 'ML Signal')}
              </div>
              <div className="bg-slate-800/50 rounded-lg p-2">
                {formatScore(decision.rlScore, 'RL Signal')}
              </div>
              <div className="bg-slate-800/50 rounded-lg p-2">
                {formatScore(decision.sentimentScore, 'Sentiment')}
              </div>
              <div className="bg-slate-800/50 rounded-lg p-2">
                {formatScore(decision.technicalScore, 'Technical')}
              </div>
            </div>
            <div className="mt-2 bg-slate-800/50 rounded-lg p-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-sm">Weighted Combined Score</span>
                <span className={`font-mono font-bold ${(decision.weightedScore || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {((decision.weightedScore || 0) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Trade Parameters (if executed) */}
          {isExecuted && riskInfo && (
            <div>
              <h4 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-2">
                <span>📋</span> Trade Parameters
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {riskInfo.quantity && (
                  <div className="bg-slate-800/50 rounded-lg p-2">
                    <div className="text-gray-400 text-xs">Quantity</div>
                    <div className="font-mono text-white">{riskInfo.quantity}</div>
                  </div>
                )}
                {riskInfo.price && (
                  <div className="bg-slate-800/50 rounded-lg p-2">
                    <div className="text-gray-400 text-xs">Price</div>
                    <div className="font-mono text-white">{formatCurrency(riskInfo.price)}</div>
                  </div>
                )}
                {riskInfo.stop_loss && (
                  <div className="bg-slate-800/50 rounded-lg p-2">
                    <div className="text-gray-400 text-xs">Stop Loss</div>
                    <div className="font-mono text-red-400">{formatCurrency(riskInfo.stop_loss)}</div>
                  </div>
                )}
                {riskInfo.take_profit && (
                  <div className="bg-slate-800/50 rounded-lg p-2">
                    <div className="text-gray-400 text-xs">Take Profit</div>
                    <div className="font-mono text-green-400">{formatCurrency(riskInfo.take_profit)}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Risk Assessment */}
          {riskInfo && (
            <div>
              <h4 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-2">
                <span>⚠️</span> Risk Assessment
              </h4>
              <div className="bg-slate-800/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  {riskInfo.risk_checks_passed ? (
                    <>
                      <span className="text-green-400 text-lg">✅</span>
                      <span className="text-green-400">All risk checks passed</span>
                    </>
                  ) : (
                    <>
                      <span className="text-yellow-400 text-lg">⚠️</span>
                      <span className="text-yellow-400">Risk warnings detected</span>
                    </>
                  )}
                </div>
                {riskInfo.risk_warnings && riskInfo.risk_warnings.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-700">
                    <div className="text-xs text-gray-400 mb-1">Warnings:</div>
                    <ul className="text-sm text-yellow-400 space-y-1">
                      {riskInfo.risk_warnings.map((w: string, i: number) => (
                        <li key={i}>• {w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {riskInfo.risk_blockers && riskInfo.risk_blockers.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-700">
                    <div className="text-xs text-gray-400 mb-1">Blockers:</div>
                    <ul className="text-sm text-red-400 space-y-1">
                      {riskInfo.risk_blockers.map((b: string, i: number) => (
                        <li key={i}>❌ {b}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Reasoning */}
          <div>
            <h4 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-2">
              <span>💭</span> Decision Reasoning
            </h4>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-sm text-gray-300 whitespace-pre-wrap">
                {decision.summaryShort || getReasoning()}
              </p>
            </div>
          </div>

          {/* Outcome (if available) */}
          {(decision.outcomePnl !== null && decision.outcomePnl !== undefined) && (
            <div>
              <h4 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-2">
                <span>📈</span> Outcome
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-800/50 rounded-lg p-2 text-center">
                  <div className="text-gray-400 text-xs">P&L</div>
                  <div className={`font-mono font-bold ${(decision.outcomePnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(decision.outcomePnl)}
                  </div>
                </div>
                {decision.outcomePnlPercent !== null && (
                  <div className="bg-slate-800/50 rounded-lg p-2 text-center">
                    <div className="text-gray-400 text-xs">Return</div>
                    <div className={`font-mono font-bold ${(decision.outcomePnlPercent || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {(decision.outcomePnlPercent || 0) >= 0 ? '+' : ''}{decision.outcomePnlPercent?.toFixed(2)}%
                    </div>
                  </div>
                )}
                {decision.outcomeHoldingDays !== null && (
                  <div className="bg-slate-800/50 rounded-lg p-2 text-center">
                    <div className="text-gray-400 text-xs">Held</div>
                    <div className="font-mono text-white">{decision.outcomeHoldingDays} days</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Technical: Full reasoning JSON (for debug) */}
          <details className="text-xs">
            <summary className="text-gray-500 cursor-pointer hover:text-gray-400">
              Show raw data...
            </summary>
            <pre className="mt-2 p-2 bg-black/30 rounded overflow-x-auto text-gray-400">
              {JSON.stringify(decision, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
