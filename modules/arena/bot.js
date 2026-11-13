/**
 * Bot - simple AI that fills empty arena slots so any mode is testable solo.
 *
 * Bots are deliberately simple: wander, acquire the nearest living enemy in
 * aggro range, face + shoot it on the weapon's cadence, occasionally fire an
 * off-cooldown ability, reload when empty, and respawn like any player. The
 * owning Arena calls update() each tick; bots never send WebSocket messages.
 */
const CONFIG = require('../../config/constants');
const { HERO_IDS } = require('../../config/heroes');

const RAD2DEG = 180 / Math.PI;

class Bot {
  constructor(playerId, entry) {
    this.playerId = playerId;
    this.entry = entry;            // its WorldStateManager entry
    this.lastThink = 0;
    this.wander = this.randomWanderTarget();
    this.currentTargetId = null;   // who we're tracking, for reaction delay
    this.aimReadyAt = 0;           // can't shoot until this time (hesitation)
  }

  static pickHero() {
    return HERO_IDS[Math.floor(Math.random() * HERO_IDS.length)];
  }

  randomWanderTarget() {
    const b = CONFIG.WORLD.BOUND * 0.8;
    return { x: (Math.random() * 2 - 1) * b, z: (Math.random() * 2 - 1) * b };
  }

  /**
   * @param {WorldStateManager} world
   * @param {AbilitySystem} abilities
   */
  update(world, abilities) {
    const e = this.entry;
    if (!e || !e.alive) return;

    const now = Date.now();
    const dt = CONFIG.ARENA.TICK_MS / 1000;

    // Acquire nearest living enemy
    let target = null, bestDist = Infinity;
    for (const other of world.players.values()) {
      if (other.playerId === e.playerId || !other.alive) continue;
      if (!abilities.isEnemy(e, other)) continue;
      const d = world.distance(e, other);
      if (d < bestDist) { bestDist = d; target = other; }
    }

    // Decide a movement goal: chase target, else wander
    let goal;
    if (target && bestDist < CONFIG.BOT.AGGRO_RANGE * 1.5) {
      goal = { x: target.x, z: target.z };
      // keep some distance - don't stack on the target
      if (bestDist < 8) goal = { x: e.x, z: e.z };
    } else {
      goal = this.wander;
      if (Math.hypot(e.x - goal.x, e.z - goal.z) < 3) this.wander = this.randomWanderTarget();
    }

    // Move toward goal
    const dx = goal.x - e.x, dz = goal.z - e.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.5) {
      const step = CONFIG.BOT.MOVE_SPEED * dt;
      const nx = e.x + (dx / len) * step;
      const nz = e.z + (dz / len) * step;
      world.updatePosition(e.playerId, { x: nx, y: e.y, z: nz, yaw: e.yaw });
    }

    // Face the target
    if (target) {
      const tdx = target.x - e.x, tdz = target.z - e.z;
      e.yaw = Math.atan2(tdx, tdz) * RAD2DEG;
    }

    // Reaction delay: hesitate after first spotting a (new) target
    if (!target) {
      this.currentTargetId = null;
    } else if (target.playerId !== this.currentTargetId) {
      this.currentTargetId = target.playerId;
      this.aimReadyAt = now + CONFIG.BOT.REACTION_MS * (0.5 + Math.random());
    }

    // Think on a slower cadence than the tick
    if (now - this.lastThink < CONFIG.BOT.THINK_MS) return;
    this.lastThink = now;

    if (!target) return;

    // Reload if dry
    if (e.ammo <= 0) { abilities.reload(world, e); return; }

    // Occasionally use an off-cooldown ability
    if (Math.random() < CONFIG.BOT.ABILITY_CHANCE) {
      const slot = CONFIG.ABILITY.SLOTS[Math.floor(Math.random() * CONFIG.ABILITY.SLOTS.length)];
      const res = abilities.useAbility(world, e, slot);
      if (res.ok) return { ability: res };
    }

    // Shoot only once the reaction delay has elapsed, with hesitation (jitter)
    if (bestDist <= CONFIG.BOT.AGGRO_RANGE
        && now >= this.aimReadyAt
        && Math.random() > CONFIG.BOT.FIRE_JITTER) {
      // Imperfect aim: only some shots are actually on-target; the rest whiff.
      const onTarget = Math.random() < CONFIG.BOT.ACCURACY;
      const res = abilities.fireWeapon(world, e, onTarget ? target.playerId : null);
      if (res.ok) return { fire: res, target };
    }
    return null;
  }
}

module.exports = Bot;
