/**
 * Ability System (server-authoritative)
 *
 * Owns weapon firing, reloading, melee, hero abilities, status effects
 * (slow / poison / stun / haste / shield / invis), passive evaluation, and
 * ultimate charge. Operates on a per-arena WorldStateManager instance.
 *
 * The Arena calls fireWeapon / reload / melee / useAbility in response to
 * client messages, and tick() every arena tick. All of these return plain
 * result objects; the Arena is responsible for broadcasting them.
 */
const CONFIG = require('../../config/constants');
const { getHero, MELEE } = require('../../config/heroes');

const DEG2RAD = Math.PI / 180;

class AbilitySystem {
  /**
   * @param {Function} isEnemy - (casterEntry, otherEntry) => boolean
   */
  constructor(isEnemy) {
    this.isEnemy = isEnemy || (() => true);
  }

  forward(entry) {
    const r = entry.yaw * DEG2RAD;
    return { x: Math.sin(r), z: Math.cos(r) };
  }

  // =========================================================
  // Firing
  // =========================================================

  /**
   * Fire the current weapon at a reported target.
   * Validates alive / reload / ammo / fire rate / range, applies damage and
   * on-hit passives. Returns { ok, reason?, hit, killed, targetId, hp, ammo }.
   */
  fireWeapon(world, shooter, targetId) {
    if (!shooter || !shooter.alive) return { ok: false, reason: 'dead' };

    const now = Date.now();
    if (now < shooter.reloadingUntil) return { ok: false, reason: 'reloading' };
    if (this.isStunned(shooter, now)) return { ok: false, reason: 'stunned' };

    const weapon = world.weaponFor(shooter);

    // Effective fire interval (Inferno passive speeds this up after a kill)
    let interval = weapon.fireIntervalMs;
    const hero = getHero(shooter.hero);
    if (hero && hero.passive && hero.passive.id === 'inferno'
        && shooter.passive.infernoUntil > now) {
      interval *= hero.passive.fireRateMult;
    }
    if (now - shooter.lastShotAt < interval) return { ok: false, reason: 'cooldown' };

    if (shooter.ammo <= 0) {
      this.reload(world, shooter);
      return { ok: false, reason: 'empty' };
    }

    shooter.lastShotAt = now;
    shooter.ammo -= 1;

    const result = { ok: true, hit: false, killed: false, targetId: null, ammo: shooter.ammo };

    const target = targetId ? world.get(targetId) : null;
    if (!target || !target.alive || target.playerId === shooter.playerId
        || !this.isEnemy(shooter, target)) {
      return result; // a swing-and-a-miss still costs ammo
    }

    // Range check against authoritative positions
    const dist = world.distance(shooter, target);
    if (dist > weapon.range) return result;

    // Base damage (+ static charge / stealth bonuses)
    let damage = weapon.damage;
    damage += this.consumeStaticCharge(shooter, hero);
    if (weapon.stealthBonusMult && world.isStealthed(shooter, now)) {
      damage *= weapon.stealthBonusMult;
    }

    const dmgResult = world.applyDamage(target.playerId, damage, shooter.playerId);
    if (!dmgResult) return result;

    result.hit = true;
    result.targetId = target.playerId;
    result.hp = dmgResult.hp;

    // On-hit passives
    this.applyOnHitPassives(world, shooter, target, hero);

    // Weapon lifesteal
    if (weapon.lifestealFrac) world.heal(shooter, damage * weapon.lifestealFrac);

    if (dmgResult.killed) {
      result.killed = true;
      this.onKill(world, shooter, target, hero);
    }
    return result;
  }

