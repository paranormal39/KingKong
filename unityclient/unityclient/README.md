# KingKong Unity Client

Unity 6 client for the KingKong arena shooter server (`../../server.js`).
No crypto — log in with a display name, pick a mode, lock a witch, fight.

## Setup — none required

The world, player, and UI all build themselves in code. Just:

1. Open this folder in Unity Hub (Unity 6000.0.33f1).
2. Wait for package resolution (see below).
3. Press **Play** — a generated world appears with the menu UI on top.

A `RuntimeInitializeOnLoadMethod` bootstrap (`GameClientBootstrap` in
`MenuUI.cs`) spawns `WorldGenerator`, `GameNetwork`, `MenuUI` and `GameUI`
on Play — nothing needs to be placed in a scene.

## Flow

```
Login (display name) -> Main Menu (mode select) -> Matchmaking ->
Hero Select (lock a witch) -> Arena match -> Results -> back to Menu
```

The controllable player object (`FirstPersonController`) spawns on
`MATCH_START` and is removed on `MATCH_END`.

## Controls

| Input | Action | Input | Action |
|---|---|---|---|
| LMB | Primary fire | Shift | Movement ability (dash/blink/haste) |
| RMB | Secondary fire / ADS | Q | Ultimate |
| R | Reload | V | Melee |
| F | Tactical ability | Space | Jump |
| E | Special ability | Ctrl | Crouch / slide |
| 1 / 2 | Weapon switch | Tab | Scoreboard (hold) |
| Enter | Focus chat / send | Esc | Release cursor / leave queue |
| C | Hide / show chat panel | | |

## Packages

Already in `Packages/manifest.json`; Unity resolves them on open:

| Package | Why |
|---|---|
| `com.endel.nativewebsocket` (git `#upm`) | WebSocket transport; the only one that works in WebGL builds |
| `com.unity.nuget.newtonsoft-json` (3.2.1) | `JObject` parsing of incoming messages |
| `com.unity.inputsystem` (installed) | `InputSystemUIInputModule` for the generated EventSystem |

TextMeshPro ships inside `com.unity.ugui` 2.0 (already installed).
If TMP's default font asset is missing (no "TMP Essentials" imported),
`UiKit` auto-builds a dynamic font asset from the built-in runtime font —
no import step needed.

If the git package fails to resolve, install manually:
**Window → Package Manager → + → Add package from git URL** →
`https://github.com/endel/NativeWebSocket.git#upm`

## Running

```powershell
cd ..\..           # kingkong server root
npm start          # starts on ws://localhost:8080
```

Then press Play in Unity → enter a display name → ENTER → pick a mode →
lock a witch → you spawn into the arena. `serverUrl` is a public field on
`GameNetwork` (default `ws://localhost:8080`; use `wss://` in production).

## Message flow

| Direction | Payload |
|---|---|
| out | `{ "LOGIN": true, "displayName": "Ash" }` (playerId optional - server generates one) |
| in | `{ "LOGIN_COMPLETE": { playerId, team, sessionToken, stats, season } }` |
| out | `{ "GET_CATALOG": true }` |
| in | `{ "CATALOG": { modes, heroes } }` |
| out | `{ "JOIN_MATCHMAKING": { "mode": "ffa" } }` |
| in | `{ "QUEUE_STATUS": {...} }` -> `{ "HERO_SELECT_STATE": {...} }` |
| out | `{ "SELECT_HERO": { "heroId": "fire" } }` / `{ "LOCK_HERO": { "heroId": "fire" } }` |
| in | `{ "MATCH_START": { spawn, hero, roster, durationMs } }` |
| out | `{ "MOVE": {x,y,z,yaw,crouch} }`, `{ "PRIMARY_FIRE": {targetId} }`, `{ "ABILITY": {slot} }`, ... |
| in | `{ "WORLD_STATE": { players, serverTime, timeLeftMs } }` (10 Hz), `AMMO_STATE`, `COOLDOWN_STATE`, `PLAYER_KILLED` |
| in | `{ "MATCH_END": { winner, scoreboard } }` |
| out | `{ "message": "hello everyone" }` (chat) |
| out | `{ "RESTORE_SESSION": true, "playerId": "ash", "sessionToken": "..." }` |

Session token persists in PlayerPrefs (`kk_sessionToken`) — reopening the
app restores the session automatically (returns to the menu, not a world).

## Extending

`GameNetwork.OnRawMessage` fires for every unhandled server message —
subscribe to it (or add a `ContainsKey` branch in `HandleMessage`) for
`DAILY_QUEST`, `QUEST_UPDATE`, `QUEST_COMPLETED`, `TEAM_STATUS`,
`LEADERBOARD`, etc.
