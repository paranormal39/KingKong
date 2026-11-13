/**
 * Quest Handler
 * Handles quest-related messages:
 * - REQUEST_DAILY_QUEST
 * - GET_KILL_STATS
 * - VERIFY_QUEST_COMPLETION
 *
 * Kill progress is tracked server-side from real gameplay kills
 * (teamManager.recordGameplayKill, called by arenas) — clients no longer
 * self-report kills.
 */
const BaseHandler = require('./base-handler');
const logger = require('../../utils/logger');
const CONFIG = require('../../config/constants');

const QUEST_LOCATIONS = [
  'Dragon\'s Lair',
  'Light Temple Grounds',
  'Shield Fortress Walls',
  'Forbidden Spell Ruins',
  'Temporal Rifts',
  'Cursed Battlefields',
  'Ancient Oracle Chambers',
  'Shadow Realms',
  'Royal Palace Grounds',
  'Enchanted Forests',
  'Mountain Passes',
  'Haunted Castles'
];

const QUEST_ENEMIES = [
  'Shadow Beasts',
  'Corrupted Knights',
  'Rogue Mages',
  'Chaos Demons',
  'Ancient Spirits',
  'Dark Cultists',
  'Dimensional Wraiths',
  'Crystal Golems',
  'Storm Elementals',
  'Fire Elementals',
  'Ice Wraiths'
];

/**
 * Generate a daily enemy-slaying quest.
 * Exported so other handlers (e.g. session first-login) can reuse it.
 */
function generateDailyQuest(playerName, teamName) {
  const location = QUEST_LOCATIONS[Math.floor(Math.random() * QUEST_LOCATIONS.length)];
  const enemy = QUEST_ENEMIES[Math.floor(Math.random() * QUEST_ENEMIES.length)];
  const enemyCount = Math.floor(Math.random() * (CONFIG.QUEST.MAX_ENEMIES - CONFIG.QUEST.MIN_ENEMIES + 1)) + CONFIG.QUEST.MIN_ENEMIES;
  const coinReward = enemyCount * CONFIG.QUEST.COINS_PER_ENEMY;
  const xpReward = Math.floor(coinReward * CONFIG.QUEST.XP_RATIO);

  const teamTitle = teamName ? `champion of ${teamName}` : 'lone adventurer';

  let difficulty;
  if (enemyCount <= 8) {
    difficulty = 'Easy';
  } else if (enemyCount <= 14) {
    difficulty = 'Medium';
  } else {
    difficulty = 'Hard';
  }

  return {
    id: `daily_quest_${Date.now()}`,
    title: `Slay the ${enemy} at ${location}`,
    description: `"${playerName}, ${teamTitle}, dark forces gather at ${location}! Slay ${enemyCount} ${enemy} before they threaten our realm."`,
    questType: 'ENEMY_SLAYING',
    type: 'DAILY_ACTIVE',
    location,
    enemies: enemy,
    enemyCount,
    objectives: [
      `Travel to ${location}`,
      `Slay ${enemyCount} ${enemy}`,
      'Return victorious to claim your reward'
    ],
    difficulty,
    rewards: `${coinReward} coins + ${xpReward} XP`,
    reward: {
      coins: coinReward,
      xp: xpReward
    },
    date: new Date().toISOString().split('T')[0],
    playerName,
    team: teamName || null,
    expires: new Date(Date.now() + CONFIG.QUEST.DURATION_MS).toISOString(),
    generatedAt: new Date().toISOString(),
    status: 'active'
  };
}

class QuestHandler extends BaseHandler {
  constructor() {
    super('QUEST');
    this.registerHandlers();
  }

  registerHandlers() {
    this.register('REQUEST_DAILY_QUEST', this.handleRequestDailyQuest.bind(this));
    this.register('GET_KILL_STATS', this.handleGetKillStats.bind(this));
    this.register('VERIFY_QUEST_COMPLETION', this.handleVerifyQuestCompletion.bind(this));
  }

  /**
   * Request a daily quest
   */
  async handleRequestDailyQuest(context) {
    const { message, ws, clientid, clientList } = context;
    const { teamManager } = context.services;

    const playerId = this.requirePlayer(context);
    const player = teamManager.getPlayer(playerId);
    const team = player ? teamManager.getTeamById(player.teamId) : null;
    const playerName = message.playerName || clientList.get(clientid)?.playerName || 'Champion';

    // Generate quest
    const quest = generateDailyQuest(playerName, team?.name);

    // Store active quest for this client
    const client = clientList.get(clientid);
    if (client) {
      client.activeQuest = quest;
    }

    // Persist assignment
    this.persistQuestProgress(teamManager, playerId, quest.id, 0, false);

    this.sendAsBytes(ws, {
      DAILY_QUEST: {
        quest,
        message: `A new quest awaits! "${quest.title}"`
      }
    });

    logger.info('QUEST', `Quest generated for ${playerId} - ${quest.title}`);
  }

