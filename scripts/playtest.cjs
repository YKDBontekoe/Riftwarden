// Bot playtest: plays a real run (aims, fires, strafes, dashes, jumps, picks upgrades, skips prep)
// and reports pacing metrics per wave plus screenshots. Needs vite on :5173.
//   node scripts/playtest.cjs [waves=6] [shots=1]
const H = require('./lib/harness.cjs');
const { ev, launch } = H;

const WAVES = Number(process.argv[2] || 6);
const SHOTS = process.argv[3] !== '0';

const BOT = () => {
  const R = window.__rift;
  const st = {
    t: 0, frame: 0, strafe: 1, strafeT: 0, dashT: 1.5, jumpT: 2.5, waves: [], cur: null,
    idleWithEnemies: 0, noTarget: 0, distSum: 0, distN: 0, shotFrames: 0, hits0: 0, minHp: 999,
    speeds: [], deaths: 0, lastAlive: true,
  };
  const keys = new Set();
  const key = (code, down) => {
    const g = R.game;
    if (down && !keys.has(code)) { g.input.simulateKey(code, true); keys.add(code); }
    if (!down && keys.has(code)) { g.input.simulateKey(code, false); keys.delete(code); }
  };
  const tap = (code) => { R.game.input.simulateKey(code, true); keys.add(code); };
  function pickTarget(g) {
    const eye = g.player.eye;
    let best = null, bd = 1e9;
    for (const e of g.enemies.active) {
      const c = e.center();
      const d = Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z);
      const score = d + (g.los(eye, c) ? 0 : 60);
      if (score < bd) { bd = score; best = e; }
    }
    return best;
  }
  function step() {
    const g = R.game;
    if (!g) return;
    const dt = 1 / 60;
    st.t += dt;
    st.frame++;
    // release tapped keys from last frame
    for (const k of ['Space', 'ShiftLeft', 'KeyG']) key(k, false);
    const scr = R.state().screen;
    if (scr === 'upgrade' && g.offer) { g.chooseUpgrade(g.offer[0].id); }
    else if (scr === 'checkpoint') { void g.continueRun(); }
    else if (scr === 'paused') { void g.resume(); }
    const phase = g.waves.phase;
    const n = g.waves.number;
    if (phase === 'combat' && (!st.cur || st.cur.n !== n)) {
      st.cur = { n, start: st.t, kills0: g.kills, firstContact: null, clear: null, spawns: g.waves.wave.spawns.length, peakAlive: 0, hp0: g.reactorHp };
      st.waves.push(st.cur);
    }
    if (st.cur && st.cur.n === n && phase === 'combat') st.cur.peakAlive = Math.max(st.cur.peakAlive, g.enemies.active.length);
    if (st.cur && st.cur.clear == null && phase !== 'combat') { st.cur.clear = st.t - st.cur.start; st.cur.kills = g.kills - st.cur.kills0; st.cur.reactorLoss = st.cur.hp0 - g.reactorHp; }
    if (phase === 'prep' && scr === 'playing') {
      if (window.__botSpots && g.turrets.turrets.length < 8) {
        const cost = g.nextTowerCost;
        while (g.wallet.cores >= cost && g.turrets.turrets.length < 8 && window.__botSpots.length) {
          const [x, z] = window.__botSpots.shift();
          g.wallet.spend(cost);
          g.turrets.add(new g.player.position.constructor(x, 0, z), Math.atan2(-x, -z), g.turretCtx, g.buildConfig).paid = cost;
        }
      }
      tap('KeyG');
    }
    const p = g.player;
    if (!p.alive && st.lastAlive) st.deaths++;
    st.lastAlive = p.alive;
    st.minHp = Math.min(st.minHp, p.hp);
    const tgt = pickTarget(g);
    let fire = false;
    let fz = 0;
    if (tgt) {
      const c = tgt.center();
      const eye = p.eye;
      const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
      const h = Math.hypot(dx, dz);
      const d = Math.hypot(h, dy);
      const yaw = Math.atan2(dx, dz);
      const pitch = -Math.atan2(dy, h);
      // smooth aim like a human (fast but not instant)
      let dyaw = yaw - p.yaw;
      while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
      while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      p.yaw += dyaw * 0.35;
      p.pitch += (pitch - p.pitch) * 0.35;
      fire = Math.abs(dyaw) < 0.12 && g.los(eye, c) && d < g.weapon.def.range;
      if (st.cur && st.cur.firstContact == null && g.los(eye, c) && d < 60) st.cur.firstContact = st.t - st.cur.start;
      st.distSum += d; st.distN++;
      fz = d > 22 ? 1 : d < 9 ? -1 : 0;
      if (!fire && phase === 'combat') st.idleWithEnemies += dt;
    } else if (phase === 'combat') st.noTarget += dt;
    if (fire) st.shotFrames++;
    g.input.simulateMouse(0, fire);
    st.strafeT -= dt;
    if (st.strafeT <= 0) { st.strafe = -st.strafe; st.strafeT = 0.8 + Math.random() * 1.2; }
    key('KeyW', fz > 0); key('KeyS', fz < 0);
    key('KeyA', st.strafe < 0); key('KeyD', st.strafe > 0);
    st.dashT -= dt; st.jumpT -= dt;
    if (st.dashT <= 0) { tap('ShiftLeft'); st.dashT = 1.4 + Math.random() * 1.6; }
    if (st.jumpT <= 0) { tap('Space'); st.jumpT = 2 + Math.random() * 2; }
    if (st.frame % 6 === 0) st.speeds.push(p.speed);
    R.advance(dt);
  }
  window.__bot = { st, step, run(sec) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) step(); } };
};

