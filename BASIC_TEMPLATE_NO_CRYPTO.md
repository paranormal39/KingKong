# Basic Game Server Template (No Crypto)

A blueprint for rebuilding the GodzillaV3 server architecture as a plain
real-time game backend — same patterns, minus all blockchain integration
(XRPL, XUMM, Solana, NFTs, tokens, Midnight, Votechain).

Use this to scaffold a WebSocket game server for a Unity (or any) client
with sessions, teams, chat, matchmaking, quests, and persistence.

---

## 1. What Gets Removed vs. Kept

| Removed (crypto)                          | Kept (game server core)                |
|-------------------------------------------|----------------------------------------|
| `xrpl`, `xumm-sdk` sign-in / payments     | `ws` WebSocket transport               |
| `@solana/*`, `@metaplex-*`, `bs58`        | `express` HTTP API + `/health`         |
| `pinata-web3` (IPFS metadata)             | `sqlite3` persistence                  |
| Token payments, burns, airdrops           | Modular handler registry + router      |
| NFT-based faction assignment              | Client manager (rate limit, heartbeat) |
| Wallet identity (`r...` / base58 address) | Factions → generic "teams"             |
| DAO treasury execution on-chain           | PvP matchmaking, quests, chat, seasons |

Identity changes from "wallet address" to a simple `playerId` (username
or UUID issued at first login). Everything else in the architecture is
unchanged.

## 2. Tech Stack

```json
{
  "engines": { "node": ">=20.0.0" },
  "dependencies": {
    "ws": "^8.18.0",
    "express": "^4.21.0",
    "sqlite3": "^5.1.7",
    "dotenv": "^16.4.5",
    "node-cron": "^3.0.3",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "eslint": "^8.57.0",
    "prettier": "^3.2.5"
  }
}
```

Optional: `helmet` + `compression` for the HTTP layer, `nodemailer` for
email notifications.

## 3. Project Structure

```
game-server/
├── server.js                    # Entry point: HTTP + WS + services + startup
├── .env                         # PORT, LOG_LEVEL, PAYLOAD_SECRET
├── config/
│   └── constants.js             # Teams, seasons, rate limits, scoring rules
├── utils/
│   ├── logger.js                # Leveled logging (ERROR/WARN/INFO/DEBUG)
│   └── errors.js                # Typed error classes
├── modules/
│   ├── websocket/
│   │   ├── index.js             # Exports router singleton
│   │   ├── router.js            # Parse → middleware → route → fallback
│   │   └── client-manager.js    # Connections, rate limits, heartbeat
│   ├── handlers/
│   │   ├── index.js             # HandlerRegistry: register + route
│   │   ├── base-handler.js      # Base class: register/canHandle/handle/send
│   │   ├── session-handler.js   # LOGIN, RESTORE_SESSION
│   │   ├── chat-handler.js      # Free-form chat broadcast
│   │   ├── pvp-handler.js       # JOIN_QUEUE, TAP, match lifecycle
│   │   ├── quest-handler.js     # REQUEST_DAILY_QUEST, REPORT_ENEMY_KILL
│   │   └── team-handler.js      # TEAM_STATUS, GET_LEADERBOARD
│   ├── teams/
│   │   └── team-manager.js      # Team state, seasons, loyalty points
│   └── persistence/
│       ├── data-manager.js      # JSON file save/load (simple state)
│       └── database-manager.js  # SQLite schema + queries + backups
└── data/                        # game.db + JSON snapshots (gitignored)
```

## 4. Message Protocol

Same convention as the source project — messages are flat JSON objects
where the **key name is the message type**:

```jsonc
// Client → Server
{ "LOGIN": true, "playerId": "ash", "displayName": "Ash" }
{ "JOIN_QUEUE": true, "playerId": "ash", "powerLevel": 12 }
{ "TAP": true }
{ "message": "hello everyone" }

// Server → Client (sent as UTF-8 Buffer for Unity WebGL compatibility)
{ "LOGIN_COMPLETE": { "playerId": "ash", "team": "red", "sessionToken": "..." } }
{ "MATCH_FOUND": { "matchId": "match_123", "opponent": { ... }, "duration": 30000 } }
{ "MATCH_UPDATE": { "player1Taps": 41, "player2Taps": 38, "timeRemaining": 12000 } }
{ "DAILY_QUEST": { "quest": { "title": "Slay 10 Goblins", "target": 10 } } }
```

Optional: keep the XOR payload obfuscation from `router.js`
(`decodePayload`) if the Unity client already implements it — it is not
security, just obfuscation. Plaintext JSON works fine for a template.

