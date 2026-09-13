/**
 * World State Manager
 * Server-authoritative table of in-world player positions.
 * Clients report positions via MOVE; the server validates them
 * (bounds + speed) and broadcasts the canonical snapshot every tick.
 */
const logger = require('../../utils/logger');
const CONFIG = require('../../config/constants');

class WorldStateManager {
  constructor() {
    // playerId -> { clientId, displayName, team, x, y, z, yaw,
    //               hp, alive, respawnAt, lastShotAt, lastMoveAt }
    this.players = new Map();
  }

  /**
   * Random spawn point inside SPAWN_RADIUS around the world origin.
   */
  assignSpawn() {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * CONFIG.WORLD.SPAWN_RADIUS;
    return {
      x: Math.cos(angle) * radius,
      y: 0.1,
      z: Math.sin(angle) * radius
    };
  }

  /**
   * Register a player in the world. Returns their spawn position.
   */
  addPlayer(playerId, clientId, displayName, team) {
    const existing = this.players.get(playerId);
    if (existing) {
      existing.clientId = clientId;
      return existing;
    }

    const spawn = this.assignSpawn();
    const entry = {
      clientId,
      displayName,
      team,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      yaw: 0,
      hp: CONFIG.COMBAT.MAX_HP,
      alive: true,
      respawnAt: 0,
      lastShotAt: 0,
      lastMoveAt: 0
    };
    this.players.set(playerId, entry);
    logger.info('WORLD', `${playerId} entered world at (${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)})`);
    return entry;
  }

  removePlayer(playerId) {
    if (this.players.delete(playerId)) {
      logger.info('WORLD', `${playerId} left the world`);
    }
  }

  removePlayerByClient(clientId) {
    for (const [playerId, entry] of this.players.entries()) {
      if (entry.clientId === clientId) {
        this.players.delete(playerId);
        logger.info('WORLD', `${playerId} left the world`);
        return playerId;
      }
    }
    return null;
  }

  /**
   * Validate and accept a reported position.
   * Rejects non-finite values and impossible-speed teleports; clamps bounds.
   * @returns {boolean} true if the position was accepted
   */
  updatePosition(playerId, data) {
    const entry = this.players.get(playerId);
    if (!entry || !entry.alive) return false;

    let { x, y, z, yaw } = data || {};
    x = Number(x); y = Number(y); z = Number(z); yaw = Number(yaw) || 0;

    if (!isFinite(x) || !isFinite(y) || !isFinite(z) || !isFinite(yaw)) {
      return false;
    }

    // Speed sanity check (server is source of truth - reject teleports)
    const now = Date.now();
    if (entry.lastMoveAt > 0) {
      const dt = Math.max((now - entry.lastMoveAt) / 1000, 0.001);
      const dx = x - entry.x, dy = y - entry.y, dz = z - entry.z;
      const speed = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
      if (speed > CONFIG.WORLD.MAX_SPEED * CONFIG.WORLD.SPEED_SLACK) {
        logger.warn('WORLD', `Rejected move for ${playerId}: ${speed.toFixed(1)} u/s exceeds limit`);
        return false;
      }
    }

    // Clamp to world bounds
    entry.x = Math.max(-CONFIG.WORLD.BOUND, Math.min(CONFIG.WORLD.BOUND, x));
    entry.z = Math.max(-CONFIG.WORLD.BOUND, Math.min(CONFIG.WORLD.BOUND, z));
    entry.y = Math.max(CONFIG.WORLD.MIN_Y, Math.min(CONFIG.WORLD.MAX_Y, y));
    entry.yaw = yaw;
    entry.lastMoveAt = now;
    return true;
  }

  /**
   * Apply a shot from shooter to target.
   * Validates: both exist + alive, range, fire rate.
   * @returns {Object|null} result with hit/killed flags, or null if rejected
   */
  applyShot(shooterId, targetId) {
    const shooter = this.players.get(shooterId);
    const target = this.players.get(targetId);
    if (!shooter || !target || !shooter.alive || !target.alive) return null;
    if (shooterId === targetId) return null;

    // Fire rate check
    const now = Date.now();
    if (now - shooter.lastShotAt < CONFIG.COMBAT.FIRE_INTERVAL_MS) return null;
    shooter.lastShotAt = now;

    // Range check (3D distance between authoritative positions)
    const dx = target.x - shooter.x;
    const dy = target.y - shooter.y;
    const dz = target.z - shooter.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > CONFIG.COMBAT.SHOT_RANGE) {
      logger.debug('WORLD', `Shot out of range: ${shooterId} -> ${targetId} (${dist.toFixed(1)}u)`);
      return null;
    }

    target.hp = Math.max(0, target.hp - CONFIG.COMBAT.SHOT_DAMAGE);
    const killed = target.hp <= 0;
    if (killed) {
      target.alive = false;
      target.respawnAt = now + CONFIG.COMBAT.RESPAWN_MS;
      logger.info('WORLD', `${shooterId} eliminated ${targetId}`);
    }

    return {
      hit: true,
      killed,
      targetHp: target.hp,
      distance: dist
    };
  }

  /**
   * Respawn dead players whose timer elapsed. Returns list of respawned entries.
   * Called from the broadcast tick.
   */
  checkRespawns() {
    const now = Date.now();
    const respawned = [];
    for (const [playerId, e] of this.players.entries()) {
      if (!e.alive && e.respawnAt > 0 && now >= e.respawnAt) {
        const spawn = this.assignSpawn();
        e.x = spawn.x; e.y = spawn.y; e.z = spawn.z;
        e.hp = CONFIG.COMBAT.MAX_HP;
        e.alive = true;
        e.respawnAt = 0;
        e.lastMoveAt = 0;
        logger.info('WORLD', `${playerId} respawned at (${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)})`);
        respawned.push({ playerId, displayName: e.displayName, spawn });
      }
    }
    return respawned;
  }

  /**
   * Canonical snapshot for broadcast.
   */
  getSnapshot() {
    const players = [];
    for (const [playerId, e] of this.players.entries()) {
      players.push({
        playerId,
        displayName: e.displayName,
        team: e.team,
        x: e.x, y: e.y, z: e.z, yaw: e.yaw,
        hp: e.hp,
        alive: e.alive
      });
    }
    return players;
  }

  /**
   * Broadcast WORLD_STATE to all logged-in clients.
   */
  broadcast(clientManager) {
    this.checkRespawns();
    if (this.players.size === 0) return;
    clientManager.broadcast(
      {
        WORLD_STATE: {
          players: this.getSnapshot(),
          serverTime: Date.now()
        }
      },
      (clientId, clientData) => !!clientData.playerId
    );
  }
}

module.exports = WorldStateManager;
