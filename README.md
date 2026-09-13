# KingKong

A plain multiplayer game stack — **no blockchain, no crypto**:

- **`server.js`** — Node.js WebSocket game server: player sessions, generic teams,
  global chat, PvP tap-duels, daily quests, leaderboards, server-authoritative
  world positions + combat (shooting, HP, respawns), and SQLite + JSON snapshot
  persistence.
- **`unityclient/unityclient/`** — Unity 6 client: auto-generated UI
  (login + chat + HUD), first-person controller with shooting, generated world,
  and remote-player avatars with health bars synced from server world-state
  broadcasts.

Identity is a simple `playerId` (server-generated if omitted) + session token —
no wallets, no signing.

## Repo layout

```
server.js                    Entry point: Express /health + WebSocket + cron + heartbeat
config/constants.js          Teams, scoring, rate limits, world bounds
utils/                       Logger, standardized errors
modules/websocket/           Router (plain JSON + XOR fallback), client manager
modules/handlers/            session, chat, pvp, quest, team, presence (MOVE), combat (SHOOT)
modules/teams/               Team manager (assign, loyalty, ranks, seasons)
modules/world/               WorldStateManager - authoritative positions, HP, respawns
modules/persistence/         JSON snapshots + SQLite (data/game.db)
unityclient/unityclient/     Unity 6 project (self-bootstrapping)
test-client.js               Node e2e smoke test (27 checks)
```

## Server setup

Requires Node.js >= 20.

```powershell
cd kingkong
npm install
copy .env.example .env    # then edit if needed
npm start                 # listens on PORT (default 8080)
```

`.env` options: `PORT`, `LOG_LEVEL`, `LOG_TO_FILE`, `PAYLOAD_SECRET` (XOR fallback key).

Endpoints: `GET /health` (status + DB stats), `GET /api/errors`,
`GET /api/db/stats`, `POST /api/db/backup`.

Verify it works:

```powershell
node test-client.js    # 27 e2e checks: login, chat, quest, PvP match, restore
npx eslint .           # lint
```

### Protocol (flat JSON; key = message type)

Outbound from client:

| Message | Payload |
|---|---|
| `LOGIN` | `{LOGIN:true, displayName:"Ash"}` (optional `playerId`) |
| `RESTORE_SESSION` | `{RESTORE_SESSION:true, playerId, sessionToken}` |
| `message` | `{message:"hello"}` — global chat |
| `MOVE` | `{MOVE:{x,y,z,yaw}}` — ~10 Hz position reports |
| `SHOOT` | `{SHOOT:{targetId}}` — client raycast hit; server validates range/rate |
| `JOIN_QUEUE` / `LEAVE_QUEUE` / `TAP` | tap-duel matchmaking (30 s matches) |
| `REQUEST_DAILY_QUEST` / `REPORT_ENEMY_KILL` / `GET_KILL_STATS` / `VERIFY_QUEST_COMPLETION` | quests |
| `TEAM_STATUS` / `GET_LEADERBOARD` | team info + rankings |

Inbound to client: `LOGIN_COMPLETE` (+`spawn`), `SESSION_RESTORED`,
`CHAT_MESSAGE`, `WORLD_STATE` (10 Hz snapshot of all players — authoritative;
each entry carries `x,y,z,yaw,hp,alive`), `PLAYER_KILLED` (kill feed),
`QUEUE_WAITING`, `MATCH_FOUND`, `MATCH_UPDATE`, `MATCH_RESULTS`,
`MATCH_FORFEIT`, `DAILY_QUEST`, `QUEST_COMPLETED`, `KILL_STATS`,
`TEAM_STATUS`, `LEADERBOARD`, `DUPLICATE_CONNECTION`, `*_ERROR` variants.

### Combat rules (server-enforced)

100 HP, 20 damage per hit, 60-unit range, 300 ms fire rate — all validated
server-side. Eliminated players can't move or shoot and respawn at a new
random point after 5 s. Kills add to `totalKills` and award loyalty points.

Server replies are sent as **binary frames** (UTF-8 JSON) for Unity WebGL
compatibility; plaintext or XOR-obfuscated payloads are accepted inbound.

### Deploy

`railway.json` is included — point Railway/Render/etc. at the repo root,
set `PORT`, and it health-checks `/health`. Persistence lives under `data/`
(`game.db` + JSON snapshots, autosaved every 5 min, daily backups via cron).

## Unity client setup

Requires Unity **6000.0.33f1** (URP). Everything is generated in code —
no scene wiring:

1. Open `unityclient/unityclient` in Unity Hub.
2. Wait for packages to resolve — `manifest.json` pulls in
   **NativeWebSocket** (git) and **Newtonsoft.Json**. If the git package
   fails: Package Manager → + → Add package from git URL →
   `https://github.com/endel/NativeWebSocket.git#upm`
3. Press **Play**.

A bootstrap spawns the world, network layer, and UI automatically:

- Type a display name → **CONNECT** → server assigns `playerId`, team,
  and spawn point → your FPS controller appears.
- **WASD** move · **mouse** look · **LMB** shoot · **Space** jump · **Esc** release cursor
- **Enter** focus chat / send · **C** or the CHAT button hides the panel
- Other players appear as team-colored capsules with name tags + health
  bars, interpolated from `WORLD_STATE` snapshots. Dying shows an overlay
  and respawns you at a server-assigned point ~5 s later.

Session token persists in `PlayerPrefs`, so reopening the app restores
your session (same playerId, team, stats).

Point the client at a remote server by changing `serverUrl` in
`GameNetwork` (default `ws://localhost:8080`; use `wss://` in production).

## Testing multiplayer locally

1. `npm start` (server on :8080)
2. Build the Unity client once (File → Build) **or** open a second editor
   instance, then Play both — each sees the other's avatar move in real time.

## Notes

- Rate limit: 40 msgs/sec per client (movement needs headroom).
- Movement authority: server validates bounds + max speed and rebroadcasts;
  remote clients only render server-accepted positions.
- Combat authority: hit detection is client raycast + server range/fire-rate
  validation; damage, death, and respawn are server-owned.
- See `BASIC_TEMPLATE_NO_CRYPTO.md` for the original architecture spec.
