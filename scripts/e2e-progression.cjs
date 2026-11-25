// Warden progression suite: XP banking/loss, levels, Neural Lattice UI, currency clarity, station directory.
// Needs vite on :5173 (npx vite --port 5173). Sections: A xp banking, B defeat keeps a share, C lattice UI + stats,
// D reload persistence + respec, E currency tooltips / terminal purpose / directory ping.
const H = require('./lib/harness.cjs');
const { check, ev, launch, shot } = H;

async function clearThrough(p, wave) {
  return p.evaluate(async (target) => {
    const R = window.__rift;
    for (let guard = 0; guard < 4000; guard++) {
      const g = R.game;
      if (!g) return 'no game';
      if (g.screen === 'checkpoint') {
        if (g.cfg.run.wavesCleared >= target) return 'checkpoint';
        await g.continueRun();
      }
      if (g.screen === 'defeat') return 'defeat';
      if (g.cfg.run.wavesCleared >= target && g.waves.phase === 'prep') return 'cleared';
      if (g.waves.phase === 'prep') g.waves.startNow();
      R.advance(0.5);
      R.killAll();
    }
    return 'timeout';
  }, wave);
}

async function deploy(p, tier = 1) {
  await ev(p, (t) => window.__rift.flow.deploy(t), tier);
  await p.waitForFunction(() => window.__rift.state().location === 'arena' && !window.__rift.state().busy, null, { timeout: 120000 });
  await ev(p, () => window.__rift.advance(0.5));
}

async function toHq(p) {
  await p.waitForFunction(() => window.__rift.state().location === 'home' && !window.__rift.state().busy, null, { timeout: 120000 });
  // Dismiss the run summary (or menu) and walk.
  await ev(p, async () => {
    const h = window.__rift.home;
    if (h.screen !== 'home') await h.takeControl(false);
    window.__rift.advance(0.2);
  });
}

async function openTerminal(p, id) {
  await ev(p, (t) => window.__rift.home.openTerminal(t), id);
  await p.waitForFunction((t) => window.__rift.state().terminal === t || document.querySelector('.terminal'), id, { timeout: 30000 });
}

