// Procedural arenas + loading screens (browser suite).
//   A loading screen: sector briefing with map, stages, tip while deploying; HQ recovery screen on return
//   B generated arena: size, determinism by seed, rifts, collision at the spawn, no shader/page errors
//   C enemies: spawns from gates and forward rifts, ground paths re-plan when a tower lands on the lane
//   D breaching: a sealed lane makes walkers hit a tower until it is wrecked; repair restores it
//   V screenshots (loading screen, overview)
// Usage: node scripts/e2e-arenas.cjs [A,B,...]   (dev server on :5173)
const { launch, check, stats, waitFor, shot, OUT, sectionFilter } = require('./lib/harness.cjs');

const want = sectionFilter();

async function deploy(p, seed) {
  await p.evaluate((s) => {
    const f = window.__rift.flow;
    f.arenaMode = 'procedural';
    f.nextArenaSeed = s;
    f.skipUpgrades = true;
    window.__loadSeen = [];
    const off = setInterval(() => {
      const el = document.querySelector('[data-testid="loading-screen"]');
      if (el) window.__loadSeen.push({ card: !!el.querySelector('.ls-card'), map: el.querySelectorAll('.lm rect').length, rifts: el.querySelectorAll('.lm-rift').length, stages: el.querySelectorAll('.ls-stages li').length, tip: el.querySelector('.ls-tip span')?.textContent ?? '', name: el.querySelector('.ls-name')?.textContent ?? '' });
    }, 30);
    window.__loadOff = off;
    return f.deploy(1);
  }, seed);
  await waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.state().busy && window.__rift.game);
  await p.evaluate(() => clearInterval(window.__loadOff));
}

