// UI screenshot harness for style refactors (the Tailwind migration): captures every menu sheet, HQ terminal (and its
// tabs) and the arena HUD / overlays with the 3D canvas hidden and CSS animations frozen, so two runs differ only where
// the styles differ. Compare two runs with scripts/ui-diff.cjs.
//   node scripts/ui-shots.cjs <out-dir> [profile.json]
// The first run saves the generated profile next to the shots (profile.json); pass it to later runs so item names,
// stock and records are identical.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const URL = process.env.RIFT_URL || 'http://localhost:5173/';
const FREEZE = `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
canvas { visibility: hidden !important; } html, body { background: #0b1117 !important; }`;

(async () => {
  const [out, profileFile] = process.argv.slice(2);
  if (!out) throw new Error('usage: ui-shots.cjs <out-dir> [profile.json]');
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const save = profileFile ? fs.readFileSync(profileFile, 'utf8') : null;
  await ctx.addInitScript(({ save }) => {
    localStorage.setItem('riftwarden.settings', JSON.stringify({ v: 1, data: { sensitivity: 1, fov: 90, quality: 'low', volume: 0 } }));
    if (save && !sessionStorage.getItem('shots-seeded')) {
      localStorage.setItem('riftwarden.save', save);
      sessionStorage.setItem('shots-seeded', '1');
    }
    // Fixed clock for dates shown in the UI.
    const fixed = 1795300000000;
    Date.now = () => fixed;
  }, { save });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const ev = (fn, arg) => p.evaluate(fn, arg);
  const settle = async () => {
    await p.addStyleTag({ content: FREEZE });
    await p.waitForTimeout(350);
  };
  // Cascade data for scripts/css-to-tailwind.mjs: for every element carrying a class that has its own `.class {}`
  // rule, the other rules that match the element and beat that rule today (specificity, then order) on a property of
  // the same family. Merged over every screen.
  const cascade = {};
  const collect = () => p.evaluate(() => {
    const spec = (sel) => {
      const s = sel.replace(/::?[\w-]+(\([^)]*\))?/g, (m) => (m.startsWith('::') ? '' : ' .p'));
      return [(s.match(/#[\w-]+/g) || []).length, (s.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length, (s.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length];
    };
    const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    const fam = (p) => (p.startsWith('--') ? p : p.replace(/^-\w+-/, '').split('-')[0]);
    const rules = [];
    const walk = (list) => { for (const r of list) { if (r.cssRules && !(r instanceof CSSStyleRule)) walk(r.cssRules); else if (r instanceof CSSStyleRule) rules.push(r); } };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch {} }
    const own = new Map();
    rules.forEach((r, i) => { const m = /^\.(-?[_a-zA-Z][\w-]*)$/.exec(r.selectorText.trim()); if (m) own.set(m[1], { r, i }); });
    const out = {};
    for (const el of document.querySelectorAll('#ui *')) {
      for (const c of el.classList) {
        const o = own.get(c);
        if (!o) continue;
        const mine = new Set([...o.r.style].map(fam));
        const rec = (out[c] ??= []);
        rules.forEach((r, i) => {
          if (r === o.r) return;
          for (const part of r.selectorText.split(',')) {
            if (/::(before|after)/.test(part)) continue;
            let hit = false;
            try { hit = el.matches(part); } catch {}
            if (!hit) continue;
            const wins = cmp(spec(part.trim()), [0, 1, 0]) > 0 || (cmp(spec(part.trim()), [0, 1, 0]) === 0 && i > o.i);
            if (wins && [...r.style].some((p) => mine.has(fam(p)))) rec.push(part.trim());
          }
        });
      }
    }
    return out;
  });
  const shots = [];
  const shot = async (name) => {
    await settle();
    for (const [c, why] of Object.entries(await collect())) {
      const set = (cascade[c] ??= new Set());
      for (const w of why) set.add(w);
    }
    await p.screenshot({ path: path.join(out, `${name}.png`) });
    shots.push(name);
  };
  // Every tab button inside the visible terminal / sheet, one shot each.
  const tabs = async (prefix, scope) => {
    const labels = await p.$$eval(`${scope} .tabs button, ${scope} [role="tablist"] button`, (bs) => bs.map((x) => x.textContent.trim()).filter(Boolean));
    for (const [i, label] of labels.entries()) {
      const btn = p.locator(`${scope} .tabs button, ${scope} [role="tablist"] button`).nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;
      await btn.click().catch(() => {});
      await shot(`${prefix}-tab${i}-${label.replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`);
    }
  };

  await p.goto(URL + '?test');
  await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
  if (!profileFile) fs.writeFileSync(path.join(out, 'profile.json'), await ev(() => localStorage.getItem('riftwarden.save')));
  await shot('menu');
  for (const s of ['briefing', 'co-op', 'account', 'settings', 'controls']) {
    await ev((h) => (location.hash = h), `#/${s}`);
    await p.waitForTimeout(300);
    await shot(`menu-${s}`);
    if (s === 'settings') await tabs('menu-settings', '.menu-sheet');
  }
  await ev(() => (location.hash = '#/'));
  await ev(() => window.__rift.previewLoading(4242, 1));
  await p.waitForTimeout(500);
  await shot('loading');

  await ev(async () => { await window.__rift.flow.enterHq(); });
  await p.waitForFunction(() => window.__rift.state().location === 'home' && !window.__rift.state().busy, null, { timeout: 300000 });
  await ev(() => window.__rift.stopLoop());
  await shot('hq-hud');
  for (const id of ['deploy', 'loadout', 'storage', 'workshop', 'command', 'merchant', 'modules', 'salvage', 'fabricate', 'architect', 'lattice']) {
    await ev((t) => window.__rift.home.openTerminal(t), id);
    await p.waitForTimeout(500);
    await shot(`term-${id}`);
    await tabs(`term-${id}`, '#ui');
    await ev(() => window.__rift.home.setScreen('home'));
    await p.waitForTimeout(200);
  }

  await ev(async () => { await window.__rift.flow.deploy(1); });
  await p.waitForFunction(() => window.__rift.state().location === 'arena' && !window.__rift.state().busy, null, { timeout: 300000 });
  await ev(() => { const R = window.__rift; R.stopLoop(); R.flow.skipUpgrades = true; R.advance(0.2); });
  await shot('arena-hud');
  for (const s of ['paused', 'inventory', 'towers']) {
    await ev((x) => window.__rift.game.setScreen(x), s);
    await p.waitForTimeout(300);
    await shot(`arena-${s}`);
    await ev(() => window.__rift.game.setScreen('playing'));
  }
  await ev(() => window.__rift.game.setBuildMode(true));
  await shot('arena-build');
  await ev(() => window.__rift.game.setBuildMode(false));
  fs.writeFileSync(path.join(out, 'cascade.json'), JSON.stringify(Object.fromEntries(Object.entries(cascade).map(([c, w]) => [c, [...w]])), null, 1));
  console.log(JSON.stringify({ shots: shots.length, errors: errs.slice(0, 3), classesSeen: Object.keys(cascade).length }));
  await b.close();
})();