(async () => {
  const { b, p, errs } = await launch({ skipUpgrades: true });
  const want = H.sectionFilter();
  try {
    await ev(p, () => window.__rift.flow.enterHq());
    await toHq(p);
    await ev(p, () => window.__rift.profile.op('tutorialSkip', []));

    if (want('A')) {
      const xp0 = await ev(p, () => window.__rift.profile.save.progress.xp);
      await deploy(p);
      const r = await clearThrough(p, 5);
      const s = await ev(p, () => {
        const R = window.__rift;
        const run = R.game.cfg.run;
        return { secured: run.secured.xp, unsecured: run.unsecured.xp, saved: R.profile.save.progress.xp, hudXp: document.querySelector('[data-testid="xp-gain"]')?.textContent ?? '' };
      });
      check('A1 reached the wave-5 checkpoint', r === 'checkpoint', r);
      check('A2 checkpoint banked XP into the save', s.secured > 0 && s.saved === xp0 + s.secured, JSON.stringify(s));
      check('A3 checkpoint panel shows the XP gain', /XP/.test(s.hudXp) && /WARDEN \d+/.test(s.hudXp), s.hudXp.slice(0, 80));
      await shot(p, 'prog-A-checkpoint');
      await ev(p, () => window.__rift.flow.returnHome());
      await toHq(p);
      const lvl = await ev(p, () => ({ xp: window.__rift.profile.save.progress.xp, hist: window.__rift.profile.save.history.length }));
      check('A4 extraction keeps the banked XP', lvl.xp >= xp0 + s.secured, JSON.stringify(lvl));
    }

    if (want('B')) {
      const xp0 = await ev(p, () => window.__rift.profile.save.progress.xp);
      await deploy(p);
      await clearThrough(p, 3);
      const before = await ev(p, () => window.__rift.game.cfg.run.xpEarned);
      await ev(p, () => window.__rift.flow.abandonRun());
      await toHq(p);
      const res = await ev(p, () => ({ xp: window.__rift.profile.save.progress.xp, last: window.__rift.profile.save.history[0] }));
      check('B1 abandoning keeps 25% of unsecured XP', res.xp === xp0 + Math.floor(before * 0.25), `earned=${before} gain=${res.xp - xp0}`);
    }

    if (want('C')) {
      // Grant enough XP for several points (level ~8), then allocate through the UI.
      await ev(p, () => window.__rift.profile.mutate((d) => { d.progress.xp = Math.max(d.progress.xp, 4500); }));
      await openTerminal(p, 'lattice');
      await p.waitForSelector('[data-testid="skill-tree"]', { timeout: 30000 });
      const purpose = await p.textContent('[data-testid="term-purpose"]');
      check('C1 lattice terminal shows its purpose and currencies', /skill tree/i.test(purpose) && /XP/.test(purpose), purpose);
      const open = await p.$$eval('[data-state="open"]', (els) => els.map((e) => e.getAttribute('data-node')));
      check('C2 ring-1 nodes are open to allocate', open.length >= 4, open.join(','));
      const hull0 = await ev(p, () => window.__rift.home.player.maxHealth ?? 0);
      let allocated = 0;
      for (let i = 0; i < 3; i++) {
        const id = await p.$$eval('[data-state="open"]', (els) => els[0]?.getAttribute('data-node'));
        if (!id) break;
        await p.click(`[data-node="${id}"]`);
        await p.click('[data-testid="lattice-allocate"]');
        await p.waitForFunction((n) => window.__rift.profile.save.progress.tree.allocated.includes(n), id, { timeout: 10000 });
        allocated++;
      }
      check('C3 allocated nodes through the UI', allocated === 3, `allocated=${allocated}`);
      const state = await p.$$eval('[data-state="on"]', (els) => els.length);
      check('C4 allocated nodes render as active', state === 3, `on=${state}`);
      await shot(p, 'prog-C-lattice');
      await ev(p, () => window.__rift.home.closeTerminal());
      // Real stat pipeline: deploy and compare with the tree's own modifiers.
      await deploy(p);
      const st = await ev(p, () => {
        const g = window.__rift.game;
        return { mods: g.treeMods.length, src: g.treeMods.every((m) => m.source === 'tree') };
      });
      check('C5 tree modifiers reach the arena stat pipeline', st.mods > 0 && st.src, JSON.stringify(st));
      await ev(p, () => window.__rift.flow.abandonRun());
      await toHq(p);
      void hull0;
    }

    if (want('D')) {
      const before = await ev(p, () => window.__rift.profile.save.progress);
      await p.reload();
      await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
      await ev(p, () => window.__rift.stopLoop());
      const after = await ev(p, () => window.__rift.profile.save.progress);
      check('D1 xp and allocation persist across reload', after.xp === before.xp && JSON.stringify(after.tree) === JSON.stringify(before.tree), `${before.tree.allocated.length} -> ${after.tree.allocated.length}`);
      await ev(p, () => window.__rift.flow.enterHq());
      await toHq(p);
      await ev(p, () => window.__rift.profile.mutate((d) => { d.resources.credits = Math.max(d.resources.credits, 1000); }));
      if (after.tree.allocated.length) {
        await openTerminal(p, 'lattice');
        await p.click('[data-testid="lattice-respec"]');
        await p.click('[data-testid="lattice-respec-confirm"]');
        await p.waitForFunction(() => window.__rift.profile.save.progress.tree.allocated.length === 0, null, { timeout: 10000 });
        const r = await ev(p, () => window.__rift.profile.save.progress.respecs);
        check('D2 respec refunds every point and counts', r === 1, `respecs=${r}`);
        await ev(p, () => window.__rift.home.closeTerminal());
      }
    }

    if (want('E')) {
      await openTerminal(p, 'merchant');
      const tip = await p.getAttribute('[data-testid="res-credits"]', 'title');
      check('E1 currency chips explain where a currency comes from', /Earned:/.test(tip) && /Spent on:/.test(tip), (tip || '').slice(0, 60));
      const pur = await p.textContent('[data-testid="term-purpose"]');
      check('E2 economy terminal states its purpose', /Buy equipment/i.test(pur), pur);
      await ev(p, () => window.__rift.home.closeTerminal());
      await openTerminal(p, 'command');
      await p.click('.terminal [data-tab=stations]');
      const n = await p.$$eval('[data-testid="station-directory"] button', (els) => els.length);
      check('E3 command console lists every station', n >= 11, `stations=${n}`);
      await p.click('[data-testid="station-directory"] [data-station="lattice"]');
      await ev(p, () => window.__rift.advance(0.2));
      const ping = await ev(p, () => ({ t: window.__rift.home.pingT, id: window.__rift.home.pinged?.station.id }));
      check('E4 directory ping marks the station', ping.id === 'lattice' && ping.t > 0, JSON.stringify(ping));
      const lvl = await p.textContent('[data-testid="warden-level"]');
      check('E5 HQ overlay shows the Warden level', /WARDEN \d+/.test(lvl), lvl);
      await shot(p, 'prog-E-hq');
    }
    check('Z1 no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) {
    console.error(e);
    check('Z0 suite ran without exceptions', false, String(e));
  } finally {
    await b.close();
    console.log(`\n${H.stats.passes} passed, ${H.stats.failures} failed`);
    process.exit(H.stats.failures ? 1 : 0);
  }
})();
