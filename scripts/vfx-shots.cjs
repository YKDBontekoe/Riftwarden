// Visual check of destruction/VFX: damage states, mechanical fragmentation, explosion styles, tower assembly.
// Needs vite on :5173.  node scripts/vfx-shots.cjs   (screenshots in $E2E_OUT, default OS temp dir)
const H = require('./lib/harness.cjs');
const { ev, launch } = H;

async function settle(p) {
  for (let i = 0; i < 40; i++) {
    const ok = await ev(p, () => { window.__rift.render(1); return !!window.__rift.game.scene.environmentTexture; });
    if (ok) break;
    await p.waitForTimeout(500);
  }
}
/** Render a few frames with idle gaps (SwiftShader compiles shaders asynchronously), then capture. */
async function snap(p, name, dt = 0) {
  for (let i = 0; i < 3; i++) {
    await ev(p, () => window.__rift.render(1));
    await p.waitForTimeout(150);
  }
  if (dt) await ev(p, (d) => { window.__rift.advance(d); window.__rift.render(1); }, dt);
  await p.screenshot({ path: `${H.OUT}/vfx-${name}.png`, timeout: 120000 });
  console.log('shot', `${H.OUT}/vfx-${name}.png`);
}

(async () => {
  const { b, p, errs } = await launch({ skipUpgrades: true });
  const results = {};
  try {
    await ev(p, async () => { await window.__rift.flow.devDeploy(1); });
    await p.waitForFunction(() => window.__rift.state().location === 'arena' && !window.__rift.state().busy, null, { timeout: 180000 });
    await settle(p);
    await ev(p, () => { window.__rift.stopLoop(); const g = window.__rift.game; if (g.tut) g.tut.update(0, true); });

    const want = H.sectionFilter();
    if (want('A')) {
    // A: wounded walkers (smoke -> sparks -> fire) seen from ~9 m.
    results.wounds = await ev(p, () => {
      const R = window.__rift, g = R.game;
      const list = [R.dev.spawn('walker'), R.dev.spawn('walker'), R.dev.spawn('bulwark')];
      R.advance(2.4);
      list[0].hp = list[0].maxHp * 0.5;
      list[1].hp = list[1].maxHp * 0.3;
      list[2].hp = list[2].maxHp * 0.12;
      for (const e of list) e.speedMult = 0;
      for (let i = 0; i < 40; i++) {
        R.advance(1 / 60);
        R.render(1);
      }
      const c = list[1].center();
      // Stand 9 m from the pack on the reactor side (always open ground).
      const l = Math.hypot(c.x, c.z) || 1;
      R.teleport(c.x - (c.x / l) * 9, c.z - (c.z / l) * 9);
      R.advance(1 / 60);
      const eye = g.player.eye;
      R.look(Math.atan2(c.x - eye.x, c.z - eye.z), 0.05);
      return { smolder: g.fx.smolder.active };
    });
    await snap(p, 'wounds');

    // B: kill them through the real pipeline; capture the wreck burst and the flying pieces.
    results.shatter = await ev(p, () => {
      const R = window.__rift, g = R.game;
      for (const e of [...g.enemies.active]) g.director.deal({ target: e, amount: e.hp + e.shield + 10, element: 'kinetic', source: { kind: 'player' }, chain: g.director.bus.newChain(), point: e.center(), from: g.player.eye });
      R.advance(0.62);
      return { pieces: g.fx.fragments.count, dying: g.enemies.dyingCount };
    });
    await snap(p, 'shatter-0');
    await ev(p, () => window.__rift.advance(0.25));
    await snap(p, 'shatter-1');
    results.after = await ev(p, () => { const g = window.__rift.game; window.__rift.advance(5); return { pieces: g.fx.fragments.count, smolder: g.fx.smolder.active }; });

    }
    // C: explosion styles side by side.
    for (const style of ['fire', 'plasma', 'electric', 'cryo', 'heavy']) {
      await ev(p, (st) => {
        const R = window.__rift, g = R.game;
        R.advance(3);
        const eye = g.player.eye;
        const f = g.player.camera.getForwardRay(1).direction;
        const at = eye.add(f.scale(9));
        at.y = 1.2;
        g.fx.reset();
        g.fx.explode(at, { scale: 1.3, debris: 10, style: st === 'fire' ? undefined : st });
        // Particles only age while rendering: step simulation and rendering together.
        for (let i = 0; i < (st === 'heavy' ? 26 : 14); i++) {
          R.advance(1 / 60);
          R.render(1);
        }
      }, style);
      await snap(p, `style-${style}`);
    }

    // D: tower assembly stages.
    await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.advance(4);
      R.look(g.player.yaw, 0.15);
      R.advance(1 / 60);
      const eye = g.player.eye;
      const f = g.player.camera.getForwardRay(1).direction;
      const V = eye.constructor;
      const t = g.turrets.add(new V(eye.x + f.x * 7, 0, eye.z + f.z * 7), 0, g.turretCtx, g.buildConfig);
      window.__tw = t;
      R.advance(0.2);
    });
    await snap(p, 'tower-0');
    await ev(p, () => window.__rift.advance(0.3));
    await snap(p, 'tower-1');
    await ev(p, () => window.__rift.advance(0.8));
    await snap(p, 'tower-2');
    results.tower = await ev(p, () => ({ building: window.__tw.building, y: window.__tw.rig.root.position.y, s: window.__tw.rig.root.scaling.y }));
    console.log(JSON.stringify(results));
    console.log('errors', errs.slice(0, 5));
  } finally {
    await b.close();
  }
})();
