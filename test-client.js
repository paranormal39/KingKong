// Temporary end-to-end test client - not part of the template
const WebSocket = require('ws');
const http = require('http');

const URL = 'ws://localhost:8080';
const results = [];
function check(name, cond) {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}`);
}

function connect(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, msgs: [], token: null };
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString('utf8'));
      c.msgs.push(msg);
      const key = Object.keys(msg)[0];
      console.log(`  [${name}] <- ${key}`);
    } catch (e) {
      console.log(`  [${name}] <- (unparsable)`);
    }
  });
  return new Promise(res => ws.on('open', () => res(c)));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const lastOf = (c, key) => [...c.msgs].reverse().find(m => m[key] !== undefined);

async function main() {
  // Fresh player IDs each run so first-login behavior is exercised
  const run = Math.random().toString(36).substr(2, 6);
  const PA = `ash_${run}`, PB = `bob_${run}`;

  // 1. HTTP health check
  const health = await new Promise((res, rej) => {
    http.get('http://localhost:8080/health', r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b)));
    }).on('error', rej);
  });
  check('GET /health returns healthy', health.status === 'healthy');
  check('health reports 12 registered types', health.handlers === 12);

  // 2. Two clients log in
  const a = await connect(PA);
  const b = await connect(PB);
  a.ws.send(JSON.stringify({ LOGIN: true, playerId: PA, displayName: 'Ash' }));
  b.ws.send(JSON.stringify({ LOGIN: true, playerId: PB, displayName: 'Bob' }));
  await sleep(800);

  const loginA = lastOf(a, 'LOGIN_COMPLETE');
  const loginB = lastOf(b, 'LOGIN_COMPLETE');
  check('ash got LOGIN_COMPLETE', !!loginA);
  check('bob got LOGIN_COMPLETE', !!loginB);
  check('ash got sessionToken', !!loginA?.LOGIN_COMPLETE?.sessionToken);
  check('ash assigned a team', !!loginA?.LOGIN_COMPLETE?.team);
  check('bob assigned a team', !!loginB?.LOGIN_COMPLETE?.team);
  check('ash got first-time DAILY_QUEST', !!lastOf(a, 'DAILY_QUEST'));
  a.token = loginA.LOGIN_COMPLETE.sessionToken;

  // 3. Bad login rejected
  const bad = await connect('bad');
  bad.ws.send(JSON.stringify({ LOGIN: true, playerId: 'x' }));
  await sleep(400);
  check('short playerId rejected', !!lastOf(bad, 'LOGIN_ERROR'));
  bad.ws.close();

  // 4. Chat broadcast
  a.ws.send(JSON.stringify({ message: 'hello everyone' }));
  await sleep(400);
  check('chat broadcast reached bob', !!lastOf(b, 'CHAT_MESSAGE'));
  check('chat shows sender name', lastOf(b, 'CHAT_MESSAGE')?.CHAT_MESSAGE?.displayName === 'Ash');

  // 5. TEAM_STATUS + GET_LEADERBOARD
  a.ws.send(JSON.stringify({ TEAM_STATUS: true }));
  a.ws.send(JSON.stringify({ GET_LEADERBOARD: true }));
  await sleep(500);
  check('TEAM_STATUS returned', !!lastOf(a, 'TEAM_STATUS'));
  check('LEADERBOARD returned', !!lastOf(a, 'LEADERBOARD'));

  // 6. Quest flow
  a.ws.send(JSON.stringify({ REQUEST_DAILY_QUEST: true, playerName: 'Ash' }));
  await sleep(500);
  const dq = lastOf(a, 'DAILY_QUEST');
  check('REQUEST_DAILY_QUEST -> DAILY_QUEST', !!dq);
  const quest = dq?.DAILY_QUEST?.quest;
  check('quest has enemyCount', quest?.enemyCount > 0);

  if (quest) {
    a.ws.send(JSON.stringify({ REPORT_ENEMY_KILL: true, enemyType: quest.enemies, killCount: quest.enemyCount, questId: quest.id }));
    await sleep(600);
    check('kill report received', !!lastOf(a, 'KILL_REPORT_RECEIVED'));
    const qc = a.msgs.find(m => m.QUEST_COMPLETED);
    check('QUEST_COMPLETED on enough kills', !!qc);
  }

  a.ws.send(JSON.stringify({ GET_KILL_STATS: true }));
  await sleep(400);
  check('KILL_STATS returned', !!lastOf(a, 'KILL_STATS'));

  // 7. PvP match
  a.ws.send(JSON.stringify({ JOIN_QUEUE: true, powerLevel: 10 }));
  b.ws.send(JSON.stringify({ JOIN_QUEUE: true, powerLevel: 10 }));
  await sleep(600);
  const mfA = lastOf(a, 'MATCH_FOUND');
  const mfB = lastOf(b, 'MATCH_FOUND');
  check('ash got MATCH_FOUND', !!mfA);
  check('bob got MATCH_FOUND', !!mfB);
  check('opponent is bob', mfA?.MATCH_FOUND?.opponent?.playerId === PB);

  if (mfA) {
    for (let i = 0; i < 6; i++) a.ws.send(JSON.stringify({ TAP: true }));
    for (let i = 0; i < 2; i++) b.ws.send(JSON.stringify({ TAP: true }));
    await sleep(300);
    const upd = lastOf(a, 'MATCH_UPDATE');
    check('MATCH_UPDATE shows taps', upd?.MATCH_UPDATE?.player1Taps + upd?.MATCH_UPDATE?.player2Taps === 8);

    console.log('  waiting for match to end (~30s)...');
    await sleep(31000);
    const resA = lastOf(a, 'MATCH_RESULTS');
    check('MATCH_RESULTS received', !!resA);
    check('ash won 6-2', resA?.MATCH_RESULTS?.player1?.taps === 6 && resA?.MATCH_RESULTS?.player1?.isWinner === true);
  }

  // 8. Restore session on a fresh connection
  const a2 = await connect('ash2');
  a2.ws.send(JSON.stringify({ RESTORE_SESSION: true, playerId: PA, sessionToken: a.token }));
  await sleep(700);
  check('SESSION_RESTORED works', !!lastOf(a2, 'SESSION_RESTORED'));

  // 9. Bad restore rejected
  const a3 = await connect('ash3');
  a3.ws.send(JSON.stringify({ RESTORE_SESSION: true, playerId: PA, sessionToken: 'bogus' }));
  await sleep(500);
  check('bad sessionToken rejected', !!lastOf(a3, 'SESSION_RESTORE_ERROR'));

  // 10. Unauthenticated request rejected
  const c = await connect('anon');
  c.ws.send(JSON.stringify({ TEAM_STATUS: true }));
  await sleep(400);
  check('unauth TEAM_STATUS -> error', !!lastOf(c, 'TEAM_STATUS_ERROR'));

  a.ws.close(); b.ws.close(); a2.ws.close(); a3.ws.close(); c.ws.close();
  await sleep(300);

  const failed = results.filter(r => !r[1]);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed =====`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
