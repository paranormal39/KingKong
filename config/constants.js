// Game Configuration Constants
module.exports = {
  // Server Configuration
  RATE_LIMIT_WINDOW: 1000, // 1 second window (movement + fire + abilities need headroom)
  RATE_LIMIT_MAX: 60, // 60 messages per second - flood protection, allows movement + combat traffic
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

  // Combat (fallback defaults; per-hero weapon stats live in config/heroes.js)
  COMBAT: {
    MAX_HP: 100,
    SHOT_DAMAGE: 20,
    SHOT_RANGE: 60,         // max hit distance in world units
    FIRE_INTERVAL_MS: 300,  // server-enforced minimum time between shots
    RESPAWN_MS: 5000,       // dead players respawn after 5s
    KILL_LOYALTY: 5         // loyalty points per elimination
  },

  // Arena / match instances
  ARENA: {
    TICK_MS: 100,            // per-arena world-state + effect tick (10 Hz)
    QUEUE_WAIT_MS: 8000,     // wait for more humans before filling with bots
    MIN_HUMANS_TO_START: 1,  // a single human can start a (bot-filled) match
    EMPTY_CLOSE_MS: 10000,   // tear down an arena with no humans after this
    RESULTS_LINGER_MS: 8000  // keep a finished arena alive to show results
  },

  // Abilities
  ABILITY: {
    SLOTS: ['tactical', 'special', 'movement', 'ultimate'],
    ULT_CHARGE_PER_KILL: 35,     // ultimate charge gained per elimination
    ULT_CHARGE_PER_SECOND: 4,    // passive ultimate charge over time
    ULT_CHARGE_NEEDED: 100,      // charge required to use the ultimate
    STATUS_TICK_MS: 500          // how often DoT / regen / zones tick
  },

  // Bots (simple AI fill) - deliberately imperfect so they feel fair
  BOT: {
    NAMES: ['Hex', 'Mystia', 'Raven', 'Circe', 'Morgana', 'Selene', 'Nyx', 'Wanda', 'Agatha', 'Lilith'],
    THINK_MS: 350,           // AI decision interval (slower = more sluggish aim)
    AGGRO_RANGE: 55,         // start shooting within this distance
    MOVE_SPEED: 9,           // bot world movement speed (units/sec)
    FIRE_JITTER: 0.45,       // chance a bot hesitates (skips firing) each think
    ACCURACY: 0.45,          // chance a fired shot is actually on-target (else it whiffs)
    REACTION_MS: 650,        // delay after spotting a new target before it can shoot
    ABILITY_CHANCE: 0.1      // chance a bot uses an off-cooldown ability each think
  },

  // Payload Obfuscation Configuration (XOR fallback - obfuscation only, not security)
  PAYLOAD_SECRET: process.env.PAYLOAD_SECRET || 'change-me',

  // Game Mechanics
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
