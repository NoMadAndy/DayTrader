/**
 * AI Trader SSE Event Broadcasting Service
 * 
 * Broadcasts real-time events to connected clients via Server-Sent Events.
 * Enhanced for reverse proxy compatibility (Cloudflare, AWS ALB, GitHub Codespaces, etc.)
 */

import { EventEmitter } from 'events';

class AITraderEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map(); // Map<clientId, { res, subscribedTraders: Set<number> }>
  }

  /**
   * Add a new SSE client with enhanced reverse proxy support
   */
  addClient(clientId, res, traderIds = []) {
    // Setup SSE headers - optimized for reverse proxies
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Nginx
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Additional headers for various proxies
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
    
    // Disable response buffering at Node.js level
    res.flushHeaders();
    
    // Send retry directive for auto-reconnect (3 seconds)
    res.write('retry: 3000\n\n');
    
    // Send initial comment to establish connection and prevent proxy buffering
    res.write(': keep-alive\n\n');
    
    this.clients.set(clientId, {
      res,
      subscribedTraders: new Set(traderIds),
      lastActivity: Date.now(),
    });
    
    console.log(`[SSE] Client ${clientId} connected, subscribed to traders: ${traderIds}`);
    
    // Handle client disconnect
    res.on('close', () => {
      this.removeClient(clientId);
    });
    
    res.on('error', () => {
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
    // Use named event for better parsing
    const eventString = `event: message\ndata: ${JSON.stringify({ traderId, ...event })}\n\n`;
    
    for (const [clientId, client] of this.clients) {
      if (client.subscribedTraders.has(traderId) || client.subscribedTraders.size === 0) {
        try {
          client.res.write(eventString);
          client.lastActivity = Date.now();
        } catch (e) {
          console.error(`[SSE] Error sending to client ${clientId}:`, e);
          this.removeClient(clientId);
        }
      }
    }
  }

  /**
   * Send heartbeat to all clients - critical for reverse proxy keep-alive
   */
  heartbeat() {
    const timestamp = new Date().toISOString();
    // Use SSE comment + named event for maximum proxy compatibility
    // The : comment prevents proxy buffering, the event provides data
    const heartbeatEvent = `: heartbeat ${timestamp}\nevent: heartbeat\ndata: ${JSON.stringify({ type: 'heartbeat', timestamp })}\n\n`;
    
    for (const [clientId, client] of this.clients) {
      try {
        client.res.write(heartbeatEvent);
        client.lastActivity = Date.now();
      } catch (e) {
        this.removeClient(clientId);
      }
    }
  }
  
  /**
   * Get connection statistics
   */
  getStats() {
    return {
      activeClients: this.clients.size,
      clients: Array.from(this.clients.entries()).map(([id, client]) => ({
        id,
        subscribedTraders: Array.from(client.subscribedTraders),
        lastActivity: client.lastActivity,
      })),
    };
  }
}

export const aiTraderEvents = new AITraderEventEmitter();

// Heartbeat every 15 seconds - more frequent for reverse proxy compatibility
setInterval(() => aiTraderEvents.heartbeat(), 15000);

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
