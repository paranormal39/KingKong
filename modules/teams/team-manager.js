const CONFIG = require('../../config/constants');
const logger = require('../../utils/logger');
const DataManager = require('../persistence/data-manager');
const DatabaseManager = require('../persistence/database-manager');
const { EventEmitter } = require('events');

class TeamManager extends EventEmitter {
  constructor() {
    super();
    this.players = new Map(); // playerId -> PlayerRecord
    this.teams = new Map();   // teamId -> TeamState
    this.seasons = new Map(); // seasonId -> SeasonData
    this.dataManager = new DataManager('./data');
    this.databaseManager = new DatabaseManager('./data/game.db');
    this.autoSaveInterval = null;
    this.isDbInitialized = false;
    this.initializeTeams();
    this.currentSeason = this.createNewSeason();
  }

  initializeTeams() {
    Object.values(CONFIG.TEAMS).forEach(team => {
      this.teams.set(team.id, {
        id: team.id,
        name: team.name,
        color: team.color,
        members: 0,
        totalLoyaltyPoints: 0,
        seasonPoints: 0
      });
    });

    logger.info('TEAM', `Initialized ${this.teams.size} teams`);
  }

  // ============================================
  // SEASONS (quarterly)
  // ============================================

  createNewSeason() {
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3) + 1;
    const seasonId = `${now.getFullYear()}-Q${quarter}`;

    const season = {
      seasonId,
      startDate: new Date(now.getFullYear(), (quarter - 1) * 3, 1).toISOString(),
      endDate: new Date(now.getFullYear(), quarter * 3, 0, 23, 59, 59).toISOString(),
      phase: 'regular'
    };

    this.seasons.set(seasonId, season);

    // Reset season points for all teams
    this.teams.forEach(team => {
      team.seasonPoints = 0;
    });

