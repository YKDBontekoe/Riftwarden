// Reproducible performance benchmark (headless Chromium + SwiftShader, `?test` debug API).
//
//   pnpm dev                                   # client on :5173
//   node scripts/bench-perf.cjs                # every scenario
//   node scripts/bench-perf.cjs late,extreme   # selected scenarios
//   BENCH_PROFILE=1 node scripts/bench-perf.cjs late   # + CPU profile hotspots (self time per function)
//   BENCH_JSON=out.json node scripts/bench-perf.cjs    # write the results as JSON
//
// Scenarios: early (wave 2, natural spawns), late (wave 30, ~120 enemies, 12 towers, 14 upgrades, firing),
// extreme (~250 enemies), loot (80 pickups + 40 enemies), extended (20 simulated minutes, heap + counts sampled).
//
// What the numbers mean: `sim` is one fixed 60 Hz simulation step (`__rift.advance(1/60)`), pure CPU and
// representative of real hardware up to the CPU difference. `frame` is a simulation step plus `scene.render()`;
// under SwiftShader the GL work runs in software on the CPU, so absolute render times are NOT representative of a
// GPU, but draw calls, active meshes and the JS side of rendering (culling, uniform uploads) are. Results go in
// docs/testing/performance.md.
const H = require('./lib/harness.cjs');
const fs = require('node:fs');

const ARG = (process.argv[2] || '').split(',').filter(Boolean);
const want = (k) => !ARG.length || ARG.includes(k);
const PROFILE = process.env.BENCH_PROFILE === '1';

const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
function summary(times) {
  const s = [...times].sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  const r = (x) => +x.toFixed(2);
  return { n: s.length, avg: r(avg), p50: r(pct(s, 0.5)), p95: r(pct(s, 0.95)), p99: r(pct(s, 0.99)), p999: r(pct(s, 0.999)), max: r(s[s.length - 1]) };
}

async function deploy(p, tier, seed) {
  await H.ev(p, ([t, s]) => { const R = window.__rift; R.flow.skipUpgrades = true; R.flow.nextUpgradeSeed = s; return R.dev.deploy(t); }, [tier, seed]);
  await H.waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.state().busy && window.__rift.game, null, 180000);
  await H.ev(p, () => window.__rift.advance(1 / 60));
}
async function home(p) {
  await H.ev(p, async () => { const f = window.__rift.flow; if (!(await f.abandonRun())) await f.leaveArena(); });
  await H.waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy, null, 180000);
  await H.ev(p, () => { const R = window.__rift; if (R.state().screen === 'summary') R.home.takeControl(false); });
}

/**
 * Installed in the page once: scenario setup and a measuring loop that keeps the population topped up.
 * Spawns are deterministic (fixed kinds/mods/gates by index) and Math.random is seeded per scenario so the
 * before/after runs see the same fight.
 */
