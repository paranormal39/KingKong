// End-to-end smoke test for the arena/hero flow - not part of the template.
// Usage: start the server, then `node test-client.js` (honours PORT).
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const URL = `ws://localhost:${PORT}`;
const results = [];
function check(name, cond) {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}`);
}

function connect(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, msgs: [] };
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString('utf8'));
      c.msgs.push(msg);
      console.log(`  [${name}] <- ${Object.keys(msg)[0]}`);
    } catch (e) {
      console.log(`  [${name}] <- (unparsable)`);
    }
  });
  return new Promise(res => ws.on('open', () => res(c)));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const send = (c, obj) => c.ws.send(JSON.stringify(obj));
const lastOf = (c, key) => [...c.msgs].reverse().find(m => m[key] !== undefined);
async function waitFor(c, key, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const m = lastOf(c, key);
    if (m) return m;
    await sleep(100);
  }
  return null;
}

async function main() {
  const run = Math.random().toString(36).substr(2, 6);
  const PA = `ash_${run}`, PB = `bob_${run}`;

  // 1. HTTP health check
  const health = await new Promise((res, rej) => {
    http.get(`http://localhost:${PORT}/health`, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b)));
    }).on('error', rej);
  });
  check('GET /health returns healthy', health.status === 'healthy');
  check('health reports arena stats', !!health.arenas);

  // 2. Two clients log in (no auto world-entry; no spawn in payload)
  const a = await connect(PA);
  const b = await connect(PB);
  send(a, { LOGIN: true, playerId: PA, displayName: 'Ash' });
  send(b, { LOGIN: true, playerId: PB, displayName: 'Bob' });
  await sleep(600);
  const loginA = lastOf(a, 'LOGIN_COMPLETE');
  check('ash got LOGIN_COMPLETE', !!loginA);
  check('ash got sessionToken', !!loginA?.LOGIN_COMPLETE?.sessionToken);
  check('login no longer returns a spawn', loginA?.LOGIN_COMPLETE?.spawn === undefined);
  check('first-time login grants a daily quest', !!lastOf(a, 'DAILY_QUEST'));
  const token = loginA?.LOGIN_COMPLETE?.sessionToken;

  // 3. Bad login rejected
  const bad = await connect('bad');
  send(bad, { LOGIN: true, playerId: 'x' });
  await sleep(400);
  check('short playerId rejected', !!lastOf(bad, 'LOGIN_ERROR'));
  bad.ws.close();

  // 4. Chat broadcast
  send(a, { message: 'hello everyone' });
  await sleep(400);
  check('chat broadcast reached bob', !!lastOf(b, 'CHAT_MESSAGE'));

  // 5. Catalog (modes + heroes for the menu / hero selector)
  send(a, { GET_CATALOG: true });
  await sleep(400);
  const cat = lastOf(a, 'CATALOG');
  check('GET_CATALOG returns modes', Array.isArray(cat?.CATALOG?.modes) && cat.CATALOG.modes.length >= 4);
  check('GET_CATALOG returns 8 heroes', cat?.CATALOG?.heroes?.length === 8);
  check('FFA mode is enabled', !!cat?.CATALOG?.modes?.find(m => m.id === 'ffa' && m.enabled));

  // 6. Unavailable mode rejected
  send(a, { JOIN_MATCHMAKING: { mode: 'squad' } });
  await sleep(300);
  check('disabled mode (5v5) rejected', !!lastOf(a, 'MATCHMAKING_ERROR'));

  // 7. FFA matchmaking -> hero select -> bot-filled match start
  send(a, { JOIN_MATCHMAKING: { mode: 'ffa' } });
  const qs = await waitFor(a, 'QUEUE_STATUS', 2000);
  check('QUEUE_STATUS received', !!qs);

  const hs = await waitFor(a, 'HERO_SELECT_STATE', 11000);
  check('HERO_SELECT_STATE received after queue wait', !!hs);

  // Ice witch: 70u-range primary + auto-reload makes the bot-kill section
  // below deterministic (bots close to aggro range well inside it).
  send(a, { SELECT_HERO: { heroId: 'ice' } });
  await sleep(200);
  send(a, { LOCK_HERO: { heroId: 'ice' } });

  const ms = await waitFor(a, 'MATCH_START', 5000);
  check('MATCH_START received', !!ms);
  check('MATCH_START has a spawn', !!ms?.MATCH_START?.spawn);
  check('locked hero is ice', ms?.MATCH_START?.hero === 'ice');
  const roster = ms?.MATCH_START?.roster || [];
  const bots = roster.filter(r => r.isBot);
  check('bots filled the FFA lobby', bots.length >= 1);

  // 8. World state broadcasts from the arena
  const ws1 = await waitFor(a, 'WORLD_STATE', 2000);
  check('arena WORLD_STATE received', !!ws1);
  const players = ws1?.WORLD_STATE?.players || [];
  check('world state includes self + bots', players.length >= 2);
  check('snapshot entries carry hero + ammo', players[0]?.hero !== undefined && players[0]?.ammo !== undefined);

  // 9. Combat plumbing - issued as a tight burst at match start, while the
  //    player is at full HP and the bots haven't closed in yet (a lone human
  //    among bots dies fast, so timing matters here).
  const victim = players.find(p => p.isBot);
  send(a, { PRIMARY_FIRE: { targetId: victim ? victim.playerId : null } });
  send(a, { PRIMARY_FIRE: { targetId: victim ? victim.playerId : null } });
  send(a, { RELOAD: true });
  send(a, { ABILITY: { slot: 'tactical' } });
  await sleep(500);
  const ammo = await waitFor(a, 'AMMO_STATE', 1500);
  check('PRIMARY_FIRE returns AMMO_STATE', !!ammo);
  check('ammo decreased from firing', ammo?.AMMO_STATE?.ammo < 18);
  check('RELOAD acknowledged', !!lastOf(a, 'RELOADING'));
  check('ABILITY tactical confirmed (COOLDOWN_STATE)', !!lastOf(a, 'COOLDOWN_STATE'));
  check('ability broadcast as ABILITY_USED', !!lastOf(a, 'ABILITY_USED'));

  // 9b. A real hit lands damage: move next to a bot and fire a burst, then
  //     confirm some enemy took damage (hp < max) or a kill was announced.
  if (victim) {
    send(a, { MOVE: { x: victim.x + 3, y: victim.y, z: victim.z, yaw: 0 } });
    await sleep(200);
    for (let i = 0; i < 8; i++) { send(a, { PRIMARY_FIRE: { targetId: victim.playerId } }); await sleep(120); }
    await sleep(400);
    const latest = lastOf(a, 'WORLD_STATE')?.WORLD_STATE?.players || [];
    const damaged = latest.some(p => p.isBot && p.hp < p.maxHp);
    check('firing at a bot deals damage', damaged || !!lastOf(a, 'PLAYER_KILLED'));
  } else {
    check('firing at a bot deals damage', false);
  }

  // 9c. A real kill advances the active quest server-side: keep firing at
  //     the nearest living bot until QUEST_UPDATE arrives (quest progress
  //     comes from recorded kills now, not client-reported messages).
  const aliveBots = () =>
    (lastOf(a, 'WORLD_STATE')?.WORLD_STATE?.players || []).filter(p => p.isBot && p.alive !== false);
  let sawQuestUpdate = false;
  for (let i = 0; i < 40 && !sawQuestUpdate; i++) {
    const targets = aliveBots();
    if (!targets.length) break;
    send(a, { PRIMARY_FIRE: { targetId: targets[0].playerId } });
    await sleep(300);
    sawQuestUpdate = !!lastOf(a, 'QUEST_UPDATE');
  }
  check('kill sends QUEST_UPDATE for active quest', sawQuestUpdate);

  send(a, { GET_KILL_STATS: true });
  await sleep(400);
  const ks = lastOf(a, 'KILL_STATS');
  check('GET_KILL_STATS shows the arena kill', (ks?.KILL_STATS?.totalLifetimeKills || 0) >= 1);
  check('quest kill progress persisted server-side',
    Object.keys(ks?.KILL_STATS?.questKillProgress || {}).length >= 1);

  // 10. Session restore (returns to menu, no spawn)
  const a2 = await connect('ash2');
  send(a2, { RESTORE_SESSION: true, playerId: PA, sessionToken: token });
  await sleep(600);
  check('SESSION_RESTORED works', !!lastOf(a2, 'SESSION_RESTORED'));

  // 11. Unauthenticated matchmaking rejected
  const anon = await connect('anon');
  send(anon, { JOIN_MATCHMAKING: { mode: 'ffa' } });
  await sleep(400);
  check('unauth JOIN_MATCHMAKING -> error', !!lastOf(anon, 'JOIN_MATCHMAKING_ERROR'));

  a.ws.close(); b.ws.close(); a2.ws.close(); anon.ws.close();
  await sleep(300);

  const failed = results.filter(r => !r[1]);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed =====`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
