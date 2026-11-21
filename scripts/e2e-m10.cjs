// M10 browser suite: biomes, faction archetypes, mutations.
//   A biomes: three biomes from seeds, look applied (fog/sun/tints), hazards built + reserved, briefing shows biome + faction
//   B hazards: frost slows the drone, slag burns it; enemies in frost chill, in slag burn
//   C archetypes: sapper wrecks a tower, skimmer pecks the drone and survives, marksman paints + fires, burrower buries (untargetable) and surfaces
//   D mutations: regenerating heals, splitting splits, shielded barrier, blinking jumps, frostbound ignores chill + nova, molten ignores burn + slag trail
//   E planner: factions bias compositions and bring their archetypes
//   V screenshots (briefings, cryo + foundry overviews)
// Usage: node scripts/e2e-m10.cjs [A,B,...]   (dev server on :5173)
const { launch, check, stats, waitFor, shot, OUT, sectionFilter } = require('./lib/harness.cjs');

const want = sectionFilter();
const SEEDS = { outpost: 2, cryo: 1, foundry: 6 };

async function deploy(p, seed) {
  await p.evaluate(() => window.__rift.state().location === 'arena' && window.__rift.flow.abandonRun());
  await waitFor(p, () => window.__rift.state().location !== 'arena' || !window.__rift.state().busy);
  await p.evaluate(() => window.__rift.state().screen === 'summary' && window.__rift.flow.enterHq?.());
  await waitFor(p, () => !window.__rift.state().busy);
  await p.evaluate((s) => {
    const f = window.__rift.flow;
    f.arenaMode = 'procedural';
    f.nextArenaSeed = s;
    f.skipUpgrades = true;
    return f.deploy(1);
  }, seed);
  await waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.state().busy && window.__rift.game);
}

/** Dev-spawn helper inside the page: enemy near a point, kept alive by default. */
const SPAWN = () => {
  window.__sp = (kind, mods, x, z) => {
    const R = window.__rift;
    const g = R.game;
    if (g.screen !== 'playing') g.setScreen('playing');
    const e = R.dev.spawn(kind, mods || [], 'north');
    if (x !== undefined) {
      e.pos.set(x, 0, z);
      e.navV = -1;
      e.root.position.copyFrom(e.pos);
      e.motion?.reset(e.pos, e.yaw);
    }
    return e;
  };
};

