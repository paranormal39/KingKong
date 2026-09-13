/**
 * Client Manager
 * Manages WebSocket client connections, rate limiting, and client state
 */
const logger = require('../../utils/logger');
const CONFIG = require('../../config/constants');

class ClientManager {
  constructor() {
    this.clients = new Map(); // clientId -> { ws, playerId, playerName, sessionToken, ... }
    this.rateLimits = new Map(); // clientId -> { count, resetTime }
    this.totalConnections = 0;
    this.RATE_LIMIT_WINDOW = CONFIG.RATE_LIMIT_WINDOW || 60000;
    this.RATE_LIMIT_MAX = CONFIG.RATE_LIMIT_MAX || 30;
  }

  /**
   * Generate unique client ID
   */
  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Register a new client connection
   */
  addClient(ws, req) {
    const clientId = this.generateClientId();
    ws.id = clientId;
    ws.isAlive = true;

    this.clients.set(clientId, {
      ws,
      playerId: '',
      playerName: '',
      sessionToken: '',
      usertoken: '',
      connectedAt: new Date().toISOString()
    });

    this.totalConnections++;
    logger.info('CLIENT', `Client ${clientId} connected. Total: ${this.clients.size}`);

    return clientId;
  }

  /**
   * Remove a client connection
   */
  removeClient(clientId) {
    const clientData = this.clients.get(clientId);
    if (clientData) {
      this.clients.delete(clientId);
      this.rateLimits.delete(clientId);
      logger.info('CLIENT', `Client ${clientId} disconnected. Total: ${this.clients.size}`);
      return clientData;
    }
    return null;
  }

  /**
   * Get client data
   */
  getClient(clientId) {
    return this.clients.get(clientId);
  }

  /**
   * Get all clients
   */
  getAllClients() {
    return this.clients;
  }

  /**
   * Check rate limit for a client
   * @returns {boolean} true if within limit, false if exceeded
   */
  checkRateLimit(clientId) {
    const now = Date.now();
    const limit = this.rateLimits.get(clientId);

    if (limit) {
      if (now > limit.resetTime) {
        // Reset window
        this.rateLimits.set(clientId, { count: 1, resetTime: now + this.RATE_LIMIT_WINDOW });
        return true;
      } else {
        limit.count++;
        if (limit.count > this.RATE_LIMIT_MAX) {
          logger.warn('RATE_LIMIT', `Client ${clientId} exceeded rate limit`);
          return false;
        }
        return true;
      }
    } else {
      // First message
      this.rateLimits.set(clientId, { count: 1, resetTime: now + this.RATE_LIMIT_WINDOW });
      return true;
    }
  }

  /**
   * Check if player is already connected
   */
  isPlayerConnected(playerId, excludeClientId = null) {
    for (const [clientId, clientData] of this.clients.entries()) {
      if (clientData.playerId === playerId && clientId !== excludeClientId) {
        return { isConnected: true, existingClientId: clientId };
      }
    }
    return { isConnected: false, existingClientId: null };
  }

  /**
   * Disconnect existing player connection (for duplicate handling)
   */
  disconnectDuplicatePlayer(playerId, newClientId) {
    for (const [clientId, clientData] of this.clients.entries()) {
      if (clientData.playerId === playerId && clientId !== newClientId) {
        logger.warn('SECURITY', `Duplicate player ${playerId}. Disconnecting ${clientId}`);

        if (clientData.ws && clientData.ws.readyState === 1) {
          this.sendAsBytes(clientData.ws, {
            DUPLICATE_CONNECTION: true,
            message: 'Another device has connected with this player ID.'
          });
          clientData.ws.close();
        }

        this.clients.delete(clientId);
        this.rateLimits.delete(clientId);
        return true;
      }
    }
    return false;
  }

  /**
   * Set player identity for client
   */
  setPlayer(clientId, playerId, playerName = 'Adventurer') {
    const client = this.clients.get(clientId);
    if (client) {
      client.playerId = playerId;
      client.playerName = playerName;
      return true;
    }
    return false;
  }

  /**
   * Set usertoken for client (used for XOR payload decoding)
   */
  setUsertoken(clientId, usertoken) {
    const client = this.clients.get(clientId);
    if (client) {
      client.usertoken = usertoken;
      return true;
    }
    return false;
  }

  /**
   * Get client by player ID
   */
  getClientByPlayerId(playerId) {
    for (const [clientId, clientData] of this.clients.entries()) {
      if (clientData.playerId === playerId) {
        return { clientId, ...clientData };
      }
    }
    return null;
  }

  /**
   * Send data as bytes (Buffer) for Unity WebGL compatibility
   */
  sendAsBytes(ws, data) {
    if (ws && ws.readyState === 1) {
      const jsonString = typeof data === 'string' ? data : JSON.stringify(data);
      const buffer = Buffer.from(jsonString, 'utf-8');
      ws.send(buffer);
    }
  }

  /**
   * Broadcast to all clients
   */
  broadcast(data, filter = null) {
    for (const [clientId, clientData] of this.clients.entries()) {
      if (clientData.ws && clientData.ws.readyState === 1) {
        if (!filter || filter(clientId, clientData)) {
          this.sendAsBytes(clientData.ws, data);
        }
      }
    }
  }

  /**
   * Get connection statistics
   */
  getStats() {
    let playerCount = 0;

    for (const [, clientData] of this.clients.entries()) {
      if (clientData.playerId) playerCount++;
    }

    return {
      totalConnections: this.totalConnections,
      activeConnections: this.clients.size,
      connectedPlayers: playerCount
    };
  }

  /**
   * Heartbeat check - mark client as alive
   */
  heartbeat(clientId) {
    const client = this.clients.get(clientId);
    if (client && client.ws) {
      client.ws.isAlive = true;
    }
  }

  /**
   * Check all clients for dead connections
   */
  checkDeadConnections() {
    const deadClients = [];

    for (const [clientId, clientData] of this.clients.entries()) {
      if (clientData.ws) {
        if (clientData.ws.isAlive === false) {
          deadClients.push(clientId);
          clientData.ws.terminate();
        } else {
          clientData.ws.isAlive = false;
          clientData.ws.ping();
        }
      }
    }

    // Clean up dead clients
    deadClients.forEach(clientId => this.removeClient(clientId));

    if (deadClients.length > 0) {
      logger.info('CLIENT', `Cleaned up ${deadClients.length} dead connections`);
    }

    return deadClients;
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new ClientManager();
  }
  return instance;
}

module.exports = {
  ClientManager,
  getInstance
};
