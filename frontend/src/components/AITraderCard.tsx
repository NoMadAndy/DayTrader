/**
 * AI Trader Card Component (Compact)
 * 
 * Displays AI trader status and control buttons in a compact header format.
 */

import type { AITrader, AITraderStatus } from '../types/aiTrader';
import { AITraderTrainingStatus } from './AITraderTrainingStatus';

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
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-4">
      {/* Compact Header with Avatar, Name, Status, and Controls */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Left: Avatar + Name + Status */}
        <div className="flex items-center gap-3">
          <span className="text-3xl">{trader.avatar}</span>
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-bold leading-tight">{trader.name}</h2>
              {trader.description && (
                <p className="text-xs text-gray-400 line-clamp-1">{trader.description}</p>
              )}
            </div>
            {/* Status Badge */}
            <div className={`px-2 py-0.5 rounded-full ${statusStyle.bg} flex items-center gap-1.5`}>
              <span className={`text-sm ${statusStyle.pulse ? 'animate-pulse' : ''}`}>{statusStyle.icon}</span>
              <span className={`text-xs font-medium ${statusStyle.text} uppercase`}>
                {trader.status}
              </span>
            </div>
            {trader.status === 'running' && trader.tradingTime === false && (
              <div className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-medium border border-amber-500/40">
                🚦 Wartet
              </div>
            )}
          </div>
        </div>
        
        {/* Right: Controls + Training Status */}
        <div className="flex items-center gap-2">
          {/* Compact Training Status */}
          <div className="hidden sm:block">
            <AITraderTrainingStatus traderId={trader.id} compact={true} />
          </div>
          
          {/* Control Buttons */}
          <button
            onClick={onStart}
            disabled={trader.status === 'running'}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
          >
            ▶️
          </button>
          <button
            onClick={onPause}
            disabled={trader.status !== 'running'}
            className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-700 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
          >
            ⏸️
          </button>
          <button
            onClick={onStop}
            disabled={trader.status === 'stopped'}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
          >
            ⏹️
          </button>
        </div>
      </div>
      
      {/* Status Message - Show when there's a status message */}
      {trader.statusMessage && (
        <div className="mt-2 text-xs text-gray-400 italic">
          {trader.statusMessage}
        </div>
      )}
    </div>
  );
}
