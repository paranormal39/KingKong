/**
 * PvP Handler
 * Handles PvP matchmaking and tap duels:
 * - JOIN_QUEUE
 * - LEAVE_QUEUE
 * - TAP (during duels)
 */
const BaseHandler = require('./base-handler');
const logger = require('../../utils/logger');
const CONFIG = require('../../config/constants');

class PvPHandler extends BaseHandler {
  constructor() {
    super('PVP');
    this.waitingQueue = [];
    this.matches = new Map();
    this.playerMatchMap = new Map();
    this.registerHandlers();
  }

  registerHandlers() {
    this.register('JOIN_QUEUE', this.handleJoinQueue.bind(this));
    this.register('TAP', this.handleTap.bind(this));
    this.register('LEAVE_QUEUE', this.handleLeaveQueue.bind(this));
  }

  /**
   * Join PvP matchmaking queue
   */
  async handleJoinQueue(context) {
    const { message, ws } = context;

    const playerId = this.requirePlayer(context);
    const client = context.clientList.get(context.clientid);

    if (this.waitingQueue.includes(ws)) {
      this.sendAsBytes(ws, {
        QUEUE_WAITING: 'QUEUE_WAITING',
        message: 'Already in queue.',
        queueLength: this.waitingQueue.length
      });
      return;
    }

    ws.playerData = {
      playerId,
      displayName: client?.playerName || message.displayName || 'Adventurer',
      team: context.services.teamManager.getPlayerTeam(playerId)?.teamId || null,
      powerLevel: message.powerLevel || 0
    };

    this.waitingQueue.push(ws);

    logger.info('PVP', `Player ${playerId} joined queue. Queue size: ${this.waitingQueue.length}`);

    this.sendAsBytes(ws, {
      QUEUE_WAITING: 'QUEUE_WAITING',
      message: 'Waiting for more players to join...',
      queueLength: this.waitingQueue.length
    });

    // Try to start a match
    this.tryToStartMatch();
  }

  /**
   * Handle tap during PvP duel
   */
  async handleTap(context) {
    const { ws } = context;

    const matchId = this.playerMatchMap.get(ws);
    if (!matchId) {
      logger.warn('PVP', 'Tap received but player not in match');
      return;
    }

    const match = this.matches.get(matchId);
    if (!match || match.status !== 'active') {
      return;
    }

    // Determine which player tapped
    const isPlayer1 = match.player1.ws === ws;
    const playerKey = isPlayer1 ? 'player1' : 'player2';

    // Increment tap count
    match[playerKey].taps = (match[playerKey].taps || 0) + 1;

    // Broadcast update to both players
    const update = {
      MATCH_UPDATE: {
        matchId,
        player1Taps: match.player1.taps || 0,
        player2Taps: match.player2.taps || 0,
        timeRemaining: this.getTimeRemaining(match)
      }
    };

    this.sendAsBytes(match.player1.ws, update);
    this.sendAsBytes(match.player2.ws, update);
  }

  /**
   * Leave matchmaking queue
   */
  async handleLeaveQueue(context) {
    const { ws } = context;

    const index = this.waitingQueue.indexOf(ws);
    if (index > -1) {
      this.waitingQueue.splice(index, 1);
      this.sendAsBytes(ws, {
        QUEUE_LEFT: true,
        message: 'You have left the queue'
      });
      logger.info('PVP', `Player left queue. Queue size: ${this.waitingQueue.length}`);
    }
  }

  /**
   * Try to start a match if enough players
   */
  tryToStartMatch() {
    if (this.waitingQueue.length >= 2) {
      const player1 = this.waitingQueue.shift();
      const player2 = this.waitingQueue.shift();

      const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const match = {
        id: matchId,
        player1: {
          ws: player1,
          data: player1.playerData,
          taps: 0
        },
        player2: {
          ws: player2,
          data: player2.playerData,
          taps: 0
        },
        startTime: Date.now(),
        duration: CONFIG.MATCH_TIMEOUT,
        status: 'active'
      };

      this.matches.set(matchId, match);
      this.playerMatchMap.set(player1, matchId);
      this.playerMatchMap.set(player2, matchId);

      // Notify both players
      const matchFoundMessage = {
        MATCH_FOUND: {
          matchId,
          opponent: null, // Will be set per player
          duration: match.duration
        }
      };

      matchFoundMessage.MATCH_FOUND.opponent = player2.playerData;
      this.sendAsBytes(player1, matchFoundMessage);

      matchFoundMessage.MATCH_FOUND.opponent = player1.playerData;
      this.sendAsBytes(player2, matchFoundMessage);

      logger.info('PVP', `Match started: ${matchId} - ${player1.playerData.playerId} vs ${player2.playerData.playerId}`);

      // Set timeout to end match
      match.timeout = setTimeout(() => this.endMatch(matchId), match.duration);
    }
  }