  /**
   * Check if quest is completed and award rewards
   */
  async checkQuestCompletion(context, playerId, questId, currentKills, questData) {
    const { teamManager } = context.services;

    const requiredKills = questData.enemyCount || 10;

    if (currentKills < requiredKills || questData.status !== 'active') {
      return { completed: false };
    }

    const questReward = questData.reward || { coins: 1000, xp: 500 };

    // Mark as completed (prevents double-reward in this process)
    if (!questData.completedBy) questData.completedBy = [];
    if (questData.completedBy.includes(playerId)) {
      return { completed: false };
    }
    questData.completedBy.push(playerId);

    // Award loyalty points + coins via team manager
    teamManager.recordQuestCompletion(playerId, questReward);

    // Persist completion
    this.persistQuestProgress(teamManager, playerId, questId, currentKills, true);

    logger.info('QUEST', `Quest completed: ${questData.title} by ${playerId}`, {
      questId, kills: currentKills, reward: questReward
    });

    return { completed: true, reward: questReward, questData };
  }

  /**
   * Get player kill statistics
   */
  async handleGetKillStats(context) {
    const { ws } = context;
    const { teamManager } = context.services;

    const playerId = this.requirePlayer(context);
    const player = teamManager.getPlayer(playerId);

    this.sendAsBytes(ws, {
      KILL_STATS: {
        playerId,
        totalLifetimeKills: player?.totalKills || 0,
        killsByEnemyType: player?.killsByType || {},
        questKillProgress: player?.questKills || {},
        coins: player?.coins || 0,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Verify quest completion (server-side validation)
   */
  async handleVerifyQuestCompletion(context) {
    const { message, ws, clientid, clientList } = context;
    const { teamManager } = context.services;

    const playerId = this.requirePlayer(context);
    const player = teamManager.ensureTeam(playerId);

    const verifyData = (message.VERIFY_QUEST_COMPLETION && typeof message.VERIFY_QUEST_COMPLETION === 'object')
      ? message.VERIFY_QUEST_COMPLETION
      : message;
    const { questId } = verifyData;

    const serverKills = player?.questKills?.[questId] || 0;

    // Find quest data - client's active quest
    const clientData = clientList.get(clientid);
    const questData = clientData?.activeQuest?.id === questId ? clientData.activeQuest : null;

    if (!questData) {
      this.sendAsBytes(ws, {
        QUEST_VERIFICATION_ERROR: 'Quest not found or expired'
      });
      return;
    }

    const requiredKills = questData.enemyCount || 10;
    const isComplete = serverKills >= requiredKills;
    const alreadyRewarded = questData.completedBy?.includes(playerId);

    if (isComplete && !alreadyRewarded) {
      const result = await this.checkQuestCompletion(
        context, playerId, questId, serverKills, questData
      );

      this.sendAsBytes(ws, {
        QUEST_VERIFICATION_RESULT: {
          questId,
          verified: true,
          complete: true,
          rewarded: true,
          serverKills,
          requiredKills,
          questTitle: questData.title,
          reward: result.reward,
          newCoinBalance: player.coins,
          message: `Quest Verified & Complete! You earned ${result.reward.coins} coins and ${result.reward.xp} XP!`
        }
      });
    } else if (alreadyRewarded) {
      this.sendAsBytes(ws, {
        QUEST_VERIFICATION_RESULT: {
          questId,
          verified: true,
          complete: true,
          rewarded: false,
          alreadyRewarded: true,
          serverKills,
          requiredKills,
          questTitle: questData.title,
          message: 'Quest already completed and rewarded!'
        }
      });
    } else {
      this.sendAsBytes(ws, {
        QUEST_VERIFICATION_RESULT: {
          questId,
          verified: true,
          complete: false,
          rewarded: false,
          serverKills,
          requiredKills,
          progress: Math.floor((serverKills / requiredKills) * 100),
          questTitle: questData.title,
          message: `Quest in progress: ${serverKills}/${requiredKills} enemies defeated`
        }
      });
    }
  }

  persistQuestProgress(teamManager, playerId, questId, progress, completed) {
    if (!teamManager.isDbInitialized) return;
    teamManager.databaseManager.saveQuestProgress(
      playerId, questId, progress, completed, new Date().toISOString()
    ).catch(err => logger.warn('QUEST', `Failed to persist quest progress: ${err.message}`));
  }
}

module.exports = QuestHandler;
module.exports.generateDailyQuest = generateDailyQuest;
