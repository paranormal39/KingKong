/**
 * Standardized Error Codes and Error Handling Utilities
 * Provides consistent error responses across the application
 */

// Error code categories
const ErrorCodes = {
  // Authentication & Session (1xxx)
  PLAYER_NOT_LOGGED_IN: { code: 1001, message: 'Player not logged in', httpStatus: 401 },
  INVALID_PLAYER_ID: { code: 1002, message: 'Invalid player ID format', httpStatus: 400 },
  SESSION_EXPIRED: { code: 1003, message: 'Session expired', httpStatus: 401 },
  DUPLICATE_CONNECTION: { code: 1004, message: 'Player already connected on another device', httpStatus: 409 },
  BANNED_PLAYER: { code: 1005, message: 'This player has been banned', httpStatus: 403 },

  // Teams (2xxx)
  NOT_IN_TEAM: { code: 2001, message: 'Player not in a team', httpStatus: 400 },
  TEAM_NOT_FOUND: { code: 2002, message: 'Team not found', httpStatus: 404 },

  // Economy (3xxx)
  INSUFFICIENT_BALANCE: { code: 3002, message: 'Insufficient balance', httpStatus: 400 },
  INVALID_AMOUNT: { code: 3005, message: 'Invalid amount', httpStatus: 400 },

  // PvP & Matchmaking (4xxx)
  NOT_IN_QUEUE: { code: 4001, message: 'Not in matchmaking queue', httpStatus: 400 },
  MATCH_NOT_FOUND: { code: 4002, message: 'Match not found', httpStatus: 404 },
  MATCH_ALREADY_ENDED: { code: 4003, message: 'Match has already ended', httpStatus: 400 },
  ALREADY_IN_QUEUE: { code: 4006, message: 'Already in matchmaking queue', httpStatus: 409 },

  // Quests (5xxx)
  QUEST_NOT_FOUND: { code: 5001, message: 'Quest not found', httpStatus: 404 },
  QUEST_EXPIRED: { code: 5002, message: 'Quest has expired', httpStatus: 400 },
  QUEST_ALREADY_COMPLETED: { code: 5003, message: 'Quest already completed', httpStatus: 409 },
  QUEST_COOLDOWN: { code: 5004, message: 'Quest on cooldown', httpStatus: 429 },

  // Rate Limiting (8xxx)
  RATE_LIMIT_EXCEEDED: { code: 8001, message: 'Rate limit exceeded', httpStatus: 429 },
  TOO_MANY_REQUESTS: { code: 8002, message: 'Too many requests', httpStatus: 429 },

  // Server (9xxx)
  INTERNAL_ERROR: { code: 9001, message: 'Internal server error', httpStatus: 500 },
  SERVICE_UNAVAILABLE: { code: 9002, message: 'Service temporarily unavailable', httpStatus: 503 },
  DATABASE_ERROR: { code: 9003, message: 'Database error', httpStatus: 500 },
  INVALID_REQUEST: { code: 9004, message: 'Invalid request format', httpStatus: 400 },
  MISSING_PARAMETER: { code: 9005, message: 'Missing required parameter', httpStatus: 400 }
};

/**
 * Application Error class with error code support
 */
class AppError extends Error {
  constructor(errorCode, details = null) {
    const errorDef = typeof errorCode === 'object' ? errorCode : ErrorCodes[errorCode];

    if (!errorDef) {
      super('Unknown error');
      this.code = 9999;
      this.httpStatus = 500;
    } else {
      super(errorDef.message);
      this.code = errorDef.code;
      this.httpStatus = errorDef.httpStatus;
    }

    this.name = 'AppError';
    this.details = details;
    this.timestamp = new Date().toISOString();

    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp
    };
  }

  toWebSocketResponse(messageType = 'ERROR') {
    return {
      [`${messageType}_ERROR`]: {
        code: this.code,
        message: this.message,
        details: this.details,
        timestamp: this.timestamp
      }
    };
  }
}

/**
 * Create standardized error response for WebSocket
 */
function createErrorResponse(messageType, errorCode, details = null) {
  const errorDef = typeof errorCode === 'object' ? errorCode : ErrorCodes[errorCode];

  return {
    [`${messageType}_ERROR`]: {
      code: errorDef?.code || 9999,
      message: errorDef?.message || 'Unknown error',
      details,
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * Create standardized success response for WebSocket
 */
function createSuccessResponse(messageType, data, message = null) {
  return {
    [`${messageType}_SUCCESS`]: {
      success: true,
      data,
      message,
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * Wrap async handler with error catching
 */
function asyncHandler(handler) {
  return async (context) => {
    try {
      await handler(context);
    } catch (error) {
      const logger = require('./logger');

      if (error instanceof AppError) {
        logger.error('HANDLER', error.message, { code: error.code, details: error.details });

        if (context.ws && context.ws.readyState === 1) {
          const response = error.toWebSocketResponse();
          const buffer = Buffer.from(JSON.stringify(response), 'utf-8');
          context.ws.send(buffer);
        }
      } else {
        logger.error('HANDLER', `Unexpected error: ${error.message}`, { stack: error.stack });

        if (context.ws && context.ws.readyState === 1) {
          const response = createErrorResponse('INTERNAL', ErrorCodes.INTERNAL_ERROR, error.message);
          const buffer = Buffer.from(JSON.stringify(response), 'utf-8');
          context.ws.send(buffer);
        }
      }
    }
  };
}

/**
 * Express error handler middleware
 */
function expressErrorHandler(err, req, res, next) {
  const logger = require('./logger');

  if (err instanceof AppError) {
    logger.error('HTTP', err.message, { code: err.code, path: req.path });
    return res.status(err.httpStatus).json(err.toJSON());
  }

  logger.error('HTTP', `Unexpected error: ${err.message}`, { stack: err.stack, path: req.path });
  return res.status(500).json({
    error: true,
    code: 9001,
    message: 'Internal server error',
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  ErrorCodes,
  AppError,
  createErrorResponse,
  createSuccessResponse,
  asyncHandler,
  expressErrorHandler
};