async function install(p) {
  await H.ev(p, () => {
    const KINDS = ['walker', 'enforcer', 'artillery', 'engineer', 'rusher', 'bulwark'];
    const MODS = [['overcharged'], ['armored', 'volatile'], ['accelerated', 'volatile'], ['overcharged', 'armored'], [], [], []];
    const GATES = ['north', 'east', 'west', 'south'];
    let seed = 1;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    window.__bench = {
      seedRandom(s) { seed = s >>> 0; Math.random = rand; },
      heavy({ wave, towers, upgrades, enemies }) {
        const R = window.__rift, g = R.game, V = R.V3;
        R.dev.jump(wave);
        R.dev.evolve('routes'); R.dev.evolve('instability');
        const spots = [[-14, -24], [14, -24], [-22, 6], [22, -6], [-6, 16], [6, -16], [-26, -10], [26, 12], [-10, 26], [10, 26], [-30, 0], [30, 0]];
        for (const [x, z] of spots.slice(0, towers)) { const t = g.turrets.add(new V(x, 0, z), 0, g.turretCtx); if (t) t.building = false; }
        let taken = 0;
        for (let i = 0; i < 60 && taken < upgrades; i++) { const offer = g.director.build.roll({ wave, family: g.weapon.def.family, towers, towerArchetypes: ['ballistic'] }, 100 + i); if (offer[0] && g.director.takeUpgrade(offer[0].id)) taken++; }
        g.startWave(); R.advance(0.5);
        const per = Math.ceil(enemies / 6);
        g.enemies.prewarm(Object.fromEntries(KINDS.map((k) => [k, per])));
        for (let i = 0; i < 400 && g.enemies.warming > 0; i++) R.advance(1 / 60);
        for (let i = 0; i < enemies; i++) R.dev.spawn(KINDS[i % KINDS.length], MODS[i % MODS.length], GATES[i % 4]);
        g.togglePerf(true);
        return { taken, towers: g.turrets.turrets.length };
      },
      /** `steps` fixed simulation steps; every `renderEvery` steps also render one frame (0 = never). */
      measure({ steps, keep = 0, fire = true, renderEvery = 0, sampleEvery = 0 }) {
        const R = window.__rift, g = R.game;
        R.teleport(0, -12); R.look(0, 0.05);
        if (fire) g.input.simulateMouse(0, true);
        const sim = [], frame = [], render = [], samples = [];
        let maxEnemies = 0, maxParticles = 0, maxOrd = 0, maxPickups = 0, nan = false, spawned = 0, kills0 = g.kills;
        const spikes = [];
        let drawSum = 0, activeSum = 0, notReadySum = 0;
        const effects0 = new Set(Object.keys(g.scene.getEngine()._compiledEffects || {}));
        for (let i = 0; i < steps; i++) {
          const before = { mats: g.scene.materials.length, meshes: g.scene.meshes.length, kills: g.kills, pickups: g.loot.pickups.length, effects: g.scene.getEngine()._compiledEffects ? Object.keys(g.scene.getEngine()._compiledEffects).length : 0 };
          const t0 = performance.now();
          R.advance(1 / 60);
          const t1 = performance.now();
          sim.push(t1 - t0);
          // What changed during a slow step (attribution for frame-time spikes).
          if (t1 - t0 > 40 && spikes.length < 12) spikes.push({ i, ms: +(t1 - t0).toFixed(1), ai: +g.enemies.aiMs.toFixed(1), mats: g.scene.materials.length - before.mats, meshes: g.scene.meshes.length - before.meshes, kills: g.kills - before.kills, pickups: g.loot.pickups.length - before.pickups, effects: (g.scene.getEngine()._compiledEffects ? Object.keys(g.scene.getEngine()._compiledEffects).length : 0) - before.effects });
          if (renderEvery && i % renderEvery === 0) {
            R.render(1);
            const t2 = performance.now();
            render.push(t2 - t1);
            frame.push(t2 - t0);
            drawSum += g.drawCalls;
            const am = g.scene.getActiveMeshes();
            activeSum += am.length;
            // Selected for drawing but skipped because the shader is not compiled yet (pop-in): read passively.
            for (let k = 0; k < am.length; k++) {
              const m = am.data[k];
              const src = m.getClassName() === 'InstancedMesh' ? m.sourceMesh : m;
              const dw = src.subMeshes?.[0]?._getDrawWrapper?.();
              if (!dw || !dw.effect || !dw.effect.isReady()) notReadySum++;
            }
          }
          maxEnemies = Math.max(maxEnemies, g.enemies.count);
          maxParticles = Math.max(maxParticles, g.fx.particleCount);
          maxOrd = Math.max(maxOrd, g.ordnance.live);
          maxPickups = Math.max(maxPickups, g.loot.pickups.length);
          if (!g.player.alive) g.player.respawnT = 0;
          g.reactorHp = 1000;
          if (keep && g.enemies.count < keep) {
            for (let k = 0; k < 3 && g.enemies.count < keep; k++, spawned++) R.dev.spawn(KINDS[spawned % KINDS.length], MODS[spawned % MODS.length], GATES[spawned % 4]);
          }
          if (i % 120 === 0 && g.enemies.active.some((e) => !Number.isFinite(e.hp) || !Number.isFinite(e.pos.x))) nan = true;
          if (sampleEvery && i % sampleEvery === 0) {
            const m = performance.memory;
            samples.push({ t: +(i / 60).toFixed(0), heapMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null, meshes: g.scene.meshes.length, materials: g.scene.materials.length, textures: g.scene.textures.length, particleSystems: g.scene.particleSystems.length, enemies: g.enemies.count, pickups: g.loot.pickups.length });
          }
        }
        g.input.simulateMouse(0, false);
        // Shader variants first compiled during the measured window (each is a hitch on a real GPU too).
        const compiled = g.scene.getEngine()._compiledEffects || {};
        const users = new Map();
        for (const m of g.scene.meshes) for (const sm of m.subMeshes || []) {
          const fx = sm.effect;
          if (!fx) continue;
          const list = users.get(fx) || [];
          if (list.length < 4) list.push(`${m.name}<${sm.getMaterial()?.name}>${m.getClassName() === 'InstancedMesh' ? '[i]' : ''} L${m.lightSources.length}`);
          users.set(fx, list);
        }
        const newEffects = Object.keys(compiled).filter((k) => !effects0.has(k)).map((k) => ({ users: users.get(compiled[k]) || [], key: k.replace(/\s+/g, ' ') }));
        const oldEffects = [...effects0].map((k) => k.replace(/\s+/g, ' '));
        return { newEffects, oldEffects, sim, frame, render, spikes, maxEnemies, maxParticles, maxOrd, maxPickups, nan, kills: g.kills - kills0, draws: render.length ? Math.round(drawSum / render.length) : g.drawCalls, activeMeshes: render.length ? Math.round(activeSum / render.length) : g.scene.getActiveMeshes().length, notReady: render.length ? Math.round(notReadySum / render.length) : 0, meshes: g.scene.meshes.length, samples };
      },
    };
  });
}

