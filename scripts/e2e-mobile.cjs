// Mobile browser suite: an emulated landscape phone (touch, coarse pointer) driven with real CDP touch events.
// A boot + mobile defaults + PWA, B HQ stick/look/use, C arena fire/drag-aim/jump/dash/sprint/multi-touch,
// D build mode + pause + legend, E portrait hint, F mouse switches auto mode off, G terminal scroll + close, V screenshots.
// Usage: pnpm dev (port 5173), then: node scripts/e2e-mobile.cjs [A,B,...]   (screenshots in $E2E_OUT or the OS temp dir)
const H = require('./lib/harness.cjs');
const { check, S, ev, stats, OUT } = H;
const want = H.sectionFilter();
const PHONE = { width: 844, height: 390 };

/** Touch driver over CDP: one touch sequence with any number of fingers. */
function touchDriver(cdp) {
  const pts = new Map();
  const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...pts.values()] });
  return {
    async down(id, x, y) {
      pts.set(id, { x, y, id, radiusX: 6, radiusY: 6, force: 1 });
      await send('touchStart');
    },
    async move(id, x, y) {
      pts.set(id, { ...pts.get(id), x, y });
      await send('touchMove');
    },
    async up(id) {
      const q = pts.get(id);
      if (!q) return;
      pts.delete(id);
      // touchEnd listing only the lifted finger (a touchMove that omits it never releases it in CDP).
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [q] });
    },
    /** Drag in n steps (a frame of simulation per step keeps look deltas per frame realistic). */
    async drag(id, x0, y0, x1, y1, n = 8, page = null) {
      await this.down(id, x0, y0);
      for (let i = 1; i <= n; i++) {
        await this.move(id, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
        if (page) await ev(page, () => window.__rift.advance(1 / 60));
      }
    },
  };
}

async function centre(p, testId) {
  const box = await p.locator(`[data-testid="${testId}"]`).first().boundingBox();
  if (!box) throw new Error(`no element ${testId}`);
  return [box.x + box.width / 2, box.y + box.height / 2];
}

async function tap(p, t, testId, hold = 1 / 30) {
  const [x, y] = await centre(p, testId);
  await t.down(90, x, y);
  await ev(p, (s) => window.__rift.advance(s), hold);
  await t.up(90);
  await ev(p, () => window.__rift.advance(1 / 60));
}

const visible = (p, testId) => p.locator(`[data-testid="${testId}"]`).count();

