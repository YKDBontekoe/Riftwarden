// Shared helpers for the browser acceptance suites (scripts/e2e-*.cjs).
// Needs `playwright` + Chromium (set NODE_PATH to the global node_modules if installed globally).
// Suites run in `?test` mode: fixed-step simulation, low graphics preset, no real pointer lock.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const os = require('os');
const path = require('node:path');

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
function collectErrors(p, errs = (p.errs = []), max = Infinity) {
  p.on('pageerror', (e) => errs.push('PAGEERR ' + (e.stack || e.message)));
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push('console.error ' + m.text().slice(0, max));
  });
  return errs;
}

async function saveBrowserFailure(ctx, page, errors, name) {
  if (!name || !process.env.E2E_OUT) return;
  const files = await Promise.allSettled([
    ctx.tracing.stop({ path: path.join(OUT, `${name}-trace.zip`) }),
    page.screenshot({ path: path.join(OUT, `${name}-failure.png`), timeout: 5000 }),
    fs.writeFile(path.join(OUT, `${name}-errors.log`), errors.join('\n\n') + '\n'),
  ]);
  for (const file of files) if (file.status === 'rejected') console.warn('Could not save browser diagnostics:', file.reason);
}

/** Navigate to the app in ?test mode (or reload) and wait for the menu; stops the render loop unless `keepLoop`. */
async function boot(p, { reload = false, skipUpgrades = false, keepLoop = false, query = '' } = {}) {
  if (reload) await p.reload();
  else await p.goto(URL + '?test' + query);
  await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
  if (!keepLoop) await p.evaluate(() => window.__rift.stopLoop());
  if (skipUpgrades) await p.evaluate(() => { window.__rift.flow.skipUpgrades = true; });
}

/**
 * Launch Chromium (SwiftShader) with one context + page and boot the app.
 * opts: viewport, query (extra URL params, e.g. '&map'), init (localStorage entries seeded once per tab), storageState, skipUpgrades, gc (expose gc and precise performance.memory for leak checks), channel (Playwright browser channel).
 */
async function launch({ viewport = { width: 1280, height: 720 }, init = null, storageState, skipUpgrades = false, gc = false, query = '', diagnostics, channel } = {}) {
  const b = await chromium.launch({ channel, args: gc ? [...GL_ARGS, '--js-flags=--expose-gc', '--enable-precise-memory-info'] : GL_ARGS });
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
  if (diagnostics && process.env.E2E_OUT) await ctx.tracing.start({ screenshots: true, snapshots: true });
  try {
    await boot(p, { skipUpgrades, query });
  } catch (error) {
    await saveBrowserFailure(ctx, p, [...errs, error.stack || String(error)], diagnostics);
    await b.close();
    throw error;
  }
  return { b, ctx, p, errs };
}

/** Render a couple of frames then screenshot into OUT. */
async function shot(p, name, { frames = 1, timeout = 120000 } = {}) {
  await p.evaluate((n) => window.__rift.render(n), frames);
  await p.screenshot({ path: `${OUT}/${name}.png`, timeout });
}

module.exports = { chromium, OUT, URL, SETTINGS, GL_ARGS, stats, check, sectionFilter, S, ev, waitFor, collectErrors, saveBrowserFailure, boot, launch, shot };
