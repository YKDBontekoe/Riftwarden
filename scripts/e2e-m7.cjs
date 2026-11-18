// M7 browser acceptance (construction, persistence, co-op clients, tutorial, settings).
// Usage: npm run dev (5173) [+ npm run server for co-op sections], then node scripts/e2e-m7.cjs [G,H,I,J,K,L,M,O,P,X]
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('os').tmpdir();
const FILTER = process.argv[2] || '';
const want = (k) => !FILTER || FILTER.split(',').some((f) => k.startsWith(f));
let failures = 0, passes = 0;
const check = (n, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? '  ' + info : ''}`); ok ? passes++ : failures++; };
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
  await p.screenshot({ path: `${OUT}/m7-${name}.png`, timeout: 120000 });
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
      bm.clickAt(44.3, 0.1);
      const sofa = S().placeables[S().placeables.length - 1];
      const placed = S().placeables.length === n0 + 1 && sofa.type === 'sofa';
      // Free placement: arbitrary coordinates, rotation and scale kept.
      const free = sofa.position[0] === 44.5 && sofa.position[2] === 0 && Math.abs(sofa.rotationY - Math.PI / 4) < 0.01 && sofa.scale === 1.1;
      // Collision: a planter on top of the sofa is refused.
      bm.setTool({ kind: 'place', piece: 'planter' }); bm.clickAt(44.5, 0.2);
      const overlap = bm.hud.message;
      // Move it
      bm.setTool({ kind: 'select' }); bm.clickAt(44.5, 0);
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
    check('H3 move, undo and redo restore exact positions', res.moved[0] === 51.5 && res.undone[0] === 44.5 && res.redone[0] === 51.5, JSON.stringify([res.moved, res.undone, res.redone]));
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
    const fab = await ev(p, () => { const r1 = window.__rift.profile.op('hqFabricate', ['machinery']); const r2 = window.__rift.profile.op('hqPlace', ['pl_mach_test', 'machinery', 52.5, 4.6, 0, 1, {}]); return [r1.ok, r2.ok, r2.reason, window.__rift.profile.save.base.owned.machinery]; });
    check('J4 fabricated construction piece placed (consumed from owned stock)', fab[0] && fab[1] && fab[3] === 0, JSON.stringify(fab));
    await reload(p);
    const persisted = await ev(p, () => { const s = window.__rift.profile.save; return [s.base.structure.floors['11,0'], s.base.placeables.some((q) => q.uid === 'pl_mach_test'), s.milestones.includes('w10')]; });
    check('J5 unlock, built module and placed machinery persist after reload', persisted[0] === 'floor_lab' && persisted[1] && persisted[2], JSON.stringify(persisted));
  }

  console.log(p.errs.slice(0, 6).join('\n'));
  check('Z no page errors', !p.errs.some((e) => e.startsWith('PAGEERR')), p.errs.find((e) => e.startsWith('PAGEERR')) ?? '');
  await b.close();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}  ${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