## 5. Core Pieces (minimal implementations)

### `server.js` — entry point

```js
const WebSocket = require('ws');
const express = require('express');
require('dotenv').config();

const CONFIG = require('./config/constants');
const logger = require('./utils/logger');
const TeamManager = require('./modules/teams/team-manager');
const { getRouter } = require('./modules/websocket');

const teamManager = new TeamManager();
const services = { teamManager, config: CONFIG };

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  const router = getRouter();
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    players: teamManager.players.size,
    handlers: router.getStats().handlers.length,
    clients: router.getStats().clients
  });
});

const port = process.env.PORT || 8080;
const server = app.listen(port, () =>
  logger.info('SERVER', `HTTP+WS on port ${port}`));

const wss = new WebSocket.Server({ server });
const router = getRouter();
router.initialize(services);

wss.on('connection', (ws, req) => {
  const clientid = router.handleConnection(ws, req, wss);
  logger.info('SERVER', `Client ${clientid} connected`);
});

async function start() {
  await teamManager.initializeDatabase();   // SQLite + load JSON state
  teamManager.startAutoSave(5);             // snapshot every 5 min
  logger.info('SERVER', '=== Game Server Started ===');
}
start();
```

### `modules/handlers/base-handler.js` — unchanged from source

Copy `base-handler.js` verbatim, except replace `getWallet` /
`requireWallet` / `requireFaction` with player equivalents:

```js
getPlayerId(context) {
  return context.clientList.get(context.clientid)?.playerId;
}

requirePlayer(context, msg = 'Not logged in') {
  const playerId = this.getPlayerId(context);
  if (!playerId) throw new Error(msg);
  return playerId;
}
```

Key mechanics worth keeping:

- `register(type, fn)` → `canHandle(message)` matches on
  `message.hasOwnProperty(type)` — this is the whole routing trick.
- `sendAsBytes(ws, data)` — always `ws.send(Buffer.from(JSON.stringify(data)))`
  so Unity WebGL clients receive binary frames.
- `broadcast(wss, data, filter)` for announcements.

### `modules/handlers/index.js` — registry

```js
this.handlers = [
  new SessionHandler(),
  new ChatHandler(),
  new PvPHandler(),
  new QuestHandler(),
  new TeamHandler()
];
```

`route()` iterates handlers, calls `canHandle`, and returns `false` if
nothing matched — the router then calls the optional `legacyHandler`
fallback (useful during migration, or just log and drop).

### `modules/handlers/session-handler.js` — login without wallets

Replace the XUMM QR sign-in flow with a one-message login:

```js
this.register('LOGIN', this.handleLogin.bind(this));
this.register('RESTORE_SESSION', this.handleRestoreSession.bind(this));

async function handleLogin(context) {
  const { message, ws, clientid, clientList } = context;
  const playerId = message.playerId;               // validate: string, 3..24 chars
  const displayName = message.displayName || 'Adventurer';

  this.disconnectDuplicate(clientList, playerId, clientid);  // one session per player
  const client = clientList.get(clientid);
  client.playerId = playerId;
  client.playerName = displayName;
  client.sessionToken = uuidv4();

  const team = context.services.teamManager.ensureTeam(playerId); // auto-assign
  this.sendAsBytes(ws, {
    LOGIN_COMPLETE: { playerId, displayName, team, sessionToken: client.sessionToken }
  });
}
```

`RESTORE_SESSION` validates `sessionToken` instead of a wallet address.

### `modules/teams/team-manager.js` — factions → teams

Keep the `FactionManager` shape but strip chain logic:

- `players: Map<playerId, { teamId, loyaltyPoints, rank }>`
- `teams: Map<teamId, { name, color, members, season stats }>`
- `ensureTeam(playerId)` — round-robin or hash assignment
- `getCurrentSeason()` — quarterly seasons, keep as-is
- `getTeamLeaderboard()` — points from PvP wins, quests, logins
- `startAutoSave(minutes)` — persist Maps to JSON/SQLite on a timer

Remove: `determineFactionFromNFT`, `ensureChainFaction`, XRPL lookups,
treasury balances in XRP/GXG. A "treasury" becomes optional in-game
currency (a plain integer column).

### `modules/persistence/database-manager.js` — SQLite schema

Keep the pattern (`sqlite3.verbose()`, `CREATE TABLE IF NOT EXISTS`,
async wrapper methods). Simplified schema:

