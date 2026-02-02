/**
 * AI Trader Card Component
 * 
 * Displays AI trader status and control buttons.
 */

import type { AITrader, AITraderStatus } from '../types/aiTrader';

interface AITraderCardProps {
  trader: AITrader;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
}

const STATUS_STYLES: Record<AITraderStatus, { bg: string; text: string; icon: string; pulse: boolean }> = {
  running: { bg: 'bg-green-500/20', text: 'text-green-400', icon: '▶️', pulse: true },
  paused: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: '⏸️', pulse: false },
  stopped: { bg: 'bg-slate-500/20', text: 'text-slate-400', icon: '⏹️', pulse: false },
  error: { bg: 'bg-red-500/20', text: 'text-red-400', icon: '❌', pulse: true },
};

export function AITraderCard({ trader, onStart, onStop, onPause }: AITraderCardProps) {
  const statusStyle = STATUS_STYLES[trader.status];
  
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{trader.avatar}</span>
          <div>
            <h2 className="text-xl font-bold">{trader.name}</h2>
            {trader.description && (
              <p className="text-sm text-gray-400 mt-1">{trader.description}</p>
            )}
          </div>
        </div>
        
        {/* Status Badge */}
        <div className="flex items-center gap-2">
          <div className={`px-3 py-1 rounded-full ${statusStyle.bg} flex items-center gap-2`}>
            <span className={statusStyle.pulse ? 'animate-pulse' : ''}>{statusStyle.icon}</span>
            <span className={`text-sm font-medium ${statusStyle.text} uppercase`}>
              {trader.status}
            </span>
          </div>
          {trader.status === 'running' && trader.tradingTime === false && (
            <div className="px-2 py-1 rounded-full bg-amber-500/20 text-amber-400 text-xs font-medium border border-amber-500/40 flex items-center gap-1">
              🚦 Wartet
            </div>
          )}
        </div>
      </div>
      
      {/* Status Message - Show when there's a status message */}
      {trader.statusMessage && (
        <div className="mb-4 text-sm text-gray-400 italic">
          {trader.statusMessage}
        </div>
      )}
      
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-1">Decisions</div>
          <div className="text-lg font-bold">{trader.totalDecisions ?? 0}</div>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-1">Trades</div>
          <div className="text-lg font-bold">{trader.tradesExecuted ?? 0}</div>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-1">Win Rate</div>
          <div className="text-lg font-bold">
            {(trader.tradesExecuted ?? 0) > 0 
              ? `${(((trader.winningTrades ?? 0) / (trader.tradesExecuted ?? 0)) * 100).toFixed(1)}%`
              : '-'}
          </div>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-1">Total P&L</div>
          <div className={`text-lg font-bold ${(trader.totalPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {(trader.totalPnl ?? 0) >= 0 ? '+' : ''}{(trader.totalPnl ?? 0).toFixed(2)}%
          </div>
        </div>
      </div>
      
      {/* Controls */}
      <div className="flex gap-2">
        <button
          onClick={onStart}
          disabled={trader.status === 'running'}
          className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:text-gray-500 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
        >
          ▶️ Start
        </button>
        <button
          onClick={onPause}
          disabled={trader.status !== 'running'}
          className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-700 disabled:text-gray-500 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
        >
          ⏸️ Pause
        </button>
        <button
          onClick={onStop}
          disabled={trader.status === 'stopped'}
          className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-gray-500 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
        >
          ⏹️ Stop
        </button>
      </div>
    </div>
  );
}
