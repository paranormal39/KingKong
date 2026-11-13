# Engineering Handover

## Project at a glance

KingKong is a Phase 1 multiplayer arena-shooter vertical slice, not a generic
backend template. The Node.js server provides WebSocket gameplay, matchmaking,
bot-filled FFA arenas, HTTP health/operations routes, and SQLite-backed player
and season data. A Unity 6 client provides the menu, first-person controls, HUD,
and remote-player rendering. FFA is enabled; team modes are defined but gated.

Key entry points:

- `server.js`: HTTP/WebSocket startup, health/operations endpoints, timers.
- `modules/handlers/`: session, matchmaking, combat, presence, quest, and team
  message handling.
- `modules/arena/` and `modules/world/`: match lifecycle, combat, bots, and
  player world state.
- `modules/teams/` and `modules/persistence/`: game meta and SQLite/JSON
  persistence.
- `unityclient/unityclient/Assets/Scripts/`: Unity networking, menu, HUD, and
  gameplay client.

## Two-phase remediation plan

### Phase 1 — Security and gameplay blockers

1. Replace `playerId`-only login with actual proof of account ownership; make
   guest creation distinct from authentication. Enforce bans on login and
   session restore, and define token expiry, rotation, and revocation.
2. Protect administrative HTTP endpoints. Bound WebSocket frame size,
   connections, account creation, matchmaking, and arena creation globally;
   add backpressure and safe logging limits.
3. Restore server authority for movement and combat: validate initial spawn and
   movement, check shot direction/obstruction, and route all kills through one
   accounting path. Fix reload completion and reject unsafe hero identifiers.
4. Make deployment persistence durable and startup readiness truthful. Use a
   persistent volume or managed database, safe SQLite backups, and update
   vulnerable dependencies after checking runtime/build compatibility.

### Phase 2 — Reliability, coverage, and maintainability

1. Add automated unit/integration tests and CI for authentication, WebSocket
   limits, gameplay validation, progression, persistence, and deployment
   readiness.
2. Fix quest assignment/restore and season rollover; centralize disconnect
   cleanup for ordinary closes, heartbeat failures, and replaced connections.
3. Escape untrusted text in Unity rich-text UI, bound and validate display names,
   and profile leaderboard/snapshot work as player counts grow.
4. Document operational configuration, persistent storage, backup/restore, and
   supported deployment assumptions.

## Findings behind the plan

Priorities reflect impact if the service is reachable from untrusted clients.

| Priority | Finding | Main locations |
|---|---|---|
| Critical | `LOGIN` accepts an existing `playerId` without ownership proof, rotates its token, and disconnects the current session. Public leaderboard requests expose IDs; restore does not recheck bans. | `modules/handlers/session-handler.js`, `modules/handlers/team-handler.js` |
| High | Public backup endpoint synchronously copies the live DB and accumulates backups; no admin authentication or retention is configured. | `server.js`, `modules/persistence/database-manager.js` |
| High | WebSocket frame cap is checked only after receipt; there are no global connection/account/arena limits. | `server.js`, `modules/websocket/router.js`, `modules/websocket/client-manager.js` |
| High | Initial movement bypasses speed validation; fire accepts any in-range target ID without direction/line-of-sight validation. | `modules/world/world-state-manager.js`, `modules/arena/ability-system.js` |
| High | Inherited hero keys can pass lookup and cause an arena to throw during match start, leaving it active without an end time. | `config/heroes.js`, `modules/arena/arena.js` |
| High | Reload timers never restore ammunition; ability/DoT deaths do not consistently reach persistent kill, quest, and match accounting. | `modules/arena/ability-system.js`, `modules/arena/arena.js` |
| High | Railway configuration does not declare durable storage, while game data is written under relative `data/`; deploy replacement can lose data unless a volume is configured separately. | `railway.json`, `modules/teams/team-manager.js`, `modules/persistence/database-manager.js` |
| High | Locked dependency tree has 14 audit advisories (2 critical, 6 high, 4 moderate, 2 low). Some are in transitive build dependencies or code paths not currently enabled; assess reachability while updating. | `package.json`, `package-lock.json` |
| Medium | Server listens before persistence is ready, database initialization failure is swallowed, and `/health` still returns top-level HTTP 200/healthy. | `server.js`, `modules/teams/team-manager.js` |
| Medium | Duplicate/heartbeat disconnect paths can remove client state before gameplay cleanup runs. | `modules/handlers/session-handler.js`, `modules/websocket/client-manager.js`, `modules/websocket/router.js` |
| Medium | Daily quests can be reissued without a daily limit; quest progress persists without restoring the active quest definition. Season scores have no persisted season key. | `modules/handlers/quest-handler.js`, `modules/handlers/session-handler.js`, `modules/teams/team-manager.js` |
| Medium | User-controlled chat and player names are inserted into Unity TextMeshPro rich text without escaping. | `unityclient/unityclient/Assets/Scripts/GameUI.cs`, `RemotePlayerManager.cs`, `UiKit.cs` |

## Review and implementation status

- Review validation: ESLint completed with no errors and four unused-variable
  warnings. `npm audit` reported the counts above. Ten isolated behavioral
  probes reproduced issues; they did not start the server or use the persistent
  database.
- There is no CI test suite. `npm test` runs a focused Node.js regression test;
  `test-client.js` remains a manual smoke test that requires a running server
  and does not cover the reproduced security/gameplay edge cases.
- First implementation task completed: hero lookup now rejects
  inherited/nonexistent IDs, with a focused regression test. This small fix does
  not replace the Phase 1 authentication redesign.
- Do not treat this handover as evidence that production persistence, external
  Railway volumes, or deployment secrets have been verified.
