// M5 acceptance (A-L subset in the browser): upgrade flow, seeds, run reset, statuses + reactions, tower customisation,
// tactical refit, synergy, trigger-safety stress, performance, research persistence.
// Usage: pnpm dev (5173), then node scripts/e2e-m5.cjs
const H = require('./lib/harness.cjs');
const { OUT, check, S, ev } = H;
const waitFor = (p, fn, arg, t = 120000) => H.waitFor(p, fn, arg, t);
const boot = (p, reload = false) => H.boot(p, { reload });
const launch = () => H.launch();
async function deploy(p, seed) {
  await p.evaluate((s) => { window.__rift.flow.nextUpgradeSeed = s ?? null; return window.__rift.flow.deploy(1); }, seed);
  await waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.state().busy && window.__rift.game);
  await p.evaluate(() => window.__rift.advance(1 / 60));
}
async function home(p) {
  await p.evaluate(() => window.__rift.flow.abandonRun());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
  await p.evaluate(() => { const R = window.__rift; if (R.state().screen === 'summary') R.flow.enterHq?.(); });
}
const spawn = (p, n, kind = 'walker') => p.evaluate(([n, kind]) => {
  const g = window.__rift.game; const out = [];
  for (let i = 0; i < n; i++) { const e = g.enemies.spawn(kind, ['north', 'east', 'west'][i % 3], g.enemyCtx.layout, 1, 1); e.pos.set(8 + (i % 7) * 1.6, 0, 6 + Math.floor(i / 7) * 1.6); e.state = 'attack'; out.push(e.id); }
  return out;
}, [n, kind]);

