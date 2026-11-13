/**
 * Matchmaking Handler
 * Menu + lobby flow:
 * - GET_CATALOG      -> list of modes + heroes for the menu / hero selector
 * - JOIN_MATCHMAKING -> { JOIN_MATCHMAKING: { mode } }
 * - LEAVE_MATCHMAKING
 * - SELECT_HERO      -> { SELECT_HERO: { heroId } }   (preview, not locked)
 * - LOCK_HERO        -> { LOCK_HERO: { heroId } }     (commit)
 */
const BaseHandler = require('./base-handler');
const logger = require('../../utils/logger');
const { HEROES } = require('../../config/heroes');
const { MODES } = require('../../config/modes');

class MatchmakingHandler extends BaseHandler {
  constructor() {
    super('MATCHMAKING');
    this.registerHandlers();
  }

  registerHandlers() {
    this.register('GET_CATALOG', this.handleGetCatalog.bind(this));
    this.register('JOIN_MATCHMAKING', this.handleJoin.bind(this));
    this.register('LEAVE_MATCHMAKING', this.handleLeave.bind(this));
    this.register('SELECT_HERO', this.handleSelectHero.bind(this));
    this.register('LOCK_HERO', this.handleLockHero.bind(this));
  }

  payload(context, key) {
    const v = context.message[key];
    return (v && typeof v === 'object') ? v : context.message;
  }

  handleGetCatalog(context) {
    const modes = Object.values(MODES).map(m => ({
      id: m.id, name: m.name, enabled: m.enabled,
      teams: m.teams, teamSize: m.teamSize
    }));
    const heroes = Object.values(HEROES).map(h => ({
      id: h.id, name: h.name, element: h.element, color: h.color,
      passive: { name: h.passive.name, description: h.passive.description },
      abilities: Object.fromEntries(Object.entries(h.abilities).map(
        ([slot, a]) => [slot, { name: a.name, description: a.description }]))
    }));
    this.sendAsBytes(context.ws, { CATALOG: { modes, heroes } });
  }

  handleJoin(context) {
    const playerId = this.requirePlayer(context, 'Log in before queueing');
    const { arenaManager } = context.services;
    const data = this.payload(context, 'JOIN_MATCHMAKING');
    const modeId = data.mode || data.modeId;
    const client = context.clientList.get(context.clientid);

    const res = arenaManager.joinMatchmaking(
      playerId, context.clientid, client?.playerName || playerId, modeId);

    if (!res.ok) {
      this.sendAsBytes(context.ws, {
        MATCHMAKING_ERROR: { reason: res.reason, message: this.reasonText(res.reason) }
      });
    }
  }

  handleLeave(context) {
    const playerId = this.requirePlayer(context);
    const { arenaManager } = context.services;
    arenaManager.leaveMatchmaking(playerId);
    this.sendAsBytes(context.ws, { MATCHMAKING_LEFT: true });
  }

  handleSelectHero(context) {
    const playerId = this.requirePlayer(context);
    const { arenaManager } = context.services;
    const data = this.payload(context, 'SELECT_HERO');
    arenaManager.selectHero(playerId, data.heroId || data.hero);
  }

  handleLockHero(context) {
    const playerId = this.requirePlayer(context);
    const { arenaManager } = context.services;
    const data = this.payload(context, 'LOCK_HERO');
    const ok = arenaManager.lockHero(playerId, data.heroId || data.hero);
    if (!ok) logger.debug('MATCHMAKING', `Lock failed for ${playerId}`);
  }

  reasonText(reason) {
    switch (reason) {
    case 'mode-unavailable': return 'That mode is not available yet.';
    case 'already-queued': return 'You are already in a queue or match.';
    default: return 'Could not join matchmaking.';
    }
  }
}

module.exports = MatchmakingHandler;
