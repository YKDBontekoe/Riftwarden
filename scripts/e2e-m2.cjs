// M2 acceptance scenarios (A-I: loot, generation, equipment, banking, loss, ownership exploit,
// lifetime, save compatibility, regression) against a running dev server.
// Usage: pnpm dev (port 5173), then: node scripts/e2e-m2.cjs   (needs `playwright` + Chromium).
// Runs in ?test mode: fixed-step simulation, low graphics preset, no real pointer lock.
// Screenshots go to $E2E_OUT (default: OS temp dir). Exit code 0 = all checks passed.
const H = require('./lib/harness.cjs');
/** combat/heat.ts DAMAGE_PACE: player damage tempo applied at fire time (stored rolls stay). */
const DAMAGE_PACE = 1.9;
const { OUT, check, S, ev } = H;
const waitFor = (p, fn, arg, t = 90000) => H.waitFor(p, fn, arg, t);
const boot = (p, reload = false) => H.boot(p, { reload, skipUpgrades: true });
const launch = (init) => H.launch({ init, skipUpgrades: true, gc: true });
const shot = (p, name) => H.shot(p, 'm2_' + name, { frames: 2 });
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

(async () => {
  const t0 = Date.now();
  let { b, ctx, p, errs } = await launch();
  await p.click('button.deploy');
  await waitFor(p, () => window.__rift.state().screen === 'home');
  const starterUid = await p.evaluate(() => window.__rift.profile.save.loadout.weapon);

  // ------------------------------------------------------------------ A: enemy loot
  console.log('\n== Scenario A: enemy loot -> physical pickup -> collect');
  await deploy(p);
  let s = await S(p);
  check('A0 deployed with the starter repeater', s.location === 'arena' && s.weaponDamage === 13 && s.cargo === 0);
  const a1 = await p.evaluate(() => {
    const R = window.__rift;
    const g = R.game;
    g.dropChanceMult = 8; // make kill drops near-certain for this check
    g.waves.startNow();
    const deaths = [];
    const orig = g.dropLoot.bind(g);
    g.dropLoot = (src, at, w) => {
      if (src !== 'wave') deaths.push([at.x, at.z]);
      return orig(src, at, w);
    };
    for (let i = 0; i < 300 && !(g.cfg.run.wavesCleared >= 1 && g.waves.phase === 'prep'); i++) {
      R.advance(0.5);
      R.killAll();
    }
    R.advance(1);
    g.dropLoot = orig;
    g.dropChanceMult = 1;
    const pk = R.pickups();
    // Every enemy-sourced pickup landed within ~3.5 m of a kill position.
    const nearKill = pk.filter((q) => deaths.some(([x, z]) => Math.hypot(q.x - x, q.z - z) < 3.6)).length;
    return { kills: g.cfg.run.kills, deaths: deaths.length, pickups: pk.length, nearKill, landed: pk.every((q) => q.landed), cargo: g.inventory.cargoUsed };
  });
  check('A1 killed enemies produced physical drops (not auto-collected)', a1.pickups >= 3 && a1.cargo === 0, JSON.stringify(a1));
  check('A1 drops land near the defeated enemies (+ wave reward at the reactor)', a1.nearKill >= a1.pickups - 1, `${a1.nearKill}/${a1.pickups} near a kill`);
  await p.evaluate(() => window.__rift.render(1));
  const plist = await p.evaluate(() => window.__rift.pickups());
  const pk = plist[0];
  await p.evaluate((id) => {
    const R = window.__rift;
    R.approach(id);
    R.advance(1 / 60);
    R.advance(0.15);
  }, pk.id);
  s = await S(p);
  check('A2 approaching a pickup targets it', s.lootTarget === pk.uid, `${s.lootTarget} vs ${pk.uid}`);
  await p.evaluate(() => window.__rift.advance(0.1)); // HUD publishes at 20 Hz
  const prompt = await p.textContent('.loot-prompt').catch(() => null);
  check('A3 prompt shows name, rarity, level, category and E', !!prompt && prompt.includes(pk.name) && /LV \d+/.test(prompt) && prompt.toUpperCase().includes(pk.rarity.toUpperCase()) && prompt.toUpperCase().includes(pk.category === 'module' ? 'UPGRADE MODULE' : pk.category.toUpperCase()), prompt ?? '');
  await shot(p, 'A_prompt');
  await press(p, 'KeyE');
  s = await S(p);
  const a4 = await p.evaluate((uid) => ({ status: window.__rift.game.inventory.status(uid), inWorld: window.__rift.pickups().some((q) => q.uid === uid) }), pk.uid);
  check('A4 collected item is in the run inventory as UNSECURED', a4.status === 'unsecured' && s.cargo === 1, JSON.stringify(a4));
  check('A5 pickup removed from the world', !a4.inWorld && s.pickups === plist.length - 1);
  const looked = await p.evaluate(() => {
    const R = window.__rift;
    R.look(Math.PI, 0);
    R.advance(0.1);
    return R.state().lootTarget;
  });
  check('A6 looking away clears the loot target', looked === null);

  // ------------------------------------------------------------------ B: generation in the live game
  console.log('\n== Scenario B: procedural generation (live game rolls)');
  const b1 = await p.evaluate(() => {
    const g = window.__rift.game;
    const items = [];
    for (let i = 0; i < 300; i++) items.push(...g.rollItems(i % 3 === 0 ? 'bulwark' : 'checkpoint', 10));
    const uids = new Set(items.map((x) => x.uid));
    const valid = items.every((x) => Number.isFinite(x.level) && x.level >= 1 && x.name && [...x.base, ...x.affixes].every((a) => Number.isFinite(a.value)));
    const cats = new Set(items.map((x) => x.category));
    const rar = {};
    for (const x of items) rar[x.rarity] = (rar[x.rarity] || 0) + 1;
    const names = new Set(items.map((x) => x.name)).size;
    return { n: items.length, unique: uids.size === items.length, valid, cats: cats.size, rar, names };
  });
  check('B1 live rolls: unique identities, valid values, all categories, varied names', b1.unique && b1.valid && b1.cats === 9 && b1.names > b1.n * 0.5, JSON.stringify(b1));
  check('B2 checkpoint/elite sources never roll below their minimum rarity', !b1.rar.common, JSON.stringify(b1.rar));
  const b3 = await p.evaluate(() => {
    const R = window.__rift;
    const a = R.makeItem({ seed: 4242, rarity: 'epic', category: 'shield', level: 20 });
    const c = R.makeItem({ seed: 4242, rarity: 'epic', category: 'shield', level: 20 });
    const strip = (x) => JSON.stringify({ ...x, uid: '', acquiredAt: 0 });
    return strip(a) === strip(c);
  });
  check('B3 same seed + spec reproduces the same item', b3);

  // ------------------------------------------------------------------ C: equipment changes real gameplay
  console.log('\n== Scenario C: equipment functionality');
  const dmgWeapon = await findItem(p, { category: 'weapon', baseId: 'plasma_repeater', rarity: 'rare', level: 3 }, "(it) => it.affixes.some((a) => a.id === 'dmg')");
  const plainWeapon = await p.evaluate(() => window.__rift.makeItem({ seed: 7, baseId: 'plasma_repeater', rarity: 'common', level: 3, fixedRoll: 0.5 }));
  const reactor = await findItem(p, { baseId: 'reactor_core', rarity: 'uncommon', level: 3 }, '() => true');
  const shieldItem = await findItem(p, { baseId: 'shield_matrix', rarity: 'common', level: 3 }, '() => true');
  const armor = await findItem(p, { baseId: 'kinetic_plating', rarity: 'common', level: 3 }, '() => true');
  const servo = await findItem(p, { baseId: 'servo_booster', rarity: 'common', level: 3 }, '() => true');
  const uplink = await findItem(p, { baseId: 'field_uplink', rarity: 'common', level: 3 }, '() => true');
  const granted = await p.evaluate((items) => items.map((it) => window.__rift.grant(it)), [dmgWeapon, plainWeapon, reactor, shieldItem, armor, servo, uplink]);
  check('C0 test items granted to cargo', granted.every(Boolean), JSON.stringify(granted));
  // One real shot through Weapon.update -> ShotRequest.damage, and the enemy-side result through damageEnemy.
  const fire = () =>
    p.evaluate(() => {
      const g = window.__rift.game;
      let req = null;
      g.weapon.reset();
      g.weapon.update(1 / 60, true, g.stats, (r) => ((req = r), { point: r.origin }));
      return { damage: req ? req.damage : null, mult: g.stats.weaponDamageMult, def: g.weapon.def.damage, crit: g.stats.critChance };
    });
  const base = await fire();
  const c1 = await p.evaluate((uid) => window.__rift.game.equip(uid), dmgWeapon.uid);
  const withDmg = await fire();
  const dmgAffix = dmgWeapon.affixes.find((a) => a.id === 'dmg').value;
  check('C1 equipping a weapon with +damage changes real shot damage', c1 && Math.abs(withDmg.damage - dmgWeapon.weapon.damage * (1 + dmgAffix) * DAMAGE_PACE) < 1e-6 && withDmg.damage > base.damage, `${base.damage} -> ${withDmg.damage} (affix +${(dmgAffix * 100).toFixed(1)}%)`);
  await p.evaluate((uid) => window.__rift.game.equip(uid), plainWeapon.uid);
  const plain = await fire();
  check('C2 replacing it removes the old bonus', plain.mult === 1 && Math.abs(plain.damage - plainWeapon.weapon.damage * DAMAGE_PACE) < 1e-6, `mult ${plain.mult}, dmg ${plain.damage}`);
  const cool = () =>
    p.evaluate(() => {
      const R = window.__rift;
      const g = R.game;
      g.weapon.reset();
      g.weapon.sinceShot = 99; // past the post-shot cooling delay
      g.weapon.heat = 90;
      R.advance(1); // real loop, trigger released
      return 90 - g.weapon.heat;
    });
  const coolBefore = await cool();
  await p.evaluate((uid) => window.__rift.game.equip(uid), reactor.uid);
  const coolAfter = await cool();
  const coolMult = await p.evaluate(() => window.__rift.game.stats.coolRateMult);
  check('C3 reactor makes the weapon really cool faster', coolAfter > coolBefore * 1.05 && Math.abs(coolAfter / coolBefore - coolMult) < 0.06, `heat shed in 1 s: ${coolBefore.toFixed(1)} -> ${coolAfter.toFixed(1)} (×${coolMult.toFixed(3)})`);
  const defBefore = await S(p);
  await p.evaluate(([a, sh]) => {
    window.__rift.game.equip(a);
    window.__rift.game.equip(sh);
    window.__rift.advance(0.1);
  }, [armor.uid, shieldItem.uid]);
  const defAfter = await S(p);
  check('C4 armor raises max hull; shield adds a shield pool', defAfter.playerMaxHp > defBefore.playerMaxHp && defAfter.playerMaxShield > 0 && defAfter.playerShield === defAfter.playerMaxShield, `hull ${defBefore.playerMaxHp}->${defAfter.playerMaxHp}, shield ${defAfter.playerMaxShield}`);
  const hit = await p.evaluate(() => {
    const pl = window.__rift.game.player;
    const hp0 = pl.hp;
    const sh0 = pl.shield;
    pl.damage(20);
    return { hp0, hp1: pl.hp, sh0, sh1: pl.shield, mitig: pl.mitigation };
  });
  check('C5 incoming damage is reduced by armor and absorbed by the shield first', hit.mitig > 0 && hit.hp1 === hit.hp0 && Math.abs(hit.sh0 - hit.sh1 - 20 * (1 - hit.mitig)) < 1e-6, JSON.stringify(hit));
  const regen = await p.evaluate(() => {
    const R = window.__rift;
    const pl = R.game.player;
    const a = pl.shield;
    R.advance(1.5);
    const b2 = pl.shield;
    R.advance(4);
    return { a, b: b2, c: pl.shield, max: pl.maxShield };
  });
  check('C6 shield waits for its delay, then regenerates', Math.abs(regen.b - regen.a) < 1e-6 && regen.c > regen.b, JSON.stringify(regen));
  const move = async () => {
    return p.evaluate(() => {
      const R = window.__rift;
      const g = R.game;
      // Open south lane: a faster drone must not reach the reactor collider within the measured second.
      R.teleport(0, -42);
      R.look(0, 0);
      R.advance(0.3);
      const z0 = g.player.position.z;
      g.input.simulateKey('KeyW', true);
      R.advance(1);
      g.input.simulateKey('KeyW', false);
      const z1 = g.player.position.z;
      R.advance(0.4);
      return z1 - z0;
    });
  };
  const m0 = await move();
  await p.evaluate((uid) => window.__rift.game.equip(uid), servo.uid);
  const m1 = await move();
  check('C7 servo accessory makes the drone really move faster', m1 > m0 * 1.02, `${m0.toFixed(2)} m -> ${m1.toFixed(2)} m in 1 s`);
  const tower = await p.evaluate((uid) => {
    const R = window.__rift;
    const g = R.game;
    const before = g.stats.buildCostMult;
    g.equip(uid);
    R.advance(0.1);
    return { before, after: g.stats.buildCostMult, turretFireRate: g.stats.turretFireRateMult };
  }, uplink.uid);
  const hudCost = await p.textContent('.build-panel .cost').catch(() => null);
  check('C8 tower accessory lowers Sentinel cost and raises turret fire rate', tower.after < tower.before && tower.turretFireRate > 1, JSON.stringify(tower));
  const placed = await p.evaluate(() => {
    const R = window.__rift;
    const g = R.game;
    const cores = g.wallet.cores;
    R.teleport(-7, -16);
    R.look(0, 0.9);
    R.advance(0.2);
    g.input.simulateKey('KeyB', true);
    R.advance(1 / 60);
    g.input.simulateKey('KeyB', false);
    R.advance(0.1);
    const valid = g.construction.valid;
    g.input.simulateMouse(0, true);
    R.advance(1 / 60);
    g.input.simulateMouse(0, false);
    R.advance(0.1);
    return { valid, spent: cores - g.wallet.cores, turrets: g.turrets.turrets.length };
  });
  const panelCost = await p.textContent('.build-panel .cost').catch(() => '');
  check('C9 building a Sentinel charges the reduced cost', placed.turrets >= 1 && placed.spent > 0 && placed.spent < 100, JSON.stringify(placed));
  void hudCost;
  void panelCost;
  // Equipment is locked during combat (cannot bypass via the API either).
  const lock = await p.evaluate((uid) => {
    const R = window.__rift;
    const g = R.game;
    g.waves.startNow();
    R.advance(0.2);
    return { phase: g.waves.phase, ok: g.equip(uid), allowed: g.equipAllowed };
  }, dmgWeapon.uid);
  check('C10 equipment changes are refused during combat', lock.phase === 'combat' && lock.ok === false && lock.allowed === false, JSON.stringify(lock));
  // Inventory opens for inspection in combat; equip button disabled.
  await press(p, 'KeyI');
  await p.waitForSelector('.arena-inv', { timeout: 10000 });
  const disabled = await p.$eval('.inv-actions button.primary, .inv-actions button', (el) => el.disabled).catch(() => null);
  const lockedNote = await p.textContent('.locked-note').catch(() => '');
  check('C11 inventory opens in combat for inspection only', (await S(p)).screen === 'inventory' && disabled === true && /preparation/.test(lockedNote), lockedNote);
  await shot(p, 'C_inventory_combat');
  await p.keyboard.press('Escape');
  await waitFor(p, () => window.__rift.state().screen === 'playing');

  // ------------------------------------------------------------------ D: banking
  console.log('\n== Scenario D: collect -> wave 5 banking -> HQ storage -> reload');
  let st = await clearThrough(p, 5, { collect: true });
  s = await S(p);
  const runItems = await p.evaluate(() => {
    const g = window.__rift.game;
    return { secured: g.cfg.run.secured.items.map((i) => i.uid), unsecured: g.cfg.run.unsecured.items.length, cache: g.lastCache.map((i) => i.uid) };
  });
  const saveUids = await p.evaluate(() => window.__rift.profile.save.items.map((i) => i.uid));
  check('D1 reached the wave-5 checkpoint', st === 'checkpoint' && s.screen === 'checkpoint', st);
  check('D2 every collected item (and the checkpoint cache) is banked', runItems.unsecured === 0 && runItems.secured.length >= 9 && runItems.secured.every((u) => saveUids.includes(u)) && runItems.cache.length === 2, `${runItems.secured.length} secured, cache ${runItems.cache.length}`);
  const cpText = await p.textContent('.checkpoint').catch(() => '');
  check('D3 checkpoint panel lists the cache and secured equipment', /CHECKPOINT CACHE/.test(cpText) && /EQUIPMENT SECURED/.test(cpText));
  await shot(p, 'D_checkpoint');
  // Repeated hook for the same checkpoint must not duplicate.
  const dup = await p.evaluate(() => {
    const R = window.__rift;
    const g = R.game;
    const n = R.profile.save.items.length;
    g.cfg.hooks.bank(5, { salvage: 0, items: g.cfg.run.secured.items });
    return [n, R.profile.save.items.length];
  });
  check('D4 re-triggering the checkpoint grants nothing twice', dup[0] === dup[1], JSON.stringify(dup));
  const beforeHome = await savedItems(p);
  await p.evaluate(() => window.__rift.flow.returnHome());
  await waitFor(p, () => window.__rift.state().location === 'home' && window.__rift.state().screen === 'summary');
  const sumText = await p.textContent('.summary-screen');
  check('D5 summary lists secured equipment', /SECURED EQUIPMENT/.test(sumText));
  await p.click('text=CONTINUE');
  await p.evaluate(() => window.__rift.home.openTerminal('storage'));
  await p.waitForSelector('.inv .icard', { timeout: 10000 });
  const cards = await p.$$eval('.inv-list .icard', (els) => els.length);
  check('D6 HQ storage terminal shows the secured items', cards >= runItems.secured.length, `${cards} cards`);
  // Filter + sort + compare work in the storage UI.
  await p.click('.inv-filters button:has-text("WEAPON")');
  const weaponsOnly = await p.$$eval('.inv-list .icard em', (els) => els.every((e) => e.textContent.startsWith('WEAPON')));
  await p.click('.inv-sort button:has-text("LEVEL")');
  const levels = await p.$$eval('.inv-list .icard em', (els) => els.map((e) => +e.textContent.match(/LV (\d+)/)[1]));
  check('D7 storage filter by category and sort by level work', weaponsOnly && levels.every((v, i) => i === 0 || levels[i - 1] >= v), JSON.stringify(levels));
  await p.click('.inv-filters button:has-text("ALL")');
  const firstStored = await p.$('.inv-list .icard.stored');
  if (firstStored) await firstStored.click();
  const cmp = await p.$('.compare .cmp-table');
  check('D8 selecting a stored item shows a comparison against the equipped slot', !!cmp || !(await p.$('.inv-list .icard.stored .ic-main em:not(:has-text("MODULE"))')));
  await shot(p, 'D_storage');
  await p.keyboard.press('Escape');
  await boot(p, true);
  const afterReload = await savedItems(p);
  const diffD = firstDiff(beforeHome, afterReload);
  check('D9 after a browser reload every item is identical (no rerolls)', !diffD && afterReload.length === beforeHome.length, `${afterReload.length} items${diffD ? ' · differs: ' + diffD : ''}`);

  // ------------------------------------------------------------------ E: unsecured loss
  console.log('\n== Scenario E: bank at 5, collect in 6+, reactor lost before 10');
  await p.click('button.deploy');
  await waitFor(p, () => window.__rift.state().screen === 'home');
  const preRun = await p.evaluate(() => ({ loadout: { ...window.__rift.profile.save.loadout }, items: window.__rift.profile.save.items.map((i) => i.uid) }));
  await deploy(p);
  st = await clearThrough(p, 5, { collect: true });
  const bankedE = await p.evaluate(() => window.__rift.game.cfg.run.secured.items.map((i) => i.uid));
  await p.evaluate(() => window.__rift.game.continueRun());
  const lateUid = await p.evaluate(() => {
    const R = window.__rift;
    const id = R.spawnLoot({ rarity: 'epic', category: 'armor', x: 0, z: -12 });
    R.advance(1);
    return id;
  });
  st = await clearThrough(p, 6, { collect: true });
  const lostE = await p.evaluate(() => window.__rift.game.cfg.run.unsecured.items.map((i) => i.uid));
  check('E1 items collected after the checkpoint are unsecured', lostE.includes(lateUid) && lostE.length >= 1, `${lostE.length} unsecured`);
  await p.evaluate(() => {
    const R = window.__rift;
    R.game.waves.startNow();
    R.advance(0.5);
    R.damageReactor(1e6);
    R.advance(0.5);
  });
  await waitFor(p, () => window.__rift.state().screen === 'defeat');
  const saveE = await p.evaluate(() => window.__rift.profile.save);
  check('E2 unsecured items are lost on defeat', lostE.every((u) => !saveE.items.some((i) => i.uid === u)));
  check('E3 previously banked items remain', bankedE.every((u) => saveE.items.some((i) => i.uid === u)));
  check('E4 pre-run equipment remains equipped and owned', Object.entries(preRun.loadout).every(([k, v]) => saveE.loadout[k] === v) && preRun.items.every((u) => saveE.items.some((i) => i.uid === u)));
  await p.waitForSelector('.defeat .brief-list.lost', { timeout: 10000 });
  await shot(p, 'E_defeat');
  check('E5 defeat screen lists the lost items', (await p.$$eval('.defeat .brief-list.lost .brief', (e) => e.length)) === lostE.length);
  await p.evaluate(() => window.__rift.flow.leaveArena());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);

  // ------------------------------------------------------------------ F: equip-before-banking exploit
  console.log('\n== Scenario F: equip an unbanked item in prep, then lose');
  const weaponBefore = await p.evaluate(() => window.__rift.profile.save.loadout.weapon);
  await deploy(p);
  st = await clearThrough(p, 1);
  const fUid = await p.evaluate(() => {
    const R = window.__rift;
    const id = R.spawnLoot({ rarity: 'legendary', category: 'weapon', x: 0, z: -12 });
    R.advance(1);
    return id;
  });
  await collectAll(p);
  // Equip through the real UI: open cargo, select the item, click EQUIP.
  await press(p, 'KeyI');
  await p.waitForSelector('.arena-inv');
  await p.click(`.inv-list .icard:has-text("UNSECURED")`);
  await p.click('.inv-actions button.primary');
  const fEq = await p.evaluate((uid) => ({ slot: window.__rift.game.inventory.slotOf(uid), status: window.__rift.game.inventory.status(uid), dmg: window.__rift.game.weapon.def.damage }), fUid);
  check('F1 unbanked weapon equipped during preparation (via the inventory UI)', fEq.slot === 'weapon' && fEq.status === 'unsecured', JSON.stringify(fEq));
  await shot(p, 'F_equipped_unsecured');
  await p.keyboard.press('Escape');
  await waitFor(p, () => window.__rift.state().screen === 'playing');
  check('F2 profile loadout untouched while the run is active', (await p.evaluate(() => window.__rift.profile.save.loadout.weapon)) === weaponBefore);
  await p.evaluate(() => {
    const R = window.__rift;
    R.game.waves.startNow();
    R.advance(0.5);
    R.damageReactor(1e6);
    R.advance(0.5);
  });
  await waitFor(p, () => window.__rift.state().screen === 'defeat');
  const saveF = await p.evaluate(() => window.__rift.profile.save);
  check('F3 the unbanked item is gone', !saveF.items.some((i) => i.uid === fUid));
  check('F4 loadout reverted to the previously secured weapon', saveF.loadout.weapon === weaponBefore && saveF.items.some((i) => i.uid === weaponBefore));
  await p.evaluate(() => window.__rift.flow.leaveArena());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);

  // ------------------------------------------------------------------ G: lifetime
  console.log('\n== Scenario G: physical loot lifetime');
  await deploy(p);
  const gUid = await p.evaluate(() => {
    const R = window.__rift;
    R.game.waves.startNow();
    R.advance(0.3);
    const id = R.spawnLoot({ rarity: 'rare', category: 'shield', x: 4, z: -12 });
    R.advance(1);
    return id;
  });
  const present = () => p.evaluate((u) => window.__rift.pickups().find((q) => q.uid === u) ?? null, gUid);
  st = await clearThrough(p, 1);
  const g1 = await present();
  // Long pause / inspection does not age loot.
  await p.evaluate(() => {
    const R = window.__rift;
    R.game.openInventory();
    R.advance(30);
  });
  await p.evaluate(() => window.__rift.game.closeInventory());
  await p.evaluate(() => window.__rift.advance(1 / 60));
  st = await clearThrough(p, 2);
  const g2 = await present();
  check('G1 drop from wave 1 survives waves 1 and 2 (and pauses)', !!g1 && !!g2 && !g1.expiring && g2.expiring, JSON.stringify({ g1: !!g1, g2: g2 && g2.expiring }));
  await shot(p, 'G_expiring');
  st = await clearThrough(p, 3);
  const g3 = await present();
  const gSecured = await p.evaluate((u) => window.__rift.profile.save.items.some((i) => i.uid === u), gUid);
  check('G2 it expires when wave 3 (drop wave + 2) is cleared', !g3, '');
  check('G3 expired loot never reaches storage', !gSecured);

  // ------------------------------------------------------------------ I: regression spot checks in the same run
  console.log('\n== Scenario I: regression spot checks');
  const reg = await p.evaluate(() => {
    const R = window.__rift;
    const g = R.game;
    g.waves.startNow();
    R.advance(0.2);
    g.weapon.reset();
    for (let i = 0; i < 30; i++) {
      g.input.simulateMouse(0, true);
      R.advance(1 / 60);
    }
    g.input.simulateMouse(0, false);
    const heat = g.weapon.heat;
    g.input.simulateKey('KeyQ', true);
    R.advance(1 / 60);
    g.input.simulateKey('KeyQ', false);
    R.advance(0.5);
    const tac = g.tactical.active;
    g.input.simulateKey('KeyQ', true);
    R.advance(1 / 60);
    g.input.simulateKey('KeyQ', false);
    R.advance(0.2);
    g.player.damage(1e6);
    const dead = !g.player.alive;
    R.advance(5);
    return { heat, tac, dead, respawned: g.player.alive, enemies: g.enemies.count, wave: g.waves.number };
  });
  check('I1 shooting builds heat; tactical mode toggles; respawn works', reg.heat > 20 && reg.tac && reg.dead && reg.respawned, JSON.stringify(reg));
  await p.evaluate(() => window.__rift.flow.abandonRun());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
  check('I2 abandon returns home', (await S(p)).screen === 'summary');
  await p.click('text=CONTINUE');
  // Leak check over repeated deploy/return cycles with loot in the arena.
  const leaks = [];
  for (let c = 0; c < 3; c++) {
    await deploy(p);
    await p.evaluate(() => {
      const R = window.__rift;
      // Fixed base: each base's 3D model has its own mesh count, so a random base would vary the count.
      for (let i = 0; i < 6; i++) R.spawnLoot({ rarity: ['common', 'rare', 'epic', 'legendary', 'exotic', 'uncommon'][i], category: 'armor', baseId: 'kinetic_plating', x: -6 + i * 2, z: -12 });
      R.advance(1);
      R.render(1);
    });
    leaks.push(await p.evaluate(() => window.__rift.leakStats()));
    await p.evaluate(() => window.__rift.flow.abandonRun());
    await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    await p.click('text=CONTINUE');
  }
  const flat = leaks.every((l) => l.meshes === leaks[0].meshes && l.materials === leaks[0].materials && l.textures === leaks[0].textures && l.uiListeners === leaks[0].uiListeners);
  check('I3 arena with loot: meshes/materials/textures/listeners flat over 3 cycles', flat && leaks.every((l) => l.scenes === 1), JSON.stringify(leaks.map((l) => [l.meshes, l.materials, l.textures, l.uiListeners])));
  check('I4 no runtime errors so far', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();

  // ------------------------------------------------------------------ H: M1 save compatibility
  console.log('\n== Scenario H: M1 save migration + M2 items survive reloads');
  const fnv = (str) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  const m1save = {
    version: 1,
    profile: { id: 'pf_m1', callsign: 'VETERAN', createdAt: 1, lastSavedAt: 2 },
    resources: { salvage: 640 },
    items: [{ uid: 'it_m1_starter', defId: 'plasma_repeater', acquiredAt: 1, source: 'starter' }],
    storage: { capacity: 40, uids: [] },
    loadout: { weapon: 'it_m1_starter', armor: null, shield: null, reactor: null, processor: null, module: null, accessory: null },
    threat: { selected: 2, unlocked: 2 },
    records: { 1: { bestWave: 10, bestKills: 90, runs: 4, checkpoints: 2, salvageSecured: 640, longestRun: 600, lastPlayedAt: 3 } },
    totals: { runs: 4, returned: 2, defeated: 2, abandoned: 0, interrupted: 0, kills: 300, salvageSecured: 640 },
    history: [],
    activeRun: null,
    base: { layoutVersion: 1, placeables: [], facilities: ['command'] },
  };
  const body = JSON.stringify(m1save);
  ({ b, ctx, p, errs } = await launch({ 'riftwarden.save': `{"v":1,"sum":"${fnv(body)}","data":${body}}` }));
  let h = await p.evaluate(() => ({ status: window.__rift.profile.loadStatus, save: window.__rift.profile.save }));
  // The full chain ends in the v11 Rift Levels restart (owner decision): identity survives, progression restarts.
  // The step-by-step M1 -> M2 item/loadout migration is covered by tests/save-m2.test.ts (chain stopped at v10).
  check('H1 M1 save loads and migrates (v11 restart keeps the callsign)', h.status === 'loaded' && h.save.version >= 11 && h.save.profile.callsign === 'VETERAN' && h.save.wiped?.from === 10 && h.save.threat.unlocked === 1, h.status);
  const st1 = h.save.items.find((i) => i.uid === h.save.loadout.weapon);
  check('H2 the restarted profile deploys with a valid level-1 starter repeater', st1 && st1.level === 1 && st1.rarity === 'common' && st1.weapon.damage > 0);
  check('H3 storage expanded to the M2 capacity, presets added', h.save.storage.capacity === 50 && h.save.presets.length === 3);
  await p.click('button.deploy');
  await waitFor(p, () => window.__rift.state().screen === 'home');
  await deploy(p, 2);
  st = await clearThrough(p, 5, { collect: true });
  const bankedH = await p.evaluate(() => window.__rift.game.cfg.run.secured.items.map((i) => i.uid));
  const lvl = await p.evaluate(() => window.__rift.game.cfg.run.secured.items.map((i) => i.level));
  check('H4 tier II loot is banked (item levels include the tier bonus)', bankedH.length > 0 && lvl.every((l) => l >= 8), JSON.stringify(lvl));
  await p.evaluate(() => window.__rift.flow.returnHome());
  await waitFor(p, () => window.__rift.state().location === 'home' && window.__rift.state().screen === 'summary');
  const snap = await savedItems(p);
  await boot(p, true);
  const snap2 = await savedItems(p);
  await boot(p, true);
  const snap3 = await savedItems(p);
  const ident = (a, c) => a.length === c.length && !firstDiff(a, c);
  check('H5 items keep identity and stats across two reloads', ident(snap, snap2) && ident(snap, snap3) && bankedH.every((u) => snap3.some((i) => i.uid === u)), `${snap3.length} items`);
  check('H6 no runtime errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();

  console.log(`\n${H.stats.passes} passed, ${H.stats.failures} failed · ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(H.stats.failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