(async () => {
  const { b, p, errs } = await launch();
  // ---------------- A: upgrade selection after a wave
  await deploy(p, 1234);
  let r = await ev(p, async () => {
    const R = window.__rift, g = R.game;
    g.startWave(); R.advance(0.5);
    R.killAll();
    for (let i = 0; i < 400 && g.waves.phase !== 'combat'; i++) R.advance(0.1);
    // kill until the wave clears
    for (let i = 0; i < 800 && g.screen !== 'upgrade'; i++) { R.killAll(); R.advance(0.25); }
    return { screen: g.screen, offer: (g.offer || []).map((u) => u.id), phase: g.waves.phase };
  });
  check('A1 upgrade screen opens after wave with 3 distinct choices', r.screen === 'upgrade' && r.offer.length === 3 && new Set(r.offer).size === 3, JSON.stringify(r));
  const t0 = await ev(p, () => { const g = window.__rift.game; const t = g.waves.timer; window.__rift.advance(3); return [t, g.waves.timer]; });
  check('A2 prep countdown paused while choosing', t0[0] === t0[1], JSON.stringify(t0));
  await p.waitForSelector('[data-testid=upgrade-card-0]');
  const cardTxt = await p.textContent('[data-testid=upgrade-card-1]');
  const wantId = await p.getAttribute('[data-testid=upgrade-card-1]', 'data-id');
  check('A3 card shows rarity/category/text/stack', /COMMON|RARE|EPIC|LEGENDARY/.test(cardTxt) && /STACK|NEW/.test(cardTxt), cardTxt.slice(0, 80));
  await p.click('[data-testid=upgrade-card-1]');
  await waitFor(p, () => window.__rift.game.screen === 'playing');
  const got = await ev(p, (id) => window.__rift.game.director.build.count(id), wantId);
  check('A4 chosen upgrade applied (stack 1) and screen resumes', got === 1);
  await ev(p, () => window.__rift.advance(1));
  // real effect: stat upgrade changes the computed stats
  const dmg = await ev(p, () => { const g = window.__rift.game; const a = g.stats.weaponDamageMult; g.director.takeUpgrade('w_calibrated'); return [a, g.stats.weaponDamageMult]; });
  check('A5 stat upgrade changes real stat pipeline', Math.abs(dmg[1] - dmg[0] - 0.15) < 1e-6, JSON.stringify(dmg));
  await p.evaluate(() => { const g = window.__rift.game; g.openBuildOverview(); });
  check('A6 build overview lists upgrades', (await p.textContent('[data-testid=build-overview]')).includes('Calibrated Emitters'));
  await p.evaluate(() => window.__rift.game.closePanel());
  await p.screenshot({ path: `${OUT}/m5_upgrade_hud.png`, timeout: 120000 }).catch(() => {});

  // ---------------- B: seed determinism, C: run reset
  const offerFor = (seed) => async () => {
    await home(p); await deploy(p, seed);
    return ev(p, () => { const g = window.__rift.game; return g.director.build.roll({ wave: 3, family: 'plasma', towers: 1, towerArchetypes: ['ballistic'] }, 0).map((u) => u.id).join(); });
  };
  const s1 = await offerFor(77)(), s2 = await offerFor(77)(), s3 = await offerFor(78)(), s4 = await offerFor(999)();
  check('B1 same seed -> same offers', s1 === s2, s1);
  check('B2 different seeds -> different offers', new Set([s1, s3, s4]).size >= 2, [s1, s3, s4].join(' | '));
  await ev(p, () => { const d = window.__rift.game.director; ['w_calibrated', 'e_ignite', 'd_aegis'].forEach((i) => d.takeUpgrade(i)); });
  await home(p); await deploy(p, 5);
  const c = await ev(p, () => ({ total: window.__rift.game.director.build.total, eff: window.__rift.game.director.bus.effectCount, mult: window.__rift.game.stats.weaponDamageMult, save: JSON.stringify(window.__rift.profile.save).includes('w_calibrated') }));
  check('C1 upgrades/effects/stats reset on new run, nothing in save', c.total === 0 && c.eff === 0 && c.mult === 1 && !c.save, JSON.stringify(c));

  // ---------------- D/E: statuses and reactions
  r = await ev(p, () => {
    const R = window.__rift, g = R.game, d = g.director; const out = {};
    g.startWave; const [id] = (() => { const e = g.enemies.spawn('bulwark', 'north', g.enemyCtx.layout, 1, 1); e.pos.set(20, 0, 20); e.state = 'attack'; return [e]; })();
    const e = id; const P = e.center(); const ch = d.bus.newChain(); const src = { kind: 'effect', id: 't' };
    const hp0 = e.hp + e.shield;
    d.inflict(e, { burn: 10 }, src, ch, P); R.advance(2);
    out.burnDmg = hp0 - (e.hp + e.shield); out.burning = e.status.burnStacks;
    R.advance(4); out.burnEnds = e.status.burnStacks;
    d.inflict(e, { chill: 60 }, src, ch, P); out.chill = e.status.chill;
    out.slowed = require_speed(e);
    function require_speed(x) { return x.status.chill > 0; }
    const before = d.reactions.thermalShock;
    d.deal({ target: e, amount: 50, element: 'thermal', source: src, chain: ch, point: P });
    out.shock = d.reactions.thermalShock - before; out.chillAfter = e.status.chill;
    d.deal({ target: e, amount: 50, element: 'thermal', source: src, chain: ch, point: P });
    out.shock2 = d.reactions.thermalShock - before;
    d.inflict(e, { burn: 8 }, src, ch, P, false); const o0 = d.reactions.overload;
    d.deal({ target: e, amount: 30, element: 'electric', source: src, chain: ch, point: P }); out.overload = d.reactions.overload - o0;
    const f = g.enemies.spawn('bulwark', 'north', g.enemyCtx.layout, 1, 1); f.pos.set(24, 0, 24);
    d.inflict(f, { chill: 100 }, src, ch, P); out.frozen = f.status.frozenT > 0; d.inflict(f, { burn: 5 }, src, ch, P);
    g.enemies.kill(f, g.fx, g.enemyCtx); out.cleaned = f.status.chill === 0 && f.status.frozenT === 0 && f.status.burnStacks === 0;
    return out;
  });
  check('D1 burn deals damage over time then expires', r.burnDmg >= 10 && r.burning > 0 && r.burnEnds === 0, JSON.stringify([r.burnDmg, r.burning, r.burnEnds]));
  check('D2 chill accumulates, freeze at full, status cleared on death', r.chill === 60 && r.frozen && r.cleaned, JSON.stringify([r.chill, r.frozen, r.cleaned]));
  check('E1 thermal shock fires once (cooldown), consumes chill', r.shock === 1 && r.shock2 === 1 && r.chillAfter === 0, JSON.stringify([r.shock, r.shock2, r.chillAfter]));
  check('E2 overload reaction (electric on burning)', r.overload === 1);

  // ---------------- F/G: tower customisation, tactical refit
  await ev(p, () => { const pr = window.__rift.profile; pr.mutate((d) => { d.towers.unlocked.push('weapon:chain_emitter', 'core:capacitor', 'modifier:multi_target', 'weapon:frost_projector'); }); });
  await home(p); await deploy(p, 9);
  r = await ev(p, () => {
    const R = window.__rift, g = R.game;
    g.wallet.earn(1000);
    const V = g.player.position.constructor; const t = g.turrets.add(new V(0, 0, 14), 0, g.turretCtx, g.buildConfig); R.advance(1.2);
    const before = { cfg: { ...t.config }, dps: t.st.dps, rig: t.rig.root.uniqueId, cores: g.wallet.cores, arch: t.archetype };
    const res = g.modifyTower(t, 'weapon', 'chain_emitter');
    const bad = g.modifyTower(t, 'modifier', 'splash_shells');
    const lock = g.modifyTower(t, 'core', 'overcharged');
    const lvl = g.modifyTower(t, 'level');
    return { before, res, bad, lock, lvl, after: { cfg: { ...t.config }, arch: t.archetype, chain: t.st.chain, rig: t.rig.root.uniqueId, cores: g.wallet.cores, level: t.level, tid: t.id } };
  });
  check('F1 weapon swap changes archetype/stats/model and charges cores', r.res.ok && r.after.arch === 'arc' && r.after.chain === 3 && r.after.rig !== r.before.rig && r.after.cores < r.before.cores, JSON.stringify(r.after));
  check('F2 incompatible / unresearched parts rejected, level upgrade works', !r.bad.ok && !r.lock.ok && r.lvl.ok && r.after.level === 2, JSON.stringify([r.bad.reason, r.lock.reason]));
  r = await ev(p, () => {
    const R = window.__rift, g = R.game; const t = g.turrets.turrets[0];
    g.startWave(); R.advance(0.3);
    const phase = g.waves.phase; const cores = g.wallet.cores;
    const e = g.enemies.spawn('walker', 'north', g.enemyCtx.layout, 1, 1); e.pos.set(2, 0, 10);
    const off = g.modifyTower(t, 'core', 'capacitor');
    g.tactical.energy = 100; g.tactical.toggle();
    const alive0 = g.enemies.count;
    const on = g.modifyTower(t, 'core', 'capacitor'); R.advance(0.5);
    return { phase, offOk: off.ok, offReason: off.reason, tac: g.tactical.active, onOk: on.ok, spent: cores - g.wallet.cores, alive: g.enemies.count >= alive0, core: t.config.core, energy: g.tactical.energy };
  });
  check('G1 combat refit refused without tactical, allowed with it; enemies stay active; cores spent', r.phase === 'combat' && !r.offOk && r.tac && r.onOk && r.spent > 0 && r.alive && r.core === 'capacitor', JSON.stringify(r));

  // ---------------- H: synergy (Storm Crit -> Phase Sync empowers Arc tower)
  r = await ev(p, () => {
    const R = window.__rift, g = R.game, d = g.director; const t = g.turrets.turrets[0];
    R.teleport(0, 8); R.advance(0.1);
    d.takeUpgrade('e_stormcrit'); d.takeUpgrade('s_sync');
    const e1 = g.enemies.spawn('bulwark', 'north', g.enemyCtx.layout, 1, 1); e1.pos.set(0, 0, 18);
    const e2 = g.enemies.spawn('walker', 'north', g.enemyCtx.layout, 1, 1); e2.pos.set(2, 0, 20);
    const rate0 = t.st.fireRate, ch0 = t.st.chain;
    g.damageEnemy('player', e1, 20, e1.center(), true); R.advance(0.2);
    return { emp: t.empowerT > 0, rate: t.st.fireRate / rate0, chain: t.st.chain - ch0, lightning: d.lightning, e2hit: e2.hp < e2.maxHp };
  });
  check('H1 crit lightning empowers towers (faster, longer chains) and hits others', r.emp && r.rate > 1.35 && r.chain === 2 && r.lightning > 0 && r.e2hit, JSON.stringify(r));

  // ---------------- I/J: trigger safety + performance
  await home(p); await deploy(p, 31);
  r = await ev(p, () => {
    const R = window.__rift, g = R.game, d = g.director; g.wallet.earn(5000);
    g.startWave(); R.advance(0.2);
    const ids = ['e_static', 'e_stormcrit', 'e_ignite', 'e_cryo', 'e_conductive', 'e_ember', 'l_stormfall', 's_network', 'l_grid', 'l_conductor', 's_detonate', 'w_fission', 's_mentor', 's_feedback', 't_parallel', 't_infuse', 'w_calibrated', 'w_overclock', 'm_surge'];
    const V = g.player.position.constructor;
    const cfgs = [{ weapon: 'autocannon', core: 'thermal_core', modifier: 'none' }, { weapon: 'chain_emitter', core: 'standard_core', modifier: 'none' }, { weapon: 'frost_projector', core: 'standard_core', modifier: 'none' }];
    let i = 0; for (const c of cfgs) for (let k = 0; k < 2; k++) { const t = g.turrets.add(new V(-6 + i * 3, 0, 4), 0, g.turretCtx, { base: 'standard', modifier: 'none', ...c }); i++; }
    const unl = (k) => (g.towerTech.add ? 0 : 0);
    for (const id of ids) d.build.stacks.set(id, 1), d.build.picks.push({ id, wave: 9 });
    d.rebuildEffects(); g.rebuildStats();
    const cnt = []; for (let s = 0; s < 30; s++) cnt.push(0);
    for (let j = 0; j < 42; j++) { const e = g.enemies.spawn(j % 6 === 0 ? 'bulwark' : 'walker', ['north', 'east', 'west'][j % 3], g.enemyCtx.layout, 3, 1); e.pos.set(-8 + (j % 8) * 1.5, 0, 12 + Math.floor(j / 8) * 1.5); e.state = 'attack'; }
    const t0 = performance.now(); let maxPending = 0, frames = 0, kills0 = d.kills; const times = [];
    for (let f = 0; f < 600; f++) {
      const a = g.enemies.active.filter((e) => e.alive);
      if (a.length) { const e = a[f % a.length]; g.damageEnemy('player', e, 60, e.center(), f % 3 === 0); }
      const s = performance.now(); R.advance(1 / 60); times.push(performance.now() - s); frames++;
      maxPending = Math.max(maxPending, d.bus.size);
      if (g.enemies.count < 15 && f % 20 === 0) for (let j = 0; j < 20; j++) { const e = g.enemies.spawn('walker', 'north', g.enemyCtx.layout, 3, 1); e.pos.set(-8 + (j % 8) * 1.5, 0, 12 + (j >> 3) * 1.5); e.state = 'attack'; }
    }
    times.sort((x, y) => x - y);
    const bad = g.enemies.active.some((e) => !Number.isFinite(e.hp) || !Number.isFinite(e.shield));
    return { errors: d.bus.stats.errors, maxPending, pending: d.bus.size, dropped: d.bus.stats.dropped, kills: d.kills - kills0, triggered: d.bus.stats.triggered, depthBlocked: d.bus.stats.depthBlocked, chainBlocked: d.bus.stats.chainBlocked, effects: d.bus.effectCount, bad, avgMs: times.reduce((a, b) => a + b, 0) / times.length, p95: times[Math.floor(times.length * 0.95)], max: times[times.length - 1], reactions: d.reactions, lightning: d.lightning, explosions: d.explosions, discharges: d.discharges, dmg: d.damageBy };
  });
  console.log('I/J stats', JSON.stringify(r));
  check('I1 no effect errors, no invalid hp, queue bounded and drained', r.errors === 0 && !r.bad && r.maxPending < 1500 && r.dropped === 0, JSON.stringify([r.errors, r.maxPending, r.dropped]));
  check('I2 effects chained heavily but loops stopped by depth/chain rules', r.triggered > 500 && r.kills > 20 && (r.depthBlocked + r.chainBlocked) > 0, JSON.stringify([r.triggered, r.kills, r.depthBlocked, r.chainBlocked]));
  check('I3 no duplicate listeners after repeated rebuild', await ev(p, () => { const d = window.__rift.game.director; const n = d.bus.effectCount; d.rebuildEffects(); d.rebuildEffects(); return d.bus.effectCount === n; }));
  check('J1 extreme build stays responsive (headless SwiftShader sim only, no render)', r.avgMs < 16, `avg ${r.avgMs.toFixed(2)} ms p95 ${r.p95.toFixed(2)} max ${r.max.toFixed(1)}`);
  await ev(p, () => window.__rift.render(3));
  await p.screenshot({ path: `${OUT}/m5_extreme.png`, timeout: 180000 }).catch(() => {});

  // ---------------- K: research persistence
  await home(p);
  await p.evaluate(() => { const pr = window.__rift.profile; pr.mutate((d) => { d.records['1'] = { ...(d.records['1'] || {}), bestWave: 9 }; d.resources.credits = 5000; d.resources.components = 20; }); });
  r = await ev(p, async () => { const TX = null; return window.__rift.profile.save.towers.unlocked.length; });
  await boot(p, true);
  const unl = await ev(p, () => window.__rift.profile.save.towers.unlocked);
  check('K1 researched blueprints persist across reload', unl.includes('weapon:chain_emitter') && unl.includes('weapon:frost_projector'), unl.join());
  await deploy(p, 2);
  r = await ev(p, () => { const g = window.__rift.game; return { arc: g.towerTech.has('weapon:chain_emitter'), towers: g.turrets.turrets.length, locked: !g.towerTech.has('core:overcharged') }; });
  check('K2 unlock available in new run; deployed towers never persist', r.arc && r.towers === 0 && r.locked, JSON.stringify(r));

  check('Z no page/console errors', errs.length === 0, errs.slice(0, 3).join(' || '));
  await b.close();
  console.log(`\n${H.stats.passes} passed, ${H.stats.failures} failed`);
  process.exit(H.stats.failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
