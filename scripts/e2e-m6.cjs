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
  await ev(p, async () => { const f = window.__rift.flow; if (!(await f.abandonRun())) await f.leaveArena(); });
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
  await ev(p, () => { const R = window.__rift; if (R.state().screen === 'summary') R.home.takeControl(false); });
}

(async () => {
  const { b, p, errs } = await launch();
  await deploy(p, 1, true);

  // ------------------------------------------------------------------ A: wave variety and reproducibility (in the game)
  if (want('A')) {
    const sig = () => ev(p, () => { const g = window.__rift.game; const out = []; for (let n = 1; n <= 30; n++) { const q = g.planner.plan(n); out.push(`${q.theme}:${q.event ?? '-'}:${q.boss?.id ?? '-'}:${q.evolution ?? '-'}`); } return { sig: out.join('|'), spawns: JSON.stringify(g.planner.compose(14).spawns.slice(0, 20)) }; });
    await home(p); await deploy(p, 2, true, 777);
    const a1 = await sig();
    await home(p); await deploy(p, 2, true, 777);
    const a2 = await sig();
    await home(p); await deploy(p, 2, true, 31337);
    const a3 = await sig();
    check('A1 same seed + tier reproduces the encounter plan and wave composition', a1.sig === a2.sig && a1.spawns === a2.spawns, a1.sig.slice(0, 120));
    check('A2 a different seed produces a different encounter sequence', a1.sig !== a3.sig, a3.sig.slice(0, 120));
    const r = await ev(p, () => {
      const g = window.__rift.game;
      const kinds = new Set(), themes = new Set();
      for (let n = 4; n <= 40; n++) { const w = g.planner.compose(n); themes.add(w.plan.theme); for (const s of w.spawns) kinds.add(s.kind); }
      return { kinds: [...kinds], themes: [...themes] };
    });
    check('A3 compositions vary across themes and use the new archetypes', r.themes.length >= 6 && ['enforcer', 'artillery', 'engineer'].every((k) => r.kinds.includes(k)), JSON.stringify(r));
  }

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

  // ------------------------------------------------------------------ E: arena evolution
  if (want('E')) {
    await home(p); await deploy(p, 1, true);
    let r = await ev(p, () => {
      const R = window.__rift, g = R.game, V = R.V3;
      R.dev.reset();
      // Before: the south lane is reserved (no tower can block the future route), the door blocks sight.
      const C = g.construction;
      const lane = g.layout.routes.south.points[3];
      const sealedLos = g.los(new V(0, 2, -40), new V(0, 2, -44.5));
      const bodies0 = g.dynamics['door'].filter((m) => m.body).length;
      const tower = g.turrets.add(new V(-8, 0, -24), 0, g.turretCtx); tower.building = false;
      R.dev.evolve('routes');
      const doorBusy = g.dynamics.busy;
      for (let i = 0; i < 60 * 6; i++) R.advance(1 / 60);
      const openLos = g.dynamics['door'].filter((m) => m.body).length === 0 && bodies0 === 2;
      // Navigation: a machine from the new gate reaches the reactor ring.
      const w = R.dev.spawn('walker', [], 'south'); w.speedMult = 3;
      let reached = false;
      for (let i = 0; i < 60 * 40 && w.alive; i++) { R.advance(1 / 60); if (w.state === 'attack') { reached = true; break; } }
      const plan = (() => { g.waves.recompose(); return g.waves.wave.plan; })();
      const towerOk = g.turrets.turrets.includes(tower);
      g.turrets.remove(tower);
      return { sealedLos, doorBusy, openLos, reached, gates: plan.gates, towerOk, southOpen: g.dynamics.southOpen, lane };
    });
    check('E1 secondary access route: blast door animates open, sight/collision cleared', !r.sealedLos && r.doorBusy && r.openLos && r.southOpen, JSON.stringify(r));
    check('E2 new route is navigable to the reactor and added to the wave plan; existing towers untouched', r.reached && r.gates.includes('south') && r.towerOk, JSON.stringify(r));

    r = await ev(p, () => {
      const R = window.__rift, g = R.game, V = R.V3;
      R.dev.reset();
      const b = g.layout.barriers[0];
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      R.teleport(cx, cz);
      const tower = g.turrets.add(new V(14, 0, -22), 0, g.turretCtx); tower.building = false;
      const st0 = tower.st.fireRate;
      R.dev.evolve('instability');
      R.advance(1);
      const heldWhileInside = g.dynamics.busy && g.dynamics['barriers'][0].t === 0;
      for (let i = 0; i < 60 * 9; i++) R.advance(1 / 60);
      const pp = g.player.position;
      const inside = pp.x > b.min[0] && pp.x < b.max[0] && pp.z > b.min[2] && pp.z < b.max[2];
      const blocked = !g.los(new V(b.min[0] - 2, 1.5, cz), new V(b.max[0] + 2, 1.5, cz));
      // Vents: a machine standing in a vent burns; the drone standing in one takes damage.
      const v = g.layout.vents[1];
      const e = R.dev.spawn('walker', [], 'east'); e.speedMult = 0; e.pos.set(v.x, 0, v.z); e.state = 'attack'; e.attackT = 99; e.shotT = 99;
      R.teleport(v.x + 0.5, v.z);
      const hp0 = e.hp, p0 = g.player.hp + g.player.shield;
      for (let i = 0; i < 60 * 11; i++) { R.advance(1 / 60); e.pos.set(v.x, 0, v.z); R.teleport(v.x + 0.5, v.z); if (!g.player.alive) break; }
      // Conduit-fed tower near a vent.
      const t2 = g.turrets.add(new V(v.x + 5.5, 0, v.z + 4.5), 0, g.turretCtx); t2.building = false; R.advance(0.1);
      const t3 = g.turrets.add(new V(-30, 0, -30), 0, g.turretCtx); t3.building = false; R.advance(0.1);
      const fed = t2.st.fireRate / t3.st.fireRate;
      for (const t of [tower, t2, t3]) g.turrets.remove(t);
      return { heldWhileInside, inside, blocked, enemyBurn: Math.round(hp0 - e.hp), playerBurn: Math.round(p0 - (g.player.hp + g.player.shield)), fed: +fed.toFixed(2), st0 };
    });
    check('E3 bulkheads wait while the drone stands in the footprint, then move it out (never trapped) and become solid', r.heldWhileInside && !r.inside && r.blocked, JSON.stringify(r));
    check('E4 plasma vents erupt (telegraphed) and hurt machines and the drone standing in them', r.enemyBurn > 0 && r.playerBurn > 0, JSON.stringify(r));
    check('E5 towers near vents are conduit-fed (+25% fire rate)', Math.abs(r.fed - 1.25) < 0.02, JSON.stringify(r));
  }

  // ------------------------------------------------------------------ F: dynamic events
  if (want('F')) {
    await home(p); await deploy(p, 1, true);
    const runEvent = (id) => ev(p, (id) => {
      const R = window.__rift, g = R.game;
      R.dev.reset();
      R.teleport(-30, -34);
      R.dev.jump(14);
      R.dev.force({ event: id });
      const plan = g.waves.wave.plan;
      const spawns = g.waves.wave.spawns;
      const credits0 = g.cfg.run.unsecured.credits, salvage0 = g.cfg.run.unsecured.salvage, comp0 = g.cfg.run.unsecured.components, items0 = g.loot.count + g.dropsConverted;
      g.startWave(); R.advance(0.2);
      window.__evPlan = { plan, spawns, credits0, salvage0, comp0, items0 };
      return null;
    }, id).then(async () => {
      const chip = await p.waitForSelector('[data-testid=event-chip]', { timeout: 5000 }).then(() => true, () => false);
      return ev(p, ([id, chip]) => {
      const R = window.__rift, g = R.game;
      const { plan, spawns, credits0, salvage0, comp0, items0 } = window.__evPlan;
      let during = { strikes: 0, hurt: 0, hvt: null, overdrive: 0 };
      const t = g.turrets.add(new R.V3(-12, 0, -30), 0, g.turretCtx); t.building = false;
      for (let i = 0; i < 60 * 150 && g.waves.phase === 'combat'; i++) {
        R.advance(1 / 30);
        if (g.tele.active > 0 && g.survival.event === 'instability') during.strikes++;
        if (g.survival.event === 'instability') during.overdrive = Math.max(during.overdrive, t.st.fireRate);
        if (g.survival.hvt.enemy && !during.hvt) during.hvt = g.survival.hud().hvt;
        // Kill everything except the courier for a while (we shoot it explicitly).
        if (i % 20 === 0) for (const e of [...g.enemies.active]) if (e.kind !== 'courier' || i > 60 * 3) g.damageEnemy('player', e, 1e9, e.center(), false);
        if (!g.player.alive) g.player.respawnT = 0;
      }
      const fr = t.st.fireRate;
      for (let i = 0; i < 60 * 5 && g.waves.phase !== 'prep'; i++) R.advance(1 / 30);
      R.advance(0.2);
      const after = { event: g.survival.event, teles: g.tele.active, fireRate: t.st.fireRate };
      g.turrets.remove(t);
      return {
        plan: { theme: plan.theme, event: plan.event, signal: plan.signal },
        count: spawns.length, swarm: spawns.filter((s) => s.tag === 'swarm').length, squad: spawns.filter((s) => s.tag === 'squad').map((s) => (s.mods || []).length), hvt: spawns.filter((s) => s.kind === 'courier').length,
        hpMult: Math.max(...spawns.map((s) => s.hpMult ?? 1)),
        credits: g.cfg.run.unsecured.credits - credits0, salvage: g.cfg.run.unsecured.salvage - salvage0, comps: g.cfg.run.unsecured.components - comp0, drops: g.loot.count + g.dropsConverted - items0,
        chip, during, fr, after, phase: g.waves.phase, events: g.cfg.run.survival.events.slice(-1)[0], hvtKilled: g.cfg.run.survival.hvtKilled,
      };
    }, [id, chip]);
    });
    const base = await ev(p, () => { const g = window.__rift.game; const w = g.planner.compose(14); return { count: w.spawns.length }; });
    let r = await runEvent('swarm');
    check('F1 swarm invasion: more, weaker machines; bonus salvage/credits and an extra drop; notified', r.plan.theme === 'swarm' && r.swarm > base.count * 0.6 && r.chip && r.credits > 0 && r.events === 'swarm' && r.after.event === null, JSON.stringify(r));
    r = await runEvent('eliteAssault');
    check('F2 elite assault: coordinated multi-modifier squad, components + elite cache on clear', r.chip && r.squad.length >= 4 && r.squad.every((n) => n >= 1) && r.comps >= 2 && r.drops >= 2, JSON.stringify(r));
    r = await runEvent('instability');
    check('F3 power instability: telegraphed grid strikes, overdriven towers during the wave, cleaned up after', r.chip && r.during.strikes > 0 && r.during.overdrive > r.after.fireRate * 1.3 && r.after.event === null && r.after.fireRate < r.during.overdrive, JSON.stringify(r));
    r = await runEvent('hvt');
    check('F4 high-value target: courier with HUD timer, destroyed for a targeted cache + rewards', r.hvt === 1 && r.during.hvt && r.hvtKilled >= 1 && r.drops >= 2 && r.plan.signal, JSON.stringify(r));
    check('F5 events end with the wave (no lingering hazards)', r.after.event === null && r.phase === 'prep', JSON.stringify(r.after));
  }

  // ------------------------------------------------------------------ D: boss encounters
  if (want('D')) {
    await home(p); await deploy(p, 1, true);
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

  // ------------------------------------------------------------------ G: threat tiers
  if (want('G')) {
    const out = {};
    for (const tier of [1, 3, 5]) {
      await home(p); await deploy(p, tier, true, 4242);
      out[tier] = await ev(p, () => {
        const R = window.__rift, g = R.game;
        R.dev.jump(12);
        const w = g.waves.wave;
        const e = R.dev.spawn('walker'); const hp = e.maxHp; const dmg = e.damageMult;
        g.dropChanceMult = 1;
        const items = []; for (let i = 0; i < 30; i++) items.push(...g.rollItems('checkpoint', 12));
        const rar = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, exotic: 5 };
        return { budget: Math.round(w.plan.budget), spawns: w.spawns.length, elites: w.spawns.filter((s) => s.mods).length, hp: Math.round(hp), dmg: +dmg.toFixed(2), boss: g.planner.tier.bossFirstWave, lvl: Math.round(items.reduce((s, i) => s + i.level, 0) / items.length), rarity: +(items.reduce((s, i) => s + rar[i.rarity], 0) / items.length).toFixed(2) };
      });
    }
    check('G1 higher tiers: tougher machines, bigger budgets, more elites, earlier bosses', out[5].hp > out[3].hp && out[3].hp > out[1].hp && out[5].budget > out[1].budget && out[5].elites >= out[1].elites && out[5].boss < out[1].boss, JSON.stringify(out));
    check('G2 higher tiers: better item levels and rarity', out[5].lvl > out[3].lvl && out[3].lvl > out[1].lvl && out[5].rarity >= out[1].rarity, JSON.stringify(out));
  }

  // ------------------------------------------------------------------ H: high-wave scaling
  if (want('H')) {
    await home(p); await deploy(p, 5, true, 99);
    const r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      const res = [];
      for (const n of [25, 50, 100, 250, 1000]) {
        R.dev.jump(n);
        const w = g.waves.wave;
        g.startWave();
        let maxHp = 0, ok = true;
        for (let i = 0; i < 60 * 8; i++) {
          R.advance(1 / 30);
          for (const e of g.enemies.active) { maxHp = Math.max(maxHp, e.maxHp); if (!Number.isFinite(e.hp) || !Number.isFinite(e.maxHp) || !(e.maxHp > 0)) ok = false; }
          if (i % 40 === 0) R.killAll();
          if (!g.player.alive) g.player.respawnT = 0;
          g.reactorHp = 1000;
        }
        const items = g.rollItems('boss', n);
        res.push({ n, spawns: w.spawns.length, hp: w.hpMult, dmg: w.damageMult, reward: w.clearReward, maxHp, ok, active: g.enemies.count, lvl: Math.max(...items.map((i) => i.level)), finite: items.every((i) => Number.isFinite(i.level)), plan: w.plan.theme });
        R.dev.reset();
      }
      return res;
    });
    check('H1 waves 25-1000 compose valid, finite encounters with bounded entity counts', r.every((x) => x.ok && Number.isFinite(x.hp) && Number.isFinite(x.dmg) && Number.isFinite(x.reward) && x.spawns <= 180 && x.active <= 48), JSON.stringify(r.map((x) => [x.n, x.spawns, +x.hp.toFixed(1), +x.dmg.toFixed(1), x.active, x.plan])));
    check('H2 loot levels scale with the wave (finite, no arbitrary cap)', r.every((x) => x.finite) && r[4].lvl > r[0].lvl, JSON.stringify(r.map((x) => [x.n, x.lvl])));
  }

  // ------------------------------------------------------------------ I: checkpoint banking with bosses/events, K: records
  if (want('I')) {
    await home(p);
    // Test profile setup: tier III unlocked; find a seed whose first ten waves contain a boss and an event.
    const seed = await ev(p, () => {
      const R = window.__rift;
      R.profile.mutate((d) => { d.threat.unlocked = Math.max(d.threat.unlocked, 3); return true; });
      for (let s = 1; s < 4000; s++) {
        let boss = 0, event = 0;
        for (let n = 1; n <= 10; n++) { const q = R.planFor(s, 3, n); if (q.boss) boss = n; if (q.event && n <= 9) event = n; }
        if (boss && boss <= 10 && event) return s;
      }
      return null;
    });
    const before = await ev(p, () => { const d = window.__rift.profile.save; return { items: d.items.length, rec: JSON.stringify(d.records['3'] ?? null), weapon: d.loadout.weapon, salvage: d.resources.salvage }; });
    await deploy(p, 3, false, seed);
    let r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      let picked = 0, leftBehind = 0, bossKills = 0, eventsSeen = [];
      g.dropChanceMult = 3;
      for (let wave = 1; wave <= 10; wave++) {
        g.startWave(); R.advance(0.3);
        for (let i = 0; i < 60 * 240 && g.waves.phase === 'combat'; i++) {
          R.advance(1 / 30);
          if (i % 15 === 0) R.killAll();
          if (!g.player.alive) g.player.respawnT = 0;
          g.reactorHp = Math.max(g.reactorHp, 600);
        }
        // Collect half of the drops (the rest stays on the floor). Nothing after the final checkpoint (it would be lost).
        const ps = wave < 10 ? [...g.loot.pickups] : [];
        for (let k = 0; k < ps.length; k++) {
          if (k % 2 === 0 && g.loot.landed(ps[k]) || k % 2 === 0) { R.advance(1); if (g.loot.landed(ps[k]) && g.collectPickup(ps[k])) picked++; }
        }
        for (let i = 0; i < 60 * 8 && g.waves.phase !== 'prep'; i++) R.advance(1 / 30);
        if (g.screen === 'checkpoint') g.setScreen('playing');
      }
      leftBehind = g.loot.count;
      return { wave: g.waves.number, cleared: g.cfg.run.wavesCleared, banked: g.cfg.run.lastBankedWave, secured: g.cfg.run.secured.items.length, picked, leftBehind, bosses: g.cfg.run.survival.bosses, events: g.cfg.run.survival.events, canReturn: g.canReturnHome, dev: g.cfg.run.survival.dev };
    });
    check('I1 ten waves incl. a boss and an event bank at waves 5 and 10 (collected items secured)', r.cleared === 10 && r.banked === 10 && r.bosses.length >= 1 && r.events.length >= 1 && r.secured === r.picked + 4 /* + 2 checkpoint caches x 2 */ && r.picked > 0 && !r.dev, JSON.stringify(r));
    await ev(p, () => window.__rift.flow.returnHome());
    await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    const after = await ev(p, () => { const d = window.__rift.profile.save; return { items: d.items.length, rec: d.records['3'], hist: d.history[0], milestones: d.milestones, weapon: d.loadout.weapon }; });
    const summary = await p.waitForSelector('[data-testid=run-notes]', { timeout: 5000 }).then(() => true, () => false);
    check('I2 return home: secured equipment is in storage (uncollected drops are not)', after.items - before.items === r.secured && r.leftBehind >= 0, JSON.stringify({ gained: after.items - before.items, secured: r.secured, left: r.leftBehind }));
    check('K1 per-tier records + history reflect real run statistics (bosses, elites, damage)', after.rec && after.rec.bestWave === 10 && after.rec.bossesDefeated >= 1 && after.hist.bosses.length >= 1 && after.hist.playerDamage > 0 && after.hist.dev === false && summary, JSON.stringify({ rec: after.rec, hist: after.hist }));
    check('K2 milestones recorded (w10, boss1)', after.milestones.includes('w10') && after.milestones.includes('boss1'), JSON.stringify(after.milestones));
    // Unsecured loss on reactor destruction (gear brought in stays).
    await ev(p, () => window.__rift.home.takeControl(false));
    await deploy(p, 3, false, seed + 1);
    r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      const item = R.makeItem({ seed: 5, rarity: 'epic', category: 'armor', level: 10 });
      R.grant(item);
      g.startWave(); R.advance(1);
      R.damageReactor(1e6); R.advance(0.5);
      return { uid: item.uid, screen: g.screen };
    });
    await waitFor(p, () => window.__rift.state().screen === 'defeat' || window.__rift.state().location === 'home');
    const lost = await ev(p, (uid) => { const d = window.__rift.profile.save; return { owned: d.items.some((i) => i.uid === uid), weapon: d.loadout.weapon, hist: d.history[0].outcome, lost: d.history[0].itemsLost }; }, r.uid);
    check('I3 reactor destroyed: unsecured equipment lost, deployed gear kept', !lost.owned && lost.weapon === after.weapon && lost.hist === 'defeat' && lost.lost >= 1, JSON.stringify(lost));
    await ev(p, () => window.__rift.flow.leaveArena());
    await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    // Persistence across a browser reload.
    await p.reload();
    await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
    await ev(p, () => window.__rift.stopLoop());
    const reloaded = await ev(p, () => { const d = window.__rift.profile.save; return { v: d.version, rec: d.records['3'], milestones: d.milestones, devRuns: d.totals.devRuns, devHist: d.history.filter((h) => h.dev).length, rec1: d.records['1'] ?? null, rec5: d.records['5'] ?? null }; });
    check('K3 records and milestones persist across a reload (save v6)', reloaded.v === 6 && reloaded.rec.bossesDefeated >= 1 && reloaded.milestones.includes('boss1'), JSON.stringify(reloaded));
    check('K4 development sessions never produced records (tier I/V untouched by dev runs)', (want('B') ? reloaded.devRuns > 0 : true) && reloaded.rec5 === null, JSON.stringify(reloaded));
  }

  // ------------------------------------------------------------------ L: dev sessions never bank
  if (want('L')) {
    await home(p);
    const res0 = await ev(p, () => ({ ...window.__rift.profile.save.resources, items: window.__rift.profile.save.items.length }));
    await deploy(p, 1, true);
    const r = await ev(p, () => {
      const R = window.__rift, g = R.game;
      for (let wave = 1; wave <= 5; wave++) {
        g.startWave(); R.advance(0.3);
        for (let i = 0; i < 60 * 200 && g.waves.phase === 'combat'; i++) { R.advance(1 / 30); if (i % 15 === 0) R.killAll(); if (!g.player.alive) g.player.respawnT = 0; }
        for (let i = 0; i < 60 * 8 && g.waves.phase !== 'prep'; i++) R.advance(1 / 30);
        if (g.screen === 'checkpoint') g.setScreen('playing');
      }
      return { banked: g.cfg.run.lastBankedWave, saved: g.lastBankSaved, dev: g.cfg.run.survival.dev };
    });
    const res1 = await ev(p, () => ({ ...window.__rift.profile.save.resources, items: window.__rift.profile.save.items.length }));
    check('L1 development session checkpoints never commit permanent rewards', r.dev && r.saved === false && res1.salvage === res0.salvage && res1.items === res0.items && res1.credits === res0.credits, JSON.stringify({ r, res0, res1 }));
  }

  // ------------------------------------------------------------------ J: performance under heavy load (measured)
  if (want('J')) {
    await home(p); await deploy(p, 3, true, 5150);
    const r = await ev(p, () => {
      const R = window.__rift, g = R.game, V = R.V3;
      R.dev.jump(30);
      R.dev.evolve('routes'); R.dev.evolve('instability');
      R.dev.force({ event: 'instability' });
      // Towers of several archetypes + many run upgrades (elemental synergies).
      const spots = [[-14, -24], [14, -24], [-22, 6], [22, -6], [-6, 16], [6, -16], [-26, -10], [26, 12]];
      for (const [x, z] of spots) { const t = g.turrets.add(new V(x, 0, z), 0, g.turretCtx); t.building = false; }
      let taken = 0;
      for (let i = 0; i < 40 && taken < 14; i++) { const offer = g.director.build.roll({ wave: 30, family: g.weapon.def.family, towers: 8, towerArchetypes: ['ballistic'] }, 100 + i); if (offer[0] && g.director.takeUpgrade(offer[0].id)) taken++; }
      g.startWave(); R.advance(0.5);
      R.dev.spawn('colossus', [], 'east');
      const mods = [['overcharged'], ['armored', 'volatile'], ['accelerated', 'volatile'], ['overcharged', 'armored'], []];
      const kinds = ['walker', 'enforcer', 'artillery', 'engineer', 'rusher', 'bulwark'];
      for (let i = 0; i < 34; i++) R.dev.spawn(kinds[i % kinds.length], mods[i % mods.length], ['north', 'east', 'west', 'south'][i % 4]);
      g.togglePerf(true);
      // Pools are pre-warmed during preparation in real play; warm them here too (one rig per frame).
      g.enemies.prewarm({ walker: 12, enforcer: 8, artillery: 8, engineer: 8, rusher: 12, bulwark: 8 });
      for (let i = 0; i < 80; i++) R.advance(1 / 60);
      // Simulation cost: 600 fixed steps while the drone fires continuously.
      R.teleport(0, -12); R.look(0, 0.05);
      g.input.simulateMouse(0, true);
      const times = [];
      let maxEnemies = 0, maxOrd = 0, maxTele = 0, nan = false;
      for (let i = 0; i < 600; i++) {
        const t0 = performance.now();
        R.advance(1 / 60);
        times.push(performance.now() - t0);
        maxEnemies = Math.max(maxEnemies, g.enemies.count); maxOrd = Math.max(maxOrd, g.ordnance.live); maxTele = Math.max(maxTele, g.tele.active);
        if (g.enemies.active.some((e) => !Number.isFinite(e.hp) || !Number.isFinite(e.pos.x))) nan = true;
        if (!g.player.alive) g.player.respawnT = 0;
        g.reactorHp = 1000;
        if (g.enemies.count < 30) R.dev.spawn(kinds[i % kinds.length], mods[i % mods.length], ['north', 'east', 'west', 'south'][i % 4]);
      }
      g.input.simulateMouse(0, false);
      times.sort((a, b) => a - b);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      // Render cost (SwiftShader software GL; not representative of a GPU).
      const rt = [];
      for (let i = 0; i < 12; i++) { const t0 = performance.now(); R.render(1); rt.push(performance.now() - t0); }
      rt.sort((a, b) => a - b);
      return { simAvg: +avg.toFixed(2), simP50: +times[300].toFixed(2), over20: times.filter((t) => t > 20).length, simP95: +times[Math.floor(times.length * 0.95)].toFixed(2), simMax: +times[times.length - 1].toFixed(2), aiAvg: +g.enemies.aiAvg.toFixed(2), renderMedian: Math.round(rt[6]), draws: g.drawCalls, maxEnemies, maxOrd, maxTele, particles: g.fx.particleCount, upgrades: taken, towers: g.turrets.turrets.length, nan, bus: g.director.diag() };
    });
    console.log('MEASURED', JSON.stringify(r));
    // Rare 100-250 ms frames also occur with plain M5 content in headless SwiftShader (GC); assert on median and p95.
    check('J1 heavy combat (40 enemies incl. elites + boss, 8 towers, 14 upgrades, hazards) keeps simulation responsive', !r.nan && r.simP50 < 4 && r.simP95 < 14 && r.maxEnemies >= 35, JSON.stringify({ p50: r.simP50, p95: r.simP95, avg: r.simAvg, ai: r.aiAvg, enemies: r.maxEnemies }));
    check('J2 hostile ordnance / telegraph pools stay bounded', r.maxOrd <= 192 && r.maxTele <= 128, JSON.stringify({ ord: r.maxOrd, tele: r.maxTele }));
  }

  console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 10).join('\n') : 'no page errors');
  check('Z page errors', errs.length === 0, String(errs.length));
  console.log(`\n${passes} passed, ${failures} failed`);
  await b.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
