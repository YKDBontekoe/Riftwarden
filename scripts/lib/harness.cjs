// Shared helpers for the browser acceptance suites (scripts/e2e-*.cjs).
// Needs `playwright` + Chromium (set NODE_PATH to the global node_modules if installed globally).
// Suites run in `?test` mode: fixed-step simulation, low graphics preset, no real pointer lock.
const { chromium } = require('playwright');
const os = require('os');

/** Screenshot directory ($E2E_OUT, default: OS temp dir). */
const OUT = process.env.E2E_OUT || os.tmpdir();
/** App under test. */
const URL = process.env.RIFT_URL || 'http://localhost:5173/';
const SETTINGS = JSON.stringify({ v: 1, data: { sensitivity: 1, fov: 90, quality: 'low', volume: 0 } });
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

// ---------------------------------------------------------------- reporting
/** Mutable counters: read `stats.failures` / `stats.passes` when printing the summary. */
const stats = { failures: 0, passes: 0 };
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
  if (ok) stats.passes++;
  else stats.failures++;
};
/** `want('A')` -> section filter from argv[2] (comma separated prefixes; empty = everything). */
const sectionFilter = (arg = process.argv[2] || '') => (k) => !arg || arg.split(',').some((f) => k.startsWith(f));

// ---------------------------------------------------------------- page helpers
const S = (p) => p.evaluate(() => window.__rift.state());
const ev = (p, fn, arg) => p.evaluate(fn, arg);
const waitFor = (p, fn, arg, t = 120000) => p.waitForFunction(fn, arg, { timeout: t, polling: 100 });

/** Collect page errors / console.error output into `errs` (or `page.errs` when no array is given). */
function collectErrors(p, errs = (p.errs = []), max = 300) {
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push('console.error ' + m.text().slice(0, max));
  });
  return errs;
}

/** Navigate to the app in ?test mode (or reload) and wait for the menu; stops the render loop unless `keepLoop`. */
async function boot(p, { reload = false, skipUpgrades = false, keepLoop = false } = {}) {
  if (reload) await p.reload();
  else await p.goto(URL + '?test');
  await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
  if (!keepLoop) await p.evaluate(() => window.__rift.stopLoop());
  if (skipUpgrades) await p.evaluate(() => { window.__rift.flow.skipUpgrades = true; });
}

/**
 * Launch Chromium (SwiftShader) with one context + page and boot the app.
 * opts: viewport, init (localStorage entries seeded once per tab), storageState, skipUpgrades, gc (expose gc for leak checks).
 */
async function launch({ viewport = { width: 1280, height: 720 }, init = null, storageState, skipUpgrades = false, gc = false } = {}) {
  const b = await chromium.launch({ args: gc ? [...GL_ARGS, '--js-flags=--expose-gc'] : GL_ARGS });
  const ctx = await b.newContext({ viewport, storageState });
  if (!storageState) {
    await ctx.addInitScript(([s, extra]) => {
      if (!localStorage.getItem('riftwarden.settings')) localStorage.setItem('riftwarden.settings', s);
      if (extra && !sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
      }
    }, [SETTINGS, init]);
  }
  if (skipUpgrades) await ctx.addInitScript(() => { window.__skipUpgrades = true; });
  const p = await ctx.newPage();
  const errs = collectErrors(p, []);
  await boot(p, { skipUpgrades });
  return { b, ctx, p, errs };
}

/** Render a couple of frames then screenshot into OUT. */
async function shot(p, name, { frames = 1, timeout = 120000 } = {}) {
  await p.evaluate((n) => window.__rift.render(n), frames);
  await p.screenshot({ path: `${OUT}/${name}.png`, timeout });
}

module.exports = { chromium, OUT, URL, SETTINGS, GL_ARGS, stats, check, sectionFilter, S, ev, waitFor, collectErrors, boot, launch, shot };
