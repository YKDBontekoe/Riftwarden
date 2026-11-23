// Touch playtest: plays a real run on an emulated landscape phone using ONLY CDP touch events on the overlay
// (stick, look zone, FIRE drag-aim, JUMP, DASH, BUILD/PLACE/CANCEL, WAVE, upgrade cards, checkpoint buttons).
// The bot reads the game state to decide where to aim, then moves fingers like a thumb would: limited drag speed,
// a drag budget on FIRE (then lift and re-grip), big turns on the look zone. Reports per wave + touch ergonomics.
//   pnpm dev, then: node scripts/playtest-touch.cjs [waves=5] [shots=1]   (screenshots in $E2E_OUT or the OS temp dir)
const H = require('./lib/harness.cjs');
const { ev, OUT } = H;

const WAVES = Number(process.argv[2] || 5);
const SHOTS = process.argv[3] !== '0';
const PHONE = { width: 844, height: 390 };
const STEP = 1 / 30;
/** CSS px of finger travel per radian at the default settings (Player 0.0022 rad/px x TOUCH.lookScale 1.6). */
const PX_PER_RAD = 1 / (0.0022 * 1.6);
const FINGER_SPEED = 38; // px per step (~1100 px/s)
const FIRE_BUDGET = 110; // px a thumb can slide on FIRE before it has to lift and re-grip

function touches(cdp) {
  const pts = new Map();
  const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...pts.values()] });
  return {
    has: (id) => pts.has(id),
    get: (id) => pts.get(id),
    async down(id, x, y) { pts.set(id, { id, x, y, radiusX: 7, radiusY: 7, force: 1 }); await send('touchStart'); },
    async move(id, x, y) { if (!pts.has(id)) return; pts.set(id, { ...pts.get(id), x, y }); await send('touchMove'); },
    async up(id) { if (!pts.delete(id)) return; await send(pts.size ? 'touchMove' : 'touchEnd'); },
    async upAll() { for (const id of [...pts.keys()]) await this.up(id); },
  };
}

async function centre(p, testId) {
  const box = await p.locator(`[data-testid="${testId}"]`).first().boundingBox().catch(() => null);
  return box ? [box.x + box.width / 2, box.y + box.height / 2] : null;
}

/** Game state the bot needs this step (and the aim error to the best target). */
const SENSE = () => {
  const R = window.__rift;
  const g = R.game;
  if (!g) return null;
  const pl = g.player;
  const eye = pl.eye;
  let best = null;
  let bd = 1e9;
  for (const e of g.enemies.active) {
    if (e.hidden) continue;
    const c = e.center();
    const d = Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z);
    const score = d + (g.los(eye, c) ? 0 : 80);
    if (score < bd) { bd = score; best = { c, d, los: g.los(eye, c) }; }
  }
  let dyaw = 0;
  let dpitch = 0;
  if (best) {
    const dx = best.c.x - eye.x, dy = best.c.y - eye.y, dz = best.c.z - eye.z;
    const want = Math.atan2(dx, dz);
    dyaw = Math.atan2(Math.sin(want - pl.yaw), Math.cos(want - pl.yaw));
    dpitch = Math.atan2(-dy, Math.hypot(dx, dz)) - pl.pitch;
  }
  const s = R.state();
  return {
    screen: g.screen, phase: g.waves.phase, wave: g.waves.number, enemies: g.enemies.active.length,
    target: best ? { d: best.d, los: best.los } : null, dyaw, dpitch, alive: pl.alive, hp: pl.hp, cores: g.wallet.cores,
    build: g.construction.active, valid: !!g.construction.valid, towers: g.turrets.turrets.length,
    shots: g.weapon.shotsFired, dealt: g.director.dealt?.player ?? 0, reactor: g.reactorHp,
    kills: g.cfg.run.kills, pos: { x: pl.position.x, z: pl.position.z }, sprint: pl.sprinting,
  };
};

