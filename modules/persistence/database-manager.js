const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('../../utils/logger');

class DatabaseManager {
  constructor(dbPath = './data/game.db') {
    this.dbPath = dbPath;
    this.db = null;
    this.isInitialized = false;
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      // Ensure data directory exists
      const fs = require('fs');
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logger.error('DB', `Failed to connect to database: ${err.message}`);
          reject(err);
        } else {
          logger.info('DB', `Connected to SQLite database at ${this.dbPath}`);
          this.createTables()
            .then(() => {
              this.isInitialized = true;
              resolve();
            })
            .catch(reject);
        }
      });
    });
  }

  async createTables() {
    const tables = [
      // Players table
      `CREATE TABLE IF NOT EXISTS players (
        player_id TEXT PRIMARY KEY,
        team_id TEXT,
        display_name TEXT,
        session_token TEXT,
        rank TEXT DEFAULT 'member',
        loyalty_points INTEGER DEFAULT 0,
        pvp_wins INTEGER DEFAULT 0,
        pvp_losses INTEGER DEFAULT 0,
        total_kills INTEGER DEFAULT 0,
        quests_completed INTEGER DEFAULT 0,
        coins INTEGER DEFAULT 0,
        join_date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Teams table
      `CREATE TABLE IF NOT EXISTS teams (
        team_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        season_points INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Quest progress table
      `CREATE TABLE IF NOT EXISTS quests (
        player_id TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        assigned_at TEXT,
        PRIMARY KEY (player_id, quest_id)
      )`,

      // Match history table
      `CREATE TABLE IF NOT EXISTS matches (
        match_id TEXT PRIMARY KEY,
        player1 TEXT,
        player2 TEXT,
        winner TEXT,
        p1_taps INTEGER DEFAULT 0,
        p2_taps INTEGER DEFAULT 0,
        played_at TEXT
      )`
    ];

    for (const table of tables) {
      await this.run(table);
    }

    // Create indexes for better performance
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id)',
      'CREATE INDEX IF NOT EXISTS idx_players_loyalty ON players(loyalty_points DESC)',
      'CREATE INDEX IF NOT EXISTS idx_players_session_token ON players(session_token)',
      'CREATE INDEX IF NOT EXISTS idx_quests_player ON quests(player_id)',
      'CREATE INDEX IF NOT EXISTS idx_matches_players ON matches(player1, player2)'
    ];

    for (const index of indexes) {
      await this.run(index);
    }

    logger.info('DB', 'Database tables and indexes created successfully');
  }

  // Wrapper for database operations
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('DB', `SQL Error: ${err.message}`);
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error('DB', `SQL Error: ${err.message}`);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('DB', `SQL Error: ${err.message}`);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Player operations
  async savePlayer(player) {
    const sql = `
      INSERT OR REPLACE INTO players (
        player_id, team_id, display_name, session_token, rank, loyalty_points,
        pvp_wins, pvp_losses, total_kills, quests_completed, coins,
        join_date, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    const params = [
      player.playerId,
      player.teamId,
      player.displayName || '',
      player.sessionToken || null,
      player.rank || 'member',
      player.loyaltyPoints || 0,
      player.pvpWins || 0,
      player.pvpLosses || 0,
      player.totalKills || 0,
      player.questsCompleted || 0,
      player.coins || 0,
      player.joinDate || new Date().toISOString()
    ];

    return this.run(sql, params);
  }

  async getPlayer(playerId) {
    const sql = 'SELECT * FROM players WHERE player_id = ?';
    const row = await this.get(sql, [playerId]);

    if (!row) return null;

    return this.mapPlayerRow(row);
  }

  async getPlayerBySessionToken(sessionToken) {
    const sql = 'SELECT * FROM players WHERE session_token = ?';
    const row = await this.get(sql, [sessionToken]);

    if (!row) return null;

    return this.mapPlayerRow(row);
  }

  mapPlayerRow(row) {
    return {
      playerId: row.player_id,
      teamId: row.team_id,
      displayName: row.display_name,
      sessionToken: row.session_token,
      rank: row.rank,
      loyaltyPoints: row.loyalty_points,
      pvpWins: row.pvp_wins,
      pvpLosses: row.pvp_losses,
      totalKills: row.total_kills,
      questsCompleted: row.quests_completed,
      coins: row.coins,
      joinDate: row.join_date
    };
  }

  async getAllPlayers() {
    const rows = await this.all('SELECT * FROM players');
    return rows.map(row => this.mapPlayerRow(row));
  }

  async getPlayersByTeam(teamId) {
    const sql = 'SELECT * FROM players WHERE team_id = ? ORDER BY loyalty_points DESC';
    const rows = await this.all(sql, [teamId]);
    return rows.map(row => this.mapPlayerRow(row));
  }

  // Team operations
  async upsertTeam(team) {
    const sql = `
      INSERT OR REPLACE INTO teams (team_id, name, color, season_points, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;
    return this.run(sql, [team.id, team.name, team.color, team.seasonPoints || 0]);
  }

  async getTeams() {
    return this.all('SELECT * FROM teams');
  }

  // Leaderboard operations
  async getTopPlayersByLoyalty(limit = 10) {
    const sql = `
      SELECT p.*, t.name as team_name
      FROM players p
      LEFT JOIN teams t ON p.team_id = t.team_id
      ORDER BY p.loyalty_points DESC
      LIMIT ?
    `;
    return this.all(sql, [limit]);
  }

  async getTopPlayersByPvP(limit = 10) {
    const sql = `
      SELECT p.*, t.name as team_name,
             (p.pvp_wins * 1.0 / CASE WHEN (p.pvp_wins + p.pvp_losses) = 0 THEN 1 ELSE (p.pvp_wins + p.pvp_losses) END) as win_rate
      FROM players p
      LEFT JOIN teams t ON p.team_id = t.team_id
      WHERE (p.pvp_wins + p.pvp_losses) > 0
      ORDER BY p.pvp_wins DESC, win_rate DESC
      LIMIT ?
    `;
    return this.all(sql, [limit]);
  }

  // Quest operations
  async saveQuestProgress(playerId, questId, progress, completed, assignedAt) {
    const sql = `
      INSERT OR REPLACE INTO quests (player_id, quest_id, progress, completed, assigned_at)
      VALUES (?, ?, ?, ?, ?)
    `;
    return this.run(sql, [playerId, questId, progress, completed ? 1 : 0, assignedAt]);
  }

  async getQuestProgress(playerId, questId) {
    return this.get('SELECT * FROM quests WHERE player_id = ? AND quest_id = ?', [playerId, questId]);
  }

  async getPlayerQuests(playerId) {
    return this.all('SELECT * FROM quests WHERE player_id = ?', [playerId]);
  }

  // Match operations
  async saveMatch(match) {
    const sql = `
      INSERT OR REPLACE INTO matches (match_id, player1, player2, winner, p1_taps, p2_taps, played_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    return this.run(sql, [
      match.matchId,
      match.player1,
      match.player2,
      match.winner,
      match.p1Taps || 0,
      match.p2Taps || 0,
      match.playedAt || new Date().toISOString()
    ]);
  }

  async getPlayerMatches(playerId, limit = 20) {
    const sql = `
      SELECT * FROM matches
      WHERE player1 = ? OR player2 = ?
      ORDER BY played_at DESC
      LIMIT ?
    `;
    return this.all(sql, [playerId, playerId, limit]);
  }

  // ============================================
  // DATABASE HEALTH & MAINTENANCE
  // ============================================

  /**
   * Get database health status
   */
  async getHealth() {
    try {
      const startTime = Date.now();

      // Test query
      await this.get('SELECT 1');
      const queryTime = Date.now() - startTime;

      // Get table counts
      const playerCount = await this.get('SELECT COUNT(*) as count FROM players');
      const teamCount = await this.get('SELECT COUNT(*) as count FROM teams');
      const questCount = await this.get('SELECT COUNT(*) as count FROM quests');
      const matchCount = await this.get('SELECT COUNT(*) as count FROM matches');

      // Get database file size
      const fs = require('fs');
      let fileSize = 0;
      try {
        const stats = fs.statSync(this.dbPath);
        fileSize = stats.size;
      } catch (e) {
        // DB file may not exist yet - report size as 0
      }

      return {
        status: 'healthy',
        initialized: this.isInitialized,
        queryTimeMs: queryTime,
        fileSizeBytes: fileSize,
        fileSizeMB: (fileSize / (1024 * 1024)).toFixed(2),
        tables: {
          players: playerCount?.count || 0,
          teams: teamCount?.count || 0,
          quests: questCount?.count || 0,
          matches: matchCount?.count || 0
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        initialized: this.isInitialized,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Create database backup
   */
  async createBackup() {
    const fs = require('fs');
    const path = require('path');

    try {
      const backupDir = './data/backups';
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `game-backup-${timestamp}.db`);

      // Copy database file
      fs.copyFileSync(this.dbPath, backupPath);

      logger.info('DB', `Backup created: ${backupPath}`);

      return {
        success: true,
        path: backupPath,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('DB', `Backup failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Vacuum database to reclaim space
   */
  async vacuum() {
    try {
      await this.run('VACUUM');
      logger.info('DB', 'Database vacuumed successfully');
      return { success: true };
    } catch (error) {
      logger.error('DB', `Vacuum failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  async getStats() {
    const stats = {};

    // Player stats
    const playerStats = await this.get(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT team_id) as teams,
        SUM(pvp_wins) as totalPvpWins,
        SUM(total_kills) as totalKills,
        AVG(loyalty_points) as avgLoyalty
      FROM players
    `);
    stats.players = playerStats;

    // Match stats
    const matchStats = await this.get(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN winner IS NULL OR winner = '' THEN 1 ELSE 0 END) as ties
      FROM matches
    `);
    stats.matches = matchStats;

    // Recent activity
    const recentMatches = await this.get(`
      SELECT COUNT(*) as count
      FROM matches
      WHERE played_at > datetime('now', '-24 hours')
    `);
    stats.last24Hours = {
      matches: recentMatches?.count || 0
    };

    return stats;
  }

  // Close database connection
  close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            logger.error('DB', `Error closing database: ${err.message}`);
          } else {
            logger.info('DB', 'Database connection closed');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = DatabaseManager;
