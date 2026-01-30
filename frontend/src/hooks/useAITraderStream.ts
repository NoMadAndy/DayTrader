/**
 * Hook for connecting to AI Trader SSE stream
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import type { AITraderEvent } from '../types/aiTrader';

interface UseAITraderStreamOptions {
  traderId?: number;
  enabled?: boolean;
  onEvent?: (event: AITraderEvent) => void;
}

interface StreamState {
  connected: boolean;
  error: string | null;
  lastEvent: AITraderEvent | null;
  events: AITraderEvent[];
}

export function useAITraderStream(options: UseAITraderStreamOptions = {}) {
  const { traderId, enabled = true, onEvent } = options;
  const [state, setState] = useState<StreamState>({
    connected: false,
    error: null,
    lastEvent: null,
    events: [],
  });
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const maxEvents = 100; // Keep last 100 events
  
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    
    const url = traderId 
      ? `/api/stream/ai-trader/${traderId}`
      : '/api/stream/ai-traders';
    
    const es = new EventSource(url);
    eventSourceRef.current = es;
    
    es.onopen = () => {
      setState(prev => ({ ...prev, connected: true, error: null }));
    };
    
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as AITraderEvent;
        
        setState(prev => ({
          ...prev,
          lastEvent: event,
          events: [event, ...prev.events].slice(0, maxEvents),
        }));
        
        onEvent?.(event);
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };
    
    es.onerror = () => {
      setState(prev => ({ ...prev, connected: false, error: 'Connection lost' }));
      // Auto-reconnect after 5 seconds
      setTimeout(() => {
        if (enabled) connect();
      }, 5000);
    };
  }, [traderId, enabled, onEvent]);
  
  useEffect(() => {
    if (enabled) {
      connect();
    }
    
    return () => {
      eventSourceRef.current?.close();
    };
  }, [enabled, connect]);
  
  const clearEvents = useCallback(() => {
    setState(prev => ({ ...prev, events: [] }));
  }, []);
  
  return {
    ...state,
    clearEvents,
    reconnect: connect,
  };
}