(async () => {
  const b = await H.chromium.launch({ args: H.GL_ARGS });
  const ctx = await b.newContext({ viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errs = H.collectErrors(p, []);
  const cdp = await ctx.newCDPSession(p);
  const T = touches(cdp);
  const log = [];
  const ergo = { regrips: 0, lookSwipes: 0, fireFrames: 0, aimedFrames: 0, onTargetFrames: 0, taps: 0, misses: [] };
  const tap = async (testId) => {
    const c = await centre(p, testId);
    if (!c) { ergo.misses.push(testId); return false; }
    await T.down(20, c[0], c[1]);
    await ev(p, () => window.__rift.advance(1 / 30));
    await T.up(20);
    ergo.taps++;
    return true;
  };
  try {
    await H.boot(p, {});
    const detect = await ev(p, () => ({ coarse: matchMedia('(pointer: coarse)').matches, points: navigator.maxTouchPoints, touch: window.__rift.flow.input.touch, quality: window.__rift.flow.settings.quality }));
    console.log('detection', JSON.stringify(detect));
    // Into the HQ and the arena by tapping, like a player.
    const enter = await (async () => { const box = await p.locator('button.deploy').first().boundingBox(); return [box.x + box.width / 2, box.y + box.height / 2]; })();
    await T.down(1, ...enter);
    await T.up(1);
    await H.waitFor(p, () => window.__rift.home && window.__rift.home.screen === 'home' && !window.__rift.state().busy);
    await ev(p, () => window.__rift.flow.deploy(1));
    await H.waitFor(p, () => window.__rift.game && window.__rift.game.screen === 'playing' && !window.__rift.state().busy);
    await ev(p, () => window.__rift.advance(0.2));

    const fire = await centre(p, 'tc-fire');
    const STICK = [150, 300];
    const LOOK = [560, 170];
    let fireAt = null; // finger position on FIRE
    let fireTravel = 0;
    let strafe = 1;
    let strafeT = 0;
    let jumpT = 2;
    let dashT = 3;
    let t = 0;
    let shotT = 8;
    let cur = null;
    let deaths = 0;
    let lastAlive = true;
    const waves = [];
    let builtThisPrep = 0;
    let lastWave = 0;

    while (waves.length < WAVES && t < WAVES * 120) {
      const s = await ev(p, SENSE);
      if (!s) break;
      // ---- screens: upgrade picks, checkpoint, defeat (all by touch)
      if (s.screen === 'upgrade') { await T.upAll(); fireAt = null; await tap('upgrade-card-0'); await ev(p, () => window.__rift.advance(0.2)); continue; }
      if (s.screen === 'checkpoint') { await T.upAll(); fireAt = null; await tap('cp-continue'); await H.waitFor(p, () => window.__rift.game.screen === 'playing', null, 10000).catch(() => {}); continue; }
      if (s.screen === 'defeat') { log.push(`DEFEAT on wave ${s.wave}`); break; }
      if (s.screen !== 'playing') { log.push(`unexpected screen ${s.screen} at ${t.toFixed(1)}s`); await T.upAll(); fireAt = null; await ev(p, () => window.__rift.game.resume()); continue; }
      if (lastAlive && !s.alive) deaths++;
      lastAlive = s.alive;

      // ---- wave bookkeeping
      if (s.phase === 'combat' && !cur) cur = { wave: s.wave, t0: t, firstShot: null, shots0: s.shots, dealt0: s.dealt, hp: 999, kills0: s.kills, reactor0: s.reactor, regrips0: ergo.regrips, swipes0: ergo.lookSwipes, on0: ergo.onTargetFrames, fire0: ergo.fireFrames };
      if (cur && s.phase !== 'combat') {
        waves.push({ ...cur, secs: t - cur.t0, shots: s.shots - cur.shots0, dealt: Math.round(s.dealt - cur.dealt0), kills: s.kills - cur.kills0, reactorLost: Math.round(cur.reactor0 - s.reactor), regrips: ergo.regrips - cur.regrips0, swipes: ergo.lookSwipes - cur.swipes0, onTarget: (ergo.onTargetFrames - cur.on0) / Math.max(1, ergo.fireFrames - cur.fire0) });
        cur = null;
      }
      if (cur) cur.hp = Math.min(cur.hp, s.hp);

      // ---- prep: build up to two towers, then call the wave with WAVE
      if (s.phase === 'prep' && !cur) {
        await T.upAll(); fireAt = null;
        if (s.wave !== lastWave) { builtThisPrep = 0; lastWave = s.wave; }
        if (builtThisPrep < 2 && s.cores >= 100 && s.towers < 6) {
          if (!s.build) { await tap('tc-build'); await ev(p, () => window.__rift.advance(0.1)); }
          // Look down-left a bit with a swipe on the look zone, so the ghost lands on open floor.
          await T.down(3, LOOK[0], LOOK[1]);
          for (let i = 1; i <= 4; i++) { await T.move(3, LOOK[0] - i * 14 * (builtThisPrep ? -1 : 1), LOOK[1] + i * 10); await ev(p, () => window.__rift.advance(1 / 30)); }
          await T.up(3);
          ergo.lookSwipes++;
          const v = await ev(p, () => window.__rift.game.construction.valid);
          if (v) { await tap('tc-fire'); builtThisPrep++; await ev(p, () => window.__rift.advance(0.3)); }
          else builtThisPrep += 0.5; // try once more from another angle
          await tap('tc-ab1'); // CANCEL leaves build mode (or ability I when not building)
          await ev(p, () => window.__rift.advance(0.2));
          // Level the view again.
          await T.down(3, LOOK[0], LOOK[1]);
          for (let i = 1; i <= 4; i++) { await T.move(3, LOOK[0], LOOK[1] - i * 10); await ev(p, () => window.__rift.advance(1 / 30)); }
          await T.up(3);
          continue;
        }
        if (s.build) await tap('tc-ab1');
        await tap('tc-wave');
        await ev(p, () => window.__rift.advance(0.3));
        t += 0.3;
        continue;
      }

      // ---- combat: left thumb strafes, right thumb aims + fires
      strafeT -= STEP;
      if (strafeT <= 0) { strafe = -strafe; strafeT = 1.2 + Math.random(); }
      const fwd = s.target && s.target.d > 26 ? -42 : s.target && s.target.d < 10 ? 30 : -8;
      if (!T.has(2)) await T.down(2, STICK[0], STICK[1]);
      await T.move(2, STICK[0] + strafe * 40, STICK[1] + fwd);

      const big = Math.abs(s.dyaw) > 0.55;
      if (s.target && big) {
        // Large turn: a swipe on the look zone (not firing meanwhile).
        if (fireAt) { await T.up(5); fireAt = null; }
        const need = s.dyaw * PX_PER_RAD;
        const dx = Math.max(-FINGER_SPEED * 3, Math.min(FINGER_SPEED * 3, need));
        await T.down(4, LOOK[0], LOOK[1]);
        for (let i = 1; i <= 3; i++) { await T.move(4, LOOK[0] + (dx * i) / 3, LOOK[1] + (s.dpitch * PX_PER_RAD * i) / 9); await ev(p, (d) => window.__rift.advance(d), STEP / 3); }
        await T.up(4);
        ergo.lookSwipes++;
      } else if (s.target && s.target.los) {
        // Fine aim on FIRE: hold and slide the thumb toward the target.
        if (!fireAt) { fireAt = [...fire]; fireTravel = 0; await T.down(5, ...fireAt); }
        const mx = Math.max(-FINGER_SPEED, Math.min(FINGER_SPEED, s.dyaw * PX_PER_RAD));
        const my = Math.max(-FINGER_SPEED, Math.min(FINGER_SPEED, s.dpitch * PX_PER_RAD));
        if (fireTravel + Math.hypot(mx, my) > FIRE_BUDGET) {
          // Thumb ran out of room: lift and re-grip (a short pause in fire).
          await T.up(5);
          ergo.regrips++;
          fireAt = [...fire];
          fireTravel = 0;
          await T.down(5, ...fireAt);
        } else {
          fireAt = [fireAt[0] + mx, fireAt[1] + my];
          fireTravel += Math.hypot(mx, my);
          await T.move(5, ...fireAt);
        }
        ergo.fireFrames++;
        if (Math.abs(s.dyaw) < 0.05 && Math.abs(s.dpitch) < 0.06) ergo.onTargetFrames++;
        if (cur && cur.firstShot === null) cur.firstShot = t - cur.t0;
      } else if (fireAt) { await T.up(5); fireAt = null; }

      // Movement buttons now and then (second finger of the right hand = thumb hop off FIRE in reality).
      jumpT -= STEP;
      dashT -= STEP;
      if (jumpT <= 0 && !fireAt) { await tap('tc-jump'); jumpT = 2.5 + Math.random() * 2; }
      if (dashT <= 0 && !fireAt) { await tap('tc-dash'); dashT = 4 + Math.random() * 3; }

      await ev(p, (dt) => window.__rift.advance(dt), STEP);
      t += STEP;
      shotT -= STEP;
      if (SHOTS && shotT <= 0 && s.phase === 'combat' && s.enemies > 2) {
        shotT = 25;
        await H.shot(p, `touch-play-w${s.wave}-${Math.round(t)}`);
      }
    }
    await T.upAll();
    const end = await ev(p, SENSE);
    console.log('\nwave  secs  1st-shot  shots  dmg     kills  minHP  reactor-lost  regrips  look-swipes  on-target');
    for (const w of waves) console.log(`${String(w.wave).padStart(4)}  ${w.secs.toFixed(1).padStart(4)}  ${(w.firstShot ?? NaN).toFixed(1).padStart(8)}  ${String(w.shots).padStart(5)}  ${String(w.dealt).padStart(6)}  ${String(w.kills).padStart(5)}  ${String(Math.round(w.hp)).padStart(5)}  ${String(w.reactorLost).padStart(12)}  ${String(w.regrips).padStart(7)}  ${String(w.swipes).padStart(11)}  ${(w.onTarget * 100).toFixed(0).padStart(8)}%`);
    console.log(`\ndeaths ${deaths} · towers ${end?.towers} · taps ${ergo.taps} · missing buttons ${JSON.stringify([...new Set(ergo.misses)])} · reactor ${Math.round(end?.reactor ?? 0)}`);
    for (const l of log) console.log(l);
    const bad = errs.filter((e) => !/Error compiling effect|hit-?flash/i.test(e));
    console.log(`errors ${bad.length}${bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''}${SHOTS ? ` · screenshots in ${OUT}` : ''}`);
  } finally {
    await b.close();
  }
})();
