// PWA suite against the production build (pnpm build first): installability, offline start, update flow.
// Serves dist/ itself (so it can publish a "new build" of sw.js) on RIFT_PWA_PORT (default 4319).
// Usage: npm run build && node scripts/e2e-pwa.cjs
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./lib/harness.cjs');
const { check, stats } = H;

const DIST = path.join(__dirname, '..', 'dist');
const PORT = +(process.env.RIFT_PWA_PORT || 4319);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webp': 'image/webp', '.woff2': 'font/woff2' };
let swSuffix = '';
let offline = false;

const server = http.createServer((req, res) => {
  if (offline) {
    req.socket.destroy();
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  let body = fs.readFileSync(file);
  if (url.pathname.endsWith('/sw.js')) body = Buffer.from(body.toString() + swSuffix);
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(body);
});

(async () => {
  if (!fs.existsSync(path.join(DIST, 'sw.js'))) {
    console.error('dist/sw.js missing: run npm run build first');
    process.exit(1);
  }
  await new Promise((r) => server.listen(PORT, r));
  const b = await H.chromium.launch({ args: H.GL_ARGS });
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errs = H.collectErrors(p, []);
  const base = `http://localhost:${PORT}/`;
  try {
    await p.goto(base);
    const controlled = () => p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 120000 });
    await controlled();
    check('P1 the first install takes control at once', true);
    const man = await p.evaluate(async () => {
      const link = document.querySelector('link[rel=manifest]');
      const m = await (await fetch(link.href)).json();
      return { name: m.name, display: m.display, icons: m.icons.length, apple: !!document.querySelector('link[rel=apple-touch-icon]') };
    });
    check('P2 manifest is linked and complete', man.name === 'Riftwarden' && man.icons >= 3 && man.apple, JSON.stringify(man));
    await p.waitForSelector('.screen.menu', { timeout: 180000 });
    const cdp = await ctx.newCDPSession(p);
    const inst = await cdp.send('Page.getInstallabilityErrors');
    check('P2b Chromium reports no installability errors', inst.installabilityErrors.length === 0, JSON.stringify(inst.installabilityErrors));

    // Offline start: the cached shell and assets boot the game with the server gone.
    offline = true;
    await p.reload();
    await p.waitForSelector('.screen.menu', { timeout: 180000 });
    check('P3 the app starts offline from the cache', true);
    offline = false;

    // A new build: the worker installs but waits; the page shows the update toast.
    swSuffix = `\n// build ${Date.now()}\n`;
    await p.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await p.waitForSelector('[data-testid=pwa-update]', { timeout: 60000 });
    const waiting = await p.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    check('P4 an update waits for the player and shows the reload toast', waiting);
    const nav = p.waitForEvent('framenavigated', { timeout: 60000 });
    await p.locator('[data-testid=pwa-reload]').click();
    await nav;
    await p.waitForSelector('.screen.menu', { timeout: 180000 });
    const after = await p.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return { waiting: !!reg.waiting, toast: !!document.querySelector('[data-testid=pwa-update]') };
    });
    check('P5 RELOAD activates the new build and reloads into it', !after.waiting && !after.toast, JSON.stringify(after));
    const bad = errs.filter((e) => !/Error compiling effect|ERR_CONNECTION|net::|Failed to fetch|Failed to load resource/i.test(e));
    check('Z no runtime errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    console.error(e);
    stats.failures++;
  } finally {
    console.log(`\n${stats.passes} passed, ${stats.failures} failed`);
    await b.close();
    server.close();
    process.exit(stats.failures ? 1 : 0);
  }
})();
