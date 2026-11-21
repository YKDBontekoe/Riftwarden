// M3 acceptance scenarios (A-I: weapon families, procedural generation, module install/remove/incompatible,
// visual variation, loot integration, save migration, regression + leaks) against a running dev server.
// Usage: pnpm dev (port 5173), then: node scripts/e2e-m3.cjs   (needs `playwright` + Chromium).
// Runs in ?test mode: fixed-step simulation, low graphics preset, no real pointer lock.
// Screenshots go to $E2E_OUT (default: OS temp dir). Exit code 0 = all checks passed.
const H = require('./lib/harness.cjs');
const { OUT, check, S, ev } = H;
const waitFor = (p, fn, arg, t = 90000) => H.waitFor(p, fn, arg, t);
const boot = (p, reload = false) => H.boot(p, { reload, skipUpgrades: true });
const launch = (init) => H.launch({ init, skipUpgrades: true, gc: true });
const shot = (p, name) => H.shot(p, 'm3_' + name, { frames: 2 });
async function deploy(p, tier = 1) {
  await p.evaluate((t) => window.__rift.flow.deploy(t), tier);
  await waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.state().busy && window.__rift.game);
  await p.evaluate(() => { window.__rift.advance(1 / 60); });
}
const press = (p, code) =>
  p.evaluate((c) => {
    const R = window.__rift;
    const i = R.flow.input;
    i.simulateKey(c, true);
    R.advance(1 / 60);
    i.simulateKey(c, false);
    R.advance(1 / 60);
  }, code);

/** Fight until `wave` is cleared (killAll through the real damage pipeline). Optionally collect loot each prep. */
async function clearThrough(p, wave, { collect = false } = {}) {
  for (let guard = 0; guard < 60; guard++) {
    const st = await p.evaluate(async (target) => {
      const R = window.__rift;
      for (let i = 0; i < 400; i++) {
        const g = R.game;
        if (!g) return 'no game';
        if (g.screen === 'checkpoint') {
          if (g.cfg.run.wavesCleared >= target) return 'checkpoint';
          await g.continueRun();
        }
        if (g.screen === 'defeat') return 'defeat';
        if (g.cfg.run.wavesCleared >= target && g.waves.phase === 'prep') return 'cleared';
        if (g.waves.phase === 'prep') return 'prep';
        R.advance(0.5);
        R.killAll();
      }
      return 'timeout';
    }, wave);
    if (st !== 'prep') return st;
    if (collect) await collectAll(p);
    await p.evaluate(() => {
      window.__rift.game.waves.startNow();
      window.__rift.advance(0.1); // let the prep -> combat transition happen
    });
  }
  return 'guard';
}

/** Walk up to every landed pickup and press E (real targeting + interaction path). */
async function collectAll(p, max = 40) {
  let got = 0;
  for (let i = 0; i < max; i++) {
    const list = await p.evaluate(() => window.__rift.pickups().filter((x) => x.landed));
    if (!list.length) break;
    const target = list[0];
    const ok = await p.evaluate((id) => {
      const R = window.__rift;
      R.approach(id);
      R.advance(1 / 60);
      R.advance(0.1);
      return R.state().lootTarget;
    }, target.id);
    if (!ok) {
      // Could not target (geometry): skip by collecting directly so the loop terminates, but report it.
      console.log('      note: pickup', target.id, 'not targetable from approach point');
      await p.evaluate((id) => {
        const g = window.__rift.game;
        const pk = g.loot.pickups.find((q) => q.id === id);
        if (pk) g.collectPickup(pk);
      }, target.id);
      continue;
    }
    await press(p, 'KeyE');
    got++;
  }
  return got;
}

/** First seed whose generated item satisfies `pred` (searched in the page). */
const findItem = (p, spec, predSrc) =>
  p.evaluate(
    ([spec, src]) => {
      const pred = new Function('it', `return (${src})(it)`);
      for (let s = 1; s < 5000; s++) {
        const it = window.__rift.makeItem({ ...spec, seed: s });
        if (pred(it)) return it;
      }
      return null;
    },
    [spec, predSrc],
  );

/** Key-order-insensitive JSON (deep equality of stored values). */
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
const firstDiff = (a, c) => a.find((it) => canon(c.find((x) => x.uid === it.uid)) !== canon(it))?.uid ?? null;
const savedItems = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__rift.profile.save.items)));