(async () => {
  const { b, p, errs } = await launch({ skipUpgrades: true });
  p.setDefaultTimeout(240000);
  await p.evaluate(() => window.__rift.flow.enterHq?.());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);

  if (want('A') || want('V')) {
    const looks = {};
    for (const [biome, seed] of Object.entries(SEEDS)) {
      await deploy(p, seed);
      looks[biome] = await p.evaluate(() => {
        const g = window.__rift.game;
        const L = g.layout;
        const sun = g.scene.getLightByName('sun');
        return {
          biome: L.biome,
          fog: g.scene.fogDensity,
          sun: [sun.diffuse.r, sun.diffuse.g, sun.diffuse.b].map((v) => Math.round(v * 100) / 100),
          hazards: (L.hazards || []).length,
          hazMeshes: g.hazards ? g.hazards.count : 0,
          reservedHaz: L.reserved.filter((r) => /frost|slag/.test(r.label)).length,
          faction: g.planner.faction ? g.planner.faction.id : null,
          concrete: g.scene.getMaterialByName('castConcrete')?.albedoColor.b ?? null,
        };
      });
      if (want('V')) {
        await p.evaluate((s) => window.__rift.previewLoading(s, 2), seed);
        await p.waitForTimeout(800);
        await p.screenshot({ path: `${OUT}/m10-brief-${biome}.png` });
        await p.evaluate(() => window.__rift.game.setScreen('playing'));
        if (biome !== 'outpost') {
          await p.evaluate(() => {
            const g = window.__rift.game;
            const h = g.layout.hazards[0];
            g.player.camera.position.set(h.x + 16, 14, h.z + 16);
            g.player.camera.setTarget(new g.player.position.constructor(h.x, 0, h.z));
          });
          for (let i = 0; i < 4; i++) {
            await p.evaluate(() => window.__rift.render(1));
            await p.waitForTimeout(1500);
          }
          await shot(p, `m10-${biome}`, { frames: 1, timeout: 400000 });
        }
      }
    }
    if (want('A')) {
      check('A1 three biomes from seeds', looks.outpost.biome === 'outpost' && looks.cryo.biome === 'cryo' && looks.foundry.biome === 'foundry');
      check('A2 biome look applied (fog density + sun colour differ)', looks.cryo.fog > looks.outpost.fog && looks.foundry.sun[2] < looks.cryo.sun[2], JSON.stringify({ c: looks.cryo.sun, f: looks.foundry.sun }));
      check('A3 hazard patches built and reserved (cryo/foundry), none on the outpost', looks.cryo.hazards > 4 && looks.cryo.hazMeshes === looks.cryo.hazards && looks.cryo.reservedHaz === looks.cryo.hazards && looks.foundry.hazards > 4 && looks.outpost.hazards === 0, `${looks.cryo.hazards}/${looks.foundry.hazards}`);
      check('A4 factions drive the planner', looks.cryo.faction === 'rime' && looks.foundry.faction === 'crucible' && looks.outpost.faction === 'scrap');
      check('A5 palette tinted per biome (cryo concrete bluer than foundry)', looks.cryo.concrete > looks.foundry.concrete, `${looks.cryo.concrete} vs ${looks.foundry.concrete}`);
    }
  }

  if (want('B')) {
    await deploy(p, SEEDS.cryo);
    await p.evaluate(SPAWN);
    const frost = await p.evaluate(() => {
      const R = window.__rift;
      const g = R.game;
      const h = g.layout.hazards[0];
      R.teleport(h.x, h.z, 1);
      R.advance(0.3);
      const slowed = g.hazards.playerSpeed;
      const e = window.__sp('walker', [], h.x, h.z);
      let maxChill = 0;
      for (let i = 0; i < 90; i++) {
        e.pos.set(h.x, 0, h.z);
        R.advance(1 / 60);
        maxChill = Math.max(maxChill, e.status.chill);
      }
      R.teleport(g.layout.playerSpawn.x, g.layout.playerSpawn.z, 1);
      R.advance(0.3);
      return { slowed, free: g.hazards.playerSpeed, maxChill };
    });
    check('B1 frost field slows the drone', frost.slowed < 0.8 && frost.free === 1, JSON.stringify(frost));
    check('B2 ground enemies in frost build chill', frost.maxChill > 5, `chill ${frost.maxChill}`);
    await deploy(p, SEEDS.foundry);
    await p.evaluate(SPAWN);
    const slag = await p.evaluate(() => {
      const R = window.__rift;
      const g = R.game;
      const h = g.layout.hazards[0];
      R.teleport(h.x, h.z, 1);
      const hp0 = g.player.hp + g.player.shield;
      R.advance(1.2);
      const hp1 = g.player.hp + g.player.shield;
      const e = window.__sp('walker', [], h.x, h.z);
      let burn = 0;
      for (let i = 0; i < 60; i++) {
        e.pos.set(h.x, 0, h.z);
        R.advance(1 / 60);
        burn = Math.max(burn, e.status.burnStacks);
      }
      R.teleport(g.layout.playerSpawn.x, g.layout.playerSpawn.z, 1);
      return { lost: hp0 - hp1, burn, dmg: g.hazards.playerDamage };
    });
    check('B3 slag pool burns the drone', slag.lost > 5 && slag.dmg > 5, JSON.stringify(slag));
    check('B4 ground enemies in slag ignite', slag.burn > 0);
  }

  if (want('C')) {
    await deploy(p, SEEDS.outpost);
    await p.evaluate(SPAWN);
    const sap = await p.evaluate(() => {
      const R = window.__rift;
      const g = R.game;
      const V = g.player.position.constructor;
      const sp = g.layout.playerSpawn;
      // Open ground near the drop point: tower 10 m ahead, sapper 8 m beyond it.
      const t = g.turrets.add(new V(sp.x + 10, 0, sp.z + 4), 0, g.turretCtx, g.buildConfig);
      R.advance(1.0);
      const e = window.__sp('sapper', [], sp.x + 18, sp.z + 6);
      let hunted = false;
      let planted = false;
      for (let i = 0; i < 60 * 12 && e.alive; i++) {
        R.advance(1 / 60);
        e.hp = e.maxHp;
        hunted ||= e.ai.mode === 'hunt';
        planted ||= e.ai.mode === 'plant';
        g.reactorHp = Math.max(g.reactorHp, 300);
      }
      return { hunted, planted, sapperDead: !e.alive, wrecked: t.wrecked, hp: Math.round(t.hp) };
    });
    check('C1 sapper hunts a tower in sight, plants and detonates', sap.hunted && sap.planted && sap.sapperDead, JSON.stringify(sap));
    check('C2 the charge wrecks a fresh tower', sap.wrecked, JSON.stringify(sap));
    const skim = await p.evaluate(() => {
      const R = window.__rift;
      const g = R.game;
      const pl = g.player.position;
      const e = window.__sp('skimmer', [], pl.x + 14, pl.z + 6);
      const hp0 = g.player.hp + g.player.shield;
      let swoop = false;
      let peel = false;
      for (let i = 0; i < 60 * 6 && e.alive; i++) {
        R.advance(1 / 60);
        e.hp = e.maxHp; // the tower from C1 would shoot it down
        swoop ||= e.ai.mode === 'swoop';
        peel ||= e.ai.mode === 'peel';
      }
      return { swoop, peel, alive: e.alive, lost: hp0 - (g.player.hp + g.player.shield) };
    });
    check('C3 skimmer swoops, pecks the drone and peels away (survives the pass)', skim.swoop && skim.peel && skim.alive && skim.lost > 0, JSON.stringify(skim));
    const mark = await p.evaluate(() => {
      const R = window.__rift;
      const g = R.game;
      g.player.hp = g.player.maxHp;
      const pl = g.player.position;
      const e = window.__sp('marksman', [], pl.x + 20, pl.z + 2);
      const hp0 = g.player.hp + g.player.shield;
      let aimed = false;
      for (let i = 0; i < 60 * 6 && e.alive; i++) {
        R.advance(1 / 60);
        aimed ||= e.ai.mode === 'aim';
        if (e.ai.mode === 'cool' && aimed) break;
      }
      return { aimed, lost: hp0 - (g.player.hp + g.player.shield), mode: e.ai.mode };
    });
    check('C4 marksman paints the drone and lands a heavy shot', mark.aimed && mark.lost >= 20, JSON.stringify(mark));
    const bur = await p.evaluate(() => {
      const R = window.__rift;
      const g = R.game;
      const e = R.dev.spawn('burrower', [], 'east');
      let hiddenSeen = false;
      let upSeen = false;
      let hitWhileHidden = 0;
      for (let i = 0; i < 60 * 14 && e.alive; i++) {
        R.advance(1 / 60);
        if (e.hidden) {
          hiddenSeen = true;
          const r = g.enemies.damage(e, 50, 'kinetic', e.center(), g.fx);
          if (r) hitWhileHidden++;
          if (e.hitboxes.some((h) => h.isPickable)) hitWhileHidden++;
        }
        // Surfaced (mid-route or for good at the reactor): hittable again.
        if ((e.ai.mode === 'up' || e.ai.mode === 'reactor') && !e.hidden && e.hitboxes.every((h) => h.isPickable)) upSeen = true;
        g.reactorHp = Math.max(g.reactorHp, 300);
      }
      const tgt = g.turrets.turrets.length;
      return { hiddenSeen, upSeen, hitWhileHidden, tgt };
    });
    check('C5 burrower travels buried: untargetable and unhittable', bur.hiddenSeen && bur.hitWhileHidden === 0, JSON.stringify(bur));
    check('C6 burrower surfaces (vulnerable)', bur.upSeen);
  }

  if (want('D')) {
    await deploy(p, SEEDS.outpost);
    await p.evaluate(SPAWN);
    const d = await p.evaluate(() => {
      const R = window.__rift;
      const g = R.game;
      const sp = g.layout.playerSpawn;
      R.teleport(sp.x - 30, sp.z - 30, 1);
      const out = {};
      // Regenerating
      let e = window.__sp('walker', ['regenerating'], sp.x + 30, sp.z + 20);
      e.hp = e.maxHp * 0.4;
      const h0 = e.hp;
      R.advance(4);
      out.regen = [Math.round(h0), Math.round(e.hp)];
      // Shielded
      e = window.__sp('walker', ['shielded'], sp.x + 30, sp.z + 25);
      out.shield = [Math.round(e.shield), Math.round(e.maxHp)];
      // Splitting
      e = window.__sp('walker', ['splitting'], sp.x + 30, sp.z + 30);
      const before = g.enemies.active.filter((x) => x.kind === 'walker').length;
      g.damageEnemy('player', e, 1e6, e.center(), false);
      R.advance(0.1);
      out.split = g.enemies.active.filter((x) => x.kind === 'walker').length - before;
      // Blinking
      e = window.__sp('walker', ['blinking'], sp.x + 35, sp.z + 30);
      let jump = 0;
      let last = { x: e.pos.x, z: e.pos.z };
      for (let i = 0; i < 60 * 6; i++) {
        R.advance(1 / 60);
        const d1 = Math.hypot(e.pos.x - last.x, e.pos.z - last.z);
        jump = Math.max(jump, d1);
        last = { x: e.pos.x, z: e.pos.z };
      }
      out.blink = Math.round(jump * 10) / 10;
      // Frostbound: chill immunity
      e = window.__sp('walker', ['frostbound'], sp.x + 40, sp.z + 30);
      g.director.inflict(e, { chill: 200 }, { kind: 'effect', id: 'test' }, g.director.bus.newChain(), e.center());
      out.frost = e.status.chill;
      // Molten: burn immunity + slag trail
      const haz0 = g.hazards.count;
      e = window.__sp('walker', ['molten'], sp.x + 45, sp.z + 30);
      g.director.inflict(e, { burn: 20 }, { kind: 'effect', id: 'test' }, g.director.bus.newChain(), e.center());
      out.burn = e.status.burnStacks;
      R.advance(4);
      out.slag = g.hazards.count - haz0;
      return out;
    });
    check('D1 regenerating heals when left alone', d.regen[1] > d.regen[0] + 5, JSON.stringify(d.regen));
    check('D2 shielded gets a barrier', d.shield[0] >= d.shield[1] * 0.4, JSON.stringify(d.shield));
    // The parent dies (-1) and two copies appear (+2).
    check('D3 splitting leaves two copies', d.split === 1, `net ${d.split}`);
    check('D4 blinking phases forward', d.blink > 4, `max step ${d.blink} m`);
    check('D5 frostbound ignores chill', d.frost === 0, `chill ${d.frost}`);
    check('D6 molten ignores burn and leaves a slag trail', d.burn === 0 && d.slag >= 1, JSON.stringify({ burn: d.burn, slag: d.slag }));
  }

  if (want('E')) {
    const e = await p.evaluate(async () => {
      const { SurvivalPlanner } = await import('/@id/@riftwarden/rules/survival/plan');
      const { BIOMES } = await import('/@id/@riftwarden/rules/world/biomes');
      const count = (f) => {
        const pl = new SurvivalPlanner(777, 2, f);
        const c = {};
        for (let n = 6; n <= 25; n++) for (const s of pl.compose(n).spawns) c[s.kind] = (c[s.kind] || 0) + 1;
        return c;
      };
      return { none: count(null), cryo: count(BIOMES.cryo.faction), foundry: count(BIOMES.foundry.faction) };
    });
    check('E1 no faction: no faction archetypes (classic arena unchanged)', !e.none.burrower && !e.none.skimmer && !e.none.sapper, JSON.stringify(e.none));
    check('E2 cryo brings burrowers, foundry brings skimmer swarms', (e.cryo.burrower || 0) > 0 && (e.foundry.skimmer || 0) > 10, JSON.stringify({ c: e.cryo.burrower, f: e.foundry.skimmer }));
  }

  const bad = errs.filter((x) => !/favicon|DevTools/.test(x));
  check('Z no runtime errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  console.log(`\n${stats.passes} passed, ${stats.failures} failed`);
  await b.close();
  process.exit(stats.failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
