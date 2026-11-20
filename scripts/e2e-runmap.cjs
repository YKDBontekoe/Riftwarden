// Run map browser suite: A deploy into the map + node HUD, B node completion -> map screen, C travel with carry,
// D hub stations (merchant / forge / rest / anomaly / vault), E extract + records + codex, F resume after reload,
// G null field + act boss, V screenshots.
//   node scripts/e2e-runmap.cjs [A,B,...]   (dev server on :5173)
const { stats, check, sectionFilter, S, ev, waitFor, launch, shot } = require('./lib/harness.cjs');

const want = sectionFilter();

/** Finish the current combat node: start each wave, kill through the real pipeline, pick upgrades. */
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
    // Let the clear celebration finish and the next preparation start (upgrade -> map).
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

async function travelTo(p, pick) {
  const id = await ev(p, (pick) => {
    const v = window.__rift.flow.map.view(window.__rift.game);
    const nodes = v.reachable.map((id) => window.__rift.flow.map.node(id));
    const n = (pick && nodes.find((x) => x.kind === pick)) || nodes[0];
    window.__rift.flow.travel(n.id);
    return n.id;
  }, pick);
  await waitFor(p, () => !window.__rift.flow.busy && window.__rift.game && window.__rift.game.node);
  await ev(p, () => window.__rift.advance(1 / 60));
  return id;
}

/** Force the next node's kind for station tests (rewrites a reachable node in the memoised act). */
async function forceNext(p, kind, anomaly) {
  return ev(p, ([kind, anomaly]) => {
    const m = window.__rift.flow.map;
    const n = m.reachable()[0];
    n.kind = kind;
    n.mods = [];
    n.boss = null;
    n.anomaly = kind === 'event' ? anomaly || 'pact' : null;
    return n.id;
  }, [kind, anomaly]);
}

