// Regression for RGBD BRDF decode finishing after its first rendered scene is disposed.
const H = require('./lib/harness.cjs');
const { check, ev } = H;
(async () => {
  const { b, p, errs } = await H.launch({ skipUpgrades: true });
  try {
    const early = await ev(p, async () => {
      const { createEngine } = await import('/src/core/engine.ts');
      const Scene = window.__rift.home.scene.constructor;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const { engine } = await createEngine(canvas, 'webgl');
      const first = new Scene(engine);
      const lookup = first.environmentBRDFTexture;
      const owner = lookup?.getScene();
      first.dispose();
      let reused = !!lookup;
      for (let i = 0; i < 12; i++) {
        const scene = new Scene(engine);
        reused &&= scene.environmentBRDFTexture === lookup;
        scene.dispose();
      }
      window.__brdfCheck = { engine, lookup, owner };
      return { reused, attached: engine.scenes.length, retained: !!owner && !owner.isDisposed, retired: first.isDisposed };
    });
    check('rapid scene disposal keeps the pending lookup owner alive', early.retained && early.retired);
    check('successive scenes share one lookup without retaining rendered scenes', early.reused && early.attached === 0);
    await H.waitFor(p, () => window.__brdfCheck.lookup?.isReady(), null, 180000);
    check('the real GPU decode completes after the first scene was disposed', true);
    const disposed = await ev(p, () => {
      const { engine, owner, lookup } = window.__brdfCheck;
      const ready = lookup.isReady();
      engine.dispose();
      return ready && owner.isDisposed;
    });
    check('engine disposal releases the lookup owner', disposed);
    const before = await ev(p, () => {
      const R = window.__rift;
      return { lookup: !!R.home.scene.environmentBRDFTexture, scenes: R.flow.engine.scenes.length };
    });
    for (let i = 0; i < 2; i++) {
      await ev(p, () => window.__rift.flow.devDeploy(1));
      await H.waitFor(p, () => window.__rift.game && !window.__rift.state().busy);
      const arena = await ev(p, () => { const R = window.__rift; return R.game.scene.environmentBRDFTexture === R.flow.engine._virtualScenes[0].environmentBRDFTexture; });
      check(`deployment ${i + 1} uses the retained lookup`, arena);
      await ev(p, () => window.__rift.flow.abandonRun());
      await H.waitFor(p, () => window.__rift.home && !window.__rift.state().busy);
    }
    const after = await ev(p, () => ({ scenes: window.__rift.flow.engine.scenes.length, ownerScenes: window.__rift.flow.engine._virtualScenes.length }));
    check('deployment cycles keep one world and one lookup owner', before.lookup && before.scenes === 1 && after.scenes === 1 && after.ownerScenes === 1, JSON.stringify(after));
    check('no shader or browser errors during disposal and decoding', errs.length === 0, errs.join('\n'));
  } catch (e) { check('lifecycle suite completed', false, String(e.stack || e)); }
  finally { await b.close(); }
  console.log(`${H.stats.passes} passed, ${H.stats.failures} failed`);
  process.exitCode = H.stats.failures ? 1 : 0;
})();
