/**
 * Arena - a single isolated match instance.
 *
 * Owns its own WorldStateManager + AbilitySystem, its roster of humans and
 * bots, the hero-select window, the match clock, scoring, win condition and
 * all broadcasts (scoped to the humans in this arena). The ArenaManager
 * ticks every arena and routes inbound combat/move/ability messages here.
 *
 * Lifecycle: heroselect -> active -> ended (lingers briefly to show results).
 */
const logger = require('../../utils/logger');
const CONFIG = require('../../config/constants');
const { getHero, HERO_IDS } = require('../../config/heroes');
const WorldStateManager = require('../world/world-state-manager');
const AbilitySystem = require('./ability-system');
const Bot = require('./bot');

let arenaSeq = 0;

class Arena {
  constructor({ mode, clientManager, teamManager, onClose }) {
    this.id = `arena_${Date.now()}_${arenaSeq++}`;
    this.mode = mode;
    this.clientManager = clientManager;
    this.teamManager = teamManager;
    this.onClose = onClose || (() => {});

    this.world = new WorldStateManager({ label: `ARENA:${this.id.slice(-6)}` });
    this.abilities = new AbilitySystem((a, b) => this.isEnemy(a, b));

    // playerId -> { clientId, displayName, isBot, hero, locked, team }
    this.members = new Map();
    this.bots = [];

    this.state = 'heroselect';
    this.heroSelectDeadline = Date.now() + mode.heroSelectMs;
    this.startTime = 0;
    this.endTime = 0;
    this.closeAt = 0;
  }

  // =========================================================
  // Membership / hero select
  // =========================================================

  isEnemy(a, b) {
    if (this.mode.teams <= 1) return true; // FFA: everyone hostile
    return a.team !== b.team;
  }

  addHuman({ playerId, clientId, displayName, team = null }) {
    this.members.set(playerId, {
      clientId, displayName: displayName || playerId,
      isBot: false, hero: null, locked: false, team
    });
    logger.info('ARENA', `${playerId} joined ${this.id} (${this.mode.id})`);
  }

  hasPlayer(playerId) {
    return this.members.has(playerId);
  }

  humanCount() {
    let n = 0;
    for (const m of this.members.values()) if (!m.isBot) n++;
    return n;
  }

  hasHumans() {
    return this.humanCount() > 0;
  }

  selectHero(playerId, heroId) {
    const m = this.members.get(playerId);
    if (!m || m.locked || !getHero(heroId)) return false;
    m.hero = heroId;
    this.broadcastHeroSelectState();
    return true;
  }

  lockHero(playerId, heroId) {
    const m = this.members.get(playerId);
    if (!m || this.state !== 'heroselect') return false;
    if (heroId && getHero(heroId)) m.hero = heroId;
    if (!m.hero) m.hero = this.randomHero();
    m.locked = true;
    this.broadcastHeroSelectState();

    // Start early once every human has locked
    const humans = [...this.members.values()].filter(x => !x.isBot);
    if (humans.length > 0 && humans.every(x => x.locked)) this.start();
    return true;
  }

  randomHero() {
    return HERO_IDS[Math.floor(Math.random() * HERO_IDS.length)];
  }

  broadcastHeroSelectState() {
    const roster = [...this.members.entries()].map(([playerId, m]) => ({
      playerId, displayName: m.displayName, hero: m.hero, locked: m.locked, team: m.team, isBot: m.isBot
    }));
    this.broadcast({
      HERO_SELECT_STATE: {
        arenaId: this.id,
        mode: this.mode.id,
        roster,
        deadline: this.heroSelectDeadline,
        timeLeftMs: Math.max(0, this.heroSelectDeadline - Date.now())
      }
    });
  }

  // =========================================================
  // Match start
  // =========================================================

