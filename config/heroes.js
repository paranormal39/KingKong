/**
 * Hero (Witch) Definitions
 *
 * Each hero is pure data so balancing is config-only. The arena / ability
 * system is server-authoritative: it reads these numbers to validate fire
 * rate, damage, range, ammo, cooldowns, and to apply passive + ability
 * effects. The Unity client mirrors the cosmetic fields for UI/VFX only.
 *
 * Weapon slots: index 0 = slot "1", index 1 = slot "2".
 *   - primary   -> Left Mouse
 *   - secondary -> Right Mouse (alt fire / ADS)
 *
 * Ability slots: tactical (F), special (E), movement (Shift), ultimate (Q).
 * Melee (V) is shared across heroes (see MELEE below).
 * Passives are automatic and evaluated by the ability system.
 *
 * Effect `type` values understood by modules/arena/ability-system.js:
 *   damage_aoe, slow, poison, heal, heal_zone, shield, stun, haste,
 *   dash, blink, knockback, invis, clone, wall
 * Unknown types are treated as a cosmetic no-op (cooldown still applies).
 */

// Shared melee attack (V) - same for every hero.
const MELEE = {
  name: 'Melee',
  damage: 35,
  range: 3,
  cooldownMs: 700
};

/**
 * Helper to build a weapon def with sensible defaults.
 */
function weapon(def) {
  return {
    name: 'Weapon',
    damage: 20,
    range: 60,
    fireIntervalMs: 300,
    magSize: 20,
    reloadMs: 1500,
    pellets: 1,       // >1 = shotgun-style spread (secondary fire)
    headshotMult: 1.5,
    ...def
  };
}

/**
 * Helper to build an ability def with defaults.
 */
function ability(slot, def) {
  return {
    slot,
    name: 'Ability',
    cooldownMs: 8000,
    effect: {},
    description: '',
    ...def
  };
}