(async () => {
  const b = await H.chromium.launch({ args: H.GL_ARGS });
  const ctx = await b.newContext({ viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errs = H.collectErrors(p, []);
  const cdp = await ctx.newCDPSession(p);
  const t = touchDriver(cdp);
  try {
    // No seeded settings: a first start on a phone picks the mobile defaults.
    await H.boot(p, { skipUpgrades: true });
    if (want('A')) {
      const a = await ev(p, () => ({ touch: window.__rift.flow.input.touch, attr: document.documentElement.hasAttribute('data-touch'), s: window.__rift.flow.settings }));
      check('A1 auto mode turns touch on for a coarse touch screen', a.touch && a.attr, JSON.stringify({ touch: a.touch, attr: a.attr }));
      check('A2 first start on a phone uses the performance preset', a.s.quality === 'low' && a.s.shadows === 'off' && a.s.renderScale < 0.75, JSON.stringify({ q: a.s.quality, sh: a.s.shadows, rs: a.s.renderScale }));
      const man = await ev(p, async () => {
        const link = document.querySelector('link[rel=manifest]');
        const res = await fetch(link.href);
        const json = await res.json();
        const icon = await fetch(new URL(json.icons[0].src, link.href));
        return { ok: res.ok, name: json.name, icon: icon.ok && icon.headers.get('content-type'), theme: !!document.querySelector('meta[name=theme-color]') };
      });
      check('A3 manifest and icons are served', man.ok && man.name === 'Riftwarden' && /png/.test(man.icon) && man.theme, JSON.stringify(man));
      await ev(p, () => window.__touch.simulatePwa({ canInstall: true }));
      check('A4 main menu offers INSTALL APP when the browser allows it', (await visible(p, 'pwa-install')) === 1);
      await ev(p, () => window.__touch.simulatePwa({ canInstall: false, update: true }));
      check('A5 a waiting update shows the reload toast', (await visible(p, 'pwa-reload')) === 1);
      await p.locator('.pwa-toast .mini').click();
      check('A6 LATER dismisses it', (await visible(p, 'pwa-update')) === 0);
    }

    // Enter the HQ with a real tap on the menu button: the gesture takes control without pointer lock.
    const [ex, ey] = await centre(p, 'enter-hq').catch(async () => {
      const box = await p.locator('button.deploy').first().boundingBox();
      return [box.x + box.width / 2, box.y + box.height / 2];
    });
    await t.down(1, ex, ey);
    await t.up(1);
    await H.waitFor(p, () => window.__rift.state().location === 'home' && window.__rift.home && window.__rift.home.screen === 'home' && !window.__rift.state().busy);
    await ev(p, () => window.__rift.advance(0.5));
    if (want('B')) {
      check('B1 a tap enters the HQ in control (no pointer lock) and asks for fullscreen', (await ev(p, () => window.__touch.immersiveStats.requests)) > 0 && (await visible(p, 'touch-layer')) === 1);
      const before = await ev(p, () => { const pl = window.__rift.home.player; return { x: pl.position.x, z: pl.position.z, yaw: pl.yaw }; });
      // Left thumb: push the stick forward and hold for a second.
      await t.down(2, 150, 280);
      await t.move(2, 150, 230);
      await ev(p, () => window.__rift.advance(1));
      const moved = await ev(p, () => { const q = window.__rift.home.player.position; return { sx: window.__rift.flow.input.stickZ, pl: { x: q.x, z: q.z } }; });
      await t.up(2);
      const dist = Math.hypot(moved.pl.x - before.x, moved.pl.z - before.z);
      check('B2 the stick walks the drone', moved.sx > 0.5 && dist > 3, `stickZ=${moved.sx.toFixed(2)} dist=${dist.toFixed(2)}`);
      await ev(p, () => window.__rift.advance(1 / 60));
      check('B3 releasing the stick stops the input', (await ev(p, () => window.__rift.flow.input.stickZ)) === 0);
      await t.drag(3, 600, 200, 700, 200, 8, p);
      await t.up(3);
      const yaw = await ev(p, () => window.__rift.home.player.yaw);
      check('B4 dragging the right side turns the camera', yaw - before.yaw > 0.15, `dyaw=${(yaw - before.yaw).toFixed(3)}`);
      if (want('V')) await H.shot(p, 'mobile-hq');
    }

    if (want('G')) {
      // Terminals on a phone: taller than the screen, so they scroll with a finger; CLOSE closes with a tap.
      await ev(p, () => window.__rift.home.openTerminal('storage'));
      await p.waitForTimeout(400);
      const body = p.locator('.term-body').first();
      const box = await body.boundingBox();
      const max = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
      await t.drag(10, box.x + box.width / 2, box.y + box.height - 20, box.x + box.width / 2, box.y + 20, 10);
      await t.up(10);
      await p.waitForTimeout(400);
      const top = await body.evaluate((el) => el.scrollTop);
      check('G1 a terminal taller than the phone scrolls with a swipe', max <= 0 || top > 20, `scrollTop=${top} max=${max}`);
      const close = await p.locator('button.term-close').first().boundingBox();
      await t.down(11, close.x + close.width / 2, close.y + close.height / 2);
      await t.up(11);
      await H.waitFor(p, () => window.__rift.home.screen === 'home', null, 10000);
      check('G2 CLOSE closes the terminal with a tap and gives control back', (await visible(p, 'touch-layer')) === 1);
    }

    // Arena, with abilities, an ultimate and a secondary weapon equipped (the full thumb cluster).
    await ev(p, () => {
      const R = window.__rift;
      const mk = (baseId, seed) => R.makeItem({ seed, rarity: 'rare', baseId, level: 5 });
      const items = { ability: mk('frag_charge', 91), ability2: mk('blink_drive', 92), ultimate: mk('orbital_lance', 93), weapon2: mk('rail_lancer', 94) };
      R.profile.mutate((d) => {
        for (const [slot, it] of Object.entries(items)) {
          d.items.push(it);
          d.loadout[slot] = it.uid;
        }
        return true;
      });
    });
    await ev(p, () => window.__rift.flow.deploy(1));
    await H.waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.state().busy && window.__rift.game && window.__rift.game.screen === 'playing');
    await ev(p, () => window.__rift.advance(0.3));
    if (want('C')) {
      check('C1 arena shows the combat overlay', (await visible(p, 'tc-fire')) === 1 && (await visible(p, 'tc-jump')) === 1 && (await visible(p, 'tc-wave')) === 1);
      const [fx, fy] = await centre(p, 'tc-fire');
      const g0 = await ev(p, () => ({ shots: window.__rift.game.weapon.shotsFired, yaw: window.__rift.game.player.yaw }));
      // Fire with the right thumb while the left thumb moves: both fingers down at once.
      await t.down(4, 140, 300);
      await t.move(4, 140, 250);
      await t.down(5, fx, fy);
      for (let i = 1; i <= 10; i++) {
        await t.move(5, fx - i * 6, fy);
        await ev(p, () => window.__rift.advance(1 / 30));
      }
      const g1 = await ev(p, () => ({ shots: window.__rift.game.weapon.shotsFired, yaw: window.__rift.game.player.yaw, trig: window.__rift.flow.input.mouse(0), stick: window.__rift.flow.input.stickZ }));
      await t.up(5);
      await ev(p, () => window.__rift.advance(1 / 60));
      const lift = await ev(p, () => ({ trig: window.__rift.flow.input.mouse(0), stick: window.__rift.flow.input.stickZ, held: !!document.querySelector('.tc-fire.held') }));
      await t.up(4);
      await ev(p, () => window.__rift.advance(1 / 60));
      check('C2 holding FIRE fires the weapon', g1.shots > g0.shots, `shots ${g0.shots} -> ${g1.shots}`);
      check('C3 dragging FIRE aims while firing', g0.yaw - g1.yaw > 0.05, `dyaw=${(g1.yaw - g0.yaw).toFixed(3)}`);
      check('C4 multi-touch: the stick stays active while firing', g1.stick > 0.5 && g1.trig, JSON.stringify(g1));
      check('C5 lifting FIRE alone releases the trigger while the stick finger stays down', !lift.trig && !lift.held && lift.stick > 0.5, JSON.stringify(lift));
      check('C5b lifting the stick finger releases the stick', !(await ev(p, () => window.__rift.flow.input.mouse(0))) && (await ev(p, () => window.__rift.flow.input.stickZ)) === 0);
      await ev(p, () => window.__rift.advance(0.4));
      await tap(p, t, 'tc-jump');
      const air = await ev(p, () => { const pl = window.__rift.game.player; window.__rift.advance(0.1); return { grounded: pl.grounded, vy: pl.vy }; });
      check('C6 JUMP leaves the ground', !air.grounded, JSON.stringify(air));
      await ev(p, () => window.__rift.advance(1.2));
      const d0 = await ev(p, () => window.__rift.game.player.dashCharges);
      await tap(p, t, 'tc-dash');
      check('C7 DASH spends a dash charge', (await ev(p, () => window.__rift.game.player.dashCharges)) === d0 - 1, `charges ${d0}`);
      await ev(p, () => window.__rift.advance(1.5));
      await t.down(6, 150, 300);
      await t.move(6, 150, 200);
      await ev(p, () => window.__rift.advance(0.3));
      const sprint = await ev(p, () => ({ s: window.__rift.game.player.sprinting, f: window.__rift.flow.input.stickSprint, cls: document.querySelector('.tc-stick')?.className }));
      await t.up(6);
      check('C8 pushing the stick past its ring sprints', sprint.s && sprint.f && /sprint/.test(sprint.cls), JSON.stringify(sprint));
      await ev(p, () => window.__rift.advance(1));
      await tap(p, t, 'tc-ab1');
      const ab = await ev(p, () => window.__rift.game.abilities.hud().find((r) => r.slot === 'ability'));
      check('C9 the ability button fires ability I (cooldown starts)', ab && !ab.ready, JSON.stringify(ab));
      await tap(p, t, 'tc-swap');
      await ev(p, () => window.__rift.advance(0.3));
      check('C10 SWAP switches to the secondary weapon', (await ev(p, () => window.__rift.game.weaponSlots.active)) === 'weapon2');
      await tap(p, t, 'tc-wave');
      await ev(p, () => window.__rift.advance(0.5));
      const cw = await ev(p, () => window.__rift.game.waves.phase);
      check('C11 WAVE starts the wave; the ultimate button appears in combat', cw === 'combat' && (await visible(p, 'tc-ult')) === 1 && (await visible(p, 'tc-wave')) === 0, cw);
      if (want('V')) await H.shot(p, 'mobile-arena');
    }

    if (want('D')) {
      await ev(p, () => window.__rift.advance(0.2));
      await tap(p, t, 'tc-build');
      await ev(p, () => window.__rift.advance(0.1)); // the HUD publishes at 20 Hz
      const bm = await ev(p, () => window.__rift.game.construction.active);
      const place = await p.locator('[data-testid=tc-fire] .tc-label').textContent();
      check('D1 BUILD enters build mode and FIRE becomes PLACE', bm && place === 'PLACE', `${bm} ${place}`);
      check('D2 part cycling buttons appear', (await visible(p, 'tc-part-wpn')) === 1 && (await visible(p, 'tc-ab1')) === 1);
      if (want('V')) await H.shot(p, 'mobile-build');
      await tap(p, t, 'tc-ab1');
      check('D3 CANCEL leaves build mode', !(await ev(p, () => window.__rift.game.construction.active)));
      await tap(p, t, 'tc-pause');
      check('D4 pause button opens the pause menu', (await S(p)).screen === 'paused' && (await visible(p, 'touch-layer')) === 0);
      // A tap, not a click: a mouse click would (correctly) switch auto mode back to mouse controls.
      {
        const box = await p.locator('.modal .tabs button', { hasText: 'CONTROLS' }).first().boundingBox();
        await t.down(8, box.x + box.width / 2, box.y + box.height / 2);
        await t.up(8);
      }
      check('D5 the controls tab shows the touch legend', (await visible(p, 'touch-legend')) === 1);
      const [rx, ry] = await (async () => { const box = await p.locator('.modal button.primary').first().boundingBox(); return [box.x + box.width / 2, box.y + box.height / 2]; })();
      await t.down(7, rx, ry);
      await t.up(7);
      await H.waitFor(p, () => window.__rift.game.screen === 'playing', null, 10000);
      check('D6 RESUME with a tap returns to play without pointer lock', (await visible(p, 'touch-layer')) === 1);
      // Left thumb still on the stick while the right thumb taps CARGO: the overlay unmounts mid-press.
      await t.down(12, 150, 300);
      await t.move(12, 150, 240);
      await ev(p, () => window.__rift.advance(1 / 30));
      const pushing = await ev(p, () => window.__rift.flow.input.stickZ);
      await tap(p, t, 'tc-inv');
      check('D7 CARGO opens the drone cargo', (await S(p)).screen === 'inventory');
      await p.waitForTimeout(100); // React commits the unmount
      check('D8 a panel opening under a held stick centres it (no walking behind the panel)', pushing > 0.5 && (await ev(p, () => window.__rift.flow.input.stickZ)) === 0, `before ${pushing.toFixed(2)}`);
      await t.up(12);
      await ev(p, () => window.__rift.game.closeInventory?.());
    }

    if (want('E')) {
      await p.setViewportSize({ width: 390, height: 844 });
      await p.waitForTimeout(200);
      check('E1 portrait shows the rotate hint', (await visible(p, 'rotate-hint')) === 1);
      if (want('V')) await p.screenshot({ path: `${OUT}/mobile-portrait.png` });
      await p.setViewportSize(PHONE);
      await p.waitForTimeout(200);
      check('E2 landscape hides it', (await visible(p, 'rotate-hint')) === 0);
    }

    if (want('F')) {
      if ((await S(p)).screen !== 'playing') await ev(p, () => window.__rift.game.resume());
      // Without the automation capture, as for a player: a mouse click leaves touch mode and there is no pointer lock yet.
      await ev(p, () => { window.__rift.flow.input.forceCapture = false; });
      await p.mouse.click(420, 200);
      await p.waitForTimeout(100);
      const f = await ev(p, () => ({ touch: window.__rift.flow.input.touch, screen: window.__rift.game.screen }));
      check('F1 a mouse click switches auto mode to mouse and pauses (no pointer lock yet)', !f.touch && f.screen === 'paused', JSON.stringify(f));
    }

    const bad = errs.filter((e) => !/Error compiling effect|hit-?flash/i.test(e));
    check('Z no runtime errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    console.error(e);
    stats.failures++;
  } finally {
    console.log(`\n${stats.passes} passed, ${stats.failures} failed${want('V') ? ` · screenshots in ${OUT}` : ''}`);
    await b.close();
    process.exit(stats.failures ? 1 : 0);
  }
})();