  start() {
    if (this.state !== 'heroselect') return;
    this.state = 'active';
    this.startTime = Date.now();

    // Assign sides for team modes (humans first, then bots alternate)
    this.assignTeams();

    // Register humans in the world with their chosen hero
    for (const [playerId, m] of this.members.entries()) {
      if (m.isBot) continue;
      if (!m.hero) m.hero = this.randomHero();
      this.world.addPlayer({
        playerId, clientId: m.clientId, displayName: m.displayName,
        hero: m.hero, team: m.team, isBot: false
      });
    }

    // Fill remaining slots with bots
    if (this.mode.botFill) this.spawnBots();

    const durationMs = this.mode.winCondition.timeLimitMs || 0;
    this.endTime = durationMs ? this.startTime + durationMs : 0;

    logger.info('ARENA', `${this.id} started: ${this.mode.id}, ${this.world.players.size} combatants`);

    // Tell each human to enter, with their personal spawn
    for (const [playerId, m] of this.members.entries()) {
      if (m.isBot) continue;
      const entry = this.world.get(playerId);
      this.sendTo(playerId, {
        MATCH_START: {
          arenaId: this.id,
          mode: this.mode.id,
          modeName: this.mode.name,
          hero: m.hero,
          team: m.team,
          spawn: entry ? { x: entry.x, y: entry.y, z: entry.z } : null,
          durationMs,
          winCondition: this.mode.winCondition,
          roster: this.roster()
        }
      });
    }
  }

  assignTeams() {
    if (this.mode.teams <= 1) {
      for (const m of this.members.values()) m.team = null;
      return;
    }
    const sides = [];
    for (let i = 0; i < this.mode.teams; i++) sides.push(String.fromCharCode(65 + i)); // A, B, ...
    let i = 0;
    for (const m of this.members.values()) m.team = sides[i++ % sides.length];
  }

  spawnBots() {
    const capacity = this.mode.teams * this.mode.teamSize;
    let needed = capacity - this.members.size;
    const sides = [];
    for (let i = 0; i < this.mode.teams; i++) sides.push(String.fromCharCode(65 + i));

    let botIdx = 0;
    while (needed-- > 0) {
      const name = CONFIG.BOT.NAMES[botIdx % CONFIG.BOT.NAMES.length]
        + (botIdx >= CONFIG.BOT.NAMES.length ? ` ${Math.floor(botIdx / CONFIG.BOT.NAMES.length) + 1}` : '');
      const botId = `bot_${this.id.slice(-6)}_${botIdx}`;
      const team = this.mode.teams <= 1 ? null : sides[(this.members.size) % sides.length];
      const hero = Bot.pickHero();

      this.members.set(botId, { clientId: null, displayName: name, isBot: true, hero, locked: true, team });
      const entry = this.world.addPlayer({ playerId: botId, displayName: name, hero, team, isBot: true });
      this.bots.push(new Bot(botId, entry));
      botIdx++;
    }
  }

  roster() {
    return [...this.members.entries()].map(([playerId, m]) => ({
      playerId, displayName: m.displayName, hero: m.hero, team: m.team, isBot: m.isBot
    }));
  }

  // =========================================================
  // Inbound combat routing (called by ArenaManager)
  // =========================================================

  handleMove(playerId, data) {
    if (this.state !== 'active') return;
    this.world.updatePosition(playerId, data);
  }

  handleFire(playerId, targetId) {
    if (this.state !== 'active') return;
    const entry = this.world.get(playerId);
    if (!entry) return;
    // Primary + secondary both fire the active weapon; weapons are swapped
    // with WEAPON_SWITCH (keys 1/2). RMB is aim-down-sights on the client.
    const res = this.abilities.fireWeapon(this.world, entry, targetId);
    if (res.ok) this.sendTo(playerId, { AMMO_STATE: { ammo: res.ammo, weaponSlot: entry.weaponSlot } });
    if (res.hit && res.killed) this.announceKill(playerId, res.targetId);
  }

  handleReload(playerId) {
    if (this.state !== 'active') return;
    const entry = this.world.get(playerId);
    if (!entry) return;
    const res = this.abilities.reload(this.world, entry);
    if (res.ok) this.sendTo(playerId, { RELOADING: { reloadMs: res.reloadMs } });
  }

  handleMelee(playerId, targetId) {
    if (this.state !== 'active') return;
    const entry = this.world.get(playerId);
    if (!entry) return;
    const res = this.abilities.melee(this.world, entry, targetId);
    if (res.ok && res.hit && res.killed) this.announceKill(playerId, res.targetId);
  }

