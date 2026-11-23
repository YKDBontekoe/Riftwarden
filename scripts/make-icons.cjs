// Renders the installed-app icons (apps/client/public/icons) from the warden mark with headless Chromium.
// Run after changing the mark: node scripts/make-icons.cjs
const { chromium } = require('playwright');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'apps', 'client', 'public', 'icons');
const MARK = 'M0 36 15 4h9L9 36zm15 0L30 4h16l-4 8H35L24 36zm16 0 5-11 10 11z';
// pad = share of the icon around the 48x40 mark; maskable icons keep the mark inside the 80% safe circle.
const ICONS = [
  { file: 'icon-192.png', size: 192, pad: 0.2, radius: 0.18 },
  { file: 'icon-512.png', size: 512, pad: 0.2, radius: 0.18 },
  { file: 'maskable-512.png', size: 512, pad: 0.3, radius: 0 },
  { file: 'apple-touch-icon.png', size: 180, pad: 0.22, radius: 0 },
];

function svg({ size, pad, radius }) {
  const inner = size * (1 - pad * 2);
  const scale = inner / 48;
  const x = (size - 48 * scale) / 2;
  const y = (size - 40 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><radialGradient id="g" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#22302b"/><stop offset="1" stop-color="#0b1210"/></radialGradient></defs>
  <rect width="${size}" height="${size}" rx="${size * radius}" fill="url(#g)"/>
  <path transform="translate(${x} ${y}) scale(${scale})" fill="#ff9974" d="${MARK}"/>
</svg>`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const icon of ICONS) {
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(icon)}</body></html>`);
    await page.screenshot({ path: path.join(OUT, icon.file), omitBackground: true, clip: { x: 0, y: 0, width: icon.size, height: icon.size } });
    console.log('wrote', icon.file);
  }
  await browser.close();
})();
