// Movement, camera accessibility and shadows-off presentation regression checks.
// Needs Vite on :5173. Uses the shared Chromium harness; screenshots go to E2E_OUT.
// QA_GRAPHICS=high also captures the high preset (contact fallback is off there).
const H = require('./lib/harness.cjs');
const { check, ev } = H;
const fs = require('node:fs/promises');

(async () => {
  await fs.mkdir(H.OUT, { recursive: true });
  const high = process.env.QA_GRAPHICS === 'high';
  const init = high ? { 'riftwarden.settings': JSON.stringify({ v: 1, data: { quality: 'high', volume: 0, sensitivity: 1, fov: 90 } }) } : null;
  const { b, p, errs } = await H.launch({ skipUpgrades: true, init, diagnostics: 'feel-polish' });
  try {
    await ev(p, () => window.__rift.flow.devDeploy(1));
    await H.waitFor(p, () => window.__rift.game && !window.__rift.state().busy);
    const initialPose = await ev(p, () => {
      const vm = window.__rift.game.weapon.rig.root.parent;
      return { x: vm.position.x, y: vm.position.y, z: vm.position.z };
    });
    check('weapon starts in its hand position before the first simulation tick', initialPose.x > 0 && initialPose.y < 0 && initialPose.z > 0.4, JSON.stringify(initialPose));
    await H.shot(p, 'arena-first-frame', { frames: 2 });
    const camera = await ev(p, () => {
      const R = window.__rift, g = R.game, pl = g.player, input = g.input;
      g.tut?.update(0, true);
      const tap = (code) => { input.simulateKey(code, true); R.advance(1 / 60); input.simulateKey(code, false); };
      const park = () => { input.clear(); pl.reset(); R.teleport(0, -18, 0.95); R.look(0, 0); R.advance(0.2); };
      park();
      input.simulateKey('KeyW', true); R.advance(0.3);
      const run = pl.speed;
      tap('ShiftLeft'); const dash = pl.speed;
      input.clear(); park();
      R.teleport(40, -20, 0.95); R.look(0, 0); R.advance(1 / 60);
      input.simulateKey('KeyD', true); tap('ShiftLeft'); R.advance(0.25);
      const wall = pl.position.x;
      park(); tap('Space'); R.advance(0.1); tap('Space');
      const boost = { y: pl.position.y, up: pl.verticalSpeed, available: pl.airBoost };
      park();
      pl.reduceMotion = false;
      input.simulateKey('KeyD', true); tap('ShiftLeft'); R.advance(0.06);
      pl.addTrauma(1); pl.punch(0.05, 0.04);
      const normalRoll = Math.abs(pl.camera.rotation.z);
      // Turn the setting on while the dash, lens punch and shake are in flight.
      pl.reduceMotion = true;
      let maxRoll = 0, maxFov = 0, maxOffset = 0, maxShake = 0;
      for (let i = 0; i < 50; i++) {
        R.advance(1 / 60);
        maxRoll = Math.max(maxRoll, Math.abs(pl.camera.rotation.z));
        maxFov = Math.max(maxFov, Math.abs(pl.camera.fov - pl.baseFov));
        maxOffset = Math.max(maxOffset, Math.abs(pl.camera.position.y - pl.position.y - 0.55));
        maxShake = Math.max(maxShake, pl.trauma);
      }
      input.clear(); park();
      // Exercise held sprint without spending a dash into the reactor ahead of the fixture.
      pl.dashCharges = 0;
      input.simulateKey('KeyW', true); input.simulateKey('ShiftLeft', true); R.advance(0.5);
      const reducedSprint = { speed: pl.speed, fov: Math.abs(pl.camera.fov - pl.baseFov), roll: Math.abs(pl.camera.rotation.z) };
      input.clear(); park(); pl.reduceMotion = false;
      const bloom = g.post.pipeline.bloomEnabled;
      g.post.kick(1); g.post.setOptions({ bloom, reduceMotion: true });
      g.post.setOptions({ bloom, reduceMotion: false }); g.post.update(1 / 60, 0, 0, 0);
      const residualAberration = g.post.pipeline.chromaticAberration.aberrationAmount;
      return { run, dash, wall, boost, normalRoll, maxRoll, maxFov, maxOffset, maxShake, reducedSprint, residualAberration };
    });
    check('run and dash keep their speeds', camera.run > 16 && camera.dash > 45, JSON.stringify(camera));
    check('dash collides with the arena perimeter', camera.wall > 43 && camera.wall < 44);
    check('air boost lifts the drone and is consumed once', camera.boost.y > 1.5 && camera.boost.up > 11 && !camera.boost.available);
    check('ordinary movement retains camera feedback', camera.normalRoll > 0.01);
    check('reduced motion immediately removes roll, lens punch, shake and eye bob', camera.maxRoll < 1e-8 && camera.maxFov < 1e-8 && camera.maxOffset < 1e-8 && camera.maxShake === 0);
    check('reduced motion keeps sprint speed with a steady lens', camera.reducedSprint.speed >= 24 && camera.reducedSprint.fov < 1e-8 && camera.reducedSprint.roll < 1e-8);
    check('toggling reduced motion does not replay stored lens shake', camera.residualAberration === 0);

    // Fixed actors and viewpoint give comparable screenshots at full and compact desktop sizes.
    await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.teleport(0, -18, 0.95); R.look(0, 0.03); R.advance(1 / 60);
      for (const [i, kind] of ['walker', 'rusher', 'bulwark'].entries()) {
        const e = R.dev.spawn(kind);
        e.pos.set(-4 + i * 4, 0, -6); e.root.position.copyFrom(e.pos);
        e.yaw = Math.PI; e.root.rotation.y = e.yaw;
      }
      g.tele.marker(new R.V3(0, 0, -11), 3.2, 2, 'red'); g.tele.update(1.1);
    });
    await H.shot(p, 'lineup', { frames: 4 });
    const contacts = await ev(p, () => {
      const R = window.__rift, g = R.game;
      const contacts = () => g.scene.meshes.filter(m => m.name === 'enemyContact');
      const initial = contacts().filter(m => m.isEnabled()).length;
      const noPicking = contacts().every(m => !m.isPickable);
      const grounded = contacts().every(m => m.position.y > 0 && m.position.y < 0.05);
      for (const e of g.enemies.active) e.hidden = true;
      R.render(1);
      const hidden = contacts().filter(m => m.isEnabled()).length;
      for (let i = 0; i < 5; i++) {
        for (const e of g.enemies.active) e.hidden = false;
        R.render(1);
        for (const e of g.enemies.active) e.hidden = true;
        R.render(1);
      }
      for (const e of g.enemies.active) e.hidden = false;
      R.render(1);
      return { initial, noPicking, grounded, hidden, allocated: contacts().length };
    });
    if (!high) {
      check('shadows-off enemies have contacts on the physical floor', contacts.initial === 3 && contacts.grounded, JSON.stringify(contacts));
      check('contacts never intercept shots or survive hidden actors', contacts.noPicking && contacts.hidden === 0);
      check('contact instances are reused across visibility changes', contacts.allocated === 3);
    } else check('high graphics uses sun shadows without duplicate contacts', contacts.allocated === 0);

    await p.setViewportSize({ width: 960, height: 540 });
    await ev(p, () => window.__rift.flow.resize());
    await H.shot(p, 'lineup-compact', { frames: 2 });
    await p.setViewportSize({ width: 1280, height: 720 });
    await ev(p, () => window.__rift.flow.resize());

    // Recently hit burrowers must lose their label when they become untargetable underground.
    await ev(p, () => {
      const R = window.__rift, g = R.game;
      for (const e of g.enemies.active) e.hidden = true;
      const e = R.dev.spawn('burrower');
      e.pos.set(0, 0, -10); e.root.position.copyFrom(e.pos);
      e.hidden = false; g.damageEnemy('player', e, 1, e.center(), false);
      window.__qaBurrower = e;
    });
    await p.waitForFunction(() => document.querySelectorAll('.ehp').length === 1);
    await ev(p, () => { window.__qaBurrower.hidden = true; });
    await p.waitForFunction(() => document.querySelectorAll('.ehp').length === 0);
    check('hidden burrowers do not leave floating health bars', true);

    // Advance both simulation and particle rendering for an honest close-up of the burst.
    await ev(p, () => {
      const R = window.__rift, g = R.game;
      g.tele.reset(); g.fx.reset();
      for (const e of g.enemies.active) e.hidden = false;
      const pos = new R.V3(-3, 1.5, -8);
      g.fx.explode(pos, { scale: 0.85, debris: 6 });
      for (let i = 0; i < 4; i++) { R.advance(1 / 60); R.render(1); }
    });
    await p.screenshot({ path: `${H.OUT}/combat-burst.png`, timeout: 120000 });
    const bad = errs.filter(e => !/favicon/.test(e));
    check('no browser or shader errors', bad.length === 0, bad.slice(0, 3).join('\n'));
    await fs.writeFile(`${H.OUT}/feel-polish-results.json`, JSON.stringify({ camera, contacts, errors: bad, passed: H.stats.passes, failed: H.stats.failures, high }, null, 2));
  } catch (e) {
    check('suite completed', false, String(e.stack || e));
    await H.saveBrowserFailure(p.context(), p, [...errs, String(e.stack || e)], 'feel-polish');
  } finally {
    await b.close();
  }
  console.log(`${H.stats.passes} passed, ${H.stats.failures} failed`);
  process.exitCode = H.stats.failures ? 1 : 0;
})();
