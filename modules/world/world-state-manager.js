/**
 * World State Manager (per-arena)
 *
 * Server-authoritative table of in-world players + bots for ONE arena
 * instance. Clients report positions via MOVE; the server validates them
 * (bounds + speed) and the owning Arena broadcasts the canonical snapshot
 * every tick. Combat damage, status effects, ammo, cooldowns and ultimate
 * charge all live on the per-player entry here; the AbilitySystem reads and
 * mutates these fields.
 */
const logger = require('../../utils/logger');
const CONFIG = require('../../config/constants');
const { getHero, MELEE } = require('../../config/heroes');

class WorldStateManager {
  constructor(options = {}) {
    // playerId -> entry (see addPlayer)
    this.players = new Map();
    this.bound = options.bound ?? CONFIG.WORLD.BOUND;
    this.minY = options.minY ?? CONFIG.WORLD.MIN_Y;
    this.maxY = options.maxY ?? CONFIG.WORLD.MAX_Y;
    // Spawns are spread across most of the arena (not clustered at origin).
    this.spawnSpread = options.spawnSpread ?? this.bound * 0.8;
    this.label = options.label || 'WORLD';
  }

  /**
   * Pick a spawn spread across the arena and, when possible, far from other
   * living players. Samples several candidates and keeps the one that
   * maximises the distance to the nearest living combatant.
   * @param {string} excludeId - player being (re)spawned, ignored in the check
   */
  assignSpawn(excludeId = null) {
    let best = null;
    let bestMinDist = -1;
    for (let i = 0; i < 12; i++) {
      // uniform point in a disk of radius spawnSpread
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * this.spawnSpread;
      const cand = { x: Math.cos(angle) * radius, y: 0.1, z: Math.sin(angle) * radius };

      let minDist = Infinity;
      for (const [id, e] of this.players.entries()) {
        if (id === excludeId || !e.alive) continue;
        const d = Math.sqrt((cand.x - e.x) ** 2 + (cand.z - e.z) ** 2);
        if (d < minDist) minDist = d;
      }

      if (minDist > bestMinDist) { bestMinDist = minDist; best = cand; }
    }
    return best || { x: 0, y: 0.1, z: 0 };
  }

  /**
   * Register a player/bot in the world.
   * @param {Object} p - { playerId, clientId, displayName, hero, team, isBot }
   */
  addPlayer(p) {
    const existing = this.players.get(p.playerId);
    if (existing) {
      existing.clientId = p.clientId ?? existing.clientId;
      return existing;
    }

    const hero = getHero(p.hero) || null;
    const weapon = hero ? hero.weapons[0] : null;
    const spawn = this.assignSpawn();

    const entry = {
      clientId: p.clientId || null,
      playerId: p.playerId,
      displayName: p.displayName || p.playerId,
      hero: p.hero || null,
      team: p.team ?? null,
      isBot: !!p.isBot,

      x: spawn.x, y: spawn.y, z: spawn.z, yaw: 0,
      crouching: false,

      hp: CONFIG.COMBAT.MAX_HP,
      maxHp: CONFIG.COMBAT.MAX_HP,
      shield: 0,
      alive: true,
      respawnAt: 0,

      weaponSlot: 0,
      ammo: weapon ? weapon.magSize : CONFIG.COMBAT.MAX_HP,
      reloadingUntil: 0,

      lastShotAt: 0,
      lastMoveAt: 0,
      lastDamageAt: 0,
      stillSince: Date.now(),

      score: 0,     // kills
      deaths: 0,

      ultCharge: 0,
      cooldowns: { tactical: 0, special: 0, movement: 0, ultimate: 0 },

      // generic status containers (semantics owned by AbilitySystem)
      statuses: {},        // { slow:{until,factor}, stun:{until}, haste:{until,factor}, invis:{until}, shieldUntil }
      poison: [],          // [{ dmgPerTick, until, nextTick }]
      passive: {}          // per-hero scratch (frost stacks, static charge, inferno, etc.)
    };

    this.players.set(p.playerId, entry);
    logger.debug(this.label, `${p.playerId} entered (${entry.hero || 'no-hero'})`);
    return entry;
  }

  get(playerId) {
    return this.players.get(playerId);
  }

  removePlayer(playerId) {
    if (this.players.delete(playerId)) {
      logger.debug(this.label, `${playerId} left`);
    }
  }

  removePlayerByClient(clientId) {
    for (const [playerId, entry] of this.players.entries()) {
      if (entry.clientId === clientId) {
        this.players.delete(playerId);
        return playerId;
      }
    }
    return null;
  }

  /** Current weapon definition for an entry (falls back to defaults). */
  weaponFor(entry) {
    const hero = getHero(entry.hero);
    if (hero && hero.weapons[entry.weaponSlot]) return hero.weapons[entry.weaponSlot];
    return {
      name: 'Default', damage: CONFIG.COMBAT.SHOT_DAMAGE, range: CONFIG.COMBAT.SHOT_RANGE,
      fireIntervalMs: CONFIG.COMBAT.FIRE_INTERVAL_MS, magSize: 30, reloadMs: 1500, pellets: 1
    };
  }

