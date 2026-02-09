/**
 * AI Trader Settings Modal
 * 
 * Modal for editing AI trader settings/personality.
 */

import type { AITrader } from '../types/aiTrader';

interface AITraderSettingsModalProps {
  trader: AITrader;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: (trader: AITrader) => void;
}

export function AITraderSettingsModal({ trader, isOpen, onClose, onUpdated: _onUpdated }: AITraderSettingsModalProps) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700 sticky top-0 bg-slate-800">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span>{trader.avatar}</span>
            <span>Einstellungen: {trader.name}</span>
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
          <p className="text-sm text-gray-400">
            Erweiterte Einstellungen können in der AI Traders Übersicht bearbeitet werden.
          </p>
          
          {/* Current Settings Display */}
          <div className="grid gap-3">
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Risikotoleranz</div>
              <div className="font-medium">{trader.personality?.risk?.tolerance || 'moderate'}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Startkapital</div>
              <div className="font-medium">${trader.personality?.capital?.initialBudget?.toLocaleString() || '100,000'}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Watchlist</div>
              <div className="font-medium text-sm">{trader.personality?.watchlist?.symbols?.join(', ') || '-'}</div>
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-slate-700">
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

export default AITraderSettingsModal;
