// Close-up captures of combat feel (kill pop, wreck knock-back, chain counter, merged numbers, fast gait).
// Needs vite on :5173.  node scripts/feel-shots.cjs
const H = require('./lib/harness.cjs');
const { ev, launch } = H;
(async () => {
  const { b, p, errs } = await launch({ skipUpgrades: true });
  try {
    await ev(p, async () => { await window.__rift.flow.devDeploy(1); });
    await p.waitForFunction(() => window.__rift.state().location === 'arena' && !window.__rift.state().busy, null, { timeout: 180000 });
    for (let i = 0; i < 40; i++) {
      const ok = await ev(p, () => { window.__rift.render(1); return !!window.__rift.game.scene.environmentTexture; });
      if (ok) break;
      await p.waitForTimeout(500);
    }
    // Gait: a walker on the north lane, seen from the side at ~8 m.
    const gait = await ev(p, () => {
      const R = window.__rift, g = R.game;
      if (g.tut) g.tut.update(0, true);
      const e = R.dev.spawn('walker');
      R.advance(2.4);
      const c = e.center();
      R.teleport(c.x + 7, c.z - 3);
      R.advance(1 / 60);
      const eye = g.player.eye;
      R.look(Math.atan2(c.x - eye.x, c.z - eye.z), 0.12);
      return { x: c.x, z: c.z, speed: e.def.speed };
    });
    for (let i = 0; i < 3; i++) {
      await ev(p, () => { window.__rift.advance(0.06); window.__rift.render(1); });
      await p.screenshot({ path: `${H.OUT}/feel-gait-${i}.png`, timeout: 120000 });
    }
    // Kill sequence: a pack of walkers in front of the drone, killed one after another by the real weapon.
    await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.killAll();
      R.advance(1);
      for (let i = 0; i < 5; i++) R.dev.spawn('walker');
      R.advance(2.2);
      const e = g.enemies.active[0];
      const c = e.center();
      R.teleport(c.x - 4, c.z - 11);
      R.advance(1 / 60);
    });
    let n = 0;
    for (let step = 0; step < 90 && n < 6; step++) {
      const r = await ev(p, () => {
        const R = window.__rift, g = R.game;
        const alive = g.enemies.active.filter((x) => x.alive);
        if (!alive.length) return { done: true };
        const e = alive[0];
        const c = e.center();
        const eye = g.player.eye;
        R.look(Math.atan2(c.x - eye.x, c.z - eye.z), -Math.atan2(c.y + 0.9 - eye.y, Math.hypot(c.x - eye.x, c.z - eye.z)));
        g.input.simulateMouse(0, true);
        const k0 = g.kills;
        R.advance(1 / 20);
        return { kill: g.kills > k0, chain: g.player.chain, dash: g.player.dashCharges };
      });
      if (r.done) break;
      if (r.kill) {
        await ev(p, () => { window.__rift.advance(1 / 30); window.__rift.render(1); });
        await p.screenshot({ path: `${H.OUT}/feel-kill-${n}.png`, timeout: 120000 });
        console.log('kill', n, JSON.stringify(r));
        n++;
      }
    }
    await ev(p, () => window.__rift.game.input.simulateMouse(0, false));
    console.log('gait', JSON.stringify(gait), 'errors', errs.slice(0, 3));
  } finally {
    await b.close();
  }
})();
