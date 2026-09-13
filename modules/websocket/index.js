/**
 * WebSocket Module
 * Exports router and client manager
 */
const { WebSocketRouter, getInstance: getRouter } = require('./router');
const { ClientManager, getInstance: getClientManager } = require('./client-manager');

module.exports = {
  WebSocketRouter,
  ClientManager,
  getRouter,
  getClientManager
};
