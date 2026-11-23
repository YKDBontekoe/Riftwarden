// Matched visual review captures. Run before and after edits with the same REVIEW_PROFILE.
// E2E_OUT selects the destination; one browser renders the high preset sequentially.
const H = require('./lib/harness.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  await fs.mkdir(H.OUT, { recursive: true });
  const profilePath = process.env.REVIEW_PROFILE || path.join(H.OUT, '..', 'profile.json');
  const selected = process.env.REVIEW_ONLY ? new Set(process.env.REVIEW_ONLY.split(',')) : null;
  const previous = selected ? JSON.parse(await fs.readFile(path.join(H.OUT, 'manifest.json'))) : null;
  const saved = await fs.readFile(profilePath, 'utf8').catch(() => null);
  const { b, p, errs } = await H.launch({
    skipUpgrades: true, viewport: { width: 960, height: 600 },
    init: saved ? { 'riftwarden.save': saved } : null,
  });
  const manifest = [];
  try {
    if (!saved) await fs.writeFile(profilePath, await H.ev(p, () => localStorage.getItem('riftwarden.save')));
    await p.addStyleTag({ content: '*,*::before,*::after { animation:none!important;transition:none!important;caret-color:transparent!important; }' });
    const deploy = async (seed) => {
      console.log('building', seed ?? 'classic');
      await H.ev(p, async (seed) => {
        const R = window.__rift;
        if (R.game) {
          Object.assign(R.flow.settings, { quality: 'low', shadows: 'off', bloom: false });
          await R.flow.abandonRun();
        }
        let random = 481516;
        Math.random = () => { random = Math.imul(random, 1664525) + 1013904223 | 0; return (random >>> 0) / 4294967296; };
        Object.assign(R.flow.settings, { quality: 'high', shadows: 'high', renderScale: 1, bloom: true, volume: 0 });
        R.flow.engine.setHardwareScalingLevel(1);
        R.flow.arenaMode = seed === null ? 'classic' : 'procedural';
        R.flow.nextArenaSeed = seed;
        await R.flow.devDeploy(1);
        if (seed !== null && R.game?.layout.seed !== seed) throw new Error(`Expected arena seed ${seed}`);
        R.game.tut?.update(0, true);
        R.advance(0.25);
        R.game.input.clear();
        R.teleport(0, -18, 0.95); R.look(0, 0.04); R.advance(1 / 60);
      }, seed);
      await H.waitFor(p, () => window.__rift.game && !window.__rift.state().busy, null, 240000);
    };
    const shot = async (name) => {
      if (selected && !selected.has(name)) return;
      // Capturing the reflection probe changes PBR shader variants asynchronously.
      // Require several ready frames so a software renderer cannot capture the gap.
      let stable = 0;
      for (let frame = 0; frame < 30 && stable < 3; frame++) {
        const ready = await H.ev(p, () => {
          const R = window.__rift;
          R.render(1);
          return !!R.game.scene.environmentTexture && R.game.scene.isReady();
        });
        stable = ready ? stable + 1 : 0;
        await p.waitForTimeout(180);
      }
      if (stable < 3) throw new Error(`Scene did not settle for ${name}`);
      await H.shot(p, name, { frames: 1, timeout: 180000 });
      const state = await H.ev(p, () => {
        const g = window.__rift.game;
        return { biome: g.layout.biome || 'outpost', seed: g.layout.seed || null, pos: g.player.position.asArray(), yaw: g.player.yaw, pitch: g.player.pitch, quality: window.__rift.flow.settings.quality, meshes: g.scene.meshes.length, materials: g.scene.materials.length, textures: g.scene.textures.length };
      });
      if (process.env.REVIEW_ASSERT === '1' && ['06-cryo', '07-foundry'].includes(name)) {
        const safe = await H.ev(p, () => {
          const meshes = window.__rift.game.scene.meshes.filter(m => m.material?.name.startsWith('biomeDeposit:'));
          return meshes.length > 0 && meshes.every(m => !m.isPickable);
        });
        H.check(`${name} weathering cannot intercept shots or placement`, safe);
      }
      manifest.push({ name, ...state });
      console.log('captured', name);
    };
    if (!selected || [...selected].some(name => Number(name.slice(0, 2)) <= 5)) {
    await deploy(null);
    await shot('01-arena-hud');
    await H.ev(p, () => { const R = window.__rift; R.look(0.55, 0.38); R.advance(1 / 60); });
    await shot('02-surfaces');
    await H.ev(p, () => {
      const R = window.__rift, g = R.game;
      R.look(0, 0.02); R.advance(1 / 60);
      for (const [i, kind] of ['walker', 'rusher', 'bulwark', 'engineer', 'artillery'].entries()) {
        const e = R.dev.spawn(kind);
        e.pos.set(-7 + i * 3.5, 0, -4);
        e.root.position.copyFrom(e.pos); e.yaw = Math.PI; e.root.rotation.y = e.yaw;
        e.motion?.reset(e.pos, e.yaw);
        e.motion?.pose(e.pos, e.yaw, 1 / 60, false, 0, 0, 0);
      }
    });
    await shot('03-enemy-silhouettes');
    await H.ev(p, () => {
      const R = window.__rift, g = R.game;
      g.enemies.clear();
      R.look(-0.25, 0.07); R.advance(1 / 60);
      const vm = g.weapon.rig.root.parent;
      vm.scaling.setAll(1.05);
      vm.position.set(0.13, -0.21, 0.68);
      document.getElementById('ui').style.visibility = 'hidden';
    });
    await shot('04-weapon-detail');
    await H.ev(p, () => {
      document.getElementById('ui').style.visibility = '';
      const R = window.__rift;
      R.game.weapon.rig.root.parent.scaling.setAll(0.72);
      R.look(0, 0.04); R.game.waves.startNow(); R.advance(2);
    });
    await p.setViewportSize({ width: 960, height: 540 });
    await H.ev(p, () => window.__rift.flow.resize());
    await shot('05-compact-combat');
    if (process.env.REVIEW_ASSERT === '1') {
      const bounds = await p.evaluate(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, height: r.height }; };
        return { left: rect('.bottom-left'), center: rect('.bottom-center'), right: rect('.bottom-right'), ready: !!document.querySelector('.movement-row') };
      });
      H.check('compact combat instruments leave the lower view open', bounds.left.height < 95 && bounds.left.right + 8 < bounds.center.x && bounds.center.right + 8 < bounds.right.x, JSON.stringify(bounds));
      H.check('ready secondary movement controls leave the combat view', !bounds.ready);
      await H.ev(p, () => {
        const R = window.__rift, i = R.game.input;
        i.simulateKey('KeyR', true); R.advance(1 / 60); i.simulateKey('KeyR', false);
        R.game.player.kit.cancel(); R.advance(.1);
      });
      await p.waitForSelector('.mv-chip.cooling', { state: 'visible' });
      H.check('movement cooldowns return when the player needs them', true);
    }
    await p.setViewportSize({ width: 960, height: 600 });
    await H.ev(p, () => window.__rift.flow.resize());
    }
    for (const [seed, name] of [[4242, '06-cryo'], [6, '07-foundry']]) {
      if (selected && !selected.has(name)) continue;
      await deploy(seed);
      await H.ev(p, () => {
        const R = window.__rift, g = R.game;
        const blocks = g.layout.boxes.filter(b => ['block','platform','machine','container'].includes(b.kind));
        blocks.sort((a,b) => Math.hypot((a.min[0]+a.max[0])/2, (a.min[2]+a.max[2])/2) - Math.hypot((b.min[0]+b.max[0])/2, (b.min[2]+b.max[2])/2));
        for (const box of blocks) {
          const x = (box.min[0]+box.max[0])/2, z = (box.min[2]+box.max[2])/2;
          const px = x - (Math.sign(x) || 1) * ((box.max[0]-box.min[0])/2 + 7);
          if (g.layout.boxes.some(b => px > b.min[0]-.7 && px < b.max[0]+.7 && z > b.min[2]-.7 && z < b.max[2]+.7)) continue;
          R.teleport(px, z, 0.95); R.look(Math.atan2(x-px, 0), 0.12); R.advance(1 / 60);
          break;
        }
      });
      await shot(name);
    }
    const records = previous ? [...previous.manifest.filter(x => !selected.has(x.name)), ...manifest].sort((a,b) => a.name.localeCompare(b.name)) : manifest;
    await fs.writeFile(path.join(H.OUT, 'manifest.json'), JSON.stringify({ manifest: records, errors: errs, checks: previous?.checks || H.stats }, null, 2));
    if (errs.length || H.stats.failures) throw new Error(errs.join('\n') || 'Visual regression check failed');
    console.log('review complete:', manifest.length, 'captures; no browser errors');
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
