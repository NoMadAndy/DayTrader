/**
 * AI Trader SSE Event Broadcasting Service
 * 
 * Broadcasts real-time events to connected clients via Server-Sent Events.
 */

import { EventEmitter } from 'events';

class AITraderEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map(); // Map<clientId, { res, subscribedTraders: Set<number> }>
  }

  /**
   * Add a new SSE client
   */
  addClient(clientId, res, traderIds = []) {
    // Setup SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    // Keep connection alive
    res.write(':ok\n\n');
    
    this.clients.set(clientId, {
      res,
      subscribedTraders: new Set(traderIds),
    });
    
    console.log(`[SSE] Client ${clientId} connected, subscribed to traders: ${traderIds}`);
    
    // Handle client disconnect
    res.on('close', () => {
      this.removeClient(clientId);
    });
  }

  /**
   * Remove a client
   */
  removeClient(clientId) {
    this.clients.delete(clientId);
    console.log(`[SSE] Client ${clientId} disconnected`);
  }

  /**
   * Broadcast event to all clients subscribed to a trader
   */
  broadcast(traderId, event) {
    const eventString = `data: ${JSON.stringify({ traderId, ...event })}\n\n`;
    
    for (const [clientId, client] of this.clients) {
      if (client.subscribedTraders.has(traderId) || client.subscribedTraders.size === 0) {
        try {
          client.res.write(eventString);
        } catch (e) {
          console.error(`[SSE] Error sending to client ${clientId}:`, e);
          this.removeClient(clientId);
        }
      }
    }
  }

  /**
   * Send heartbeat to all clients
   */
  heartbeat() {
    const heartbeatEvent = `data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`;
    
    for (const [clientId, client] of this.clients) {
      try {
        client.res.write(heartbeatEvent);
      } catch (e) {
        this.removeClient(clientId);
      }
    }
  }
}

export const aiTraderEvents = new AITraderEventEmitter();

// Heartbeat every 30 seconds
setInterval(() => aiTraderEvents.heartbeat(), 30000);

// Event type emitters
export function emitStatusChanged(traderId, traderName, oldStatus, newStatus, message) {
  aiTraderEvents.broadcast(traderId, {
    type: 'status_changed',
    data: { traderId, traderName, oldStatus, newStatus, message, timestamp: new Date().toISOString() }
  });
}

export function emitAnalyzing(traderId, traderName, symbols, phase, progress) {
  aiTraderEvents.broadcast(traderId, {
    type: 'analyzing',
    data: { traderId, traderName, symbols, phase, progress, timestamp: new Date().toISOString() }
  });
}

export function emitDecisionMade(traderId, traderName, decision) {
  aiTraderEvents.broadcast(traderId, {
    type: 'decision_made',
    data: { traderId, traderName, ...decision, timestamp: new Date().toISOString() }
  });
}

export function emitTradeExecuted(traderId, traderName, trade) {
  aiTraderEvents.broadcast(traderId, {
    type: 'trade_executed',
    data: { traderId, traderName, ...trade, timestamp: new Date().toISOString() }
  });
}

export function emitPositionClosed(traderId, traderName, position) {
  aiTraderEvents.broadcast(traderId, {
    type: 'position_closed',
    data: { traderId, traderName, ...position, timestamp: new Date().toISOString() }
  });
}

export function emitError(traderId, traderName, error) {
  aiTraderEvents.broadcast(traderId, {
    type: 'error',
    data: { traderId, traderName, error, timestamp: new Date().toISOString() }
  });
}

export default aiTraderEvents;
