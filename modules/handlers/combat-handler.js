/**
 * Combat Handler
 * Shooting / damage / kills:
 * - SHOOT: { SHOOT: { targetId } } - client raycast hit report,
 *   server validates range + fire rate, applies damage, records kills.
 */
const BaseHandler = require('./base-handler');
const logger = require('../../utils/logger');
const CONFIG = require('../../config/constants');

class CombatHandler extends BaseHandler {
  constructor() {
    super('COMBAT');
    this.registerHandlers();
  }

  registerHandlers() {
    this.register('SHOOT', this.handleShoot.bind(this));
  }

  async handleShoot(context) {
    const playerId = this.requirePlayer(context, 'Must be logged in to shoot');
    const { worldState, teamManager, clientManager } = context.services;

    const shootData = (context.message.SHOOT && typeof context.message.SHOOT === 'object')
      ? context.message.SHOOT
      : context.message;
    const targetId = shootData.targetId;
    if (!targetId || typeof targetId !== 'string') return;

    const result = worldState.applyShot(playerId, targetId);
    if (!result || !result.hit) return;

    if (result.killed) {
      const shooter = worldState.players.get(playerId);
      const victim = worldState.players.get(targetId);

      // Record the kill in persistent stats
      try {
        teamManager.recordKills(playerId, 1);
        teamManager.addLoyaltyPoints(playerId, CONFIG.COMBAT.KILL_LOYALTY, 'pvp_kill');
      } catch (err) {
        logger.warn('COMBAT', `Failed to record kill: ${err.message}`);
      }

      clientManager.broadcast(
        {
          PLAYER_KILLED: {
            victimId: targetId,
            victimName: victim?.displayName || targetId,
            killerId: playerId,
            killerName: shooter?.displayName || playerId,
            respawnIn: CONFIG.COMBAT.RESPAWN_MS
          }
        },
        (cid, cdata) => !!cdata.playerId
      );
    }
  }
}

module.exports = CombatHandler;