async function profileStart(p) {
  if (!PROFILE) return null;
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  return cdp;
}
async function profileStop(cdp, label) {
  if (!cdp) return;
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]);
    const cf = n.callFrame;
    const key = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/(src|node_modules)\//, '').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (dt[i] || 0));
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  console.log(`\n--- CPU profile (${label}): top self time, ${(total / 1000).toFixed(0)} ms sampled`);
  for (const [k, v] of top) console.log(`${((v / total) * 100).toFixed(1).padStart(5)}%  ${(v / 1000).toFixed(1).padStart(8)} ms  ${k}`);
  if (process.env.E2E_OUT) fs.writeFileSync(`${process.env.E2E_OUT}/bench-${label}.cpuprofile`, JSON.stringify(profile));
}

function report(name, r, extra = {}) {
  const out = { scenario: name, sim: summary(r.sim), ...(r.frame.length ? { frame: summary(r.frame), render: summary(r.render) } : {}), maxEnemies: r.maxEnemies, maxParticles: r.maxParticles, maxOrdnance: r.maxOrd, maxPickups: r.maxPickups, kills: r.kills, draws: r.draws, activeMeshes: r.activeMeshes, notReady: r.notReady, meshes: r.meshes, nan: r.nan, ...extra };
  if (r.samples.length) out.samples = r.samples;
  if (r.spikes && r.spikes.length) out.spikes = r.spikes;
  out.newEffects = r.newEffects.length;
  if (process.env.BENCH_EFFECTS && r.newEffects.length) fs.writeFileSync(`${process.env.BENCH_EFFECTS}-${name}.json`, JSON.stringify({ added: r.newEffects, before: r.oldEffects }, null, 1));
  console.log(`\n=== ${name}`);
  console.log(JSON.stringify(out, null, 1).replace(/\n\s*/g, ' '));
  return out;
}

(async () => {
  const { b, p, errs } = await H.launch({ gc: true });
  await install(p);
  const results = [];
  const run = async (name, tier, setup, measure, extra) => {
    await deploy(p, tier, 5150);
    await install(p);
    await H.ev(p, () => window.__bench.seedRandom(12345));
    const info = setup ? await H.ev(p, setup[0], setup[1]) : {};
    // Warm-up: shader compiles, pools, JIT.
    await H.ev(p, () => { for (let i = 0; i < 4; i++) { window.__rift.advance(1 / 60); window.__rift.render(1); } window.__rift.advance(1); });
    await H.ev(p, () => window.gc && window.gc());
    const cdp = await profileStart(p);
    const r = await H.ev(p, (o) => window.__bench.measure(o), measure);
    await profileStop(cdp, name);
    results.push(report(name, r, { ...info, ...(extra || {}) }));
    await home(p);
  };

  if (want('early')) await run('early', 1, [() => { const g = window.__rift.game; g.togglePerf(true); g.startWave(); window.__rift.advance(2); return {}; }], { steps: 900, keep: 0, renderEvery: 6 });
  if (want('late')) await run('late', 3, [(o) => window.__bench.heavy(o), { wave: 30, towers: 12, upgrades: 14, enemies: 120 }], { steps: 900, keep: 120, renderEvery: 6 });
  if (want('extreme')) await run('extreme', 3, [(o) => window.__bench.heavy(o), { wave: 40, towers: 12, upgrades: 14, enemies: 250 }], { steps: 600, keep: 250, renderEvery: 10 });
  if (want('loot')) {
    await run('loot', 2, [() => {
      const R = window.__rift, g = R.game;
      R.dev.jump(10);
      for (let i = 0; i < 80; i++) R.spawnLoot({ x: -30 + (i % 10) * 6, z: -30 + Math.floor(i / 10) * 7, rarity: ['common', 'uncommon', 'rare', 'epic', 'legendary'][i % 5], seed: 1000 + i });
      window.__bench.heavy({ wave: 10, towers: 4, upgrades: 4, enemies: 40 });
      return { pickups: g.loot.pickups.length };
    }], { steps: 600, keep: 40, renderEvery: 6 });
  }
  if (want('extended')) await run('extended', 3, [(o) => window.__bench.heavy(o), { wave: 25, towers: 8, upgrades: 10, enemies: 80 }], { steps: 60 * 60 * 20, keep: 80, renderEvery: 60, sampleEvery: 60 * 120 });

  if (process.env.BENCH_JSON) fs.writeFileSync(process.env.BENCH_JSON, JSON.stringify(results, null, 2));
  const real = errs.filter((e) => !/hit-?flash|uniform|Unable to compile effect|FRAGMENT SHADER|VERTEX SHADER/i.test(e));
  console.log(real.length ? `\nERRORS (${real.length}):\n` + real.slice(0, 8).join('\n') : '\nno page errors');
  await b.close();
})().catch((e) => { console.error(e); process.exit(2); });
