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
  const reconnectTimeoutRef = useRef<number | null>(null);
  const onEventRef = useRef(onEvent);
  const maxEvents = 100; // Keep last 100 events
  
  // Keep onEvent ref up to date
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  
  const connect = useCallback(() => {
    // Clear any pending reconnection
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
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
        
        setState(prev => {
          // More efficient: only slice if we're at capacity
          const newEvents = prev.events.length >= maxEvents
            ? [event, ...prev.events.slice(0, maxEvents - 1)]
            : [event, ...prev.events];
            
          return {
            ...prev,
            lastEvent: event,
            events: newEvents,
          };
        });
        
        // Use ref to call latest onEvent
        onEventRef.current?.(event);
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };
    
    es.onerror = () => {
      setState(prev => ({ ...prev, connected: false, error: 'Connection lost' }));
      
      // Only auto-reconnect if still enabled
      reconnectTimeoutRef.current = window.setTimeout(() => {
        if (eventSourceRef.current !== null) {
          connect();
        }
      }, 5000);
    };
  }, [traderId]);
  
  useEffect(() => {
    if (enabled) {
      connect();
    }
    
    return () => {
      // Clear reconnection timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      // Close connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
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