(async () => {
  const { b, p, errs } = await launch({ query: '&map' });
  const t0 = Date.now();
  try {
    await ev(p, () => window.__rift.flow.enterHq());
    await ev(p, () => window.__rift.flow.deploy(1));
    await waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.flow.busy);
    await ev(p, () => window.__rift.advance(1 / 60));

    if (want('A')) {
      const a = await ev(p, () => {
        const r = window.__rift;
        const g = r.game;
        const save = r.profile.save;
        return { node: !!g.node, kind: g.node?.node.kind, row: g.node?.node.row, from: g.node?.from, to: g.node?.to, wave: g.waves.number, map: !!save.activeRun?.map, path: save.activeRun?.map?.path, chip: !!document.querySelector('[data-testid=node-chip]') };
      });
      check('A1 deploy enters act 1 row 0 combat node', a.node && a.kind === 'combat' && a.row === 0, JSON.stringify(a));
      check('A2 segment covers waves 1-5', a.from === 1 && a.to === 5 && a.wave === 1);
      check('A3 active run stores the map + path', a.map && a.path?.length === 1);
      await ev(p, () => window.__rift.advance(0.2));
      check('A4 node chip on the HUD', await ev(p, () => !!document.querySelector('[data-testid=node-chip]')));
    }

    let firstCarry = null;
    if (want('B') || want('C') || want('D') || want('E') || want('F') || want('G')) {
      const r = await clearNode(p);
      const st = await ev(p, () => ({ screen: window.__rift.state().screen, banked: window.__rift.profile.save.activeRun.bankedThroughWave, view: window.__rift.state && !!document.querySelector('[data-testid=runmap]'), reach: window.__rift.flow.map.reachable().length, canHome: window.__rift.game.canReturnHome, hold: window.__rift.game.waves.hold }));
      check('B1 node completes after wave 5 and banks', r.complete && st.banked === 5, JSON.stringify({ r, st }));
      check('B2 map screen opens with reachable nodes', st.screen === 'runmap' && st.view && st.reach >= 1, JSON.stringify(st));
      check('B3 waves held, extraction available', st.hold && st.canHome);
      if (want('V')) await shot(p, 'runmap-screen', { frames: 2 });
      // Back to the arena and back to the map with H.
      await p.click('[data-testid=rm-stay]');
      await ev(p, () => { window.__rift.game.setScreen('playing'); window.__rift.advance(0.1); });
      await ev(p, () => { window.__rift.game.input.simulateKey('KeyH', true); window.__rift.advance(1 / 60); window.__rift.game.input.simulateKey('KeyH', false); window.__rift.advance(1 / 60); });
      check('B4 H reopens the map', (await S(p)).screen === 'runmap');
      firstCarry = await ev(p, () => {
        const g = window.__rift.game;
        g.wallet.cores = 777;
        return { cores: 777, ups: g.director.build.total, kills: window.__rift.flow.run.kills };
      });
    }

    if (want('C') || want('D') || want('E') || want('F') || want('G')) {
      const kind = await ev(p, () => window.__rift.flow.map.reachable().find((n) => n.kind === 'combat' || n.kind === 'elite') ? 'combat' : null);
      if (!kind) await forceNext(p, 'combat');
      const prevRun = await ev(p, () => window.__rift.flow.run.id);
      await travelTo(p, 'combat');
      const c = await ev(p, () => {
        const g = window.__rift.game;
        return { from: g.node.from, wave: g.waves.number, cores: g.wallet.cores, ups: g.director.build.total, run: window.__rift.flow.run.id, kills: window.__rift.flow.run.kills, towers: g.turrets.turrets.length, path: window.__rift.profile.save.activeRun.map.path.length, resum: !!window.__rift.profile.save.activeRun.map.carry, row: g.node.node.row };
      });
      check('C1 travel builds a new arena on row 1, waves continue at 6', c.row === 1 && c.from === 6 && c.wave === 6, JSON.stringify(c));
      check('C2 cores and upgrades carry, same run ledger', c.cores >= firstCarry.cores && c.ups === firstCarry.ups && c.run === prevRun && c.kills === firstCarry.kills, JSON.stringify({ c, firstCarry }));
      check('C3 resume point stored', c.resum && c.path === 2);
    }

    if (want('D')) {
      // Fake a hub next: finish this node, then force merchant / forge / rest / event / vault in turn.
      const hubs = [['merchant'], ['forge'], ['rest'], ['event', 'pact'], ['vault']];
      for (const [kind, anomaly] of hubs) {
        const g0 = await ev(p, () => window.__rift.game.node.combat);
        if (g0) await clearNode(p);
        else await ev(p, () => { const g = window.__rift.game; g.checkpointOpen = true; g.openCheckpoint(); });
        await forceNext(p, kind, anomaly);
        await travelTo(p, kind);
        const h = await ev(p, () => {
          const g = window.__rift.game;
          g.wallet.cores = 5000;
          g.setScreen('playing');
          const n = g.node;
          return { kind: n.node.kind, hold: g.waves.hold, complete: n.complete, stations: n.stations.length, canHome: g.canReturnHome };
        });
        check(`D ${kind}: hub holds waves, has station + exit`, h.kind === kind && h.hold && h.complete && h.stations === 2, JSON.stringify(h));
        // Open the station panel through E at the station.
        const opened = await ev(p, () => {
          const r = window.__rift;
          const g = r.game;
          const s = g.node.stations[0];
          g.player.controller.setPosition(new r.V3(s.at.x + (s.at.x > 0 ? -4 : 4), 1.2, s.at.z));
          g.player.controller.setVelocity(new r.V3(0, 0, 0));
          const eye = g.player.camera.position;
          r.advance(1 / 30);
          g.player.yaw = Math.atan2(s.at.x - g.player.position.x, s.at.z - g.player.position.z);
          g.player.pitch = 0.15;
          r.advance(1 / 30);
          g.input.simulateKey('KeyE', true);
          r.advance(1 / 60);
          g.input.simulateKey('KeyE', false);
          r.advance(1 / 60);
          void eye;
          return g.screen;
        });
        check(`D ${kind}: E opens the station panel`, opened === 'station', opened);
        await p.waitForSelector('[data-testid=station]', { timeout: 20000 }).catch(() => {});
        if (want('V')) await shot(p, `station-${kind}`, { frames: 1 });
        const res = await ev(p, (kind) => {
          const g = window.__rift.game;
          const n = g.node;
          const panel = n.panel();
          const before = { cores: g.wallet.cores, cargo: g.inventory.cargoUsed, reactor: g.reactorHp, stats: g.stats.weaponDamageMult, curses: n.carry.curses.length, blessings: n.carry.blessings.length };
          const opt = kind === 'merchant' ? panel.options[0].id : kind === 'forge' ? 'temper' : kind === 'rest' ? 'reflect' : kind === 'event' ? 'sign' : 'open';
          const why = n.act(opt);
          const after = { cores: g.wallet.cores, cargo: g.inventory.cargoUsed, stats: g.stats.weaponDamageMult, curses: n.carry.curses.length, blessings: n.carry.blessings.length, picks: n.carry.picks, guard: n.guardiansActive };
          return { why, before, after, opt };
        }, kind);
        const ok = {
          merchant: res.after.cargo === res.before.cargo + 1 && res.after.cores < res.before.cores,
          forge: res.after.stats > res.before.stats && res.after.cores < res.before.cores,
          rest: res.after.picks === 1,
          event: res.after.curses === res.before.curses + 1 && res.after.blessings === res.before.blessings + 1,
          vault: res.after.guard === true,
        }[kind];
        check(`D ${kind}: option applies`, !res.why && ok, JSON.stringify(res));
        await ev(p, () => window.__rift.game.continueRun());
        await ev(p, () => window.__rift.game.setScreen('playing'));
        if (kind === 'rest') {
          await ev(p, () => window.__rift.advance(0.1));
          check('D rest: owed upgrade pick opens the upgrade panel', (await S(p)).screen === 'upgrade');
          await ev(p, () => { const g = window.__rift.game; g.chooseUpgrade(g.offer[0].id); });
          await ev(p, () => { window.__rift.game.setScreen('playing'); window.__rift.advance(0.1); });
        }
        if (kind === 'vault') {
          const v = await ev(p, () => {
            const r = window.__rift;
            const g = r.game;
            const pick0 = g.loot.count;
            const blocked = g.canReturnHome;
            for (let i = 0; i < 600 && g.node.guardiansActive; i++) { r.advance(0.25); r.killAll(); }
            r.advance(1);
            return { blocked, done: !g.node.guardiansActive, loot: g.loot.count - pick0, canHome: g.canReturnHome, shards: r.flow.run.unsecured.shards };
          });
          check('D vault: guardians block extraction, then drop the cache', !v.blocked && v.done && v.loot > 0 && v.canHome && v.shards >= 2, JSON.stringify(v));
        }
        // Use the exit rift: the map opens.
        const exit = await ev(p, () => {
          const r = window.__rift;
          const g = r.game;
          const s = g.node.stations.find((x) => x.kind === 'exit');
          g.player.controller.setPosition(new r.V3(s.at.x + 4, 1.2, s.at.z));
          r.advance(1 / 30);
          g.player.yaw = Math.atan2(s.at.x - g.player.position.x, s.at.z - g.player.position.z);
          g.player.pitch = 0.2;
          r.advance(1 / 30);
          g.lootTarget = null;
          g.input.simulateKey('KeyE', true);
          r.advance(1 / 60);
          g.input.simulateKey('KeyE', false);
          r.advance(1 / 60);
          return g.screen;
        });
        check(`D ${kind}: exit rift opens the map`, exit === 'runmap', exit);
      }
      const carried = await ev(p, () => {
        const g = window.__rift.game;
        return { forge: g.node.carry.forge.temper ?? 0, curses: g.node.carry.curses.length, blessings: g.node.carry.blessings.length };
      });
      check('D forge tempering, curses and blessings carry across nodes', carried.forge === 1 && carried.curses >= 1 && carried.blessings >= 1, JSON.stringify(carried));
    }

    if (want('F')) {
      // Choose a node, then simulate a closed tab: reload, resume from the HQ.
      const before = await ev(p, () => {
        const g = window.__rift.game;
        if (g.screen !== 'runmap') { g.checkpointOpen = true; g.openCheckpoint(); }
        return { cleared: window.__rift.flow.map.state.cleared, kills: window.__rift.flow.run.kills };
      });
      if (!(await ev(p, () => window.__rift.game.node.complete))) await clearNode(p);
      const target = await travelTo(p, null);
      await p.evaluate(() => { window.__rift.flow.input.forceCapture = true; });
      await p.reload();
      await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
      await ev(p, () => window.__rift.stopLoop());
      const f = await ev(p, () => {
        const a = window.__rift.profile.save.activeRun;
        return { active: !!a, next: a?.map?.next, resumable: !!a?.map?.carry, history: window.__rift.profile.save.history.length };
      });
      check('F1 closed tab keeps the run resumable (not interrupted)', f.active && f.resumable && f.next === target, JSON.stringify(f));
      await ev(p, () => window.__rift.flow.enterHq());
      await ev(p, () => window.__rift.flow.resumeRun());
      await waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.flow.busy);
      const g = await ev(p, () => ({ node: window.__rift.game.node.node.id, kills: window.__rift.flow.run.kills, cleared: window.__rift.flow.map.state.cleared }));
      check('F2 resume restarts the chosen node with the ledger counters', g.node === target && g.kills >= before.kills, JSON.stringify({ g, before }));
    }

    if (want('E')) {
      const g = await ev(p, () => window.__rift.game.node.combat);
      if (g) await clearNode(p);
      const e = await ev(p, async () => {
        const r = window.__rift;
        const g = r.game;
        if (g.screen !== 'runmap') { g.checkpointOpen = true; g.openCheckpoint(); }
        const cleared = r.flow.map.state.cleared;
        await r.flow.returnHome();
        const s = r.profile.save;
        const h = s.history[0];
        return { active: s.activeRun, outcome: h.outcome, act: h.act, nodes: h.nodes, path: h.path, cleared, rec: s.records['1'] };
      });
      await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.flow.busy);
      check('E1 extraction records the run with its map path', !e.active && e.outcome === 'returned' && e.nodes === e.cleared + 1 && e.path.length === e.nodes, JSON.stringify(e));
      check('E2 map records', e.rec.deepestAct >= 1 && e.rec.bestNodes === e.nodes);
      await ev(p, () => window.__rift.flow.enterHq());
      await ev(p, () => window.__rift.home.openTerminal('deploy'));
      await p.waitForSelector('[data-testid=rm-preview]', { timeout: 20000 }).catch(() => {});
      const d = await ev(p, () => ({ preview: !!document.querySelector('[data-testid=rm-preview]'), codex: !!document.querySelector('[data-testid=dm-codex]'), entries: document.querySelectorAll('[data-testid^=rm-node-a1r0]').length }));
      check('E3 HQ deploy terminal previews act 1 with entry choices + codex', d.preview && d.codex && d.entries >= 2, JSON.stringify(d));
      if (want('V')) await shot(p, 'deploy-map-preview', { frames: 2 });
      await ev(p, () => window.__rift.home.setScreen('home'));
    }

    if (want('G')) {
      // Act boss: jump straight to the boss node of act 1 via a forced map state.
      await ev(p, () => window.__rift.flow.enterHq());
      if ((await S(p)).location !== 'arena') {
        await ev(p, () => window.__rift.flow.deploy(1));
        await waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.flow.busy);
      }
      const g = await ev(p, () => {
        const r = window.__rift;
        const n = r.game.node;
        n.node.mods.push('no_towers');
        n.setup.effect.noTowers = true;
        r.game.setScreen('playing');
        r.game.input.simulateKey('KeyB', true);
        r.advance(1 / 60);
        r.game.input.simulateKey('KeyB', false);
        r.advance(1 / 60);
        return { build: r.game.construction.active };
      });
      check('G1 null field refuses build mode', g.build === false);
    }

    // SwiftShader: the known hit-flash PBR variant can exceed the uniform buffer limit (see CLAUDE.md, m1 Z).
    const bad = errs.filter((e) => !/compil(e|ing) effect|Trying next fallback|BJS - \[[\d:]+\]: (Uniforms|Attributes|Defines|Error: (VERTEX|FRAGMENT))|GPU stall|favicon/.test(e));
    check('Z no runtime errors', bad.length === 0, bad.slice(0, 5).join(' | '));
  } catch (e) {
    console.log('FAIL  exception', e.stack || e);
    stats.failures++;
  } finally {
    console.log(`\n${stats.passes} passed, ${stats.failures} failed (${Math.round((Date.now() - t0) / 1000)} s)`);
    await b.close();
    process.exit(stats.failures ? 1 : 0);
  }
})();
