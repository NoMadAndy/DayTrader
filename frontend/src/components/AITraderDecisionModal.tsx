/**
 * AI Trader Decision Modal
 * 
 * Modal for viewing decision details.
 */

import type { AITraderDecision } from '../types/aiTrader';

interface AITraderDecisionModalProps {
  decision: AITraderDecision | null;
  isOpen: boolean;
  onClose: () => void;
}

export function AITraderDecisionModal({ decision, isOpen, onClose }: AITraderDecisionModalProps) {
  if (!isOpen || !decision) return null;
  
  const getDecisionColor = (type: string) => {
    switch (type) {
      case 'buy': return 'text-green-400';
      case 'sell': case 'short': return 'text-red-400';
      case 'close': return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">
            Entscheidung Details
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Content */}
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold">{decision.symbol}</span>
            <span className={`font-semibold uppercase ${getDecisionColor(decision.decisionType)}`}>
              {decision.decisionType}
            </span>
          </div>
          
          {decision.confidence !== null && (
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Konfidenz</div>
              <div className="font-medium">{(decision.confidence * 100).toFixed(1)}%</div>
            </div>
          )}
          
          {decision.summaryShort && (
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Begründung</div>
              <div className="text-sm">{decision.summaryShort}</div>
            </div>
          )}
          
          <div className="text-xs text-gray-500">
            {new Date(decision.timestamp).toLocaleString('de-DE')}
          </div>
        </div>
        
        {/* Footer */}
        <div className="flex justify-end p-4 border-t border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

export default AITraderDecisionModal;
