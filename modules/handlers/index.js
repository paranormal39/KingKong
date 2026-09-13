/**
 * Handler Registry
 * Central registry for all message handlers
 * Provides routing of WebSocket messages to appropriate handlers
 */
const logger = require('../../utils/logger');

// Import all handlers
const SessionHandler = require('./session-handler');
const ChatHandler = require('./chat-handler');
const PvPHandler = require('./pvp-handler');
const QuestHandler = require('./quest-handler');
const TeamHandler = require('./team-handler');
const PresenceHandler = require('./presence-handler');

class HandlerRegistry {
  constructor() {
    this.handlers = [];
    this.services = {};
  }

  /**
   * Initialize all handlers with required services
   * @param {Object} services - Shared services (teamManager, config)
   */
  initialize(services) {
    this.services = services;

    // Register all handlers
    this.handlers = [
      new SessionHandler(),
      new ChatHandler(),
      new PvPHandler(),
      new QuestHandler(),
      new TeamHandler(),
      new PresenceHandler()
    ];

    // Give each handler access to services (needed by onDisconnect hooks
    // that run outside the normal message context)
    this.handlers.forEach(handler => {
      handler.services = services;
    });

    logger.info('HANDLERS', `Initialized ${this.handlers.length} message handlers`);

    // Log all registered message types
    const messageTypes = [];
    this.handlers.forEach(handler => {
      handler.handlers.forEach((_, type) => messageTypes.push(type));
    });
    logger.info('HANDLERS', `Registered message types: ${messageTypes.join(', ')}`);
  }

  /**
   * Route a message to the appropriate handler
   * @param {Object} message - Parsed JSON message
   * @param {Object} context - { ws, clientid, clientList, wss }
   * @returns {Promise<boolean>} - True if message was handled
   */
  async route(message, context) {
    // Add services to context
    context.services = this.services;
    context.message = message;

    const messageKeys = Object.keys(message);
    logger.info('ROUTER', `Routing check for message keys: [${messageKeys.join(', ')}]`);

    for (const handler of this.handlers) {
      const messageType = handler.canHandle(message);
      if (messageType) {
        logger.info('ROUTER', `Routing ${messageType} to ${handler.name}`);
        return await handler.handle(messageType, context);
      }
    }

    // No handler found - return false to let the legacy fallback handle it
    logger.info('ROUTER', `No handler found for keys: [${messageKeys.join(', ')}] - falling back`);
    return false;
  }

  /**
   * Notify all handlers that a client has disconnected so they can clean up.
   * Handlers may optionally implement an `onDisconnect(clientid)` method.
   */
  notifyDisconnect(clientid) {
    for (const handler of this.handlers) {
      if (typeof handler.onDisconnect === 'function') {
        try {
          handler.onDisconnect(clientid);
        } catch (error) {
          logger.error('HANDLERS', `onDisconnect error in ${handler.name}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Get list of all registered message types
   */
  getRegisteredTypes() {
    const types = [];
    this.handlers.forEach(handler => {
      handler.handlers.forEach((_, type) => {
        types.push({ handler: handler.name, type });
      });
    });
    return types;
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new HandlerRegistry();
  }
  return instance;
}

module.exports = {
  HandlerRegistry,
  getInstance
};
