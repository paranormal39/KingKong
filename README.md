# KingKong

**Project type:** a Phase 1 multiplayer arena-shooter vertical slice: a Node.js
WebSocket/HTTP game server paired with a Unity 6 client. This is a playable game
project, not a generic server template.

- **`server.js`** — Node.js WebSocket game server: player sessions, menu +
  matchmaking, instanced arena matches with bot fill, 8 witch heroes with full
  ability kits, server-authoritative world positions + combat + abilities, and
  SQLite + JSON snapshot persistence for the season/leaderboard meta.
- **`unityclient/unityclient/`** — Unity 6 client: auto-generated menu → mode
  select → matchmaking → hero selector → in-arena HUD, a full first-person
  control kit, generated world, and hero-tinted remote avatars synced from the
  arena's server world-state broadcasts.

Prototype identity uses a `playerId` (server-generated if omitted) and a session
token — no wallets or signing. Client-supplied IDs are not proof of account
ownership; this login flow is not suitable for production authentication yet.
The persistent `red/blue/green` teams exist only for the season leaderboard;
inside a match you play your chosen hero.

See [HANDOVER.md](HANDOVER.md) for the architecture/security review, prioritized
findings, and the two-phase remediation plan.

## Game flow

```
Login -> Main Menu (mode select) -> Matchmaking (bot-filled) ->
Hero Select (lock a witch) -> Arena match -> Results -> back to Menu
```

## Modes (`config/modes.js`)

| Mode | Status | Shape | Win condition |
|---|---|---|---|
| Free-for-All | **enabled** | up to 8 players | first to 20 kills, or most kills at 5:00 |
| 2v2 / 3v3 / 5v5 | defined, gated (Phase 2) | team deathmatch | kill limit or time |

A single human can start a match: the matchmaker waits briefly for more humans,
then fills remaining slots with simple bots so any mode is playable solo.

## The 8 witches (`config/heroes.js`)

| Witch | Passive | Effect |
|---|---|---|
| Ice | Frostbite | consecutive hits build frost, then slow |
| Lightning | Static Charge | moving builds charge that boosts the next hit |
| Fire | Inferno | kills briefly increase fire rate |
| Blood | Bloodlust | kills restore health |
| Voodoo | Toxic Touch | hits apply poison stacks (DoT) |
| Halo | Divine Grace | regenerate HP while out of combat |
| Brujeria | Umbral Veil | partial stealth while still + not firing |
| Earth | Stoneguard | reduced damage while crouched / stationary |

Each hero has two weapons (slots 1/2), a tactical/special/movement ability and
an ultimate. All stats (damage, range, fire rate, mag, cooldowns, effects) are
pure data, so balancing is config-only.

## Controls (Unity client)

| Control | Action | Control | Action |
|---|---|---|---|
| LMB | Primary fire | Shift | Movement ability (dash) |
| RMB | Secondary fire / ADS | Q | Ultimate |
| R | Reload | V | Melee |
| F | Tactical ability | Space | Jump |
| E | Special ability | Ctrl | Crouch / slide |
| 1 / 2 | Weapon switch | Tab | Scoreboard (hold) |
| Enter | Focus chat · C toggle | Esc | Release cursor / leave queue |

## Server setup

Requires Node.js >= 20.

```powershell
cd kingkong
npm install
copy .env.example .env    # then edit if needed
npm start                 # listens on PORT (default 8080)
```

`.env` options: `PORT`, `LOG_LEVEL`, `LOG_TO_FILE`, `PAYLOAD_SECRET` (XOR fallback key).

Endpoints: `GET /health` (status + DB + live arena stats), `GET /api/errors`,
`GET /api/db/stats`, `POST /api/db/backup`.

Verify it works:

```powershell
npm test               # focused unit tests
npm run lint           # server lint
node test-client.js     # manual smoke test; start the server in another terminal first
```

## Protocol (flat JSON; key = message type)

Outbound from client:

| Message | Payload |
|---|---|
| `LOGIN` / `RESTORE_SESSION` | auth (returns to the menu; no world join) |
| `GET_CATALOG` | request modes + hero list for the menu |
| `JOIN_MATCHMAKING` | `{mode}` — e.g. `{mode:"ffa"}` |
| `LEAVE_MATCHMAKING` | cancel the queue / lobby |
| `SELECT_HERO` / `LOCK_HERO` | `{heroId}` during hero select |
| `MOVE` | `{x,y,z,yaw,crouch}` — ~10 Hz position reports |
| `PRIMARY_FIRE` / `SECONDARY_FIRE` | `{targetId}` — client raycast hit |
| `RELOAD` / `MELEE` / `WEAPON_SWITCH` | combat (`MELEE {targetId}`, `WEAPON_SWITCH {slot}`) |
| `ABILITY` | `{slot}` — `tactical` / `special` / `movement` / `ultimate` |
| `message` | global chat |

