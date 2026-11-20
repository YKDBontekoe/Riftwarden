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
      R.advance(1.0);
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
      return { v0, v1, through, navV: e.navV, building: t.building, blocking: t.blocking, screen: g.screen, phase: g.waves.phase, hostile: g.tactical.hostileScale };
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
      for (let i = 0; i < 60 * 20 && !g.enemies.active.some((x) => x.kind === 'walker' && x.alive && x.state === 'move'); i++) R.advance(1 / 60);
      const e = g.enemies.active.find((x) => x.kind === 'walker' && x.alive && x.state === 'move');
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
      }
      // Pin the walker's path straight through the tower (as a sealed maze would), then let it walk.
      const pin = () => {
        const ux = t.pos.x - e.pos.x;
        const uz = t.pos.z - e.pos.z;
        const ul = Math.hypot(ux, uz) || 1;
        e.path = [{ x: e.pos.x, z: e.pos.z }, { x: t.pos.x + (ux / ul) * 6, z: t.pos.z + (uz / ul) * 6 }];
        e.seg = 1;
        e.navV = g.enemies.nav.ground.version;
      };
      pin();
      const hp0 = t.hp;
      let wrecked = false;
      for (let i = 0; i < 60 * 40 && !wrecked; i++) {
        R.advance(1 / 60);
        if (e.navV !== g.enemies.nav.ground.version) pin();
        wrecked = t.wrecked;
        if (!e.alive) break;
        // Keep the walker alive (the tower shoots it) so the breach plays out.
        e.hp = e.maxHp;
      }
      const breaches = g.enemies.nav.breaches;
      window.__dbgD = { alive: e.alive, state: e.state, d: Math.hypot(e.pos.x - t.pos.x, e.pos.z - t.pos.z), seg: e.seg, len: e.path.length, kind: e.kind, building: t.building, path: e.path };
      const wreckedAt = t.wrecked;
      const blockingWreck = t.blocking;
      // Repair between waves: force the phase check open via tactical-free prep state.
      g.wallet.earn(1000);
      g.tactical.energy = 100;
      if (g.waves.phase === 'combat') g.tactical.toggle();
      const why = g.wear.repair(t);
      return { hp0, breaches, wrecked: wreckedAt, blockingWreck, why, after: { hp: t.hp, max: t.maxHp, wrecked: t.wrecked } };
    });
    console.log(JSON.stringify(await p.evaluate(() => window.__dbgD)));
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
