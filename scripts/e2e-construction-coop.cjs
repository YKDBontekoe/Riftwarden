// Browser acceptance (construction, persistence, co-op clients, tutorial, settings).
// Usage: pnpm dev (5173), then node scripts/e2e-construction-coop.cjs [G,H,I,J,K,L,M,O,P,X]
// X (co-op with real clients) starts its own gateway stack on :8090 (where Vite proxies /auth and /session):
// needs RIFT_TEST_DATABASE_URL and RIFT_TEST_REDIS_URL; run it with `node --import tsx`.
const H = require('./lib/harness.cjs');
const { chromium, OUT, check } = H;
const FILTER = process.argv[2] || '';
const want = H.sectionFilter(FILTER);
const QUALITY = process.env.Q || 'low';

async function open(b, { fresh = true, keep = null } = {}) {
  const ctx = keep ?? (await b.newContext({ viewport: { width: 1280, height: 720 } }));
  if (fresh) await ctx.addInitScript((q) => { if (!localStorage.getItem('riftwarden.settings')) localStorage.setItem('riftwarden.settings', JSON.stringify({ v: 1, data: { sensitivity: 1, fov: 90, quality: q, volume: 0 } })); }, QUALITY);
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push('PAGEERR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') p.errs.push('console.error ' + m.text().slice(0, 200)); });
  await p.goto((process.env.RIFT_URL || 'http://localhost:5173/') + '?test');
  await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
  return { p, ctx };
}
const waitFor = (p, fn, arg, t = 180000) => p.waitForFunction(fn, arg, { timeout: t, polling: 100 });
const ev = (p, fn, arg) => p.evaluate(fn, arg);
async function hq(p) {
  await ev(p, () => window.__rift.flow.enterHq());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
  await ev(p, () => window.__rift.stopLoop());
}
async function reload(p) {
  await p.reload();
  await waitFor(p, () => window.__rift && window.__rift.state().screen === 'menu');
  await hq(p);
}
async function shot(p, name) {
  for (let i = 0; i < 3; i++) await ev(p, () => { window.__rift.advance(1 / 60); window.__rift.render(1); });
  await p.screenshot({ path: `${OUT}/construction-coop-${name}.png`, timeout: 120000 });
}
const structure = (p) => ev(p, () => JSON.stringify(window.__rift.profile.save.base.structure));
const cell = (i, j) => [2 + 5 * i + 2.5, -2.5 + 5 * j + 2.5];

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const { p, ctx } = await open(b);
  await ev(p, () => window.__rift.profile.mutate((s) => { s.resources.credits = 50000; s.resources.salvage = 50000; s.resources.components = 200; }));
  await hq(p);
  const bought = await ev(p, () => ['wall_door', 'sofa', 'table'].map((id) => window.__rift.profile.op('hqBlueprint', [id]).ok));
  check('G0 architect blueprints can be bought (persistent unlock)', bought.every(Boolean), JSON.stringify(bought));

  // ------------------------------------------------------------------ G: structure building
  if (want('G')) {
    await ev(p, () => window.__rift.home.openTerminal('architect'));
    await p.click('[data-testid="enter-construction"]');
    await waitFor(p, () => window.__rift.state().screen === 'construct');
    check('G1 architect console enters construction mode', true);
    const cost0 = await ev(p, () => window.__rift.profile.save.resources.credits);
    const r = await ev(p, ([cells]) => {
      const bm = window.__rift.home.build;
      const res = [];
      const place = (piece, x, z) => { bm.setTool({ kind: 'place', piece }); bm.clickAt(x, z); return bm.hud.valid; };
      for (const [x, z] of cells) res.push(place('floor_basic', x, z));
      return res;
    }, [[cell(7, 0), cell(8, 0), cell(9, 0), cell(9, 1), cell(9, -1), cell(10, 0)].map(([x, z]) => [x + 0.7, z - 1.1])]);
    const s1 = JSON.parse(await structure(p));
    check('G2 floors snap to grid cells (cursor offsets ignored)', ['7,0', '8,0', '9,0', '9,1', '9,-1', '10,0'].every((k) => s1.floors[k]), Object.keys(s1.floors).join(' '));
    const floating = await ev(p, ([x, z]) => { const bm = window.__rift.home.build; bm.setTool({ kind: 'place', piece: 'floor_basic' }); bm.clickAt(x, z); return bm.hud.message; }, cell(14, 5));
    check('G3 floating rooms are refused with a reason', !JSON.parse(await structure(p)).floors['14,5'] && /floating/i.test(floating), floating);
    const core = await ev(p, () => { const bm = window.__rift.home.build; bm.setTool({ kind: 'place', piece: 'floor_basic' }); bm.clickAt(30, 0); return bm.hud.message; });
    check('G4 the original facility cannot be built over', /original facility/i.test(core), core);
    // Walls around the new wing: a doorway between 8 and 9, windows on the far wall, a door to the north room.
    const walls = await ev(p, () => {
      const bm = window.__rift.home.build;
      const out = [];
      const put = (piece, x, z) => { bm.setTool({ kind: 'place', piece }); bm.clickAt(x, z); out.push([piece, bm.hud.valid, bm.hud.message]); };
      put('wall_doorway', 47.1, 0); // edge between cells 8 and 9 (x = 47)
      put('wall_window', 56.8, 0); // east edge of cell 10
      put('wall_door', 49.5, 2.3); // edge between (9,0) and (9,1)
      put('wall_basic', 49.5, 7.3); // north edge of (9,1)
      put('pillar', 47.1, 2.4);
      put('ceiling_panel', 49.5, 0);
      return out;
    });
    const s2 = JSON.parse(await structure(p));
    check('G5 walls/doors/windows snap to the nearest cell edge', s2.edges['8,0,e'] === 'wall_doorway' && s2.edges['10,0,e'] === 'wall_window' && s2.edges['9,0,n'] === 'wall_door' && s2.edges['9,1,n'] === 'wall_basic', JSON.stringify(s2.edges));
    check('G6 pillars snap to vertices, ceilings to cells', !!s2.pillars['9,1'] && s2.ceilings['9,0'] === 'ceiling_panel', JSON.stringify(walls.slice(4)));
    const block = await ev(p, () => { const bm = window.__rift.home.build; bm.setTool({ kind: 'place', piece: 'wall_basic' }); bm.clickAt(37.2, 0); return bm.hud.message; });
    check('G7 the gateway to the HQ cannot be walled off', /gateway/i.test(block), block);
    const cost1 = await ev(p, () => window.__rift.profile.save.resources.credits);
    check('G8 construction spends real resources', cost1 < cost0, `${cost0} -> ${cost1}`);
    await ev(p, () => { const c = window.__rift.home.build.camera; c.target.set(46, 0, 0); c.radius = 34; c.beta = 0.8; c.alpha = -Math.PI / 2 - 0.6; });
    await shot(p, 'G-build');
    // Collision: walk into the window wall from inside cell 10.
    await ev(p, () => window.__rift.home.exitConstruction());
    await waitFor(p, () => window.__rift.state().screen === 'home' || window.__rift.state().screen === 'paused');
    await ev(p, () => { window.__rift.home.setScreen('home'); window.__rift.flow.input.forceCapture = true; });
    await ev(p, () => { window.__rift.teleport(54, 0, 1); window.__rift.look(Math.PI / 2, 0); });
    await ev(p, () => { const i = window.__rift.flow.input; i.simulateKey('KeyW', true); window.__rift.advance(2); i.simulateKey('KeyW', false); });
    const px = await ev(p, () => window.__rift.home.player.position.x);
    check('G9 new walls have collision (drone stops at the window wall)', px < 57 && px > 54.5, `x=${px.toFixed(2)}`);
    await ev(p, () => { window.__rift.teleport(30, 0, 1); window.__rift.look(Math.PI / 2, 0); });
    await ev(p, () => { const i = window.__rift.flow.input; i.simulateKey('KeyW', true); window.__rift.advance(3); i.simulateKey('KeyW', false); });
    const through = await ev(p, () => window.__rift.home.player.position.x);
    check('G10 the opened gateway connects the HQ to the new wing', through > 38, `x=${through.toFixed(2)}`);
    await ev(p, () => { window.__rift.look(-Math.PI / 2, 0.05); });
    await shot(p, 'G-wing-fp');
    const before = await structure(p);
    await reload(p);
    check('G11 layout identical after a full page reload', (await structure(p)) === before);
    const built = await ev(p, () => window.__rift.home.layer.count);
    check('G12 the rebuilt HQ renders every saved module', built >= 6 + 4 + 1 + 1, `${built} pieces`);
  }

  // ------------------------------------------------------------------ H: decorations
  if (want('H')) {
    await ev(p, () => window.__rift.home.enterConstruction());
    const res = await ev(p, () => {
      const bm = window.__rift.home.build;
      const S = () => window.__rift.profile.save.base;
      const n0 = S().placeables.length;
      bm.setTool({ kind: 'place', piece: 'sofa' });
      bm.rotate(1); bm.rotate(1); bm.rotate(1);
      bm.setScale(1.1);
      bm.clickAt(43.3, 0.1);
      const sofa = S().placeables[S().placeables.length - 1];
      const placed = S().placeables.length === n0 + 1 && sofa.type === 'sofa';
      // Free placement: arbitrary coordinates, rotation and scale kept.
      const free = sofa.position[0] === 43.5 && sofa.position[2] === 0 && Math.abs(sofa.rotationY - Math.PI / 4) < 0.01 && sofa.scale === 1.1;
      // Collision: a planter on top of the sofa is refused.
      bm.setTool({ kind: 'place', piece: 'planter' }); bm.clickAt(43.5, 0.2);
      const overlap = bm.hud.message;
      // Move it
      bm.setTool({ kind: 'select' }); bm.clickAt(43.5, 0);
      bm.startMove(); bm.clickAt(51.5, -1);
      const moved = S().placeables.find((q) => q.uid === sofa.uid).position;
      bm.undo();
      const undone = S().placeables.find((q) => q.uid === sofa.uid).position;
      bm.redo();
      const redone = S().placeables.find((q) => q.uid === sofa.uid).position;
      // Remove + undo restores the same object; credits net zero
      const cr0 = window.__rift.profile.save.resources.credits;
      bm.setTool({ kind: 'select' }); bm.clickAt(51.5, -1); bm.removeSelected();
      const gone = !S().placeables.some((q) => q.uid === sofa.uid);
      const cr1 = window.__rift.profile.save.resources.credits;
      bm.undo();
      const back = S().placeables.some((q) => q.uid === sofa.uid);
      const cr2 = window.__rift.profile.save.resources.credits;
      // Lights: colour / intensity / off
      bm.setTool({ kind: 'place', piece: 'floorLamp' }); bm.clickAt(54, 1);
      const lamp = S().placeables[S().placeables.length - 1];
      bm.setTool({ kind: 'select' }); bm.clickAt(54, 1);
      bm.setProps({ color: 'amber', intensity: 1.4 });
      const lit = S().placeables.find((q) => q.uid === lamp.uid).props;
      return { placed, free, overlap, moved, undone, redone, gone, back, cr: [cr0, cr1, cr2], lit, lights: window.__rift.home.layer.realLights };
    });
    check('H1 furniture placed freely with rotation and scale', res.placed && res.free);
    check('H2 overlapping placement refused with a reason', /overlap/i.test(res.overlap), res.overlap);
    check('H3 move, undo and redo restore exact positions', res.moved[0] === 51.5 && res.undone[0] === 43.5 && res.redone[0] === 51.5, JSON.stringify([res.moved, res.undone, res.redone]));
    check('H4 remove refunds and undo re-places without duplicating resources', res.gone && res.back && res.cr[1] > res.cr[0] && res.cr[2] === res.cr[0], JSON.stringify(res.cr));
    check('H5 functional light with colour and intensity', res.lit.color === 'amber' && res.lit.intensity === 1.4 && res.lights >= 1, JSON.stringify(res.lit));
    // Light budget
    const budget = await ev(p, () => {
      const bm = window.__rift.home.build;
      for (let i = 0; i < 6; i++) { bm.setTool({ kind: 'place', piece: 'lightPylon' }); bm.clickAt(42 + i * 0.0, -3.5 + i * 1.4 > 2.5 ? -3.5 : -3.5 + i * 1.4); }
      return { real: window.__rift.home.layer.realLights, total: window.__rift.profile.save.base.placeables.filter((q) => q.type.includes('Lamp') || q.type === 'lightPylon').length };
    });
    check('H6 dynamic light budget is enforced (extra lights glow only)', budget.real <= 4, JSON.stringify(budget));
    const before = await ev(p, () => JSON.stringify(window.__rift.profile.save.base.placeables));
    await ev(p, () => window.__rift.home.exitConstruction());
    await reload(p);
    check('H7 decorations persist across reload', (await ev(p, () => JSON.stringify(window.__rift.profile.save.base.placeables))) === before);
  }

  // ------------------------------------------------------------------ I: functional station relocation
  if (want('I')) {
    await ev(p, () => window.__rift.home.enterConstruction());
    const r = await ev(p, () => {
      const bm = window.__rift.home.build;
      bm.setTool({ kind: 'select' });
      bm.clickAt(21.55, -5.2); // fabricator
      const sel = bm.hud.selection;
      bm.startMove();
      bm.rotate(1);
      bm.clickAt(50, 5.6);
      return { sel, msg: bm.hud.message, pose: window.__rift.profile.save.base.stations.fabricate };
    });
    check('I1 the fabricator can be selected and relocated into the wing', r.sel?.type === 'station' && !!r.pose, JSON.stringify(r));
    await waitFor(p, () => window.__rift.home && window.__rift.state().screen === 'construct');
    await ev(p, () => window.__rift.home.exitConstruction());
    await reload(p);
    const pose = await ev(p, () => window.__rift.profile.save.base.stations.fabricate);
    await ev(p, ([x, z, yaw]) => {
      window.__rift.home.setScreen('home');
      window.__rift.flow.input.forceCapture = true;
      window.__rift.teleport(x + Math.sin(yaw) * 2.0, z + Math.cos(yaw) * 2.0, 1);
      window.__rift.look(yaw + Math.PI, 0.35);
      window.__rift.advance(0.3);
    }, [pose.x, pose.z, pose.yaw]);
    const target = await ev(p, () => window.__rift.home.snapshot().target);
    check('I2 after reload the relocated station is interactive at its new place', target === 'fabricate', `target ${target}`);
    await ev(p, () => { window.__rift.flow.input.simulateKey('KeyE', true); window.__rift.advance(1 / 60); window.__rift.flow.input.simulateKey('KeyE', false); });
    const term = await ev(p, () => window.__rift.state().screen + ':' + (window.__rift.flow.home && document.querySelector('.shell, .terminal') ? 'ui' : ''));
    check('I3 it opens the real fabricator interface', term.startsWith('terminal'), term);
    const crafted = await ev(p, () => { const n = window.__rift.profile.save.items.length; const r = window.__rift.profile.op('craft', ['w_plasma', 'standard']); return { ok: r.ok, reason: r.reason, n0: n, n1: window.__rift.profile.save.items.length }; });
    check('I4 crafting at the relocated station uses the real economy', crafted.ok && crafted.n1 === crafted.n0 + 1, JSON.stringify(crafted));
    await shot(p, 'I-station');
    await ev(p, () => window.__rift.home.closeTerminal());
  }

  // ------------------------------------------------------------------ J: construction progression
  if (want('J')) {
    const locked = await ev(p, () => { const r = window.__rift.profile.op('hqFloor', [11, 0, 'floor_lab']); return r.reason; });
    check('J1 progression blueprints start locked', /locked/i.test(locked), locked);
    // Earn "Survive 10 waves" in a real run (solo, tier I): clear 10 waves through the real kill pipeline.
    await ev(p, () => { const R = window.__rift; R.flow.skipUpgrades = true; return R.flow.deploy(1); });
    await waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.state().busy);
    await ev(p, () => window.__rift.stopLoop());
    for (let w = 1; w <= 10; w++) {
      await ev(p, () => { const g = window.__rift.game; if (g.waves.phase === 'prep') g.startWave(); });
      for (let k = 0; k < 400; k++) {
        const done = await ev(p, (n) => { const R = window.__rift; const g = R.game; R.advance(0.5); R.killAll(); g.reactorHp = 1000; return g.waves.number > n || (g.waves.phase !== 'combat' && g.waves.number >= n + 1); }, w);
        if (done) break;
      }
      await ev(p, () => { const g = window.__rift.game; if (g.screen !== 'playing') { g.setScreen('playing'); } });
    }
    const cleared = await ev(p, () => window.__rift.game.cfg.run.wavesCleared);
    await ev(p, () => { const g = window.__rift.game; g.checkpointOpen = true; return window.__rift.flow.returnHome(); });
    await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    await ev(p, () => { window.__rift.stopLoop(); window.__rift.home.takeControl(false); });
    const ms = await ev(p, () => window.__rift.profile.save.milestones);
    check('J2 a real 10-wave run earns the milestone (banked, recorded)', cleared >= 10 && ms.includes('w10'), `cleared ${cleared}, milestones ${ms}`);
    const ok = await ev(p, () => window.__rift.profile.op('hqFloor', [11, 0, 'floor_lab']));
    check('J3 the Laboratory Floor blueprint is now unlocked and buildable', ok.ok, ok.reason);
    const fab = await ev(p, () => { const r1 = window.__rift.profile.op('hqFabricate', ['machinery']); const r2 = window.__rift.profile.op('hqPlace', ['pl_mach_test', 'machinery', 49.5, -5, 0, 1, {}]); return [r1.ok, r2.ok, r2.reason, window.__rift.profile.save.base.owned.machinery]; });
    check('J4 fabricated construction piece placed (consumed from owned stock)', fab[0] && fab[1] && fab[3] === 0, JSON.stringify(fab));
    await reload(p);
    const persisted = await ev(p, () => { const s = window.__rift.profile.save; return [s.base.structure.floors['11,0'], s.base.placeables.some((q) => q.uid === 'pl_mach_test'), s.milestones.includes('w10')]; });
    check('J5 unlock, built module and placed machinery persist after reload', persisted[0] === 'floor_lab' && persisted[1] && persisted[2], JSON.stringify(persisted));
  }

  // ------------------------------------------------------------------ X: co-op with real clients (own gateway stack)
  if (want('X')) {
    const { Bot, sleep } = await import('./bot.mjs');
    const { startStack } = await import('./lib/stack.mjs');
    const stack = await startStack({ port: 8090 });
    // Each page signs in with the test login (through the Vite proxy) and boots again with the account.
    const signedIn = async (name) => {
      const { p: pg } = await open(b);
      const r = await ev(pg, (n) => fetch('/auth/test-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n }) }).then((x) => x.status), name);
      if (r !== 200) throw new Error(`test login ${r}`);
      await pg.goto((process.env.RIFT_URL || 'http://localhost:5173/') + '?test&account');
      await waitFor(pg, () => window.__rift && window.__rift.state().screen === 'menu' && window.__session?.()?.status.get().state === 'idle' && window.__session().status.get().rev > 0);
      return pg;
    };
    const A = await signedIn('Alpha');
    const B = await signedIn('Bravo');
    // Two live software-GL render loops starve Playwright's actionability checks (clicks time out): the lobby UI is
    // React-driven and the arena transition renders by itself, so the clients run with the loop stopped.
    for (const pg of [A, B]) await ev(pg, () => window.__rift.stopLoop());
    for (const pg of [A, B]) {
      await ev(pg, () => window.__rift.flow.coopConnect());
      await waitFor(pg, () => window.__rift.flow.net.state.status === 'online');
    }
    // Lobby through the real UI: A creates from the menu's co-op tab, B types the code.
    await ev(A, () => window.__rift.flow.net.send({ t: 'create', tier: 1 }));
    await waitFor(A, () => window.__rift.flow.net.state.lobby);
    const code = await ev(A, () => window.__rift.flow.net.state.lobby.code);
    await B.click('text=CO-OP');
    await B.fill('[data-testid="coop-code"]', code);
    await B.click('[data-testid="coop-join"]');
    await waitFor(B, () => window.__rift.flow.net.state.lobby?.players.length === 2, null, 20000);
    check('X1 a second client joins through the lobby UI with the code', true, code);
    const bots = [];
    for (const n of ['Charlie', 'Delta']) {
      const bt = new Bot(n, stack);
      await bt.connect();
      bt.send({ t: 'join', code });
      await bt.waitNew((m) => m.t === 'lobby' && m.lobby);
      bt.send({ t: 'ready', ready: true });
      bots.push(bt);
    }
    await B.click('[data-testid="lobby-ready"]');
    await waitFor(A, () => window.__rift.flow.net.state.lobby?.players.length === 4 && window.__rift.flow.net.state.lobby.players.every((p) => p.host || p.ready), null, 20000);
    await A.click('text=CO-OP');
    await A.click('[data-testid="lobby-start"]');
    for (const pg of [A, B]) await waitFor(pg, () => window.__rift.state().location === 'arena' && !window.__rift.state().busy);
    for (const bt of bots) await bt.wait((m) => m.t === 'runStart', 30000);
    for (const pg of [A, B]) await ev(pg, () => { window.__rift.stopLoop(); window.__rift.flow.input.forceCapture = true; window.__rift.game.setScreen('playing'); });
    let botsAlive = true;
    (async () => { while (botsAlive) { for (const bt of bots) { const m = bt.me(); if (m) bt.input([m[1], m[2], m[3]]); } await sleep(70); } })();
    const tick = async (sec = 0.5) => { for (const pg of [A, B]) await ev(pg, (s) => window.__rift.advance(s), sec); await sleep(120); };
    for (let i = 0; i < 6; i++) await tick();
    const seen = await ev(A, () => ({ remotes: window.__rift.game.team.length, names: window.__rift.game.team.map((t) => t.name) }));
    check('X2 four wardens in one operation; each client sees the teammates', seen.remotes === 4, JSON.stringify(seen.names));
    // Tower placement through the replica's real build mode.
    await ev(A, () => { const R = window.__rift; R.teleport(-4, -18, 1); R.look(0, 0.75); R.advance(0.2); R.game.setBuildMode(true); });
    for (let i = 0; i < 3; i++) await tick(0.2);
    const valid = await ev(A, () => window.__rift.game.construction.valid);
    await ev(A, () => { const i = window.__rift.flow.input; i.simulateMouse(0, true); window.__rift.advance(1 / 60); i.simulateMouse(0, false); window.__rift.advance(1 / 60); });
    for (let i = 0; i < 6; i++) await tick(0.3);
    const towers = await Promise.all([A, B].map((pg) => ev(pg, () => window.__rift.game.turrets.turrets.length)));
    const replicatedTower = valid && towers[0] === 1 && towers[1] === 1;
    check('X3 a tower built by one player appears for every player', replicatedTower, JSON.stringify({ valid, towers }));
    if (!replicatedTower) throw new Error(`The tower did not replicate.\n${stack.log()}`);
    // Combat: wait until an enemy is inside the arena with a clear line from B, then B aims and fires its real weapon.
    await ev(A, () => window.__rift.game.startWave());
    for (let i = 0; i < 60; i++) {
      await tick(0.5);
      const close = await ev(B, () => { const g = window.__rift.game; const eye = g.player.eye; return g.enemies.active.some((e) => e.alive && e.center().subtract(eye).length() < 34); });
      if (close) break;
    }
    const fired = await ev(B, async () => {
      const R = window.__rift;
      const g = R.game;
      for (let k = 0; k < 40; k++) {
        const eye = g.player.eye;
        const e = g.enemies.active.filter((x) => x.alive).sort((a, b) => a.center().subtract(eye).length() - b.center().subtract(eye).length())[0];
        if (!e) { R.advance(0.25); await new Promise((r) => setTimeout(r, 60)); continue; }
        const c = e.center();
        R.look(Math.atan2(c.x - eye.x, c.z - eye.z), -Math.atan2(c.y - eye.y, Math.hypot(c.x - eye.x, c.z - eye.z)));
        g.input.simulateMouse(0, true);
        R.advance(0.25);
        await new Promise((r) => setTimeout(r, 60));
      }
      g.input.simulateMouse(0, false);
      return { shots: g.weapon.shotsFired, kills: g.cfg.run.kills, rejected: g.netStats.rejected };
    });
    for (let i = 0; i < 4; i++) await tick();
    const kills = await ev(A, () => window.__rift.game.cfg.run.kills);
    const replicatedCombat = fired.shots > 5 && kills > 0;
    check('X4 a client\'s real weapon fire is validated and kills authoritative enemies', replicatedCombat, JSON.stringify({ ...fired, teamKills: kills }));
    if (!replicatedCombat) throw new Error(`The clients did not complete authoritative combat.\n${stack.log()}`);
    await shot(A, 'X-coop');
    // Reach the first checkpoint quickly (test server): pick team upgrades (bots or browser chooser), start, clear.
    const pickOffer = async () => {
      const snap = bots[0].snap;
      if (!snap.of) return;
      const bt = bots.find((x) => x.welcome.playerId === snap.of[1]);
      if (bt) await bt.act({ a: 'upgrade', pick: snap.of[0][0] }).catch(() => null);
      else for (const pg of [A, B]) await ev(pg, () => { const g = window.__rift.game; if (g.offer && g.offerChooser === g.you) g.chooseUpgrade(g.offer[0].id); });
    };
    const loopEnd = Date.now() + 240000;
    for (let guard = 0; Date.now() < loopEnd && !(bots[0].snap.cp[2]); guard++) {
      await pickOffer();
      const snap = bots[0].snap;
      if (snap.w[1] === 'prep' && !snap.of) await bots[0].act({ a: 'startWave' }).catch(() => null);
      else if (snap.w[1] === 'combat') await bots[0].act({ a: 'test', op: 'clear' }).then((r) => { if (!r.ok) console.log('  clear refused', r.reason); }).catch((e) => console.log('  clear failed', e.message));
      if (guard % 4 === 0) console.log('  wave', JSON.stringify(snap.w), 'offer', !!snap.of, 'cp', JSON.stringify(snap.cp));
      await tick(0.3);
    }
    if (!bots[0].snap.cp[2]) throw new Error(`The team did not reach the wave-5 checkpoint.\n${stack.log()}`);
    const banks = await Promise.all([A, B].map((pg) => ev(pg, () => window.__rift.game.cfg.run.secured.salvage)));
    check('X5 the wave-5 checkpoint banks for each client', banks.every((v) => v > 0), JSON.stringify(banks));
    const rejectedEvents = await Promise.all([A, B].map((pg) => ev(pg, () => ({ events: window.__rift.game.netStats.events, bad: window.__rift.game.netStats.badEvents }))));
    check('X5b the clients accepted every replicated event (none rejected by the parser)', rejectedEvents.every((r) => r.events > 200 && r.bad === 0), JSON.stringify(rejectedEvents));
    for (const pg of [A, B]) await ev(pg, () => window.__rift.game.openCheckpoint());
    await A.click('[data-testid="cp-home"]');
    await B.click('[data-testid="cp-home"]');
    for (const bt of bots) await bt.act({ a: 'vote', home: true });
    for (const pg of [A, B]) await waitFor(pg, () => window.__rift.state().location === 'home' && !window.__rift.state().busy, null, 60000);
    // The run's results reach the account on the server; the client pulls the new copy.
    for (const pg of [A, B]) await waitFor(pg, () => window.__rift.profile.save.resources.salvage > 0 && !window.__rift.profile.save.activeRun, null, 20000).catch(() => null);
    const after = await Promise.all([A, B].map((pg) => ev(pg, () => ({ items: window.__rift.profile.save.items.length, salvage: window.__rift.profile.save.resources.salvage, run: window.__rift.profile.save.activeRun, screen: window.__rift.state().screen }))));
    check('X6 unanimous UI vote returns both clients home with banked rewards synced into their accounts', after.every((x) => x.salvage > 0 && !x.run && x.screen === 'summary'), JSON.stringify(after));
    botsAlive = false;
    for (const bt of bots) bt.close();
    // Visit the host's HQ: B sees A's layout read-only, A's construction appears live, both see each other.
    await waitFor(B, () => window.__rift.flow.net.state.lobby?.state === 'lobby', null, 30000);
    for (const pg of [A, B]) await ev(pg, () => { window.__rift.flow.setScreen?.('playing'); });
    await ev(B, () => window.__rift.flow.visitHostHq(true));
    await waitFor(B, () => window.__rift.flow.visiting && window.__rift.state().location === 'home' && !window.__rift.state().busy, null, 60000);
    const before = await ev(B, () => ({ ro: window.__rift.home.readOnly, n: window.__rift.home.layer.count, floor: window.__rift.home.layer.built.has('f:7,0') }));
    const built = await ev(A, () => { const r = window.__rift.profile.op('hqFloor', [7, 0, 'floor_basic']); return [r.ok, r.reason]; });
    await waitFor(B, () => window.__rift.home.layer.built.has('f:7,0'), null, 20000).catch(() => null);
    const live = await ev(B, () => window.__rift.home.layer.built.has('f:7,0'));
    check('X8 a guest visits the host HQ read-only and sees the host build live', before.ro && !before.floor && built[0] && live, JSON.stringify({ before, built, live }));
    for (let i = 0; i < 12; i++) {
      for (const pg of [A, B]) await ev(pg, () => window.__rift.flow.coopPresence(1));
      await sleep(120);
    }
    const pres = await Promise.all([A, B].map((pg) => ev(pg, () => window.__rift.home.presenceCount)));
    const refused = await ev(B, () => { window.__rift.home.enterConstruction(); return window.__rift.state().screen !== 'construct'; });
    check('X9 host and guest see each other in the host HQ; the guest cannot construct', pres[0] === 1 && pres[1] === 1 && refused, JSON.stringify({ pres, refused }));
    await ev(B, () => window.__rift.flow.visitHostHq(false));
    await waitFor(B, () => !window.__rift.flow.visiting && !window.__rift.state().busy, null, 60000);
    const own = await ev(B, () => ({ ro: window.__rift.home.readOnly, mine: Object.keys(window.__rift.profile.save.base.structure.floors).length }));
    check('X10 the guest returns to their own HQ (own layout, writable)', !own.ro, JSON.stringify(own));
    console.log([...A.errs, ...B.errs].filter((e) => e.startsWith('PAGEERR')).slice(0, 5).join('\n'));
    check('X7 no page errors on co-op clients', ![...A.errs, ...B.errs].some((e) => e.startsWith('PAGEERR')));
    await stack.stop();
  }

  console.log(p.errs.slice(0, 6).join('\n'));
  check('Z no page errors', !p.errs.some((e) => e.startsWith('PAGEERR')), p.errs.find((e) => e.startsWith('PAGEERR')) ?? '');
  await b.close();
  console.log(`\n${H.stats.failures === 0 ? 'ALL PASSED' : 'FAILURES'}  ${H.stats.passes} passed, ${H.stats.failures} failed`);
  process.exit(H.stats.failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
