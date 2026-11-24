// Contact sheet of every item base (+ currencies) rendered by the real thumbnail renderer.
// Usage: node scripts/item-sheet.cjs <out.png> [rarity] [id-regex]   (needs `pnpm dev` on :5173)
const { launch } = require('./lib/harness.cjs');
(async () => {
  const out = process.argv[2] || 'item-sheet.png';
  const rar = process.argv[3] || 'epic';
  const only = process.argv[4] || '';
  const { b, p, errs } = await launch({ viewport: { width: 1500, height: 1100 }, query: '&thumbs' });
  p.on('console', (m) => { if (/Thumbnail/.test(m.text())) console.log(m.text()); });
  const n = await p.evaluate(async ([rar, only]) => {
    const { BASES } = await import('/@id/@riftwarden/rules/loot/bases');
    const { buildItemModel, buildCurrencyModel } = await import('/@id/@riftwarden/game/loot/itemModels');
    const T = window.__thumbs;
    const grid = document.createElement('div');
    grid.id = 'sheet';
    grid.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0b1015;display:grid;grid-template-columns:repeat(10,1fr);gap:6px;padding:10px;font:11px monospace;color:#9bb';
    document.body.appendChild(grid);
    const jobs = [];
    const keep = (id) => !only || new RegExp(only).test(id);
    for (const base of BASES.filter((b) => keep(b.id))) {
      const look = { defId: base.id, category: base.category, rarity: rar };
      jobs.push([`sheet:${base.id}`, (s) => buildItemModel(s, look, { size: 1, name: 'sheet' }), base.category === 'weapon' ? 'side' : base.category === 'processor' || base.category === 'module' ? 'top' : 'front', base.id]);
    }
    for (const k of ['credits', 'salvage', 'components', 'shards', 'cores', 'xp', 'tactical'].filter(keep)) jobs.push([`sheet:c:${k}`, (s) => buildCurrencyModel(s, k, { size: 1 }), 'coin', k]);
    for (const [key, build, view, label] of jobs) {
      const cell = document.createElement('div');
      cell.style.cssText = 'background:radial-gradient(circle at 50% 55%,#24303a,#0f151b 70%);border:1px solid #2a3a44;text-align:center;padding:2px';
      cell.innerHTML = `<img data-k="${key}" style="width:128px;height:128px;display:block;margin:0 auto"><div>${label}</div>`;
      grid.appendChild(cell);
      T.request(key, build, view);
    }
    return jobs.length;
  }, [rar, only]);
  for (let last = -1; ;) {
    const st = await p.evaluate(() => window.__thumbs.stats());
    if (st.renders !== last) console.log('renders', st.renders, '/', n);
    last = st.renders;
    if (st.renders >= n) break;
    await p.waitForTimeout(5000);
  }
  await p.evaluate(() => { for (const img of document.querySelectorAll('#sheet img')) img.src = window.__thumbs.get(img.dataset.k) || ''; });
  await p.waitForTimeout(500);
  await p.screenshot({ path: out, fullPage: false });
  console.log('sheet', n, 'items', errs.filter((e) => !/compiling effect/.test(e)).slice(0, 5).join('\n'));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
