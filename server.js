/**
 * KingKong Game Server - Modular Entry Point
 *
 * Plain real-time game backend: sessions, teams, chat, PvP, quests, persistence.
 *
 * Usage: node server.js
 */

const WebSocket = require('ws');
const express = require('express');
require('dotenv').config();
const cron = require('node-cron');

// Core imports
const CONFIG = require('./config/constants');
const logger = require('./utils/logger');
const { expressErrorHandler } = require('./utils/errors');

// Team System
const TeamManager = require('./modules/teams/team-manager');

// Arena system (instanced match rooms + matchmaking + bots)
const ArenaManager = require('./modules/arena/arena-manager');

// Modular WebSocket System
const { getRouter, getClientManager } = require('./modules/websocket');

// ============================================
// INITIALIZE CORE SYSTEMS
// ============================================

const teamManager = new TeamManager();
const clientManager = getClientManager();
const arenaManager = new ArenaManager(clientManager, teamManager);

// Services object passed to all handlers
const services = {
  teamManager,
  clientManager,
  arenaManager,
  config: CONFIG
};

// ============================================
// DATABASE INITIALIZATION
// ============================================

async function initializePersistence() {
  logger.info('SERVER', 'Initializing database and persistence layer...');

  await teamManager.initializeDatabase();
  await teamManager.loadData();

  teamManager.startAutoSave(5);

  logger.info('SERVER', 'Database initialized with auto-save enabled');
}

// ============================================
// EXPRESS APP SETUP
// ============================================

const app = express();
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
  const router = getRouter();
  let dbHealth = { status: 'unknown' };

  try {
    if (teamManager.databaseManager) {
      dbHealth = await teamManager.databaseManager.getHealth();
    }
  } catch (e) {
    dbHealth = { status: 'error', error: e.message };
  }

  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: dbHealth,
    teams: teamManager.teams.size,
    players: teamManager.players.size,
    arenas: arenaManager.getStats(),
    handlers: router.getStats().handlers.length,
    clients: router.getStats().clients
  });
});

// Error statistics endpoint
app.get('/api/errors', (req, res) => {
  res.json({
    success: true,
    errors: logger.getErrorStats(),
    timestamp: new Date().toISOString()
  });
});

// Database stats endpoint
app.get('/api/db/stats', async (req, res) => {
  try {
    const stats = await teamManager.databaseManager.getStats();
    res.json({ success: true, stats, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Database backup endpoint
app.post('/api/db/backup', async (req, res) => {
  try {
    const result = await teamManager.databaseManager.createBackup();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use(expressErrorHandler);

// ============================================
// WEBSOCKET SERVER SETUP
// ============================================

const port = process.env.PORT || 8080;
const server = app.listen(port, () => {
  logger.info('SERVER', `HTTP server running on port ${port}`);
});

const wss = new WebSocket.Server({ server }, () => {
  logger.info('SERVER', `WebSocket server started on port ${port}`);
});

// Initialize the router with services
const router = getRouter();
router.initialize(services);

// Fallback for messages with no registered handler: log and drop
router.setLegacyHandler(async (message, ws, clientid) => {
  logger.debug('LEGACY', `Unhandled message from ${clientid}: ${Object.keys(message).join(', ')}`);
});

// Handle new connections
wss.on('connection', (ws, req) => {
  const clientid = router.handleConnection(ws, req, wss);
  logger.info('SERVER', `Client ${clientid} connected`);
});

// ============================================
// SCHEDULED TASKS
// ============================================

// Heartbeat sweep - terminate dead connections
setInterval(() => {
  clientManager.checkDeadConnections();
}, CONFIG.PING_INTERVAL);

// Arena tick - advance every live match (combat, abilities, bots, broadcasts)
setInterval(() => {
  arenaManager.tickAll();
}, CONFIG.ARENA.TICK_MS);

// Daily maintenance
cron.schedule('0 1 * * *', () => {
  logger.info('CRON', 'Running daily maintenance tasks');
  teamManager.backupData();
});

// ============================================
// STARTUP
// ============================================

async function start() {
  try {
    await initializePersistence();

    logger.info('SERVER', '=== KingKong Game Server Started ===');
    logger.info('SERVER', `Handlers: ${router.getStats().handlers.length} registered`);
  } catch (error) {
    logger.error('SERVER', `Startup failed: ${error.message}`);
    process.exit(1);
  }
}

start();

// ============================================
// SHUTDOWN & ERROR HANDLING
// ============================================

async function shutdown() {
  logger.info('SERVER', 'Shutting down...');
  try {
    await teamManager.shutdown();
  } catch (e) {
    logger.error('SERVER', `Shutdown error: ${e.message}`);
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (error, origin) => {
  logger.error('SERVER', `Uncaught exception: ${error.message}`);
  console.error('Origin:', origin);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('SERVER', `Unhandled rejection: ${reason}`);
});

module.exports = { app, wss, services };
