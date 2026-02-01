/**
 * Hook for connecting to AI Trader SSE stream
 * 
 * Enhanced with reverse proxy compatibility:
 * - Heartbeat monitoring to detect stale connections
 * - Automatic polling fallback when SSE fails
 * - Reconnection with exponential backoff
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
  mode: 'sse' | 'polling' | 'connecting';
}

// Constants
const MAX_EVENTS = 100;
const HEARTBEAT_TIMEOUT_MS = 25000; // Expect heartbeat every 15s, timeout after 25s
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const POLLING_INTERVAL_MS = 5000;
const MAX_SSE_FAILURES = 3;

export function useAITraderStream(options: UseAITraderStreamOptions = {}) {
  const { traderId, enabled = true, onEvent } = options;
  const [state, setState] = useState<StreamState>({
    connected: false,
    error: null,
    lastEvent: null,
    events: [],
    mode: 'connecting',
  });
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const heartbeatTimeoutRef = useRef<number | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  const onEventRef = useRef(onEvent);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY_MS);
  const sseFailureCountRef = useRef(0);
  
  // Keep onEvent ref up to date
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  
  // Process incoming event
  const processEvent = useCallback((event: AITraderEvent) => {
    // Skip heartbeat events from being added to the event list
    if (event.type === 'heartbeat') {
      return;
    }
    
    setState(prev => {
      const newEvents = prev.events.length >= MAX_EVENTS
        ? [event, ...prev.events.slice(0, MAX_EVENTS - 1)]
        : [event, ...prev.events];
        
      return {
        ...prev,
        lastEvent: event,
        events: newEvents,
      };
    });
    
    onEventRef.current?.(event);
  }, []);
  
  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);
  
  // Start polling fallback
  const startPolling = useCallback(() => {
    stopPolling();
    
    // Close SSE if still open
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    setState(prev => ({ ...prev, connected: true, mode: 'polling', error: null }));
    console.log('[Stream] Starting polling fallback mode');
    
    const poll = async () => {
      try {
        // Poll trader status instead of events for simpler implementation
        if (traderId) {
          const response = await fetch(`/api/ai-traders/${traderId}`);
          if (response.ok) {
            const trader = await response.json();
            // Create a synthetic status event
            const statusEvent: AITraderEvent = {
              type: 'status_update',
              traderId,
              data: {
                traderId,
                status: trader.status,
                tradingTime: trader.tradingTime,
                statusMessage: trader.statusMessage,
                timestamp: new Date().toISOString(),
              },
            };
            processEvent(statusEvent);
          }
        }
      } catch (err) {
        console.error('[Polling] Error:', err);
      }
    };
    
    // Initial poll
    poll();
    
    // Set up interval
    pollingIntervalRef.current = window.setInterval(poll, POLLING_INTERVAL_MS);
  }, [traderId, processEvent, stopPolling]);
  
  // Reset heartbeat timeout
  const resetHeartbeatTimeout = useCallback(() => {
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
    }
    
    heartbeatTimeoutRef.current = window.setTimeout(() => {
      console.warn('[SSE] Heartbeat timeout - connection may be stale');
      // Connection is stale, reconnect
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        sseFailureCountRef.current++;
        
        if (sseFailureCountRef.current >= MAX_SSE_FAILURES) {
          console.log('[SSE] Too many failures, switching to polling mode');
          startPolling();
        } else {
          // Will reconnect via onerror handler
        }
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }, [startPolling]);
  
  // Connect via SSE
  const connectSSE = useCallback(() => {
    // Clear any pending reconnection
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    // Clear heartbeat timeout
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
    
    // Stop polling if active
    stopPolling();
    
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    setState(prev => ({ ...prev, mode: 'connecting' }));
    
    const url = traderId 
      ? `/api/stream/ai-trader/${traderId}`
      : '/api/stream/ai-traders';
    
    console.log(`[SSE] Connecting to ${url}`);
    const es = new EventSource(url);
    eventSourceRef.current = es;
    
    es.onopen = () => {
      console.log('[SSE] Connection opened');
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
      sseFailureCountRef.current = 0;
      setState(prev => ({ ...prev, connected: true, error: null, mode: 'sse' }));
      resetHeartbeatTimeout();
    };
    
    // Handle named 'message' events
    es.addEventListener('message', (e) => {
      try {
        const event = JSON.parse(e.data) as AITraderEvent;
        processEvent(event);
        resetHeartbeatTimeout();
      } catch (err) {
        console.error('[SSE] Failed to parse message event:', err);
      }
    });
    
    // Handle named 'heartbeat' events
    es.addEventListener('heartbeat', () => {
      // Heartbeat received - connection is alive
      resetHeartbeatTimeout();
    });
    
    // Legacy: Handle unnamed events via onmessage
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as AITraderEvent;
        if (event.type === 'heartbeat') {
          resetHeartbeatTimeout();
          return;
        }
        processEvent(event);
        resetHeartbeatTimeout();
      } catch (err) {
        console.error('[SSE] Failed to parse SSE event:', err);
      }
    };
    
    es.onerror = () => {
      console.error('[SSE] Connection error');
      setState(prev => ({ ...prev, connected: false, error: 'Connection lost' }));
      
      if (heartbeatTimeoutRef.current) {
        clearTimeout(heartbeatTimeoutRef.current);
      }
      
      sseFailureCountRef.current++;
      
      // Check if we should switch to polling
      if (sseFailureCountRef.current >= MAX_SSE_FAILURES) {
        console.log('[SSE] Too many failures, switching to polling mode');
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        startPolling();
        return;
      }
      
      // Exponential backoff for reconnection
      const delay = Math.min(reconnectDelayRef.current * 2, MAX_RECONNECT_DELAY_MS);
      reconnectDelayRef.current = delay;
      
      console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${sseFailureCountRef.current})`);
      
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connectSSE();
      }, delay);
    };
  }, [traderId, processEvent, resetHeartbeatTimeout, stopPolling, startPolling]);
  
  // Main effect
  useEffect(() => {
    if (enabled) {
      connectSSE();
    }
    
    return () => {
      // Clear all timeouts
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      if (heartbeatTimeoutRef.current) {
        clearTimeout(heartbeatTimeoutRef.current);
        heartbeatTimeoutRef.current = null;
      }
      
      // Stop polling
      stopPolling();
      
      // Close SSE connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [enabled, connectSSE, stopPolling]);
  
  const clearEvents = useCallback(() => {
    setState(prev => ({ ...prev, events: [] }));
  }, []);
  
  // Force reconnect (try SSE first)
  const reconnect = useCallback(() => {
    sseFailureCountRef.current = 0;
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
    connectSSE();
  }, [connectSSE]);
  
  return {
    ...state,
    clearEvents,
    reconnect,
  };
}
