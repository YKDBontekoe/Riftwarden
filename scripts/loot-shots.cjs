// Loot presentation captures: arena drops (every category, several rarities) and the item terminals.
// Usage: node scripts/loot-shots.cjs <outDir> [A|T]   (needs `pnpm dev` on :5173)
const fs = require('node:fs');
const path = require('node:path');
const { launch, ev, waitFor } = require('./lib/harness.cjs');

const out = path.resolve(process.argv[2] || 'loot-shots');
const want = (k) => !process.argv[3] || process.argv[3].split(',').some((f) => k.startsWith(f));
fs.mkdirSync(out, { recursive: true });

const ROW = [
  ['weapon', 'plasma_repeater', 'common'], ['weapon', 'rail_lancer', 'uncommon'], ['weapon', 'beam_prism', 'rare'], ['weapon', 'swarm_hive', 'legendary'],
  ['armor', 'kinetic_plating', 'common'], ['shield', 'shield_matrix', 'uncommon'], ['reactor', 'reactor_core', 'rare'], ['processor', 'combat_processor', 'epic'],
  ['accessory', 'targeting_lens', 'epic'], ['module', 'amp_module', 'rare'], ['ability', 'frag_charge', 'uncommon'], ['ultimate', 'orbital_lance', 'exotic'],
];

async function shot(p, name) {
  await p.waitForTimeout(400);
  await ev(p, () => window.__rift.render(2));
  await p.waitForTimeout(400);
  await ev(p, () => window.__rift.render(1));
  await p.screenshot({ path: path.join(out, name + '.png'), timeout: 180000 });
  console.log('shot', name);
}

(async () => {
  const { b, p, errs } = await launch({ viewport: { width: 1280, height: 720 }, query: process.env.SHOT_QUERY ?? '&thumbs&stage' });
  if (want('A')) {
    await ev(p, () => window.__rift.flow.deploy(1));
    await waitFor(p, () => window.__rift.state().location === 'arena');
    await ev(p, (row) => {
      const R = window.__rift;
      R.flow.arenaMode = 'classic';
      row.forEach(([category, baseId, rarity], i) => {
        const x = (i % 6 - 2.5) * 2.4;
        const z = i < 6 ? -12 : -15.5;
        R.spawnLoot({ x, z, category, baseId, rarity, seed: 100 + i, level: 20 });
      });
      R.advance(1.2);
    }, ROW);
    const view = async (name, eye, target) => {
      await ev(p, ([e, t]) => {
        const g = window.__rift.game;
        window.__rift.advance(1 / 60);
        const cam = g.player.camera;
        cam.position.set(e[0], e[1], e[2]);
        cam.setTarget(new cam.position.constructor(t[0], t[1], t[2]));
      }, [eye, target]);
      await shot(p, name);
    };
    await view('arena-row', [0, 3.4, -4.5], [0, 0.6, -13.5]);
    await view('arena-close', [-3.6, 1.9, -9.6], [-3.6, 1.0, -12]);
    await view('arena-close2', [3.6, 1.9, -9.6], [3.6, 1.0, -12]);
    await ev(p, () => window.__rift.flow.abandonRun?.());
    await waitFor(p, () => window.__rift.state().location === 'home');
  }
  if (want('T')) {
    await ev(p, async (row) => {
      const R = window.__rift;
      if (R.state().location !== 'home') await R.flow.enterHq();
      await R.home.takeControl(false);
      const rar = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'exotic'];
      R.profile.mutate((d) => {
        d.resources.credits += 9000; d.resources.salvage += 9000; d.resources.components += 90; d.resources.shards = (d.resources.shards || 0) + 12;
        let i = 0;
        for (const [category, baseId] of row) for (const r of [rar[i % 6], rar[(i + 3) % 6]]) {
          const it = R.makeItem({ seed: 500 + i++, category, baseId, rarity: r, level: 18 });
          d.items.push(it);
          d.storage.uids.push(it.uid);
        }
        return true;
      });
    }, ROW);
    for (const id of ['storage', 'merchant', 'fabricate', 'salvage', 'loadout', 'workshop']) {
      await ev(p, (id) => {
        const h = window.__rift.home;
        h.setScreen('home');
        h.openTerminal(id);
      }, id);
      await p.waitForSelector('.terminal .term-title', { timeout: 20000 });
      await p.waitForTimeout(900);
      const card = await p.$('.terminal button.icard');
      if (card) await card.click().catch(() => {});
      // Let the thumbnail queue drain (one render per frame; SwiftShader is slow).
      await p.waitForFunction(() => !window.__thumbs || window.__thumbs.stats().queued === 0, null, { timeout: 120000 }).catch(() => {});
      await p.waitForTimeout(2500);
      await p.screenshot({ path: path.join(out, `term-${id}.png`), timeout: 120000 });
      console.log('shot', id);
    }
  }
  const bad = errs.filter((e) => !/Error compiling effect/.test(e));
  if (bad.length) console.log('ERRORS\n' + bad.slice(0, 8).join('\n'));
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
