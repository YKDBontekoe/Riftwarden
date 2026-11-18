// Polish milestone acceptance suite: hit flash, wreck deaths, mood, HQ ambience. Needs vite on :5173.
const H = require('./lib/harness.cjs');
const { check, ev, launch, shot, S } = H;

async function deploy(p, tier = 1) {
  await ev(p, (t) => { const R = window.__rift; R.flow.skipUpgrades = true; return R.dev.deploy(t); }, tier);
  await p.waitForFunction(() => window.__rift.state().location === 'arena', null, { timeout: 120000 });
  await ev(p, () => window.__rift.advance(0.5));
}

(async () => {
  const { b, p, errs } = await launch({ skipUpgrades: true });
  const want = H.sectionFilter();
  try {
    if (want('A')) {
      await deploy(p);
      const r = await ev(p, () => {
        const R = window.__rift;
        const e = R.dev.spawn('walker');
        R.advance(0.2);
        const en = R.game.enemies.active[0];
        const vecs = [];
        for (const m of en.root.getChildMeshes(false)) if (m.instancedBuffers && m.instancedBuffers.instanceFlash) vecs.push(m.instancedBuffers.instanceFlash);
        R.game.damageEnemy('player', en, 5, en.center(), false);
        const afterHit = vecs.length ? vecs[0].w : -1;
        R.advance(0.5);
        const afterDecay = vecs.length ? vecs[0].w : -1;
        return { n: vecs.length, afterHit, afterDecay, spawned: !!e };
      });
      check('A1 walker parts carry a flash buffer', r.n > 10, `parts=${r.n}`);
      check('A2 damage raises flash', r.afterHit > 0.5, `w=${r.afterHit}`);
      check('A3 flash decays to 0', r.afterDecay === 0, `w=${r.afterDecay}`);
      await ev(p, () => { const R = window.__rift; const en = R.game.enemies.active[0]; R.approach(en.id ?? 0); R.advance(1 / 60); R.game.damageEnemy('player', en, 5, en.center(), false); });
      await shot(p, 'polish-flash', { frames: 2 });
    }
    if (want('B')) {
      await deploy(p);
      const r = await ev(p, () => {
        const R = window.__rift;
        const out = {};
        for (const kind of ['walker', 'rusher', 'bulwark']) {
          R.dev.spawn(kind);
          R.advance(0.1);
          const en = R.game.enemies.active.find((x) => x.kind === kind);
          const before = R.game.enemies.active.length;
          R.game.damageEnemy('player', en, 1e6, en.center(), false);
          const o = { dying: R.game.enemies.dyingCount, active: R.game.enemies.active.length - before };
          R.advance(0.3);
          o.midRot = Math.abs(en.root.rotation.x) + Math.abs(en.root.rotation.z);
          o.midFlash = en.hitFlash;
          R.advance(1.2);
          o.after = R.game.enemies.dyingCount;
          o.rotReset = en.root.rotation.x === 0 && en.root.rotation.z === 0;
          out[kind] = o;
        }
        return out;
      });
      for (const [k, o] of Object.entries(r)) {
        check(`B1 ${k} enters a wreck on kill (out of play)`, o.dying === 1 && o.active === -1, JSON.stringify(o));
        check(`B2 ${k} collapses (tilts, flickers)`, o.midRot > 0.05 && o.midFlash > 0, `rot=${o.midRot.toFixed(2)} flash=${o.midFlash.toFixed(2)}`);
        check(`B3 ${k} wreck is released and tilt reset`, o.after === 0 && o.rotReset);
      }
    }
    if (want('C')) {
      await deploy(p);
      const r = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const snap = () => ({ d: g.scene.fogDensity, lum: g.scene.fogColor.r + g.scene.fogColor.g + g.scene.fogColor.b, exp: g.post.pipeline.imageProcessing.exposure });
        R.advance(3);
        const calm = snap();
        R.dev.spawn('colossus');
        R.advance(5);
        const boss = snap();
        R.killAll();
        R.advance(12);
        const after = snap();
        return { calm, boss, after };
      });
      check('C1 boss raises fog density', r.boss.d > r.calm.d * 1.15, `${r.calm.d.toFixed(4)} -> ${r.boss.d.toFixed(4)}`);
      check('C2 boss darkens fog and exposure', r.boss.lum < r.calm.lum - 0.1 && r.boss.exp < r.calm.exp, `lum ${r.calm.lum.toFixed(2)} -> ${r.boss.lum.toFixed(2)}`);
      check('C3 mood recovers after the boss dies', Math.abs(r.after.d - r.calm.d) < r.calm.d * 0.05, `${r.after.d.toFixed(4)}`);
    }
    if (want('D')) {
      await ev(p, async () => { const R = window.__rift; await R.flow.enterHq(); });
      await p.waitForFunction(() => window.__rift.state().location === 'home' && !window.__rift.state().busy, null, { timeout: 120000 });
      await ev(p, () => { const R = window.__rift; if (R.state().screen !== 'home') R.home.takeControl(false); R.advance(0.3); });
      const r = await ev(p, async () => {
        const R = window.__rift;
        const h = R.home;
        const cam = h.player.camera;
        R.advance(0.5);
        const before = { x: cam.position.x, z: cam.position.z, ry: cam.rotation.y };
        h.openTerminal('deploy');
        R.advance(1);
        const opened = { x: cam.position.x, z: cam.position.z, ry: cam.rotation.y, dolly: h.focus.dolly };
        await h.closeTerminal();
        R.advance(1.5);
        return { before, opened, closed: { dolly: h.focus.dolly, ry: cam.rotation.y, yaw: h.player.yaw }, screen: R.state().screen };
      });
      const moved = Math.hypot(r.opened.x - r.before.x, r.opened.z - r.before.z);
      check('D1 opening a terminal pushes the camera in', r.opened.dolly > 0.9 && moved > 0.05, `dolly=${r.opened.dolly.toFixed(2)} moved=${moved.toFixed(2)}`);
      check('D2 closing returns to the exact view', r.closed.dolly === 0 && Math.abs(r.closed.ry - r.closed.yaw) < 0.03, JSON.stringify(r.closed));
    }
  } catch (e) {
    check('suite ran without exception', false, String(e && e.stack || e).slice(0, 400));
  }
  const bad = errs.filter((e) => !/favicon/.test(e));
  check('no page errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  console.log(`\n${H.stats.passes} passed, ${H.stats.failures} failed`);
  await b.close();
  process.exit(H.stats.failures ? 1 : 0);
})();
