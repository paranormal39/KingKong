/**
 * WebSocket Message Router
 * Routes incoming WebSocket messages to appropriate handlers
 * Provides middleware-like processing pipeline
 */
const crypto = require('crypto');
const logger = require('../../utils/logger');
const CONFIG = require('../../config/constants');
const { getInstance: getHandlerRegistry } = require('../handlers');
const { getInstance: getClientManager } = require('./client-manager');

class WebSocketRouter {
  constructor() {
    this.handlerRegistry = null;
    this.clientManager = null;
    this.middleware = [];
    this.legacyHandler = null; // Fallback for unhandled messages
  }

  /**
   * Decode XOR obfuscated payload
   * Obfuscation only - NOT security. Plaintext JSON is always accepted first.
   * @param {Buffer} buffer - The obfuscated buffer
   * @param {string} secret - The secret key for decoding
   * @returns {Object} - Parsed JSON object
   */
  decodePayload(buffer, secret) {
    let key;
    if (!secret || secret === '') {
      // Fallback: SHA-256 of the server PAYLOAD_SECRET (matches Unity DeriveKeyBytes)
      key = crypto.createHash('sha256').update(CONFIG.PAYLOAD_SECRET, 'utf8').digest();
    } else {
      key = crypto.createHash('sha256').update(secret, 'utf8').digest();
    }
    const result = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      result[i] = buffer[i] ^ key[i % key.length];
    }
    return JSON.parse(result.toString('utf8'));
  }

  /**
   * Initialize the router with services
   */
  initialize(services) {
    this.clientManager = getClientManager();
    this.handlerRegistry = getHandlerRegistry();
    this.handlerRegistry.initialize(services);

    logger.info('ROUTER', 'WebSocket router initialized');
  }

  /**
   * Set legacy handler for messages not handled by the registry
   */
  setLegacyHandler(handler) {
    this.legacyHandler = handler;
  }

  /**
   * Add middleware to processing pipeline
   * Middleware signature: async (message, context, next) => void
   */
  use(middleware) {
    this.middleware.push(middleware);
  }

  /**
   * Process an incoming message
   */
  async processMessage(data, ws, clientid, wss, isBinary = false) {
    // Rate limiting
    if (!this.clientManager.checkRateLimit(clientid)) {
      this.sendAsBytes(ws, { error: 'Rate limit exceeded. Please slow down.' });
      return;
    }

    // Check message size limit
    if (data.length > CONFIG.MAX_MESSAGE_SIZE) {
      logger.warn('ROUTER', 'Message too large');
      return;
    }

    // Parse JSON - handle both plaintext and XOR-obfuscated payloads
    let parsed;

    try {
      const bufferData = Buffer.isBuffer(data) ? data : Buffer.from(data);

      // First, try to parse as plaintext UTF-8 JSON (default)
      try {
        const textData = bufferData.toString('utf8');
        if (textData.trim().startsWith('{') || textData.trim().startsWith('[')) {
          parsed = JSON.parse(textData);
        } else {
          throw new Error('Not plaintext JSON');
        }
      } catch (plainTextErr) {
        // Not plaintext JSON, try XOR decoding (obfuscated Unity payload)
        const clientData = this.clientManager.getClient(clientid);
        const usertoken = clientData?.usertoken || '';
        parsed = this.decodePayload(bufferData, usertoken);
        logger.debug('ROUTER', `Decoded obfuscated payload from ${clientid}`);
      }
    } catch (err) {
      logger.warn('ROUTER', `Invalid message from client: ${err.message}`);
      logger.debug('ROUTER', `Raw data: ${data.toString ? data.toString('hex').substring(0, 100) : 'N/A'}`);
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      logger.warn('ROUTER', 'Invalid message format');
      return;
    }

    // Build context
    const context = {
      message: parsed,
      ws,
      clientid,
      clientList: this.clientManager.getAllClients(),
      wss
    };

    // Log incoming message
    logger.info('ROUTER', `Message from ${clientid}: ${Object.keys(parsed).join(', ')}`);

    // Run middleware
    for (const mw of this.middleware) {
      try {
        const shouldContinue = await mw(parsed, context);
        if (shouldContinue === false) {
          return; // Middleware halted processing
        }
      } catch (error) {
        logger.error('ROUTER', `Middleware error: ${error.message}`);
      }
    }

    // Try to route to the handler registry
    const handled = await this.handlerRegistry.route(parsed, context);

    if (!handled) {
      if (this.legacyHandler) {
        try {
          await this.legacyHandler(parsed, ws, clientid, wss, this.clientManager.getAllClients());
        } catch (error) {
          logger.error('ROUTER', `Legacy handler error: ${error.message}`);
        }
      } else {
        logger.debug('ROUTER', `No handler for keys: [${Object.keys(parsed).join(', ')}] - dropped`);
      }
    }
  }

  /**
   * Handle new client connection
   */
  handleConnection(ws, req, wss) {
    const clientid = this.clientManager.addClient(ws, req);

    // Set up heartbeat
    ws.on('pong', () => this.clientManager.heartbeat(clientid));

    // Set up message handler
    ws.on('message', async (data, isBinary) => {
      await this.processMessage(data, ws, clientid, wss, isBinary);
    });

    // Set up close handler
    ws.on('close', () => {
      this.handleDisconnect(clientid);
    });

    // Set up error handler
    ws.on('error', (error) => {
      logger.error('ROUTER', `WebSocket error for ${clientid}: ${error.message}`);
    });

    return clientid;
  }

  /**
   * Handle client disconnect
   */
  handleDisconnect(clientid) {
    // Notify handlers before removing the client so they can still access state.
    try {
      this.handlerRegistry.notifyDisconnect(clientid);
    } catch (error) {
      logger.error('ROUTER', `notifyDisconnect error: ${error.message}`);
    }

    const clientData = this.clientManager.removeClient(clientid);
    return clientData;
  }

  /**
   * Send data as bytes
   */
  sendAsBytes(ws, data) {
    if (ws && ws.readyState === 1) {
      const jsonString = typeof data === 'string' ? data : JSON.stringify(data);
      const buffer = Buffer.from(jsonString, 'utf-8');
      ws.send(buffer);
    }
  }

  /**
   * Get router statistics
   */
  getStats() {
    return {
      clients: this.clientManager.getStats(),
      handlers: this.handlerRegistry.getRegisteredTypes()
    };
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new WebSocketRouter();
  }
  return instance;
}

module.exports = {
  WebSocketRouter,
  getInstance
};
