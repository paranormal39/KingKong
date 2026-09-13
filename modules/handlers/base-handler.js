/**
 * Base Handler Class
 * All message handlers extend this class to ensure consistent interface
 */
const logger = require('../../utils/logger');

class BaseHandler {
  constructor(name) {
    this.name = name;
    this.handlers = new Map();
  }

  /**
   * Register a message handler
   * @param {string} messageType - The message property to handle (e.g., 'JOIN_QUEUE')
   * @param {Function} handler - Async function(context) where context contains { message, ws, clientid, clientList, wss, services }
   */
  register(messageType, handler) {
    this.handlers.set(messageType, handler);
    logger.info(this.name, `Registered handler for: ${messageType}`);
  }

  /**
   * Check if this handler can process the message
   * @param {Object} message - The parsed JSON message
   * @returns {string|null} - The message type if handled, null otherwise
   */
  canHandle(message) {
    const messageKeys = Object.keys(message);
    for (const [messageType] of this.handlers) {
      if (Object.prototype.hasOwnProperty.call(message, messageType)) {
        logger.debug(this.name, `canHandle found: ${messageType} in [${messageKeys.join(', ')}]`);
        return messageType;
      }
    }
    return null;
  }

  /**
   * Process a message
   * @param {string} messageType - The message type to handle
   * @param {Object} context - Handler context
   * @returns {Promise<boolean>} - True if handled successfully
   */
  async handle(messageType, context) {
    const handler = this.handlers.get(messageType);
    if (!handler) {
      logger.warn(this.name, `No handler found for: ${messageType}`);
      return false;
    }

    try {
      await handler(context);
      return true;
    } catch (error) {
      logger.error(this.name, `Error handling ${messageType}: ${error.message}`);
      this.sendError(context.ws, messageType, error.message);
      return false;
    }
  }

  /**
   * Send a standardized error response
   */
  sendError(ws, messageType, errorMessage) {
    const errorKey = `${messageType}_ERROR`;
    this.sendAsBytes(ws, { [errorKey]: errorMessage });
  }

  /**
   * Send data as bytes (Buffer) for Unity WebGL compatibility
   */
  sendAsBytes(ws, data) {
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
      const jsonString = typeof data === 'string' ? data : JSON.stringify(data);
      const buffer = Buffer.from(jsonString, 'utf-8');
      ws.send(buffer);
    }
  }

  /**
   * Broadcast to all connected clients
   */
  broadcast(wss, data, filter = null) {
    wss.clients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        if (!filter || filter(client)) {
          this.sendAsBytes(client, data);
        }
      }
    });
  }

  /**
   * Broadcast to team members only
   */
  broadcastToTeam(wss, clientList, teamManager, teamId, data, excludeClientId = null) {
    wss.clients.forEach(client => {
      if (client.readyState === 1 && client.id !== excludeClientId) {
        const clientPlayerId = clientList.get(client.id)?.playerId;
        const playerTeam = teamManager.getPlayerTeam(clientPlayerId);
        if (playerTeam && playerTeam.teamId === teamId) {
          this.sendAsBytes(client, data);
        }
      }
    });
  }

  /**
   * Get player ID from client context
   */
  getPlayerId(context) {
    return context.clientList.get(context.clientid)?.playerId;
  }

  /**
   * Validate player is logged in
   */
  requirePlayer(context, errorMessage = 'Not logged in') {
    const playerId = this.getPlayerId(context);
    if (!playerId) {
      throw new Error(errorMessage);
    }
    return playerId;
  }

  /**
   * Validate player is on a team (auto-assigns if missing)
   */
  requireTeam(context, playerId) {
    const { teamManager } = context.services;
    let playerTeam = teamManager.getPlayerTeam(playerId);

    if (!playerTeam) {
      playerTeam = teamManager.ensureTeam(playerId);
      logger.info(this.name, `Emergency team assignment: ${playerId} -> ${playerTeam.teamId}`);
    }

    return playerTeam;
  }
}

module.exports = BaseHandler;
