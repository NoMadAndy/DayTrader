/**
 * AI Trader Activity Feed Component
 * 
 * Displays live event stream from AI trader with:
 * - Compact, space-saving design
 * - Visual flash effect for new events
 * - Optional sound notification
 * - Optional haptic feedback on mobile
 * - Events sorted newest first
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { AITraderEvent } from '../types/aiTrader';

interface AITraderActivityFeedProps {
  events: AITraderEvent[];
  maxHeight?: string;
  autoScroll?: boolean;
  enableSound?: boolean;
  enableVibration?: boolean;
  enableFlash?: boolean;
}

const DECISION_TYPE_COLORS: Record<string, string> = {
  buy: 'bg-green-500/20 text-green-400 border-green-500/30',
  sell: 'bg-red-500/20 text-red-400 border-red-500/30',
  close: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  skip: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  hold: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

export function AITraderActivityFeed({ 
  events, 
  maxHeight = '400px', 
  autoScroll = true,
  enableSound = false,
  enableVibration = false,
  enableFlash = true,
}: AITraderActivityFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevEventCountRef = useRef(events.length);
  const [flashingIndices, setFlashingIndices] = useState<Set<number>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Sort events by timestamp (newest first) to ensure correct display order
  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      const timeA = a.data?.timestamp || a.timestamp || '';
      const timeB = b.data?.timestamp || b.timestamp || '';
      // ISO string comparison preserves millisecond precision
      if (timeA > timeB) return -1;
      if (timeA < timeB) return 1;
      return 0;
    });
  }, [events]);
  
  // Create notification sound using Web Audio API
  const playNotificationSound = useCallback((isImportant: boolean = true) => {
    if (!enableSound) return;
    
    try {
      // Lazy init AudioContext (must be after user interaction)
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      
      // Resume context if suspended (browser autoplay policy)
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      
      if (isImportant) {
        // Two-tone ascending sound for important events (trade executed, buy/sell)
        const frequencies = [880, 1100];
        frequencies.forEach((freq, i) => {
          const oscillator = ctx.createOscillator();
          const gainNode = ctx.createGain();
          
          oscillator.connect(gainNode);
          gainNode.connect(ctx.destination);
          
          oscillator.frequency.value = freq;
          oscillator.type = 'triangle';
          
          const startTime = ctx.currentTime + (i * 0.08);
          gainNode.gain.setValueAtTime(0, startTime);
          gainNode.gain.linearRampToValueAtTime(0.25, startTime + 0.02);
          gainNode.gain.setValueAtTime(0.25, startTime + 0.06);
          gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);
          
          oscillator.start(startTime);
          oscillator.stop(startTime + 0.12);
        });
      } else {
        // Simple soft beep for info events
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        oscillator.frequency.value = 600;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.1);
      }
    } catch {
      // Ignore audio errors
    }
  }, [enableSound]);
  
  // Handle new events - trigger effects
  useEffect(() => {
    if (events.length > prevEventCountRef.current) {
      const newEventsCount = events.length - prevEventCountRef.current;
      
      // Flash effect for new events
      if (enableFlash) {
        const indices = new Set<number>();
        for (let i = 0; i < newEventsCount; i++) {
          indices.add(i);
        }
        setFlashingIndices(indices);
        
        // Remove flash after animation
        setTimeout(() => {
          setFlashingIndices(new Set());
        }, 1000);
      }
      
      // Check for important events
      const newEvents = events.slice(0, newEventsCount);
      const hasImportantEvent = newEvents.some(
        e => ['trade_executed', 'position_closed', 'error'].includes(e.type) ||
             (e.type === 'decision_made' && e.data?.decisionType !== 'skip')
      );
      
      // Check for very important events (executed trades)
      const hasVeryImportantEvent = newEvents.some(
        e => ['trade_executed', 'position_closed'].includes(e.type) ||
             (e.type === 'decision_made' && e.data?.decisionType && ['buy', 'sell'].includes(String(e.data.decisionType)) && e.data?.executed)
      );
      
      // Sound notification for important events
      if (enableSound && hasImportantEvent) {
        playNotificationSound(hasVeryImportantEvent);
      }
      
      // Haptic feedback on mobile for important events
      if (enableVibration && hasImportantEvent && 'vibrate' in navigator) {
        // Stronger vibration for very important events
        navigator.vibrate(hasVeryImportantEvent ? [50, 30, 50, 30, 100] : [80]);
      }
    }
    prevEventCountRef.current = events.length;
  }, [events, enableSound, enableVibration, enableFlash, playNotificationSound]);
  
  // Auto-scroll to top when new events arrive
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [events, autoScroll]);
  
  const formatTimestamp = useCallback((timestamp?: string) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('de-DE', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  }, []);
  
  const renderCompactEvent = (event: AITraderEvent, isFlashing: boolean) => {
    const time = formatTimestamp(event.data?.timestamp || event.timestamp);
    const flashClass = isFlashing ? 'animate-pulse ring-2 ring-yellow-400/50' : '';
    
    switch (event.type) {
      case 'connected':
        return (
          <div className={`flex items-center gap-2 py-1 px-2 text-sm ${flashClass}`}>
            <span className="text-gray-500 w-14 text-xs font-mono">{time}</span>
            <span>🔌</span>
            <span className="text-green-400">Verbunden</span>
          </div>
        );
        
      case 'heartbeat':
        return null;
        
      case 'status_changed':
        return (
          <div className={`flex items-center gap-2 py-1 px-2 text-sm ${flashClass}`}>
            <span className="text-gray-500 w-14 text-xs font-mono">{time}</span>
            <span>🔄</span>
            <span className="text-yellow-400">{event.data?.oldStatus}</span>
            <span className="text-gray-500">→</span>
            <span className="text-green-400">{event.data?.newStatus}</span>
          </div>
        );
        
      case 'analyzing':
        return (
          <div className={`flex items-center gap-2 py-1 px-2 text-sm ${flashClass}`}>
            <span className="text-gray-500 w-14 text-xs font-mono">{time}</span>
            <span className="animate-pulse">🔍</span>
            <span className="text-blue-400">Analyse</span>
            <span className="text-gray-500 text-xs truncate">
              {event.data?.symbols ? (event.data.symbols as string[]).slice(0, 5).join(', ') : '...'}
            </span>
          </div>
        );
        
      case 'decision_made': {
        const decisionType = String(event.data?.decisionType || 'skip').toLowerCase();
        const symbol = String(event.data?.symbol || '');
        const confidence = event.data?.confidence;
        const typeColorClass = DECISION_TYPE_COLORS[decisionType] || DECISION_TYPE_COLORS.skip;
        
        return (
          <div className={`flex items-center gap-2 py-1.5 px-2 rounded border ${typeColorClass} ${flashClass}`}>
            <span className="text-gray-500 w-14 text-xs font-mono">{time}</span>
            <span>🧠</span>
            <span className="font-mono font-semibold w-14">{symbol}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded uppercase font-bold`}>
              {decisionType}
            </span>
            {confidence !== undefined && (
              <span className="text-xs text-gray-400 ml-auto">
                {(Number(confidence) * 100).toFixed(0)}%
              </span>
            )}
          </div>
        );
      }
        
      case 'trade_executed': {
        const action = String(event.data?.action || '').toUpperCase();
        const symbol = String(event.data?.symbol || '');
        const quantity = Number(event.data?.quantity || 0);
        const price = event.data?.price;
        const isBuy = action === 'BUY';
        
        return (
          <div className={`flex items-center gap-2 py-1.5 px-2 rounded border ${isBuy ? 'bg-green-500/20 border-green-500/40' : 'bg-red-500/20 border-red-500/40'} ${flashClass}`}>
            <span className="text-gray-500 w-14 text-xs font-mono">{time}</span>
            <span>💼</span>
            <span className="font-mono font-semibold w-14">{symbol}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${isBuy ? 'bg-green-500/30 text-green-300' : 'bg-red-500/30 text-red-300'}`}>
              {action}
            </span>
            <span className="text-xs text-gray-300">
              {quantity}× ${Number(price).toFixed(2)}
            </span>
          </div>
        );
      }
        
      case 'position_closed': {
        const symbol = String(event.data?.symbol || '');
        const pnl = Number(event.data?.pnl || 0);
        const isProfitable = pnl >= 0;
        
        return (
          <div className={`flex items-center gap-2 py-1.5 px-2 rounded border ${isProfitable ? 'bg-green-500/15 border-green-500/30' : 'bg-red-500/15 border-red-500/30'} ${flashClass}`}>
            <span className="text-gray-500 w-14 text-xs font-mono">{time}</span>
            <span>🔒</span>
            <span className="font-mono font-semibold w-14">{symbol}</span>
            <span className="text-xs text-gray-400">Geschlossen</span>
            <span className={`text-sm font-bold ml-auto ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
              {isProfitable ? '+' : ''}{pnl.toFixed(2)}%
            </span>
          </div>
        );
      }
        
      case 'error':
        return (
          <div className={`flex items-center gap-2 py-1 px-2 rounded bg-red-500/10 border border-red-500/30 ${flashClass}`}>
            <span className="text-gray-500 w-14 text-xs font-mono">{time}</span>
            <span>❌</span>
            <span className="text-sm text-red-400 truncate flex-1">{event.data?.error}</span>
          </div>
        );
        
      default:
        return (
          <div className={`flex items-center gap-2 py-1 px-2 text-sm ${flashClass}`}>
            <span className="text-gray-500 w-14 text-xs font-mono">{time}</span>
            <span>📌</span>
            <span className="text-gray-400">{event.type}</span>
          </div>
        );
    }
  };
  
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50">
      <div className="px-3 py-2 border-b border-slate-700/50 flex items-center justify-between">
        <h3 className="font-bold text-sm flex items-center gap-2">
          📊 Live Activity
          {events.length > 0 && (
            <span className="text-xs text-gray-500 font-normal">({events.length})</span>
          )}
        </h3>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
          Live
        </div>
      </div>
      
      <div 
        ref={containerRef}
        className="overflow-y-auto"
        style={{ maxHeight }}
      >
        {sortedEvents.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            <div className="text-xl mb-1">👀</div>
            <div>Warte auf Ereignisse...</div>
          </div>
        ) : (
          <div className="p-1.5 space-y-0.5">
            {sortedEvents.map((event, index) => {
              const content = renderCompactEvent(event, flashingIndices.has(index));
              if (!content) return null;
              
              const key = event.data?.timestamp 
                ? `${event.type}-${event.data.timestamp}-${event.traderId || 'all'}-${event.data?.symbol || ''}`
                : `${event.type}-${index}`;
              
              return (
                <div key={key} className="transition-all duration-300 rounded hover:bg-slate-700/30">
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
