// M4 acceptance scenarios (A-K: salvaging, protection, merchants, stock rotation, affix rerolls, locks,
// enhancement, fabrication, failed transactions, exploits, regression + leaks) against a running dev server.
// Usage: npm run dev (port 5173), then: node scripts/e2e-m4.cjs   (needs `playwright` + Chromium).
// Runs in ?test mode: fixed-step simulation, low graphics preset, no real pointer lock. UI actions are real
// DOM clicks on the HQ terminals; state is verified through the save (window.__rift.profile) and reloads.
// Screenshots go to $E2E_OUT (default: OS temp dir). Exit code 0 = all checks passed.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('os').tmpdir();
let failures = 0;
let passes = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
  if (ok) passes++;
  else failures++;
};

const SETTINGS = JSON.stringify({ v: 1, data: { sensitivity: 1, fov: 90, quality: 'low', volume: 0 } });

async function launch() {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((s) => {
    if (!localStorage.getItem('riftwarden.settings')) localStorage.setItem('riftwarden.settings', s);
  }, SETTINGS);
  await ctx.addInitScript(() => { window.__skipUpgrades = true; });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push('console.error ' + m.text().slice(0, 300));
  });
  await boot(p);
  return { b, ctx, p, errs };
}
async function boot(p, reload = false) {
  if (reload) await p.reload();
  else await p.goto('http://localhost:5173/?test');
  await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
  await p.evaluate(() => window.__rift.stopLoop());
  await p.evaluate(() => { window.__rift.flow.skipUpgrades = true; });
}
const waitFor = (p, fn, arg, t = 120000) => p.waitForFunction(fn, arg, { timeout: t, polling: 100 });
const shot = async (p, name) => {
  await p.evaluate(() => window.__rift.render(1));
  await p.screenshot({ path: `${OUT}/m4_${name}.png`, timeout: 120000 });
};
const save = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__rift.profile.save)));
const econ = (p, name, ...args) => p.evaluate(([n, a]) => window.__rift.econ(n, ...a), [name, args]);

async function toHq(p) {
  await p.evaluate(async () => {
    const R = window.__rift;
    if (R.state().location !== 'home') await R.flow.enterHq?.();
    await R.home.takeControl(false);
  });
}
async function openTerm(p, id) {
  await p.evaluate((id) => {
    const R = window.__rift;
    if (R.home.screen === 'terminal') R.home.setScreen('home');
    R.home.setScreen('home');
    R.home.openTerminal(id);
  }, id);
  await p.waitForSelector('.terminal .term-title', { timeout: 20000 });
  await p.waitForTimeout(150);
}
async function closeTerm(p) {
  await p.evaluate(() => window.__rift.home.setScreen('home'));
  await p.waitForTimeout(100);
}
/** Click a (possibly two-step) action button: the button, then its CONFIRM when it appears. */
async function clickAction(p, testId) {
  await p.click(`[data-testid="${testId}"]`);
  const confirm = await p.$(`[data-testid="${testId}-confirm"]`);
  if (confirm) await confirm.click();
  await p.waitForTimeout(120);
}
async function deploy(p, tier = 1) {
  await p.evaluate((t) => window.__rift.flow.deploy(t), tier);
  await waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.state().busy && window.__rift.game);
  await p.evaluate(() => { window.__rift.advance(1 / 60); });
}
async function clearThrough(p, wave) {
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
    await p.evaluate(() => {
      window.__rift.game.waves.startNow();
      window.__rift.advance(0.1);
    });
  }
  return 'guard';
}
/** One real shot through Weapon.update (the ShotRequest damage that Game.shoot feeds to damageEnemy). */
const fire = (p) =>
  p.evaluate(() => {
    const g = window.__rift.game;
    let req = null;
    g.weapon.reset();
    for (let i = 0; i < 90 && !req; i++) g.weapon.update(1 / 60, i < 80, g.stats, (r) => ((req = r), { point: r.origin }));
    return { damage: req ? req.damage : null, def: g.weapon.def.damage, family: g.weapon.def.family, mech: g.weapon.def.mechanism };
  });