Inbound to client: `LOGIN_COMPLETE`, `SESSION_RESTORED`, `CATALOG`,
`QUEUE_STATUS`, `HERO_SELECT_STATE`, `MATCH_START` (+`spawn`,`hero`,`roster`),
`WORLD_STATE` (10 Hz arena snapshot — each entry carries
`x,y,z,yaw,crouch,hp,maxHp,shield,alive,ammo,score,deaths,ultCharge,hero,fx`),
`AMMO_STATE`, `RELOADING`, `COOLDOWN_STATE`, `ABILITY_USED`, `PLAYER_KILLED`,
`MATCH_END` (+scoreboard), `CHAT_MESSAGE`, `DUPLICATE_CONNECTION`, `*_ERROR`.

Menu/meta messages: `REQUEST_DAILY_QUEST` → `DAILY_QUEST`,
`GET_KILL_STATS` → `KILL_STATS`, `VERIFY_QUEST_COMPLETION` →
`QUEST_VERIFICATION_RESULT`, `TEAM_STATUS`, `GET_LEADERBOARD` →
`LEADERBOARD`. Arena kills push `QUEST_UPDATE` / `QUEST_COMPLETED` to the
killer automatically — quest progress is tracked server-side, not
client-reported.

### Authority

Movement, damage, ammo, fire rate, ability cooldowns, status effects (slow,
poison, stun, shield, haste, stealth) and ultimate charge are all validated and
owned server-side per arena. The client plays visuals (tracers, VFX, dash feel)
and reports inputs. Server replies are binary frames (UTF-8 JSON) for Unity
WebGL compatibility; plaintext or XOR-obfuscated payloads are accepted inbound.

Match results feed the persistent meta: `MATCH_END` applies win/loss
(`pvpWins`/`pvpLosses`) + season points to each human's team, persists the
scoreboard to the `matches` table, and arena kills advance the killer's
active quest and loyalty.

### Deploy

`railway.json` is included — point Railway/Render/etc. at the repo root, set
`PORT`, and it health-checks `/health`. Season/leaderboard persistence lives
under `data/` (`game.db` + JSON snapshots, autosaved every 5 min, daily backups
via cron). The repository does not configure a persistent deployment volume:
mount durable storage at `data/` or use a managed database before production
deployment, or player data may be lost when the service is replaced.

## Unity client setup

Requires Unity **6000.0.33f1** (URP). Everything is generated in code — no scene
wiring:

1. Open `unityclient/unityclient` in Unity Hub.
2. Wait for packages to resolve — `manifest.json` pulls in **NativeWebSocket**
   (git) and **Newtonsoft.Json**. If the git package fails: Package Manager →
   + → Add package from git URL → `https://github.com/endel/NativeWebSocket.git#upm`
3. Press **Play**.

A bootstrap (`GameClientBootstrap`) spawns the backdrop world, network layer,
HUD and menu automatically. Type a display name → **ENTER** → pick a mode → lock
a witch → you spawn into the arena. The player object is created on
`MATCH_START` and removed on `MATCH_END`.

Point the client at a remote server by changing `serverUrl` in `GameNetwork`
(default `ws://localhost:8080`; use `wss://` in production).

## Architecture notes

- `modules/arena/` — `arena-manager` (owns live arenas + matchmaker, ticks
  them), `arena` (one match: world + abilities + bots + scoring + lifecycle),
  `matchmaker` (per-mode queues, bot fill), `ability-system` (weapons, abilities,
  status effects, passives), `bot` (simple fill AI).
- `modules/world/world-state-manager.js` — per-arena authoritative player table.
- `config/heroes.js`, `config/modes.js` — data-only hero + mode definitions.
- Unity scripts: `GameNetwork` (protocol), `MenuUI` (+bootstrap), `GameUI` (HUD),
  `FirstPersonController` (control kit), `RemotePlayerManager` (avatars),
  `HeroCatalog` (client mirror), `UiKit` (programmatic UI), `WorldGenerator`.

This is a Phase 1 vertical slice (FFA). Team modes (2v2/3v3/5v5) and polish are
staged next; see the ability/mode configs for the gated definitions.
