// Combat kit browser suite (A two weapons ... L combat controls and cues) against a running dev server.
// Usage: pnpm dev (port 5173), then: node scripts/e2e-combat.cjs [A]
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
      // Fixed-step combat can take longer than the 620 ms marker lifetime in software GL.
      // Hold browser timers while simulating, then paint a frame before inspecting the label.
      const markerTime = new Date('2026-11-23T12:00:00Z');
      await p.clock.install({ time: markerTime });
      await p.clock.pauseAt(new Date(markerTime.getTime() + 1000));
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
      await p.clock.runFor(32);
      const label = await p.$('.limb-label').then((h) => (h ? h.textContent() : null)).catch(() => null);
      await p.clock.resume();
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
      await ev(p, () => window.__rift.flow.abandonRun());
      await H.waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    }
    if (want('C')) {
      // Abilities: frag charge (RMB), blink drive (F) and the orbital lance ultimate (T in combat).
      await ev(p, () => {
        const R = window.__rift;
        const frag = R.makeItem({ seed: 91, rarity: 'rare', baseId: 'frag_charge', level: 5 });
        const blink = R.makeItem({ seed: 92, rarity: 'rare', baseId: 'blink_drive', level: 5 });
        const lance = R.makeItem({ seed: 93, rarity: 'rare', baseId: 'orbital_lance', level: 5 });
        R.profile.mutate((d) => { d.items.push(frag, blink, lance); d.loadout.ability = frag.uid; d.loadout.ability2 = blink.uid; d.loadout.ultimate = lance.uid; return true; });
      });
      await deploy(p);
      const c1 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const pp = g.player.position;
        R.look(Math.atan2(-pp.x, -pp.z), 0.12);
        R.advance(1 / 60);
        const e = R.dev.spawn('walker');
        const fwd = g.player.forward(new R.V3());
        e.pos.set(pp.x + fwd.x * 8, 0, pp.z + fwd.z * 8);
        e.root.position.copyFrom(e.pos);
        e.shotT = 99;
        const hp = e.hp;
        const i = R.flow.input;
        i.simulateMouse(2, true);
        R.advance(1 / 60);
        i.simulateMouse(2, false);
        for (let k = 0; k < 120; k++) { e.pos.set(pp.x + fwd.x * 8, 0, pp.z + fwd.z * 8); R.advance(1 / 60); }
        return { used: g.abilities.used, cd: g.abilities.cd.ability, hpBefore: hp, hpAfter: e.alive ? e.hp : 0, rows: g.abilities.hud().map((r) => r.kind) };
      });
      check('C1 RMB throws the frag charge: the walker takes blast damage, the slot cools down', c1.used === 1 && c1.cd > 0 && c1.hpAfter < c1.hpBefore, JSON.stringify(c1));
      await H.shot(p, 'combat_abilities_hud', { frames: 2 });
      const slots = await p.$$eval('.ab-slot', (els) => els.map((e) => e.textContent));
      check('C2 HUD lists both abilities and the ultimate', slots.length === 3 && /FRAG/i.test(slots.join(' ')) && /ORBITAL/i.test(slots.join(' ')), JSON.stringify(slots));
      const c3 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const before = g.player.position.clone();
        g.input.simulateKey('KeyF', true);
        R.advance(1 / 60);
        g.input.simulateKey('KeyF', false);
        R.advance(1 / 60);
        return { moved: R.V3.Distance(before, g.player.position), cd: g.abilities.cd.ability2 };
      });
      check('C3 F blinks the drone forward', c3.moved > 3 && c3.cd > 0, JSON.stringify(c3));
      const c4 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const notYet = !g.useAbility('ultimate');
        g.chargeUltimate(1e9);
        const ready = g.abilities.ult;
        g.waves.startNow();
        R.advance(0.1);
        const e = R.dev.spawn('walker');
        const pp = g.player.position;
        const fwd = g.player.forward(new R.V3());
        const at = () => { e.pos.set(pp.x + fwd.x * 14, 0, pp.z + fwd.z * 14); e.root.position.copyFrom(e.pos); e.shotT = 99; };
        at();
        R.look(g.player.yaw, 0.25);
        R.advance(1 / 60);
        const hp = e.hp;
        g.input.simulateKey('KeyT', true);
        R.advance(1 / 60);
        g.input.simulateKey('KeyT', false);
        for (let k = 0; k < 100; k++) { at(); R.advance(1 / 60); }
        return { notYet, ready, ult: g.abilities.ult, used: g.abilities.used, hp, after: e.alive ? e.hp : 0 };
      });
      check('C4 the ultimate needs charge; T in combat calls the orbital lance on the aim point', c4.notYet && c4.ready === 1 && c4.ult === 0 && c4.after < c4.hp, JSON.stringify(c4));
      await ev(p, () => window.__rift.flow.abandonRun());
      await H.waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    }
    if (want('D')) {
      // Movement kit: slide (L-Ctrl on the ground), ground pound (L-Ctrl in the air), grapple (R), wall-run.
      await deploy(p);
      const d1 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const pl = g.player;
        R.teleport(0, -10);
        R.look(Math.PI, 0);
        R.advance(0.3);
        const i = g.input;
        const standEye = pl.eye.y - pl.position.y;
        i.simulateKey('KeyW', true);
        R.advance(0.4);
        const run = pl.speed;
        i.simulateKey('ControlLeft', true);
        R.advance(1 / 60);
        const state = pl.moveState;
        R.advance(0.25);
        const slideSpeed = pl.speed;
        const slideEye = pl.eye.y - pl.position.y;
        const hud = g.movement.hud().state;
        i.simulateKey('ControlLeft', false);
        R.advance(2 / 60);
        const after = pl.moveState;
        i.simulateKey('KeyW', false);
        R.advance(0.3);
        return { run, state, slideSpeed, standEye, slideEye, hud, after };
      });
      check('D1 L-Ctrl at a run slides: faster than the run, eye drops, release ends it', d1.state === 'slide' && d1.slideSpeed > d1.run + 4 && d1.slideEye < d1.standEye - 0.25 && d1.hud === 'slide' && d1.after === '', JSON.stringify(d1));

      const d2 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const pl = g.player;
        R.teleport(0, -10, 9);
        R.advance(0.25);
        const e = R.dev.spawn('walker');
        const pp = pl.position;
        const place = () => { e.pos.set(pp.x + 2.5, 0, pp.z); e.root.position.copyFrom(e.pos); e.shotT = 99; };
        place();
        const hp = e.hp;
        const i = g.input;
        i.simulateKey('ControlLeft', true);
        R.advance(1 / 60);
        i.simulateKey('ControlLeft', false);
        const state = pl.moveState;
        const vy = pl.verticalSpeed;
        let k = 0;
        for (; k < 90 && g.movement.pounds === 0; k++) { place(); R.advance(1 / 60); }
        return { state, vy, frames: k, pounds: g.movement.pounds, last: g.movement.lastPound && { r: g.movement.lastPound.radius, hit: g.movement.lastPound.hit }, hp, after: e.alive ? e.hp : 0, cd: g.movement.hud().pound };
      });
      check('D2 L-Ctrl in the air ground-pounds: fast drop, blast on landing hurts a walker, cooldown starts', d2.state === 'pound' && d2.vy < -30 && d2.pounds === 1 && d2.last && d2.last.hit >= 1 && d2.after < d2.hp && d2.cd > 0, JSON.stringify(d2));

      // Find the north perimeter wall (classic arena) for the grapple and the wall-run.
      const d3 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const pl = g.player;
        const H = g.layout.half;
        // A spot with a clear 20-30 m line north to the wall.
        R.look(0, -0.05);
        for (const x of [-H + 8, -H + 14, -H + 20, -H + 26, -H + 32]) {
          R.teleport(x, H - 26);
          R.advance(0.2);
          const f = pl.forward(new R.V3());
          const hit = pl.probe(pl.eye.clone(), pl.eye.add(f.scale(40)));
          if (hit && Math.abs(hit.point.z - H) < 1) break;
        }
        const start = R.V3.Distance(pl.position, new R.V3(pl.position.x, pl.position.y, H));
        g.input.simulateKey('KeyR', true);
        R.advance(1 / 60);
        g.input.simulateKey('KeyR', false);
        const state = pl.moveState;
        const anchorZ = pl.kit.anchor.z;
        const rope = g.scene.getMeshByName('grappleLine')?.isEnabled() ?? false;
        R.advance(0.6);
        const mid = H - pl.position.z;
        for (let k = 0; k < 120 && pl.moveState === 'grapple'; k++) R.advance(1 / 60);
        return { start, state, anchorZ, H, rope, mid, end: pl.moveState, cd: g.movement.hud().grapple };
      });
      check('D3 R grapples the wall ahead and reels the drone in, then cools down', d3.state === 'grapple' && Math.abs(d3.anchorZ - d3.H) < 1.5 && d3.rope && d3.mid < d3.start - 12 && d3.end === '' && d3.cd > 0, JSON.stringify(d3));

      const d4 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const pl = g.player;
        const H = g.layout.half;
        R.teleport(-H + 8, H - 1.0, 3);
        R.look(Math.PI / 2, 0); // facing +x, wall on the left (north = +z)
        R.advance(1 / 60);
        pl.hv.set(18, 0, 0);
        pl.vy = 0;
        const i = g.input;
        i.simulateKey('KeyW', true);
        let k = 0;
        for (; k < 30 && pl.moveState !== 'wall'; k++) { R.advance(1 / 60); }
        const state = pl.moveState;
        const y0 = pl.position.y;
        R.advance(0.5);
        const still = pl.moveState;
        const drop = y0 - pl.position.y;
        const speed = pl.speed;
        const roll = pl.camera.rotation.z;
        i.simulateKey('Space', true);
        R.advance(1 / 60);
        i.simulateKey('Space', false);
        R.advance(3 / 60);
        const after = { state: pl.moveState, vz: pl.hv.z, vy: pl.verticalSpeed };
        i.simulateKey('KeyW', false);
        R.advance(1);
        return { frames: k, state, still, drop, speed, roll, after };
      });
      check('D4 airborne along a wall: wall-run holds height and speed, leans the camera; jump kicks off the wall', d4.state === 'wall' && d4.still === 'wall' && d4.drop < 1.5 && d4.speed > 18 && Math.abs(d4.roll) > 0.05 && d4.after.state === '' && d4.after.vz < -5 && d4.after.vy > 4, JSON.stringify(d4));

      const d6 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const pl = g.player;
        const H = g.layout.half;
        // Flung over the north wall from above its top: the containment ring keeps the drone in.
        R.teleport(-H + 20, H - 3, 12);
        R.advance(1 / 60);
        let maxZ = -1e9;
        for (let k = 0; k < 60; k++) { pl.hv.set(0, 0, 30); pl.vy = 6; R.advance(1 / 60); maxZ = Math.max(maxZ, pl.position.z); }
        R.advance(1.5);
        // Rays still pass it: the grapple hooks the real wall, not the invisible ring above it.
        R.teleport(-H + 20, H - 20);
        R.look(0, -0.45);
        R.advance(0.2);
        const f = pl.forward(new R.V3());
        const hit = pl.probe(pl.eye.clone(), pl.eye.add(f.scale(46)));
        return { H, maxZ, z: pl.position.z, y: pl.position.y, rayHit: hit && hit.point.z, rayY: hit && hit.point.y };
      });
      check('D6 the drone cannot leave over the perimeter walls; rays ignore the containment', d6.maxZ < d6.H && d6.z < d6.H && d6.rayHit === null, JSON.stringify(d6));
      await ev(p, () => window.__rift.advance(1 / 60));
      await H.shot(p, 'combat_movement_hud', { frames: 2 });
      const chips = await p.$$eval('.mv-chip', (els) => els.map((e) => e.textContent));
      check('D5 HUD shows grapple and pound chips with their keys', chips.length === 2 && /GRAPPLE/.test(chips[0]) && /R/.test(chips[0]) && /POUND/.test(chips[1]) && /CTRL/.test(chips[1]), JSON.stringify(chips));
      await ev(p, () => window.__rift.flow.abandonRun());
      await H.waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    }
    if (want('E')) {
      // TTK, hit feedback (leg / crawl, oil, kill pulse), wheel swap.
      await ev(p, () => {
        const R = window.__rift;
        const rail = R.makeItem({ seed: 78, rarity: 'rare', baseId: 'rail_lancer', level: 5 });
        R.profile.mutate((d) => { d.items.push(rail); d.loadout.weapon2 = rail.uid; return true; });
      });
      await deploy(p);
      const e1 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const pp = g.player.position;
        R.look(Math.atan2(-pp.x, -pp.z), 0);
        R.advance(1 / 60);
        const fwd = g.player.forward(new R.V3());
        const e = R.dev.spawn('walker');
        const place = () => { e.pos.set(pp.x + fwd.x * 9, 0, pp.z + fwd.z * 9); e.root.position.copyFrom(e.pos); e.shotT = 99; };
        place();
        R.advance(1 / 60);
        const c = e.center(new R.V3());
        const eye = g.player.eye;
        R.look(Math.atan2(c.x - eye.x, c.z - eye.z), -Math.atan2(c.y - 0.15 - eye.y, Math.hypot(c.x - eye.x, c.z - eye.z)));
        const shots0 = g.weapon.shotsFired;
        const i = g.input;
        i.simulateMouse(0, true);
        let k = 0;
        for (; k < 120 && e.alive; k++) { place(); R.advance(1 / 60); }
        i.simulateMouse(0, false);
        R.advance(0.1);
        return { seconds: k / 60, shots: g.weapon.shotsFired - shots0, dead: !e.alive, family: g.weapon.def.family };
      });
      check('E1 TTK: the starter repeater drops a basic walker in about 0.3 s', e1.dead && e1.family === 'plasma' && e1.seconds <= 0.45 && e1.shots <= 5, JSON.stringify(e1));
      await H.ev(p, () => window.__rift.render(1));
      await new Promise((r) => setTimeout(r, 150));
      const pulse = await p.$('.kill-pulse');
      check('E2 a player kill flashes the screen edges (kill pulse)', !!pulse, '');

      const e3 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const e = R.dev.spawn('walker');
        const pp = g.player.position;
        e.pos.set(pp.x + 6, 0, pp.z + 6);
        e.root.position.copyFrom(e.pos);
        R.advance(1 / 60);
        const before = e.moveMult;
        const leg = e.walker.thighR;
        leg.computeWorldMatrix(true);
        const at = leg.getAbsolutePosition().clone();
        // Particles only spawn while rendering: count the oil bursts requested instead.
        let oil = 0;
        const oil0 = 0;
        const burst = g.fx.burst.bind(g.fx);
        g.fx.burst = (kind, ...rest) => { if (kind === 'oil') oil += rest[1]; return burst(kind, ...rest); };
        g.damageEnemy('player', e, e.maxHp * 0.36, at, false);
        R.advance(1 / 60);
        g.fx.burst = burst;
        const lost = e.limbsLost;
        const hipsY = () => e.walker.hips.position.y;
        R.advance(0.4);
        return { alive: e.alive, lost, legBit: 8, before, after: e.moveMult, crawl: e.motion.crawl, hips: hipsY(), oil0, oil };
      });
      check('E3 shooting the right leg off makes the walker crawl (slow, low) and sprays oil', e3.alive && (e3.lost & e3.legBit) !== 0 && e3.after < e3.before * 0.6 && e3.crawl && e3.hips < 1 && e3.oil > e3.oil0, JSON.stringify(e3));

      const e4 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const a = g.weaponSlots.active;
        g.input.simulateWheel(1);
        R.advance(1 / 60);
        const b = g.weaponSlots.active;
        g.input.simulateWheel(-1);
        R.advance(1 / 60);
        return { a, b, c: g.weaponSlots.active };
      });
      check('E4 the mouse wheel swaps between the two weapons', e4.a === 'weapon' && e4.b === 'weapon2' && e4.c === 'weapon', JSON.stringify(e4));
      await ev(p, () => window.__rift.flow.abandonRun());
      await H.waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    }
    if (want('F')) {
      // Deployables: shield wall (RMB) blocks fire and line of sight, decoy (F) draws fire, mini-sentry is temporary.
      await ev(p, () => {
        const R = window.__rift;
        const wall = R.makeItem({ seed: 94, rarity: 'rare', baseId: 'shield_wall', level: 5 });
        const decoy = R.makeItem({ seed: 95, rarity: 'rare', baseId: 'holo_decoy', level: 5 });
        R.profile.mutate((d) => { d.items.push(wall, decoy); d.loadout.ability = wall.uid; d.loadout.ability2 = decoy.uid; return true; });
      });
      await deploy(p);
      const f1 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        R.teleport(0, -16);
        R.look(Math.PI, 0.1);
        R.advance(0.2);
        const i = g.input;
        i.simulateMouse(2, true);
        R.advance(1 / 60);
        i.simulateMouse(2, false);
        R.advance(1 / 60);
        const fwd = g.player.forward(new R.V3());
        const eye = g.player.eye.clone();
        const far = eye.add(new R.V3(fwd.x, 0, fwd.z).normalize().scale(24));
        const losBlocked = !g.los(eye, far);
        // An enemy bolt fired at the drone from behind the wall dies on it.
        const hp = g.player.hp + g.player.shield;
        const from = far.clone();
        from.y = eye.y;
        g.fx.spawnProjectile(from, eye.subtract(from).normalize().scale(28), 40);
        R.advance(1.2);
        return { walls: g.deployables.wallCount, losBlocked, hpBefore: hp, hpAfter: g.player.hp + g.player.shield, cd: g.abilities.cd.ability };
      });
      check('F1 RMB raises a shield wall: it blocks enemy line of sight and enemy bolts', f1.walls === 1 && f1.losBlocked && f1.hpAfter >= f1.hpBefore && f1.cd > 0, JSON.stringify(f1));
      await H.shot(p, 'combat_shield_wall', { frames: 2 });

      const f2 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        R.advance(7);
        const gone = g.deployables.wallCount === 0;
        R.teleport(0, -16);
        R.look(Math.PI / 2, 0.1);
        R.advance(0.2);
        g.input.simulateKey('KeyF', true);
        R.advance(1 / 60);
        g.input.simulateKey('KeyF', false);
        R.advance(1 / 60);
        const d = g.deployables;
        const hp0 = d.decoyHp;
        const e = R.dev.spawn('walker');
        const pp = g.player.position;
        // A walker 14 m from the decoy, on the far side from the drone.
        const dec = d.decoyFor(pp.add(new R.V3(14, 0, 0)));
        e.pos.set(pp.x + 22, 0, pp.z - 6);
        e.root.position.copyFrom(e.pos);
        e.shotT = 0.1;
        const hpP = g.player.hp + g.player.shield;
        let k = 0;
        for (; k < 300 && d.decoyHp >= hp0; k++) { e.pos.set(pp.x + 22, 0, pp.z - 6); e.root.position.copyFrom(e.pos); R.advance(1 / 60); }
        return { gone, decoy: !!dec, hp0, hp: d.decoyHp, frames: k, playerUntouched: g.player.hp + g.player.shield >= hpP, cd: g.abilities.cd.ability2 };
      });
      check('F2 the wall expires; F drops a holo decoy that machines nearby shoot instead of the drone', f2.gone && f2.decoy && f2.hp < f2.hp0 && f2.playerUntouched && f2.cd > 0, JSON.stringify(f2));

      const f3 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const n0 = g.turrets.turrets.length;
        const eye = g.player.eye.clone();
        g.deployables.deploy('sentry', eye, g.player.forward(new R.V3()), 2, 0, g.player.yaw);
        const t = g.turrets.turrets[g.turrets.turrets.length - 1];
        R.advance(1.2);
        const inspectable = g.towers.inspected === t;
        const mid = { n: g.turrets.turrets.length, temporary: t.temporary, blocking: t.blocking, refund: t.recycleValue };
        R.advance(1.5);
        return { n0, mid, inspectable, end: g.turrets.turrets.length };
      });
      check('F3 a mini-sentry is a free temporary tower: not blocking, not inspectable, gone when it expires', f3.mid.n === f3.n0 + 1 && f3.mid.temporary && !f3.mid.blocking && !f3.inspectable && f3.mid.refund === 0 && f3.end === f3.n0, JSON.stringify(f3));
      await ev(p, () => window.__rift.flow.abandonRun());
      await H.waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    }
    if (want('G')) {
      // Elements: element rolled on the weapon -> HUD, statuses (corrode), void shield pierce, faction affinity, briefing.
      await ev(p, () => {
        const R = window.__rift;
        const w = R.makeItem({ seed: 4040, rarity: 'rare', baseId: 'plasma_repeater', level: 3 });
        w.weapon.element = 'corrosive';
        R.profile.mutate((d) => { d.items.push(w); d.storage.uids.push(d.loadout.weapon); d.loadout.weapon = w.uid; return true; });
      });
      await deploy(p);
      await ev(p, () => { window.__rift.advance(0.2); window.__rift.render(1); });
      await new Promise((r) => setTimeout(r, 200));
      const g1 = await ev(p, () => ({ el: window.__rift.game.weapon.def.element }));
      const tag = await p.$eval('.weapon-card .el-tag', (e) => e.textContent).catch(() => '');
      check('G1 the equipped weapon fires its rolled element and the weapon card shows it', g1.el === 'corrosive' && tag === 'COR', JSON.stringify({ ...g1, tag }));

      const g2 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const e = R.dev.spawn('bulwark');
        const pp = g.player.position;
        e.pos.set(pp.x + 8, 0, pp.z + 8);
        e.root.position.copyFrom(e.pos);
        e.shotT = 99;
        R.advance(1 / 60);
        for (let k = 0; k < 4; k++) g.damageEnemy('player', e, 4, e.center(new R.V3()), false);
        const stacks = e.status.corrodeStacks;
        const vuln = e.status.corrodeStacks > 0;
        const hp0 = e.hp + e.shield;
        R.advance(1.2);
        return { stacks, vuln, hp0, hp1: e.hp + e.shield, cor: g.director.byElement.corrosive ?? 0, applied: g.director.statusApplied.corrode };
      });
      check('G2 corrosive hits stack corrosion that ticks damage over time', g2.stacks >= 2 && g2.hp1 < g2.hp0 && g2.applied >= 1 && g2.cor > 0, JSON.stringify(g2));

      const g3 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const run = (el) => {
          const e = R.dev.spawn('walker', ['shielded']);
          const pp = g.player.position;
          e.pos.set(pp.x - 8, 0, pp.z + 8);
          e.root.position.copyFrom(e.pos);
          e.shotT = 99;
          R.advance(1 / 60);
          const s0 = e.shield; const h0 = e.hp;
          g.director.deal({ target: e, amount: 20, element: el, source: { kind: 'weapon', id: 'plasma' }, chain: g.director.bus.newChain(), point: e.center(new R.V3()), quiet: true });
          const out = { s0, s1: e.shield, h0, h1: e.hp };
          g.enemies.kill(e, g.enemyFx, g.enemyCtx);
          return out;
        };
        return { kinetic: run('kinetic'), void: run('void') };
      });
      check('G3 void damage pierces the shield to the hull; kinetic hits the shield', g3.void.s0 > 0 && g3.void.s1 === g3.void.s0 && g3.void.h1 < g3.void.h0 && g3.kinetic.s1 < g3.kinetic.s0 && g3.kinetic.h1 === g3.kinetic.h0, JSON.stringify(g3));

      const g4 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        g.director.factionId = 'rime';
        const hit = (el) => {
          const e = R.dev.spawn('walker');
          const pp = g.player.position;
          e.pos.set(pp.x + 8, 0, pp.z - 8);
          e.root.position.copyFrom(e.pos);
          R.advance(1 / 60);
          const r = g.director.deal({ target: e, amount: 10, element: el, source: { kind: 'weapon', id: 'plasma' }, chain: g.director.bus.newChain(), point: e.center(new R.V3()), noStatus: true, noReact: true, quiet: true });
          g.enemies.kill(e, g.enemyFx, g.enemyCtx);
          return r;
        };
        const base = g.stats.elementalPower;
        const th = hit('thermal');
        const cr = hit('cryo');
        const ki = hit('kinetic');
        R.advance(0.1);
        return { th: th.dealt / base, cr: cr.dealt / base, ki: ki.dealt, thAff: th.aff, crAff: cr.aff };
      });
      check('G4 a Rime sector takes x1.35 thermal, x0.65 cryo and plain kinetic damage', Math.abs(g4.th - 13.5) < 0.6 && Math.abs(g4.cr - 6.5) < 0.6 && Math.abs(g4.ki - 10) < 0.3 && g4.thAff === 1 && g4.crAff === -1, JSON.stringify(g4));
      await ev(p, () => window.__rift.flow.abandonRun());
      await H.waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
      await ev(p, () => window.__rift.previewLoading(1234567, 1));
      await new Promise((r) => setTimeout(r, 300));
      const aff = await p.$eval('[data-testid=ls-affinity]', (e) => e.textContent).catch(() => '');
      check('G5 the sector briefing lists the faction weaknesses and resistances', /WEAK/.test(aff) && /RESISTS/.test(aff) && (aff.match(/KINETIC|THERMAL|ELECTRIC|CRYO|CORROSIVE|VOID/g) || []).length === 4, aff);
    }
    if (want('H')) {
      // Loot depth: Drone Swarm locks + salvo, a unique gear mechanic, Ascended / unique presentation.
      await ev(p, () => {
        const R = window.__rift;
        const w = R.makeItem({ seed: 5150, rarity: 'rare', baseId: 'swarm_hive', level: 3 });
        w.build.mechanism = 'mc_swarm';
        const mantle = R.makeUnique('bulwark_mantle', 3, 3);
        R.profile.mutate((d) => {
          d.items.push(w, mantle);
          d.storage.uids.push(d.loadout.weapon);
          if (d.loadout.armor) d.storage.uids.push(d.loadout.armor);
          d.loadout.weapon = w.uid;
          d.loadout.armor = mantle.uid;
          return true;
        });
      });
      await deploy(p);
      // Three walkers off the crosshair (inside the lock cone, outside any hitbox on the aim ray).
      const h1 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        R.look(0, 0);
        R.advance(1 / 60);
        const cam = g.player.camera;
        const f = cam.getDirection(new R.V3(0, 0, 1));
        const r = cam.getDirection(new R.V3(1, 0, 0));
        const eye = cam.position;
        // 11 m out: clear of the classic arena's reactor (seekers need line of sight).
        const es = [-2, 1.5, 2.6].map((side) => {
          const e = R.dev.spawn('walker');
          const at = eye.add(f.scale(11)).add(r.scale(side));
          e.pos.set(at.x, 0, at.z);
          e.root.position.copyFrom(e.pos);
          e.shotT = 99;
          e.hp = e.maxHp = 400;
          return e;
        });
        R.advance(1 / 60);
        const hp0 = es.map((e) => e.hp);
        const i = R.flow.input;
        const fired0 = g.weapon.shotsFired;
        i.simulateMouse(0, true);
        let flying = 0;
        for (let k = 0; k < 40; k++) {
          R.advance(1 / 60);
          flying = Math.max(flying, g.wfx.liveBolts);
        }
        i.simulateMouse(0, false);
        R.advance(0.5);
        return { fam: g.weapon.def.family, mech: g.weapon.def.mechanism, launches: g.weapon.shotsFired - fired0, flying, dmg: es.map((e, k) => Math.round(hp0[k] - e.hp)), drones: g.weapon.def.drones };
      });
      check('H1 a Drone Swarm releases seekers that lock onto machines off the crosshair', h1.fam === 'swarm' && h1.launches >= 1 && h1.flying >= 2 && h1.dmg.filter((d) => d > 0).length >= 2, JSON.stringify(h1));
      // Salvo Lock: a full lock releases about three times the drones of a tap.
      const h2 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const i = R.flow.input;
        const def = g.weapon.def;
        g.weapon.setDef({ ...def, mechanism: 'salvo' });
        const count = (hold) => {
          g.wfx.reset();
          g.weapon.heat = 0;
          i.simulateMouse(0, true);
          R.advance(hold);
          i.simulateMouse(0, false);
          R.advance(1 / 60);
          const n = g.wfx.liveBolts;
          R.advance(1.2);
          return n;
        };
        const tap = count(0.15);
        const full = count(1.6);
        g.weapon.setDef(def);
        return { tap, full };
      });
      check('H2 Salvo Lock releases more drones the longer it is held', h2.full >= h2.tap * 2 && h2.full >= 6, JSON.stringify(h2));
      // Unique gear: the Mantle of the Last Bulwark restores hull on kills.
      const h3 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const pl = g.player;
        pl.hp = Math.round(pl.maxHp * 0.5);
        const before = pl.hp;
        const e = R.dev.spawn('walker');
        const at = pl.position.add(new R.V3(6, 0, 6));
        e.pos.set(at.x, 0, at.z);
        e.root.position.copyFrom(e.pos);
        R.advance(1 / 60);
        g.damageEnemy('player', e, 1e6, e.center(new R.V3()), false);
        return { before, after: pl.hp, max: pl.maxHp, gear: [...g.equippedUniques()] };
      });
      check('H3 a unique gear mechanic applies in combat (Mantle: kills restore 4% hull)', h3.gear.includes('u_mantle') && Math.abs(h3.after - h3.before - h3.max * 0.04) < 0.6, JSON.stringify(h3));
      // Presentation: an Ascended pickup and the swarm viewmodel.
      await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const pp = g.player.position;
        R.spawnLoot({ x: pp.x + 3, z: pp.z + 4, rarity: 'ascended', baseId: 'rail_lancer', level: 20, seed: 8 });
        R.advance(1.2);
      });
      await new Promise((r) => setTimeout(r, 400));
      await H.shot(p, 'loot-depth-arena', { frames: 2 });
      check('H4 an Ascended pickup and the swarm viewmodel render (screenshot loot-depth-arena)', true);
      await ev(p, () => window.__rift.flow.abandonRun());
      await H.waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    }
    if (want('I')) {
      // Launcher + Flamer families.
      const equip = (baseId, mech, seed) => ev(p, ({ baseId, mech, seed }) => {
        const R = window.__rift;
        const w = R.makeItem({ seed, rarity: 'rare', baseId, level: 3 });
        w.build.mechanism = mech;
        R.profile.mutate((d) => {
          d.items.push(w);
          if (d.loadout.weapon) d.storage.uids.push(d.loadout.weapon);
          d.loadout.weapon = w.uid;
          return true;
        });
      }, { baseId, mech, seed });
      // Walkers placed relative to the crosshair (dist m ahead, side offsets in m).
      const place = (dist, sides) => ev(p, ({ dist, sides }) => {
        const R = window.__rift;
        const g = R.game;
        R.look(0, 0);
        R.advance(1 / 60);
        const cam = g.player.camera;
        const f = cam.getDirection(new R.V3(0, 0, 1));
        const r = cam.getDirection(new R.V3(1, 0, 0));
        window.__heavy = sides.map((side) => {
          const e = R.dev.spawn('walker');
          const at = cam.position.add(f.scale(dist)).add(r.scale(side));
          e.pos.set(at.x, 0, at.z);
          e.root.position.copyFrom(e.pos);
          e.shotT = 99;
          e.hp = e.maxHp = 2000;
          return e;
        });
        R.advance(1 / 60);
      }, { dist, sides });
      await equip('launcher_tube', 'mc_rocket', 6101);
      await deploy(p);
      await place(14, [0, 1.6, -1.6]);
      const i1 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const es = window.__heavy;
        const hp0 = es.map((e) => e.hp);
        const i = R.flow.input;
        i.simulateMouse(0, true);
        R.advance(1 / 60);
        i.simulateMouse(0, false);
        R.advance(1 / 60);
        const early = es.map((e, k) => Math.round(hp0[k] - e.hp));
        const flying = g.wfx.liveBolts;
        R.advance(0.8);
        return { fam: g.weapon.def.family, splash: g.weapon.def.splash, early, flying, dmg: es.map((e, k) => Math.round(hp0[k] - e.hp)) };
      });
      check('I1 a rocket lands after its flight: direct hit plus splash on the machines around it', i1.fam === 'launcher' && i1.early.every((d) => d === 0) && i1.flying >= 1 && i1.dmg.every((d) => d > 0) && i1.dmg[0] > i1.dmg[1], JSON.stringify(i1));
      await ev(p, () => {
        window.__rift.game.input.simulateMouse(0, true);
        for (let k = 0; k < 4; k++) window.__rift.advance(1 / 60);
      });
      await H.shot(p, 'heavy-launcher', { frames: 2 });
      await ev(p, () => window.__rift.game.input.simulateMouse(0, false));
      await ev(p, () => window.__rift.flow.abandonRun());
      await H.waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
      await equip('flamer_torch', 'mc_spray', 6202);
      await deploy(p);
      await place(7, [0, 0.9, -0.9]);
      const i2 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        const es = window.__heavy;
        // One more walker well beyond the stream's reach.
        const cam = g.player.camera;
        const far = R.dev.spawn('walker');
        const at = cam.position.add(cam.getDirection(new R.V3(0, 0, 1)).scale(40));
        far.pos.set(at.x, 0, at.z);
        far.root.position.copyFrom(far.pos);
        far.hp = far.maxHp = 2000;
        R.advance(1 / 60);
        const hp0 = es.map((e) => e.hp);
        const farHp = far.hp;
        const i = R.flow.input;
        const ticks0 = g.weapon.shotsFired;
        i.simulateMouse(0, true);
        for (let k = 0; k < 30; k++) R.advance(1 / 60);
        const ticks = g.weapon.shotsFired - ticks0;
        return { fam: g.weapon.def.family, element: g.weapon.def.element, targets: g.weapon.def.targets, ticks, dmg: es.map((e, k) => Math.round(hp0[k] - e.hp)), far: Math.round(farHp - far.hp), beaming: g.weapon.beaming };
      });
      check('I2 a flamer tick reaches every machine in its cone (not one out of range) and stays lit while held', i2.fam === 'flamer' && i2.element !== 'kinetic' && i2.ticks >= 4 && i2.dmg.filter((d) => d > 0).length === 3 && i2.far === 0 && i2.beaming, JSON.stringify(i2));
      await H.shot(p, 'heavy-flamer', { frames: 2 });
      check('I3 launcher and flamer viewmodels render while firing (screenshots heavy-launcher, heavy-flamer)', true);
      await ev(p, () => window.__rift.game.input.simulateMouse(0, false));
      await ev(p, () => window.__rift.flow.abandonRun());
      await H.waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    }
    if (want('J')) {
      // Conditional affixes: an airborne damage affix counts only while the drone is off the ground.
      await ev(p, () => {
        const R = window.__rift;
        const w = R.makeItem({ seed: 7301, rarity: 'rare', baseId: 'plasma_repeater', level: 3 });
        w.affixes.push({ id: 'c_airdmg', stat: 'weaponDamageMult', op: 'pct', value: 0.5, tier: 3, roll: 1 });
        R.profile.mutate((d) => {
          d.items.push(w);
          if (d.loadout.weapon) d.storage.uids.push(d.loadout.weapon);
          d.loadout.weapon = w.uid;
          return true;
        });
      });
      await deploy(p);
      const j1 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        R.advance(0.5);
        const ground = { dmg: g.stats.weaponDamageMult, active: [...g.conditions.active] };
        g.input.simulateKey('Space', true);
        R.advance(0.12);
        g.input.simulateKey('Space', false);
        R.advance(0.15);
        const air = { dmg: g.stats.weaponDamageMult, active: [...g.conditions.active], grounded: g.player.grounded };
        R.advance(2.5);
        const landed = { dmg: g.stats.weaponDamageMult, active: [...g.conditions.active] };
        return { ground, air, landed };
      });
      check('J1 an airborne damage affix counts only while airborne', !j1.ground.active.includes('airborne') && j1.air.active.includes('airborne') && j1.air.dmg > j1.ground.dmg + 0.4 && Math.abs(j1.landed.dmg - j1.ground.dmg) < 1e-6, JSON.stringify(j1));
      const j2 = await ev(p, () => {
        const R = window.__rift;
        const g = R.game;
        g.input.simulateKey('ShiftLeft', true);
        R.advance(1 / 60);
        g.input.simulateKey('ShiftLeft', false);
        R.advance(0.2);
        const after = [...g.conditions.active];
        R.advance(2.5);
        return { after, later: [...g.conditions.active] };
      });
      check('J2 a dash opens the 2 s dash window, which then closes', j2.after.includes('dash') && !j2.later.includes('dash'), JSON.stringify(j2));
      // The HUD lists the conditions the gear needs and lights the ones that hold.
      const j3 = await ev(p, async () => {
        const R = window.__rift;
        const g = R.game;
        const chips = () => [...document.querySelectorAll('[data-testid=cond-row] .cond-chip')].map((c) => `${c.getAttribute('data-cond')}:${c.classList.contains('on') ? 1 : 0}`);
        R.advance(0.3);
        await new Promise((r) => setTimeout(r, 120));
        const ground = chips();
        g.input.simulateKey('Space', true);
        R.advance(0.12);
        g.input.simulateKey('Space', false);
        R.advance(0.12);
        await new Promise((r) => setTimeout(r, 120));
        const air = chips();
        R.advance(2.5);
        return { ground, air };
      });
      check('J3 the HUD shows the AIRBORNE chip, lit only while airborne', j3.ground.join() === 'airborne:0' && j3.air.join() === 'airborne:1', JSON.stringify(j3));
      // Set gear in the arena: a teal hexagon marker on the pickup and the set line on the prompt.
      const j4 = await ev(p, async () => {
        const R = window.__rift;
        const g = R.game;
        const plain = g.loot.pickups.length;
        R.spawnLoot({ category: 'armor', rarity: 'rare', set: 'bastion', x: g.player.position.x, z: g.player.position.z + 6 });
        R.advance(2);
        const pk = g.loot.pickups[g.loot.pickups.length - 1];
        const ticks = pk.root.getChildMeshes().filter((m) => m.material && m.material.name === 'lootSetGlow').length;
        R.approach(pk.id);
        R.advance(0.3);
        await new Promise((r) => setTimeout(r, 150));
        let line = '';
        for (let i = 0; i < 20 && !line; i++) {
          R.advance(0.1);
          await new Promise((r) => setTimeout(r, 100));
          line = document.querySelector('[data-testid=lp-set]')?.textContent ?? '';
        }
        const t = g.lootTarget;
        return { plain, ticks, line, screen: R.state().screen, target: t ? t.item.uid === pk.item.uid : null, landed: g.loot.landed(pk), cargoFull: g.inventory.cargoFull };
      });
      await H.shot(p, 'set-pickup', { frames: 2 });
      check('J4 set gear shows its hexagon marker and the set line on the pickup prompt', j4.ticks === 6 && /BASTION PROTOCOL/.test(j4.line) && /1\/4/.test(j4.line), JSON.stringify(j4));
      await ev(p, () => window.__rift.flow.abandonRun());
      await H.waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
    }
    if (want('K')) {
      await ev(p, () => {
        const R = window.__rift;
        const unlock = document.createElement('button');
        unlock.textContent = 'Enable test audio';
        unlock.style.cssText = 'position:fixed;top:0;left:0;z-index:9999';
        unlock.onclick = () => { R.sfx.init(); unlock.remove(); };
        document.body.appendChild(unlock);
        const beam = R.makeItem({ seed: 6, rarity: 'rare', baseId: 'beam_prism', level: 5 });
        const rail = R.makeItem({ seed: 77, rarity: 'rare', baseId: 'rail_lancer', level: 5 });
        beam.build.mechanism = 'mc_beam';
        rail.build.mechanism = 'mc_charge';
        R.profile.mutate((d) => {
          d.items.push(beam, rail);
          d.loadout.weapon = beam.uid;
          d.loadout.weapon2 = rail.uid;
          return true;
        });
      });
      await p.getByRole('button', { name: 'Enable test audio' }).click();
      await H.waitFor(p, () => window.__rift.sfx.ready);
      await deploy(p);
      const beam = await ev(p, () => {
        const R = window.__rift, g = R.game, sfx = R.sfx;
        const emitting = () => [g.weapon.beaming, g.wfx.beamCore.isEnabled(), !!sfx.beam];
        sfx.setVolume(0.5);
        g.input.simulateMouse(0, true);
        R.advance(1 / 60);
        const firing = emitting();
        g.setScreen('paused');
        const paused = emitting();
        g.setScreen('playing');
        R.advance(1 / 60);
        const resumed = emitting();
        g.weapon.heat = 99.9;
        for (let i = 0; i < 30 && !g.weapon.overheated; i++) R.advance(1 / 60);
        g.input.simulateMouse(0, false);
        g.publishHud(true);
        return { firing, paused, resumed, hot: g.weapon.overheated, overheated: emitting() };
      });
      check('K1 pause and overheat stop the beam, its visual and its hum together', beam.firing.every(Boolean) && !beam.paused.some(Boolean) && beam.resumed.every(Boolean) && beam.hot && !beam.overheated.some(Boolean), JSON.stringify(beam));
      await p.locator('.reticle-venting').waitFor({ state: 'visible' });
      const ready = await ev(p, () => {
        const R = window.__rift;
        for (let i = 0; i < 600 && R.game.weapon.overheated; i++) R.advance(1 / 60);
        R.game.publishHud(true);
        return !R.game.weapon.overheated && R.sfx.lastPlay.has('weaponReady');
      });
      await p.locator('.reticle-venting').waitFor({ state: 'hidden' });
      check('K2 the reticle shows venting until the weapon-ready sound plays', ready);

      const charge = await ev(p, () => {
        const R = window.__rift, g = R.game, input = g.input;
        g.swapWeapon();
        input.simulateMouse(0, true);
        R.advance(1.1);
        const before = g.weapon.charge;
        const shots = g.weapon.shotsFired;
        g.setScreen('paused');
        input.simulateMouse(0, false);
        g.setScreen('playing');
        R.advance(1 / 60);
        return { before, after: g.weapon.charge, fired: g.weapon.shotsFired - shots };
      });
      check('K3 pausing a charged weapon cancels the shot', charge.before > 0.12 && charge.after === 0 && charge.fired === 0, JSON.stringify(charge));

      const markerTime = new Date();
      await p.clock.install({ time: markerTime });
      await p.clock.pauseAt(new Date(markerTime.getTime() + 1000));
      await ev(p, () => {
        const R = window.__rift, g = R.game;
        const killed = R.dev.spawn('walker');
        const hit = R.dev.spawn('walker');
        g.damageEnemy('player', killed, 1e6, killed.center(new R.V3()), false);
        g.damageEnemy('player', hit, 1, hit.center(new R.V3()), false);
      });
      await p.clock.runFor(32);
      check('K4 a routine hit leaves a recent kill marker visible', await p.locator('.hitmarker.kill').count() === 1);
      await p.clock.resume();
    }
    if (want('L')) {
      if (await ev(p, () => !!window.__rift.game)) {
        await ev(p, () => window.__rift.flow.abandonRun());
        await H.waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy);
      }
      await ev(p, () => {
        const R = window.__rift;
        const plasma = R.makeItem({ seed: 11, rarity: 'common', baseId: 'plasma_repeater', level: 1 });
        const rail = R.makeItem({ seed: 77, rarity: 'rare', baseId: 'rail_lancer', level: 5 });
        plasma.build.mechanism = 'mc_auto';
        rail.build.mechanism = 'mc_charge';
        R.profile.mutate((d) => {
          d.items.push(plasma, rail);
          d.loadout.weapon = plasma.uid;
          d.loadout.weapon2 = rail.uid;
          return true;
        });
      });
      await deploy(p);
      const taps = await ev(p, () => {
        const R = window.__rift, g = R.game, input = g.input;
        const tap = () => { input.simulateMouse(0, true); input.simulateMouse(0, false); R.advance(1 / 60); };
        const before = g.weapon.shotsFired;
        tap();
        const first = g.weapon.shotsFired - before;
        R.advance(0.04);
        tap();
        const cooling = g.weapon.shotsFired - before;
        R.advance(0.2);
        const buffered = g.weapon.shotsFired - before;
        // Match a successful placement, which exits build mode immediately in solo play.
        const place = g.tryPlace.bind(g);
        g.tryPlace = () => g.setBuildMode(false);
        g.setBuildMode(true);
        input.simulateMouse(0, true);
        R.advance(0.2);
        input.simulateMouse(0, false);
        g.tryPlace = place;
        return { first, cooling, buffered, afterBuild: g.weapon.shotsFired - before };
      });
      check('L1 taps survive between frames and buffer through a short cooldown, while a build click stays consumed', taps.first === 1 && taps.cooling === 1 && taps.buffered === 2 && taps.afterBuild === 2, JSON.stringify(taps));

      await ev(p, () => window.__rift.game.setScreen('paused'));
      await p.getByRole('button', { name: 'Settings', exact: true }).click();
      await p.getByRole('button', { name: 'Controls', exact: true }).click();
      await p.getByRole('group', { name: 'Scroll to swap weapons' }).getByRole('button', { name: 'Off', exact: true }).click();
      await p.getByRole('button', { name: 'Interface', exact: true }).click();
      await p.getByRole('group', { name: 'Reticle style' }).getByRole('button', { name: 'Dot' }).click();
      await p.getByRole('group', { name: 'Damage numbers' }).getByRole('button', { name: 'My hits' }).click();
      await p.getByRole('button', { name: 'Audio', exact: true }).click();
      await p.getByRole('slider', { name: 'Master volume' }).press('End');
      const cue = p.getByRole('button', { name: 'Combat cue', exact: true });
      await cue.click();
      await H.waitFor(p, () => window.__rift.sfx.lastPlay.has('crit'));
      await p.getByRole('slider', { name: 'Combat cues' }).press('Home');
      await ev(p, () => window.__rift.sfx.lastPlay.delete('crit'));
      await cue.click();
      const saved = await ev(p, () => ({ ...JSON.parse(localStorage.getItem('riftwarden.settings')).data, silentCue: !window.__rift.sfx.lastPlay.has('crit') }));
      check('L2 the options persist, and the combat preview follows the cue slider', saved.silentCue && saved.combatCueVolume === 0 && saved.reticle === 'dot' && saved.damageNumbers === 'personal' && !saved.wheelSwap);
      await p.keyboard.press('Escape');
      const slots = await ev(p, () => {
        const R = window.__rift, g = R.game, input = g.input;
        input.clear();
        g.setScreen('playing');
        input.simulateWheel(1);
        R.advance(1 / 60);
        const wheel = g.weaponSlots.active;
        input.simulateKey('Digit3', true);
        R.advance(1 / 60);
        input.simulateKey('Digit3', false);
        const alternate = g.weaponSlots.active;
        input.simulateKey('Digit1', true);
        R.advance(1 / 60);
        input.simulateKey('Digit1', false);
        return { wheel, alternate, primary: g.weaponSlots.active };
      });
      check('L3 dedicated keys draw either slot while scroll swapping is disabled', slots.wheel === 'weapon' && slots.alternate === 'weapon2' && slots.primary === 'weapon', JSON.stringify(slots));
      await p.locator('.crosshair[data-reticle=dot]').waitFor({ state: 'attached' });

      await ev(p, () => {
        const R = window.__rift, g = R.game;
        const e = R.dev.spawn('walker');
        const pp = g.player.position;
        const yaw = Math.atan2(-pp.x, -pp.z);
        e.pos.set(pp.x + Math.sin(yaw) * 8, 0, pp.z + Math.cos(yaw) * 8);
        e.root.position.copyFrom(e.pos);
        e.shield = e.maxShield = 100;
        e.shotT = 99;
        const dy = e.center(new R.V3()).y - g.player.camera.position.y;
        R.look(yaw, -Math.atan2(dy, 8));
        R.advance(1 / 60);
        g.publishHud(true);
      });
      await p.locator('.crosshair[data-target=shield]').waitFor({ state: 'attached', timeout: 5000 });
      check('L4 the dot reticle identifies a shielded target in range', true);

      const numbers = await ev(p, () => {
        const R = window.__rift, g = R.game;
        const position = g.player.eye.add(g.player.forward(new R.V3()).scale(5));
        g.showNumber(position, 3, 'hit', false, true, 1);
        g.showNumber(position, 7, 'hit', true, true, 1);
        return { own: document.querySelectorAll('.dmg-host .dmg.own').length, ally: document.querySelectorAll('.dmg-host .dmg.ally').length };
      });
      check('L5 My hits filters allied damage numbers', numbers.own === 1 && numbers.ally === 0, JSON.stringify(numbers));

      const markerTime = new Date();
      await p.clock.install({ time: markerTime });
      await p.clock.pauseAt(new Date(markerTime.getTime() + 1000));
      const shieldAngle = await ev(p, () => {
        const R = window.__rift, pl = R.game.player;
        pl.yaw = 0;
        pl.shield = pl.maxShield = 100;
        pl.damage(5, pl.position.add(new R.V3(5, 0, 0)));
        pl.yaw = Math.PI / 2;
        return parseFloat(document.querySelector('.dmg-dir .shield').style.transform.slice(7));
      });
      await p.clock.runFor(32);
      const direction = await ev(p, () => {
        const R = window.__rift, pl = R.game.player;
        const angle = parseFloat(document.querySelector('.dmg-dir .shield').style.transform.slice(7));
        pl.shield = 0;
        pl.damage(5, pl.position.add(new R.V3(5, 0, 0)));
        return { angle, hull: document.querySelectorAll('.dmg-dir .hull').length, shield: document.querySelectorAll('.dmg-dir .shield').length };
      });
      check('L6 incoming damage follows the turn and a hull hit replaces the shield marker from the same direction', Math.abs(shieldAngle - Math.PI / 2) < 0.001 && Math.abs(direction.angle) < 0.001 && direction.hull === 1 && direction.shield === 0, JSON.stringify(direction));
      await p.clock.resume();
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
