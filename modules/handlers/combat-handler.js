/**
 * Combat Handler (arena-scoped)
 * Routes in-match combat actions to the player's arena. The arena + ability
 * system are server-authoritative: they validate ammo, fire rate, range,
 * cooldowns and apply damage / effects.
 *
 * - PRIMARY_FIRE   { targetId }   Left Mouse
 * - SECONDARY_FIRE { targetId }   Right Mouse (alt fire)
 * - RELOAD                        R
 * - MELEE          { targetId }   V
 * - WEAPON_SWITCH  { slot }       1 / 2
 * - ABILITY        { slot }       F (tactical) / E (special) / Shift (movement) / Q (ultimate)
 */
const BaseHandler = require('./base-handler');
const CONFIG = require('../../config/constants');

class CombatHandler extends BaseHandler {
  constructor() {
    super('COMBAT');
    this.registerHandlers();
  }

  registerHandlers() {
    this.register('PRIMARY_FIRE', this.handlePrimaryFire.bind(this));
    this.register('SECONDARY_FIRE', this.handleSecondaryFire.bind(this));
    this.register('RELOAD', this.handleReload.bind(this));
    this.register('MELEE', this.handleMelee.bind(this));
    this.register('WEAPON_SWITCH', this.handleWeaponSwitch.bind(this));
    this.register('ABILITY', this.handleAbility.bind(this));
  }

  payload(context, key) {
    const v = context.message[key];
    return (v && typeof v === 'object') ? v : context.message;
  }

  handlePrimaryFire(context) {
    const playerId = this.requirePlayer(context, 'Must be in a match to fire');
    const data = this.payload(context, 'PRIMARY_FIRE');
    context.services.arenaManager.routeFire(playerId, data.targetId || null);
  }

  handleSecondaryFire(context) {
    const playerId = this.requirePlayer(context, 'Must be in a match to fire');
    const data = this.payload(context, 'SECONDARY_FIRE');
    context.services.arenaManager.routeFire(playerId, data.targetId || null);
  }

  handleReload(context) {
    const playerId = this.requirePlayer(context);
    context.services.arenaManager.routeReload(playerId);
  }

  handleMelee(context) {
    const playerId = this.requirePlayer(context);
    const data = this.payload(context, 'MELEE');
    context.services.arenaManager.routeMelee(playerId, data.targetId || null);
  }

  handleWeaponSwitch(context) {
    const playerId = this.requirePlayer(context);
    const data = this.payload(context, 'WEAPON_SWITCH');
    const slot = Number(data.slot) === 1 ? 1 : 0;
    context.services.arenaManager.routeSwitch(playerId, slot);
  }

  handleAbility(context) {
    const playerId = this.requirePlayer(context);
    const data = this.payload(context, 'ABILITY');
    const slot = data.slot;
    if (!CONFIG.ABILITY.SLOTS.includes(slot)) return;
    context.services.arenaManager.routeAbility(playerId, slot);
  }
}

module.exports = CombatHandler;