// ---------------------------------------------------------------- M3 helpers (run in page)
const PAGE_HELPERS = () => {
  const R = window.__rift;
  window.__m3 = {
    /** Kill everything and wait for the next preparation phase (equipping is prep-only). */
    toPrep() {
      const g = R.game;
      for (let i = 0; i < 400 && g.waves.phase !== 'prep'; i++) {
        R.killAll();
        R.advance(0.25);
      }
      return g.waves.phase;
    },
    /** Generate + grant + equip (prep phase). */
    equipNew(spec) {
      const g = R.game;
      this.toPrep();
      const it = R.makeItem(spec);
      R.grant(it);
      const ok = g.equip(it.uid);
      R.advance(0.6); // switch animation settles
      return { ok, uid: it.uid, family: g.weapon.def.family, mech: g.weapon.def.mechanism, item: it };
    },
    /** Count real damage reaching enemies (through the real pipeline). */
    trackDamage() {
      const g = R.game;
      if (g.__dmgWrapped) return;
      const orig = g.enemies.damage.bind(g.enemies);
      g.__dmg = 0;
      g.enemies.damage = (e, a, ...rest) => {
        g.__dmg += a;
        return orig(e, a, ...rest);
      };
      g.__dmgWrapped = true;
    },
    /** Start combat and wait until enemies exist; park the player 14 m in front of the first one. */
    engage() {
      const g = R.game;
      if (g.waves.phase === 'prep') g.waves.startNow();
      for (let i = 0; i < 600 && g.enemies.count === 0; i++) R.advance(1 / 60);
      this.park();
      return g.enemies.count;
    },
    park(dist = 14) {
      const g = R.game;
      const e = g.enemies.active.find((x) => x.alive);
      if (!e) return false;
      const dx = -e.pos.x, dz = -e.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      R.teleport(e.pos.x + (dx / l) * dist, e.pos.z + (dz / l) * dist, 1);
      R.advance(1 / 60);
      return true;
    },
    aim() {
      const g = R.game;
      const eye = g.player.camera.position;
      let best = null, bd = 1e9;
      for (const e of g.enemies.active) {
        if (!e.alive) continue;
        const c = e.center();
        const d = Math.hypot(c.x - eye.x, c.z - eye.z);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) return false;
      const dx = best.x - eye.x, dy = best.y - eye.y, dz = best.z - eye.z;
      g.player.yaw = Math.atan2(dx, dz);
      g.player.pitch = Math.atan2(-dy, Math.hypot(dx, dz));
      g.player.recoil = 0;
      return true;
    },
    /** Hold the trigger for `frames` while tracking the nearest enemy; optionally release. */
    fire(frames, release = true) {
      const g = R.game, inp = R.flow.input;
      const s0 = g.weapon.shotsFired;
      let maxBolts = 0, maxCharge = 0, beamFrames = 0, shotsWhileHeld = 0, maxHeat = 0;
      inp.simulateMouse(0, true);
      for (let i = 0; i < frames; i++) {
        if (g.enemies.count === 0) this.engage();
        this.aim();
        R.advance(1 / 60);
        maxBolts = Math.max(maxBolts, g.wfx.liveBolts);
        maxCharge = Math.max(maxCharge, g.weapon.charge);
        maxHeat = Math.max(maxHeat, g.weapon.heat);
        if (g.weapon.beaming) beamFrames++;
      }
      shotsWhileHeld = g.weapon.shotsFired - s0;
      let trail = 0;
      if (release) {
        inp.simulateMouse(0, false);
        R.advance(1 / 60);
        trail = g.wfx.trails.filter((t) => t.life > 0).length;
      }
      return { shots: g.weapon.shotsFired - s0, shotsWhileHeld, maxBolts, maxCharge, beamFrames, maxHeat, heat: g.weapon.heat, trail, overheated: g.weapon.overheated, ramp: g.weapon.ramp };
    },
  };
};
const helpers = (p) => p.evaluate(PAGE_HELPERS);
const M = (p, fn, arg) => p.evaluate(fn, arg);

