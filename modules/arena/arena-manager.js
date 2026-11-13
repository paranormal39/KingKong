/**
 * Arena Manager - owns all live arenas + the matchmaker, ticks every arena,
 * and routes inbound move/combat/ability messages from handlers to the right
 * arena. Replaces the old single global world + tap-duel PvP.
 */
const logger = require('../../utils/logger');
const Arena = require('./arena');
const Matchmaker = require('./matchmaker');

class ArenaManager {
  constructor(clientManager, teamManager) {
    this.clientManager = clientManager;
    this.teamManager = teamManager;
    this.arenas = new Map();        // arenaId -> Arena
    this.playerArena = new Map();   // playerId -> arenaId
    this.matchmaker = new Matchmaker(this);
  }

  // ---- matchmaking ----

  joinMatchmaking(playerId, clientId, displayName, modeId) {
    return this.matchmaker.join(playerId, clientId, displayName, modeId);
  }

  leaveMatchmaking(playerId) {
    return this.matchmaker.leave(playerId);
  }

  // ---- arena lifecycle ----

  createArena(mode) {
    const arena = new Arena({
      mode,
      clientManager: this.clientManager,
      teamManager: this.teamManager,
      onClose: (a) => this.destroyArena(a)
    });
    this.arenas.set(arena.id, arena);
    return arena;
  }

  destroyArena(arena) {
    for (const [playerId, arenaId] of this.playerArena.entries()) {
      if (arenaId === arena.id) this.playerArena.delete(playerId);
    }
    this.arenas.delete(arena.id);
    logger.debug('ARENA_MGR', `Destroyed ${arena.id}. Live arenas: ${this.arenas.size}`);
  }

  placePlayer(playerId, arena) {
    this.playerArena.set(playerId, arena.id);
  }

  arenaForPlayer(playerId) {
    const id = this.playerArena.get(playerId);
    return id ? this.arenas.get(id) : null;
  }

  // ---- inbound routing (called by handlers) ----

  selectHero(playerId, heroId) {
    const arena = this.arenaForPlayer(playerId);
    return arena ? arena.selectHero(playerId, heroId) : false;
  }

  lockHero(playerId, heroId) {
    const arena = this.arenaForPlayer(playerId);
    return arena ? arena.lockHero(playerId, heroId) : false;
  }

  routeMove(playerId, data) {
    const arena = this.arenaForPlayer(playerId);
    if (arena) arena.handleMove(playerId, data);
  }

  routeFire(playerId, targetId) {
    const arena = this.arenaForPlayer(playerId);
    if (arena) arena.handleFire(playerId, targetId);
  }

  routeReload(playerId) {
    const arena = this.arenaForPlayer(playerId);
    if (arena) arena.handleReload(playerId);
  }

  routeMelee(playerId, targetId) {
    const arena = this.arenaForPlayer(playerId);
    if (arena) arena.handleMelee(playerId, targetId);
  }

  routeSwitch(playerId, slot) {
    const arena = this.arenaForPlayer(playerId);
    if (arena) arena.handleSwitch(playerId, slot);
  }

  routeAbility(playerId, slot) {
    const arena = this.arenaForPlayer(playerId);
    if (arena) arena.handleAbility(playerId, slot);
  }

  // ---- disconnect / cleanup ----

  onPlayerLeft(playerId) {
    this.matchmaker.leave(playerId);
    const arena = this.arenaForPlayer(playerId);
    if (arena) {
      arena.removePlayer(playerId);
      this.playerArena.delete(playerId);
    }
  }

  // ---- ticking ----

  tickAll() {
    for (const arena of this.arenas.values()) {
      try {
        arena.tick();
      } catch (err) {
        logger.error('ARENA_MGR', `Tick error in ${arena.id}: ${err.message}`);
      }
    }
  }

  // ---- helpers ----

  sendToClient(clientId, data) {
    if (!clientId) return;
    const client = this.clientManager.getClient(clientId);
    if (client && client.ws) this.clientManager.sendAsBytes(client.ws, data);
  }

  getStats() {
    return { arenas: this.arenas.size, playersInArenas: this.playerArena.size };
  }
}

module.exports = ArenaManager;
