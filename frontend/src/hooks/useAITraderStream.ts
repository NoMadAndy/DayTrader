/**
 * Hook for connecting to AI Trader SSE stream
 * 
 * Enhanced with reverse proxy compatibility:
 * - Heartbeat monitoring to detect stale connections
 * - Automatic polling fallback when SSE fails
 * - Reconnection with exponential backoff
 * - EventSource.readyState monitoring
 * - Periodic connection health checks
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

// Constants - optimized for GitHub Codespaces and other reverse proxies
const MAX_EVENTS = 100;
const HEARTBEAT_TIMEOUT_MS = 12000; // 12s timeout (heartbeat every 5s + buffer)
const INITIAL_RECONNECT_DELAY_MS = 300; // Faster initial reconnect
const MAX_RECONNECT_DELAY_MS = 10000;
const POLLING_INTERVAL_MS = 4000; // Faster polling fallback
const MAX_SSE_FAILURES = 3; // Switch to polling faster
const CONNECTION_CHECK_INTERVAL_MS = 8000;

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
  const connectionCheckIntervalRef = useRef<number | null>(null);
  const onEventRef = useRef(onEvent);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY_MS);
  const sseFailureCountRef = useRef(0);
  const lastHeartbeatRef = useRef<number>(Date.now());
  const isConnectingRef = useRef(false);
  const traderIdRef = useRef(traderId);
  
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  
  useEffect(() => {
    traderIdRef.current = traderId;
  }, [traderId]);
  
  const processEvent = useCallback((event: AITraderEvent) => {
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
  
  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (connectionCheckIntervalRef.current) {
      clearInterval(connectionCheckIntervalRef.current);
      connectionCheckIntervalRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    isConnectingRef.current = false;
  }, []);
  
  const startPolling = useCallback(() => {
    cleanup();
    
    setState(prev => ({ ...prev, connected: true, mode: 'polling', error: null }));
    console.log('[Stream] Starting polling fallback mode');
    
    const poll = async () => {
      try {
        const tid = traderIdRef.current;
        if (tid) {
          const response = await fetch(`/api/ai-traders/${tid}?_t=${Date.now()}`);
          if (response.ok) {
            const trader = await response.json();
            const statusEvent: AITraderEvent = {
              type: 'status_update',
              traderId: tid,
              data: {
                traderId: tid,
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
    
    poll();
    pollingIntervalRef.current = window.setInterval(poll, POLLING_INTERVAL_MS);
  }, [cleanup, processEvent]);
  
  const connectSSE = useCallback(() => {
    if (isConnectingRef.current) {
      console.log('[SSE] Connection already in progress, skipping');
      return;
    }
    
    isConnectingRef.current = true;
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (connectionCheckIntervalRef.current) {
      clearInterval(connectionCheckIntervalRef.current);
      connectionCheckIntervalRef.current = null;
    }
    
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    setState(prev => ({ ...prev, mode: 'connecting' }));
    
    const tid = traderIdRef.current;
    const url = tid 
      ? `/api/stream/ai-trader/${tid}`
      : '/api/stream/ai-traders';
    
    console.log(`[SSE] Connecting to ${url}`);
    
    try {
      const es = new EventSource(url);
      eventSourceRef.current = es;
      
      const setupHeartbeatTimeout = () => {
        if (heartbeatTimeoutRef.current) {
          clearTimeout(heartbeatTimeoutRef.current);
        }
        lastHeartbeatRef.current = Date.now();
        
        heartbeatTimeoutRef.current = window.setTimeout(() => {
          const timeSinceHeartbeat = Date.now() - lastHeartbeatRef.current;
          console.warn(`[SSE] Heartbeat timeout (${timeSinceHeartbeat}ms since last heartbeat)`);
          
          if (eventSourceRef.current) {
            const readyState = eventSourceRef.current.readyState;
            console.log(`[SSE] Connection readyState: ${readyState} (0=CONNECTING, 1=OPEN, 2=CLOSED)`);
            
            eventSourceRef.current.close();
            eventSourceRef.current = null;
            isConnectingRef.current = false;
            sseFailureCountRef.current++;
            
            if (sseFailureCountRef.current >= MAX_SSE_FAILURES) {
              console.log(`[SSE] Too many failures (${sseFailureCountRef.current}), switching to polling`);
              startPolling();
            } else {
              console.log(`[SSE] Scheduling reconnect (failure ${sseFailureCountRef.current}/${MAX_SSE_FAILURES})`);
              reconnectTimeoutRef.current = window.setTimeout(() => {
                connectSSE();
              }, INITIAL_RECONNECT_DELAY_MS);
            }
          }
        }, HEARTBEAT_TIMEOUT_MS);
      };
      
      const setupConnectionCheck = () => {
        if (connectionCheckIntervalRef.current) {
          clearInterval(connectionCheckIntervalRef.current);
        }
        connectionCheckIntervalRef.current = window.setInterval(() => {
          const esRef = eventSourceRef.current;
          if (esRef) {
            if (esRef.readyState === EventSource.CLOSED) {
              console.warn('[SSE] Connection check: EventSource is CLOSED, reconnecting');
              esRef.close();
              eventSourceRef.current = null;
              isConnectingRef.current = false;
              reconnectTimeoutRef.current = window.setTimeout(() => {
                connectSSE();
              }, INITIAL_RECONNECT_DELAY_MS);
            } else if (esRef.readyState === EventSource.CONNECTING) {
              console.log('[SSE] Connection check: Still connecting...');
            }
          }
        }, CONNECTION_CHECK_INTERVAL_MS);
      };
      
      es.onopen = () => {
        console.log('[SSE] Connection opened successfully');
        isConnectingRef.current = false;
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
        sseFailureCountRef.current = 0;
        setState(prev => ({ ...prev, connected: true, error: null, mode: 'sse' }));
        setupHeartbeatTimeout();
        setupConnectionCheck();
      };
      
      es.addEventListener('message', (e) => {
        try {
          const event = JSON.parse(e.data) as AITraderEvent;
          processEvent(event);
          setupHeartbeatTimeout();
        } catch (err) {
          console.error('[SSE] Failed to parse message event:', err, e.data);
        }
      });
      
      es.addEventListener('heartbeat', () => {
        console.debug('[SSE] Heartbeat received');
        lastHeartbeatRef.current = Date.now();
        setupHeartbeatTimeout();
      });
      
      es.onerror = () => {
        console.error('[SSE] Connection error, readyState:', es.readyState);
        isConnectingRef.current = false;
        setState(prev => ({ ...prev, connected: false, error: 'Connection error' }));
        
        if (heartbeatTimeoutRef.current) {
          clearTimeout(heartbeatTimeoutRef.current);
          heartbeatTimeoutRef.current = null;
        }
        
        if (connectionCheckIntervalRef.current) {
          clearInterval(connectionCheckIntervalRef.current);
          connectionCheckIntervalRef.current = null;
        }
        
        sseFailureCountRef.current++;
        
        if (sseFailureCountRef.current >= MAX_SSE_FAILURES) {
          console.log(`[SSE] Too many errors (${sseFailureCountRef.current}), switching to polling`);
          es.close();
          eventSourceRef.current = null;
          startPolling();
          return;
        }
        
        const delay = Math.min(reconnectDelayRef.current * 1.5, MAX_RECONNECT_DELAY_MS);
        reconnectDelayRef.current = delay;
        
        console.log(`[SSE] Error ${sseFailureCountRef.current}/${MAX_SSE_FAILURES}, will check state in ${delay}ms`);
        
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        
        reconnectTimeoutRef.current = window.setTimeout(() => {
          if (eventSourceRef.current && eventSourceRef.current.readyState === EventSource.OPEN) {
            console.log('[SSE] Browser auto-reconnected successfully');
            setupHeartbeatTimeout();
            return;
          }
          
          console.log('[SSE] Browser did not auto-reconnect, forcing reconnect');
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
          connectSSE();
        }, delay);
      };
      
    } catch (err) {
      console.error('[SSE] Failed to create EventSource:', err);
      isConnectingRef.current = false;
      setState(prev => ({ ...prev, connected: false, error: 'Failed to connect', mode: 'connecting' }));
      
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connectSSE();
      }, reconnectDelayRef.current);
    }
  }, [processEvent, startPolling]);
  
  useEffect(() => {
    if (enabled) {
      connectSSE();
    } else {
      cleanup();
      setState(prev => ({ ...prev, connected: false, mode: 'connecting' }));
    }
    
    return cleanup;
  }, [enabled, connectSSE, cleanup]);
  
  useEffect(() => {
    if (enabled && traderId !== undefined) {
      const timeout = setTimeout(() => {
        console.log(`[SSE] TraderId changed to ${traderId}, reconnecting`);
        sseFailureCountRef.current = 0;
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
        connectSSE();
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [traderId, enabled, connectSSE]);
  
  const clearEvents = useCallback(() => {
    setState(prev => ({ ...prev, events: [] }));
  }, []);
  
  const reconnect = useCallback(() => {
    console.log('[SSE] Manual reconnect requested');
    sseFailureCountRef.current = 0;
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
    isConnectingRef.current = false;
    cleanup();
    setTimeout(() => connectSSE(), 100);
  }, [connectSSE, cleanup]);
  
  return {
    ...state,
    clearEvents,
    reconnect,
  };
}