  handleSwitch(playerId, slot) {
    if (this.state !== 'active') return;
    const entry = this.world.get(playerId);
    if (!entry) return;
    const res = this.abilities.switchWeapon(this.world, entry, slot);
    if (res.ok) this.sendTo(playerId, { AMMO_STATE: { ammo: res.ammo, weaponSlot: res.weaponSlot } });
  }

  handleAbility(playerId, slot) {
    if (this.state !== 'active') return;
    const entry = this.world.get(playerId);
    if (!entry) return;
    const res = this.abilities.useAbility(this.world, entry, slot);
    if (!res.ok) return;
    // Broadcast for VFX; confirm cooldown to the caster
    this.broadcast({
      ABILITY_USED: {
        playerId, slot, abilityId: res.abilityId, name: res.name,
        x: entry.x, y: entry.y, z: entry.z, yaw: entry.yaw
      }
    });
    this.sendTo(playerId, { COOLDOWN_STATE: { slot, cooldownMs: res.cooldownMs, ultCharge: entry.ultCharge } });
  }

  announceKill(killerId, victimId) {
    const killer = this.world.get(killerId);
    const victim = this.world.get(victimId);
    this.broadcast({
      PLAYER_KILLED: {
        arenaId: this.id,
        victimId, victimName: victim?.displayName || victimId,
        killerId, killerName: killer?.displayName || killerId,
        respawnIn: CONFIG.COMBAT.RESPAWN_MS
      }
    });

    // Persist real players' kill stats (ignore bots) + advance quest progress
    const killerMember = this.members.get(killerId);
    if (killerMember && !killerMember.isBot && this.teamManager) {
      try {
        this.teamManager.addLoyaltyPoints(killerId, CONFIG.COMBAT.KILL_LOYALTY, 'arena_kill');
        const client = killerMember.clientId ? this.clientManager.getClient(killerMember.clientId) : null;
        const qres = this.teamManager.recordGameplayKill(killerId, client?.activeQuest);
        if (qres && qres.quest) {
          this.sendTo(killerId, {
            QUEST_UPDATE: {
              questId: qres.quest.id,
              questTitle: qres.quest.title,
              kills: qres.kills,
              required: qres.required,
              completed: qres.completed
            }
          });
          if (qres.completed) {
            this.sendTo(killerId, {
              QUEST_COMPLETED: {
                questId: qres.quest.id,
                questTitle: qres.quest.title,
                reward: qres.reward,
                message: `Quest Complete! "${qres.quest.title}"`
              }
            });
          }
        }
      } catch (err) {
        logger.warn('ARENA', `Failed to record kill: ${err.message}`);
      }
    }
  }

  // =========================================================
  // Per-tick update
  // =========================================================

  tick() {
    const now = Date.now();

    if (this.state === 'heroselect') {
      if (now >= this.heroSelectDeadline) {
        // Auto-lock anyone who hasn't picked, then start
        for (const m of this.members.values()) { if (!m.isBot) m.locked = true; }
        this.start();
      }
      return;
    }

    if (this.state === 'ended') {
      if (now >= this.closeAt) this.close();
      return;
    }

    // active
    this.abilities.tick(this.world);
    for (const bot of this.bots) bot.update(this.world, this.abilities);
    this.world.checkRespawns();

    this.checkWin(now);
    this.broadcastWorld(now);
  }

  checkWin(now) {
    const wc = this.mode.winCondition;
    let winner = null;

    if (this.mode.teams <= 1) {
      // FFA: highest score; end on kill limit
      let top = null;
      for (const e of this.world.players.values()) {
        if (!top || e.score > top.score) top = e;
      }
      if (wc.killLimit && top && top.score >= wc.killLimit) winner = { type: 'player', id: top.playerId };
    } else {
      const scores = {};
      for (const [playerId, m] of this.members.entries()) {
        const e = this.world.get(playerId);
        scores[m.team] = (scores[m.team] || 0) + (e ? e.score : 0);
      }
      for (const [team, score] of Object.entries(scores)) {
        if (wc.killLimit && score >= wc.killLimit) winner = { type: 'team', id: team };
      }
    }

    if (winner) return this.end(winner);
    if (this.endTime && now >= this.endTime) this.end(this.topSide());
  }

