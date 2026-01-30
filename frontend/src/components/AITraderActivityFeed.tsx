/**
 * AI Trader Activity Feed Component
 * 
 * Displays live event stream from AI trader.
 */

import { useEffect, useRef } from 'react';
import type { AITraderEvent } from '../types/aiTrader';

interface AITraderActivityFeedProps {
  events: AITraderEvent[];
  maxHeight?: string;
  autoScroll?: boolean;
}

const EVENT_ICONS: Record<string, string> = {
  connected: '🔌',
  heartbeat: '💓',
  status_changed: '🔄',
  analyzing: '🔍',
  decision_made: '🧠',
  trade_executed: '💼',
  position_closed: '🔒',
  error: '❌',
};

export function AITraderActivityFeed({ 
  events, 
  maxHeight = '600px', 
  autoScroll = true 
}: AITraderActivityFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to top when new events arrive
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [events, autoScroll]);
  
  const formatTimestamp = (timestamp?: string) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('de-DE', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  };
  
  const renderEventContent = (event: AITraderEvent) => {
    const icon = EVENT_ICONS[event.type] || '📌';
    const time = formatTimestamp(event.data?.timestamp || event.timestamp);
    
    switch (event.type) {
      case 'connected':
        return (
          <div className="flex items-start gap-2">
            <span className="text-lg">{icon}</span>
            <div>
              <div className="font-medium text-green-400">Connected</div>
              <div className="text-xs text-gray-500">{time}</div>
            </div>
          </div>
        );
        
      case 'heartbeat':
        return null; // Don't display heartbeat events
        
      case 'status_changed':
        return (
          <div className="flex items-start gap-2">
            <span className="text-lg">{icon}</span>
            <div className="flex-1">
              <div className="font-medium">
                Status: <span className="text-yellow-400">{event.data?.oldStatus}</span>
                {' → '}
                <span className="text-green-400">{event.data?.newStatus}</span>
              </div>
              {event.data?.message && (
                <div className="text-sm text-gray-400 mt-1">{event.data.message}</div>
              )}
              <div className="text-xs text-gray-500 mt-1">{time}</div>
            </div>
          </div>
        );
        
      case 'analyzing':
        return (
          <div className="flex items-start gap-2">
            <span className="text-lg animate-pulse">{icon}</span>
            <div className="flex-1">
              <div className="font-medium text-blue-400">Analyzing Markets</div>
              <div className="text-sm text-gray-400 mt-1">
                Phase: {event.data?.phase} ({event.data?.progress}%)
              </div>
              {event.data?.symbols && (
                <div className="text-xs text-gray-500 mt-1">
                  Symbols: {(event.data.symbols as string[]).join(', ')}
                </div>
              )}
              <div className="text-xs text-gray-500 mt-1">{time}</div>
            </div>
          </div>
        );
        
      case 'decision_made':
        return (
          <div className="flex items-start gap-2">
            <span className="text-lg">{icon}</span>
            <div className="flex-1">
              <div className="font-medium text-purple-400">Decision Made</div>
              <div className="text-sm text-gray-400 mt-1">
                {String(event.data?.symbol)}: {String(event.data?.decisionType)}
              </div>
              <div className="text-xs text-gray-500 mt-1">{time}</div>
            </div>
          </div>
        );
        
      case 'trade_executed':
        return (
          <div className="flex items-start gap-2">
            <span className="text-lg">{icon}</span>
            <div className="flex-1">
              <div className="font-medium text-green-400">Trade Executed</div>
              <div className="text-sm text-gray-400 mt-1">
                {String(event.data?.symbol)}: {String(event.data?.action)} {String(event.data?.quantity)} @ ${String(event.data?.price)}
              </div>
              <div className="text-xs text-gray-500 mt-1">{time}</div>
            </div>
          </div>
        );
        
      case 'position_closed':
        return (
          <div className="flex items-start gap-2">
            <span className="text-lg">{icon}</span>
            <div className="flex-1">
              <div className="font-medium text-orange-400">Position Closed</div>
              <div className="text-sm text-gray-400 mt-1">
                {String(event.data?.symbol)}: P&L {String(event.data?.pnl)}%
              </div>
              <div className="text-xs text-gray-500 mt-1">{time}</div>
            </div>
          </div>
        );
        
      case 'error':
        return (
          <div className="flex items-start gap-2">
            <span className="text-lg">{icon}</span>
            <div className="flex-1">
              <div className="font-medium text-red-400">Error</div>
              <div className="text-sm text-gray-400 mt-1">{event.data?.error}</div>
              <div className="text-xs text-gray-500 mt-1">{time}</div>
            </div>
          </div>
        );
        
      default:
        return (
          <div className="flex items-start gap-2">
            <span className="text-lg">{icon}</span>
            <div className="flex-1">
              <div className="font-medium">{event.type}</div>
              <div className="text-xs text-gray-500 mt-1">{time}</div>
            </div>
          </div>
        );
    }
  };
  
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50">
      <div className="px-4 py-3 border-b border-slate-700/50">
        <h3 className="font-bold flex items-center gap-2">
          📊 Live Activity Feed
        </h3>
      </div>
      
      <div 
        ref={containerRef}
        className="overflow-y-auto"
        style={{ maxHeight }}
      >
        {events.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="text-4xl mb-2">👀</div>
            <div>Waiting for events...</div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {events.map((event, index) => {
              const content = renderEventContent(event);
              if (!content) return null;
              
              return (
                <div 
                  key={index}
                  className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/30 hover:border-slate-600/50 transition-colors"
                >
                  {content}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