  /** Melee attack (shared V). */
  melee(world, attacker, targetId) {
    if (!attacker || !attacker.alive) return { ok: false, reason: 'dead' };
    const now = Date.now();
    if (now - (attacker.lastMeleeAt || 0) < MELEE.cooldownMs) return { ok: false, reason: 'cooldown' };
    attacker.lastMeleeAt = now;

    const target = targetId ? world.get(targetId) : null;
    const result = { ok: true, hit: false, killed: false, targetId: null };
    if (!target || !target.alive || !this.isEnemy(attacker, target)) return result;
    if (world.distance(attacker, target) > MELEE.range) return result;

    let damage = MELEE.damage;
    // Brujeria backstab: bonus melee damage while stealthed
    if (world.isStealthed(attacker, now)) damage *= 1.5;

    const dmg = world.applyDamage(target.playerId, damage, attacker.playerId);
    if (!dmg) return result;
    result.hit = true;
    result.targetId = target.playerId;
    result.hp = dmg.hp;
    if (dmg.killed) {
      result.killed = true;
      this.onKill(world, attacker, target, getHero(attacker.hero));
    }
    return result;
  }

  /** Begin a reload for the entry's current weapon. */
  reload(world, entry) {
    if (!entry || !entry.alive) return { ok: false };
    const weapon = world.weaponFor(entry);
    if (entry.ammo >= weapon.magSize) return { ok: false, reason: 'full' };
    if (Date.now() < entry.reloadingUntil) return { ok: false, reason: 'reloading' };
    entry.reloadingUntil = Date.now() + weapon.reloadMs;
    return { ok: true, reloadMs: weapon.reloadMs };
  }

  /** Switch weapon slot (0 or 1). */
  switchWeapon(world, entry, slot) {
    const hero = getHero(entry.hero);
    if (!hero || !hero.weapons[slot]) return { ok: false };
    if (entry.weaponSlot === slot) return { ok: false };
    entry.weaponSlot = slot;
    entry.ammo = Math.min(entry.ammo, hero.weapons[slot].magSize);
    entry.reloadingUntil = 0;
    return { ok: true, weaponSlot: slot, ammo: entry.ammo };
  }

  // =========================================================
  // Abilities
  // =========================================================

  /**
   * Use an ability slot (tactical / special / movement / ultimate).
   * Returns { ok, reason?, slot, abilityId, effect, cooldownMs }.
   */
  useAbility(world, caster, slot) {
    if (!caster || !caster.alive) return { ok: false, reason: 'dead' };
    const hero = getHero(caster.hero);
    if (!hero) return { ok: false, reason: 'no-hero' };
    const ability = hero.abilities[slot];
    if (!ability) return { ok: false, reason: 'no-ability' };

    const now = Date.now();
    if (this.isStunned(caster, now)) return { ok: false, reason: 'stunned' };

    if (slot === 'ultimate') {
      if (caster.ultCharge < CONFIG.ABILITY.ULT_CHARGE_NEEDED) {
        return { ok: false, reason: 'charging' };
      }
      caster.ultCharge = 0;
    } else {
      if (now < caster.cooldowns[slot]) return { ok: false, reason: 'cooldown' };
      caster.cooldowns[slot] = now + ability.cooldownMs;
    }

    this.applyEffect(world, caster, ability.effect || {});

    return {
      ok: true,
      slot,
      abilityId: ability.id,
      name: ability.name,
      effect: ability.effect || {},
      cooldownMs: slot === 'ultimate' ? 0 : ability.cooldownMs
    };
  }

