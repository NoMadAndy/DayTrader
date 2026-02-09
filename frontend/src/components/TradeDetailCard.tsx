/**
 * Trade Detail Card
 * 
 * Comprehensive trade history card with signal breakdown.
 */

import type { AITraderDecision } from '../types/aiTrader';

interface TradeDetailCardProps {
  decision: AITraderDecision;
  isNew?: boolean;
  onDelete?: () => void;
}

export function TradeDetailCard({ decision, isNew = false, onDelete }: TradeDetailCardProps) {
  const getDecisionColor = (type: string) => {
    switch (type) {
      case 'buy': return 'text-green-400 bg-green-500/20 border-green-500/50';
      case 'sell': return 'text-red-400 bg-red-500/20 border-red-500/50';
      case 'short': return 'text-orange-400 bg-orange-500/20 border-orange-500/50';
      case 'close': return 'text-yellow-400 bg-yellow-500/20 border-yellow-500/50';
      default: return 'text-gray-400 bg-slate-700/30 border-slate-600/50';
    }
  };

  const getDecisionIcon = (type: string) => {
    switch (type) {
      case 'buy': return '📈';
      case 'sell': return '📉';
      case 'short': return '🔻';
      case 'close': return '✅';
      default: return '⏭️';
    }
  };
  
  const formatScore = (score: number | null) => {
    if (score === null) return '-';
    return (score * 100).toFixed(0) + '%';
  };
  
  const colorClasses = getDecisionColor(decision.decisionType);
  
  return (
    <div className={`bg-slate-900/50 rounded-lg border p-2 sm:p-3 transition-all ${isNew ? 'ring-2 ring-blue-500/50 animate-pulse' : ''} ${colorClasses.split(' ').slice(1).join(' ')}`}>
      {/* Header Row */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg flex-shrink-0">{getDecisionIcon(decision.decisionType)}</span>
          <span className="font-bold truncate">{decision.symbol}</span>
          <span className={`px-1.5 py-0.5 rounded text-xs font-medium uppercase ${colorClasses.split(' ')[0]}`}>
            {decision.decisionType}
          </span>
          {decision.executed && (
            <span className="text-green-400 text-xs">✓</span>
          )}
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            className="p-1 hover:bg-red-500/20 rounded text-gray-500 hover:text-red-400 transition-colors flex-shrink-0"
            title="Entscheidung löschen"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
      
      {/* Scores Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-xs mb-2">
        <div className="bg-slate-800/50 rounded px-2 py-1">
          <span className="text-gray-500">ML:</span>{' '}
          <span className="font-medium">{formatScore(decision.mlScore)}</span>
        </div>
        <div className="bg-slate-800/50 rounded px-2 py-1">
          <span className="text-gray-500">RL:</span>{' '}
          <span className="font-medium">{formatScore(decision.rlScore)}</span>
        </div>
        <div className="bg-slate-800/50 rounded px-2 py-1">
          <span className="text-gray-500">Sent:</span>{' '}
          <span className="font-medium">{formatScore(decision.sentimentScore)}</span>
        </div>
        <div className="bg-slate-800/50 rounded px-2 py-1">
          <span className="text-gray-500">Tech:</span>{' '}
          <span className="font-medium">{formatScore(decision.technicalScore)}</span>
        </div>
      </div>
      
      {/* Confidence & P&L */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          {decision.confidence !== null && (
            <span className="text-gray-400">
              Konfidenz: <span className="font-medium text-white">{(decision.confidence * 100).toFixed(0)}%</span>
            </span>
          )}
          {decision.signalAgreement && (
            <span className={`px-1.5 py-0.5 rounded ${
              decision.signalAgreement === 'strong' ? 'bg-green-500/20 text-green-400' :
              decision.signalAgreement === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' :
              'bg-slate-700/50 text-gray-400'
            }`}>
              {decision.signalAgreement}
            </span>
          )}
        </div>
        {decision.outcomePnl !== null && (
          <span className={`font-medium ${decision.outcomePnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {decision.outcomePnl >= 0 ? '+' : ''}{decision.outcomePnl.toFixed(2)}$
            {decision.outcomePnlPercent !== null && (
              <span className="text-gray-500 ml-1">
                ({decision.outcomePnlPercent >= 0 ? '+' : ''}{decision.outcomePnlPercent.toFixed(1)}%)
              </span>
            )}
          </span>
        )}
      </div>
      
      {/* Summary */}
      {decision.summaryShort && (
        <p className="text-xs text-gray-400 mt-2 line-clamp-2">{decision.summaryShort}</p>
      )}
      
      {/* Timestamp */}
      <div className="text-[10px] text-gray-600 mt-1">
        {new Date(decision.timestamp).toLocaleString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })}
      </div>
    </div>
  );
}

export default TradeDetailCard;