```sql
players(player_id TEXT PRIMARY KEY, team_id TEXT, display_name TEXT,
        loyalty_points INTEGER DEFAULT 0, pvp_wins INTEGER DEFAULT 0,
        pvp_losses INTEGER DEFAULT 0, total_kills INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)

teams(team_id TEXT PRIMARY KEY, name TEXT, color TEXT, season_points INTEGER DEFAULT 0)

quests(player_id TEXT, quest_id TEXT, progress INTEGER, completed INTEGER,
       assigned_at TEXT, PRIMARY KEY(player_id, quest_id))

matches(match_id TEXT PRIMARY KEY, player1 TEXT, player2 TEXT,
        winner TEXT, p1_taps INTEGER, p2_taps INTEGER, played_at TEXT)
```

Keep `data-manager.js` (JSON snapshots in `data/`) for fast auto-save
of in-memory Maps; SQLite is the durable store you sync into.

### `modules/websocket/client-manager.js` — unchanged

Keep as-is: `clients` Map, per-client rate limiting
(30 msg/min default), `checkDeadConnections()` ping/pong sweep,
duplicate-session kick. Just rename `walletAddress` → `playerId` and
`setWallet` → `setPlayer`.

### `modules/websocket/router.js` — mostly unchanged

Keep: size limit (10 KB), rate-limit call, plaintext-JSON-first parse,
middleware array, `handlerRegistry.route` → `legacyHandler` fallback,
`handleConnection` wiring `message`/`close`/`error`/`pong` events.

Optional: drop `decodePayload` (XOR) entirely and just `JSON.parse`.

## 6. Game Features Worth Keeping

These are pure game logic — no crypto anywhere:

- **PvP tap duels** (`pvp-handler.js`): queue → pair 2 players → 30 s
  match → most `TAP` messages wins → broadcast results; disconnect =
  forfeit.
- **Daily quests** (`quest-handler.js` + `treasury-manager.js`
  `generateDailyQuest`): template-driven quest text, kill tracking via
  `REPORT_ENEMY_KILL`, completion bonus → loyalty points.
- **Seasons & leaderboard** (`golden-throne.js`): quarterly season,
  scoring table (`pvpWins: +10`, `dailyActivity: +1`, `tournamentWin:
  +200` — all in `config/constants.js`), faction wars phase, throne
  period.
- **Chat**: `legacyHandler` broadcasts `{ message }` to all clients —
  promote it to a `ChatHandler` in the template.
- **AI agent port** (`mothra-handler.js`): optional — an external bot
  connects over the same WS protocol, registers via `AGENT_INTRODUCTION`,
  and receives `AI_*` admin endpoints (create quest, trigger world
  event, broadcast). Keep if you want a server-side game master bot.
- **DAO voting → team votes** (`dao-handler.js`): proposals/votes work
  fine without a blockchain — proposals are rows in SQLite, votes are
  rows, execution is a function call. Rename "treasury allocation" to
  "team bank allocation."

## 7. Build Order

1. `npm init` + install deps (section 2)
2. `utils/logger.js` + `config/constants.js` (copy, strip chain config)
3. `client-manager.js` → `router.js` → `base-handler.js` →
   `handlers/index.js` (the spine — get a WS echo working)
4. `server.js` with `/health` only; connect a test client
   (`wscat -c ws://localhost:8080`, send `{"LOGIN":true,"playerId":"x"}`)
5. `session-handler.js` (login + restore)
6. `team-manager.js` + `database-manager.js` (teams + persistence)
7. `pvp-handler.js`, then `quest-handler.js`, then chat
8. Cron: `node-cron` daily maintenance; heartbeat sweep every 30 s
9. Deploy: `railway.json` pattern still applies — `npm start`,
   healthcheck `/health`

## 8. Environment

```bash
# .env
PORT=8080
LOG_LEVEL=INFO          # ERROR | WARN | INFO | DEBUG
LOG_TO_FILE=false
PAYLOAD_SECRET=change-me   # only if keeping XOR obfuscation
```

## 9. Porting Notes

- `server.js` lines 213–323 (legacy XUMM signin) → delete entirely;
  `LOGIN` in SessionHandler replaces it.
- Anything touching `services.xummSdk`, `solanaHandlers`, `xrpl.Client`,
  `treasuryManager.executeProposal` → remove or replace with a
  `services.bank` stub if you keep a virtual currency.
- `global.playerKillStats` / `global.playerBalances` in
  `quest-handler.js` / `session-handler.js` are process-memory only —
  move them into `team-manager` or SQLite in the template.
- The `webtap/` Unity client sends messages as binary frames; keep
  `sendAsBytes` so you don't have to change the client.
- Banned-wallet list → banned-player ID list.
