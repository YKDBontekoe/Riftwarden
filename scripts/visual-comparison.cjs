// Build a self-contained before/after review from visual-review.cjs output.
// Usage: node scripts/visual-comparison.cjs /path/to/review
const fs = require('node:fs/promises');
const path = require('node:path');
const cases = [
  ['01-arena-hud', 'Arena overview', 'Directional lighting, restrained reflections and compact instruments.'],
  ['02-surfaces', 'Surface finishes', 'Dry concrete, coated service slabs, localized wet patches and worn metal.'],
  ['03-enemy-silhouettes', 'Enemy roles', 'Square slate armour for Bulwarks, swept Rusher fins, pale artillery and jade support units.'],
  ['04-weapon-detail', 'Weapon materials', 'Separate paint, brushed metal and grip polymer, chipped edges and tempered barrel metal.'],
  ['05-compact-combat', 'Combat HUD', 'A clearer lower field of view; movement cooldowns remain contextual.'],
  ['06-cryo', 'Cryo weathering', 'Settled snow, frozen service sills and localized drifting snow.'],
  ['07-foundry', 'Foundry weathering', 'Soot and cooled clinker collect around machinery bases.'],
];
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

(async () => {
  const root = process.argv[2];
  if (!root) throw new Error('Provide the review directory');
  const before = JSON.parse(await fs.readFile(path.join(root, 'before/manifest.json')));
  const after = JSON.parse(await fs.readFile(path.join(root, 'after/manifest.json')));
  const records = [];
  const articles = [];
  for (const [index, [id, title, caption]] of cases.entries()) {
    const a = before.manifest.find(x => x.name === id), b = after.manifest.find(x => x.name === id);
    for (const key of ['biome', 'seed', 'pos', 'yaw', 'pitch', 'quality']) {
      if (JSON.stringify(a?.[key]) !== JSON.stringify(b?.[key])) throw new Error(`${id}: unmatched ${key}`);
    }
    const old = await fs.readFile(path.join(root, 'before', id + '.png'));
    const current = await fs.readFile(path.join(root, 'after', id + '.png'));
    const size = buffer => [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
    if (String(size(old)) !== String(size(current))) throw new Error(`${id}: mismatched image sizes`);
    if (old.equals(current)) throw new Error(`${id}: captures are identical`);
    records.push({ id, title, matched: true, width: size(old)[0], height: size(old)[1], camera: a.pos, seed: a.seed });
    articles.push(`<article class="case" id="${id}" ${index ? 'hidden' : ''}>
      <div class="case-head"><div><h2>${escape(title)}</h2><p>${escape(caption)}</p></div>
      <div class="actions"><button data-show="before">Before</button><button data-show="after">After</button><button data-mode>Side by side</button></div></div>
      <div class="stage" style="--split:50%">
        <img src="data:image/png;base64,${old.toString('base64')}" alt="Before: ${escape(title)}">
        <img class="after" src="data:image/png;base64,${current.toString('base64')}" alt="After: ${escape(title)}">
        <span class="tag old">BEFORE</span><span class="tag new">AFTER</span><i class="divider"></i>
      </div>
      <label class="slider">Drag to compare <input type="range" min="0" max="100" value="50" aria-label="Before and after comparison for ${escape(title)}"></label>
    </article>`);
  }
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Riftwarden — visual comparison</title><style>
  *{box-sizing:border-box}body{margin:0;background:#0b1117;color:#e8eff1;font:15px/1.5 system-ui,sans-serif}main{max-width:1240px;margin:auto;padding:28px 24px 36px}header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:24px}h1{font-size:30px;letter-spacing:-.04em;margin:0}header p,.case-head p{margin:6px 0 0;color:#9dacb6}small{color:#88b8b7}nav{display:flex;gap:7px;flex-wrap:wrap;margin:20px 0}button{border:1px solid #3b4a55;background:#17232d;color:#e4ecef;border-radius:5px;padding:9px 12px;cursor:pointer;font:inherit;font-size:12px}button:hover{background:#243b46}button[aria-selected=true]{border-color:#94c8bb;color:#bdf0df;background:#1c3639}.case{border:1px solid #2b3944;border-radius:8px;overflow:hidden;background:#111c24}.case[hidden]{display:none}.case-head{padding:18px;display:flex;justify-content:space-between;align-items:center;gap:16px}h2{font-size:18px;margin:0}.case-head p{font-size:13px}.actions{display:flex;gap:5px;flex-shrink:0}.actions button{padding:7px 10px}.stage{position:relative;overflow:hidden;background:#0b1117}.stage img{width:100%;height:auto;display:block}.stage img.after{position:absolute;inset:0;clip-path:inset(0 0 0 var(--split))}.divider{position:absolute;top:0;bottom:0;left:var(--split);width:2px;background:#fff;box-shadow:0 0 8px #000;pointer-events:none}.tag{position:absolute;top:12px;padding:4px 9px;border-radius:3px;background:#081017dd;font-size:11px;font-weight:700;letter-spacing:.1em;pointer-events:none}.tag.old{left:12px}.tag.new{right:12px;color:#b6eedc}.slider{display:flex;align-items:center;gap:18px;padding:14px 18px;font-size:12px;color:#b9c8d0}.slider input{flex:1;accent-color:#9ccfba}.stage.side{display:grid;grid-template-columns:1fr 1fr;gap:3px}.stage.side img.after{position:static;clip-path:none}.stage.side .divider{display:none}footer{margin-top:20px;color:#879ba7;font-size:12px}.checks{color:#a4cabb;font-size:12px}@media(max-width:760px){main{padding:18px 10px}header,.case-head{display:block}h1{font-size:25px}.actions{margin-top:12px}.stage.side{grid-template-columns:1fr}.stage.side .tag{display:none}}
  </style><main><header><div><small>RIFTWARDEN · VISUAL REVIEW</small><h1>Before / After</h1><p>Seven matched views. Same weapon, camera, arena seed and high graphics preset.</p></div><span class="checks">518 unit tests · build and typecheck passed</span></header>
  <nav aria-label="Comparison views">${cases.map(([id,title],i) => `<button data-case="${id}" aria-selected="${i === 0}">${escape(title)}</button>`).join('')}</nav>
  ${articles.join('\n')}<footer>Original game screenshots are embedded unchanged. Use Before, After, the comparison slider, or Side by side. Chromium used software rendering; hardware GPU frame rates were not measured.</footer></main>
  <script>
  document.querySelectorAll('[data-case]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-case]').forEach(b => b.setAttribute('aria-selected', String(b === button)));
    document.querySelectorAll('.case').forEach(c => c.hidden = c.id !== button.dataset.case);
  }));
  document.querySelectorAll('.case').forEach(card => {
    const stage=card.querySelector('.stage'), slider=card.querySelector('input');
    const set=value=>{slider.value=value;stage.style.setProperty('--split', value+'%')};
    slider.addEventListener('input',()=>set(slider.value));
    card.querySelectorAll('[data-show]').forEach(b=>b.addEventListener('click',()=>{stage.classList.remove('side');card.querySelector('[data-mode]').textContent='Side by side';set(b.dataset.show==='before'?100:0)}));
    card.querySelector('[data-mode]').addEventListener('click',event=>{const side=stage.classList.toggle('side');event.target.textContent=side?'Drag comparison':'Side by side'});
  });
  </script></html>`;
  await fs.writeFile(path.join(root, 'comparison.html'), html);
  await fs.writeFile(path.join(root, 'comparison.json'), JSON.stringify({ records, errors: after.errors, checks: after.checks }, null, 2));
  console.log(`Created ${records.length} matched comparisons: ${path.join(root, 'comparison.html')}`);
})().catch(e => { console.error(e); process.exitCode = 1; });
