// Rift Levels browser suite (docs/progression-design.md phase 1): A deploy terminal picker + loot gates + unlock bar,
// B picking a high level and deploying (item levels, rarity ceiling, HUD), C Rift Surge on the run map,
// D v11 restart notice for a migrated profile, V screenshots.
//   node scripts/e2e-riftlevels.cjs [A,B,...]   (dev server on :5173)
const { stats, check, sectionFilter, S, ev, waitFor, launch, shot, saveBrowserFailure } = require('./lib/harness.cjs');

const want = sectionFilter();
const captureScreens = want('V') && (!process.env.CI || Boolean(process.argv[2]));

async function clearNode(p) {
  return ev(p, async () => {
    const tick = () => new Promise((res) => setTimeout(res, 0));
    const r = window.__rift;
    const g = r.game;
    const node = g.node;
    for (let guard = 0; guard < 4000 && !node.complete; guard++) {
      if (g.screen === 'upgrade' && g.offer) {
        g.chooseUpgrade(g.offer[0].id);
        await tick();
      }
      if (g.screen !== 'playing' && !(g.screen === 'upgrade' && g.offer)) g.setScreen('playing');
      if (g.waves.phase === 'prep') g.startWave();
      r.advance(0.5);
      r.killAll();
    }
    for (let i = 0; i < 20 && g.screen !== 'runmap'; i++) {
      if (g.screen === 'upgrade' && g.offer) {
        g.chooseUpgrade(g.offer[0].id);
        await tick();
      }
      if (g.screen !== 'runmap') r.advance(0.25);
    }
    return { complete: node.complete, screen: g.screen, wave: g.waves.number };
  });
}

/** Travel to a reachable combat sector (never a capital), optionally with a Rift Surge. */
async function travelCombat(p, surge = false) {
  return ev(p, async (surge) => {
    const { flow } = window.__rift;
    const nodes = flow.map.reachable();
    const n = nodes.find((x) => (x.kind === 'combat' || x.kind === 'elite') && !x.actBoss) ?? nodes[0];
    const ok = await flow.travel(n.id, surge);
    window.__rift.advance(1 / 60);
    return { ok, id: n.id, kind: n.kind };
  }, surge);
}

async function openDeploy(p) {
  await ev(p, () => window.__rift.home.openTerminal('deploy'));
  await p.waitForSelector('[data-testid=rl-picker]', { timeout: 30000 });
}

