// M6 acceptance (browser): advanced enemies, elite modifiers, events, arena evolution, bosses, scheduling,
// threat tiers, high-wave scaling, banking, records, performance, dev-session isolation.
// Usage: npm run dev (5173), then node scripts/e2e-m6.cjs [filter]
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('os').tmpdir();
const FILTER = process.argv[2] || '';
let failures = 0, passes = 0;
const check = (n, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? '  ' + info : ''}`); ok ? passes++ : failures++; };
const SETTINGS = JSON.stringify({ v: 1, data: { sensitivity: 1, fov: 90, quality: 'low', volume: 0 } });
const want = (k) => !FILTER || FILTER.split(',').some((f) => k.startsWith(f));

async function launch() {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript((s) => { if (!localStorage.getItem('riftwarden.settings')) localStorage.setItem('riftwarden.settings', s); }, SETTINGS);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console.error ' + m.text().slice(0, 300)); });
  await p.goto('http://localhost:5173/?test');
  await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
  await p.evaluate(() => window.__rift.stopLoop());
  return { b, p, errs };
}
const waitFor = (p, fn, arg, t = 180000) => p.waitForFunction(fn, arg, { timeout: t, polling: 100 });
const ev = (p, fn, arg) => p.evaluate(fn, arg);
async function deploy(p, tier = 1, dev = true, seed = null) {
  await ev(p, ([t, d, s]) => { const R = window.__rift; R.flow.skipUpgrades = true; R.flow.nextUpgradeSeed = s; return d ? R.dev.deploy(t) : R.flow.deploy(t); }, [tier, dev, seed]);
  await waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.state().busy && window.__rift.game);
  await ev(p, () => window.__rift.advance(1 / 60));
}
async function home(p) {
  await ev(p, () => window.__rift.flow.abandonRun());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
  await ev(p, () => { const R = window.__rift; if (R.state().screen === 'summary') R.home.takeControl(false); });
}

(async () => {
  const { b, p, errs } = await launch();
  await deploy(p, 1, true);

  // ------------------------------------------------------------------ B: advanced enemy AI
  if (want('B')) {
    let r = await ev(p, () => {
      const R = window.__rift, g = R.game, V = R.V3;
      R.dev.reset();
      R.teleport(0, -30);
      // Tower beside the north lane (bend at x=10,z=27 -> 10,14): towers are placed off-lane at x=4.
      const t = g.turrets.add(new V(4.2, 0, 22), 0, g.turretCtx); t.building = false;
      const e = R.dev.spawn('enforcer');
      e.speedMult = 1.6;
      let disabledSeen = false, slams = 0, prevMode = '';
      for (let i = 0; i < 60 * 40 && e.alive; i++) {
        R.advance(1 / 60);
        if (t.disabledT > 0) disabledSeen = true;
        if (prevMode === 'wind' && e.ai.mode === 'recover') slams++;
        prevMode = e.ai.mode;
        if (disabledSeen && slams) break;
      }
      const towerAlive = g.turrets.turrets.includes(t);
      g.turrets.remove(t);
      return { disabledSeen, slams, towerAlive, pos: e.pos.asArray().map((v) => +v.toFixed(1)) };
    });
    check('B1 enforcer advances its lane and slams a tower beside it (suppressed, not destroyed)', r.disabledSeen && r.slams >= 1 && r.towerAlive, JSON.stringify(r));

    r = await ev(p, () => {
      const R = window.__rift, g = R.game, V = R.V3;
      R.dev.reset();
      const e = R.dev.spawn('enforcer'); e.speedMult = 0; e.pos.set(0, 0, 20); e.yaw = Math.PI; e.ai.cd = 99;
      R.advance(1 / 60); e.yaw = Math.PI; e.ai.cd = 99;
      const hit = (from) => { const before = e.hp; g.damageEnemy('player', e, 100, e.center(), false, undefined, 'plasma', from); return before - e.hp; };
      g.stats.critChance = 0;
      const front = hit(new V(0, 2, 10));
      const back = hit(new V(0, 2, 30));
      // Electric counterplay: a shocked enforcer cannot hold its shield.
      const st = e.status; st.shockT = 0.5; st.disruptT = 0.5;
      R.advance(0.2); e.yaw = Math.PI;
      const shocked = hit(new V(0, 2, 10));
      e.hp = e.maxHp;
      const generator = (() => { const before = e.hp; st.shockT = 0; st.disruptT = 0; R.advance(0.4); e.yaw = Math.PI; g.damageEnemy('player', e, 100, e.center(), true, undefined, 'plasma', new V(0, 2, 30)); return before - e.hp; })();
      return { front: Math.round(front), back: Math.round(back), shocked: Math.round(shocked), generator: Math.round(generator), status: Object.keys(st) };
    });
    check('B2 enforcer frontal shield reduces damage; flank/rear and shock bypass it; generator is a weakpoint', r.front > 0 && r.front < r.back * 0.3 && r.shocked > r.front * 2 && r.generator > r.back, JSON.stringify(r));

    r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.dev.reset();
      R.teleport(-30, -30);
      const hp0 = g.reactorHp;
      const e = R.dev.spawn('artillery', [], 'east');
      let deployedAt = null, firedAt = null, mode = '';
      const shots0 = g.ordnance.fired;
      for (let i = 0; i < 60 * 70; i++) {
        R.advance(1 / 60);
        if (!deployedAt && e.ai.mode === 'idle') deployedAt = Math.hypot(e.pos.x, e.pos.z);
        if (g.ordnance.fired > shots0 && !firedAt) firedAt = i / 60;
        if (firedAt && i / 60 > firedAt + 3) break;
      }
      mode = e.ai.mode;
      // Interrupt: heavy damage during the charge cancels the shot.
      for (let i = 0; i < 60 * 12 && e.ai.mode !== 'charge'; i++) R.advance(1 / 60);
      const charging = e.ai.mode === 'charge';
      const before = e.ai.interrupts;
      g.damageEnemy('player', e, e.maxHp * 0.2, e.center(), false);
      R.advance(1 / 60);
      return { deployedAt: deployedAt && +deployedAt.toFixed(1), firedAt, reactorLoss: hp0 - g.reactorHp, charging, interrupted: e.ai.interrupts > before, mode: e.ai.mode, alive: e.alive };
    });
    check('B3 artillery holds firing distance, lobs a telegraphed shell that damages the reactor', r.deployedAt !== null && r.deployedAt <= 31 && r.deployedAt > 12 && r.firedAt !== null && r.reactorLoss > 0, JSON.stringify(r));
    check('B4 artillery charge can be interrupted by damage', r.charging && r.interrupted, JSON.stringify(r));

    r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.dev.reset();
      R.teleport(-30, -30);
      const w = R.dev.spawn('walker', [], 'west'); w.speedMult = 0; w.pos.set(-30, 0, 0);
      const b = R.dev.spawn('bulwark', [], 'west'); b.speedMult = 0; b.pos.set(-28, 0, 3);
      const eng = R.dev.spawn('engineer', [], 'west'); eng.speedMult = 0; eng.pos.set(-36, 0, 2);
      w.hp = w.maxHp * 0.4; b.shield = 0;
      const hp0 = w.hp;
      for (let i = 0; i < 60 * 8; i++) R.advance(1 / 60);
      return { healed: w.hp > hp0 + w.maxHp * 0.2, hp: [Math.round(hp0), Math.round(w.hp)], shield: Math.round(b.shield), buffed: w.buffT > 0 || b.buffT > 0, buffs: eng.ai.buffs, heals: +eng.ai.heals.toFixed(1) };
    });
    check('B5 engineer repairs allies, restores shields and empowers a frontline unit', r.healed && r.shield > 0 && r.buffs >= 1, JSON.stringify(r));

    r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.dev.reset();
      R.teleport(0, -12);
      const w = R.dev.spawn('walker', [], 'west'); w.pos.set(-10, 0, 10);
      const eng = R.dev.spawn('engineer', [], 'west');
      for (let i = 0; i < 60 * 20; i++) R.advance(1 / 60);
      return { engRemaining: Math.round(eng.remaining), walkerRemaining: Math.round(w.remaining), alive: w.alive };
    });
    check('B6 engineer stays behind the frontline', !r.alive || r.engRemaining > r.walkerRemaining, JSON.stringify(r));

    r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.dev.reset();
      R.teleport(0, -20);
      const hpP = g.player.hp;
      const c = R.dev.spawn('courier');
      const rt = g.survival;
      let maxY = 0, immuneSeen = false, orbs = g.ordnance.fired;
      for (let i = 0; i < 60 * 50 && c.alive; i++) {
        R.advance(1 / 60);
        if (c.ai.phaseT > 0) {
          immuneSeen = true;
          const before = c.hp + c.shield;
          g.damageEnemy('player', c, 50, c.center(), false);
          if (c.hp + c.shield < before) immuneSeen = 'broken';
        }
        maxY = Math.max(maxY, c.pos.y);
      }
      return { escaped: !c.alive && !g.enemies.active.includes(c), immuneSeen, orbs: g.ordnance.fired - orbs, escapedStat: g.cfg.run.survival.hvtEscaped };
    });
    check('B7 vault courier phase-shields, fires orbs and escapes after its timer', r.escaped && r.immuneSeen === true && r.orbs > 0 && r.escapedStat === 1, JSON.stringify(r));

    r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.dev.reset();
      const kinds = ['enforcer', 'artillery', 'engineer'];
      const out = {};
      g.dropChanceMult = 20;
      for (const k of kinds) {
        const e = R.dev.spawn(k, [], 'north');
        e.pos.set(0, 0, -10);
        const kills = g.cfg.run.kills, items = g.loot.count, cores = g.wallet.cores, cred = g.cfg.run.unsecured.credits;
        g.damageEnemy('player', e, 1e7, e.center(), false);
        R.advance(0.1);
        out[k] = { dead: !e.alive, kill: g.cfg.run.kills - kills, drops: g.loot.count - items, cores: g.wallet.cores - cores, credits: g.cfg.run.unsecured.credits - cred };
      }
      g.dropChanceMult = 1;
      return out;
    });
    check('B8 new archetypes die through the pipeline and pay rewards (cores, credits, drops)', Object.values(r).every((x) => x.dead && x.kill === 1 && x.cores > 0 && x.credits > 0 && x.drops > 0), JSON.stringify(r));
  }

  // ------------------------------------------------------------------ C: elite modifiers
  if (want('C')) {
    let r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.dev.reset();
      R.teleport(0, -16);
      const hp0 = g.player.hp + g.player.shield;
      const e = R.dev.spawn('walker', ['overcharged']); e.speedMult = 0; e.pos.set(0, 0, -11); e.shotT = 99; e.state = 'attack'; e.attackT = 99; e.dischargeCd = 0.1;
      const t = g.turrets.add(new R.V3(4, 0, -11), 0, g.turretCtx); t.building = false;
      let marker = false;
      for (let i = 0; i < 60 * 2; i++) { R.advance(1 / 60); if (e.dischargeWind > 0) marker = true; }
      const loss = hp0 - (g.player.hp + g.player.shield);
      const short = t.disabledT;
      g.turrets.remove(t);
      return { marker, loss: Math.round(loss), short: +short.toFixed(2) };
    });
    check('C1 overcharged: telegraphed discharge hurts the drone and shorts nearby towers', r.marker && r.loss > 0 && r.short > 0, JSON.stringify(r));

    r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.dev.reset();
      g.stats.critChance = 0;
      const a = R.dev.spawn('walker', ['armored']); a.speedMult = 0; a.pos.set(-5, 0, -10); a.maxHp = a.hp = 1e5; a.armor = 60;
      const n = R.dev.spawn('walker', []); n.speedMult = 0; n.pos.set(5, 0, -10);
      const dmg = (e, weak) => { const b = e.hp; g.damageEnemy('player', e, 20, e.center(), weak); return b - e.hp; };
      const body = dmg(a, false), plain = dmg(n, false);
      const weakA = dmg(a, true), weakN = dmg(n, true);
      let i = 0; while (a.armor > 0 && i++ < 500) dmg(a, false);
      const after = dmg(a, false);
      return { body: +body.toFixed(1), plain: +plain.toFixed(1), weakA: +weakA.toFixed(1), weakN: +weakN.toFixed(1), after: +after.toFixed(1), plates: a.eliteParts.get('armored').plates[0].isEnabled() };
    });
    check('C2 armored: plating absorbs body damage, weakpoints bypass it, plating breaks', r.body < r.plain * 0.6 && Math.abs(r.weakA - r.weakN) < 0.5 && Math.abs(r.after - r.plain) < 0.5 && r.plates === false, JSON.stringify(r));

    r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.dev.reset();
      R.teleport(-30, -30);
      const a = R.dev.spawn('walker', ['accelerated'], 'north'); const n = R.dev.spawn('walker', [], 'north');
      a.pos.set(0.5, 0, 53); n.pos.set(-0.5, 0, 53);
      let boosts = 0;
      for (let i = 0; i < 60 * 6; i++) { R.advance(1 / 60); if (a.boostT > 0) boosts++; }
      return { a: Math.round(a.remaining), n: Math.round(n.remaining), boosts };
    });
    check('C3 accelerated: much faster along the lane, with thruster boosts', r.a < r.n - 8 && r.boosts > 0, JSON.stringify(r));

    r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.dev.reset();
      R.teleport(0, -16);
      const e = R.dev.spawn('walker', ['volatile']); e.speedMult = 0; e.pos.set(0, 0, -13);
      const other = R.dev.spawn('walker', []); other.speedMult = 0; other.pos.set(2, 0, -13); other.state = 'attack'; other.attackT = 99; other.shotT = 99;
      e.state = 'attack'; e.attackT = 99; e.shotT = 99;
      const hp0 = g.player.hp + g.player.shield, ohp = other.hp;
      g.damageEnemy('player', e, 1e7, e.center(), false);
      const pending = g.enemies.pendingBlasts;
      R.advance(0.5);
      const mid = hp0 - (g.player.hp + g.player.shield);
      R.advance(1.2);
      const loss = hp0 - (g.player.hp + g.player.shield);
      return { pending, mid: Math.round(mid), loss: Math.round(loss), otherHurt: other.hp < ohp, after: g.enemies.pendingBlasts };
    });
    check('C4 volatile: delayed telegraphed death blast hurts the drone and nearby machines', r.pending === 1 && r.mid === 0 && r.loss > 0 && r.otherHurt && r.after === 0, JSON.stringify(r));

    r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.dev.reset();
      R.teleport(-30, -30);
      const e = R.dev.spawn('rusher', ['accelerated', 'volatile']);
      const okMods = e.mods.join('+');
      const name = e.displayName;
      const bad = R.dev.spawn('walker', ['armored', 'accelerated']);
      const marks = !!e.threat && e.threat.node.isEnabled();
      // Elite drops: many elite kills at a modest multiplier produce more items than plain kills.
      let eliteDrops = 0, plainDrops = 0;
      for (let i = 0; i < 40; i++) {
        const x = R.dev.spawn('walker', ['overcharged', 'volatile']); x.pos.set(-20, 0, -30);
        const c0 = g.loot.count + g.dropsConverted; g.damageEnemy('player', x, 1e9, x.center(), false); eliteDrops += g.loot.count + g.dropsConverted - c0;
        const y = R.dev.spawn('walker', []); y.pos.set(-20, 0, -30);
        const c1 = g.loot.count + g.dropsConverted; g.damageEnemy('player', y, 1e9, y.center(), false); plainDrops += g.loot.count + g.dropsConverted - c1;
        R.advance(1.6);
      }
      return { okMods, badMods: bad.mods.join('+'), marks, name, eliteDrops, plainDrops };
    });
    check('C5 compatible combos apply (Accelerated Volatile Rush Drone); contradictory ones are rejected', r.okMods === 'accelerated+volatile' && r.badMods === 'armored' && r.marks && /Accelerated Volatile Rush Drone/.test(r.name), JSON.stringify(r));
    check('C6 elites drop noticeably more equipment than regular kills', r.eliteDrops > r.plainDrops * 2, JSON.stringify(r));
  }

  // ------------------------------------------------------------------ D: boss encounters
  if (want('D')) {
    // Colossus: spawn, telegraphs, attacks hurting the drone / towers / reactor, phases, core exposure, beam, kill + rewards.
    let r = await ev(p, () => {
      const R = window.__rift, g = R.game, V = R.V3;
      R.dev.reset();
      g.reactorHp = 1000;
      const e = R.dev.spawn('colossus');
      e.pos.set(10, 0, 22); e.seg = 3;
      R.teleport(4, 10);
      const t = g.turrets.add(new V(5.5, 0, 20), 0, g.turretCtx); t.building = false;
      const hp0 = g.player.hp + g.player.shield;
      let tele = 0, towerDmg0 = t.damageDealt, disabled = false, hurt = 0, prevHp = hp0;
      for (let i = 0; i < 60 * 30; i++) {
        R.advance(1 / 60);
        tele = Math.max(tele, g.tele.active);
        if (t.disabledT > 0) disabled = true;
        const now = g.player.hp + g.player.shield;
        if (now < prevHp) hurt += prevHp - now;
        prevHp = now;
        if (!g.player.alive) { g.player.respawnT = 0; }
      }
      const attacks = { ...e.ai.attacks };
      const towerHits = t.damageDealt - towerDmg0;
      // Phase 2: plates eject, missiles/summons unlock, core exposes after attacks.
      e.hp = e.maxHp * 0.6; R.advance(0.1);
      const p2 = e.ai.phase, plates = e.ai.rig.plates.some((m) => m.isEnabled());
      for (let i = 0; i < 60 * 25; i++) R.advance(1 / 60);
      const attacks2 = { ...e.ai.attacks };
      // Exposed core takes boosted damage (weakpoint).
      e.ai.doorT = 5; e.ai.door = 1; e.ai.atk = null; e.ai.gcd = 99;
      g.stats.critChance = 0;
      const behind = e.center().add(new V(-Math.sin(e.yaw) * 3.5, 0, -Math.cos(e.yaw) * 3.5));
      let b = e.hp; g.damageEnemy('player', e, 100, behind, true); const core = b - e.hp;
      b = e.hp; g.damageEnemy('player', e, 100, e.center(), false); const body = b - e.hp;
      // Phase 3: siege beam at the reactor; interrupted by damage during the charge.
      e.hp = e.maxHp * 0.3; e.ai.gcd = 0; e.pos.set(6, 0, 10); R.advance(0.2);
      for (let i = 0; i < 60 * 4 && e.ai.atk?.kind !== 'beam'; i++) { R.advance(1 / 60); e.ai.gcd = Math.min(e.ai.gcd, 0); e.ai.cd.beam = Math.min(e.ai.cd.beam, 0); }
      const beamStarted = e.ai.atk?.kind === 'beam';
      g.damageEnemy('player', e, e.maxHp * 0.08, e.center(), false);
      R.advance(0.1);
      const interrupted = e.ai.interrupts;
      // Uninterrupted beam hits the reactor.
      for (let i = 0; i < 60 * 30 && (e.ai.atk?.kind !== 'beam'); i++) { R.advance(1 / 60); e.ai.cd.beam = Math.min(e.ai.cd.beam, 0); e.ai.gcd = Math.min(e.ai.gcd, 0.01); }
      const r0 = g.reactorHp;
      for (let i = 0; i < 60 * 4; i++) R.advance(1 / 60);
      const beamHit = r0 - g.reactorHp;
      g.turrets.remove(t);
      return { attacks, attacks2, tele, disabled, hurt: Math.round(hurt), towerHits: Math.round(towerHits), p2, plates, p3: e.ai.phase, core: Math.round(core), body: Math.round(body), beamStarted, interrupted, beamHit: Math.round(beamHit), id: e.id };
    });
    check('D1 colossus spawns, telegraphs and attacks (volley/stomp/mortar), hurting the drone and suppressing towers', (r.attacks.volley ?? 0) >= 1 && r.tele > 0 && r.hurt > 0 && r.disabled, JSON.stringify(r));
    check('D2 towers damage the colossus', r.towerHits > 0, JSON.stringify(r.towerHits));
    check('D3 colossus phase 2: plates eject, missiles and summons unlock', r.p2 === 2 && !r.plates && (r.attacks2.missiles ?? 0) >= 1 && (r.attacks2.summon ?? 0) >= 1, JSON.stringify(r));
    check('D4 exposed rear core takes boosted weakpoint damage', r.core > r.body * 2.5, JSON.stringify({ core: r.core, body: r.body }));
    check('D5 phase 3 siege beam: interruptible, and hits the reactor when ignored', r.p3 === 3 && r.beamStarted && r.interrupted >= 1 && r.beamHit > 50, JSON.stringify(r));

    r = await ev(p, async () => {
      const R = window.__rift, g = R.game;
      const e = g.enemies.active.find((x) => x.kind === 'colossus');
      const kills = g.cfg.run.survival.bossesKilled, comps = g.cfg.run.unsecured.components, items = g.loot.count;
      g.damageEnemy('player', e, 1e9, e.center(), false);
      const out = { inActive: g.enemies.active.includes(e), wreck: g.enemies.dyingCount };
      for (let i = 0; i < 60 * 4; i++) R.advance(1 / 60);
      const drops = g.loot.pickups.slice(items).map((p) => p.item);
      return { ...out, after: g.enemies.dyingCount, bosses: g.cfg.run.survival.bossesKilled - kills, names: g.cfg.run.survival.bosses, comps: g.cfg.run.unsecured.components - comps, drops: drops.length, rarities: drops.map((d) => d.rarity), exclusive: drops.filter((d) => ['colossus_plating', 'siege_module'].includes(d.baseId)).length };
    });
    check('D6 colossus death: destruction sequence, boss counted, epic+ boss loot and components', !r.inActive && r.wreck === 1 && r.after === 0 && r.bosses === 1 && r.comps >= 4 && r.drops >= 3 && r.rarities.every((x) => ['epic', 'legendary', 'exotic'].includes(x)), JSON.stringify(r));

    // Overseer: emitters shield the core, exposure window, relocation, sweep vulnerability, lances, discharge needs cover.
    r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.dev.reset();
      g.loot.clear?.();
      const e = R.dev.spawn('overseer');
      R.teleport(0, -12);
      for (let i = 0; i < 60 * 14 && !e.ai.deployed; i++) R.advance(1 / 60);
      const pylons = e.ai.pylons.length;
      let b = e.hp; g.damageEnemy('player', e, 200, e.center(), false); const shielded = b - e.hp;
      // Towers and statuses keep working on emitters: kill them through the pipeline.
      for (const p of [...e.ai.pylons]) g.damageEnemy('player', p, 1e7, p.center(), false);
      R.advance(0.1);
      const exposed = e.ai.exposedT;
      b = e.hp; g.damageEnemy('player', e, 200, e.center(), false); const open = b - e.hp;
      // Elemental: burn ticks hurt it, chill builds slowly (status resistance).
      g.director.inflict(e, { burn: 30, chill: 100 }, { kind: 'weapon', id: 'test' }, g.director.bus.newChain(), e.center());
      b = e.hp; R.advance(1.2); const burn = b - e.hp; const chill = e.status.chill;
      // Phase 2 behaviours.
      e.hp = e.maxHp * 0.55; R.advance(0.1);
      const seen = {};
      const playerY = [];
      for (let i = 0; i < 60 * 40; i++) { R.advance(1 / 60); if (e.ai.atk) seen[e.ai.atk.kind] = true; if (!g.player.alive) g.player.respawnT = 0; }
      return { pylons, shielded: Math.round(shielded), exposed: +exposed.toFixed(1), open: Math.round(open), burn: Math.round(burn), chill: Math.round(chill), phase: e.ai.phase, seen, sweepMult: 0 };
    });
    check('D7 overseer deploys emitters; the core is immune while they live', r.pylons >= 3 && r.shielded === 0, JSON.stringify(r));
    check('D8 destroying the emitters exposes the core', r.exposed > 5 && r.open > 100, JSON.stringify(r));
    check('D9 elemental statuses work on bosses (burn ticks, resisted chill)', r.burn > 0 && r.chill > 0 && r.chill < 60, JSON.stringify(r));
    check('D10 overseer phase 2 relocates, casts grid lances and the vulnerable prism sweep', r.phase === 2 && r.seen.relocate && r.seen.lances && r.seen.sweep, JSON.stringify(r));

    r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      const e = g.enemies.active.find((x) => x.kind === 'overseer');
      // Sweep doubles damage.
      e.ai.atk = null; e.ai.gcd = 0; e.ai.cd.sweep = 0; e.ai.cd.relocate = 99; e.ai.cd.lances = 99; e.ai.cd.redeploy = 99; e.ai.cd.summon = 99; e.ai.cd.orbs = 99;
      for (let i = 0; i < 60 && e.ai.atk?.kind !== 'sweep'; i++) R.advance(1 / 60);
      e.ai.exposedT = 0;
      let b = e.hp; g.damageEnemy('player', e, 100, e.center(), false); const sweepDmg = b - e.hp;
      // Phase 3: discharge. Exposed drone gets hit; behind the reactor it is safe.
      e.hp = e.maxHp * 0.25; e.ai.atk = null; R.advance(0.1);
      for (let i = 0; i < 60 * 3; i++) R.advance(1 / 60);
      e.ai.atk = null; e.ai.gcd = 0; e.ai.cd.discharge = 0; e.ai.cd.relocate = 99;
      e.pos.set(0, 12, 20);
      R.teleport(0, -11);
      const hpA = g.player.hp + g.player.shield;
      for (let i = 0; i < 60 * 4; i++) { R.advance(1 / 60); e.pos.set(0, 12, 20); R.teleport(0, -11); }
      const covered = hpA - (g.player.hp + g.player.shield);
      e.ai.atk = null; e.ai.gcd = 0; e.ai.cd.discharge = 0;
      R.teleport(14, 10);
      const hpB = g.player.hp + g.player.shield;
      for (let i = 0; i < 60 * 4; i++) { R.advance(1 / 60); e.pos.set(0, 12, 20); R.teleport(14, 10); }
      const open = hpB - (g.player.hp + g.player.shield);
      // Kill: emitters despawn with it, wreck sequence, rewards.
      const items = g.loot.count;
      g.damageEnemy('player', e, 1e9, e.center(), false);
      for (let i = 0; i < 60 * 4; i++) R.advance(1 / 60);
      const left = g.enemies.active.filter((x) => x.kind === 'pylon').length;
      const drops = g.loot.pickups.slice(items).map((p) => p.item);
      return { sweepDmg: Math.round(sweepDmg), phase: e.ai.phase, covered: Math.round(covered), open: Math.round(open), left, drops: drops.length, bosses: g.cfg.run.survival.bossesKilled };
    });
    check('D11 prism sweep exposes the core for double damage', r.sweepDmg >= 190, JSON.stringify(r));
    check('D12 overload discharge is avoidable behind cover and punishing in the open', r.phase === 3 && r.covered === 0 && r.open > 0, JSON.stringify(r));
    check('D13 overseer death removes its emitters and drops boss loot', r.left === 0 && r.drops >= 3 && r.bosses === 2, JSON.stringify(r));

    // Boss waves complete through the normal wave lifecycle (planner-forced boss wave).
    r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      R.dev.reset();
      R.dev.jump(12);
      R.dev.force({ boss: 'colossus' });
      const plan = g.waves.wave.plan;
      g.startWave(); R.advance(0.5);
      let bossSeen = false;
      for (let i = 0; i < 60 * 120 && g.waves.phase === 'combat'; i++) {
        R.advance(1 / 30);
        if (g.enemies.active.some((e) => e.kind === 'colossus')) bossSeen = true;
        if (i % 30 === 0) R.killAll();
        if (!g.player.alive) g.player.respawnT = 0;
      }
      for (let i = 0; i < 60 * 6 && g.waves.phase !== 'prep'; i++) R.advance(1 / 30);
      return { boss: plan.boss, theme: plan.theme, bossSeen, phase: g.waves.phase, wave: g.waves.number };
    });
    check('D14 a boss wave spawns its boss and completes normally', r.boss?.id === 'colossus' && r.theme === 'boss' && r.bossSeen && r.phase === 'prep' && r.wave === 13, JSON.stringify(r));
  }

  console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 10).join('\n') : 'no page errors');
  check('Z page errors', errs.length === 0, String(errs.length));
  console.log(`\n${passes} passed, ${failures} failed`);
  await b.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
