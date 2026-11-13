/**
 * Session Handler
 * Handles player login and session management:
 * - LOGIN (playerId + displayName -> session token + team assignment)
 * - RESTORE_SESSION (playerId + sessionToken)
 */
const { v4: uuidv4 } = require('uuid');
const BaseHandler = require('./base-handler');
const logger = require('../../utils/logger');
const CONFIG = require('../../config/constants');
const { generateDailyQuest } = require('./quest-handler');

class SessionHandler extends BaseHandler {
  constructor() {
    super('SESSION');
    this.registerHandlers();
  }

  registerHandlers() {
    this.register('LOGIN', this.handleLogin.bind(this));
    this.register('RESTORE_SESSION', this.handleRestoreSession.bind(this));
  }

  /**
   * One-message login: validate playerId, assign session token + team
   */
  async handleLogin(context) {
    const { message, ws, clientid, clientList } = context;
    const { teamManager } = context.services;

    const requestedId = typeof message.playerId === 'string' ? message.playerId.trim() : '';
    const displayName = message.displayName || message.playerName || 'Adventurer';

    // Clients may omit playerId - the server generates one
    let playerId = requestedId;
    if (!playerId) {
      do {
        playerId = `player_${uuidv4().split('-')[0]}`;
      } while (teamManager.getPlayer(playerId));
    }

    // Validate a client-supplied playerId
    if (
      requestedId &&
      (requestedId.length < CONFIG.PLAYER_ID_MIN_LENGTH ||
        requestedId.length > CONFIG.PLAYER_ID_MAX_LENGTH ||
        !CONFIG.PLAYER_ID_PATTERN.test(requestedId))
    ) {
      this.sendAsBytes(ws, {
        LOGIN_ERROR: {
          error: 'Invalid player ID',
          message: `Player ID must be ${CONFIG.PLAYER_ID_MIN_LENGTH}-${CONFIG.PLAYER_ID_MAX_LENGTH} alphanumeric characters.`
        }
      });
      return;
    }

    // Check banned players
    if (CONFIG.BANNED_PLAYERS.includes(playerId)) {
      logger.warn('SECURITY', `Banned player attempted login: ${playerId}`);
      this.sendAsBytes(ws, {
        LOGIN_ERROR: { error: 'Banned', message: 'This player ID has been banned.' }
      });
      ws.close();
      return;
    }

    // One session per player - kick any existing connection
    this.disconnectDuplicate(clientList, playerId, clientid);

    // Register client
    const client = clientList.get(clientid);
    if (!client) return;

    const isNewPlayer = !teamManager.getPlayer(playerId);

    client.playerId = playerId;
    client.playerName = displayName;
    client.sessionToken = uuidv4();

    // Store usertoken if provided (for XOR payload decoding)
    if (message.usertoken) {
      client.usertoken = message.usertoken;
    }

    // Ensure player exists + team assignment (season/leaderboard meta only)
    const player = teamManager.ensureTeam(playerId, displayName);
    player.displayName = displayName;
    teamManager.setSessionToken(playerId, client.sessionToken);

    // Login just authenticates; players enter a world via matchmaking + an
    // arena. No shared world is joined here.

    const team = teamManager.getTeamById(player.teamId);
    const currentSeason = teamManager.getCurrentSeason();

    this.sendAsBytes(ws, {
      LOGIN_COMPLETE: {
        playerId,
        displayName,
        team: player.teamId,
        teamDetails: team ? { id: team.id, name: team.name, color: team.color, members: team.members } : null,
        sessionToken: client.sessionToken,
        stats: {
          loyaltyPoints: player.loyaltyPoints,
          rank: player.rank,
          pvpWins: player.pvpWins,
          pvpLosses: player.pvpLosses,
          totalKills: player.totalKills,
          coins: player.coins
        },
        season: currentSeason ? {
          seasonId: currentSeason.seasonId,
          endsAt: currentSeason.endDate
        } : null,
        message: `Welcome, ${displayName}!`
      }
    });

    // First-time players get a starter daily quest
    if (isNewPlayer) {
      try {
        const quest = generateDailyQuest(displayName, team?.name);
        client.activeQuest = quest;
        await this.persistQuestAssignment(teamManager, playerId, quest);

        this.sendAsBytes(ws, {
          DAILY_QUEST: {
            quest,
            message: `Welcome! Here's your first quest: "${quest.title}"`,
            isFirstTimeQuest: true
          }
        });
      } catch (err) {
        logger.error('QUEST', `First-time quest error: ${err.message}`);
      }
    }

    logger.info('SESSION', `Player logged in: ${playerId} (${player.teamId})`);
  }

