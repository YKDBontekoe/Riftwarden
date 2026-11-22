// Pixel diff of two ui-shots.cjs runs: prints the share of differing pixels per screen and writes a diff image
// (changed pixels in red) for every screen that differs.
//   node scripts/ui-diff.cjs <before-dir> <after-dir> [diff-dir]
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const [a, bDir, diffDir = path.join(bDir, 'diff')] = process.argv.slice(2);
  const names = fs.readdirSync(a).filter((f) => f.endsWith('.png') && fs.existsSync(path.join(bDir, f)));
  const missing = fs.readdirSync(a).filter((f) => f.endsWith('.png') && !fs.existsSync(path.join(bDir, f)));
  fs.mkdirSync(diffDir, { recursive: true });
  const br = await chromium.launch();
  const p = await br.newPage();
  let changed = 0;
  for (const n of names) {
    const r = await p.evaluate(async ([x, y]) => {
      const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
      const c = (img) => { const cv = new OffscreenCanvas(w, h); const g = cv.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
      const da = c(ia), db = c(ib);
      const out = new OffscreenCanvas(w, h); const g = out.getContext('2d'); const img = g.createImageData(w, h);
      let diff = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        const on = d > 24;
        if (on) diff++;
        img.data[i] = on ? 255 : da[i] * 0.3; img.data[i + 1] = on ? 0 : da[i + 1] * 0.3; img.data[i + 2] = on ? 0 : da[i + 2] * 0.3; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      const blob = await out.convertToBlob();
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = ''; for (const v of buf) bin += String.fromCharCode(v);
      return { diff, total: w * h, png: diff ? btoa(bin) : null };
    }, [`data:image/png;base64,${fs.readFileSync(path.join(a, n)).toString('base64')}`, `data:image/png;base64,${fs.readFileSync(path.join(bDir, n)).toString('base64')}`]);
    const share = (r.diff / r.total) * 100;
    if (r.diff) {
      changed++;
      fs.writeFileSync(path.join(diffDir, n), Buffer.from(r.png, 'base64'));
    }
    console.log(`${r.diff ? 'DIFF' : 'same'}  ${share.toFixed(3).padStart(7)}%  ${n}`);
  }
  for (const m of missing) console.log(`MISSING ${m}`);
  console.log(`\n${names.length - changed}/${names.length} identical${missing.length ? `, ${missing.length} missing` : ''}`);
  await br.close();
})();