const HEROES = {
  ice: {
    id: 'ice',
    name: 'Ice Witch',
    element: 'ice',
    color: '#7FD4FF',
    passive: {
      id: 'frostbite',
      name: 'Frostbite',
      description: 'Consecutive hits build frost; at max stacks the target is slowed.',
      maxStacks: 4,
      stackDurationMs: 3000,
      slowFactor: 0.5,
      slowDurationMs: 2000
    },
    weapons: [
      weapon({ name: 'Frost Bolt', damage: 18, range: 70, fireIntervalMs: 260, magSize: 18, reloadMs: 1500 }),
      weapon({ name: 'Ice Shards', damage: 9, range: 30, fireIntervalMs: 650, magSize: 8, reloadMs: 1800, pellets: 5, spread: 8 })
    ],
    abilities: {
      tactical: ability('tactical', { id: 'ice_wall', name: 'Ice Wall', cooldownMs: 12000, effect: { type: 'wall', durationMs: 5000 }, description: 'Raise a blocking wall of ice.' }),
      special: ability('special', { id: 'cone_freeze', name: 'Cone Freeze', cooldownMs: 9000, effect: { type: 'slow', radius: 12, factor: 0.4, durationMs: 2500 }, description: 'Slow enemies in a cone.' }),
      movement: ability('movement', { id: 'glacial_blink', name: 'Glacial Blink', cooldownMs: 6000, effect: { type: 'blink', distance: 12 }, description: 'Teleport forward.' }),
      ultimate: ability('ultimate', { id: 'frost_nova', name: 'Frost Nova', effect: { type: 'damage_aoe', radius: 14, damage: 55 }, description: 'Freeze and damage all nearby enemies.' })
    }
  },

  lightning: {
    id: 'lightning',
    name: 'Lightning Witch',
    element: 'lightning',
    color: '#FFE55C',
    passive: {
      id: 'static_charge',
      name: 'Static Charge',
      description: 'Moving continuously builds electricity that boosts your next attack.',
      chargePerSecond: 20,
      maxCharge: 100,
      bonusDamageAtMax: 25
    },
    weapons: [
      weapon({ name: 'Chain Lightning', damage: 16, range: 65, fireIntervalMs: 220, magSize: 24, reloadMs: 1400 }),
      weapon({ name: 'Arc Lance', damage: 30, range: 80, fireIntervalMs: 800, magSize: 6, reloadMs: 1700 })
    ],
    abilities: {
      tactical: ability('tactical', { id: 'stun_bolt', name: 'Stun Bolt', cooldownMs: 10000, effect: { type: 'stun', radius: 4, durationMs: 1200 }, description: 'Stun a target.' }),
      special: ability('special', { id: 'overload', name: 'Overload', cooldownMs: 9000, effect: { type: 'damage_aoe', radius: 8, damage: 30 }, description: 'Discharge around you.' }),
      movement: ability('movement', { id: 'speed_surge', name: 'Speed Surge', cooldownMs: 7000, effect: { type: 'haste', factor: 1.6, durationMs: 3000 }, description: 'Sprint for a short time.' }),
      ultimate: ability('ultimate', { id: 'lightning_storm', name: 'Lightning Storm', effect: { type: 'damage_aoe', radius: 16, damage: 50 }, description: 'Call down a storm on an area.' })
    }
  },

  fire: {
    id: 'fire',
    name: 'Fire Witch',
    element: 'fire',
    color: '#FF6B35',
    passive: {
      id: 'inferno',
      name: 'Inferno',
      description: 'Eliminations briefly increase firing speed.',
      fireRateMult: 0.6,   // multiplies fireIntervalMs (lower = faster)
      durationMs: 4000
    },
    weapons: [
      weapon({ name: 'Flame Jet', damage: 10, range: 28, fireIntervalMs: 110, magSize: 40, reloadMs: 1800 }),
      weapon({ name: 'Fireball', damage: 45, range: 60, fireIntervalMs: 900, magSize: 5, reloadMs: 1900, effect: { type: 'damage_aoe', radius: 5, damage: 20 } })
    ],
    abilities: {
      tactical: ability('tactical', { id: 'firewall', name: 'Fire Wall', cooldownMs: 11000, effect: { type: 'wall', durationMs: 4000, damagePerTick: 8 }, description: 'A wall of flame that burns.' }),
      special: ability('special', { id: 'scorch', name: 'Scorch', cooldownMs: 8000, effect: { type: 'poison', stacks: 3, dmgPerTick: 6, durationMs: 4000 }, description: 'Ignite enemies for burn damage.' }),
      movement: ability('movement', { id: 'flame_dash', name: 'Flame Dash', cooldownMs: 6000, effect: { type: 'dash', distance: 10 }, description: 'Dash forward in flames.' }),
      ultimate: ability('ultimate', { id: 'meteor', name: 'Meteor', effect: { type: 'damage_aoe', radius: 12, damage: 70 }, description: 'Drop a meteor on target area.' })
    }
  },

  blood: {
    id: 'blood',
    name: 'Blood Witch',
    element: 'blood',
    color: '#B7121A',
    passive: {
      id: 'bloodlust',
      name: 'Bloodlust',
      description: 'Eliminations restore a portion of health.',
      healOnKill: 40
    },
    weapons: [
      weapon({ name: 'Crimson Bolt', damage: 20, range: 60, fireIntervalMs: 280, magSize: 16, reloadMs: 1500, lifestealFrac: 0.2 }),
      weapon({ name: 'Blood Spray', damage: 10, range: 25, fireIntervalMs: 600, magSize: 10, reloadMs: 1700, pellets: 4, spread: 7, lifestealFrac: 0.15 })
    ],
    abilities: {
      tactical: ability('tactical', { id: 'blood_spike', name: 'Blood Spike', cooldownMs: 9000, effect: { type: 'damage_aoe', radius: 5, damage: 40 }, description: 'Impale an enemy.' }),
      special: ability('special', { id: 'blood_pool', name: 'Blood Pool', cooldownMs: 12000, effect: { type: 'heal', amount: 45 }, description: 'Heal yourself.' }),
      movement: ability('movement', { id: 'blood_rush', name: 'Blood Rush', cooldownMs: 6000, effect: { type: 'dash', distance: 11 }, description: 'Surge forward.' }),
      ultimate: ability('ultimate', { id: 'frenzy', name: 'Frenzy', effect: { type: 'haste', factor: 1.5, durationMs: 6000, lifestealFrac: 0.5 }, description: 'Enter a bloodthirsty frenzy.' })
    }
  },

  voodoo: {
    id: 'voodoo',
    name: 'Voodoo Witch',
    element: 'voodoo',
    color: '#8E44AD',
    passive: {
      id: 'toxic_touch',
      name: 'Toxic Touch',
      description: 'Weapon hits apply small stacks of poison.',
      stackPerHit: 1,
      maxStacks: 6,
      dmgPerTick: 3,
      tickMs: 500,
      durationMs: 3000
    },
    weapons: [
      weapon({ name: 'Cursed Bolt', damage: 15, range: 62, fireIntervalMs: 250, magSize: 18, reloadMs: 1500 }),
      weapon({ name: 'Hex Spray', damage: 8, range: 26, fireIntervalMs: 550, magSize: 12, reloadMs: 1700, pellets: 4, spread: 9 })
    ],
    abilities: {
      tactical: ability('tactical', { id: 'hex_grenade', name: 'Hex Grenade', cooldownMs: 10000, effect: { type: 'poison', radius: 8, stacks: 4, dmgPerTick: 5, durationMs: 4000 }, description: 'Lob a cloud of poison.' }),
      special: ability('special', { id: 'corrosion', name: 'Corrosion', cooldownMs: 9000, effect: { type: 'slow', radius: 7, factor: 0.5, durationMs: 2500 }, description: 'Corrode and slow enemies.' }),
      movement: ability('movement', { id: 'spirit_step', name: 'Spirit Step', cooldownMs: 7000, effect: { type: 'blink', distance: 10 }, description: 'Slip through the spirit realm.' }),
      ultimate: ability('ultimate', { id: 'plague', name: 'Plague', effect: { type: 'poison', radius: 16, stacks: 8, dmgPerTick: 8, durationMs: 6000 }, description: 'Unleash a devastating plague.' })
    }
  },

  halo: {
    id: 'halo',
    name: 'Halo Witch',
    element: 'holy',
    color: '#F5E663',
    passive: {
      id: 'divine_grace',
      name: 'Divine Grace',
      description: 'Staying out of combat gradually regenerates health.',
      outOfCombatMs: 4000,
      regenPerSecond: 12
    },
    weapons: [
      weapon({ name: 'Holy Bolt', damage: 19, range: 68, fireIntervalMs: 270, magSize: 16, reloadMs: 1500 }),
      weapon({ name: 'Radiance', damage: 34, range: 85, fireIntervalMs: 850, magSize: 6, reloadMs: 1700 })
    ],
    abilities: {
      tactical: ability('tactical', { id: 'divine_shield', name: 'Divine Shield', cooldownMs: 11000, effect: { type: 'shield', amount: 50, durationMs: 4000 }, description: 'Absorb incoming damage.' }),
      special: ability('special', { id: 'cleanse', name: 'Cleanse', cooldownMs: 9000, effect: { type: 'heal', amount: 30, cleanse: true }, description: 'Heal and remove debuffs.' }),
      movement: ability('movement', { id: 'light_step', name: 'Light Step', cooldownMs: 6000, effect: { type: 'haste', factor: 1.5, durationMs: 2500 }, description: 'Move with angelic speed.' }),
      ultimate: ability('ultimate', { id: 'sanctuary', name: 'Sanctuary', effect: { type: 'heal_zone', radius: 10, healPerSecond: 20, durationMs: 5000 }, description: 'Create a healing sanctuary.' })
    }
  },

  brujeria: {
    id: 'brujeria',
    name: 'Brujeria Witch',
    element: 'shadow',
    color: '#4B367C',
    passive: {
      id: 'umbral_veil',
      name: 'Umbral Veil',
      description: 'Becomes partially invisible when staying still and not attacking.',
      idleMs: 1500,       // time still+silent before stealth engages
      breaksOnMove: true,
      breaksOnFire: true
    },
    weapons: [
      weapon({ name: 'Dark Bolt', damage: 22, range: 64, fireIntervalMs: 300, magSize: 14, reloadMs: 1500, stealthBonusMult: 1.5 }),
      weapon({ name: 'Shade Daggers', damage: 11, range: 30, fireIntervalMs: 500, magSize: 10, reloadMs: 1600, pellets: 3, spread: 6 })
    ],
    abilities: {
      tactical: ability('tactical', { id: 'smoke', name: 'Smoke Veil', cooldownMs: 10000, effect: { type: 'invis', durationMs: 3000 }, description: 'Vanish in a cloud of smoke.' }),
      special: ability('special', { id: 'curse', name: 'Curse', cooldownMs: 9000, effect: { type: 'slow', radius: 6, factor: 0.5, durationMs: 2500 }, description: 'Hex a target with a slowing curse.' }),
      movement: ability('movement', { id: 'shadow_blink', name: 'Shadow Blink', cooldownMs: 6000, effect: { type: 'blink', distance: 13 }, description: 'Blink through the shadows.' }),
      ultimate: ability('ultimate', { id: 'shadow_clone', name: 'Shadow Clone', effect: { type: 'clone', durationMs: 6000 }, description: 'Summon a decoy clone and vanish.' })
    }
  },

  earth: {
    id: 'earth',
    name: 'Earth Witch',
    element: 'earth',
    color: '#8C6D46',
    passive: {
      id: 'stoneguard',
      name: 'Stoneguard',
      description: 'Takes reduced damage while crouched or standing still.',
      damageReduction: 0.4,   // 40% less damage while guarding
      stillMs: 600            // must be still/crouched this long
    },
    weapons: [
      weapon({ name: 'Rock Shard', damage: 24, range: 58, fireIntervalMs: 340, magSize: 12, reloadMs: 1600 }),
      weapon({ name: 'Gravel Blast', damage: 12, range: 24, fireIntervalMs: 650, magSize: 8, reloadMs: 1800, pellets: 6, spread: 10 })
    ],
    abilities: {
      tactical: ability('tactical', { id: 'barrier', name: 'Stone Barrier', cooldownMs: 11000, effect: { type: 'wall', durationMs: 6000 }, description: 'Raise a wall of stone.' }),
      special: ability('special', { id: 'ground_slam', name: 'Ground Slam', cooldownMs: 9000, effect: { type: 'knockback', radius: 8, force: 12, damage: 25 }, description: 'Slam the ground, knocking enemies back.' }),
      movement: ability('movement', { id: 'tremor_dash', name: 'Tremor Dash', cooldownMs: 6000, effect: { type: 'dash', distance: 9 }, description: 'Charge forward through the earth.' }),
      ultimate: ability('ultimate', { id: 'seismic_stomp', name: 'Seismic Stomp', effect: { type: 'damage_aoe', radius: 15, damage: 60, knockback: 14 }, description: 'Shatter the ground around you.' })
    }
  }
};

module.exports = {
  HEROES,
  MELEE,
  HERO_IDS: Object.keys(HEROES),
  getHero(id) {
    return HEROES[id] || null;
  },
  isValidHero(id) {
    return Object.prototype.hasOwnProperty.call(HEROES, id);
  }
};
