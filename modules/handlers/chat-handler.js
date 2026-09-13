/**
 * Chat Handler
 * Free-form chat broadcast: { "message": "hello everyone" }
 */
const BaseHandler = require('./base-handler');
const logger = require('../../utils/logger');

const MAX_CHAT_LENGTH = 500;

class ChatHandler extends BaseHandler {
  constructor() {
    super('CHAT');
    this.registerHandlers();
  }

  registerHandlers() {
    this.register('message', this.handleChatMessage.bind(this));
  }

  /**
   * Broadcast a chat message to all connected clients
   */
  async handleChatMessage(context) {
    const { message, clientid, clientList, wss } = context;

    const client = clientList.get(clientid);
    const playerId = client?.playerId;
    const text = typeof message.message === 'string' ? message.message.trim() : '';

    if (!text || text.length > MAX_CHAT_LENGTH) {
      return;
    }

    // Guests can chat, tagged as such; logged-in players show their name + team
    const from = playerId || clientid;
    const displayName = client?.playerName || 'Guest';
    const team = playerId
      ? context.services.teamManager.getPlayerTeam(playerId)?.teamId || null
      : null;

    const payload = {
      CHAT_MESSAGE: {
        from,
        displayName,
        team,
        text,
        timestamp: new Date().toISOString()
      }
    };

    this.broadcast(wss, payload);
    logger.debug('CHAT', `${displayName} (${from}): ${text.substring(0, 80)}`);
  }
}

module.exports = ChatHandler;
