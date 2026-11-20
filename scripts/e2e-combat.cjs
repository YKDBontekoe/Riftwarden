// Combat kit browser suite (A two weapons) against a running dev server.
// Usage: npm run dev (port 5173), then: node scripts/e2e-combat.cjs [A]
const H = require('./lib/harness.cjs');
const { check, S, ev, stats } = H;
const want = H.sectionFilter();

const press = (p, code, frames = 1) =>
  ev(p, ([c, n]) => {
    const R = window.__rift;
    const i = R.flow.input;
    i.simulateKey(c, true);
    R.advance(n / 60);
    i.simulateKey(c, false);
    R.advance(1 / 60);
  }, [code, frames]);

async function deploy(p) {
  await ev(p, () => window.__rift.flow.deploy(1));
  await H.waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.state().busy && window.__rift.game);
  await ev(p, () => window.__rift.advance(1 / 60));
}

(async () => {
  const { b, p, errs } = await H.launch({ skipUpgrades: true });
  try {
    if (want('A')) {
      // A secondary railgun equipped at the HQ (storage -> SECONDARY WEAPON slot).
      await ev(p, () => {
        const R = window.__rift;
        const rail = R.makeItem({ seed: 77, rarity: 'rare', baseId: 'rail_lancer', level: 5 });
        R.profile.mutate((d) => { d.items.push(rail); d.loadout.weapon2 = rail.uid; return true; });
        window.__railUid = rail.uid;
      });
      await deploy(p);
      const a1 = await ev(p, () => {
        const g = window.__rift.game;
        window.__rift.advance(0.2);
        return { has: g.weaponSlots.hasSecondary, active: g.weaponSlots.active, family: g.weapon.def.family, holster: g.holsterHud() };
      });
      check('A1 deploys with the primary in hand and the secondary holstered', a1.has && a1.active === 'weapon' && a1.family === 'plasma', JSON.stringify(a1));

      // Overheat the primary, swap: the rail comes up cool and fires; the plasma vents while holstered.
      const a2 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        R.look(0, 0.05);
        const i = R.flow.input;
        i.simulateMouse(0, true);
        for (let k = 0; k < 600 && !g.weapon.overheated; k++) R.advance(1 / 60);
        i.simulateMouse(0, false);
        R.advance(1 / 60);
        return { over: g.weapon.overheated, heat: g.weapon.heat };
      });
      await press(p, 'KeyZ');
      const a3 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const before = g.weaponSlots.parkedHeat.heat;
        const shots = g.weapon.shotsFired;
        const i = R.flow.input;
        // Rail lancer charges on hold and fires on release.
        for (let n = 0; n < 3; n++) {
          i.simulateMouse(0, true);
          R.advance(1.2);
          i.simulateMouse(0, false);
          R.advance(0.4);
        }
        return { active: g.weaponSlots.active, family: g.weapon.def.family, heat: g.weapon.heat, shots: g.weapon.shotsFired - shots, parkedBefore: before, parkedAfter: g.weaponSlots.parkedHeat.heat, parkedOver: g.weaponSlots.parkedHeat.overheated };
      });
      check('A2 the primary overheats under sustained fire', a2.over, JSON.stringify(a2));
      check('A3 Z swaps to the secondary (rail in hand, cool) and it fires', a3.active === 'weapon2' && a3.family === 'rail' && a3.shots >= 2, JSON.stringify(a3));
      check('A4 the holstered primary vents while the secondary fires', a3.parkedBefore >= 90 && a3.parkedAfter < a3.parkedBefore - 30, JSON.stringify(a3));

      const a5 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const h = g.holsterHud();
        const primary = g.inventory.equipped('weapon');
        // Only the weapon in hand contributes affixes: the primary's item is out of the stat block now.
        const inHand = g.inventory.equippedItems(g.weaponSlots.inactive).map((x) => x.uid);
        return { holster: h, excluded: !inHand.includes(primary.uid), rail: inHand.includes(window.__railUid) };
      });
      check('A5 HUD shows the holstered primary; only the weapon in hand feeds stats', !!a5.holster && a5.holster.secondary === false && a5.excluded && a5.rail, JSON.stringify(a5));

      await press(p, 'Digit1');
      const a6 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const r = { active: g.weaponSlots.active, family: g.weapon.def.family };
        R.flow.input.simulateKey('KeyB', true);
        R.advance(1 / 60);
        R.flow.input.simulateKey('KeyB', false);
        R.advance(1 / 60);
        const blocked = !g.swapWeapon();
        g.input.simulateKey('Digit1', true);
        R.advance(1 / 60);
        g.input.simulateKey('Digit1', false);
        R.advance(1 / 60);
        return { ...r, blocked, still: g.weaponSlots.active };
      });
      check('A6 1 returns to the primary; swapping is blocked in build mode', a6.active === 'weapon' && a6.family === 'plasma' && a6.blocked && a6.still === 'weapon', JSON.stringify(a6));

      await ev(p, () => window.__rift.flow.abandonRun());
      await H.waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
      await H.boot(p, { reload: true, skipUpgrades: true });
      const a7 = await ev(p, () => {
        const d = window.__rift.profile.save;
        return { w2: d.loadout.weapon2, rail: window.__railUid ?? null, version: d.version };
      });
      check('A7 the secondary persists after the run and a reload (save v9)', a7.version >= 9 && !!a7.w2 && a7.w2.length > 0, JSON.stringify(a7));
    }
    if (want('B')) {
      // Shoot-off parts with the real weapon: hold a walker in front of the drone and aim at its cannon arm.
      await deploy(p);
      const b1 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const e = R.dev.spawn('walker');
        window.__w = e;
        const i = R.flow.input;
        // Face the reactor: open ground between the drop point and the plaza.
        { const pp = g.player.position; R.look(Math.atan2(-pp.x, -pp.z), 0); R.advance(1 / 60); }
        const pin = () => {
          const pp = g.player.position;
          e.pos.set(pp.x + Math.sin(g.player.yaw) * 9, 0, pp.z + Math.cos(g.player.yaw) * 9);
          e.root.position.copyFrom(e.pos);
          e.yaw = g.player.yaw + Math.PI;
          e.shotT = 99;
          e.chargeT = 0;
        };
        const aim = () => {
          const n = e.walker.cannon;
          e.root.computeWorldMatrix(true);
          n.computeWorldMatrix(true);
          const t = n.getAbsolutePosition();
          const eye = g.player.camera.position;
          const dx = t.x - eye.x, dy = t.y - eye.y, dz = t.z - eye.z;
          g.player.recoil = 0;
          g.player.recoilYaw = 0;
          R.look(Math.atan2(dx, dz), -Math.atan2(dy, Math.hypot(dx, dz)));
        };
        let frames = 0;
        i.simulateMouse(0, true);
        for (; frames < 900 && e.alive && !(e.limbsLost & 1); frames++) {
          pin();
          aim();
          R.advance(1 / 60);
          if (g.weapon.overheated) { i.simulateMouse(0, false); R.advance(1.5); i.simulateMouse(0, true); }
        }
        i.simulateMouse(0, false);
        R.advance(1 / 60);
        return { lost: e.limbsLost, alive: e.alive, cannonShown: e.walker.cannon.isEnabled(), frames, hp: Math.round(e.hp), max: e.maxHp };
      });
      const label = await p.$('.limb-label').then((h) => (h ? h.textContent() : null)).catch(() => null);
      check('B1 firing at a walker cannon knocks it off while the walker lives', (b1.lost & 1) === 1 && b1.alive && !b1.cannonShown, JSON.stringify(b1));
      check('B2 the HUD calls out the severed part', !!label && /CANNON/.test(label), String(label));
      const b3 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const e = window.__w;
        const pp = g.player.position;
        e.pos.set(pp.x + Math.sin(g.player.yaw) * 9, 0, pp.z + Math.cos(g.player.yaw) * 9);
        e.shotT = 0;
        let charged = 0;
        for (let k = 0; k < 240; k++) { R.advance(1 / 60); if (e.chargeT > 0) charged++; }
        return { charged, alive: e.alive };
      });
      check('B3 a disarmed walker never charges a shot at the drone', b3.charged === 0, JSON.stringify(b3));
      await H.shot(p, 'combat_disarmed_walker', { frames: 3 });
    }
    const bad = errs.filter((e) => !/Error compiling effect/.test(e));
    check('Z no page/console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    console.error(e);
    stats.failures++;
  } finally {
    await b.close();
    console.log(`${stats.passes} passed, ${stats.failures} failed`);
    process.exit(stats.failures ? 1 : 0);
  }
})();