(async () => {
  const { b, p, errs } = await launch({ skipUpgrades: true });
  p.setDefaultTimeout(180000);
  await p.evaluate(() => window.__rift.flow.enterHq?.());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);

  // Capture a frame of the loading screen mid-transition (the scene build blocks; the overlay is already painted).
  if (want('V')) {
    await p.evaluate(() => {
      const f = window.__rift.flow;
      f.arenaMode = 'procedural';
      f.nextArenaSeed = 424242;
      window.__rift.hud?.set?.({});
    });
  }

  await deploy(p, 424242);
  const seen = await p.evaluate(() => window.__loadSeen);
  const s0 = await p.evaluate(() => {
    const g = window.__rift.game;
    const L = g.layout;
    return { half: L.half, seed: L.seed, name: L.name, rifts: L.rifts.length, mazing: !!L.mazing, nav: !!g.enemies.nav, anchors: g.arenaVisuals.rifts ? g.arenaVisuals.rifts.count : 0, json: JSON.stringify({ b: L.boxes, r: L.routes }) };
  });

  if (want('A')) {
    const withCard = seen.filter((x) => x.card);
    check('A1 loading screen shown during deployment', seen.length > 0, `${seen.length} samples`);
    check('A2 sector card with name + stats', withCard.length > 0 && withCard[0].name === s0.name, withCard[0]?.name);
    check('A3 map preview draws the generated layout', withCard.some((x) => x.map > 20 && x.rifts === s0.rifts), `rects ${withCard[0]?.map} rifts ${withCard[0]?.rifts}`);
    check('A4 four loading stages + a tip', withCard.some((x) => x.stages === 4 && x.tip.length > 10));
  }

  if (want('B')) {
    check('B1 generated arena is large (half >= 84)', s0.half >= 84, `half ${s0.half}`);
    check('B2 forced seed used + mazing + navigator', s0.seed === 424242 && s0.mazing && s0.nav);
    check('B3 forward rifts rendered', s0.rifts >= 4 && s0.anchors === s0.rifts, `${s0.rifts} rifts`);
    // The drone stands on the floor at the spawn (collider exists) after settling.
    const y = await p.evaluate(() => {
      window.__rift.advance(1.2);
      return window.__rift.game.player.position.y;
    });
    check('B4 drone rests on the generated floor', y > 0.3 && y < 2.5, `y ${y.toFixed(2)}`);
  }

  if (want('C')) {
    const r = await p.evaluate(() => {
      const R = window.__rift;
      const g = R.game;
      g.input.simulateKey('KeyG', true);
      R.advance(1 / 60);
      g.input.simulateKey('KeyG', false);
      const H = g.layout.half;
      let rift = 0;
      let gate = 0;
      const seen = new Set();
      for (let i = 0; i < 60 * 14; i++) {
        R.advance(1 / 60);
        for (const e of g.enemies.active) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          const p0 = e.path[0];
          if (Math.max(Math.abs(p0.x), Math.abs(p0.z)) < H - 2) rift++;
          else gate++;
        }
      }
      const walker = g.enemies.active.find((e) => e.kind === 'walker' && e.alive);
      return { rift, gate, phase: g.waves.phase, walker: walker ? { id: walker.id, x: walker.pos.x, z: walker.pos.z, r: walker.remaining } : null };
    });
    check('C1 enemies spawn from forward rifts and gates', r.rift > 0 && r.gate > 0, `rift ${r.rift} gate ${r.gate}`);
    // Drop a tower on a walker's current path ahead of it: its path re-plans around it.
    const c2 = await p.evaluate(() => {
      const R = window.__rift;
      const g = R.game;
      const e = g.enemies.active.find((x) => x.kind === 'walker' && x.alive && x.path.length > x.seg + 1);
      if (!e) return null;
      const a = e.path[e.seg];
      const v0 = g.enemies.nav.ground.version;
      const V = g.player.position.constructor;
      // Midpoint of the enemy's next segment
      const mx = (e.pos.x + a.x) / 2;
      const mz = (e.pos.z + a.z) / 2;
      const t = g.turrets.add(new V(mx, 0, mz), 0, g.turretCtx, g.buildConfig);
      R.advance(1.4); // build animation (0.8 s) + one field sync period (0.25 s)
      const v1 = g.enemies.nav.ground.version;
      let through = false;
      for (let i = e.seg; i < e.path.length; i++) {
        const p0 = i === e.seg ? e.pos : e.path[i - 1];
        const p1 = e.path[i];
        for (let k = 0; k <= 20; k++) {
          const x = p0.x + (p1.x - p0.x) * (k / 20);
          const z = p0.z + (p1.z - p0.z) * (k / 20);
          if (Math.hypot(x - t.pos.x, z - t.pos.z) < t.radius) through = true;
        }
      }
      // Nobody defends the reactor in this suite: clear the field and top it up so later sections run on a live game.
      const result = { v0, v1, through, navV: e.navV, building: t.building, blocking: t.blocking, phase: g.waves.phase, pos: [t.pos.x, t.pos.y, t.pos.z], n: g.turrets.turrets.length, resync: g.enemies.nav.sync(), v2: g.enemies.nav.ground.version };
      R.killAll();
      g.reactorHp = Math.max(g.reactorHp, 600);
      return result;
    });
    check('C2 tower on a lane re-plans enemy paths around it', !!c2 && c2.v1 > c2.v0 && !c2.through, JSON.stringify(c2));
  }

  if (want('D')) {
    const d = await p.evaluate(() => {
      const R = window.__rift;
      const g = R.game;
      const V = g.player.position.constructor;
      // Breach check through the navigator directly: a tower right in front of a walker.
      if (g.waves.phase !== 'combat') {
        g.input.simulateKey('KeyG', true);
        R.advance(1 / 60);
        g.input.simulateKey('KeyG', false);
      }
      // Earlier sections may leave the wave cleared on an upgrade/checkpoint screen: back to live play.
      if (g.screen !== 'playing') g.setScreen('playing');
      // A fresh walker (marks the run as a dev session, which is fine here): far from the reactor, still moving.
      const e = R.dev.spawn('walker', [], 'east');
      R.advance(0.5);
      if (!e) return null;
      const a = e.path[Math.min(e.seg, e.path.length - 1)];
      const dx = a.x - e.pos.x;
      const dz = a.z - e.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      // Hold the walker while the tower finishes its build animation.
      const hold = { x: e.pos.x, z: e.pos.z };
      const t = g.turrets.add(new V(e.pos.x + (dx / l) * 4, 0, e.pos.z + (dz / l) * 4), 0, g.turretCtx, g.buildConfig);
      for (let i = 0; i < 60; i++) {
        R.advance(1 / 60);
        e.pos.x = hold.x;
        e.pos.z = hold.z;
        e.hp = e.maxHp; // towers would shoot it during the hold (and the pool would recycle the object)
      }
      // Pin the walker's path straight through the tower (as a sealed maze would), then let it walk. Re-pin whenever
      // the navigator re-plans it (field changes as the tower finishes building).
      let pinned = null;
      const pin = () => {
        const ux = t.pos.x - e.pos.x;
        const uz = t.pos.z - e.pos.z;
        const ul = Math.hypot(ux, uz) || 1;
        e.path = [{ x: e.pos.x, z: e.pos.z }, { x: t.pos.x + (ux / ul) * 6, z: t.pos.z + (uz / ul) * 6 }];
        pinned = e.path;
        e.seg = 1;
        e.navV = g.enemies.nav.ground.version;
      };
      pin();
      const hp0 = t.hp;
      let wrecked = false;
      for (let i = 0; i < 60 * 40 && !wrecked; i++) {
        R.advance(1 / 60);
        if (e.path !== pinned) pin();
        wrecked = t.wrecked;
        if (!e.alive) break;
        // Keep the walker alive (the tower shoots it) and the reactor standing, so the breach plays out.
        e.hp = e.maxHp;
        g.reactorHp = Math.max(g.reactorHp, 300);
      }
      const breaches = g.enemies.nav.breaches;
      window.__dbgD = { screen: g.screen, phase: g.waves.phase, tac: g.tactical.hostileScale, pos: [e.pos.x, e.pos.z], t: [t.pos.x, t.pos.z], alive: e.alive, state: e.state, d: Math.hypot(e.pos.x - t.pos.x, e.pos.z - t.pos.z), seg: e.seg, len: e.path.length, kind: e.kind, building: t.building, path: e.path };
      const wreckedAt = t.wrecked;
      const blockingWreck = t.blocking;
      // Repair between waves: force the phase check open via tactical-free prep state.
      g.wallet.earn(1000);
      g.tactical.energy = 100;
      if (g.waves.phase === 'combat') g.tactical.toggle();
      const why = g.wear.repair(t);
      return { hp0, breaches, wrecked: wreckedAt, blockingWreck, why, after: { hp: t.hp, max: t.maxHp, wrecked: t.wrecked } };
    });
    check('D1 walker breaches a blocking tower until it is wrecked', !!d && d.breaches > 0 && d.wrecked, JSON.stringify(d && { breaches: d.breaches, wrecked: d.wrecked, hp0: d.hp0 }));
    check('D2 wrecks do not block', !!d && d.blockingWreck === false);
    check('D3 repair restores a wreck to full', !!d && d.why === null && !d.after.wrecked && d.after.hp === d.after.max, JSON.stringify(d && { why: d.why, ...d.after }));
  }

  if (want('V')) {
    await p.evaluate(() => {
      const R = window.__rift;
      const g = R.game;
      g.player.camera.position.set(-40, 70, -70);
      g.player.camera.setTarget(new g.player.position.constructor(0, 0, 0));
    });
    await waitFor(p, () => !!window.__rift.game.scene.environmentTexture, null, 120000).catch(() => {});
    await shot(p, 'arenas-overview', { frames: 2, timeout: 240000 });
    console.log(`screenshot ${OUT}/arenas-overview.png`);
    // Ground-level views of set pieces: a maze/chicane wall, a container yard and a bridge.
    const views = await p.evaluate(() => {
      const L = window.__rift.game.layout;
      const run = (b) => Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
      const pick = (k) => L.boxes.filter((b) => b.kind === k).sort((a, b) => run(b) - run(a))[0];
      return ['barrier', 'container', 'bridge'].map((k) => pick(k)).filter(Boolean).map((b) => ({ kind: b.kind, x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2, top: b.max[1] }));
    });
    for (const v of views) {
      await p.evaluate((v) => {
        const g = window.__rift.game;
        const V = g.player.position.constructor;
        const out = Math.hypot(v.x, v.z) || 1;
        g.player.camera.position.set(v.x - (v.x / out) * 12 + 5, v.top + 6, v.z - (v.z / out) * 12 + 5);
        g.player.camera.setTarget(new V(v.x, v.top * 0.5, v.z));
      }, v);
      // SwiftShader compiles shaders asynchronously: let the page idle between renders so new views are complete.
      for (let i = 0; i < 4; i++) {
        await p.evaluate(() => window.__rift.render(1));
        await p.waitForTimeout(1500);
      }
      await shot(p, `arenas-${v.kind}`, { frames: 1, timeout: 400000 });
    }
    for (const [seed, w, h] of [[424242, 1280, 720], [9001, 1280, 720], [777, 390, 844]]) {
      await p.setViewportSize({ width: w, height: h });
      await p.evaluate((sd) => window.__rift.previewLoading(sd, 1), seed);
      await p.waitForTimeout(700);
      await p.screenshot({ path: `${OUT}/loading-${seed}-${w}.png` });
    }
    await p.setViewportSize({ width: 1280, height: 720 });
    await p.evaluate(() => window.__rift.flow.arena && window.__rift.flow.arena.setScreen?.('playing'));
  }

  if (want('E')) {
    // Same seed -> same arena; return home shows the HQ recovery screen.
    await p.evaluate(() => {
      window.__hqSeen = [];
      window.__hqOff = setInterval(() => {
        const el = document.querySelector('[data-testid="loading-screen"]');
        if (el) window.__hqSeen.push(el.className);
      }, 30);
      return window.__rift.flow.abandonRun();
    });
    await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    const hq = await p.evaluate(() => {
      clearInterval(window.__hqOff);
      return window.__hqSeen;
    });
    check('E1 HQ loading screen on return', hq.some((c) => c.includes('load-hq')), hq[0]);
    await p.evaluate(() => window.__rift.state().screen === 'summary' && window.__rift.flow.enterHq?.());
    await deploy(p, 424242);
    const again = await p.evaluate(() => JSON.stringify({ b: window.__rift.game.layout.boxes, r: window.__rift.game.layout.routes }));
    check('E2 same seed rebuilds the identical arena', again === s0.json);
  }

  const bad = errs.filter((e) => !/favicon|DevTools/.test(e));
  check('Z no runtime errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  console.log(`\n${stats.passes} passed, ${stats.failures} failed`);
  await b.close();
  process.exit(stats.failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
