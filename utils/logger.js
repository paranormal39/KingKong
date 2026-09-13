/**
 * Enhanced Logging System
 * Supports console output, file logging, error tracking, and structured logs
 */
const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.levels = {
      ERROR: 0,
      WARN: 1,
      INFO: 2,
      DEBUG: 3
    };

    this.currentLevel = process.env.LOG_LEVEL || 'INFO';
    this.colors = {
      ERROR: '\x1b[31m', // Red
      WARN: '\x1b[33m',  // Yellow
      INFO: '\x1b[36m',  // Cyan
      DEBUG: '\x1b[37m', // White
      RESET: '\x1b[0m'
    };

    // Error tracking
    this.errorCounts = new Map();
    this.recentErrors = [];
    this.maxRecentErrors = 100;

    // File logging (optional)
    this.logToFile = process.env.LOG_TO_FILE === 'true';
    this.logDir = process.env.LOG_DIR || './logs';
    this.logFile = null;

    if (this.logToFile) {
      this.initFileLogging();
    }
  }

  initFileLogging() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      const date = new Date().toISOString().split('T')[0];
      this.logFile = path.join(this.logDir, `gameserver-${date}.log`);
    } catch (err) {
      console.error('Failed to initialize file logging:', err.message);
      this.logToFile = false;
    }
  }

  shouldLog(level) {
    return this.levels[level] <= this.levels[this.currentLevel];
  }

  formatMessage(level, category, message, data = null) {
    const timestamp = new Date().toISOString();
    const color = this.colors[level];
    const reset = this.colors.RESET;

    // Console format with colors
    let consoleMsg = `${color}[${timestamp}] ${level}:${reset} ${category}\n${color}${JSON.stringify(message)}${reset}`;

    // Plain format for file
    let plainMsg = `[${timestamp}] ${level}: ${category} - ${typeof message === 'string' ? message : JSON.stringify(message)}`;

    if (data) {
      const dataStr = JSON.stringify(data);
      consoleMsg += `\n${dataStr}`;
      plainMsg += ` | ${dataStr}`;
    }

    return { consoleMsg, plainMsg };
  }

  writeToFile(message) {
    if (this.logToFile && this.logFile) {
      try {
        fs.appendFileSync(this.logFile, message + '\n');
      } catch (err) {
        // Silently fail file writes
      }
    }
  }

  trackError(category, message) {
    const key = `${category}:${message}`;
    const count = (this.errorCounts.get(key) || 0) + 1;
    this.errorCounts.set(key, count);

    this.recentErrors.push({
      timestamp: new Date().toISOString(),
      category,
      message,
      count
    });

    if (this.recentErrors.length > this.maxRecentErrors) {
      this.recentErrors.shift();
    }
  }

  error(category, message, data = null) {
    if (this.shouldLog('ERROR')) {
      const { consoleMsg, plainMsg } = this.formatMessage('ERROR', category, message, data);
      console.error(consoleMsg);
      this.writeToFile(plainMsg);
      this.trackError(category, typeof message === 'string' ? message : JSON.stringify(message));
    }
  }

  warn(category, message, data = null) {
    if (this.shouldLog('WARN')) {
      const { consoleMsg, plainMsg } = this.formatMessage('WARN', category, message, data);
      console.warn(consoleMsg);
      this.writeToFile(plainMsg);
    }
  }

  info(category, message, data = null) {
    if (this.shouldLog('INFO')) {
      const { consoleMsg, plainMsg } = this.formatMessage('INFO', category, message, data);
      console.log(consoleMsg);
      this.writeToFile(plainMsg);
    }
  }

  debug(category, message, data = null) {
    if (this.shouldLog('DEBUG')) {
      const { consoleMsg, plainMsg } = this.formatMessage('DEBUG', category, message, data);
      console.log(consoleMsg);
      this.writeToFile(plainMsg);
    }
  }

  // Game-specific logging methods
  connection(action, clientId, playerId = null) {
    this.info('CONNECTION', action, { clientId, playerId });
  }

  match(action, matchId, players = null) {
    this.info('MATCH', action, { matchId, players });
  }

  security(event, details) {
    this.warn('SECURITY', event, details);
  }

  // Error statistics
  getErrorStats() {
    const stats = {
      totalErrors: 0,
      byCategory: {},
      recentErrors: this.recentErrors.slice(-10)
    };

    for (const [key, count] of this.errorCounts.entries()) {
      const [category] = key.split(':');
      stats.totalErrors += count;
      stats.byCategory[category] = (stats.byCategory[category] || 0) + count;
    }

    return stats;
  }

  // Clear error tracking
  clearErrors() {
    this.errorCounts.clear();
    this.recentErrors = [];
  }
}

module.exports = new Logger();