  /**
   * Validate and accept a reported position.
   * Accepts optional crouch flag. Rejects teleports; clamps to bounds.
   */
  updatePosition(playerId, data) {
    const entry = this.players.get(playerId);
    if (!entry || !entry.alive) return false;

    let { x, y, z, yaw } = data || {};
    x = Number(x); y = Number(y); z = Number(z); yaw = Number(yaw) || 0;
    if (!isFinite(x) || !isFinite(y) || !isFinite(z) || !isFinite(yaw)) return false;

    const now = Date.now();
    const moved = (x - entry.x) ** 2 + (y - entry.y) ** 2 + (z - entry.z) ** 2;

    if (entry.lastMoveAt > 0) {
      const dt = Math.max((now - entry.lastMoveAt) / 1000, 0.001);
      const speed = Math.sqrt(moved) / dt;
      if (speed > CONFIG.WORLD.MAX_SPEED * CONFIG.WORLD.SPEED_SLACK) {
        logger.debug(this.label, `Rejected move for ${playerId}: ${speed.toFixed(1)} u/s`);
        return false;
      }
    }

    entry.x = Math.max(-this.bound, Math.min(this.bound, x));
    entry.z = Math.max(-this.bound, Math.min(this.bound, z));
    entry.y = Math.max(this.minY, Math.min(this.maxY, y));
    entry.yaw = yaw;
    entry.lastMoveAt = now;
    if (typeof data.crouch === 'boolean') entry.crouching = data.crouch;

    // Track "stillness" for Stoneguard / Umbral Veil passives
    if (moved > 0.04 || (!entry.crouching && data.crouch === false)) {
      entry.stillSince = now;
    }
    return true;
  }

  /** Teleport an entry (used by dash/blink abilities), clamped to bounds. */
  teleport(entry, x, y, z) {
    entry.x = Math.max(-this.bound, Math.min(this.bound, x));
    entry.z = Math.max(-this.bound, Math.min(this.bound, z));
    entry.y = Math.max(this.minY, Math.min(this.maxY, y));
    entry.lastMoveAt = Date.now();
    entry.stillSince = Date.now();
  }

  distance(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
  }

  /**
   * Apply damage to a target. Honours shield, Stoneguard reduction, and
   * records damage time (for Divine Grace out-of-combat regen).
   * @returns {Object|null} { hit, killed, hp } or null if target invalid
   */
  applyDamage(targetId, amount, sourceId = null) {
    const target = this.players.get(targetId);
    if (!target || !target.alive) return null;

    let dmg = Math.max(0, amount);

    // Stoneguard passive: reduced damage while crouched / standing still
    const hero = getHero(target.hero);
    if (hero && hero.passive && hero.passive.id === 'stoneguard') {
      const still = Date.now() - target.stillSince >= hero.passive.stillMs;
      if (target.crouching || still) dmg *= (1 - hero.passive.damageReduction);
    }

    // Shield soaks damage first
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, dmg);
      target.shield -= absorbed;
      dmg -= absorbed;
    }

    target.hp = Math.max(0, target.hp - dmg);
    target.lastDamageAt = Date.now();

    const killed = target.hp <= 0;
    if (killed) {
      target.alive = false;
      target.deaths += 1;
      target.respawnAt = Date.now() + CONFIG.COMBAT.RESPAWN_MS;
      target.statuses = {};
      target.poison = [];
      logger.debug(this.label, `${sourceId || '?'} eliminated ${targetId}`);
    }
    return { hit: true, killed, hp: target.hp };
  }

  /** Heal an entry up to maxHp. */
  heal(entry, amount) {
    if (!entry || !entry.alive) return;
    entry.hp = Math.min(entry.maxHp, entry.hp + Math.max(0, amount));
  }

  /**
   * Respawn dead players whose timer elapsed. Returns respawned entries.
   */
  checkRespawns() {
    const now = Date.now();
    const respawned = [];
    for (const [playerId, e] of this.players.entries()) {
      if (!e.alive && e.respawnAt > 0 && now >= e.respawnAt) {
        const spawn = this.assignSpawn(playerId);
        e.x = spawn.x; e.y = spawn.y; e.z = spawn.z;
        e.hp = e.maxHp;
        e.shield = 0;
        e.alive = true;
        e.respawnAt = 0;
        e.lastMoveAt = 0;
        e.stillSince = now;
        e.ammo = this.weaponFor(e).magSize;
        e.reloadingUntil = 0;
        e.statuses = {};
        e.poison = [];
        respawned.push({ playerId, displayName: e.displayName, spawn });
      }
    }
    return respawned;
  }

  /** Canonical snapshot for broadcast (one arena). */
  getSnapshot() {
    const now = Date.now();
    const players = [];
    for (const [playerId, e] of this.players.entries()) {
      const s = e.statuses || {};
      players.push({
        playerId,
        displayName: e.displayName,
        hero: e.hero,
        team: e.team,
        isBot: e.isBot,
        x: e.x, y: e.y, z: e.z, yaw: e.yaw,
        crouch: e.crouching,
        hp: e.hp, maxHp: e.maxHp, shield: Math.round(e.shield),
        alive: e.alive,
        ammo: e.ammo,
        reloading: now < e.reloadingUntil,
        weaponSlot: e.weaponSlot,
        score: e.score, deaths: e.deaths,
        ultCharge: Math.round(e.ultCharge),
        // compact status flags for client VFX
        fx: {
          slow: !!(s.slow && s.slow.until > now),
          stun: !!(s.stun && s.stun.until > now),
          haste: !!(s.haste && s.haste.until > now),
          invis: !!(s.invis && s.invis.until > now) || this.isStealthed(e, now),
          shield: e.shield > 0,
          poison: Array.isArray(e.poison) && e.poison.some(p => p.until > now)
        }
      });
    }
    return players;
  }

  /** Umbral Veil: stealth while still + not recently firing. */
  isStealthed(e, now = Date.now()) {
    const hero = getHero(e.hero);
    if (!hero || !hero.passive || hero.passive.id !== 'umbral_veil') return false;
    if (!e.alive) return false;
    const stillLong = now - e.stillSince >= hero.passive.idleMs;
    const notFiring = now - e.lastShotAt >= hero.passive.idleMs;
    return stillLong && notFiring;
  }
}

module.exports = WorldStateManager;
module.exports.MELEE = MELEE;
