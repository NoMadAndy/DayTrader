/**
 * AI Trader Card Component
 * 
 * Compact header bar displaying trader info: avatar, name, status, and control buttons.
 * Mobile-responsive single-line layout.
 */

import type { AITrader } from '../types/aiTrader';

interface AITraderCardProps {
  trader: AITrader;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
}

const STATUS_STYLES: Record<AITrader['status'], { bg: string; text: string; label: string; icon: string }> = {
  running: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Aktiv', icon: '▶️' },
  paused: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Pausiert', icon: '⏸️' },
  stopped: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Gestoppt', icon: '⏹️' },
  error: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Fehler', icon: '❌' },
};

export function AITraderCard({ trader, onStart, onStop, onPause }: AITraderCardProps) {
  const statusStyle = STATUS_STYLES[trader.status];
  
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
        {/* Left: Avatar + Name + Status */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {/* Avatar */}
          <div className="text-2xl sm:text-3xl flex-shrink-0">
            {trader.avatar || '🤖'}
          </div>
          
          {/* Name and Description */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-semibold truncate">
                {trader.name}
              </h2>
              {/* Status Badge */}
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                <span>{statusStyle.icon}</span>
                <span className="hidden xs:inline">{statusStyle.label}</span>
              </span>
            </div>
            {trader.description && (
              <p className="text-xs sm:text-sm text-gray-400 truncate hidden sm:block">
                {trader.description}
              </p>
            )}
          </div>
        </div>
        
        {/* Right: Control Buttons */}
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          {trader.status === 'stopped' && (
            <button
              onClick={onStart}
              className="px-2 sm:px-3 py-1.5 rounded-lg bg-green-500/20 hover:bg-green-500/30 border border-green-500/50 text-green-400 transition-colors flex items-center gap-1"
              title="Trader starten"
            >
              <span>▶️</span>
              <span className="text-sm font-medium hidden sm:inline">Start</span>
            </button>
          )}
          
          {trader.status === 'running' && (
            <>
              <button
                onClick={onPause}
                className="px-2 sm:px-3 py-1.5 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/50 text-yellow-400 transition-colors flex items-center gap-1"
                title="Trader pausieren"
              >
                <span>⏸️</span>
                <span className="text-sm font-medium hidden sm:inline">Pause</span>
              </button>
              <button
                onClick={onStop}
                className="px-2 sm:px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 transition-colors flex items-center gap-1"
                title="Trader stoppen"
              >
                <span>⏹️</span>
                <span className="text-sm font-medium hidden sm:inline">Stop</span>
              </button>
            </>
          )}
          
          {trader.status === 'paused' && (
            <>
              <button
                onClick={onStart}
                className="px-2 sm:px-3 py-1.5 rounded-lg bg-green-500/20 hover:bg-green-500/30 border border-green-500/50 text-green-400 transition-colors flex items-center gap-1"
                title="Trader fortsetzen"
              >
                <span>▶️</span>
                <span className="text-sm font-medium hidden sm:inline">Weiter</span>
              </button>
              <button
                onClick={onStop}
                className="px-2 sm:px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 transition-colors flex items-center gap-1"
                title="Trader stoppen"
              >
                <span>⏹️</span>
                <span className="text-sm font-medium hidden sm:inline">Stop</span>
              </button>
            </>
          )}
          
          {trader.status === 'error' && (
            <button
              onClick={onStart}
              className="px-2 sm:px-3 py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/50 text-blue-400 transition-colors flex items-center gap-1"
              title="Trader neu starten"
            >
              <span>🔄</span>
              <span className="text-sm font-medium hidden sm:inline">Neustart</span>
            </button>
          )}
        </div>
      </div>
      
      {/* Error Message */}
      {trader.status === 'error' && trader.statusMessage && (
        <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          {trader.statusMessage}
        </div>
      )}
    </div>
  );
}

export default AITraderCard;
