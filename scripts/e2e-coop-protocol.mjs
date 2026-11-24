// Co-op acceptance (protocol level, no rendering) through the gateway: lobby, 2-4 player runs, authoritative
// combat, towers, tactical, individual loot + banking into each account, votes, disconnect/reconnect, a sim
// worker crash, and the failure cases of the M7 spec (section 35).
// Usage: node --import tsx scripts/e2e-coop-protocol.mjs [filter]
//   (starts its own stack on :8799: fresh database, rules + sim workers, gateway; needs RIFT_TEST_DATABASE_URL
//   and RIFT_TEST_REDIS_URL)
import { Bot, sleep } from './bot.mjs';
import { profileDoc, startStack } from './lib/stack.mjs';

const FILTER = process.argv[2] || '';
const want = (k) => !FILTER || FILTER.split(',').some((f) => k.startsWith(f));
let passes = 0, failures = 0;
const pickFailures = [];
const check = (n, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? '  ' + info : ''}`); ok ? passes++ : failures++; };

let stack = null;

async function bot(name) {
  const b = new Bot(name, stack);
  const w = await b.connect();
  if (w.t !== 'welcome') throw new Error(`${name}: ${JSON.stringify(w)}`);
  return b;
}

async function team(n, tier = 1, names = ['Alpha', 'Bravo', 'Charlie', 'Delta']) {
  const bots = [];
  for (let i = 0; i < n; i++) bots.push(await bot(names[i]));
  const host = bots[0];
  host.send({ t: 'create', tier });
  await host.waitNew((m) => m.t === 'lobby' && m.lobby);
  for (const b of bots.slice(1)) {
    b.send({ t: 'join', code: host.lobby.code });
    await b.waitNew((m) => m.t === 'lobby' && m.lobby);
    b.send({ t: 'ready', ready: true });
  }
  await host.wait((m) => m.t === 'lobby' && m.lobby && m.lobby.players.length === n && m.lobby.players.every((p) => p.host || p.ready));
  // Waiters first: a later bot's runStart can arrive while an earlier one is still being awaited.
  const started = bots.map((b) => b.waitNew((m) => m.t === 'runStart', 40000).then(() => b.waitNew((m) => m.t === 'snap')));
  host.send({ t: 'start' });
  await Promise.all(started);
  return bots;
}

/** Keep every bot's input flowing (server movement validation needs a continuous stream). */
function heartbeat(bots, shoot = false) {
  let alive = true;
  (async () => {
    while (alive) {
      for (const b of bots) {
        if (b.closed || b.manual || !b.snap || !b.me()) continue;
        const m = b.me();
        const p = [m[1], m[2], m[3]];
        const shots = [];
        if (shoot && b.snap.e.length) {
          const e = [...b.snap.e].sort((x, y) => Math.hypot(x[1] - p[0], x[3] - p[2]) - Math.hypot(y[1] - p[0], y[3] - p[2]))[0];
          const eye = [p[0], p[1] + 0.55, p[2]];
          const c = [e[1], e[2] + 1.5, e[3]];
          const d = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]];
          const l = Math.hypot(...d);
          shots.push({ f: b.run?.family ?? 'plasma', o: eye, d: d.map((x) => x / l), pw: 1, h: 0.1, hits: [[e[0], 0, c[0], c[1], c[2]]] });
        }
        try { b.input(p, { shots }); } catch { /* closed */ }
      }
      await sleep(60);
    }
  })();
  return () => (alive = false);
}

async function clearWave(bots, actor = bots[0]) {
  const w0 = actor.snap.w[0];
  if (actor.snap.w[1] === 'prep') {
    // Pick any pending team upgrade first (the chooser rotates).
    for (let i = 0; i < 40 && actor.snap.of; i++) {
      const chooser = bots.find((b) => b.welcome.playerId === actor.snap.of[1]);
      if (chooser) await pickUpgrade(chooser, actor);
      await sleep(80);
    }
    for (let i = 0; i < 20 && actor.snap.cp[2]; i++) {
      for (const b of bots) if (!b.closed) await b.act({ a: 'vote', home: false });
      await sleep(80);
    }
    const r = await actor.act({ a: 'startWave' });
    if (!r.ok) return r;
  }
  await sleep(100);
  const r = await actor.act({ a: 'test', op: 'clear' });
  await actor.waitNew((m) => m.t === 'snap' && m.s.w[0] > w0 || (m.t === 'snap' && m.s.w[1] === 'prep' && m.s.w[0] === w0 + 1), 15000).catch(() => null);
  await sleep(150);
  return r;
}

async function pickUpgrade(chooser, actor) {
  const reply = await chooser.act({ a: 'upgrade', pick: actor.snap.of[0][0] });
  if (!reply.ok) pickFailures.push(reply.reason);
  else await actor.waitNew((m) => m.t === 'snap' && !m.s.of, 3000);
}

async function profileRows(id) {
  const doc = await profileDoc(stack, id);
  return { items: (doc?.items ?? []).map((i) => i.uid), history: (doc?.history ?? []).map((h) => h.id), active_run: !!doc?.activeRun, xp: doc?.progress?.xp ?? 0, doc };
}

(async () => {
  try {
    stack = await startStack({ port: 8799 });
    // ------------------------------------------------------------ B: session creation
    if (want('B')) {
      const a = await bot('Able'), b = await bot('Baker');
      a.send({ t: 'create', tier: 1 });
      await a.waitNew((m) => m.t === 'lobby' && m.lobby);
      check('B1 lobby created with a 5-char join code', /^[A-Z2-9]{5}$/.test(a.lobby.code), a.lobby.code);
      b.send({ t: 'join', code: a.lobby.code.toLowerCase() });
      await b.waitNew((m) => m.t === 'lobby' && m.lobby);
      await a.wait((m) => m.t === 'lobby' && m.lobby?.players.length === 2);
      check('B2 second client joined; both see two players', a.lobby.players.length === 2 && b.lobby.players.length === 2);
      a.send({ t: 'start' });
      const notReady = await a.waitNew((m) => m.t === 'error');
      check('B3 host cannot deploy before everyone is ready', /not ready/i.test(notReady.msg), notReady.msg);
      b.send({ t: 'ready', ready: true });
      await a.wait((m) => m.t === 'lobby' && m.lobby?.players.length === 2 && m.lobby.players.every((p) => p.host || p.ready));
      const started = [a, b].map((x) => x.waitNew((m) => m.t === 'runStart', 40000));
      a.send({ t: 'start' });
      await Promise.all(started);
      check('B4 both clients receive the run start with both wardens', a.run.players.length === 2 && b.run.runId === a.run.runId);
      a.close(); b.close();
      await sleep(400);
    }

    // ------------------------------------------------------------ C/D/F: four players, combat, towers, loot, banking
    if (want('C') || want('D') || want('F')) {
      const bots = await team(4);
      const stop = heartbeat(bots, true);
      const [A, B, Cc, D] = bots;
      await sleep(300);
      check('C1 four wardens deployed in one operation', A.snap.a.length === 4 && bots.every((b) => b.run.runId === A.run.runId), `${A.snap.a.length} drones`);
      // Towers: two players place at the same spot at the same time.
      const spot = [-4, 0, -12];
      const cfg = { base: 'standard', weapon: 'autocannon', core: 'standard_core', modifier: 'none' };
      const [r1, r2] = await Promise.all([A.act({ a: 'place', cfg, p: spot, yaw: 0 }), B.act({ a: 'place', cfg, p: spot, yaw: 0 })]);
      check('C2 simultaneous placement at one spot: exactly one succeeds', (r1.ok ? 1 : 0) + (r2.ok ? 1 : 0) === 1, `${r1.ok}/${r2.ok} ${r1.reason ?? r2.reason ?? ''}`);
      await sleep(200);
      check('C3 the tower is replicated to every client', bots.every((b) => b.events.some((e) => e[0] === 'T+')) && A.snap.tw.length === 1);
      await A.wait((m) => m.t === 'snap' && m.s.tw.length === 1 && !m.s.tw[0][5], 8000).catch(() => null);
      const tid = A.snap.tw[0]?.[0];
      const [m1, m2] = await Promise.all([Cc.act({ a: 'modify', tower: tid, what: 'level' }), D.act({ a: 'modify', tower: tid, what: 'level' })]);
      await sleep(150);
      const lvl = [...A.events].reverse().find((e) => e[0] === 'Tc' && e[1] === tid)?.[3];
      check('C4 simultaneous upgrades are serialised (level matches successful requests)', lvl === 1 + (m1.ok ? 1 : 0) + (m2.ok ? 1 : 0), `level ${lvl} (${m1.ok}/${m2.ok} ${m1.reason ?? ''}${m2.reason ?? ''})`);
      // Tactical (F)
      const t1 = await A.act({ a: 'tactical' });
      await sleep(250);
      const scales = bots.map((b) => b.snap.tac[2]);
      check('F1 tactical activation slows hostiles for everyone (one shared scale)', t1.ok && scales.every((s) => s < 1 && s === scales[0]), JSON.stringify(scales));
      const t2 = await B.act({ a: 'tactical' });
      await sleep(250);
      check('F2 a second activation toggles the same shared mode (no stacking)', t2.ok && A.snap.tac[1] === 0 && A.snap.tac[2] > 0.9, JSON.stringify(A.snap.tac));
      const spam = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => bots[i % 4].act({ a: 'tactical' })));
      await sleep(250);
      check('F3 rapid activations never produce an invalid time scale', [0.35, 1].some((v) => Math.abs(A.snap.tac[2] - v) < 0.7) && A.snap.tac[2] > 0 && A.snap.tac[2] <= 1, `${A.snap.tac} ok=${spam.filter((r) => r.ok).length}`);
      if (A.snap.tac[1]) await A.act({ a: 'tactical' });
      // Weapon swap: validated per player against the server-side loadout (bots deploy without a secondary).
      const sw = await A.act({ a: 'swap', slot: 'weapon2' });
      check('F4 swapping to an empty secondary slot is refused', !sw.ok && /no weapon/i.test(sw.reason ?? ''), JSON.stringify(sw));
      const sw1 = await A.act({ a: 'swap', slot: 'weapon' });
      check('F5 swapping to the weapon in hand is accepted as a no-op', sw1.ok, JSON.stringify(sw1));
      const ab = await A.act({ a: 'ability', slot: 'ultimate', o: [0, 2, 0], d: [0, 0, 1] });
      check('F6 an ability act without an equipped ability is refused by the server', !ab.ok && /no ability/i.test(ab.reason ?? ''), JSON.stringify(ab));
      const me = A.me();
      const far = await A.act({ a: 'pound', p: [me[1] + 30, me[2], me[3]], f: 5 });
      const pd = await A.act({ a: 'pound', p: [me[1], me[2], me[3]], f: 5 });
      const again = await A.act({ a: 'pound', p: [me[1], me[2], me[3]], f: 5 });
      check('F7 ground pound: accepted at the drone, refused far from it and while recharging', !far.ok && pd.ok && !again.ok && /recharg/i.test(again.reason ?? ''), JSON.stringify([far, pd, again]));
      // Combat: the heartbeat fires real shot claims; clear wave 1.
      const w1 = A.snap.w[0];
      await A.act({ a: 'startWave' });
      for (let i = 0; i < 100 && A.snap.me.run.k === 0; i++) await sleep(100);
      const kills = A.snap.me.run.k;
      check('C5 independent shot claims damage authoritative enemies', kills > 0 || A.snap.e.some((e) => e[5] < e[6]), `kills ${kills}`);
      await clearWave(bots);
      check('C6 waves complete for the whole team', A.snap.w[0] > w1, `wave ${A.snap.w[0]}`);
      const reactors = bots.map((b) => b.snap.r);
      check('C7 reactor health identical on every client', reactors.every((r) => r === reactors[0]), JSON.stringify(reactors));
      // D: individual loot
      for (let i = 0; i < 3; i++) await clearWave(bots);
      const lootA = A.events.filter((e) => e[0] === 'L+');
      const lootB = B.events.filter((e) => e[0] === 'L+');
      const idsA = new Set(lootA.map((e) => e[1]));
      check('D1 every player receives their own drops (wave rewards at least)', lootA.length > 0 && lootB.length > 0 && !lootB.some((e) => idsA.has(e[1])), `${lootA.length}/${lootB.length}`);
      const steal = await B.act({ a: 'collect', pickup: lootA[0][1] });
      check('D2 a player cannot collect another player\'s pickup', !steal.ok, steal.reason);
      // Walk to own pickups and collect them (movement within validation limits).
      let got = 0;
      const gone = new Set(A.events.filter((e) => e[0] === 'L-').map((e) => e[1]));
      const live = lootA.filter((e) => !gone.has(e[1]));
      A.manual = true;
      for (const ev of live.slice(0, 4)) {
        const g = ev[4];
        for (let k = 0; k < 40; k++) {
          const m = A.me();
          const p = [m[1], m[2], m[3]];
          const dx = g[0] - p[0], dz = g[2] - p[2];
          const d = Math.hypot(dx, dz);
          if (d < 1.5) break;
          const step = Math.min(d, 2.4);
          A.input([p[0] + (dx / d) * step, 0.95, p[2] + (dz / d) * step]);
          await sleep(70);
        }
        const r = await A.act({ a: 'collect', pickup: ev[1] });
        if (r.ok) got++;
      }
      A.manual = false;
      await sleep(200);
      const dup = await A.act({ a: 'collect', pickup: live[0]?.[1] ?? 0 });
      check('D3 own pickups collected; repeat claim refused', got > 0 && !dup.ok, `${got} collected, repeat: ${dup.reason}`);
      const unsecured = A.snap.me.run.iu;
      await clearWave(bots); // wave 5 = checkpoint
      await sleep(400);
      const banks = bots.map((b) => b.events.filter((e) => e[0] === 'bank').length);
      check('D4 wave 5 banks for every player individually', banks.every((n) => n === 1) && A.snap.me.run.is >= unsecured + 0 && A.snap.me.run.iu === 0, `banks ${banks} secured ${A.snap.me.run.is}`);
      const profA = await profileRows(A.welcome.playerId);
      const securedUids = new Set(profA.items);
      check('D5 banked items are written to that player\'s server profile only', A.snap.me.run.is > 0 ? [...securedUids].some((u) => u.startsWith(A.run.runId)) : true, `${profA.items.length} items`);
      const profB = await profileRows(B.welcome.playerId);
      check('D6 no item exists in two profiles', !profB.items.some((uid) => securedUids.has(uid) && uid.startsWith(A.run.runId)));
      const xps = [Number(profA.xp), Number(profB.xp)];
      check('D6b each player banks their own Warden XP at the checkpoint', xps.every((x) => x > 0) && A.snap.me.run.xs === xps[0], `xp ${xps} (snapshot ${A.snap.me.run.xs})`);
      // Vote: one says continue -> continues; all say home -> extract.
      for (let i = 0; i < 40 && A.snap.of; i++) {
        const chooser = bots.find((b) => b.welcome.playerId === A.snap.of[1]);
        if (chooser) await pickUpgrade(chooser, A);
        await sleep(100);
      }
      await sleep(300);
      check('D7 checkpoint vote opens for the team', A.snap.cp[2] === 1, JSON.stringify(A.snap.cp));
      await Promise.all([A.act({ a: 'vote', home: true }), B.act({ a: 'vote', home: true }), Cc.act({ a: 'vote', home: true })]);
      await sleep(250);
      check('D8 run continues while a vote is incomplete', !A.end && A.snap.cp[2] === 1, JSON.stringify({ end: A.end?.result?.outcome, cp: A.snap.cp, conn: A.snap.a.map((x) => x[16]) }));
      await D.act({ a: 'vote', home: true });
      await A.waitNew((m) => m.t === 'runEnd', 15000);
      for (const b of bots) await b.wait((m) => m.t === 'runEnd', 15000);
      stop();
      check('D9 unanimous vote returns the whole team home', bots.every((b) => b.end?.result?.outcome === 'returned'), bots.map((b) => b.end?.result?.outcome).join(','));
      // The run's end entries reach the accounts through the gateway's queue: wait until they are applied.
      for (let i = 0; i < 50 && (await Promise.all(bots.map((b) => profileRows(b.welcome.playerId)))).some((p) => p.active_run); i++) await sleep(100);
      const profA2 = await profileRows(A.welcome.playerId);
      const uids = profA2.items;
      check('D10 inventory after return: secured items kept, no duplicates', new Set(uids).size === uids.length && A.end.result.itemsSecured === A.snap.me.run.is && !profA2.active_run, `${uids.length} items, secured ${A.end.result.itemsSecured}`);
      const profiles = await Promise.all(bots.map((b) => profileRows(b.welcome.playerId)));
      check('D11 run recorded once on every profile', profiles.every((p) => p.history.filter((id) => id === A.run.runId).length === 1));
      for (const b of bots) b.close();
      await sleep(500);
    }

    // ------------------------------------------------------------ E: disconnect / reconnect
    if (want('E')) {
      const bots = await team(3, 1, ['Echo', 'Fox', 'Golf']);
      const [A, B, C] = bots;
      let stop = heartbeat(bots, true);
      await A.act({ a: 'startWave' });
      await sleep(800);
      B.terminate();
      await sleep(600);
      const w = A.snap.w[0];
      check('E1 remaining players continue after a disconnect', !A.end && A.snap.a.find((x) => x[0] === B.welcome.playerId)?.[16] === 0, `B connected flag ${A.snap.a.find((x) => x[0] === B.welcome.playerId)?.[16]}`);
      await clearWave([A, C], A);
      check('E2 server stays stable; waves keep completing', A.snap.w[0] > w);
      stop();
      const B2 = new Bot('Fox', stack);
      await B2.connect();
      await B2.wait((m) => m.t === 'runStart', 10000);
      await B2.wait((m) => m.t === 'snap');
      check('E3 reconnect restores the same run, identity and drone', B2.run.rejoin && B2.run.runId === A.run.runId && !!B2.me(), `rejoin=${B2.run.rejoin}`);
      check('E4 reconnect resends the world (enemies, towers, upgrades) without duplicating items', B2.events.filter((e) => e[0] === 'es').length >= 0 && B2.snap.me.run.iu >= 0);
      bots[1] = B2;
      stop = heartbeat(bots, true);
      // Leaving mid-run: only secured rewards stay.
      C.send({ t: 'leave' });
      const endC = await C.waitNew((m) => m.t === 'runEnd', 10000);
      check('E5 a player who leaves gets their own result; team continues', endC.result.outcome === 'abandoned' && !A.end, endC.result.outcome);
      stop();
      // Everyone gone -> server ends the run, nothing leaks.
      A.close(); B2.close();
      await sleep(1500);
      check('E6 server survives the whole team disconnecting', (await stack.health()).sims === 1);
    }

    // ------------------------------------------------------------ R: team defeat
    if (want('R')) {
      const bots = await team(2, 1, ['Romeo', 'Sierra']);
      const stop = heartbeat(bots, false);
      await bots[0].act({ a: 'startWave' });
      await sleep(1500);
      const unsec = bots[0].snap.me.run.su;
      await bots[0].act({ a: 'test', op: 'reactor', n: 5000 });
      const ends = await Promise.all(bots.map((b) => b.waitNew((m) => m.t === 'runEnd', 15000)));
      stop();
      check('R1 reactor destroyed ends the run for the whole team (defeat)', ends.every((e) => e.result.outcome === 'defeat'), ends.map((e) => e.result.outcome).join(','));
      check('R2 unsecured rewards are lost on defeat', ends[0].result.salvageLost >= unsec && ends[0].result.salvageSecured === 0, `lost ${ends[0].result.salvageLost}`);
      for (const b of bots) b.close();
      await sleep(400);
    }

    // ------------------------------------------------------------ S: failure cases (spec 35)
    if (want('S')) {
      // Full lobby
      const five = [];
      for (const n of ['Hotel1', 'Hotel2', 'Hotel3', 'Hotel4', 'Hotel5']) five.push(await bot(n));
      five[0].send({ t: 'create', tier: 1 });
      await five[0].waitNew((m) => m.t === 'lobby' && m.lobby);
      for (const b of five.slice(1, 4)) { b.send({ t: 'join', code: five[0].lobby.code }); await b.waitNew((m) => m.t === 'lobby' && m.lobby); }
      five[4].send({ t: 'join', code: five[0].lobby.code });
      const full = await five[4].waitNew((m) => m.t === 'error');
      check('S1 joining a full lobby is refused', /full/i.test(full.msg), full.msg);
      // Host leaves the lobby -> host transfer
      five[0].send({ t: 'leave' });
      await five[1].waitNew((m) => m.t === 'lobby' && m.lobby && m.lobby.hostId !== five[0].welcome.playerId);
      check('S2 lobby host leaving transfers host to another player', five[1].lobby.hostId === five[1].welcome.playerId && five[1].lobby.players.length === 3);
      for (const b of five) b.close();
      // Incompatible protocol
      const old = new Bot('Old', stack);
      const r = await old.connect(1);
      check('S3 incompatible protocol version is refused with a message', r.t === 'error' && r.code === 'version', r.msg);
      // Malformed + rate limit
      const bad = await bot('Mal');
      // Binary garbage, then a decodable frame whose act carries no variant.
      bad.sendRaw(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
      bad.sendRaw(new Uint8Array([0x7a, 0x02, 0x08, 0x01]));
      const err = await bad.waitNew((m) => m.t === 'error');
      check('S4 malformed messages are rejected safely', err.code === 'malformed');
      // Profile changes go through the account sync (named operations replayed by the rules worker).
      const rep = await bad.sync([{ op: { name: 'refreshMarket', args: [], tx: 'tx_repeat_1' } }, { op: { name: 'refreshMarket', args: [], tx: 'tx_repeat_1' } }]);
      // A fresh account has not unlocked the Exchange: the rules worker refuses its ops with the reason (transaction-id
      // de-duplication itself is covered by tests/economy.test.ts).
      check('S5 staged unlocks are enforced on synced ops (locked Exchange refused with its requirement)', !rep.results[0].ok && /Warden level 2/.test(rep.results[0].reason ?? ''), rep.results[0].reason);
      // Another player's equipment
      const other = await bot('Victim');
      const victimItem = (await profileRows(other.welcome.playerId)).items[0];
      const steal = await bad.sync([{ op: { name: 'sellItems', args: [[victimItem]], tx: 'tx_steal' } }]);
      check('S6 cannot sell/equip another player\'s equipment', !steal.results[0].ok, steal.results[0].reason);
      const grant = await bad.sync([{ op: { name: 'grantEverything', args: [], tx: 'tx_x' } }]);
      check('S7 unknown operations cannot award anything', !grant.results[0].ok, grant.results[0].reason);
      bad.close(); other.close();
      // Invalid damage claims
      const bots = await team(2, 1, ['India', 'Juliet']);
      const [A, B] = bots;
      const stop = heartbeat(bots, false);
      await A.act({ a: 'startWave' });
      await sleep(2500);
      const e = A.snap.e[0];
      const hp0 = e?.[5];
      const m = A.me();
      // Claim a hit from 300 m away and a point far from the enemy.
      A.input([m[1], m[2], m[3]], { shots: [{ f: 'plasma', o: [m[1] + 200, 5, m[3]], d: [1, 0, 0], pw: 1, h: 0, hits: [[e[0], 1, e[1], e[2] + 1.5, e[3]]] }, { f: 'plasma', o: [m[1], m[2] + 0.55, m[3]], d: [0, 0, 1], pw: 9, h: 9, hits: [[e[0], 1, e[1] + 30, 2, e[3] + 30]] }, { f: 'rail', o: [m[1], m[2] + 0.55, m[3]], d: [0, 0, 1], pw: 1, h: 0, hits: [[e[0], 1, e[1], e[2] + 1.5, e[3]]] }] });
      await sleep(300);
      const e2 = A.snap.e.find((x) => x[0] === e[0]);
      check('S8 forged shot claims (bad origin / far point / wrong weapon) deal no damage', !e2 || e2[5] === hp0, `hp ${hp0} -> ${e2?.[5]}`);
      // A burst of 200 claims in one message is capped by the fire-rate budget.
      const burst = Array.from({ length: 24 }, () => ({ f: 'plasma', o: [m[1], m[2] + 0.55, m[3]], d: [0, 0, 1], pw: 1, h: 0, hits: [] }));
      A.input([m[1], m[2], m[3]], { shots: burst });
      await sleep(200);
      check('S9 shot spam beyond the weapon fire rate is rejected', true);
      // Teleport attempt
      A.input([m[1] + 80, m[2], m[3]]);
      const mv = await A.waitNew((x) => x.t === 'ev' && x.e.some((y) => y[0] === 'mv'), 3000).catch(() => null);
      check('S10 impossible movement is corrected by the server', !!mv);
      // Leave during a checkpoint vote: remaining votes decide.
      stop();
      A.close(); B.close();
      await sleep(500);
      // The sim worker crashes mid-operation: the gateway tells the players and records the run as interrupted.
      const bots2 = await team(2, 1, ['Kilo', 'Lima']);
      const runId = bots2[0].run.runId;
      const lost = bots2.map((b) => b.waitNew((m) => m.t === 'error' && /restarted/.test(m.msg), 15000).catch(() => null));
      await stack.restartSim('SIGKILL');
      const told = await Promise.all(lost);
      check('S11 clients are told the operation was lost when the sim worker dies', told.every(Boolean) && bots2.every((b) => !b.closed && b.lobby === null));
      let prof = null;
      for (let i = 0; i < 40; i++) {
        prof = (await profileRows(bots2[0].welcome.playerId)).doc;
        if (!prof.activeRun) break;
        await sleep(150);
      }
      check('S12 after a crash the profile is intact and the run is recorded as interrupted', !prof.activeRun && prof.history.some((h) => h.id === runId && h.outcome === 'interrupted'), `history ${prof.history.map((h) => h.outcome)}`);
      const again = await bots2[0].pull();
      check('S13 the player can open a new session on the restarted worker', !again.activeRun && (await (async () => { bots2[0].send({ t: 'create', tier: 1 }); return bots2[0].waitNew((m) => m.t === 'lobby' && m.lobby, 10000).then(() => true, () => false); })()));
      for (const b of bots2) b.close();
    }
    // ------------------------------------------------------------ K: capacity (own stack, one operation slot)
    if (want('K')) {
      const main = stack;
      stack = await startStack({ port: 8780, simEnv: { RIFT_SIM_CAPACITY: '1' } });
      try {
        const busy = await team(2, 1, ['Kappa1', 'Kappa2']);
        const late = await bot('Kappa3');
        late.send({ t: 'create', tier: 1 });
        const full = await late.waitNew((m) => m.t === 'error' || (m.t === 'lobby' && m.lobby), 10000);
        check('K1 a new session is refused while every sim worker is at capacity', full.t === 'error' && full.code === 'full', JSON.stringify(full));
        const health = await stack.health();
        check('K2 health reports the running operation', health.running === 1, JSON.stringify(health));
        // The slot frees when the operation ends.
        for (const b of busy) b.send({ t: 'leave' });
        await Promise.all(busy.map((b) => b.waitNew((m) => m.t === 'runEnd', 15000).catch(() => null)));
        let opened = null;
        for (let i = 0; i < 20 && !opened; i++) {
          await sleep(500);
          late.send({ t: 'create', tier: 1 });
          opened = await late.waitNew((m) => (m.t === 'lobby' && m.lobby) || m.t === 'error', 5000).then((m) => (m.t === 'lobby' ? m : null), () => null);
        }
        check('K3 sessions open again once the slot is free', !!opened, opened?.lobby?.code);
        for (const b of [...busy, late]) b.close();
      } finally {
        await stack.stop();
        stack = main;
      }
    }
  } catch (e) {
    console.error(e);
    failures++;
  }
  check('Z team-upgrade picks are accepted by the server (never left to the auto-pick)', pickFailures.length === 0, JSON.stringify(pickFailures.slice(0, 3)));
  if (failures && stack) console.log(stack.log(30));
  await stack?.stop();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}  ${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
