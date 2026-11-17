// M1 acceptance scenarios (A-G + tiers + interrupted runs) against a running dev server.
// Usage: npm run dev  (port 5173), then: node scripts/e2e-m1.cjs   (needs `playwright` + Chromium;
// set NODE_PATH to the global node_modules if playwright is installed globally).
// Runs in ?test mode: fixed-step simulation, low graphics preset, no real pointer lock.
// Screenshots go to $E2E_OUT (default: OS temp dir). Exit code 0 = all checks passed.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.env.E2E_OUT || require('os').tmpdir();
let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); if (!ok) failures++; };

async function launch(storageState) {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, storageState });
  if (!storageState) await ctx.addInitScript(() => { if (!localStorage.getItem('riftwarden.settings')) localStorage.setItem('riftwarden.settings', JSON.stringify({ v: 1, data: { sensitivity: 1, fov: 90, quality: 'low', volume: 0 } })); });
  await ctx.addInitScript(() => { window.__skipUpgrades = true; });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console.error ' + m.text().slice(0, 300)); });
  await p.goto('http://localhost:5173/?test');
  await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
  await p.evaluate(() => window.__rift.stopLoop());
  await p.evaluate(() => { window.__rift.flow.skipUpgrades = true; });
  return { b, ctx, p, errs };
}
const S = (p) => p.evaluate(() => window.__rift.state());
const waitFor = (p, fn, arg, t = 60000) => p.waitForFunction(fn, arg, { timeout: t, polling: 100 });
const shot = async (p, name) => { await p.evaluate(() => window.__rift.render(2)); await p.screenshot({ path: `${OUT}/${name}.png`, timeout: 120000 }); };

/** Fast-forward a live run through waves, killing everything, until `wave` is cleared. */
async function clearThrough(p, wave) {
  return p.evaluate(async (target) => {
    const R = window.__rift;
    for (let guard = 0; guard < 4000; guard++) {
      const g = R.game;
      if (!g) return 'no game';
      if (g.screen === 'checkpoint') {
        if (g.cfg.run.wavesCleared >= target) return 'checkpoint';
        await g.continueRun();
      }
      if (g.screen === 'defeat') return 'defeat';
      if (g.cfg.run.wavesCleared >= target && g.waves.phase === 'prep') return 'cleared';
      if (g.waves.phase === 'prep') g.waves.startNow();
      R.advance(0.5);
      R.killAll();
    }
    return 'timeout';
  }, wave);
}

