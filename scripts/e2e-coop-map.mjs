// Co-op run map (protocol level, no rendering): a map operation starts on a node, the node completes after
// five waves, the team votes on the run map, a "home" voter extracts alone, the rest travel to the next node
// (a fresh authoritative arena with the carried state), and the run records its path in PostgreSQL.
// Usage: RIFT_TEST_DATABASE_URL=... node scripts/e2e-coop-map.mjs   (starts its own test server on :8798, RIFT_MAP=1)
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { Bot, sleep } from './bot.mjs';

const PORT = 8798;
const WS_URL = `ws://localhost:${PORT}/ws`;
if (!process.env.RIFT_TEST_DATABASE_URL) throw new Error('Set RIFT_TEST_DATABASE_URL to a PostgreSQL test database');
const schema = `coopmap_${randomBytes(8).toString('hex')}`;
const databaseUrl = new URL(process.env.RIFT_TEST_DATABASE_URL);
databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
const db = new pg.Pool({ connectionString: databaseUrl.href });
let passes = 0, failures = 0;
const check = (n, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? '  ' + info : ''}`); ok ? passes++ : failures++; };

let server = null;
function startServer() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/main.ts'], {
    env: { ...process.env, RIFT_PORT: String(PORT), DATABASE_URL: databaseUrl.href, RIFT_TEST: '1', RIFT_MAP: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server = child;
  child.log = '';
  return new Promise((res, rej) => {
    const timeout = setTimeout(() => rej(new Error(`Server startup timed out\n${child.log}`)), 20000);
    child.once('exit', () => { clearTimeout(timeout); rej(new Error(`Server exited\n${child.log}`)); });
    child.stdout.on('data', (d) => { child.log += d; if (child.log.includes('Riftwarden co-op server')) { clearTimeout(timeout); res(); } });
    child.stderr.on('data', (d) => (child.log += d));
  });
}

async function bot(name) {
  const b = new Bot(name, WS_URL);
  const w = await b.connect();
  if (w.t !== 'welcome') throw new Error(`${name}: ${JSON.stringify(w)}`);
  if (!w.hasProfile) { b.send({ t: 'profileInit' }); await b.wait((m) => m.t === 'profile'); }
  return b;
}

function heartbeat(bots) {
  let alive = true;
  (async () => {
    while (alive) {
      for (const b of bots) {
        if (b.closed || !b.snap || !b.me()) continue;
        const m = b.me();
        try { b.input([m[1], m[2], m[3]]); } catch { /* closed */ }
      }
      await sleep(60);
    }
  })();
  return () => (alive = false);
}

async function clearWave(bots, actor) {
  const w0 = actor.snap.w[0];
  if (actor.snap.w[1] === 'prep') {
    for (let i = 0; i < 40 && actor.snap.of; i++) {
      const chooser = bots.find((b) => b.welcome.playerId === actor.snap.of[1]);
      if (chooser) await chooser.act({ a: 'upgrade', pick: actor.snap.of[0][0] });
      await sleep(80);
    }
    const r = await actor.act({ a: 'startWave' });
    if (!r.ok) return r;
  }
  await sleep(100);
  const r = await actor.act({ a: 'test', op: 'clear' });
  await actor.waitNew((m) => m.t === 'snap' && (m.s.w[0] > w0 || m.s.nd?.c), 15000).catch(() => null);
  await sleep(150);
  return r;
}

(async () => {
  let stop = () => {};
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    await startServer();
    const A = await bot('Alpha');
    const B = await bot('Bravo');
    A.send({ t: 'create', tier: 1 });
    await A.waitNew((m) => m.t === 'lobby' && m.lobby);
    B.send({ t: 'join', code: A.lobby.code });
    await B.waitNew((m) => m.t === 'lobby' && m.lobby);
    B.send({ t: 'ready', ready: true });
    await A.wait((m) => m.t === 'lobby' && m.lobby && m.lobby.players.length === 2 && m.lobby.players.every((p) => p.host || p.ready));
    A.send({ t: 'start' });
    for (const b of [A, B]) await b.waitNew((m) => m.t === 'runStart', 40000);
    for (const b of [A, B]) await b.waitNew((m) => m.t === 'snap');
    stop = heartbeat([A, B]);
    const run0 = A.run;
    const war0 = await (await fetch(`http://localhost:${PORT}/war`)).json();
    check('M1 runStart carries the war entry sector (the front landing) and the war seed', !!run0.node && run0.node.id === 'r0n0' && run0.node.map === war0.war.seed && run0.node.carry === null, JSON.stringify(run0.node));
    check('M2 snapshots carry node state and the map vote field', !!A.snap.nd && Array.isArray(A.snap.mv), JSON.stringify({ nd: A.snap.nd, mv: A.snap.mv }));
    const { rows: [ar] } = await db.query('SELECT map FROM profile_active_runs WHERE player_id = $1', [A.welcome.playerId]);
    check('M3 PostgreSQL active run holds the map state', !!ar?.map && ar.map.seed === run0.node.map, JSON.stringify(ar));

    for (let w = 0; w < 5; w++) await clearWave([A, B], A);
    // Pick the last upgrade, then the vote opens.
    for (let i = 0; i < 60 && !A.snap.mv?.[0]; i++) {
      if (A.snap.of) {
        const chooser = [A, B].find((b) => b.welcome.playerId === A.snap.of[1]);
        if (chooser) await chooser.act({ a: 'upgrade', pick: A.snap.of[0][0] });
      }
      await sleep(100);
    }
    const nd = A.snap.nd;
    check('M4 node completes after wave 5 and the map vote opens', !!nd?.c && A.snap.mv?.[0] === 1 && A.events.some((e) => e[0] === 'vote' && e[1] === 2), JSON.stringify({ nd, mv: A.snap.mv }));
    const refused = await A.act({ a: 'startWave' });
    check('M5 a secured node refuses the next wave', !refused.ok, refused.reason);
    const badVote = await A.act({ a: 'mapVote', choice: 'a9r9c9' });
    check('M6 unreachable nodes are refused', !badVote.ok, badVote.reason);
    // Reachable nodes: from the map seed (same pure generator as the server).
    const { reachable } = await import('../packages/rules/src/war/world.ts');
    const warNow = (await (await fetch(`http://localhost:${PORT}/war`)).json()).war;
    check('W1 the co-op team secured r0n0: the shared war counted it (trusted, per warden)', warNow.secured >= 1 && warNow.regions[0].nodes.r0n0.lib > war0.war.regions[0].nodes.r0n0.lib, JSON.stringify({ before: war0.war.regions[0].nodes.r0n0, after: warNow.regions[0].nodes.r0n0 }));
    const next = reachable(run0.node.map, warNow, run0.node.id)[0];
    const cores = A.snap.c;
    const vA = await A.act({ a: 'mapVote', choice: next.id });
    const vB = await B.act({ a: 'mapVote', choice: 'home' });
    check('M7 votes accepted', vA.ok && vB.ok, JSON.stringify([vA, vB]));
    const endB = await B.waitNew((m) => m.t === 'runEnd', 20000).catch(() => null);
    check('M8 the home voter extracts alone (returned, path recorded)', endB?.result?.outcome === 'returned' && endB.result.map?.nodes === 1 && endB.result.map.path.length === 1, JSON.stringify(endB?.result?.map));
    const startA = await A.wait((m) => m.t === 'runStart' && m.run.node?.id === next.id, 30000).catch(() => null);
    check('M9 the team travels: new runStart on the chosen node, same run', startA?.run?.runId === run0.runId && startA.run.node?.id === next.id && startA.run.node.path.length === 2 && !startA.run.rejoin, JSON.stringify(startA?.run?.node && { id: startA.run.node.id, path: startA.run.node.path }));
    const carry = startA?.run?.node?.carry;
    check('M10 carry: cores (+ tower refund) and upgrades cross into the next node', !!carry && carry.wave === 5 && carry.cores >= cores && carry.build.picks.length >= 4, JSON.stringify(carry && { wave: carry.wave, cores: carry.cores, picks: carry.build.picks.length, was: cores }));
    await A.waitNew((m) => m.t === 'snap', 10000);
    await sleep(300);
    check('M11 the new arena starts at wave 6 (combat) or holds (hub)', next.kind === 'combat' || next.kind === 'elite' || next.kind === 'boss' ? A.snap.w[0] === 6 : A.snap.w[0] === 6 && A.snap.mv?.[0] === 1, JSON.stringify({ w: A.snap.w, kind: next.kind, mv: A.snap.mv }));
    check('M12 the extracted warden is gone from the team', !A.snap.a.some((x) => x[0] === B.welcome.playerId));
    const { rows: [hb] } = await db.query('SELECT path, nodes, outcome FROM profile_run_history WHERE player_id = $1 ORDER BY position LIMIT 1', [B.welcome.playerId]);
    check('M13 PostgreSQL history keeps the home voter path', hb?.outcome === 'returned' && hb.nodes === 1 && hb.path?.length === 1, JSON.stringify(hb));
    // Alpha extracts from the new node (hub: immediately; combat: after it is secured).
    if (!A.snap.mv?.[0]) {
      for (let w = 0; w < 5; w++) await clearWave([A], A);
      for (let i = 0; i < 60 && !A.snap.mv?.[0]; i++) {
        if (A.snap.of) await A.act({ a: 'upgrade', pick: A.snap.of[0][0] });
        await sleep(100);
      }
    }
    const vh = await A.act({ a: 'mapVote', choice: 'home' });
    const endA = await A.waitNew((m) => m.t === 'runEnd', 20000).catch(() => null);
    check('M14 the last warden extracts: run ends with two nodes on the path', vh.ok && endA?.result?.outcome === 'returned' && endA.result.map?.nodes === 2 && endA.result.map.path.length === 2, JSON.stringify(endA?.result?.map));
    const { rows: [rec] } = await db.query('SELECT best_nodes, deepest_act FROM profile_tier_records WHERE player_id = $1 AND tier = 1', [A.welcome.playerId]);
    check('M15 map records in PostgreSQL', Number(rec?.best_nodes) === 2 && Number(rec?.deepest_act) === 1, JSON.stringify(rec));
    // Headless servers cannot fetch the scanned skyline props (a warning on every arena build, also before the map).
    const errLines = server.log.split('\n').filter((l) => /rror/.test(l) && !/rejected|Scenery asset unavailable/.test(l));
    check('M16 no server errors across the node swap', errLines.length === 0, errLines.slice(0, 3).join(' | '));

    // ---------------------------------------------------------- solo reports over HTTP
    const post = (body) => fetch(`http://localhost:${PORT}/war/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const target = Object.keys(warNow.regions[0].nodes).find((id) => id !== 'r0n0');
    const r1 = await post({ node: target, mode: 'defense', id: 'solo-test' });
    const r2 = await post({ node: target, mode: 'defense', id: 'solo-test' });
    const r3 = await post({ node: 'r9n9', mode: 'defense', id: 'solo-other' });
    check('W2 a solo report adds liberation (one warden share)', r1.status === 200 && r1.body.ok && r1.body.gain > 0, JSON.stringify(r1));
    check('W3 reports are rate limited per reporter', r2.status === 429 && /Too soon/.test(r2.body.reason ?? ''), JSON.stringify(r2));
    check('W4 locked or unknown sectors are refused', r3.status === 429 && !r3.body.ok, JSON.stringify(r3.body));
    const bad = await fetch(`http://localhost:${PORT}/war/report`, { method: 'POST', body: 'x'.repeat(5000) });
    check('W5 oversized report bodies are refused', bad.status === 413);
    await sleep(400);
    const { rows: [ws] } = await db.query('SELECT data FROM war_state WHERE id = 1');
    check('W6 the war is persisted in PostgreSQL', ws?.data?.war?.secured >= 2, JSON.stringify(ws?.data?.war?.secured));

    // ---------------------------------------------------------- survival operation (same two wardens)
    stop();
    await sleep(500);
    await B.waitNew((m) => m.t === 'lobby' && m.lobby, 5000).catch(() => null);
    A.send({ t: 'create', tier: 1 });
    await A.waitNew((m) => m.t === 'lobby' && m.lobby && m.lobby.hostId === A.welcome.playerId);
    B.send({ t: 'join', code: A.lobby.code });
    await B.waitNew((m) => m.t === 'lobby' && m.lobby);
    B.send({ t: 'mode', mode: 'survival' });
    const refusedMode = await B.waitNew((m) => m.t === 'error', 3000).catch(() => null);
    A.send({ t: 'mode', mode: 'survival' });
    await A.waitNew((m) => m.t === 'lobby' && m.lobby?.mode === 'survival');
    B.send({ t: 'ready', ready: true });
    await A.wait((m) => m.t === 'lobby' && m.lobby && m.lobby.players.length === 2 && m.lobby.players.every((p) => p.host || p.ready));
    check('V1 only the host picks the mode; the lobby shows survival', !!refusedMode && A.lobby.mode === 'survival', JSON.stringify(refusedMode));
    A.send({ t: 'start' });
    for (const b of [A, B]) await b.waitNew((m) => m.t === 'runStart', 40000);
    for (const b of [A, B]) await b.waitNew((m) => m.t === 'snap');
    stop = heartbeat([A, B]);
    check('V2 runStart carries the survival mode', A.run.mode === 'survival' && B.run.mode === 'survival');
    const me = A.me();
    const place = await A.act({ a: 'place', cfg: { base: 'standard', weapon: 'autocannon', core: 'standard_core', modifier: 'none' }, p: [me[1] + 6, 0, me[3]], yaw: 0 });
    check('V3 towers are refused', !place.ok && /Survival/.test(place.reason ?? ''), place.reason);
    const endsBefore = A.msgs.filter((m) => m.t === 'runEnd').length;
    await B.act({ a: 'test', op: 'down' });
    await sleep(600);
    const rowB = A.snap.a.find((x) => x[0] === B.welcome.playerId);
    check('V4 a downed warden is out (no respawn) while the team plays on', !!rowB && rowB[10] === 0 && rowB[11] >= 999 && A.msgs.filter((m) => m.t === 'runEnd').length === endsBefore, JSON.stringify(rowB?.slice(10, 12)));
    await A.act({ a: 'test', op: 'down' });
    const endA2 = await A.waitNew((m) => m.t === 'runEnd', 20000).catch(() => null);
    check('V5 the last warden down = team defeat, recorded as a survival run', endA2?.result?.outcome === 'defeat' && endA2.result.mode === 'survival', JSON.stringify(endA2?.result && { o: endA2.result.outcome, m: endA2.result.mode }));
    const { rows: [hs] } = await db.query('SELECT mode FROM profile_run_history WHERE player_id = $1 ORDER BY position LIMIT 1', [A.welcome.playerId]);
    check('V6 PostgreSQL history keeps the mode', hs?.mode === 'survival', JSON.stringify(hs));
  } catch (e) {
    console.log('FAIL  exception', e.stack || e, server?.log?.slice(-2000));
    failures++;
  } finally {
    stop();
    console.log(`\n${passes} passed, ${failures} failed`);
    server?.kill();
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await db.end();
    process.exit(failures ? 1 : 0);
  }
})();
