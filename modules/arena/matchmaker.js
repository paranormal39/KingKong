/**
 * Matchmaker - per-mode queues that form bot-fillable arenas.
 *
 * A single human can start a match: we wait up to QUEUE_WAIT_MS for more
 * humans to join, then form the arena and let the ArenaManager fill the
 * remaining slots with bots. If the arena reaches human capacity sooner, we
 * form it immediately.
 */
const logger = require('../../utils/logger');
const CONFIG = require('../../config/constants');
const { getMode, isEnabled, capacity } = require('../../config/modes');

class Matchmaker {
  constructor(arenaManager) {
    this.arenaManager = arenaManager;
    this.queues = new Map();  // modeId -> [{ playerId, clientId, displayName }]
    this.timers = new Map();  // modeId -> timeout handle
  }

  getQueue(modeId) {
    if (!this.queues.has(modeId)) this.queues.set(modeId, []);
    return this.queues.get(modeId);
  }

  inAnyQueue(playerId) {
    for (const q of this.queues.values()) {
      if (q.some(p => p.playerId === playerId)) return true;
    }
    return false;
  }

  join(playerId, clientId, displayName, modeId) {
    const mode = getMode(modeId);
    if (!mode || !isEnabled(modeId)) {
      return { ok: false, reason: 'mode-unavailable' };
    }
    if (this.inAnyQueue(playerId) || this.arenaManager.arenaForPlayer(playerId)) {
      return { ok: false, reason: 'already-queued' };
    }

    const q = this.getQueue(modeId);
    q.push({ playerId, clientId, displayName });
    logger.info('MM', `${playerId} queued for ${modeId} (${q.length}/${capacity(mode)})`);

    this.broadcastQueue(modeId);

    if (q.length >= capacity(mode)) {
      this.form(modeId);
    } else if (!this.timers.has(modeId)) {
      this.timers.set(modeId, setTimeout(() => this.form(modeId), CONFIG.ARENA.QUEUE_WAIT_MS));
    }
    return { ok: true, mode: modeId };
  }

  leave(playerId) {
    for (const [modeId, q] of this.queues.entries()) {
      const idx = q.findIndex(p => p.playerId === playerId);
      if (idx > -1) {
        q.splice(idx, 1);
        logger.info('MM', `${playerId} left queue ${modeId}`);
        if (q.length === 0 && this.timers.has(modeId)) {
          clearTimeout(this.timers.get(modeId));
          this.timers.delete(modeId);
        } else {
          this.broadcastQueue(modeId);
        }
        return true;
      }
    }
    return false;
  }

  form(modeId) {
    if (this.timers.has(modeId)) {
      clearTimeout(this.timers.get(modeId));
      this.timers.delete(modeId);
    }

    const mode = getMode(modeId);
    const q = this.getQueue(modeId);
    if (!mode || q.length < CONFIG.ARENA.MIN_HUMANS_TO_START) return;

    const group = q.splice(0, capacity(mode));
    const arena = this.arenaManager.createArena(mode);
    for (const p of group) {
      arena.addHuman({ playerId: p.playerId, clientId: p.clientId, displayName: p.displayName });
      this.arenaManager.placePlayer(p.playerId, arena);
    }
    arena.broadcastHeroSelectState();
    logger.info('MM', `Formed ${arena.id} for ${modeId} with ${group.length} human(s)`);

    // If more remain queued, arm another timer
    if (q.length >= CONFIG.ARENA.MIN_HUMANS_TO_START && !this.timers.has(modeId)) {
      this.timers.set(modeId, setTimeout(() => this.form(modeId), CONFIG.ARENA.QUEUE_WAIT_MS));
    }
  }

  broadcastQueue(modeId) {
    const mode = getMode(modeId);
    const q = this.getQueue(modeId);
    const payload = {
      QUEUE_STATUS: {
        mode: modeId,
        queued: q.length,
        needed: capacity(mode),
        waitMs: CONFIG.ARENA.QUEUE_WAIT_MS
      }
    };
    for (const p of q) this.arenaManager.sendToClient(p.clientId, payload);
  }
}

module.exports = Matchmaker;