(async () => {
  const t0 = Date.now();
  let { b, ctx, p, errs } = await launch();

  // ---------------- Scenario A: first launch -> HQ -> walk -> terminal -> deploy
  console.log('\n== Scenario A: first launch');
  let s = await S(p);
  check('A1 boots into HQ title screen', s.location === 'home' && s.screen === 'menu', JSON.stringify({ loc: s.location, scr: s.screen }));
  check('A1 fresh profile', s.salvage === 0 && s.runs === 0 && s.tierUnlocked === 1);
  await p.click('text=ENTER HEADQUARTERS');
  await waitFor(p, () => window.__rift.state().screen === 'home');
  check('A2 entered HQ (walking)', (await S(p)).screen === 'home');
  // Walk with the real controller: strafe right around the holo-table, then forward to the launch bay.
  await p.evaluate(() => window.__rift.advance(1 / 60));
  const start = (await S(p)).playerPos;
  await p.evaluate(() => { const R = window.__rift; const i = R.flow.input; R.advance(1 / 60); R.look(0, 0); i.simulateKey('KeyD', true); R.advance(0.35); i.simulateKey('KeyD', false); i.simulateKey('KeyW', true); R.advance(1.75); i.simulateKey('KeyW', false); R.advance(0.4); });
  s = await S(p);
  check('A3 FPS movement in HQ moved the drone', Math.hypot(s.playerPos[0] - start[0], s.playerPos[2] - start[2]) > 10, `from ${start.map((v) => v.toFixed(1))} to ${s.playerPos.map((v) => v.toFixed(1))}`);
  check('A3 hover height stable (no fall-through)', s.playerPos[1] > 0.8 && s.playerPos[1] < 1.2, `y=${s.playerPos[1].toFixed(2)}`);
  // Line up on the console: strafe back to x=0 and look at it.
  await p.evaluate(() => { const R = window.__rift; const pl = R.home.player; const i = R.flow.input; const x = pl.position.x; i.simulateKey('KeyA', true); R.advance(Math.max(0, x) / 11); i.simulateKey('KeyA', false); R.advance(0.3); R.look(0, 0.12); R.advance(0.1); });
  s = await S(p);
  check('A4 deployment terminal targeted', s.target === 'deploy', `target=${s.target} pos=${s.playerPos.map((v) => v.toFixed(1))} area=${s.area}`);
  check('A4 area readout = LAUNCH BAY', s.area === 'LAUNCH BAY');
  await shot(p, 'A_prompt');
  const promptText = await p.textContent('.hq-prompt').catch(() => null);
  check('A4 interaction prompt shown', !!promptText && promptText.includes('DEPLOYMENT TERMINAL'), promptText ?? '');
  // Looking away clears the target (no interaction through unrelated geometry)
  await p.evaluate(() => { window.__rift.look(Math.PI, 0); window.__rift.advance(0.1); });
  check('A4 target cleared when looking away', (await S(p)).target === null);
  await p.evaluate(() => { window.__rift.look(0, 0.12); window.__rift.advance(0.1); const i = window.__rift.flow.input; i.simulateKey('KeyE', true); window.__rift.advance(1 / 60); i.simulateKey('KeyE', false); });
  s = await S(p);
  check('A5 E opens the deployment interface', s.screen === 'terminal' && (await p.isVisible('text=SELECT THREAT TIER')));
  await shot(p, 'A_deploy_terminal');
  check('A6 tiers II/III locked on a fresh profile', await p.isDisabled('button.tier-card >> nth=1'));
  // Close and reopen with Escape
  await p.keyboard.press('Escape');
  await waitFor(p, () => window.__rift.state().screen === 'home');
  check('A5 Escape closes the terminal and returns control', (await S(p)).screen === 'home');
  await p.evaluate(() => { const i = window.__rift.flow.input; i.simulateKey('KeyE', true); window.__rift.advance(1 / 60); i.simulateKey('KeyE', false); });
  await p.click('button.deploy:has-text("DEPLOY")');
  await waitFor(p, () => { const s = window.__rift.state(); return s.location === 'arena' && !s.busy; }, null, 120000);
  s = await S(p);
  check('A7 deploy launched survival gameplay', s.location === 'arena' && s.screen === 'playing' && s.wave === 1 && s.phase === 'prep', JSON.stringify({ scr: s.screen, w: s.wave, ph: s.phase }));
  check('A7 fresh run state', s.enemies === 0 && s.turrets === 0 && s.reactorHp === 1000 && s.cores === 150 && s.salvageUnsecured === 0);
  check('A7 active run recorded in save', !!s.activeRun);
  const firstRunId = s.activeRun;
  await shot(p, 'A_arena_start');

  // ---------------- Scenario G (part): M0 regression in the arena
  console.log('\n== Scenario G: M0 regression');
  const g0 = await S(p);
  await p.evaluate(() => { const R = window.__rift; const i = R.flow.input; R.look(0, 0); i.simulateKey('KeyW', true); R.advance(0.6); i.simulateKey('KeyW', false); i.simulateKey('Space', true); R.advance(1 / 60); i.simulateKey('Space', false); R.advance(0.15); });
  let g1 = await S(p);
  check('G1 FPS movement in arena', Math.hypot(g1.playerPos[0] - g0.playerPos[0], g1.playerPos[2] - g0.playerPos[2]) > 4);
  check('G2 drone hover/jump leaves ground', g1.playerPos[1] > 1.3, `y=${g1.playerPos[1].toFixed(2)}`);
  await p.evaluate(() => window.__rift.advance(1.5));
  const movement = await p.evaluate(() => {
    const R = window.__rift;
    const player = R.game.player;
    const input = R.flow.input;
    const frame = 1 / 60;
    const tap = (key) => {
      input.simulateKey(key, true);
      R.advance(frame);
      input.simulateKey(key, false);
    };

    player.reset();
    input.simulateKey('KeyW', true);
    R.advance(0.3);
    const run = player.speed;
    input.simulateKey('ShiftRight', true);
    R.advance(frame);
    const dash = player.speed;
    R.advance(0.22);
    const sprint = player.speed;
    input.simulateKey('ShiftRight', false);
    input.simulateKey('KeyW', false);

    player.reset();
    tap('Space');
    tap('ShiftLeft');
    const { x, z } = player.position;
    input.simulateKey('KeyD', true);
    tap('Space');
    input.simulateKey('KeyD', false);
    const boost = {
      side: player.position.x - x,
      forward: player.position.z - z,
      vertical: player.verticalSpeed,
      dashing: player.dashing,
      charges: player.dashCharges,
    };
    R.advance(1.05);
    const recharged = player.dashCharges;

    player.reset();
    R.teleport(40, -20, 0.95);
    input.simulateKey('KeyD', true);
    tap('ShiftLeft');
    R.advance(0.25);
    input.simulateKey('KeyD', false);
    const wall = player.position.x;
    player.reset();
    R.advance(frame);
    return { run, dash, sprint, boost, recharged, wall };
  });
  check('G2 arena run, dash and forward sprint reach their target speeds', movement.run > 14 && movement.dash > 40 && movement.sprint > 21, JSON.stringify(movement));
  check('G2 air boost redirects a dash and recharges the spent dash charge', movement.boost.side > 0.35 && Math.abs(movement.boost.forward) < 0.1 && movement.boost.vertical > 11 && !movement.boost.dashing && movement.boost.charges === 1 && movement.recharged === 2);
  check('G2 accelerated dash respects the arena wall', movement.wall > 43 && movement.wall < 44, `x=${movement.wall.toFixed(2)}`);
  // Build a turret in build mode (B), placed in front of the drone.
  const build = await p.evaluate(() => {
    const R = window.__rift; const g = R.game; const i = R.flow.input;
    const pl = g.player; pl.controller.setPosition(new pl.camera.position.constructor(-8, 0.95, -14)); R.look(0, 0.5); R.advance(0.2);
    i.simulateKey('KeyB', true); R.advance(1 / 60); i.simulateKey('KeyB', false); R.advance(0.1);
    const valid = g.construction.valid; const msg = g.construction.message;
    i.simulateMouse(0, true); R.advance(1 / 60); i.simulateMouse(0, false); R.advance(1);
    return { valid, msg, turrets: g.turrets.turrets.length, cores: g.wallet.cores };
  });
  check('G3 tower construction', build.turrets === 1 && build.cores === 50, JSON.stringify(build));
  const tac = await p.evaluate(() => { const R = window.__rift; const g = R.game; const i = R.flow.input; i.simulateKey('KeyQ', true); R.advance(1 / 60); i.simulateKey('KeyQ', false); R.advance(0.5); const r = { active: g.tactical.active, scale: g.tactical.hostileScale }; i.simulateKey('KeyQ', true); R.advance(1 / 60); i.simulateKey('KeyQ', false); R.advance(0.6); i.simulateKey('Digit1', true); R.advance(1/60); i.simulateKey('Digit1', false); return r; });
  check('G4 tactical slow motion', tac.active && tac.scale < 0.3, JSON.stringify(tac));
  const spawn = await p.evaluate(() => { const R = window.__rift; const g = R.game; g.waves.startNow(); R.advance(8); return { phase: g.waves.phase, enemies: g.enemies.count }; });
  check('G5 wave spawning', spawn.phase === 'combat' && spawn.enemies > 0, JSON.stringify(spawn));
  const fire = await p.evaluate(() => {
    const R = window.__rift; const g = R.game; const i = R.flow.input;
    const e = g.enemies.active[0]; const c = e.center(); const pl = g.player;
    pl.controller.setPosition(new c.constructor(c.x, 0.95, c.z - 9)); R.advance(0.05);
    const eye = pl.eye; const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
    R.look(Math.atan2(dx, dz), -Math.atan2(dy, Math.hypot(dx, dz)));
    const hp0 = e.hp + e.shield; const heat0 = g.weapon.heat;
    i.simulateMouse(0, true); R.advance(0.3); i.simulateMouse(0, false);
    return { hp0, hp1: e.alive ? e.hp + e.shield : 0, heat: g.weapon.heat - heat0, kills: g.cfg.run.kills };
  });
  check('G6 weapon firing heats + damages enemy', fire.heat > 0 && fire.hp1 < fire.hp0, JSON.stringify(fire));
  const reactor = await p.evaluate(() => { const R = window.__rift; const g = R.game; const h0 = g.reactorHp; for (let k = 0; k < 40 && g.reactorHp === h0; k++) R.advance(1); return { h0, h1: g.reactorHp }; });
  check('G7 reactor takes damage from hostiles', reactor.h1 < reactor.h0, JSON.stringify(reactor));
  const resp = await p.evaluate(() => { const R = window.__rift; const pl = R.game.player; pl.damage(9999); const dead = !pl.alive; R.advance(4.3); return { dead, alive: pl.alive, hp: pl.hp }; });
  check('G8 player death + respawn', resp.dead && resp.alive && resp.hp > 90, JSON.stringify(resp));
  const sal = await p.evaluate(() => { const R = window.__rift; const g = R.game; const u0 = g.cfg.run.unsecured.salvage; const n = R.killAll(); return { u0, n, u1: g.cfg.run.unsecured.salvage, kills: g.cfg.run.kills }; });
  check('G9 kills yield unsecured salvage', sal.n > 0 && sal.u1 > sal.u0 && sal.kills >= sal.n, JSON.stringify(sal));

  // ---------------- Scenario B: checkpoint at wave 5 -> return home
  console.log('\n== Scenario B: survival checkpoint -> return home');
  let r = await clearThrough(p, 5);
  s = await S(p);
  check('B1 reached the wave-5 checkpoint', r === 'checkpoint' && s.screen === 'checkpoint', `result=${r} screen=${s.screen}`);
  check('B2 rewards secured automatically', s.salvageUnsecured === 0 && s.salvageSecured > 0 && s.salvage === s.salvageSecured, JSON.stringify({ u: s.salvageUnsecured, sec: s.salvageSecured, profile: s.salvage }));
  check('B2 checkpoint is in the preparation phase (not mid-combat)', s.phase === 'prep' && s.wave === 6);
  check('B2 next tier unlocked by the checkpoint', s.tierUnlocked === 2);
  await shot(p, 'B_checkpoint');
  const securedB = s.salvageSecured;
  // Double-bank protection: re-run the hook for the same wave.
  await p.evaluate(() => { const g = window.__rift.game; g.cfg.hooks.bank(5, { salvage: 999, items: [] }); });
  check('B2 repeated bank for the same checkpoint is ignored', (await S(p)).salvage === securedB);
  await p.click('button:has-text("RETURN TO HQ")');
  await waitFor(p, () => { const s = window.__rift.state(); return s.location === 'home' && !s.busy; }, null, 120000);
  s = await S(p);
  check('B3 returned to HQ with run summary', s.screen === 'summary' && (await p.isVisible('text=DRONE RECOVERED')));
  await shot(p, 'B_summary');
  check('B4 run recorded + profile persisted', s.runs === 1 && s.salvage === securedB && s.activeRun === null, JSON.stringify({ runs: s.runs, salvage: s.salvage }));
  const recB = await p.evaluate(() => window.__rift.profile.save.records['1']);
  check('B4 tier-1 survival record', recB && recB.bestWave === 5 && recB.checkpoints === 1, JSON.stringify(recB));
  // Return home twice must not duplicate anything.
  const again = await p.evaluate(() => window.__rift.flow.returnHome());
  check('B4 repeated return is rejected', again === false && (await S(p)).runs === 1 && (await S(p)).salvage === securedB);
  await p.click('button:has-text("CONTINUE")');
  await waitFor(p, () => window.__rift.state().screen === 'home');
  check('B5 summary -> HQ control', (await S(p)).screen === 'home');

  // ---------------- Scenario C: continue past 5 to 10
  console.log('\n== Scenario C: continue to wave 10');
  await p.evaluate(() => window.__rift.flow.deploy(1));
  await waitFor(p, () => { const s = window.__rift.state(); return s.location === 'arena' && !s.busy; }, null, 120000);
  s = await S(p);
  check('C0 new run does not inherit state', s.activeRun !== firstRunId && s.turrets === 0 && s.enemies === 0 && s.wave === 1 && s.salvageSecured === 0);
  r = await clearThrough(p, 5);
  const c5 = await S(p);
  check('C1 checkpoint at 5', r === 'checkpoint');
  await p.click('button:has-text("CONTINUE SURVIVAL")');
  s = await S(p);
  check('C2 continue resumes play in prep', s.screen === 'playing' && s.phase === 'prep' && s.canReturnHome);
  await p.evaluate(() => { const i = window.__rift.flow.input; i.simulateKey('KeyH', true); window.__rift.advance(1 / 60); i.simulateKey('KeyH', false); });
  check('C2 H reopens the checkpoint choice during prep', (await S(p)).screen === 'checkpoint');
  await p.click('button:has-text("CONTINUE SURVIVAL")');
  await p.evaluate(() => { const g = window.__rift.game; g.waves.startNow(); window.__rift.advance(1); });
  s = await S(p);
  check('C2 return option closes once combat starts', s.phase === 'combat' && !s.canReturnHome && (await p.evaluate(() => window.__rift.flow.returnHome())) === false);
  r = await clearThrough(p, 10);
  s = await S(p);
  check('C3 second banking checkpoint at wave 10', r === 'checkpoint' && s.wavesCleared === 10 && s.salvageUnsecured === 0 && s.salvageSecured > c5.salvageSecured, JSON.stringify({ r, sec: s.salvageSecured }));
  check('C3 profile reserve includes both banks', s.salvage === securedB + s.salvageSecured, `${s.salvage} vs ${securedB}+${s.salvageSecured}`);
  const lastBanked = await p.evaluate(() => window.__rift.profile.save.activeRun.bankedThroughWave);
  check('C3 save tracks banked-through wave', lastBanked === 10);

  // ---------------- Scenario D: defeat after a checkpoint
  console.log('\n== Scenario D: defeat');
  await p.click('button:has-text("CONTINUE SURVIVAL")');
  const preDefeat = await S(p);
  const weaponBefore = await p.evaluate(() => window.__rift.profile.save.loadout.weapon);
  const unsec = await p.evaluate(() => { const R = window.__rift; const g = R.game; g.waves.startNow(); for (let k = 0; k < 40 && g.cfg.run.unsecured.salvage === 0; k++) { R.advance(0.5); const e = g.enemies.active[0]; if (e) g.damageEnemy('player', e, 1e6, e.center(), false); } return g.cfg.run.unsecured.salvage; });
  check('D1 collected unsecured salvage after the checkpoint', unsec > 0, `unsecured=${unsec}`);
  const defeat = await p.evaluate(() => { const R = window.__rift; const g = R.game; g.reactorHp = 30; for (let k = 0; k < 120 && g.screen !== 'defeat'; k++) R.advance(0.5); return g.screen; });
  check('D2 reactor destroyed by hostiles ends the run', defeat === 'defeat');
  await p.waitForSelector('text=REACTOR LOST', { timeout: 20000 });
  await shot(p, 'D_defeat');
  s = await S(p);
  const last = await p.evaluate(() => window.__rift.flow.profile.save.history[0]);
  check('D3 unsecured salvage lost', last.outcome === 'defeat' && last.salvageLost >= unsec && s.salvage === preDefeat.salvage, JSON.stringify({ lost: last.salvageLost, reserve: s.salvage, before: preDefeat.salvage }));
  check('D4 secured salvage persists', s.salvage === securedB + preDefeat.salvageSecured);
  check('D5 equipped gear safe', (await p.evaluate(() => window.__rift.profile.save.loadout.weapon)) === weaponBefore && weaponBefore);
  const dupe = await p.evaluate(() => { const f = window.__rift.flow; f.endRun?.('defeat'); window.__rift.game.cfg.hooks.defeat(); return f.profile.save.totals; });
  check('D6 defeat cannot be recorded twice', dupe.runs === 2 && dupe.defeated === 1, JSON.stringify(dupe));
  await p.click('button:has-text("RETURN TO HQ")');
  await waitFor(p, () => { const s = window.__rift.state(); return s.location === 'home' && !s.busy; }, null, 120000);
  s = await S(p);
  check('D7 returned home after defeat', s.location === 'home' && s.screen === 'home');
  const recD = await p.evaluate(() => window.__rift.profile.save.records['1']);
  check('D7 best wave updated to 10', recD.bestWave === 10 && recD.runs === 2, JSON.stringify(recD));

  // ---------------- Scenario E: persistence across reload and browser restart
  console.log('\n== Scenario E: persistence');
  await p.evaluate(() => window.__rift.flow.selectTier(2));
  const before = await p.evaluate(() => JSON.parse(JSON.stringify(window.__rift.profile.save)));
  await p.reload();
  await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
  await p.evaluate(() => window.__rift.stopLoop());
  let after = await p.evaluate(() => window.__rift.profile.save);
  const same = (a, b) => a.resources.salvage === b.resources.salvage && a.threat.selected === b.threat.selected && a.threat.unlocked === b.threat.unlocked && JSON.stringify(a.records) === JSON.stringify(b.records) && a.history.length === b.history.length && a.loadout.weapon === b.loadout.weapon && a.totals.runs === b.totals.runs && a.base.placeables.length === b.base.placeables.length;
  check('E1 state restored after page refresh', same(before, after) && after.threat.selected === 2, JSON.stringify({ salvage: after.resources.salvage, tier: after.threat.selected }));
  const storage = await ctx.storageState();
  await b.close();
  ({ b, ctx, p, errs: errs2 } = await launch(storage));
  after = await p.evaluate(() => window.__rift.profile.save);
  check('E2 state restored after closing and reopening the browser', same(before, after));
  check('E2 load status', (await p.evaluate(() => window.__rift.profile.loadStatus)) === 'loaded');
  // Corrupt the save -> backup restore
  await p.evaluate(() => { localStorage.setItem('riftwarden.save', localStorage.getItem('riftwarden.save').replace('"salvage":', '"salvage":1')); });
  await p.reload();
  await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
  const corrupt = await p.evaluate(() => ({ st: window.__rift.profile.loadStatus, salvage: window.__rift.profile.save.resources.salvage, kept: !!localStorage.getItem('riftwarden.save.corrupt') }));
  check('E3 corrupted save detected, backup restored, raw kept', corrupt.st === 'restored-backup' && corrupt.kept, JSON.stringify(corrupt));
  await p.evaluate(() => window.__rift.stopLoop());

  // ---------------- Scenario F: repeated deployment cycles, leak checks
  console.log('\n== Scenario F: repeated deployments');
  await p.evaluate(() => window.__rift.flow.enterHq());
  const stats = [];
  for (let cycle = 0; cycle < 4; cycle++) {
    await p.evaluate(() => window.__rift.flow.deploy(1));
    await waitFor(p, () => { const s = window.__rift.state(); return s.location === 'arena' && !s.busy; }, null, 120000);
    const st = await S(p);
    const arenaLeak = await p.evaluate(() => window.__rift.leakStats());
    r = await clearThrough(p, 5);
    await p.evaluate(() => window.__rift.flow.returnHome());
    await waitFor(p, () => { const s = window.__rift.state(); return s.location === 'home' && !s.busy; }, null, 120000);
    await p.evaluate(() => window.__rift.home.takeControl());
    await p.evaluate(() => { window.gc && window.gc(); });
    const homeLeak = await p.evaluate(() => window.__rift.leakStats());
    stats.push({ cycle, startEnemies: st.enemies, startTurrets: st.turrets, r, arena: arenaLeak, home: homeLeak });
    console.log('  cycle', cycle, JSON.stringify({ r, enemies0: st.enemies, arenaTex: arenaLeak.textures, arenaMeshes: arenaLeak.meshes, home: homeLeak }));
  }
  const h = stats.map((x) => x.home);
  const a = stats.map((x) => x.arena);
  const flat = (arr, k) => arr.every((x) => x[k] === arr[0][k]);
  check('F1 every cycle reached a checkpoint and returned', stats.every((x) => x.r === 'checkpoint'));
  check('F2 each run starts empty (no duplicated enemies/towers)', stats.every((x) => x.startEnemies === 0 && x.startTurrets === 0));
  check('F3 exactly one Babylon scene alive', [...h, ...a].every((x) => x.scenes === 1));
  check('F4 HQ resources stable across cycles (textures/meshes/materials/lights)', ['textures', 'meshes', 'materials', 'lights'].every((k) => flat(h, k)), JSON.stringify(h.map((x) => [x.textures, x.meshes, x.materials, x.lights])));
  check('F4 arena resources stable across cycles', ['textures', 'meshes', 'materials', 'lights'].every((k) => flat(a, k)), JSON.stringify(a.map((x) => [x.textures, x.meshes, x.materials, x.lights])));
  check('F5 UI/event listeners do not accumulate', flat(h, 'hudListeners') && flat(h, 'uiListeners') && flat(h, 'profileListeners'), JSON.stringify(h.map((x) => [x.hudListeners, x.uiListeners, x.profileListeners])));
  check('F6 JS heap does not grow steadily', h[3].heapMB - h[1].heapMB < 25, JSON.stringify(h.map((x) => x.heapMB)));
  const domHud = await p.evaluate(() => ({ hud: document.querySelectorAll('.home-hud').length, arenaHud: document.querySelectorAll('.hud:not(.home-hud)').length, screens: document.querySelectorAll('.screen').length }));
  check('F7 no duplicated HUD elements', domHud.hud === 1 && domHud.arenaHud === 0, JSON.stringify(domHud));

  // ---------------- Tier difficulty
  console.log('\n== Threat tiers');
  const tiers = await p.evaluate(async () => {
    const R = window.__rift; const out = {};
    for (const t of [1, 2]) {
      await R.flow.deploy(t);
      while (R.state().busy) await new Promise((r) => setTimeout(r, 100));
      const g = R.game; g.waves.startNow(); R.advance(4);
      const e = g.enemies.active.find((x) => x.kind === 'walker');
      out[t] = { hp: e ? e.maxHp : null, speed: e ? e.speedMult : null, spawns: g.waves.wave.spawns.length, dmg: e ? e.damageMult : null };
      await R.flow.abandonRun();
      while (R.state().busy) await new Promise((r) => setTimeout(r, 100));
    }
    return out;
  });
  check('T1 higher tier increases enemy health/damage/speed/count', tiers[2].hp > tiers[1].hp && tiers[2].dmg > tiers[1].dmg && tiers[2].speed > tiers[1].speed && tiers[2].spawns > tiers[1].spawns, JSON.stringify(tiers));
  const ab = await p.evaluate(() => window.__rift.profile.save.totals);
  check('T2 abandoned runs recorded', ab.abandoned === 2, JSON.stringify(ab));

  // ---------------- Refresh mid-run: the run is recorded once as interrupted, secured salvage kept
  console.log('\n== Interrupted run');
  const pre = await p.evaluate(async () => { const R = window.__rift; await R.flow.deploy(1); while (R.state().busy) await new Promise((r) => setTimeout(r, 100)); return { salvage: R.profile.save.resources.salvage, interrupted: R.profile.save.totals.interrupted, active: R.profile.save.activeRun?.id }; });
  await p.reload();
  await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
  const post = await p.evaluate(() => ({ salvage: window.__rift.profile.save.resources.salvage, interrupted: window.__rift.profile.save.totals.interrupted, active: window.__rift.profile.save.activeRun, top: window.__rift.profile.save.history[0] }));
  check('I1 page closed mid-run -> recorded as interrupted once', !!pre.active && post.active === null && post.interrupted === pre.interrupted + 1 && post.top.id === pre.active && post.top.outcome === 'interrupted', JSON.stringify({ pre, post: { ...post, top: post.top.outcome } }));
  check('I2 secured salvage untouched by the interruption', post.salvage === pre.salvage);

  const allErrs = [...errs, ...(errs2 || [])].filter((e) => !/favicon|404/.test(e));
  check('Z no runtime errors', allErrs.length === 0, allErrs.slice(0, 5).join(' | '));
  console.log(`\n${failures ? failures + ' FAILURE(S)' : 'ALL PASSED'} in ${Math.round((Date.now() - t0) / 1000)}s`);
  fs.writeFileSync(`${OUT}/leak.json`, JSON.stringify(stats, null, 1));
  await b.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