  /**
   * Restore a previous session via sessionToken
   */
  async handleRestoreSession(context) {
    const { message, ws, clientid, clientList } = context;
    const { teamManager } = context.services;

    const playerId = message.playerId;
    const sessionToken = message.sessionToken;

    logger.info('SESSION', `Restore session request for ${playerId}`);

    if (!playerId || !sessionToken) {
      this.sendAsBytes(ws, {
        SESSION_RESTORE_ERROR: {
          error: 'Missing credentials',
          message: 'playerId and sessionToken are required.',
          requiresReconnect: true
        }
      });
      return;
    }

    // Validate the session token
    const player = await teamManager.getPlayerBySessionToken(sessionToken);
    if (!player || player.playerId !== playerId) {
      this.sendAsBytes(ws, {
        SESSION_RESTORE_ERROR: {
          error: 'Invalid session',
          message: 'Session not found or expired. Please log in again.',
          requiresReconnect: true
        }
      });
      return;
    }

    // Kick duplicate connection
    this.disconnectDuplicate(clientList, playerId, clientid);

    // Re-attach client
    const client = clientList.get(clientid);
    if (!client) return;

    client.playerId = playerId;
    client.playerName = player.displayName || message.playerName || 'Adventurer';
    client.sessionToken = sessionToken;

    if (message.usertoken) {
      client.usertoken = message.usertoken;
    }

    // Session restore just re-authenticates; the player returns to the menu
    // and re-enters play via matchmaking.

    const team = teamManager.getTeamById(player.teamId);
    const currentSeason = teamManager.getCurrentSeason();
    const leaderboard = teamManager.getTeamLeaderboard();

    this.sendAsBytes(ws, {
      SESSION_RESTORED: {
        success: true,
        playerId,
        displayName: client.playerName,
        team: player.teamId,
        teamDetails: team ? {
          id: team.id,
          name: team.name,
          color: team.color,
          members: team.members
        } : null,
        stats: {
          loyaltyPoints: player.loyaltyPoints,
          rank: player.rank,
          pvpWins: player.pvpWins,
          pvpLosses: player.pvpLosses,
          totalKills: player.totalKills,
          questsCompleted: player.questsCompleted,
          coins: player.coins
        },
        season: currentSeason ? {
          seasonId: currentSeason.seasonId,
          endsAt: currentSeason.endDate
        } : null,
        leaderboard: leaderboard?.slice(0, 5) || [],
        message: `Welcome back, ${client.playerName}!`
      }
    });

    logger.info('SESSION', `Session restored for ${playerId} (${player.teamId})`);
  }

  // Helper methods
  disconnectDuplicate(clientList, playerId, newClientId) {
    for (const [clientId, clientData] of clientList.entries()) {
      if (clientData.playerId === playerId && clientId !== newClientId) {
        logger.warn('SECURITY', `Duplicate player: ${playerId}. Disconnecting ${clientId}`);

        if (clientData.ws && clientData.ws.readyState === 1) {
          this.sendAsBytes(clientData.ws, {
            DUPLICATE_CONNECTION: true,
            message: 'Another device has connected with this player ID. You have been disconnected.'
          });
          clientData.ws.close();
        }

        clientList.delete(clientId);
        return true;
      }
    }
    return false;
  }

  async persistQuestAssignment(teamManager, playerId, quest) {
    if (!teamManager.isDbInitialized) return;
    try {
      await teamManager.databaseManager.saveQuestProgress(
        playerId, quest.id, 0, false, new Date().toISOString()
      );
    } catch (err) {
      logger.warn('QUEST', `Failed to persist quest assignment: ${err.message}`);
    }
  }
}

module.exports = SessionHandler;
