/**
 * Presence Handler
 * Player world-state messages:
 * - MOVE: report position (server validates + stores; broadcast on tick)
 */
const BaseHandler = require('./base-handler');
const logger = require('../../utils/logger');

class PresenceHandler extends BaseHandler {
  constructor() {
    super('PRESENCE');
    this.registerHandlers();
  }

  registerHandlers() {
    this.register('MOVE', this.handleMove.bind(this));
  }

  /**
   * MOVE message: { MOVE: { x, y, z, yaw } }
   * No response - the world-state broadcast is the reply.
   */
  async handleMove(context) {
    const playerId = this.requirePlayer(context, 'Must be logged in to move');
    const { worldState } = context.services;

    // Accept { MOVE: { x, y, z, yaw } } and flat { MOVE: true, x, y, z, yaw }
    const moveData = (context.message.MOVE && typeof context.message.MOVE === 'object')
      ? context.message.MOVE
      : context.message;

    const accepted = worldState.updatePosition(playerId, moveData);
    if (!accepted) {
      logger.debug('PRESENCE', `Move rejected for ${playerId}`);
    }
  }

  /**
   * Clean up world presence when a client disconnects.
   */
  onDisconnect(clientid) {
    const { worldState, clientManager } = this.services || {};
    if (!worldState) return;

    const client = clientManager?.getClient(clientid);
    if (client?.playerId) {
      worldState.removePlayer(client.playerId);
    } else {
      worldState.removePlayerByClient(clientid);
    }
  }
}

module.exports = PresenceHandler;