  /** Apply an ability's effect to the world. */
  applyEffect(world, caster, effect) {
    const now = Date.now();
    const fwd = this.forward(caster);
    const type = effect.type;

    // center point for offensive AOE: a bit in front of the caster
    const reach = effect.radius ? Math.min(effect.radius, 10) : 6;
    const center = { x: caster.x + fwd.x * reach, y: caster.y, z: caster.z + fwd.z * reach };

    const enemiesInRadius = (point, radius) => {
      const out = [];
      for (const e of world.players.values()) {
        if (e.playerId === caster.playerId || !e.alive || !this.isEnemy(caster, e)) continue;
        const d = Math.sqrt((e.x - point.x) ** 2 + (e.z - point.z) ** 2);
        if (d <= radius) out.push(e);
      }
      return out;
    };

    switch (type) {
    case 'damage_aoe': {
      for (const e of enemiesInRadius(center, effect.radius || 8)) {
        const r = world.applyDamage(e.playerId, effect.damage || 30, caster.playerId);
        if (r && r.killed) this.onKill(world, caster, e, getHero(caster.hero));
        if (effect.knockback) this.knockback(world, caster, e, effect.knockback);
      }
      break;
    }
    case 'slow': {
      for (const e of enemiesInRadius(center, effect.radius || 8)) {
        e.statuses.slow = { until: now + (effect.durationMs || 2000), factor: effect.factor || 0.5 };
      }
      break;
    }
    case 'stun': {
      for (const e of enemiesInRadius(center, effect.radius || 5)) {
        e.statuses.stun = { until: now + (effect.durationMs || 1200) };
      }
      break;
    }
    case 'poison': {
      const radius = effect.radius || 6;
      for (const e of enemiesInRadius(center, radius)) {
        this.addPoison(e, effect.stacks || 3, effect.dmgPerTick || 5, effect.durationMs || 4000);
      }
      break;
    }
    case 'knockback': {
      for (const e of enemiesInRadius(center, effect.radius || 8)) {
        if (effect.damage) {
          const r = world.applyDamage(e.playerId, effect.damage, caster.playerId);
          if (r && r.killed) this.onKill(world, caster, e, getHero(caster.hero));
        }
        this.knockback(world, caster, e, effect.force || 10);
      }
      break;
    }
    case 'heal':
      world.heal(caster, effect.amount || 30);
      if (effect.cleanse) { caster.statuses = {}; caster.poison = []; }
      break;
    case 'heal_zone':
      caster.statuses.healZone = { until: now + (effect.durationMs || 5000), perSecond: effect.healPerSecond || 20 };
      break;
    case 'shield':
      caster.shield = Math.max(caster.shield, effect.amount || 50);
      caster.statuses.shieldUntil = now + (effect.durationMs || 4000);
      break;
    case 'haste':
      caster.statuses.haste = { until: now + (effect.durationMs || 3000), factor: effect.factor || 1.5 };
      if (effect.lifestealFrac) caster.statuses.frenzyLifesteal = effect.lifestealFrac;
      break;
    case 'invis':
      caster.statuses.invis = { until: now + (effect.durationMs || 3000) };
      break;
    case 'dash':
    case 'blink': {
      const dist = effect.distance || 10;
      world.teleport(caster, caster.x + fwd.x * dist, caster.y, caster.z + fwd.z * dist);
      break;
    }
    // wall / clone and unknowns: cosmetic on client; cooldown already applied
    default:
      break;
    }
  }

  knockback(world, caster, target, force) {
    const dx = target.x - caster.x, dz = target.z - caster.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    world.teleport(target, target.x + (dx / len) * force, target.y, target.z + (dz / len) * force);
  }

  // =========================================================
  // Passives
  // =========================================================

  applyOnHitPassives(world, shooter, target, hero) {
    if (!hero || !hero.passive) return;
    const now = Date.now();
    const p = hero.passive;

    if (p.id === 'frostbite') {
      const fs = target.passive.frost || { stacks: 0, expire: 0 };
      fs.stacks = (now < fs.expire ? fs.stacks : 0) + 1;
      fs.expire = now + p.stackDurationMs;
      target.passive.frost = fs;
      if (fs.stacks >= p.maxStacks) {
        target.statuses.slow = { until: now + p.slowDurationMs, factor: p.slowFactor };
        fs.stacks = 0;
      }
    } else if (p.id === 'toxic_touch') {
      this.addPoison(target, p.stackPerHit, p.dmgPerTick, p.durationMs, p.maxStacks);
    }
  }

