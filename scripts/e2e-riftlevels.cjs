// Rift Levels browser suite (docs/progression-design.md phase 1): A deploy terminal picker + loot gates + unlock bar,
// B picking a high level and deploying (item levels, rarity ceiling, HUD), C Rift Surge on the run map,
// D v11 restart notice for a migrated profile, E staged unlocks (&locks), F weapon-family mastery, V screenshots.
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
  if (want('E')) {
    // Staged unlocks with the real track (&locks): a fresh warden, then levels and Rift Levels open features.
    const { b: b3, p: p3, errs: errs3 } = await launch({ query: '&locks' });
    try {
      await ev(p3, () => window.__rift.flow.enterHq());
      await waitFor(p3, () => window.__rift.state().location === 'home' && !window.__rift.flow.busy);
      const e1 = await ev(p3, () => {
        const r = window.__rift;
        const h = r.home;
        h.openTerminal('fabricate');
        const fab = r.state().screen;
        return { fab, lock: h.stationLock('fabricate'), deployLock: h.stationLock('deploy'), op: r.profile.op('craft', ['w_plasma', 'standard']).reason ?? '', modules: r.profile.save.market.modules.length };
      });
      check('E1 a fresh warden cannot open the fabricator (locked prompt, op refused, no module stock)', e1.fab !== 'terminal' && /Warden level 10/.test(e1.lock) && !e1.deployLock && /Warden level 10/.test(e1.op) && e1.modules === 0, JSON.stringify(e1));
      const strip = await ev(p3, () => document.querySelector('[data-testid=next-unlocks]')?.textContent ?? '');
      check('E2 the HQ shows the next unlocks with progress', /NEXT UNLOCKS/.test(strip) && /Warden 1\/2/.test(strip), strip);
      const e2b = await ev(p3, () => document.querySelectorAll('[data-testid=hq-resources] > span').length);
      check("E2b a fresh warden's HQ reserves show credits only", e2b === 1, String(e2b));
      if (captureScreens) await shot(p3, 'rl-hq-next-unlocks', { frames: 2 });
      await ev(p3, () => window.__rift.home.openTerminal('loadout'));
      await p3.waitForSelector('[data-testid=slot-locked-weapon2]', { timeout: 20000 });
      const e3 = await ev(p3, () => document.querySelector('[data-testid=slot-locked-weapon2]')?.textContent ?? '');
      check('E3 drone configuration shows locked slots with their requirement', /locked/i.test(e3) && /Warden level 4/.test(e3), e3);
      await ev(p3, () => window.__rift.home.closeTerminal());
      await ev(p3, () => window.__rift.home.openTerminal('command'));
      await p3.click('.terminal [data-tab=progress]', { timeout: 20000 });
      await p3.waitForSelector('[data-testid=unlock-track]', { timeout: 20000 });
      const e4 = await ev(p3, () => document.querySelector('[data-testid=unlock-track]')?.textContent ?? '');
      check('E4 command console lists the unlock track (teasers with requirements)', /UNLOCK TRACK · 0\//.test(e4) && /Second ability slot/.test(e4), e4.slice(0, 120));
      if (captureScreens) await shot(p3, 'rl-unlock-track', { frames: 2 });
      await ev(p3, () => window.__rift.home.closeTerminal());
      // Drops never include locked families or categories.
      await ev(p3, () => window.__rift.flow.deploy(1));
      await waitFor(p3, () => window.__rift.state().location === 'arena' && !window.__rift.flow.busy);
      const e5 = await ev(p3, () => {
        const g = window.__rift.game;
        const items = [];
        for (let i = 0; i < 300; i++) items.push(...g.rollItems('wave', 3), ...g.rollItems('elite', 3));
        const fams = new Set(items.filter((it) => it.weapon).map((it) => it.build?.family ?? it.defId.split('_')[0]));
        return { n: items.length, cats: [...new Set(items.map((it) => it.category))], fams: [...fams], locks: g.cfg.locks, journal: g.cfg.run.lootJournal.slice(-1)[0]?.locks };
      });
      check('E5 a fresh warden only finds plasma weapons, no modules or ultimates; rolls journal the locks', e5.n > 50 && !e5.cats.includes('module') && !e5.cats.includes('ultimate') && e5.fams.every((f) => f === 'plasma') && e5.locks?.includes('family:rail') && e5.journal?.includes('cat:module'), JSON.stringify(e5));
      await ev(p3, () => window.__rift.flow.abandonRun());
      await waitFor(p3, () => window.__rift.state().location === 'home' && !window.__rift.flow.busy);
      // A locked station is powered off: dark OFFLINE screen, dimmed glow, not listed in the directory.
      const e5b = await ev(p3, () => ({ glow: window.__rift.home.rigs.find((r) => r.station.id === 'fabricate')?.screen?.base, deploy: window.__rift.home.rigs.find((r) => r.station.id === 'deploy')?.screen?.base }));
      check('E5b locked stations are powered off (dim screen), open ones are lit', e5b.glow < 0.5 && e5b.deploy === 1, JSON.stringify(e5b));
      // Gaining levels pauses the HQ on the NEW SYSTEM ONLINE card; GOT IT hands control back.
      await ev(p3, () => window.__rift.home.setScreen('home'));
      await ev(p3, () => { window.__rift.profile.mutate((d) => { d.progress.xp = 9000; return true; }); window.__rift.advance(1 / 30); });
      await p3.waitForSelector('[data-testid=unlock-card]', { timeout: 20000 });
      const e6 = await ev(p3, () => ({ card: document.querySelector('[data-testid=unlock-card]')?.textContent ?? '', screen: window.__rift.state().screen, lock: window.__rift.home.stationLock('salvage'), glow: window.__rift.home.rigs.find((r) => r.station.id === 'salvage')?.screen?.base }));
      if (captureScreens) await shot(p3, 'rl-unlock-card', { frames: 2 });
      await p3.click('[data-testid=unlock-card-ok]');
      await waitFor(p3, () => !document.querySelector('[data-testid=unlock-card]') && window.__rift.state().screen === 'home');
      const e6b = await ev(p3, () => ({ queued: localStorage.getItem(`riftwarden.unlockCard.${window.__rift.profile.save.profile.id}`) }));
      check('E6 level-ups pause on the unlock card, the station powers up, GOT IT resumes', /new systems online/i.test(e6.card) && /Railgun family/.test(e6.card) && e6.screen === 'unlock' && !e6.lock && e6.glow === 1 && e6b.queued === null, JSON.stringify({ ...e6, card: e6.card.slice(0, 120), ...e6b }));
      // Deep lattice: frontier view, search highlights.
      await ev(p3, () => window.__rift.profile.mutate((d) => { d.progress.xp = 9e8; return true; }));
      const lv = await ev(p3, async () => {
        const r = window.__rift;
        const { generateTree, allocateBlocker } = await import('/@id/@riftwarden/rules/progression/skilltree');
        const { levelForXp } = await import('/@id/@riftwarden/rules/progression/level');
        const lvl = levelForXp(r.profile.save.progress.xp);
        // Walk a branch outward ring by ring through real ops.
        for (let i = 0; i < 40; i++) {
          const tree = generateTree(r.profile.save.progress.tree.seed, 60);
          const n = tree.nodes.find((x) => x.branch === 'weapon' && allocateBlocker(tree, r.profile.save.progress.tree.allocated, x.id, lvl) === null && x.ring === i + 1);
          if (!n || !r.profile.op('treeAllocate', [n.id]).ok) break;
        }
        return { lvl, n: r.profile.save.progress.tree.allocated.length };
      });
      await ev(p3, () => window.__rift.home.openTerminal('lattice'));
      await p3.waitForSelector('[data-testid=lattice-frontier]', { timeout: 20000 });
      const drawn = await ev(p3, () => document.querySelectorAll('[data-testid=skill-tree] [data-node]').length);
      await p3.fill('[data-testid=lattice-search]', 'damage');
      const found = await ev(p3, () => [...document.querySelectorAll('[data-testid=skill-tree] [data-node]')].filter((g) => g.getAttribute('opacity') === null).length);
      check('E7 deep lattice opens on the frontier, culls far nodes, search highlights', lv.n >= 30 && drawn > 0 && drawn < 400 && found > 0 && found < drawn, JSON.stringify({ ...lv, drawn, found }));
      if (captureScreens) await shot(p3, 'rl-lattice-deep', { frames: 2 });
      const bad3 = errs3.filter((e) => !/compil(e|ing) effect|Trying next fallback|BJS - \[[\d:]+\]: (Uniforms|Attributes|Defines|Error: (VERTEX|FRAGMENT))|GPU stall|favicon/.test(e));
      check('E8 no runtime errors with the real unlock track', bad3.length === 0, bad3.slice(0, 3).join(' | '));
    } catch (e) {
      check('E no exception', false, e.stack || String(e));
    } finally {
      await b3.close();
    }
  }

  if (want('F')) {
    // Weapon-family mastery: kills earn XP, banking secures it, ranks change stats, perks/finishes via the workshop.
    const { b: b4, p: p4, errs: errs4 } = await launch({ query: '&locks' });
    try {
      await ev(p4, () => window.__rift.flow.enterHq());
      await waitFor(p4, () => window.__rift.state().location === 'home' && !window.__rift.flow.busy);
      await ev(p4, () => window.__rift.flow.deploy(1));
      await waitFor(p4, () => window.__rift.state().location === 'arena' && !window.__rift.flow.busy);
      const f1 = await ev(p4, async () => {
        const r = window.__rift;
        const g = r.game;
        const tick = () => new Promise((res) => setTimeout(res, 0));
        let seen = '';
        // Kill walkers with the real weapon pipeline (direct weapon damage) until wave 5 banks.
        for (let guard = 0; guard < 3000 && g.cfg.run.lastBankedWave < 5; guard++) {
          if (g.screen === 'upgrade' && g.offer) { g.chooseUpgrade(g.offer[0].id); await tick(); }
          if (g.screen !== 'playing' && !(g.screen === 'upgrade' && g.offer)) g.setScreen('playing');
          if (g.waves.phase === 'prep') g.startWave();
          r.advance(0.5);
          for (const e of [...g.enemies.active]) g.damageEnemy('player', e, 1e6, e.center(), false);
          if (!seen) {
            await tick();
            seen = document.querySelector('[data-testid=mastery-gain]')?.textContent ?? '';
          }
        }
        return { seen, unsecured: g.cfg.run.unsecured.mastery?.plasma ?? 0, saved: r.profile.save.progress.mastery?.plasma?.xp ?? 0, banked: g.cfg.run.lastBankedWave };
      });
      check('F1 weapon kills earn plasma mastery (HUD event) and the checkpoint banks it into the profile', /PLASMA MASTERY/.test(f1.seen) && f1.saved > 0 && f1.banked === 5, JSON.stringify(f1));
      await ev(p4, () => window.__rift.flow.abandonRun());
      await waitFor(p4, () => window.__rift.state().location === 'home' && !window.__rift.flow.busy);
      // Rank 12 on plasma: rank damage + a perk in the arena's stat pipeline; the scatter mechanism (rank 5) unlocks.
      const f2 = await ev(p4, async () => {
        const r = window.__rift;
        const { xpForRank } = await import('/@id/@riftwarden/rules/progression/mastery');
        r.profile.mutate((d) => { d.progress.mastery = { plasma: { xp: xpForRank(12), perks: [] } }; d.progress.xp = 5e6; d.threat.unlocked = 6; return true; });
        const perk = r.profile.op('masteryPerk', ['plasma', 2, 1]).ok;
        const tooDeep = r.profile.op('masteryPerk', ['plasma', 3, 0]).ok;
        const fin = r.profile.op('masteryFinish', ['plasma', 'gunmetal']).ok;
        const prestige = r.profile.op('masteryFinish', ['plasma', 'ascended']).ok;
        const { lootLocks } = await import('/@id/@riftwarden/rules/progression/unlocks');
        return { perk, tooDeep, fin, prestige, locks: lootLocks(r.profile.save) };
      });
      check('F2 perks need their rank, finishes need theirs; mastered components leave the loot locks', f2.perk && !f2.tooDeep && f2.fin && !f2.prestige && !f2.locks.includes('comp:plasma:mc_scatter') && f2.locks.includes('comp:plasma:co_prism'), JSON.stringify(f2));
      await ev(p4, () => { window.__rift.home.setScreen('home'); window.__rift.home.openTerminal('workshop'); });
      await p4.click('[data-tab=mastery]');
      await p4.waitForSelector('[data-testid=mastery-bench]', { timeout: 20000 });
      const f3 = await ev(p4, () => ({ rank: document.querySelector('[data-testid=mastery-rank]')?.textContent, perks: document.querySelectorAll('[data-testid=mastery-perks] button:not([disabled])').length, on: document.querySelector('[data-perk="2-1"]')?.className ?? '' }));
      check('F3 workshop MASTERY tab shows rank, open perk tiers and the chosen option', f3.rank === 'R12' && f3.perks >= 4 && /\bon\b/.test(f3.on), JSON.stringify(f3));
      if (captureScreens) await shot(p4, 'rl-mastery', { frames: 2 });
      await ev(p4, () => window.__rift.home.closeTerminal());
      await ev(p4, () => window.__rift.flow.deploy(1));
      await waitFor(p4, () => window.__rift.state().location === 'arena' && !window.__rift.flow.busy);
      const f4 = await ev(p4, () => {
        const g = window.__rift.game;
        const mods = g.cfg.mastery;
        return { dmg: g.stats.weaponDamageMult, finish: g.weapon.rig ? g.weapon.finishFor('plasma') : null, mastery: !!mods?.plasma };
      });
      check('F4 the arena applies rank damage and the chosen finish to plasma weapons', f4.dmg > 1.04 && f4.finish === 'gunmetal' && f4.mastery, JSON.stringify(f4));
      if (captureScreens) await shot(p4, 'rl-mastery-arena', { frames: 2 });
      await ev(p4, () => window.__rift.flow.abandonRun());
      const bad4 = errs4.filter((e) => !/compil(e|ing) effect|Trying next fallback|BJS - \[[\d:]+\]: (Uniforms|Attributes|Defines|Error: (VERTEX|FRAGMENT))|GPU stall|favicon/.test(e));
      check('F5 no runtime errors in the mastery flow', bad4.length === 0, bad4.slice(0, 3).join(' | '));
    } catch (e) {
      check('F no exception', false, e.stack || String(e));
    } finally {
      await b4.close();
    }
  }

  if (want('G')) {
    // Loot feedback: NEW BEST + build verdict + item level on the pickup prompt, the run recap on the summary.
    const { b: b5, p: p5, errs: errs5 } = await launch({});
    try {
      await ev(p5, () => window.__rift.flow.enterHq());
      await waitFor(p5, () => window.__rift.state().location === 'home' && !window.__rift.flow.busy);
      await ev(p5, () => window.__rift.flow.deploy(1));
      await waitFor(p5, () => window.__rift.state().location === 'arena' && !window.__rift.flow.busy);
      const g1 = await ev(p5, async () => {
        const r = window.__rift;
        const g = r.game;
        g.setScreen('playing');
        // A much better weapon right in front of the drone.
        const uid = r.spawnLoot({ rarity: 'epic', category: 'weapon', baseId: 'plasma_repeater', level: 9 });
        const p = g.loot.pickups.find((x) => x.item.uid === uid);
        for (let i = 0; i < 120 && !g.loot.landed(p); i++) r.advance(1 / 30);
        r.approach(p.id);
        r.advance(0.3);
        await new Promise((res) => setTimeout(res, 50));
        return { target: g.lootTarget?.id === p.id, tags: document.querySelector('[data-testid=lp-tags]')?.textContent ?? '', prompt: document.querySelector('.loot-prompt')?.textContent ?? '', uid: p.item.uid };
      });
      check('G1 a better pickup is tagged NEW BEST and UPGRADE FOR YOUR BUILD, with its level against the RL', g1.target && /NEW BEST/.test(g1.tags) && /UPGRADE/.test(g1.tags) && /vs RL/.test(g1.prompt), JSON.stringify(g1).slice(0, 220));
      if (captureScreens) await shot(p5, 'rl-loot-prompt', { frames: 2 });
      const g2 = await ev(p5, async () => {
        const r = window.__rift;
        const g = r.game;
        g.collectPickup(g.lootTarget);
        // Clear to the first checkpoint so the find is secured, then extract.
        const tick = () => new Promise((res) => setTimeout(res, 0));
        for (let guard = 0; guard < 3000 && g.cfg.run.lastBankedWave < 5; guard++) {
          if (g.screen === 'upgrade' && g.offer) { g.chooseUpgrade(g.offer[0].id); await tick(); }
          if (g.screen !== 'playing' && !(g.screen === 'upgrade' && g.offer)) g.setScreen('playing');
          if (g.waves.phase === 'prep') g.startWave();
          r.advance(0.5);
          r.killAll();
        }
        // Equip the find during the next preparation phase (equipment changes are prep-only).
        for (let i = 0; i < 80 && !g.equipAllowed; i++) r.advance(0.25);
        const eq = g.equip(g.cfg.run.secured.items.concat(g.cfg.run.unsecured.items).find((i) => i.rarity === 'epic' && i.category === 'weapon')?.uid ?? '');
        return { banked: g.cfg.run.lastBankedWave, eq };
      });
      const back = await ev(p5, async () => {
        const r = window.__rift;
        for (let i = 0; i < 40 && !r.game.canReturnHome; i++) r.advance(0.25);
        const ok = await r.flow.returnHome();
        return { ok, screen: r.state().screen };
      });
      if (!back.ok) throw new Error('extraction refused ' + JSON.stringify(back));
      await p5.waitForSelector('[data-testid=run-recap]', { timeout: 60000 });
      const g3 = await ev(p5, () => ({ recap: document.querySelector('[data-testid=run-recap]')?.textContent ?? '' }));
      check('G2 the run summary recaps the best find, the power gained and the mastery earned', g2.banked === 5 && g2.eq && /BEST FIND/.test(g3.recap) && /LOADOUT POWER/.test(g3.recap) && /Mastery/.test(g3.recap), g3.recap.slice(0, 200));
      if (captureScreens) await shot(p5, 'rl-run-recap', { frames: 1 });
      const bad5 = errs5.filter((e) => !/compil(e|ing) effect|Trying next fallback|BJS - \[[\d:]+\]: (Uniforms|Attributes|Defines|Error: (VERTEX|FRAGMENT))|GPU stall|favicon/.test(e));
      check('G3 no runtime errors in the loot feedback flow', bad5.length === 0, bad5.slice(0, 3).join(' | '));
    } catch (e) {
      check('G no exception', false, e.stack || String(e));
    } finally {
      await b5.close();
    }
  }

  if (want('H')) {
    // Big spikes: pinnacle keys + summon, codex + title, Rift War victory caches.
    const { b: b6, p: p6, errs: errs6 } = await launch({ query: '&map' });
    try {
      await ev(p6, () => { window.__rift.flow.war.localSeed = 1; return window.__rift.flow.enterHq(); });
      await waitFor(p6, () => window.__rift.state().location === 'home' && !window.__rift.flow.busy);
      await ev(p6, () => window.__rift.profile.mutate((d) => { d.threat.unlocked = 9; d.threat.selected = 9; d.resources.shards = 45; d.progress.xp = 5e6; d.breakthroughs = [5]; d.war = { fought: [0], claimed: [] }; return true; }));
      await ev(p6, () => window.__rift.home.openTerminal('deploy'));
      await p6.waitForSelector('[data-testid=pinnacle]', { timeout: 20000 });
      await p6.click('[data-testid=pinnacle-craft]');
      const h1 = await ev(p6, () => ({ keys: document.querySelector('[data-testid=pinnacle-keys]')?.textContent, shards: window.__rift.profile.save.resources.shards }));
      check('H1 the deploy terminal crafts a pinnacle key from 20 rift shards', h1.keys === '1 KEY' && h1.shards === 25, JSON.stringify(h1));
      if (captureScreens) await shot(p6, 'rl-pinnacle-card', { frames: 2 });
      await p6.click('[data-testid=pinnacle-go]');
      await waitFor(p6, () => window.__rift.state().location === 'arena' && !window.__rift.flow.busy);
      const h2 = await ev(p6, async () => {
        const r = window.__rift;
        const g = r.game;
        g.setScreen('playing');
        if (g.waves.phase === 'prep') g.startWave();
        for (let i = 0; i < 80 && !g.enemies.active.some((e) => e.def.role === 'boss'); i++) r.advance(0.5);
        const boss = g.enemies.active.find((e) => e.def.role === 'boss');
        const before = g.loot.pickups.length;
        if (boss) g.damageEnemy('player', boss, 1e9, boss.center(), false);
        for (let i = 0; i < 30; i++) r.advance(0.25);
        const drops = g.loot.pickups.slice(before).map((p) => p.item.rarity);
        return { pin: g.cfg.pinnacle, map: !!r.flow.map, boss: boss?.kind ?? null, wave: g.waves.number, keys: r.profile.save.pinnacle?.keys, pinRun: r.profile.save.activeRun?.pinnacle, drops, journal: g.cfg.run.lootJournal.some((j) => j.source.id === 'pinnacle') };
      });
      check('H2 summoning spends the key: a classic pinnacle run whose wave 1 is the pinnacle boss', h2.pin && !h2.map && h2.boss && h2.wave === 1 && h2.keys === 0 && h2.pinRun === true, JSON.stringify(h2));
      check('H3 the pinnacle boss drops the legendary-floor pinnacle cache (journaled)', h2.journal && h2.drops.filter((x) => x === 'legendary' || x === 'exotic').length >= 2, JSON.stringify(h2.drops));
      await ev(p6, () => window.__rift.flow.abandonRun());
      await waitFor(p6, () => window.__rift.state().location === 'home' && !window.__rift.flow.busy);
      // Rift War victory: the region this warden fought in is liberated -> claim its cache in the console.
      await ev(p6, () => {
        const w = window.__rift.flow.war;
        const st = structuredClone(w.store.get().war);
        st.regions.find((x) => x.k === 0).status = 'liberated';
        w.store.set({ ...w.store.get(), war: st });
        window.__rift.home.setScreen('home');
        window.__rift.home.openTerminal('command');
      });
      await p6.click('.terminal [data-tab=progress]', { timeout: 20000 });
      await p6.waitForSelector('[data-testid=claim-0]', { timeout: 20000 });
      const h4a = await ev(p6, () => ({ codex: document.querySelector('[data-testid=codex]')?.textContent ?? '', title: document.querySelector('[data-testid=warden-title]')?.textContent }));
      await p6.click('[data-testid=claim-0]');
      const h4 = await ev(p6, () => ({ claimed: window.__rift.profile.save.war.claimed, msg: document.querySelector('[data-testid=war-caches] .term-msg')?.textContent ?? '' }));
      check('H4 command console: codex progress with teasers and the breakthrough title', /CODEX · \d+\/\d+/.test(h4a.codex) && /▒▒/.test(h4a.codex) && h4a.title === 'RIFT BREAKER', JSON.stringify(h4a).slice(0, 160));
      check('H5 a liberated region pays its victory cache once', h4.claimed.includes(0) && /Victory cache/.test(h4.msg), JSON.stringify(h4));
      if (captureScreens) await shot(p6, 'rl-codex', { frames: 2 });
      const bad6 = errs6.filter((e) => !/compil(e|ing) effect|Trying next fallback|BJS - \[[\d:]+\]: (Uniforms|Attributes|Defines|Error: (VERTEX|FRAGMENT))|GPU stall|favicon/.test(e));
      check('H6 no runtime errors in the spikes flow', bad6.length === 0, bad6.slice(0, 3).join(' | '));
    } catch (e) {
      check('H no exception', false, e.stack || String(e));
    } finally {
      await b6.close();
    }
  }

  if (want('I')) {
    // Seasons: start this month's seasonal profile, play a seasonal run, switch back; boards (offline here).
    const { b: b7, p: p7, errs: errs7 } = await launch({});
    try {
      await ev(p7, () => window.__rift.flow.enterHq());
      await waitFor(p7, () => window.__rift.state().location === 'home' && !window.__rift.flow.busy);
      await ev(p7, () => window.__rift.home.openTerminal('deploy'));
      await p7.waitForSelector('[data-testid=season-start]', { timeout: 20000 });
      await p7.click('[data-testid=season-start]');
      const i1 = await ev(p7, () => {
        const pr = window.__rift.profile;
        return { active: pr.seasonActive, seasonId: pr.save.seasonId, perm: pr.permanent.seasonId ?? null, bar: document.querySelector('[data-testid=season-bar]')?.textContent ?? '', unlocked: pr.save.threat.unlocked };
      });
      check('I1 starting the season switches to a fresh seasonal profile (bar says so)', i1.active && i1.seasonId >= 1 && i1.perm === null && /SEASONAL PROFILE/.test(i1.bar) && i1.unlocked === 1, JSON.stringify(i1).slice(0, 200));
      if (captureScreens) await shot(p7, 'rl-season-bar', { frames: 2 });
      await ev(p7, () => window.__rift.home.closeTerminal());
      await ev(p7, () => window.__rift.flow.deploy(1));
      await waitFor(p7, () => window.__rift.state().location === 'arena' && !window.__rift.flow.busy);
      const i2 = await ev(p7, async () => {
        const r = window.__rift;
        const g = r.game;
        const tick = () => new Promise((res) => setTimeout(res, 0));
        for (let guard = 0; guard < 3000 && g.cfg.run.lastBankedWave < 5; guard++) {
          if (g.screen === 'upgrade' && g.offer) { g.chooseUpgrade(g.offer[0].id); await tick(); }
          if (g.screen !== 'playing' && !(g.screen === 'upgrade' && g.offer)) g.setScreen('playing');
          if (g.waves.phase === 'prep') g.startWave();
          r.advance(0.5);
          r.killAll();
        }
        const pr = r.profile;
        return { rule: g.cfg.seasonRule, seasonalUnlocked: pr.save.threat.unlocked, permUnlocked: pr.permanent.threat.unlocked, board: pr.save.board, tagged: pr.journal.state.entries.slice(-1)[0]?.season };
      });
      check('I2 the seasonal run plays under the season rule, banks into the seasonal profile only (board kept)', !!i2.rule && i2.seasonalUnlocked === 2 && i2.permUnlocked === 1 && i2.board?.rl === 2 && i2.tagged >= 1, JSON.stringify(i2));
      await ev(p7, () => window.__rift.flow.abandonRun());
      await waitFor(p7, () => window.__rift.state().location === 'home' && !window.__rift.flow.busy);
      await ev(p7, () => { window.__rift.home.setScreen('home'); window.__rift.home.openTerminal('deploy'); });
      await p7.waitForSelector('[data-testid=season-toggle]', { timeout: 20000 });
      await p7.click('[data-testid=season-toggle]');
      const i3 = await ev(p7, () => ({ active: window.__rift.profile.seasonActive, unlocked: window.__rift.profile.save.threat.unlocked }));
      check('I3 PLAY PERMANENT switches back to the untouched permanent profile', !i3.active && i3.unlocked === 1, JSON.stringify(i3));
      await ev(p7, () => { window.__rift.home.closeTerminal(); });
      await ev(p7, () => { window.__rift.home.setScreen('home'); window.__rift.home.openTerminal('command'); });
      await p7.click('.terminal [data-tab=season]', { timeout: 20000 });
      await p7.waitForSelector('[data-testid=boards-offline]', { timeout: 20000 });
      const i4 = await ev(p7, () => ({ journey: document.querySelector('[data-testid=season-panel]')?.textContent ?? '', boards: document.querySelector('[data-testid=boards]')?.textContent ?? '' }));
      check('I4 command console shows the season journey and explains boards need the server', /JOURNEY · 0\/12/.test(i4.journey) && /Unlock Rift Level 3/.test(i4.journey) && /server/.test(i4.boards), JSON.stringify(i4).slice(0, 200));
      if (captureScreens) await shot(p7, 'rl-season-console', { frames: 2 });
      const bad7 = errs7.filter((e) => !/compil(e|ing) effect|Trying next fallback|BJS - \[[\d:]+\]: (Uniforms|Attributes|Defines|Error: (VERTEX|FRAGMENT))|GPU stall|favicon|Failed to load resource/.test(e));
      check('I5 no runtime errors in the seasons flow', bad7.length === 0, bad7.slice(0, 3).join(' | '));
    } catch (e) {
      check('I no exception', false, e.stack || String(e));
    } finally {
      await b7.close();
    }
  }

  const bad = errs.filter((e) => !/compil(e|ing) effect|Trying next fallback|BJS - \[[\d:]+\]: (Uniforms|Attributes|Defines|Error: (VERTEX|FRAGMENT))|GPU stall|favicon/.test(e));
  check('Z no runtime errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  console.log(`\n${stats.passes} passed, ${stats.failures} failed (${Math.round((Date.now() - t0) / 1000)} s)`);
  if (stats.failures) await saveBrowserFailure(ctx, p, errs, 'rift-levels');
  await b.close();
  process.exit(stats.failures ? 1 : 0);
})();