  /**
   * End a match and determine winner
   */
  endMatch(matchId) {
    const match = this.matches.get(matchId);
    if (!match || match.status !== 'active') return;

    match.status = 'ended';
    if (match.timeout) clearTimeout(match.timeout);

    const player1Taps = match.player1.taps || 0;
    const player2Taps = match.player2.taps || 0;

    let winner, loser;
    if (player1Taps > player2Taps) {
      winner = match.player1;
      loser = match.player2;
    } else if (player2Taps > player1Taps) {
      winner = match.player2;
      loser = match.player1;
    } else {
      // Tie
      winner = null;
      loser = null;
    }

    const results = {
      MATCH_RESULTS: {
        matchId,
        player1: {
          playerId: match.player1.data.playerId,
          taps: player1Taps,
          isWinner: winner === match.player1
        },
        player2: {
          playerId: match.player2.data.playerId,
          taps: player2Taps,
          isWinner: winner === match.player2
        },
        isTie: winner === null
      }
    };

    this.sendAsBytes(match.player1.ws, results);
    this.sendAsBytes(match.player2.ws, results);

    // Record result + persist
    const teamManager = this.services?.teamManager;
    if (teamManager) {
      const p1Id = match.player1.data.playerId;
      const p2Id = match.player2.data.playerId;

      if (winner) {
        teamManager.recordPvPResult(winner.data.playerId, loser.data.playerId);
      } else {
        teamManager.recordPvPTie(p1Id, p2Id);
      }

      if (teamManager.isDbInitialized) {
        teamManager.databaseManager.saveMatch({
          matchId,
          player1: p1Id,
          player2: p2Id,
          winner: winner ? winner.data.playerId : null,
          p1Taps: player1Taps,
          p2Taps: player2Taps,
          playedAt: new Date().toISOString()
        }).catch(err => logger.warn('PVP', `Failed to save match: ${err.message}`));
      }
    }

    // Cleanup
    this.playerMatchMap.delete(match.player1.ws);
    this.playerMatchMap.delete(match.player2.ws);
    this.matches.delete(matchId);

    logger.info('PVP', `Match ended: ${matchId} - Winner: ${winner?.data.playerId || 'TIE'}`);
  }

  /**
   * Get remaining time in match
   */
  getTimeRemaining(match) {
    const elapsed = Date.now() - match.startTime;
    return Math.max(0, match.duration - elapsed);
  }

  /**
   * Called by the registry when a client disconnects.
   * Removes them from the queue or forfeits their active match.
   */
  onDisconnect(clientid) {
    const client = this.services?.clientManager?.getClient(clientid);
    if (client?.ws) {
      this.removeFromQueue(client.ws);
    }
  }

  /**
   * Remove player from queue (called on disconnect)
   */
  removeFromQueue(ws) {
    const index = this.waitingQueue.indexOf(ws);
    if (index > -1) {
      this.waitingQueue.splice(index, 1);
      logger.info('PVP', `Queued player disconnected. Queue size: ${this.waitingQueue.length}`);
    }

    // Also check if in active match
    const matchId = this.playerMatchMap.get(ws);
    if (matchId) {
      const match = this.matches.get(matchId);
      if (match && match.status === 'active') {
        // Forfeit - opponent wins
        const isPlayer1 = match.player1.ws === ws;
        const winner = isPlayer1 ? match.player2 : match.player1;
        const loser = isPlayer1 ? match.player1 : match.player2;

        if (match.timeout) clearTimeout(match.timeout);

        this.sendAsBytes(winner.ws, {
          MATCH_FORFEIT: {
            matchId,
            message: 'Your opponent disconnected. You win!'
          }
        });

        // Record forfeit as a win
        const teamManager = this.services?.teamManager;
        if (teamManager) {
          teamManager.recordPvPResult(winner.data.playerId, loser.data.playerId);
          if (teamManager.isDbInitialized) {
            teamManager.databaseManager.saveMatch({
              matchId,
              player1: match.player1.data.playerId,
              player2: match.player2.data.playerId,
              winner: winner.data.playerId,
              p1Taps: match.player1.taps || 0,
              p2Taps: match.player2.taps || 0,
              playedAt: new Date().toISOString()
            }).catch(err => logger.warn('PVP', `Failed to save match: ${err.message}`));
          }
        }

        match.status = 'forfeit';
        this.playerMatchMap.delete(match.player1.ws);
        this.playerMatchMap.delete(match.player2.ws);
        this.matches.delete(matchId);
      }
    }
  }
}

module.exports = PvPHandler;