(async () => {
  const { b, p, errs } = await launch({ viewport: { width: 1280, height: 720 } });
  try {
    await ev(p, async ({ proc, seed }) => {
      const R = window.__rift;
      // ARENA=procedural plays a generated sector (seed ARENA_SEED, default random) instead of the classic arena.
      if (proc) {
        R.flow.arenaMode = 'procedural';
        R.flow.nextArenaSeed = seed || null;
      }
      await R.flow.devDeploy(1);
    }, { proc: process.env.ARENA === 'procedural', seed: Number(process.env.ARENA_SEED || 0) });
    await p.waitForFunction(() => window.__rift.state().location === 'arena' && !window.__rift.state().busy, null, { timeout: 180000 });
    await ev(p, BOT);
    if (process.env.BOT_TOWERS !== '0') await ev(p, async () => {
      const { validatePlacement } = await import('/@id/@riftwarden/rules/defense/placement');
      const ARENA = window.__rift.game.layout;
      const dist = (x, z, pts) => { let b = 1e9; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], c = pts[i]; const dx = c.x - a.x, dz = c.z - a.z; const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz))); b = Math.min(b, Math.hypot(a.x + dx * t - x, a.z + dz * t - z)); } return b; };
      const spots = [];
      for (let x = -15; x <= 15; x += 1.5) for (let z = -15; z <= 15; z += 1.5) {
        const r = validatePlacement(ARENA, { x, y: 0, z, surface: 'floor', normalY: 1, footprintHeights: [0], radius: 1.1, playerX: x, playerZ: z, maxRange: 99, cores: 1e9, cost: 1, towers: spots.map(([sx, sz]) => ({ x: sx, z: sz, radius: 3 })) });
        if (r !== 'ok') continue;
        const near = Math.min(...['north', 'east', 'west'].map((g) => dist(x, z, ARENA.routes[g].points)));
        if (near < 5.5) spots.push([x, z]);
      }
      window.__botSpots = spots.sort(() => Math.random() - 0.5);
      return spots.length;
    });
    await ev(p, () => { const g = window.__rift.game; g.input.forceCapture = true; if (g.tut) g.tut.update?.(0, true); });
    const t0 = Date.now();
    let shotN = 0;
    for (let i = 0; i < 400; i++) {
      const s = await ev(p, () => { window.__bot.run(2); const g = window.__rift.game; return { n: g.waves.number, phase: g.waves.phase, alive: g.enemies.active.length, screen: window.__rift.state().screen, waves: window.__bot.st.waves.length, t: window.__bot.st.t, reactor: g.reactorHp }; });
      if (SHOTS && i % 6 === 3 && shotN < 8) {
        await ev(p, () => window.__rift.render(2));
        await p.screenshot({ path: `${H.OUT}/play-${String(shotN).padStart(2, '0')}.png`, timeout: 120000 });
        shotN++;
      }
      if (s.screen === 'defeat' || (s.n > WAVES && s.phase !== 'combat')) { console.log('end', JSON.stringify(s)); break; }
      if (i % 10 === 0) console.log(JSON.stringify(s));
    }
    const r = await ev(p, () => {
      const st = window.__bot.st;
      const sp = st.speeds.slice().sort((a, b) => a - b);
      return {
        simTime: st.t.toFixed(1),
        waves: st.waves.map((w) => ({ n: w.n, spawns: w.spawns, firstContact: w.firstContact?.toFixed(1), clear: w.clear?.toFixed(1), kills: w.kills, peak: w.peakAlive, reactorLoss: Math.round(w.reactorLoss ?? 0) })),
        idleWithEnemies: st.idleWithEnemies.toFixed(1), noTarget: st.noTarget.toFixed(1), meanDist: (st.distSum / Math.max(1, st.distN)).toFixed(1),
        fireFrac: (st.shotFrames / st.frame).toFixed(2), minHp: Math.round(st.minHp), deaths: st.deaths,
        speedP50: sp[Math.floor(sp.length / 2)]?.toFixed(1), speedP90: sp[Math.floor(sp.length * 0.9)]?.toFixed(1),
        frameMs: window.__rift.game.frameMs.toFixed(2),
      };
    });
    console.log(JSON.stringify(r, null, 1));
    console.log('wall', ((Date.now() - t0) / 1000).toFixed(0), 's; errors:', errs.slice(0, 5));
  } finally {
    await b.close();
  }
})();
