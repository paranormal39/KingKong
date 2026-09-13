/**
 * Team Handler
 * Handles team info and leaderboard requests:
 * - TEAM_STATUS
 * - GET_LEADERBOARD
 */
const BaseHandler = require('./base-handler');

class TeamHandler extends BaseHandler {
  constructor() {
    super('TEAM');
    this.registerHandlers();
  }

  registerHandlers() {
    this.register('TEAM_STATUS', this.handleTeamStatus.bind(this));
    this.register('GET_LEADERBOARD', this.handleGetLeaderboard.bind(this));
  }

  /**
   * Get the caller's team status
   */
  async handleTeamStatus(context) {
    const { ws } = context;
    const { teamManager } = context.services;

    const playerId = this.requirePlayer(context);
    const player = teamManager.getPlayer(playerId);
    const team = player ? teamManager.getTeamById(player.teamId) : null;
    const currentSeason = teamManager.getCurrentSeason();

    if (!player || !team) {
      this.sendAsBytes(ws, {
        TEAM_STATUS_ERROR: 'No team assigned'
      });
      return;
    }

    const topMembers = teamManager.getTopPlayers(100)
      .filter(p => p.teamId === team.id)
      .slice(0, 10);

    this.sendAsBytes(ws, {
      TEAM_STATUS: {
        team: {
          id: team.id,
          name: team.name,
          color: team.color,
          members: team.members,
          seasonPoints: team.seasonPoints,
          totalLoyaltyPoints: team.totalLoyaltyPoints
        },
        player: {
          playerId: player.playerId,
          displayName: player.displayName,
          rank: player.rank,
          loyaltyPoints: player.loyaltyPoints,
          pvpWins: player.pvpWins,
          pvpLosses: player.pvpLosses,
          totalKills: player.totalKills,
          questsCompleted: player.questsCompleted,
          coins: player.coins
        },
        topMembers,
        season: currentSeason ? {
          seasonId: currentSeason.seasonId,
          startDate: currentSeason.startDate,
          endDate: currentSeason.endDate,
          phase: currentSeason.phase
        } : null,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Get team + player leaderboards
   */
  async handleGetLeaderboard(context) {
    const { ws } = context;
    const { teamManager } = context.services;

    this.sendAsBytes(ws, {
      LEADERBOARD: {
        teams: teamManager.getTeamLeaderboard(),
        topPlayers: teamManager.getTopPlayers(10),
        season: teamManager.getCurrentSeason()?.seasonId || null,
        timestamp: new Date().toISOString()
      }
    });
  }
}

module.exports = TeamHandler;