    logger.info('TEAM', `Created new season: ${seasonId}`);
    return season;
  }

  getCurrentSeason() {
    return this.currentSeason;
  }

  // ============================================
  // PLAYER & TEAM ASSIGNMENT
  // ============================================

  /**
   * Ensure a player exists and has a team. Returns the player record.
   * New players are assigned to the team with the fewest members.
   */
  ensureTeam(playerId, displayName = 'Adventurer') {
    const existing = this.players.get(playerId);
    if (existing) return existing;

    // Pick the team with the fewest members (first on tie)
    let targetTeam = null;
    for (const team of this.teams.values()) {
      if (!targetTeam || team.members < targetTeam.members) {
        targetTeam = team;
      }
    }

    if (!targetTeam) {
      throw new Error('No teams configured');
    }

    const playerData = {
      playerId,
      teamId: targetTeam.id,
      displayName,
      sessionToken: null,
      rank: 'member',
      loyaltyPoints: CONFIG.STARTING_LOYALTY_POINTS,
      pvpWins: 0,
      pvpLosses: 0,
      totalKills: 0,
      questsCompleted: 0,
      coins: 0,
      joinDate: new Date().toISOString()
    };

    this.players.set(playerId, playerData);
    targetTeam.members++;
    targetTeam.totalLoyaltyPoints += playerData.loyaltyPoints;

    logger.info('TEAM', `Player ${playerId} assigned to team ${targetTeam.id}`);
    this.emit('playerJoinedTeam', { playerId, teamId: targetTeam.id, player: playerData });

    // Persist new player (fire and forget)
    this.persistPlayer(playerData);

    return playerData;
  }

  getPlayer(playerId) {
    return this.players.get(playerId) || null;
  }

  getPlayerTeam(playerId) {
    return this.players.get(playerId) || null;
  }

  getTeamById(teamId) {
    return this.teams.get(teamId) || null;
  }

  getAllTeams() {
    return Array.from(this.teams.values());
  }

  /**
   * Find a player by session token (in-memory first, then DB)
   */
  async getPlayerBySessionToken(sessionToken) {
    for (const player of this.players.values()) {
      if (player.sessionToken && player.sessionToken === sessionToken) {
        return player;
      }
    }

    if (this.isDbInitialized) {
      try {
        const row = await this.databaseManager.getPlayerBySessionToken(sessionToken);
        if (row) {
          // Hydrate into memory
          this.players.set(row.playerId, row);
          const team = this.teams.get(row.teamId);
          if (team) {
            team.members++;
            team.totalLoyaltyPoints += row.loyaltyPoints || 0;
          }
          return row;
        }
      } catch (err) {
        logger.warn('TEAM', `Session token lookup failed: ${err.message}`);
      }
    }

    return null;
  }

  setSessionToken(playerId, sessionToken) {
    const player = this.players.get(playerId);
    if (player) {
      player.sessionToken = sessionToken;
      this.persistPlayer(player);
      return true;
    }
    return false;
  }

  // ============================================
  // SCORING
  // ============================================

  getTeamLeaderboard() {
    const teams = Array.from(this.teams.values());
    return teams
      .map(team => ({
        id: team.id,
        name: team.name,
        color: team.color,
        members: team.members,
        seasonPoints: team.seasonPoints,
        totalLoyaltyPoints: team.totalLoyaltyPoints
      }))
      .sort((a, b) => b.seasonPoints - a.seasonPoints);
  }

  getTopPlayers(limit = 10) {
    return Array.from(this.players.values())
      .sort((a, b) => b.loyaltyPoints - a.loyaltyPoints)
      .slice(0, limit)
      .map(player => ({
        playerId: player.playerId,
        displayName: player.displayName,
        teamId: player.teamId,
        loyaltyPoints: player.loyaltyPoints,
        rank: player.rank,
        pvpWins: player.pvpWins,
        pvpLosses: player.pvpLosses
      }));
  }

  recordPvPResult(winnerId, loserId) {
    const winner = this.players.get(winnerId);
    const loser = this.players.get(loserId);

    if (!winner || !loser) {
      logger.warn('TEAM', `PvP result for unknown players: ${winnerId} vs ${loserId}`);
      return;
    }

    this.applyMatchOutcome(winnerId, true);
    this.applyMatchOutcome(loserId, false);

    logger.info('TEAM', `PvP result: ${winnerId} (${winner.teamId}) beat ${loserId} (${loser.teamId})`);

    this.emit('pvpResultRecorded', {
      winner: { playerId: winnerId, teamId: winner.teamId, pointsGained: CONFIG.SCORING.pvpWin },
      loser: { playerId: loserId, teamId: loser.teamId, pointsLost: Math.abs(CONFIG.SCORING.pvpLoss) }
    });
  }

  /**
   * Apply a win/loss to one player: pvp record, season scoring for the
   * player + their team, rank re-eval, persistence. Works for any match
   * shape (FFA placement, team modes, pairwise duels).
   */
  applyMatchOutcome(playerId, won) {
    const player = this.players.get(playerId);
    if (!player) {
      logger.warn('TEAM', `Match outcome for unknown player: ${playerId}`);
      return;
    }

    const points = won ? CONFIG.SCORING.pvpWin : CONFIG.SCORING.pvpLoss;
    if (won) player.pvpWins++; else player.pvpLosses++;
    player.loyaltyPoints = Math.max(0, player.loyaltyPoints + points);

    const team = this.teams.get(player.teamId);
    if (team) {
      team.seasonPoints = Math.max(0, team.seasonPoints + points);
      team.totalLoyaltyPoints = Math.max(0, team.totalLoyaltyPoints + points);
      this.persistTeam(team);
    }

    this.updatePlayerRank(player);
    this.persistPlayer(player);

    logger.info('TEAM', `Match outcome: ${playerId} ${won ? 'won' : 'lost'} (${points > 0 ? '+' : ''}${points} pts)`);
  }

  recordPvPTie(player1Id, player2Id) {
    const p1 = this.players.get(player1Id);
    const p2 = this.players.get(player2Id);
    if (p1) this.persistPlayer(p1);
    if (p2) this.persistPlayer(p2);
  }

  /**
   * Record a completed quest: loyalty points + coins reward
   */
  recordQuestCompletion(playerId, reward) {
    const player = this.players.get(playerId);
    if (!player) return;

    player.questsCompleted++;

    const points = CONFIG.SCORING.questComplete;
    player.loyaltyPoints += points;

    if (reward?.xp) {
      player.loyaltyPoints += Math.floor(reward.xp / 10);
    }
    if (reward?.coins) {
      player.coins += reward.coins;
    }

    const team = this.teams.get(player.teamId);
    if (team) {
      team.seasonPoints += points;
      team.totalLoyaltyPoints += points;
      this.persistTeam(team);
    }

    this.updatePlayerRank(player);
    this.persistPlayer(player);

    logger.info('TEAM', `Quest completion recorded for ${playerId} (+${points} pts, +${reward?.coins || 0} coins)`);
  }

  /**
   * Record a real gameplay kill (e.g. an arena elimination). Bumps lifetime
   * kills and, when the killer's connection carries an active quest,
   * advances its kill progress and completes it when the target is met.
   * Returns { quest, kills, required, completed, reward? } or null.
   */
  recordGameplayKill(playerId, activeQuest) {
    const player = this.players.get(playerId);
    if (!player) return null;
    player.totalKills += 1;

    let result = null;
    const questLive = activeQuest &&
      activeQuest.status === 'active' &&
      (!activeQuest.expires || new Date(activeQuest.expires) > new Date());

    if (questLive && activeQuest.enemyCount > 0) {
      if (!player.questKills) player.questKills = {};
      const kills = (player.questKills[activeQuest.id] || 0) + 1;
      player.questKills[activeQuest.id] = kills;
      this.persistQuestProgress(playerId, activeQuest.id, kills, false);

      result = { quest: activeQuest, kills, required: activeQuest.enemyCount, completed: false };

      if (!activeQuest.completedBy) activeQuest.completedBy = [];
      if (kills >= activeQuest.enemyCount && !activeQuest.completedBy.includes(playerId)) {
        activeQuest.completedBy.push(playerId);
        activeQuest.status = 'completed';
        this.recordQuestCompletion(playerId, activeQuest.reward);
        this.persistQuestProgress(playerId, activeQuest.id, kills, true);
        result.completed = true;
        result.reward = activeQuest.reward;
      }
    }

    this.persistPlayer(player);
    return result;
  }

  persistQuestProgress(playerId, questId, progress, completed) {
    if (!this.isDbInitialized) return;
    this.databaseManager.saveQuestProgress(
      playerId, questId, progress, completed, new Date().toISOString()
    ).catch(err => logger.warn('TEAM', `Failed to persist quest progress: ${err.message}`));
  }

  addLoyaltyPoints(playerId, points, reason = 'general') {
    const player = this.players.get(playerId);
    if (!player) return;

    player.loyaltyPoints += points;

    const team = this.teams.get(player.teamId);
    if (team) {
      team.totalLoyaltyPoints += points;
      team.seasonPoints += points;
    }

    this.updatePlayerRank(player);
    this.persistPlayer(player);

    logger.info('TEAM', `Added ${points} loyalty points to ${playerId} for ${reason}`);
  }

  addCoins(playerId, amount) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.coins += amount;
    this.persistPlayer(player);
  }

  // ============================================
  // RANKS
  // ============================================

  calculateRank(player) {
    for (const threshold of CONFIG.RANKS) {
      if (player.loyaltyPoints >= threshold.points && player.pvpWins >= threshold.pvpWins) {
        return threshold.rank;
      }
    }
    return 'member';
  }

  updatePlayerRank(player) {
    const oldRank = player.rank;
    const newRank = this.calculateRank(player);

    if (newRank !== oldRank) {
      player.rank = newRank;
      logger.info('TEAM', `Player ${player.playerId} promoted from ${oldRank} to ${newRank}`);

      this.emit('rankProgression', {
        playerId: player.playerId,
        teamId: player.teamId,
        oldRank,
        newRank,
        loyaltyPoints: player.loyaltyPoints
      });
    }
  }

  // ============================================
  // PERSISTENCE
  // ============================================

  persistPlayer(player) {
    if (!this.isDbInitialized) return;
    this.databaseManager.savePlayer(player).catch(err => {
      logger.warn('DB', `Failed to persist player ${player.playerId}: ${err.message}`);
    });
  }

  persistTeam(team) {
    if (!this.isDbInitialized) return;
    this.databaseManager.upsertTeam(team).catch(err => {
      logger.warn('DB', `Failed to persist team ${team.id}: ${err.message}`);
    });
  }

  // Export data for JSON snapshot
  exportData() {
    return {
      players: Array.from(this.players.entries()),
      teams: Array.from(this.teams.entries()),
      seasons: Array.from(this.seasons.entries()),
      currentSeason: this.currentSeason
    };
  }

  // Import data from JSON snapshot
  importData(data) {
    if (data.players) this.players = new Map(data.players);
    if (data.teams) this.teams = new Map(data.teams);
    if (data.seasons) this.seasons = new Map(data.seasons);
    if (data.currentSeason) this.currentSeason = data.currentSeason;

    logger.info('TEAM', 'Team data imported successfully');
  }

  async initializeDatabase() {
    if (this.isDbInitialized) {
      return true;
    }

    try {
      await this.databaseManager.initialize();
      this.isDbInitialized = true;
      logger.info('TEAM', 'Database initialized successfully');
      return true;
    } catch (error) {
      logger.error('TEAM', `Failed to initialize database: ${error.message}`);
      this.isDbInitialized = false;
      return false;
    }
  }

  async saveData() {
    try {
      if (!this.isDbInitialized) {
        await this.initializeDatabase();
      }

      // Save all players to database
      for (const [, player] of this.players) {
        await this.databaseManager.savePlayer(player);
      }

      // Save teams to database
      for (const [, team] of this.teams) {
        await this.databaseManager.upsertTeam(team);
      }

      // Also snapshot to JSON for fast recovery
      await this.dataManager.saveData('team-data', this.exportData());

      logger.info('TEAM', 'Team data saved successfully');
      return true;
    } catch (error) {
      logger.error('TEAM', `Failed to save team data: ${error.message}`);
      // Fallback to JSON only
      const data = this.exportData();
      await this.dataManager.saveData('team-data', data);
      return false;
    }
  }

  async loadData() {
    try {
      if (!this.isDbInitialized) {
        await this.initializeDatabase();
      }

      // Load players from database
      const players = await this.databaseManager.getAllPlayers();
      for (const player of players) {
        this.players.set(player.playerId, player);
      }

      // Rebuild team member counts / loyalty totals from players
      this.teams.forEach(team => {
        team.members = 0;
        team.totalLoyaltyPoints = 0;
      });
      for (const player of this.players.values()) {
        const team = this.teams.get(player.teamId);
        if (team) {
          team.members++;
          team.totalLoyaltyPoints += player.loyaltyPoints || 0;
        }
      }

      // Load season points from teams table
      const teamRows = await this.databaseManager.getTeams();
      for (const row of teamRows) {
        const team = this.teams.get(row.team_id);
        if (team) {
          team.seasonPoints = row.season_points || 0;
        }
      }

      logger.info('TEAM', `Loaded ${players.length} players from database`);
      return true;
    } catch (error) {
      logger.error('TEAM', `Failed to load team data from database: ${error.message}`);
      // Fallback to JSON
      const data = await this.dataManager.loadData('team-data');
      if (data) {
        this.importData(data);
        logger.info('TEAM', 'Team data loaded from JSON fallback');
        return true;
      }
      return false;
    }
  }

  async backupData() {
    try {
      await this.saveData();
      await this.dataManager.backupData('team-data');
      if (this.isDbInitialized) {
        await this.databaseManager.createBackup();
      }
      logger.info('TEAM', 'Team data backup created');
    } catch (error) {
      logger.error('TEAM', `Failed to backup team data: ${error.message}`);
    }
  }

  startAutoSave(intervalMinutes = 5) {
    this.autoSaveInterval = this.dataManager.startAutoSave(
      () => this.saveData(),
      intervalMinutes
    );
  }

  stopAutoSave() {
    if (this.autoSaveInterval) {
      this.dataManager.stopAutoSave(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  async shutdown() {
    this.stopAutoSave();
    await this.saveData();
    if (this.databaseManager) {
      await this.databaseManager.close();
    }
    logger.info('TEAM', 'Team manager shutdown complete');
  }
}

module.exports = TeamManager;