  topSide() {
    if (this.mode.teams <= 1) {
      let top = null;
      for (const e of this.world.players.values()) if (!top || e.score > top.score) top = e;
      return top ? { type: 'player', id: top.playerId } : null;
    }
    const scores = {};
    for (const [playerId, m] of this.members.entries()) {
      const e = this.world.get(playerId);
      scores[m.team] = (scores[m.team] || 0) + (e ? e.score : 0);
    }
    let best = null;
    for (const [team, score] of Object.entries(scores)) {
      if (!best || score > best.score) best = { type: 'team', id: team, score };
    }
    return best;
  }

  end(winner) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.closeAt = Date.now() + CONFIG.ARENA.RESULTS_LINGER_MS;

    const scoreboard = this.scoreboard();
    const results = {
      MATCH_END: {
        arenaId: this.id,
        mode: this.mode.id,
        winner,
        scoreboard
      }
    };
    this.broadcast(results);
    this.recordResults(winner, scoreboard);
    logger.info('ARENA', `${this.id} ended. Winner: ${winner ? `${winner.type}:${winner.id}` : 'none'}`);
  }

  /**
   * Apply season scoring to every human participant and persist the match.
   * FFA: only the player named by winner wins; everyone else loses.
   * Team modes: every member of the winning side wins.
   */
  recordResults(winner, scoreboard) {
    if (!this.teamManager) return;
    const humans = scoreboard.filter(s => !s.isBot);
    if (!humans.length) return;

    for (const s of humans) {
      const won = this.mode.teams <= 1
        ? (winner?.type === 'player' && winner.id === s.playerId)
        : (winner?.type === 'team' && winner.id === s.team);
      try {
        this.teamManager.applyMatchOutcome(s.playerId, won);
      } catch (err) {
        logger.warn('ARENA', `Failed to record outcome for ${s.playerId}: ${err.message}`);
      }
    }

    if (this.teamManager.isDbInitialized) {
      this.teamManager.databaseManager.saveMatch({
        matchId: this.id,
        mode: this.mode.id,
        winnerType: winner?.type || null,
        winnerId: winner?.id || null,
        humans: humans.length,
        durationMs: this.startTime ? Date.now() - this.startTime : 0,
        scoreboard
      }).catch(err => logger.warn('ARENA', `Failed to save match record: ${err.message}`));
    }
  }

  scoreboard() {
    return [...this.members.entries()].map(([playerId, m]) => {
      const e = this.world.get(playerId);
      return {
        playerId, displayName: m.displayName, hero: m.hero, team: m.team, isBot: m.isBot,
        kills: e ? e.score : 0, deaths: e ? e.deaths : 0
      };
    }).sort((a, b) => b.kills - a.kills);
  }

  broadcastWorld(now) {
    this.broadcast({
      WORLD_STATE: {
        arenaId: this.id,
        players: this.world.getSnapshot(),
        serverTime: now,
        timeLeftMs: this.endTime ? Math.max(0, this.endTime - now) : 0
      }
    });
  }

  // =========================================================
  // Broadcast / teardown
  // =========================================================

  broadcast(data) {
    for (const [, m] of this.members.entries()) {
      if (m.isBot || !m.clientId) continue;
      const client = this.clientManager.getClient(m.clientId);
      if (client && client.ws) this.clientManager.sendAsBytes(client.ws, data);
    }
  }

  sendTo(playerId, data) {
    const m = this.members.get(playerId);
    if (!m || m.isBot || !m.clientId) return;
    const client = this.clientManager.getClient(m.clientId);
    if (client && client.ws) this.clientManager.sendAsBytes(client.ws, data);
  }

  removePlayer(playerId) {
    const m = this.members.get(playerId);
    if (!m) return;
    this.members.delete(playerId);
    this.world.removePlayer(playerId);
    logger.info('ARENA', `${playerId} left ${this.id}`);

    if (!this.hasHumans() && this.state !== 'ended') {
      // No humans remain: wind the arena down (bots alone aren't worth keeping)
      this.closeAt = Date.now() + CONFIG.ARENA.EMPTY_CLOSE_MS;
      this.state = 'ended';
    }
  }

  close() {
    logger.info('ARENA', `${this.id} closed`);
    this.members.clear();
    this.bots = [];
    this.onClose(this);
  }
}

module.exports = Arena;
