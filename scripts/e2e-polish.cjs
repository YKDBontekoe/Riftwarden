// Polish milestone acceptance suite: hit flash, wreck deaths, mood, HQ ambience. Needs vite on :5173.
const H = require('./lib/harness.cjs');
const { check, ev, launch, shot, S } = H;

async function deploy(p, tier = 1) {
  await ev(p, (t) => { const R = window.__rift; R.flow.skipUpgrades = true; return R.dev.deploy(t); }, tier);
  await p.waitForFunction(() => window.__rift.state().location === 'arena', null, { timeout: 120000 });
  await ev(p, () => window.__rift.advance(0.5));
}

(async () => {
  const { b, p, errs } = await launch({ skipUpgrades: true });
  const want = H.sectionFilter();
  try {
    if (want('A')) {
      await deploy(p);
      const r = await ev(p, () => {
        const R = window.__rift;
        const e = R.dev.spawn('walker');
        R.advance(0.2);
        const en = R.game.enemies.active[0];
        const vecs = [];
        for (const m of en.root.getChildMeshes(false)) if (m.instancedBuffers && m.instancedBuffers.instanceFlash) vecs.push(m.instancedBuffers.instanceFlash);
        R.game.damageEnemy('player', en, 5, en.center(), false);
        const afterHit = vecs.length ? vecs[0].w : -1;
        R.advance(0.5);
        const afterDecay = vecs.length ? vecs[0].w : -1;
        return { n: vecs.length, afterHit, afterDecay, spawned: !!e };
      });
      check('A1 walker parts carry a flash buffer', r.n > 10, `parts=${r.n}`);
      check('A2 damage raises flash', r.afterHit > 0.5, `w=${r.afterHit}`);
      check('A3 flash decays to 0', r.afterDecay === 0, `w=${r.afterDecay}`);
      await ev(p, () => { const R = window.__rift; const en = R.game.enemies.active[0]; R.approach(en.id ?? 0); R.advance(1 / 60); R.game.damageEnemy('player', en, 5, en.center(), false); });
      await shot(p, 'polish-flash', { frames: 2 });
    }
  } catch (e) {
    check('suite ran without exception', false, String(e && e.stack || e).slice(0, 400));
  }
  const bad = errs.filter((e) => !/favicon/.test(e));
  check('no page errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  console.log(`\n${H.stats.passes} passed, ${H.stats.failures} failed`);
  await b.close();
  process.exit(H.stats.failures ? 1 : 0);
})();
