// Game Configuration Constants
module.exports = {
  // Server Configuration
  RATE_LIMIT_WINDOW: 1000, // 1 second window (movement packets need ~10/sec headroom)
  RATE_LIMIT_MAX: 40, // 40 messages per second - flood protection, allows movement traffic
  MAX_MESSAGE_SIZE: 10000, // 10KB max message size

  // World state (server-authoritative player positions)
  WORLD: {
    TICK_MS: 100,        // world state broadcast interval (10 Hz)
    BOUND: 95,           // |x| and |z| clamp - matches client ground size (200u)
    MIN_Y: -10,
    MAX_Y: 50,
    MAX_SPEED: 15,       // units/sec; faster reported moves are rejected
    SPEED_SLACK: 3,      // lag tolerance multiplier before rejecting
    SPAWN_RADIUS: 8      // players spawn inside this radius at origin
  },

  // Combat
  COMBAT: {
    MAX_HP: 100,
    SHOT_DAMAGE: 20,
    SHOT_RANGE: 60,         // max hit distance in world units
    FIRE_INTERVAL_MS: 300,  // server-enforced minimum time between shots
    RESPAWN_MS: 5000,       // dead players respawn after 5s
    KILL_LOYALTY: 5         // loyalty points per elimination
  },

  // Payload Obfuscation Configuration (XOR fallback - obfuscation only, not security)
  PAYLOAD_SECRET: process.env.PAYLOAD_SECRET || 'change-me',

  // Game Mechanics
  MATCH_TIMEOUT: 30000, // 30 seconds
  PING_INTERVAL: 30000, // 30 seconds heartbeat sweep

  // Player identity
  PLAYER_ID_MIN_LENGTH: 3,
  PLAYER_ID_MAX_LENGTH: 24,
  PLAYER_ID_PATTERN: /^[A-Za-z0-9_]+$/,

  // Teams (generic - add/remove freely; players auto-assign to smallest team)
  TEAMS: {
    RED: {
      id: 'red',
      name: 'Red Team',
      color: '#DC143C'
    },
    BLUE: {
      id: 'blue',
      name: 'Blue Team',
      color: '#1E90FF'
    },
    GREEN: {
      id: 'green',
      name: 'Green Team',
      color: '#2E8B57'
    }
  },

  // Season scoring rules (points awarded to players + their team)
  SCORING: {
    pvpWin: 10,
    pvpLoss: -2,
    questComplete: 15,
    dailyActivity: 1
  },

  // Quest generation
  QUEST: {
    MIN_ENEMIES: 5,
    MAX_ENEMIES: 20,
    COINS_PER_ENEMY: 200, // reward scales with difficulty
    XP_RATIO: 0.5,        // XP = coins * 0.5
    DURATION_MS: 24 * 60 * 60 * 1000 // daily quests expire after 24h
  },

  // Rank thresholds: [min loyalty points, min pvp wins, rank]
  RANKS: [
    { rank: 'leader',   points: 5000, pvpWins: 100 },
    { rank: 'champion', points: 2500, pvpWins: 50 },
    { rank: 'elite',    points: 1000, pvpWins: 20 },
    { rank: 'veteran',  points: 300,  pvpWins: 5 },
    { rank: 'member',   points: 0,    pvpWins: 0 }
  ],

  STARTING_LOYALTY_POINTS: 100,

  // Banned player IDs
  BANNED_PLAYERS: []
};
