const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await p.goto('http://localhost:5173/?test', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 90000 });
  const r = await p.evaluate(async () => { const R = window.__rift; await R.flow.enterHq(); await new Promise((r) => setTimeout(r, 1200)); R.home.openTerminal('workshop'); await new Promise((r) => setTimeout(r, 400));
    [...document.querySelectorAll('.term-tabs button')].find((b) => b.dataset.tab === 'affixes')?.click(); await new Promise((r) => setTimeout(r, 300));
    const l = document.querySelector('.eng-col .inv-list'); const c = l?.querySelector('.icard'); const cs = c && getComputedStyle(c); const rr = c?.getBoundingClientRect(); window.__dbg = { html: c?.outerHTML.slice(0, 400), rect: rr && [rr.x, rr.y, rr.width, rr.height], clip: cs?.clipPath, tf: cs?.transform, bg: cs?.backgroundImage.slice(0,120), z: cs?.zIndex, pos: cs?.position, cv: cs?.contentVisibility };
    return { dbg: window.__dbg, n: l?.children.length, lh: l?.getBoundingClientRect().height, lw: l?.getBoundingClientRect().width, ch: c?.getBoundingClientRect().height, disp: cs?.display, op: cs?.opacity, vis: cs?.visibility, ldisp: l && getComputedStyle(l).display, cols: l && getComputedStyle(l).gridTemplateColumns };
  });
  console.log(JSON.stringify(r)); await p.screenshot({ path: '/tmp/claude-0/-home-user-Riftwarden/215ebab8-c0fc-5af0-9896-1904c55d9cb6/scratchpad/shots/probe.png', clip: { x: 0, y: 80, width: 640, height: 400 } });
  await b.close();
})();