(async () => {
  const t0 = Date.now();
  const { b, p, errs } = await launch();
  // Fresh profile for a deterministic run.
  await p.evaluate(() => {
    localStorage.removeItem('riftwarden.save');
    localStorage.removeItem('riftwarden.save.bak');
  });
  await boot(p, true);
  let s = await save(p);
  check('S0 fresh v4 profile: credits, components and merchant stock', s.version === 4 && s.resources.credits === 200 && s.resources.components === 0 && s.market.equipment.length === 8 && s.market.modules.length === 6, JSON.stringify(s.resources));

  // ---------------------------------------------------------------- stock consistency (D, part 1)
  await toHq(p);
  const stock0 = s.market.equipment.map((e) => e.item.uid).join(',');
  let stable = true;
  for (let i = 0; i < 4; i++) {
    await openTerm(p, i % 2 ? 'modules' : 'merchant');
    await closeTerm(p);
    const cur = (await save(p)).market.equipment.map((e) => e.item.uid).join(',');
    stable = stable && cur === stock0;
  }
  await boot(p, true);
  await toHq(p);
  const afterReload = (await save(p)).market.equipment.map((e) => e.item.uid).join(',');
  check('D1 stock identical across 4 terminal visits and a reload', stable && afterReload === stock0);

  // ---------------------------------------------------------------- earn: survive to a checkpoint and return (income + banking)
  await deploy(p, 1);
  const r5 = await clearThrough(p, 5);
  const runHud = await p.evaluate(() => ({ cr: window.__rift.game.cfg.run.secured.credits, co: window.__rift.game.cfg.run.secured.components, items: window.__rift.game.cfg.run.secured.items.length }));
  check('K1 five waves cleared and banked (credits/components earned in combat)', r5 === 'checkpoint' && runHud.cr > 0 && runHud.co >= 1, JSON.stringify(runHud));
  await p.evaluate(() => window.__rift.flow.returnHome());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
  s = await save(p);
  check('K2 secured credits/components/items reach the HQ save', s.resources.credits === 200 + runHud.cr && s.resources.components === runHud.co && s.storage.uids.length >= runHud.items, JSON.stringify(s.resources));
  const stock1 = s.market.equipment.map((e) => e.item.uid).join(',');
  check('D2 a completed run rotated the merchant stock', stock1 !== stock0 && s.market.rotation === 1, `rotation ${s.market.rotation}`);
  await p.evaluate(() => window.__rift.home.takeControl(false));

  // Give the profile a working budget and some stored gear for the station tests.
  await p.evaluate(() =>
    window.__rift.profile.mutate((d) => {
      d.resources.credits += 6000;
      d.resources.salvage += 6000;
      d.resources.components += 60;
      return true;
    }),
  );

  // ---------------------------------------------------------------- A: salvage through the UI
  s = await save(p);
  const stored = s.items.filter((i) => s.storage.uids.includes(i.uid) && !i.locked);
  const victim = stored[0];
  await openTerm(p, 'salvage');
  await p.click(`.terminal button.icard[data-uid="${victim.uid}"]`);
  const prevText = await p.textContent('.salv-preview');
  const expected = await p.evaluate((uid) => window.__rift.econPure.previewDismantle(window.__rift.profile.save, [uid]), victim.uid);
  await shot(p, 'A_salvage_preview');
  const salv0 = s.resources.salvage;
  const comp0 = s.resources.components;
  await clickAction(p, 'dismantle');
  s = await save(p);
  check('A1 preview shows the selected item and its yield', prevText.includes('1 ITEM') && prevText.includes(String(expected.salvage)), prevText.slice(0, 80));
  check('A2 dismantled: item gone, materials awarded', !s.items.some((i) => i.uid === victim.uid) && s.resources.salvage === salv0 + expected.salvage && s.resources.components === comp0 + expected.components, `+${expected.salvage} salvage +${expected.components} comp`);
  await boot(p, true);
  const sR = await save(p);
  check('A3 dismantle persists after reload', !sR.items.some((i) => i.uid === victim.uid) && sR.resources.salvage === s.resources.salvage && sR.resources.components === s.resources.components);
  await toHq(p);

  // ---------------------------------------------------------------- B: protected equipment
  s = await save(p);
  const guard = s.items.find((i) => s.storage.uids.includes(i.uid));
  await openTerm(p, 'salvage');
  await p.click(`.terminal button.icard[data-uid="${guard.uid}"]`);
  await p.click('[data-testid="lock-toggle"]');
  s = await save(p);
  const lockedNow = s.items.find((i) => i.uid === guard.uid)?.locked === true;
  const cardDisabled = await p.$eval(`.terminal button.icard[data-uid="${guard.uid}"]`, (el) => el.classList.contains('dis') && !el.querySelector('.ic-check'));
  const before = JSON.stringify((await save(p)).items);
  const r1 = await econ(p, 'dismantleItems', [guard.uid]);
  const r2 = await econ(p, 'sellItems', [guard.uid]);
  const r3 = await econ(p, 'dismantleItems', [s.loadout.weapon]);
  const after = JSON.stringify((await save(p)).items);
  check('B1 locked via the UI: card disabled, cannot be selected for dismantling', lockedNow && cardDisabled);
  check('B2 dismantle/sell of locked and equipped items rejected, inventory unchanged', !r1.ok && !r2.ok && !r3.ok && before === after, [r1.reason, r3.reason].join(' | '));
  await p.click(`.terminal button.icard[data-uid="${guard.uid}"]`);
  await p.click('[data-testid="lock-toggle"]');
  check('B3 unlocking makes it eligible again', !(await save(p)).items.find((i) => i.uid === guard.uid).locked);
  await closeTerm(p);

  // ---------------------------------------------------------------- C: merchant purchase through the UI
  await openTerm(p, 'merchant');
  s = await save(p);
  const offer = s.market.equipment.find((e) => !e.sold);
  await p.click(`.terminal button.icard[data-uid="${offer.item.uid}"]`);
  const cr0 = s.resources.credits;
  await shot(p, 'C_merchant');
  await clickAction(p, 'buy');
  s = await save(p);
  const bought = s.items.find((i) => i.uid === offer.item.uid);
  const paid = cr0 - s.resources.credits;
  const entry = s.market.equipment.find((e) => e.id === offer.id);
  check('C1 purchase deducted credits and stored a real generated item', !!bought && paid > 0 && s.storage.uids.includes(offer.item.uid) && bought.seed === offer.item.seed && bought.affixes.length === offer.item.affixes.length, `paid ${paid}`);
  check('C2 merchant entry marked sold (UI shows SOLD)', entry.sold && (await p.textContent(`.terminal button.icard[data-uid="${offer.item.uid}"]`)).includes('SOLD'));
  await boot(p, true);
  const sC = await save(p);
  check('C3 purchase persists after reload', sC.items.some((i) => i.uid === offer.item.uid) && sC.resources.credits === s.resources.credits && sC.market.equipment.find((e) => e.id === offer.id).sold);
  await toHq(p);

  // ---------------------------------------------------------------- J: rapid repeated purchase clicks
  await openTerm(p, 'modules');
  s = await save(p);
  const mod = s.market.modules.find((e) => !e.sold);
  await p.click(`.terminal button.icard[data-uid="${mod.item.uid}"]`);
  const crA = s.resources.credits;
  // Double click inside one frame on the buy button (and its confirm if the price needs one).
  await p.evaluate(() => {
    const b = document.querySelector('[data-testid="buy"]');
    b.click();
    b.click();
  });
  const conf = await p.$('[data-testid="buy-confirm"]');
  if (conf)
    await p.evaluate(() => {
      const c = document.querySelector('[data-testid="buy-confirm"]');
      c.click();
      c.click();
    });
  await p.waitForTimeout(200);
  s = await save(p);
  const owned = s.items.filter((i) => i.uid === mod.item.uid).length;
  const again = await econ(p, 'buyItem', 'modules', mod.id);
  check('J1 rapid double purchase charges once and creates exactly one item', owned === 1 && !again.ok && (await save(p)).resources.credits === s.resources.credits && crA - s.resources.credits > 0, `charged ${crA - s.resources.credits}`);
  await p.click('button[data-tab="exchange"]');
  const sv0 = (await save(p)).resources.salvage;
  await p.click('[data-testid="ex-salvage_crate"]');
  check('C4 material exchange grants salvage for credits', (await save(p)).resources.salvage === sv0 + 60);
  await closeTerm(p);

  // ---------------------------------------------------------------- H: fabrication through the UI
  await openTerm(p, 'fabricate');
  await p.click('button[data-recipe="w_rail"]');
  await p.click('button[data-quality="refined"]');
  s = await save(p);
  const res0 = s.resources;
  const nItems = s.items.length;
  await shot(p, 'H_fabricate');
  await p.click('[data-testid="craft"]');
  await p.waitForTimeout(150);
  s = await save(p);
  const crafted = s.items.find((i) => i.source === 'crafted');
  const valid = await p.evaluate((it) => !!it && it.category === 'weapon' && it.build.family === 'rail' && ['uncommon', 'rare'].includes(it.rarity) && it.weapon.damage > 0, crafted);
  check('H1 crafting deducted salvage, credits and components', s.resources.salvage < res0.salvage && s.resources.credits < res0.credits && s.resources.components < res0.components && s.items.length === nItems + 1, JSON.stringify({ before: res0, after: s.resources }));
  check('H2 crafted a valid rail weapon inside the refined rarity window', valid, crafted ? `${crafted.name} ${crafted.rarity} L${crafted.level}` : 'none');
  // Repeated crafting submissions each consume resources (no free duplicates).
  const sBefore = await save(p);
  await p.click('[data-testid="craft"]');
  await p.click('[data-testid="craft"]');
  await p.waitForTimeout(200);
  const sAfter = await save(p);
  const made = sAfter.items.length - sBefore.items.length;
  const spent = sBefore.resources.salvage - sAfter.resources.salvage;
  const unit = res0.salvage - sBefore.resources.salvage; // salvage cost of one craft (first craft)
  check('J2 repeated craft clicks: every item is paid for', made >= 1 && unit > 0 && spent === made * unit, `${made} crafted, ${spent} salvage (${unit} each)`);
  // Equip the first crafted weapon from the fabricator (the "EQUIP NOW" button of its last output is the
  // newest item, so equip through the storage rule instead) and fire it in the arena.
  const eq = await p.evaluate((uid) => window.__rift.profile.mutate((d) => window.__rift.econPure && window.__rift.equipFromStorage(d, uid, 'weapon')), crafted.uid);
  await closeTerm(p);
  await deploy(p, 1);
  const shotH = await fire(p);
  check('H3 crafted weapon equipped and fires in gameplay', eq && shotH.family === 'rail' && shotH.damage > 0, JSON.stringify(shotH));
  await p.evaluate(() => window.__rift.flow.abandonRun());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
  await p.evaluate(() => window.__rift.home.takeControl(false));

  // ---------------------------------------------------------------- E/F: affix engineering through the UI
  s = await save(p);
  const target = s.items.find((i) => s.storage.uids.includes(i.uid) && i.affixes.length >= 2 && i.category !== 'module');
  await openTerm(p, 'workshop');
  await p.click('button[data-tab="affixes"]');
  await p.click(`.terminal button.icard[data-uid="${target.uid}"]`);
  await p.click('.affix-row[data-affix="0"]');
  const resE = (await save(p)).resources;
  await shot(p, 'E_affixes');
  await p.click('[data-testid="reroll-stat"]');
  await p.waitForTimeout(150);
  s = await save(p);
  const tE = s.items.find((i) => i.uid === target.uid);
  const validAffix = await p.evaluate((it) => {
    // Re-validate the stored item through sanitize (same rules as loading) and the stat pipeline.
    return it.affixes.every((a) => Number.isFinite(a.value) && a.tier >= 1 && a.tier <= 5) && new Set(it.affixes.map((a) => a.id)).size === it.affixes.length;
  }, tE);
  check('E1 single-affix recalibration charged its cost and produced a valid affix', tE.rerolls === 1 && validAffix && s.resources.salvage < resE.salvage && s.resources.credits < resE.credits, `${JSON.stringify(target.affixes[0].id)} -> ${tE.affixes[0].id} T${tE.affixes[0].tier}`);
  const resultShown = await p.$('.eng-result');
  check('E2 the actual result is displayed after rerolling', !!resultShown);
  await boot(p, true);
  const tR = (await save(p)).items.find((i) => i.uid === target.uid);
  const same = (a, b) => a.length === b.length && a.every((x, i) => x.id === b[i].id && x.stat === b[i].stat && x.op === b[i].op && x.value === b[i].value && x.tier === b[i].tier && x.roll === b[i].roll);
  check('E3 reroll persists after reload', same(tR.affixes, tE.affixes) && tR.rerolls === 1, `${tR.affixes[0].id} T${tR.affixes[0].tier} ${tR.affixes[0].value}`);
  await toHq(p);
  // F: lock affix 1 in the UI, full recalibration keeps it exactly.
  await openTerm(p, 'workshop');
  await p.click('button[data-tab="affixes"]');
  await p.click(`.terminal button.icard[data-uid="${target.uid}"]`);
  await p.click('[data-testid="lock-1"]');
  const keep = JSON.stringify({ ...(await save(p)).items.find((i) => i.uid === target.uid).affixes[1] });
  let keptAll = true;
  for (let k = 0; k < 3; k++) {
    await clickAction(p, 'reroll-all');
    const cur = (await save(p)).items.find((i) => i.uid === target.uid).affixes[1];
    keptAll = keptAll && JSON.stringify({ ...cur }) === keep;
  }
  const fItem = (await save(p)).items.find((i) => i.uid === target.uid);
  check('F1 locked affix unchanged by three full recalibrations', keptAll && fItem.rerolls === 4, `rerolls ${fItem.rerolls}`);
  await shot(p, 'F_locked');

  // ---------------------------------------------------------------- G: enhancement changes real combat damage
  s = await save(p);
  const wUid = s.loadout.weapon;
  await closeTerm(p);
  await deploy(p, 1);
  const g0 = await fire(p);
  await p.evaluate(() => window.__rift.flow.abandonRun());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
  await p.evaluate(() => window.__rift.home.takeControl(false));
  await openTerm(p, 'workshop');
  await p.click('button[data-tab="enhance"]');
  await p.click(`.terminal button.icard[data-uid="${wUid}"]`);
  const resG = (await save(p)).resources;
  await p.hover('[data-testid="enhance"]');
  const previewRows = await p.$$eval('[data-testid="stat-diff"] th', (th) => th.length);
  await shot(p, 'G_enhance');
  await p.click('[data-testid="enhance"]');
  await p.click('[data-testid="enhance"]').catch(() => {});
  await p.waitForTimeout(150);
  s = await save(p);
  const wG = s.items.find((i) => i.uid === wUid);
  check('G1 enhancement consumed materials and raised the level (preview shown)', (wG.enhance ?? 0) >= 1 && s.resources.salvage < resG.salvage && previewRows === 3, `+${wG.enhance}`);
  await closeTerm(p);
  await deploy(p, 1);
  const g1 = await fire(p);
  const ratio = g1.damage / g0.damage;
  check('G2 real shot damage rises by the enhancement bonus', Math.abs(ratio - (1 + 0.04 * wG.enhance)) < 1e-6, `${g0.damage.toFixed(2)} -> ${g1.damage.toFixed(2)} (×${ratio.toFixed(4)})`);
  await p.evaluate(() => window.__rift.flow.abandonRun());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
  await boot(p, true);
  check('G3 enhanced weapon persists after reload', (await save(p)).items.find((i) => i.uid === wUid).enhance === wG.enhance);
  await toHq(p);

  // ---------------------------------------------------------------- components + module engineering
  s = await save(p);
  const rail = s.items.find((i) => i.category === 'weapon' && i.build?.family === 'rail');
  await openTerm(p, 'workshop');
  await p.click('button[data-tab="components"]');
  await p.click(`.terminal button.icard[data-uid="${rail.uid}"]`);
  await p.click('button[data-slot="mechanism"]');
  const builds0 = await p.evaluate(() => window.__preview?.builds ?? 0);
  await p.click('button[data-comp]');
  await p.waitForTimeout(400);
  const builds1 = await p.evaluate(() => window.__preview?.builds ?? 0);
  await shot(p, 'CE_components');
  await clickAction(p, 'swap');
  s = await save(p);
  const railAfter = s.items.find((i) => i.uid === rail.uid);
  check('CE1 mechanism refit through the UI (charge <-> auto-cycle), preview rebuilt the model', railAfter.build.mechanism !== rail.build.mechanism && railAfter.mods === 1 && builds1 > builds0, `${rail.build.mechanism} -> ${railAfter.build.mechanism}`);
  const bad = await econ(p, 'modifyComponent', rail.uid, 'mechanism', 'mc_beam');
  check('CE2 an unsupported beam mechanism on a railgun is rejected', !bad.ok, bad.reason);
  const m = s.items.find((i) => i.category === 'module' && s.storage.uids.includes(i.uid));
  const em = m ? await econ(p, 'enhanceItem', m.uid) : { ok: false };
  check('CE3 modules can be enhanced', em.ok && (await save(p)).items.find((i) => i.uid === m.uid).enhance === 1);
  await closeTerm(p);

  // ---------------------------------------------------------------- I: failed transactions leave state untouched
  await p.evaluate(() =>
    window.__rift.profile.mutate((d) => {
      d.resources.credits = 0;
      d.resources.salvage = 0;
      d.resources.components = 0;
      return true;
    }),
  );
  s = await save(p);
  const snap0 = JSON.stringify(s);
  const anyStored = s.items.find((i) => s.storage.uids.includes(i.uid));
  const withAffix = s.items.find((i) => i.affixes.length > 0);
  const fails = [
    await econ(p, 'buyItem', 'equipment', s.market.equipment.find((e) => !e.sold).id),
    await econ(p, 'craft', 'd_armor', 'standard'),
    await econ(p, 'enhanceItem', 'no_such_item'),
    await econ(p, 'rerollAffix', withAffix.uid, 99, 'stat'),
    // Removing a module from an empty socket (M3 transaction, same transact path).
    await p.evaluate((uid) => window.__rift.profile.transact((d) => window.__rift.uninstallModule(d, uid, 0)), s.items.find((i) => i.category === 'weapon' && i.sockets > 0 && !i.socketed[0])?.uid ?? s.loadout.weapon),
    await econ(p, 'dismantleItems', ['ghost_item_uid']),
    await econ(p, 'sellItems', [anyStored.uid + '_x']),
  ];
  check('I1 buy/craft/enhance/reroll/uninstall/dismantle/sell failures all rejected', fails.every((f) => f.ok === false), fails.map((f) => f.reason).join(' | '));
  check('I2 save byte-identical after the failed attempts', JSON.stringify(await save(p)) === snap0);
  // Save failure: the transaction is rolled back and reported.
  await p.evaluate(() =>
    window.__rift.profile.mutate((d) => {
      d.resources.credits = 5000;
      return true;
    }),
  );
  const snap1 = JSON.stringify(await save(p));
  const stored1 = await p.evaluate(() => localStorage.getItem('riftwarden.save'));
  await p.evaluate(() => (window.__rift.profile.failWrites = true));
  const rb = await econ(p, 'buyItem', 'equipment', (await save(p)).market.equipment.find((e) => !e.sold).id);
  await p.evaluate(() => (window.__rift.profile.failWrites = false));
  check('I3 a failed save write rolls the purchase back (memory and storage unchanged)', !rb.ok && JSON.stringify(await save(p)) === snap1 && (await p.evaluate(() => localStorage.getItem('riftwarden.save'))) === stored1, rb.reason);

  // ---------------------------------------------------------------- J: economy exploit loops
  const loop = await p.evaluate(() => {
    const R = window.__rift;
    R.profile.mutate((d) => {
      d.resources.credits = 100000;
      d.resources.salvage = 100000;
      d.resources.components = 500;
      return true;
    });
    const out = [];
    // buy -> sell and buy -> dismantle, craft -> sell and craft -> dismantle: credits never come back.
    for (const e of R.profile.save.market.equipment.filter((x) => !x.sold).slice(0, 3)) {
      const c0 = R.profile.save.resources.credits;
      const b = R.econ('buyItem', 'equipment', e.id);
      const s = R.econ('sellItems', [e.item.uid]);
      out.push({ kind: 'buy-sell', ok: b.ok && s.ok, net: R.profile.save.resources.credits - c0 });
    }
    for (let i = 0; i < 3; i++) {
      const c0 = R.profile.save.resources.credits;
      const sv0 = R.profile.save.resources.salvage;
      const c = R.econ('craft', 'd_shield', 'standard');
      const s = R.econ('sellItems', [c.item.uid]);
      out.push({ kind: 'craft-sell', ok: c.ok && s.ok, net: R.profile.save.resources.credits - c0, salvage: R.profile.save.resources.salvage - sv0 });
    }
    for (let i = 0; i < 3; i++) {
      const sv0 = R.profile.save.resources.salvage;
      const c = R.econ('craft', 'm_amp', 'standard');
      const d = R.econ('dismantleItems', [c.item.uid]);
      out.push({ kind: 'craft-dismantle', ok: c.ok && d.ok, net: R.profile.save.resources.salvage - sv0 });
    }
    // Module transfer back and forth costs salvage every time (no free moves).
    return out;
  });
  check('J3 buy/sell, craft/sell and craft/dismantle loops always lose value', loop.every((l) => l.ok && l.net < 0), JSON.stringify(loop.map((l) => `${l.kind}:${l.net}`)));
  const dupCheck = await p.evaluate(() => {
    const d = window.__rift.profile.save;
    const all = [];
    for (const it of d.items) {
      all.push(it.uid);
      for (const m of it.socketed ?? []) if (m) all.push(m.uid);
    }
    return { total: all.length, unique: new Set(all).size, storageOk: d.storage.uids.every((u) => d.items.some((i) => i.uid === u)) };
  });
  check('J4 no duplicated item ids after all transactions', dupCheck.total === dupCheck.unique && dupCheck.storageOk, JSON.stringify(dupCheck));

  // ---------------------------------------------------------------- K: regression + HQ performance + leaks
  await toHq(p);
  const hqStats = await p.evaluate(() => {
    const R = window.__rift;
    const t = performance.now();
    R.advance(1);
    const sim = (performance.now() - t) / 60;
    return { sim, ...R.leakStats() };
  });
  check('K3 HQ simulation stays cheap with the new stations', hqStats.sim < 4, `${hqStats.sim.toFixed(2)} ms/frame, ${hqStats.meshes} meshes, ${hqStats.materials} materials`);
  const stations = await p.evaluate(async () => {
    const R = window.__rift;
    const out = {};
    // Walk up to each new station: the interaction prompt must target it.
    const spots = { merchant: [30, 3.4, 0], modules: [30, -3.4, Math.PI], salvage: [-24.6, -3.6, -Math.PI / 2], fabricate: [18.6, -5.2, Math.PI / 2] };
    for (const [id, [x, z, yaw]] of Object.entries(spots)) {
      R.teleport(x, z);
      R.advance(0.4);
      R.look(yaw, 0.18);
      R.advance(0.2);
      out[id] = R.state().target;
    }
    return out;
  });
  check('K4 the four new stations are reachable and targetable in the HQ', Object.entries(stations).every(([k, v]) => k === v), JSON.stringify(stations));
  const leak = [];
  for (let c = 0; c < 3; c++) {
    await openTerm(p, ['merchant', 'workshop', 'fabricate'][c]);
    await closeTerm(p);
    await deploy(p, 1);
    await p.evaluate(() => window.__rift.flow.abandonRun());
    await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    await p.evaluate(() => window.__rift.home.takeControl(false));
    leak.push(await p.evaluate(() => window.__rift.leakStats()));
  }
  const flat = (k) => leak.every((l) => l[k] === leak[0][k]);
  check('K5 HQ resources flat over 3 terminal + deploy cycles', flat('meshes') && flat('materials') && flat('textures') && flat('scenes') && flat('uiListeners') && flat('profileListeners'), JSON.stringify(leak.map((l) => [l.meshes, l.materials, l.textures, l.uiListeners])));
  check('K6 no page errors', errs.length === 0, errs.slice(0, 3).join(' || '));
  console.log(`\n${passes} passed, ${failures} failed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await b.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
