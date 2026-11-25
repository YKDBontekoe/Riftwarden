// Firing range browser suite: deploy tab, frozen immortal dummies, measured DPS, setup keys, affinity, leaving records nothing.
// Usage: pnpm dev (port 5173), then: node scripts/e2e-range.cjs
const H = require('./lib/harness.cjs');
const { check, ev, stats } = H;

// Fire at the first dummy's body for `seconds` of simulated time (re-aiming every frame).
const fireAt = (p, seconds) =>
  ev(p, (secs) => {
    const R = window.__rift;
    const g = R.game;
    const e = g.range.targets[0];
    const i = R.flow.input;
    i.simulateMouse(0, true);
    for (let f = 0; f < secs * 60; f++) {
      const c = e.center ? e.center(new e.pos.constructor()) : e.pos;
      const eye = g.player.camera.position;
      const dx = c.x - eye.x, dy = c.y + 0.6 - eye.y, dz = c.z - eye.z;
      g.player.recoil = 0;
      g.player.recoilYaw = 0;
      R.look(Math.atan2(dx, dz), -Math.atan2(dy, Math.hypot(dx, dz)));
      R.advance(1 / 60);
      if (g.weapon.overheated) { i.simulateMouse(0, false); R.advance(1); i.simulateMouse(0, true); }
    }
    i.simulateMouse(0, false);
    R.advance(1 / 60);
  }, seconds);

const press = (p, code) =>
  ev(p, (c) => {
    const R = window.__rift;
    R.flow.input.simulateKey(c, true);
    R.advance(1 / 60);
    R.flow.input.simulateKey(c, false);
    R.advance(1 / 60);
  }, code);

(async () => {
  const { b, p, errs } = await H.launch({ skipUpgrades: true });
  try {
    // A: the deploy terminal opens the range.
    await ev(p, () => window.__rift.flow.enterHq());
    await ev(p, () => window.__rift.home.openTerminal('deploy'));
    await H.waitFor(p, () => document.querySelector('[data-testid=deploy-range]'));
    await p.click('[data-testid=deploy-range]');
    await H.waitFor(p, () => document.querySelector('[data-testid=range-enter]'));
    const history0 = await ev(p, () => window.__rift.profile.save.history.length);
    await p.click('[data-testid=range-enter]');
    await H.waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.state().busy && window.__rift.game?.range);
    await ev(p, () => window.__rift.advance(0.5));
    const a = await ev(p, () => {
      const g = window.__rift.game;
      return { dummies: g.range.targets.length, kind: g.range.targets[0].kind, phase: g.waves.phase, panel: !!document.querySelector('[data-testid=range-panel]'), hp: g.range.targets[0].hp, max: g.range.targets[0].maxHp, journal: window.__rift.profile.save.activeRun };
    });
    check('A1 range opens from the deploy terminal with one walker dummy and its readout', a.dummies === 1 && a.kind === 'walker' && a.panel, JSON.stringify(a));
    check('A2 no run starts in the save (no active run entry)', !a.journal, JSON.stringify(a.journal));
    await ev(p, () => window.__rift.advance(30));
    const a3 = await ev(p, () => { const g = window.__rift.game; const e = g.range.targets[0]; return { phase: g.waves.phase, x: e.pos.x, z: e.pos.z, hp: g.player.hp ?? g.player.health?.hp }; });
    check('A3 waves are held and the dummy stays on its mark', a3.phase === 'prep' && Math.abs(a3.x - 10) < 0.01 && Math.abs(a3.z - 13) < 0.01, JSON.stringify(a3));

    // B: firing measures damage; dummies never die.
    await fireAt(p, 4);
    const b1 = await ev(p, () => { const g = window.__rift.game; const e = g.range.targets[0]; return { meter: g.range.meter.read(4), alive: e.alive, hp: e.hp, max: e.maxHp, text: document.querySelector('[data-testid=range-dps]')?.textContent }; });
    check('B1 shots on the dummy read as DPS, burst and total', b1.meter.total > 0 && b1.meter.burst > 0 && b1.meter.hits > 0, JSON.stringify(b1.meter));
    check('B2 the dummy is never destroyed', b1.alive && b1.hp > b1.max * 0.3, JSON.stringify(b1));
    await fireAt(p, 25);
    const b3 = await ev(p, () => ({ alive: window.__rift.game.range.targets[0].alive, kills: window.__rift.game.director.kills, drops: window.__rift.game.loot.pickups?.length ?? 0 }));
    check('B3 sustained fire never kills it and nothing drops', b3.alive && b3.kills === 0 && b3.drops === 0, JSON.stringify(b3));

    // C: setup keys.
    await press(p, 'KeyJ');
    await press(p, 'KeyP');
    const c1 = await ev(p, () => { const g = window.__rift.game; return { n: g.range.targets.length, kinds: g.range.targets.map((e) => e.kind), total: g.range.meter.read(0).total, setup: g.range.setup }; });
    check('C1 J cycles the target, P makes a pack of three, the meter restarts', c1.n === 3 && c1.kinds.every((k) => k === 'bulwark') && c1.total === 0, JSON.stringify(c1));
    await press(p, 'KeyO');
    await press(p, 'KeyK');
    const c2 = await ev(p, () => { const g = window.__rift.game; return { faction: g.director.faction, mods: g.range.targets[0].mods, setup: g.range.setup }; });
    check('C2 O sets the faction affinities, K adds plating', c2.faction === 'scrap' && c2.mods.includes('armored'), JSON.stringify(c2));
    await press(p, 'KeyL');
    const c3 = await ev(p, () => { const g = window.__rift.game; return { z: g.range.targets[0].pos.z, d: g.range.setup.distance }; });
    check('C3 L moves the dummies back', c3.d === 25 && Math.abs(c3.z - 23) < 0.01, JSON.stringify(c3));
    await H.shot(p, 'range', { frames: 2 });

    // D: leaving records nothing.
    await ev(p, () => window.__rift.flow.abandonRun());
    await H.waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    const d1 = await ev(p, () => ({ history: window.__rift.profile.save.history.length, active: window.__rift.profile.save.activeRun, run: window.__rift.flow.run }));
    check('D1 leaving goes home with no history entry and no active run', !d1.active && !d1.run, JSON.stringify(d1));
    check('D2 history unchanged', d1.history === history0, `${history0} -> ${d1.history}`);
    const bad = errs.filter((e) => !/Error compiling effect/.test(e));
    check('Z no page/console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    console.error(e);
    stats.failures++;
  } finally {
    await b.close();
    console.log(`${stats.passes} passed, ${stats.failures} failed`);
    process.exit(stats.failures ? 1 : 0);
  }
})();
