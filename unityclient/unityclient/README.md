# KingKong Unity Client

Minimal Unity client for the KingKong game server (`../../server.js`).
No crypto — just connect, log in with a player ID, and chat.

## Setup — none required

The world, player, and UI all build themselves in code. Just:

1. Open this folder in Unity Hub (Unity 6000.0.33f1).
2. Wait for package resolution (see below).
3. Press **Play** — a generated world appears with FPS controls and the
   connection UI on top.

A `RuntimeInitializeOnLoadMethod` bootstrap (`GameClientBootstrap` in
`GameUI.cs`) spawns `WorldGenerator` and `GameNetwork` + `GameUI` on Play —
nothing needs to be placed in a scene. The controllable player object
(`FirstPersonController`) spawns automatically on successful login.

## Controls

| Input | Action |
|---|---|
| WASD | Move |
| Mouse | Look (cursor captured on click) |
| Space | Jump |
| Esc | Release cursor (to click UI) |
| C or CHAT button | Hide / show chat panel |
| Enter | Focus chat box / send message |

## Packages

Already in `Packages/manifest.json`; Unity resolves them on open:

| Package | Why |
|---|---|
| `com.endel.nativewebsocket` (git `#upm`) | WebSocket transport; the only one that works in WebGL builds |
| `com.unity.nuget.newtonsoft-json` (3.2.1) | `JObject` parsing of incoming messages |
| `com.unity.inputsystem` (installed) | `InputSystemUIInputModule` for the generated EventSystem |

TextMeshPro ships inside `com.unity.ugui` 2.0 (already installed).
If TMP's default font asset is missing (no "TMP Essentials" imported),
`GameUI` auto-builds a dynamic font asset from the built-in runtime font —
no import step needed.

If the git package fails to resolve, install manually:
**Window → Package Manager → + → Add package from git URL** →
`https://github.com/endel/NativeWebSocket.git#upm`

## Running

```powershell
cd ..\..           # kingkong server root
npm start          # starts on ws://localhost:8080
```

Then press Play in Unity → enter a display name → CONNECT → the server
generates your `playerId`, assigns a team, and your player object spawns.
`serverUrl` is a public field on `GameNetwork` — change it in code or
expose it via the generated UI later.

## Message flow

| Direction | Payload |
|---|---|
| out | `{ "LOGIN": true, "displayName": "Ash" }` (playerId optional - server generates one if omitted) |
| in | `{ "LOGIN_COMPLETE": { playerId, team, sessionToken, stats, season } }` |
| out | `{ "message": "hello everyone" }` |
| in | `{ "CHAT_MESSAGE": { from, displayName, team, text, timestamp } }` |
| out | `{ "RESTORE_SESSION": true, "playerId": "ash", "sessionToken": "..." }` |

Session token persists in PlayerPrefs (`kk_sessionToken`) — reopening the
app restores the session automatically.

## Extending

`GameNetwork.OnRawMessage` fires for every unhandled server message —
subscribe to it (or add a `ContainsKey` branch in `HandleMessage`) for
`DAILY_QUEST`, `MATCH_FOUND`, `MATCH_UPDATE`, `MATCH_RESULTS`,
`TEAM_STATUS`, `LEADERBOARD`, etc.