  /** Lightning Static Charge: consume accumulated charge for bonus damage. */
  consumeStaticCharge(shooter, hero) {
    if (!hero || !hero.passive || hero.passive.id !== 'static_charge') return 0;
    const charge = shooter.passive.charge || 0;
    if (charge <= 0) return 0;
    const bonus = (charge / hero.passive.maxCharge) * hero.passive.bonusDamageAtMax;
    shooter.passive.charge = 0;
    return bonus;
  }

  onKill(world, killer, victim, hero) {
    killer.score += 1;
    killer.ultCharge = Math.min(CONFIG.ABILITY.ULT_CHARGE_NEEDED,
      killer.ultCharge + CONFIG.ABILITY.ULT_CHARGE_PER_KILL);

    if (hero && hero.passive) {
      if (hero.passive.id === 'bloodlust') world.heal(killer, hero.passive.healOnKill);
      if (hero.passive.id === 'inferno') killer.passive.infernoUntil = Date.now() + hero.passive.durationMs;
    }
  }

  addPoison(target, stacks, dmgPerTick, durationMs, maxStacks = 99) {
    const now = Date.now();
    if (!Array.isArray(target.poison)) target.poison = [];
    const active = target.poison.filter(p => p.until > now);
    const toAdd = Math.min(stacks, Math.max(0, maxStacks - active.length));
    for (let i = 0; i < toAdd; i++) {
      active.push({ dmgPerTick, until: now + durationMs, nextTick: now + CONFIG.ABILITY.STATUS_TICK_MS });
    }
    target.poison = active;
  }

  isStunned(entry, now = Date.now()) {
    return !!(entry.statuses && entry.statuses.stun && entry.statuses.stun.until > now);
  }

  // =========================================================
  // Per-tick processing
  // =========================================================

  tick(world) {
    const now = Date.now();
    for (const e of world.players.values()) {
      if (!e.alive) continue;
      const hero = getHero(e.hero);

      // Poison DoT
      if (Array.isArray(e.poison) && e.poison.length) {
        let total = 0;
        for (const p of e.poison) {
          if (p.until <= now) continue;
          while (now >= p.nextTick && p.nextTick <= p.until) {
            total += p.dmgPerTick;
            p.nextTick += CONFIG.ABILITY.STATUS_TICK_MS;
          }
        }
        e.poison = e.poison.filter(p => p.until > now);
        if (total > 0) world.applyDamage(e.playerId, total, null);
      }

      if (!e.alive) continue;

      // Heal zone
      if (e.statuses.healZone && e.statuses.healZone.until > now) {
        world.heal(e, e.statuses.healZone.perSecond * (CONFIG.ARENA.TICK_MS / 1000));
      }

      // Shield expiry
      if (e.statuses.shieldUntil && now >= e.statuses.shieldUntil) {
        e.shield = 0;
        delete e.statuses.shieldUntil;
      }

      // Hero passives that tick over time
      if (hero && hero.passive) {
        if (hero.passive.id === 'static_charge') {
          const moving = now - e.lastMoveAt < 250 && now - e.stillSince < 250;
          if (moving) {
            e.passive.charge = Math.min(hero.passive.maxCharge,
              (e.passive.charge || 0) + hero.passive.chargePerSecond * (CONFIG.ARENA.TICK_MS / 1000));
          }
        } else if (hero.passive.id === 'divine_grace') {
          if (now - e.lastDamageAt >= hero.passive.outOfCombatMs && e.hp < e.maxHp) {
            world.heal(e, hero.passive.regenPerSecond * (CONFIG.ARENA.TICK_MS / 1000));
          }
        }
      }
    }

    // Passive ultimate charge for everyone alive
    for (const e of world.players.values()) {
      if (!e.alive) continue;
      e.ultCharge = Math.min(CONFIG.ABILITY.ULT_CHARGE_NEEDED,
        e.ultCharge + CONFIG.ABILITY.ULT_CHARGE_PER_SECOND * (CONFIG.ARENA.TICK_MS / 1000));
    }
  }
}

module.exports = AbilitySystem;
