/**
 * Game Mode Definitions
 *
 * The matchmaker and arena system read these to size matches, fill empty
 * slots with bots, and decide win conditions. Phase 1 ships Free-for-all;
 * the team modes are defined but gated (enabled: false) until Phase 2.
 *
 * winCondition:
 *   killLimit   - first side/player to reach this many kills wins (0 = ignore)
 *   timeLimitMs - match ends after this long; highest score wins (0 = ignore)
 * If both are set, whichever triggers first ends the match.
 */

const MODES = {
  ffa: {
    id: 'ffa',
    name: 'Free-for-All',
    enabled: true,
    teams: 1,            // 1 "team" = everyone is an enemy (FFA)
    teamSize: 8,         // total players in the arena
    friendlyFire: true,  // irrelevant in FFA, everyone is hostile
    botFill: true,
    heroSelectMs: 15000, // hero-select window before match start
    winCondition: {
      killLimit: 20,
      timeLimitMs: 5 * 60 * 1000
    }
  },

  duo: {
    id: 'duo',
    name: '2v2 Arena',
    enabled: false,
    teams: 2,
    teamSize: 2,
    friendlyFire: false,
    botFill: true,
    heroSelectMs: 15000,
    winCondition: {
      killLimit: 25,
      timeLimitMs: 6 * 60 * 1000
    }
  },

  trio: {
    id: 'trio',
    name: '3v3 Arena',
    enabled: false,
    teams: 2,
    teamSize: 3,
    friendlyFire: false,
    botFill: true,
    heroSelectMs: 20000,
    winCondition: {
      killLimit: 35,
      timeLimitMs: 7 * 60 * 1000
    }
  },

  squad: {
    id: 'squad',
    name: '5v5 Arena',
    enabled: false,
    teams: 2,
    teamSize: 5,
    friendlyFire: false,
    botFill: true,
    heroSelectMs: 25000,
    winCondition: {
      killLimit: 50,
      timeLimitMs: 10 * 60 * 1000
    }
  }
};

/** Total player capacity of an arena for a given mode. */
function capacity(mode) {
  return mode.teams * mode.teamSize;
}

module.exports = {
  MODES,
  MODE_IDS: Object.keys(MODES),
  getMode(id) {
    return MODES[id] || null;
  },
  isValidMode(id) {
    return Object.prototype.hasOwnProperty.call(MODES, id);
  },
  isEnabled(id) {
    return !!(MODES[id] && MODES[id].enabled);
  },
  capacity,
  enabledModes() {
    return Object.values(MODES).filter(m => m.enabled);
  }
};