(async () => {
  const { b, ctx, p, errs } = await launch({ query: '&map', diagnostics: 'rift-levels' });
  const t0 = Date.now();
  try {
    await ev(p, () => {
      window.__rift.flow.war.localSeed = 1;
      return window.__rift.flow.enterHq();
    });
    await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.flow.busy);

    if (want('A')) {
      await openDeploy(p);
      const a = await ev(p, () => ({
        version: window.__rift.profile.save.version,
        value: document.querySelector('[data-testid=rl-value]')?.textContent,
        down: document.querySelector('[data-testid=rl-down]')?.disabled,
        up: document.querySelector('[data-testid=rl-up]')?.disabled,
        ready: document.querySelector('[data-testid=rl-readiness]')?.textContent ?? '',
        loot: document.querySelector('[data-testid=rl-loot]')?.textContent ?? '',
        next: document.querySelector('[data-testid=rl-next-rarity]')?.textContent ?? '',
        unlock: document.querySelector('[data-testid=rl-unlock]')?.textContent ?? '',
        deploy: [...document.querySelectorAll('button.primary.deploy')].map((x) => x.textContent).join(''),
        wipe: !!document.querySelector('[data-testid=wipe-notice]'),
      }));
      check('A1 fresh profile is save v11 at RL 1 (both steppers locked)', a.version === 11 && a.value === 'RL 1' && a.down && a.up, JSON.stringify(a));
      check('A2 readiness verdict for the loadout', /COMFORTABLE|MATCHED/.test(a.ready), a.ready);
      check('A3 loot card: item levels 1-10, best drop Rare, epic odds gated', /ITEM LEVEL1 – 10/.test(a.loot.replace(/\s+/g, ' ').replace('ITEM LEVEL ', 'ITEM LEVEL')) && /Rare/.test(a.loot) && /Epic drops open at RL 3/.test(a.next), a.loot + ' | ' + a.next);
      check('A4 unlock bar: 0/1 checkpoints toward RL 2', /NEXT · RL 2/.test(a.unlock) && /0\/1 CHECKPOINTS ON RL 1/.test(a.unlock), a.unlock);
      check('A5 deploy button names the Rift Level; no restart notice on a fresh profile', /DEPLOY · RL 1/.test(a.deploy) && !a.wipe, a.deploy);
      if (captureScreens) await shot(p, 'rl-deploy-fresh', { frames: 2 });
    }

    if (want('B') || want('C')) {
      await ev(p, () => window.__rift.profile.mutate((d) => { d.threat.unlocked = 12; return true; }));
      if (!(await p.$('[data-testid=rl-picker]'))) await openDeploy(p);
    }

    if (want('B')) {
      await p.click('[data-testid=rl-up]');
      const up = await ev(p, () => window.__rift.profile.save.threat.selected);
      await p.click('[data-testid=rl-highest]');
      const hi = await ev(p, () => ({ sel: window.__rift.profile.save.threat.selected, ready: document.querySelector('[data-testid=rl-readiness]')?.textContent ?? '', loot: document.querySelector('[data-testid=rl-loot]')?.textContent ?? '', rec: document.querySelector('[data-testid=rl-recommended]')?.textContent ?? '' }));
      check('B1 + raises the level, HIGHEST jumps to RL 12', up === 2 && hi.sel === 12, JSON.stringify({ up, sel: hi.sel }));
      check('B2 starter gear at RL 12 reads DEADLY and offers a recommended level', /DEADLY/.test(hi.ready) && /RECOMMENDED · RL [12]\b/.test(hi.rec), hi.ready + ' | ' + hi.rec);
      check('B3 RL 12 loot: item levels 111-120, exotics open', /111 – 120/.test(hi.loot) && /Exotic/.test(hi.loot), hi.loot.slice(0, 160));
      if (captureScreens) await shot(p, 'rl-deploy-12', { frames: 2 });
      await p.click('[data-testid=rl-recommended]');
      const rec = await ev(p, () => window.__rift.profile.save.threat.selected);
      check('B4 RECOMMENDED picks a level the loadout matches', rec <= 2, String(rec));
      // Deploy on RL 9 (legendary unlocked, exotic not): the arena plays the level and rolls its loot.
      await ev(p, () => window.__rift.flow.selectTier(9));
      await ev(p, () => window.__rift.flow.deploy(9));
      await waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.flow.busy);
      await ev(p, () => window.__rift.advance(0.2));
      const g = await ev(p, () => {
        const game = window.__rift.game;
        const items = [];
        for (let i = 0; i < 120; i++) items.push(...game.rollItems('boss', 3));
        for (let i = 0; i < 400; i++) items.push(...game.rollItems('walker', 3));
        const order = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'exotic', 'ascended'];
        const top = items.reduce((m, it) => Math.max(m, order.indexOf(it.rarity)), 0);
        const levels = items.map((it) => it.level);
        const hud = document.body.textContent ?? '';
        return { tier: game.cfg.tier.id, n: items.length, minL: Math.min(...levels), maxL: Math.max(...levels), top: order[top], hud: /RL 9/.test(hud), pity: game.cfg.run.pity, journal: game.cfg.run.lootJournal.length, pityRec: game.cfg.run.lootJournal.every((r) => typeof r.pity === 'number') };
      });
      check('B5 arena runs at RL 9 and the HUD names it', g.tier === 9 && g.hud, JSON.stringify(g));
      check('B6 drops sit at RL 9 item levels (80-99)', g.minL >= 80 && g.maxL <= 99, `${g.minL}..${g.maxL}`);
      check('B7 no exotic or ascended below RL 12', g.top !== 'exotic' && g.top !== 'ascended', g.top);
      check('B8 bad-luck counter rides the run and every roll is journaled with it', g.pityRec && g.journal >= 520 && g.pity >= 0, JSON.stringify({ pity: g.pity, journal: g.journal }));
      await ev(p, () => window.__rift.flow.abandonRun());
      await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.flow.busy);
    }

    if (want('C')) {
      await ev(p, () => { window.__rift.flow.selectTier(3); });
      await ev(p, () => window.__rift.flow.deploy(3));
      await waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.flow.busy);
      await ev(p, () => window.__rift.advance(1 / 60));
      await clearNode(p);
      const offer0 = await ev(p, () => ({ ready: window.__rift.flow.map.view(window.__rift.game).surgeReady, ui: !!document.querySelector('[data-testid=rm-surge]') }));
      check('C1 no Rift Surge after the first node', !offer0.ready && !offer0.ui, JSON.stringify(offer0));
      const t1 = await travelCombat(p);
      await clearNode(p);
      await p.waitForSelector('[data-testid=rm-travel]', { timeout: 30000 });
      const offer = await ev(p, () => ({ ready: window.__rift.flow.map.view(window.__rift.game).surgeReady, ui: document.querySelector('[data-testid=rm-surge]')?.textContent ?? '', level: document.querySelector('[data-testid=rm-level]')?.textContent ?? '', travel: document.querySelector('[data-testid=rm-travel]')?.textContent ?? '' }));
      check('C2 after two nodes the map offers a Rift Surge to RL 4', t1.ok && offer.ready && /RL 4/.test(offer.ui) && /STAY ON RL 3/.test(offer.travel), JSON.stringify(offer));
      if (captureScreens) await shot(p, 'rl-surge-offer', { frames: 2 });
      const banners = [];
      await ev(p, () => { window.__bn = []; window.__rift.game && 0; });
      await p.click('[data-testid=rm-surge-go]');
      await waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.flow.busy && window.__rift.game?.cfg.tier.id === 4);
      await ev(p, () => window.__rift.advance(0.3));
      const s = await ev(p, () => {
        const r = window.__rift;
        const a = r.profile.save.activeRun;
        return { tier: r.game.cfg.tier.id, deploy: a.tier, surge: a.map.surge, surgeAt: a.map.surgeAt, cleared: a.map.cleared, banner: document.body.textContent.includes('RIFT SURGE') };
      });
      check('C3 surge travel plays the next node at RL 4 and stores the surge', s.tier === 4 && s.deploy === 3 && s.surge === 1 && s.surgeAt === s.cleared, JSON.stringify(s));
      check('C4 surge banner announces the new level', s.banner);
      void banners;
      const before = await ev(p, () => window.__rift.profile.save.records['4']?.checkpoints ?? 0);
      await clearNode(p);
      const after = await ev(p, () => ({ cp4: window.__rift.profile.save.records['4']?.checkpoints ?? 0, view: window.__rift.flow.map.view(window.__rift.game) }));
      check('C5 the surged node banks its checkpoint on RL 4', after.cp4 === before + 1, JSON.stringify({ before, after: after.cp4 }));
      check('C6 the next surge waits three nodes', after.view.surgeReady === false && after.view.surge === 1, JSON.stringify({ ready: after.view.surgeReady, surge: after.view.surge }));
      await ev(p, () => window.__rift.flow.returnHome());
      await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.flow.busy);
    }
  } catch (e) {
    check('no exception', false, e.stack || String(e));
  }

  if (want('D')) {
    // A stored v10 profile: the v11 migration restarts progression and the deploy terminal explains it once.
    const data = { version: 10, profile: { id: 'pf_e2e_vet', callsign: 'VETERAN', createdAt: 1, lastSavedAt: 2 }, resources: { salvage: 5000, credits: 90000, components: 50, shards: 9 }, items: [], storage: { capacity: 50, expansions: 0, uids: [] }, loadout: {}, presets: [], threat: { selected: 5, unlocked: 5 }, records: {}, totals: {}, milestones: [], history: [], activeRun: null, base: {}, tutorial: { done: ['complete'], skipped: false }, progress: { xp: 900000, tree: { allocated: [] }, respecs: 0 } };
    const body = JSON.stringify(data);
    let h = 0x811c9dc5;
    for (let i = 0; i < body.length; i++) {
      h ^= body.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    const sum = (h >>> 0).toString(16).padStart(8, '0');
    const { b: b2, p: p2 } = await launch({ init: { 'riftwarden.save': `{"v":10,"sum":"${sum}","data":${body}}` } });
    try {
      await ev(p2, () => window.__rift.flow.enterHq());
      await waitFor(p2, () => window.__rift.state().location === 'home' && !window.__rift.flow.busy);
      const d = await ev(p2, () => {
        const s = window.__rift.profile.save;
        return { v: s.version, id: s.profile.id, call: s.profile.callsign, unlocked: s.threat.unlocked, credits: s.resources.credits, wiped: s.wiped, tut: s.tutorial.done };
      });
      check('D1 v10 profile migrates to v11: progression restarted, identity kept', d.v === 11 && d.id === 'pf_e2e_vet' && d.call === 'VETERAN' && d.unlocked === 1 && d.credits < 1000 && d.wiped?.from === 10 && d.tut.includes('complete'), JSON.stringify(d));
      await openDeploy(p2);
      const n = await ev(p2, () => document.querySelector('[data-testid=wipe-notice]')?.textContent ?? '');
      check('D2 deploy terminal explains the restart', /A new climb begins/.test(n) && /Rift Levels/.test(n), n.slice(0, 80));
      if (captureScreens) await shot(p2, 'rl-wipe-notice', { frames: 2 });
      await p2.click('[data-testid=wipe-ok]');
      await ev(p2, () => window.__rift.home.closeTerminal?.());
      await openDeploy(p2);
      const gone = await ev(p2, () => !document.querySelector('[data-testid=wipe-notice]'));
      check('D3 the notice is dismissed for good', gone);
    } catch (e) {
      check('D no exception', false, e.stack || String(e));
    } finally {
      await b2.close();
    }
  }

  // Known SwiftShader shader-variant fallbacks (same filter as e2e-runmap).
  const bad = errs.filter((e) => !/compil(e|ing) effect|Trying next fallback|BJS - \[[\d:]+\]: (Uniforms|Attributes|Defines|Error: (VERTEX|FRAGMENT))|GPU stall|favicon/.test(e));
  check('Z no runtime errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  console.log(`\n${stats.passes} passed, ${stats.failures} failed (${Math.round((Date.now() - t0) / 1000)} s)`);
  if (stats.failures) await saveBrowserFailure(ctx, p, errs, 'rift-levels');
  await b.close();
  process.exit(stats.failures ? 1 : 0);
})();
