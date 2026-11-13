/**
 * Presence Handler
 * Player world-state messages (arena-scoped):
 * - MOVE: report position + crouch (routed to the player's arena; validated
 *   server-side; the arena's world-state broadcast is the reply).
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
   * MOVE message: { MOVE: { x, y, z, yaw, crouch } }
   * No direct response - the arena world-state broadcast is the reply.
   */
  async handleMove(context) {
    const playerId = this.requirePlayer(context, 'Must be in a match to move');
    const { arenaManager } = context.services;

    const moveData = (context.message.MOVE && typeof context.message.MOVE === 'object')
      ? context.message.MOVE
      : context.message;

    arenaManager.routeMove(playerId, moveData);
  }

  /**
   * Clean up matchmaking + arena presence when a client disconnects.
   */
  onDisconnect(clientid) {
    const { arenaManager, clientManager } = this.services || {};
    if (!arenaManager) return;

    const client = clientManager?.getClient(clientid);
    if (client?.playerId) {
      arenaManager.onPlayerLeft(client.playerId);
    } else {
      logger.debug('PRESENCE', `Disconnect for ${clientid} with no playerId`);
    }
  }
}

module.exports = PresenceHandler;