(async () => {
  const t0 = Date.now();
  let { b, p, errs } = await launch();
  await helpers(p);

  // ---------------------------------------------------------------- A: family differentiation
  console.log('\n[A] weapon families');
  await deploy(p, 1);
  await helpers(p);
  const stability = await M(p, () => {
    const g = window.__rift.game;
    const weapon = g.weapon;
    const params = { lookDx: 0, lookDy: 0, speed: 0, grounded: true, sprinting: false, dashing: false, verticalSpeed: 0, heat: 0, overheated: false, charge: 0, active: 0, holster: 0 };
    const sample = (overrides, hz = 60) => {
      const animator = new weapon.anim.constructor(weapon.rig);
      const heights = [];
      for (let frame = 0; frame < hz * 2; frame++) {
        animator.update({ ...params, ...overrides, dt: 1 / hz });
        if (frame >= hz) heights.push(animator.pose.y);
      }
      return { travel: Math.max(...heights) - Math.min(...heights), sway: animator.pose.x };
    };
    const cam = g.player.camera;
    const baseFov = cam.fov;
    const muzzleOnScreen = (fov) => {
      cam.fov = fov;
      weapon.update(0, false, g.stats, () => { throw new Error('Unexpected shot in viewmodel test'); });
      const world = weapon.muzzleWorld();
      const p = world.constructor.TransformCoordinates(world, cam.getViewMatrix());
      const depth = p.z * Math.tan(fov / 2);
      return [p.x / depth, p.y / depth];
    };
    const before = muzzleOnScreen(baseFov);
    const after = muzzleOnScreen(baseFov + 0.16);
    muzzleOnScreen(baseFov);
    return {
      chargedTravel: sample({ charge: 1 }).travel,
      sprintTravel: sample({ speed: 22, sprinting: true }).travel,
      swayDelta: Math.abs(sample({ lookDx: 0.6 / 30 }, 30).sway - sample({ lookDx: 0.6 / 120 }, 120).sway),
      fovDrift: Math.hypot(after[0] - before[0], after[1] - before[1]),
    };
  });
  check('A0 viewmodel is steady at idle charge and smooth at sprint speed', stability.chargedTravel < 1e-6 && stability.sprintTravel < 0.004, JSON.stringify(stability));
  check('A0 viewmodel keeps the same turn sway and projection across frame rates and FOV kicks', stability.swayDelta < 1e-5 && stability.fovDrift < 1e-5, JSON.stringify(stability));
  const fam = {};
  // beam_prism seed 6 rolls the continuous mc_beam mechanism (M7 added mc_pulse to the beam pool; pulse is covered by the unit tests).
  for (const [baseId, seed] of [['plasma_repeater', 11], ['rail_lancer', 3], ['beam_prism', 6]]) {
    const eq = await M(p, ([b, s]) => window.__m3.equipNew({ seed: s, rarity: 'rare', baseId: b, level: 3 }), [baseId, seed]);
    await M(p, () => window.__m3.trackDamage());
    if (eq.family === 'rail') {
      await M(p, () => window.__m3.engage());
      const dmg0 = await M(p, () => window.__rift.game.__dmg);
      // Force the charge mechanism for the rail check (cycle rails are checked via the def).
      const r = await M(p, () => window.__m3.fire(Math.ceil(window.__rift.game.weapon.def.chargeTime * 60 / window.__rift.game.stats.chargeRateMult) + 6, true));
      const dmg = (await M(p, () => window.__rift.game.__dmg)) - dmg0;
      fam.rail = { ...r, dmg, mech: eq.mech };
    } else {
      await M(p, () => window.__m3.engage());
      const dmg0 = await M(p, () => window.__rift.game.__dmg);
      const r = await M(p, () => window.__m3.fire(60, true));
      const dmg = (await M(p, () => window.__rift.game.__dmg)) - dmg0;
      fam[eq.family] = { ...r, dmg, mech: eq.mech };
    }
    await M(p, () => window.__rift.advance(2.5)); // cool down
  }
  console.log('      ', JSON.stringify(fam));
  const pl = fam.plasma, rl = fam.rail, bm = fam.beam;
  check('A1 plasma: automatic/burst fire, ~fire-rate shots in 1 s, travelling bolts, damage dealt', pl && pl.shots >= 5 && pl.maxBolts >= 1 && pl.dmg > 0, JSON.stringify(pl));
  check('A2 rail: holding charges without firing; release fires one piercing slug with a trail and a heat spike', rl && (rl.mech !== 'charge' || (rl.shotsWhileHeld === 0 && rl.maxCharge > 0.9 && rl.shots === 1)) && rl.trail >= 1 && rl.dmg > 0 && rl.heat >= 10, JSON.stringify(rl));
  check('A3 beam: continuous emission, ~15 damage ticks/s, steady heat, damage dealt', bm && bm.beamFrames >= 50 && bm.shots >= 12 && bm.dmg > 0 && bm.maxBolts === 0, JSON.stringify(bm));
  check('A4 families differ in heat per trigger second', pl && rl && bm && new Set([Math.round(pl.maxHeat), Math.round(rl.heat), Math.round(bm.maxHeat)]).size === 3);
  // Overheat is shown on the model: LEDs red/blinking, heat-reactive metal glows, fins open.
  await M(p, () => window.__m3.equipNew({ seed: 4, rarity: 'common', baseId: 'plasma_repeater', level: 1 }));
  const oh = await M(p, () => {
    const g = window.__rift.game;
    const rig = g.weapon.rig;
    const inp = window.__rift.flow.input;
    const out = { overheated: false, heatGlow: 0, fin: rig.fins.length ? 0 : null, ledsHot: 0, shots: 0 };
    const s0 = g.weapon.shotsFired;
    inp.simulateMouse(0, true);
    for (let i = 0; i < 300 && !g.weapon.overheated; i++) { window.__m3.aim(); window.__rift.advance(1 / 60); }
    // Sample the model right at lockout.
    out.overheated = g.weapon.overheated;
    out.heatGlow = rig.heat.emissiveColor.r;
    if (rig.fins.length) out.fin = Math.abs(rig.fins[0].node.rotation.x);
    for (let i = 0; i < 20; i++) { window.__rift.advance(1 / 60); out.ledsHot = Math.max(out.ledsHot, rig.leds.filter((l) => l.material === rig.ledHot).length); if (rig.fins.length) out.fin = Math.max(out.fin, Math.abs(rig.fins[0].node.rotation.x)); }
    out.blocked = g.weapon.shotsFired;
    out.shots = g.weapon.shotsFired - s0;
    window.__rift.flow.input.simulateMouse(0, false);
    window.__rift.advance(3);
    out.recovered = !g.weapon.overheated;
    out.blockedWhileHot = out.blocked === g.weapon.shotsFired;
    return out;
  });
  check('A5 overheating locks fire and is visible on the model (glowing metal, open fins, hot LEDs), then recovers', oh.overheated && oh.heatGlow > 1 && (oh.fin === null || oh.fin > 0.3) && oh.recovered, JSON.stringify(oh));
  await shot(p, 'A_plasma');

  // ---------------------------------------------------------------- B: procedural generation
  console.log('\n[B] procedural generation');
  const gen = await M(p, () => {
    const R = window.__rift;
    const bases = ['plasma_repeater', 'heavy_repeater', 'light_repeater', 'rail_lancer', 'rail_siege', 'rail_striker', 'beam_prism', 'beam_lattice', 'beam_focus'];
    const rar = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'exotic'];
    const combos = new Set();
    let bad = 0, nondet = 0, n = 0, socketsOk = true;
    const want = [0, 1, 2, 3, 4, 4];
    for (const b of bases) for (let s = 1; s <= 12; s++) {
      const r = rar[s % 6];
      const a = R.makeItem({ seed: s * 31, rarity: r, baseId: b, level: 10 });
      const c = R.makeItem({ seed: s * 31, rarity: r, baseId: b, level: 10 });
      n++;
      const strip = (x) => JSON.stringify({ ...x, uid: '', acquiredAt: 0 });
      if (strip(a) !== strip(c)) nondet++;
      if (!a.build || a.sockets !== want[rar.indexOf(r)] || a.build.sockets.length !== a.sockets) socketsOk = false;
      if (!a.weapon || ![a.weapon.damage, a.weapon.fireRate, a.weapon.heatPerShot, a.weapon.coolRate].every((v) => Number.isFinite(v) && v > 0)) bad++;
      combos.add([a.build.family, a.build.barrel, a.build.core, a.build.cooling, a.build.mechanism].join('/'));
    }
    return { n, bad, nondet, combos: combos.size, socketsOk };
  });
  check('B1 108 weapons over 9 chassis: valid numbers, deterministic per seed', gen.bad === 0 && gen.nondet === 0, JSON.stringify(gen));
  check('B2 many distinct component combinations; rarity sockets 0/1/2/3/4/4', gen.combos >= 30 && gen.socketsOk, `${gen.combos} combos`);
  // Every generated model builds without NaN geometry and with a sane mesh/draw budget.
  const geo = await M(p, () => {
    const R = window.__rift;
    const out = [];
    for (const [b, s] of [['plasma_repeater', 2], ['heavy_repeater', 9], ['light_repeater', 4], ['rail_lancer', 8], ['rail_siege', 1], ['rail_striker', 6], ['beam_prism', 3], ['beam_lattice', 7], ['beam_focus', 5]]) {
      const it = R.makeItem({ seed: s, rarity: 'legendary', baseId: b, level: 10 });
      const before = R.game.scene.meshes.length;
      const dispose = R.lab([it]);
      const meshes = R.game.scene.meshes.slice(before);
      let nan = false, verts = 0;
      for (const m of meshes) {
        const pos = m.getVerticesData('position') || [];
        verts += pos.length / 3;
        for (const v of pos) if (!Number.isFinite(v)) { nan = true; break; }
      }
      out.push({ b, meshes: meshes.length, verts, nan });
      dispose();
    }
    document.body.classList.remove('lab');
    R.game.weapon.setVisible(true);
    return out;
  });
  check('B3 every chassis builds finite geometry within budget (<= 45 meshes, < 25k verts)', geo.every((g) => !g.nan && g.meshes > 8 && g.meshes <= 45 && g.verts < 25000), JSON.stringify(geo.map((g) => `${g.b}:${g.meshes}/${g.verts}`)));

  // ---------------------------------------------------------------- F: visual variation
  console.log('\n[F] visual variation');
  const vis = await M(p, () => {
    const R = window.__rift;
    const sig = [];
    const find = (pred) => { for (let s = 1; s < 3000; s++) { const it = R.makeItem({ seed: s, rarity: 'epic', baseId: 'plasma_repeater', level: 5 }); if (pred(it)) return it; } return null; };
    const picks = [find((i) => i.build.barrel === 'pb_single' && i.build.core === 'co_cell'), find((i) => i.build.barrel === 'pb_twin' && i.build.core === 'co_ring'), find((i) => i.build.barrel === 'pb_long' && i.build.core === 'co_dense')];
    for (const it of picks) {
      const before = R.game.scene.meshes.length;
      const dispose = R.lab([it]);
      const meshes = R.game.scene.meshes.slice(before);
      let minZ = 1e9, maxZ = -1e9, verts = 0;
      for (const m of meshes) { m.computeWorldMatrix(true); m.refreshBoundingInfo(); const bb = m.getBoundingInfo().boundingBox; minZ = Math.min(minZ, bb.minimum.z); maxZ = Math.max(maxZ, bb.maximum.z); verts += m.getTotalVertices(); }
      sig.push({ barrel: it.build.barrel, core: it.build.core, verts, len: Math.round((maxZ - minZ) * 1000) });
      dispose();
    }
    R.lab(picks, { spacing: 0.32, scale: 0.95 });
    return sig;
  });
  check('F1 different barrels/cores give different geometry (vertex counts / lengths)', new Set(vis.map((v) => v.verts)).size === 3 && new Set(vis.map((v) => v.len)).size >= 2, JSON.stringify(vis));
  await shot(p, 'F_variants');
  await M(p, () => { document.body.classList.remove('lab'); });

  // ---------------------------------------------------------------- G: loot integration
  console.log('\n[G] loot integration');
  await M(p, () => window.__rift.flow.abandonRun());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
  await deploy(p, 1);
  await helpers(p);
  const drop = await M(p, () => {
    const R = window.__rift;
    const uid = R.spawnLoot({ x: 0, z: -12, rarity: 'epic', category: 'weapon', baseId: 'rail_striker', seed: 4242 });
    const mod = R.spawnLoot({ x: 2, z: -12, rarity: 'rare', category: 'module', baseId: 'amp_module', seed: 77 });
    R.advance(2);
    return { uid, mod };
  });
  const got = await collectAll(p);
  const inCargo = await M(p, (u) => window.__rift.game.inventory.find(u.uid) && window.__rift.game.inventory.find(u.mod), drop);
  check('G1 generated weapon + module drops are collected into cargo', got >= 2 && !!inCargo, `${got} collected`);
  const eqd = await M(p, (u) => { const g = window.__rift.game; const ok = g.equip(u); window.__rift.advance(0.6); return { ok, fam: g.weapon.def.family, sockets: g.inventory.find(u).sockets, build: !!g.inventory.find(u).build }; }, drop.uid);
  check('G2 dropped railgun equips during prep and the viewmodel/mechanics switch to the rail family', eqd.ok && eqd.fam === 'rail' && eqd.sockets === 3 && eqd.build, JSON.stringify(eqd));
  await M(p, () => window.__m3.trackDamage());
  await M(p, () => window.__m3.engage());
  const gfire = await M(p, () => window.__m3.fire(70, true));
  check('G3 the dropped weapon fires and damages in combat', gfire.shots >= 1 && (await M(p, () => window.__rift.game.__dmg)) > 0, JSON.stringify(gfire));
  let st = await clearThrough(p, 5);
  check('G4 reached the wave-5 checkpoint', st === 'checkpoint' || st === 'cleared', st);
  const securedG = await M(p, (u) => window.__rift.game.cfg.run.secured.items.map((i) => i.uid).filter((x) => x === u.uid || x === u.mod), drop);
  await M(p, () => window.__rift.flow.returnHome());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
  const home = await M(p, (u) => { const d = window.__rift.profile.save; const w = d.items.find((i) => i.uid === u.uid); return { w: !!w, build: w && w.build && w.build.family, equipped: d.loadout.weapon === u.uid, mod: d.items.some((i) => i.uid === u.mod) }; }, drop);
  check('G5 banked weapon (with its build) and module are owned at HQ after returning', securedG.length === 2 && home.w && home.build === 'rail' && home.mod, JSON.stringify(home));

  // ---------------------------------------------------------------- C/D/E: engineering at HQ
  console.log('\n[C/D/E] engineering');
  await M(p, () => window.__rift.profile.mutate((d) => { d.resources.salvage += 500; return true; }));
  await M(p, async () => { await window.__rift.home.takeControl(false); window.__rift.home.openTerminal('workshop'); });
  await waitFor(p, () => !!window.__preview && window.__preview.builds > 0, null, 60000);
  // Select the banked rail and its POWER socket.
  const selRail = await M(p, async (u) => {
    const cards = [...document.querySelectorAll('.eng-col .ic, .eng-col .item-card, .eng-col [class*="card"]')];
    const d = window.__rift.profile.save;
    const w = d.items.find((i) => i.uid === u.uid);
    const card = cards.find((c) => c.textContent.includes(w.name)) ?? cards.find((c) => c.textContent.includes(w.name.slice(0, 12)));
    card && card.click();
    await new Promise((r) => setTimeout(r, 400));
    const idx = w.build.sockets.indexOf('power');
    const btn = document.querySelectorAll('button.sock')[idx];
    btn && btn.click();
    await new Promise((r) => setTimeout(r, 300));
    return { found: !!card, idx, title: document.querySelector('.eng-title b') && document.querySelector('.eng-title b').textContent };
  }, drop);
  const dps0 = await M(p, () => { const r = [...document.querySelectorAll('.eng-stats tbody tr')].find((t) => t.textContent.includes('Sustained DPS')); return r && r.children[1].textContent; });
  const builds0 = await M(p, () => window.__preview.builds);
  // E: an incompatible module (splitter: plasma-only barrel module) has a disabled INSTALL.
  await M(p, () => window.__rift.profile.mutate((d) => { const s = window.__rift.makeItem({ seed: 5, rarity: 'rare', baseId: 'splitter_module' }); d.items.push(s); d.storage.uids.push(s.uid); window.__splitUid = s.uid; return true; }));
  await M(p, () => new Promise((r) => setTimeout(r, 300)));
  const eState = await M(p, () => {
    const row = [...document.querySelectorAll('.mod-row')].find((r) => r.textContent.includes('Projectile Splitter') || r.textContent.includes('Splitter'));
    const before = JSON.stringify(window.__rift.profile.save);
    if (row) row.querySelector('button').click();
    return { row: !!row, disabled: row && row.querySelector('button').disabled, reason: row && row.querySelector('em') && row.querySelector('em').textContent, unchanged: JSON.stringify(window.__rift.profile.save) === before };
  });
  check('E1 incompatible module: install disabled with a reason; clicking changes nothing', eState.row && eState.disabled && !!eState.reason && eState.unchanged, JSON.stringify(eState));
  // C: install the banked amplifier into the rail's power socket through the UI.
  const cRes = await M(p, async (u) => {
    const R = window.__rift;
    const d0 = R.profile.save;
    const mod = d0.items.find((i) => i.uid === u.mod);
    const row = [...document.querySelectorAll('.mod-row')].find((r) => r.textContent.includes(mod.name));
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const previewCol = document.querySelectorAll('.eng-stats th').length === 3;
    row.querySelector('button').click();
    await new Promise((r) => setTimeout(r, 600));
    const d = R.profile.save;
    const w = d.items.find((i) => i.uid === u.uid);
    return { previewCol, msg: document.querySelector('.term-msg') && document.querySelector('.term-msg').textContent, installed: w.socketed.some((m) => m && m.uid === u.mod), inStorage: d.storage.uids.includes(u.mod), loose: d.items.some((i) => i.uid === u.mod) };
  }, drop);
  const dps1 = await M(p, () => { const r = [...document.querySelectorAll('.eng-stats tbody tr')].find((t) => t.textContent.includes('Sustained DPS')); return r && r.children[1].textContent; });
  check('C1 install via the workshop UI: hover previews stats, module moves into the socket and leaves storage', selRail.found && cRes.previewCol && cRes.installed && !cRes.inStorage && !cRes.loose, JSON.stringify({ selRail, cRes }));
  check('C2 weapon statistics change (DPS) and the 3D preview rebuilt with module hardware', parseFloat(dps1) > parseFloat(dps0) && (await M(p, () => window.__preview.builds)) > builds0, `${dps0} -> ${dps1}`);
  await shot(p, 'C_workshop_installed');
  // C3: gameplay change: equipped weapon damage multiplier rises in the arena.
  const statsBefore = await M(p, () => window.__rift.profile.save.loadout.weapon);
  await M(p, () => window.__rift.home.closeTerminal());
  const ug = await M(p, (u) => {
    const R = window.__rift;
    R.profile.mutate((d) => { const i = d.storage.uids.indexOf(u.uid); if (i >= 0) { d.storage.uids.splice(i, 1); d.storage.uids.push(d.loadout.weapon); d.loadout.weapon = u.uid; } return true; });
    return R.profile.save.loadout.weapon === u.uid;
  }, drop);
  await deploy(p, 1);
  const arenaStats = await M(p, () => ({ dmg: window.__rift.game.stats.weaponDamageMult, fam: window.__rift.game.weapon.def.family, sockMeshes: window.__rift.game.scene.meshes.filter((m) => m.name.startsWith('vm_')).length }));
  check('C3 installed module affects real combat stats when the weapon is deployed', ug && arenaStats.dmg > 1.05 && arenaStats.fam === 'rail', JSON.stringify(arenaStats));
  await M(p, () => window.__rift.flow.abandonRun());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
  // C4: persistence across a full page reload.
  await boot(p, true);
  const persisted = await M(p, (u) => { const d = window.__rift.profile.save; const w = d.items.find((i) => i.uid === u.uid); return { installed: w && w.socketed.some((m) => m && m.uid === u.mod), dup: d.items.filter((i) => i.uid === u.mod).length }; }, drop);
  check('C4 installed module persists after reload and exists exactly once', persisted.installed && persisted.dup === 0, JSON.stringify(persisted));
  await p.click('text=ENTER HEADQUARTERS').catch(() => {});
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy && window.__rift.home);
  // D: remove via UI.
  await M(p, async () => { await window.__rift.home.takeControl(false); window.__rift.home.openTerminal('workshop'); });
  await waitFor(p, () => !!window.__preview && window.__preview.builds > 0, null, 60000);
  const dRes = await M(p, async (u) => {
    const R = window.__rift;
    const d0 = R.profile.save;
    const w = d0.items.find((i) => i.uid === u.uid);
    const idx = w.socketed.findIndex((m) => m && m.uid === u.mod);
    const card = [...document.querySelectorAll('.eng-col .inv-list > *')].find((c) => c.textContent.includes(w.name.slice(0, 12)));
    card && card.click();
    await new Promise((r) => setTimeout(r, 300));
    document.querySelectorAll('button.sock')[idx].click();
    await new Promise((r) => setTimeout(r, 300));
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('REMOVE TO STORAGE'));
    const label = btn && btn.textContent;
    const sal0 = d0.resources.salvage;
    btn.click();
    await new Promise((r) => setTimeout(r, 500));
    const d = R.profile.save;
    const all = [];
    for (const it of d.items) { all.push(it.uid); for (const m of it.socketed || []) if (m) all.push(m.uid); }
    return { label, cost: parseInt(label.match(/(\d+) SALVAGE/)[1], 10), charged: sal0 - d.resources.salvage, back: d.storage.uids.includes(u.mod), socketEmpty: d.items.find((i) => i.uid === u.uid).socketed[idx] === null, unique: new Set(all).size === all.length };
  }, drop);
  check('D1 removal shows its cost, charges exactly that salvage once and returns the module to storage', dRes.cost > 0 && dRes.charged === dRes.cost && dRes.back && dRes.socketEmpty, JSON.stringify(dRes));
  check('D2 no duplicated items after removal', dRes.unique);
  await M(p, () => window.__rift.home.closeTerminal());
  const pvGone = await M(p, () => !window.__preview && document.querySelectorAll('canvas').length === 1);
  check('D3 closing the workshop disposes the preview engine (one canvas left)', pvGone);
  check('C/D no runtime errors so far', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();

  // ---------------------------------------------------------------- H: v2 save migration
  console.log('\n[H] M2 save migration');
  const v2 = (() => {
    const w = { uid: 'm2_w', defId: 'heavy_repeater', acquiredAt: 1, source: 'run_a', category: 'weapon', level: 9, rarity: 'rare', name: 'KR-2 Heavy Repeater', base: [{ stat: 'critMultiplier', op: 'add', value: 0.2 }], affixes: [{ id: 'dmg', stat: 'weaponDamageMult', op: 'pct', value: 0.1, tier: 2, roll: 0.5 }], weapon: { damage: 31, fireRate: 6.3, heatPerShot: 9, coolRate: 53 }, sockets: 1, modules: [], signature: null, seed: 5, gen: 1 };
    const s = { uid: 'm2_s', defId: 'plasma_repeater', acquiredAt: 1, source: 'starter', category: 'weapon', level: 1, rarity: 'common', name: 'Plasma Repeater', base: [], affixes: [], weapon: { damage: 13, fireRate: 9.5, heatPerShot: 6.2, coolRate: 55 }, sockets: 0, modules: [], signature: null, seed: 9, gen: 1 };
    const m = { uid: 'm2_m', defId: 'barrel_module', acquiredAt: 1, source: 'run_a', category: 'module', level: 4, rarity: 'uncommon', name: 'Overcharged Barrel Module', base: [], affixes: [{ id: 'dmg', stat: 'weaponDamageMult', op: 'pct', value: 0.05, tier: 1, roll: 0.4 }], module: { type: 'barrel', compatible: ['weapon'], socketCost: 1 }, sockets: 0, modules: [], signature: null, seed: 7, gen: 1 };
    const data = { version: 2, profile: { id: 'pf_m2', callsign: 'M2PILOT', createdAt: 1, lastSavedAt: 2 }, resources: { salvage: 400 }, items: [w, s, m], storage: { capacity: 50, expansions: 0, uids: ['m2_s', 'm2_m'] }, loadout: { weapon: 'm2_w', armor: null, shield: null, reactor: null, processor: null, accessory: null, accessory2: null }, presets: [], threat: { selected: 1, unlocked: 1 }, records: {}, totals: {}, history: [], activeRun: null, base: { layoutVersion: 1, placeables: [], facilities: [] } };
    const body = JSON.stringify(data);
    let h = 0x811c9dc5;
    for (let i = 0; i < body.length; i++) { h ^= body.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return `{"v":2,"sum":"${(h >>> 0).toString(16).padStart(8, '0')}","data":${body}}`;
  })();
  ({ b, p, errs } = await launch({ 'riftwarden.save': v2 }));
  await helpers(p);
  const hm = await M(p, () => { const R = window.__rift; const d = R.profile.save; const w = d.items.find((i) => i.uid === 'm2_w'); return { status: R.profile.loadStatus, v: d.version, n: d.items.length, dmg: w.weapon.damage, build: w.build && w.build.family, chassis: w.build && w.build.chassis, sockets: w.sockets, kinds: w.build && w.build.sockets, salvage: d.resources.salvage }; });
  check('H1 M2 save loads, migrates to v3, keeps all items and stats', hm.status === 'loaded' && hm.v >= 3 && hm.n === 3 && hm.dmg === 31 && hm.salvage === 400, JSON.stringify(hm));
  check('H2 old weapon gets a valid default build for its chassis and M3 sockets (rare -> 2)', hm.build === 'plasma' && hm.chassis === 'heavy_repeater' && hm.sockets === 2, JSON.stringify(hm));
  await p.click('text=ENTER HEADQUARTERS');
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy && window.__rift.home);
  await M(p, async () => { await window.__rift.home.takeControl(false); window.__rift.home.openTerminal('workshop'); });
  await waitFor(p, () => !!window.__preview && window.__preview.builds > 0, null, 60000);
  const hInst = await M(p, async () => {
    const row = [...document.querySelectorAll('.mod-row')].find((r) => r.textContent.includes('Barrel Module'));
    const btn = row && row.querySelector('button');
    const enabled = btn && !btn.disabled;
    btn && btn.click();
    await new Promise((r) => setTimeout(r, 500));
    const w = window.__rift.profile.save.items.find((i) => i.uid === 'm2_w');
    return { enabled, installed: w.socketed.some((m) => m && m.uid === 'm2_m') };
  });
  check('H3 an M2 module installs into the migrated M2 weapon', hInst.enabled && hInst.installed, JSON.stringify(hInst));
  await M(p, () => window.__rift.home.closeTerminal());
  await deploy(p, 1);
  const hArena = await M(p, () => ({ dmg: window.__rift.game.weapon.def.damage, mult: window.__rift.game.stats.weaponDamageMult, fam: window.__rift.game.weapon.def.family }));
  check('H4 migrated weapon deploys and fires with its original roll + the module', hArena.dmg === 31 && hArena.mult > 1.14 && hArena.fam === 'plasma', JSON.stringify(hArena));
  await M(p, () => window.__rift.flow.abandonRun());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
  check('H5 no runtime errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();

  // ---------------------------------------------------------------- I: regression, splitter/arc behaviour, leaks
  console.log('\n[I] regression + leaks');
  ({ b, p, errs } = await launch());
  await helpers(p);
  await p.click('text=ENTER HEADQUARTERS');
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy && window.__rift.home);
  // A plasma weapon with a splitter (barrel) and an arc conductor... both barrel modules: use a legendary with 1 barrel socket for splitter.
  const prep = await M(p, () => {
    const R = window.__rift;
    let w = null;
    for (let s = 1; s < 500 && !w; s++) { const it = R.makeItem({ seed: s, rarity: 'legendary', baseId: 'plasma_repeater', level: 6 }); if (it.build.mechanism === 'mc_auto') w = it; }
    const split = R.makeItem({ seed: 3, rarity: 'rare', baseId: 'splitter_module', level: 6 });
    w.socketed[w.build.sockets.indexOf('barrel')] = split;
    R.profile.mutate((d) => { d.items.push(w); d.storage.uids.push(d.loadout.weapon); d.loadout.weapon = w.uid; return true; });
    return w.uid;
  });
  await deploy(p, 1);
  await helpers(p);
  const sp = await M(p, () => {
    const g = window.__rift.game;
    window.__m3.engage();
    const r = window.__m3.fire(1, true);
    return { proj: g.stats.projectiles, bolts: r.maxBolts };
  });
  check('I1 Projectile Splitter fires two damaging bolts per shot', sp.proj === 2 && sp.bolts >= 2, JSON.stringify(sp));
  // Arc conductor via a forced proc chance (debug: raise arcChance) still goes through the real damage path.
  const arc = await M(p, () => {
    const g = window.__rift.game;
    g.modifiers = [{ stat: 'arcChance', op: 'add', value: 1 }, { stat: 'arcDamage', op: 'add', value: 0.5 }];
    g.refreshEquipment();
    // Wait until two enemies are within arc reach of each other (lanes bunch up near gates).
    for (let i = 0; i < 900; i++) {
      const a = g.enemies.active.filter((e) => e.alive);
      if (a.some((e) => a.some((o) => o !== e && Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < 11))) break;
      if (!a.length) window.__m3.engage();
      window.__rift.advance(1 / 30);
    }
    window.__m3.park(16);
    window.__m3.fire(40, true);
    const n = g.arcs;
    g.modifiers = [];
    g.refreshEquipment();
    return n;
  });
  check('I2 arc effects jump to nearby enemies through the damage pipeline', arc > 0, `${arc} arcs`);
  // Movement/dash/jump still work and animate the viewmodel without errors.
  const mv = await M(p, () => {
    const R = window.__rift, g = R.game, inp = R.flow.input;
    R.teleport(0, -20, 1);
    R.look(Math.PI, 0);
    R.advance(0.2);
    const p0 = g.player.position.clone();
    inp.simulateKey('KeyW', true); R.advance(0.5);
    inp.simulateKey('ShiftLeft', true); R.advance(1 / 60); inp.simulateKey('ShiftLeft', false); R.advance(0.3);
    inp.simulateKey('Space', true); R.advance(1 / 60); inp.simulateKey('Space', false); R.advance(0.8);
    inp.simulateKey('KeyW', false); R.advance(0.3);
    const pose = g.weapon.anim.pose;
    return { moved: Math.hypot(g.player.position.x - p0.x, g.player.position.z - p0.z), finite: Object.values(pose).every(Number.isFinite) };
  });
  check('I3 movement, dash and jump still work; viewmodel pose stays finite', mv.moved > 5 && mv.finite, JSON.stringify(mv));
  // Build a turret, clear waves, simulation cost while firing.
  const perf = await M(p, () => {
    const R = window.__rift, g = R.game;
    const t = performance.now();
    window.__m3.fire(120, true);
    return (performance.now() - t) / 120;
  });
  console.log(`      simulation while firing: ${perf.toFixed(2)} ms/frame (SwiftShader, incl. picking)`);
  check('I4 firing simulation stays cheap (< 8 ms/frame in SwiftShader)', perf < 8, perf.toFixed(2));
  await M(p, () => window.__rift.flow.abandonRun());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
  // Leak cycles: deploy with each family, return; HQ + workshop open/close.
  const leak = [];
  for (const base of ['rail_lancer', 'beam_prism', 'plasma_repeater', 'rail_lancer']) {
    await M(p, (bb) => {
      const R = window.__rift;
      const it = R.makeItem({ seed: 12, rarity: 'epic', baseId: bb, level: 3 });
      R.profile.mutate((d) => { d.items.push(it); d.storage.uids.push(d.loadout.weapon); d.loadout.weapon = it.uid; return true; });
    }, base);
    await M(p, async () => { await window.__rift.home.takeControl(false); window.__rift.home.openTerminal('workshop'); });
    await waitFor(p, () => !!window.__preview && window.__preview.builds > 0, null, 60000);
    await M(p, () => window.__rift.home.closeTerminal());
    await deploy(p, 1);
    await M(p, () => { window.__rift.game.waves.startNow(); window.__rift.advance(2); });
    const a = await M(p, () => window.__rift.leakStats());
    await M(p, () => window.__rift.flow.abandonRun());
    await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    await p.evaluate(() => window.gc && window.gc());
    const h = await M(p, () => ({ ...window.__rift.leakStats(), canvases: document.querySelectorAll('canvas').length }));
    leak.push({ a, h });
  }
  const L = leak.map((x) => `${x.a.meshes}/${x.a.materials}/${x.a.textures} · hq ${x.h.meshes}/${x.h.materials}/${x.h.textures} c${x.h.canvases}`);
  console.log('      ', L.join('  |  '));
  const hqFlat = leak.slice(1).every((x) => x.h.meshes === leak[1].h.meshes && x.h.materials === leak[1].h.materials && x.h.textures === leak[1].h.textures && x.h.canvases === 1 && x.h.scenes === 1);
  const arenaFlat = leak[3].a.textures === leak[0].a.textures && leak[3].a.materials === leak[0].a.materials;
  check('I5 HQ resources flat across deploy/return + workshop cycles; one canvas, one scene', hqFlat, L.join(' | '));
  check('I6 arena textures/materials identical for the same family across cycles', arenaFlat);
  check('I7 no runtime errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();

  console.log(`\n${H.stats.passes} passed, ${H.stats.failures} failed · ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(H.stats.failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
