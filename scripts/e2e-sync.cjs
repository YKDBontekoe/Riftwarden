// Offline-first profile sync in the browser (architecture v2 step 5): gateway + rules worker + client.
//   A a guest plays a real run to the wave-5 checkpoint (drops, banked loot with its loot journal)
//   B signing up uploads the guest profile: the server re-rolls the loot and adopts it; the guest starts over
//   C offline changes queue and sync when the session is back
//   D a second device signs in (same passkey) and gets the account copy; its change reaches the first device
//   E a forged entry is refused by the server and the device copy is put back
//   F the shared war lives behind the gateway: a signed-in report liberates, a guest report does not count
// Usage: worker (pnpm worker) + gateway (:8090, RIFT_TEST=1 RIFT_COOKIE_SECURE=0) + pnpm dev, then node scripts/e2e-sync.cjs
const { chromium, GL_ARGS, URL, SETTINGS, check, stats } = require('./lib/harness.cjs');
const { Client } = require('pg');

const DB = process.env.RIFT_GATEWAY_DATABASE_URL || 'postgres://rift@127.0.0.1:55432/rift_gateway';
const NAME = `Syncer ${Math.random().toString(36).slice(2, 7)}`;

async function device(b) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((s) => { if (!localStorage.getItem('riftwarden.settings')) localStorage.setItem('riftwarden.settings', s); }, SETTINGS);
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(String(e)));
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await p.goto(URL + '?test&account');
  await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
  await p.evaluate(() => { window.__rift.stopLoop(); window.__rift.flow.skipUpgrades = true; });
  return { ctx, p, cdp, auth: authenticatorId };
}

const ev = (p, fn, arg) => p.evaluate(fn, arg);
const waitFor = (p, fn, arg, t = 60000) => p.waitForFunction(fn, arg, { timeout: t, polling: 100 });

async function clearThrough(p, wave) {
  return p.evaluate(async (target) => {
    const R = window.__rift;
    for (let guard = 0; guard < 4000; guard++) {
      const g = R.game;
      if (!g) return 'no game';
      if (g.screen === 'checkpoint') {
        if (g.cfg.run.wavesCleared >= target) return 'checkpoint';
        await g.continueRun();
      }
      if (g.screen === 'defeat') return 'defeat';
      if (g.waves.phase === 'prep') g.waves.startNow();
      R.advance(0.5);
      R.killAll();
    }
    return 'timeout';
  }, wave);
}

async function openAccount(p) {
  if (!(await p.isVisible('[data-testid="acct-panel"]'))) {
    if ((await ev(p, () => window.__rift.state().screen)) !== 'menu') await ev(p, () => window.__rift.home.setScreen('menu'));
    await p.getByRole('button', { name: 'ACCOUNT' }).click();
  }
  await waitFor(p, () => document.querySelector('[data-testid="acct-panel"]')?.dataset.status !== 'unknown', null, 15000);
}

const synced = async (p, minRev = 1) => {
  try {
    await waitFor(p, (r) => { const s = window.__session?.()?.status.get(); return s && s.state === 'idle' && s.rev >= r && s.pending === 0; }, minRev, 30000);
  } catch (e) {
    console.log('sync status at timeout:', JSON.stringify(await p.evaluate(() => window.__session?.()?.status.get() ?? null)));
    throw e;
  }
};
const status = (p) => ev(p, () => window.__session?.()?.status.get() ?? null);

(async () => {
  const b = await chromium.launch({ args: GL_ARGS });
  const db = new Client({ connectionString: DB });
  await db.connect();
  const one = await device(b);
  const p = one.p;

  // ---- A: a guest run with real drops banked at the checkpoint
  await ev(p, () => window.__rift.flow.enterHq());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy, null, 180000);
  await ev(p, () => window.__rift.flow.deploy(1));
  await waitFor(p, () => window.__rift.state().location === 'arena' && !window.__rift.state().busy, null, 180000);
  const r = await clearThrough(p, 5);
  const banked = await ev(p, () => ({ items: window.__rift.profile.save.items.length, salvage: window.__rift.profile.save.resources.salvage, journal: window.__rift.game.cfg.run.lootJournal.length }));
  check('A1 the guest reached the checkpoint and banked loot with a loot journal', r === 'checkpoint' && banked.items > 1 && banked.journal > 0, JSON.stringify(banked));
  await ev(p, () => window.__rift.flow.returnHome());
  await waitFor(p, () => window.__rift.state().location === 'home' && !window.__rift.state().busy, null, 180000);
  const guest = await ev(p, () => { const j = window.__rift.profile.journal.state; return { complete: j.complete, genesis: !!j.genesis, kinds: j.entries.map((e) => e.run?.kind ?? e.op?.name) }; });
  check('A2 the guest log is complete and holds the run (start, bank, end)', guest.complete && guest.genesis && ['start', 'bank', 'end'].every((k) => guest.kinds.includes(k)), guest.kinds.join(','));
  const guestSave = await ev(p, () => { const s = window.__rift.profile.save; return { items: s.items.map((i) => i.uid).sort(), salvage: s.resources.salvage, credits: s.resources.credits, runs: s.totals.runs }; });

  // ---- B: sign up -> the guest profile is uploaded, validated and adopted
  await ev(p, () => window.__rift.home.setScreen('menu'));
  await openAccount(p);
  await p.getByTestId('acct-tab-create').click();
  await p.getByTestId('acct-name').fill(NAME);
  await p.getByTestId('acct-submit').click();
  await p.waitForSelector('[data-testid="acct-recovery-code"]', { timeout: 20000 });
  await p.getByTestId('acct-recovery-saved').check();
  await p.getByTestId('acct-recovery-done').click();
  await synced(p);
  const st = await status(p);
  const acct = await ev(p, () => { const pr = window.__rift.profile; return { ns: pr.namespace, items: pr.save.items.map((i) => i.uid).sort(), salvage: pr.save.resources.salvage, credits: pr.save.resources.credits, runs: pr.save.totals.runs }; });
  check('B1 the server adopted the guest profile (claimed)', st.claimed === true && !!acct.ns, JSON.stringify(st));
  check('B2 the account copy holds the guest run: same items, salvage and credits', JSON.stringify({ ...acct, ns: undefined }) === JSON.stringify(guestSave), JSON.stringify({ acct: { ...acct, items: acct.items.length }, guest: { ...guestSave, items: guestSave.items.length } }));
  const row = await db.query('SELECT p.doc, p.rev FROM profiles p JOIN accounts a ON a.id = p.account_id WHERE a.name = $1', [NAME]);
  const server = row.rows[0]?.doc;
  check('B3 PostgreSQL holds the validated copy with every banked item', !!server && JSON.stringify(server.items.map((i) => i.uid).sort()) === JSON.stringify(guestSave.items), `rev ${row.rows[0]?.rev}`);
  const fresh = await ev(p, () => JSON.parse(localStorage.getItem('riftwarden.save')).data.resources.salvage);
  check('B4 the guest profile starts over after the upload', fresh === 0, fresh);

  // ---- C: offline changes queue and sync later
  await ev(p, () => window.__session().close());
  await ev(p, () => window.__rift.profile.op('tutorialSkip', []));
  await ev(p, () => window.__rift.profile.op('selectTier', [2]));
  const queued = await ev(p, () => window.__rift.profile.journal.pending.length);
  check('C1 offline changes are applied locally and queued', queued === 2 && (await ev(p, () => window.__rift.profile.save.threat.selected)) === 2, queued);
  const before = (await status(p)).rev;
  await ev(p, () => window.__session().open());
  await synced(p, before + 1);
  const after = await db.query('SELECT p.doc, p.rev FROM profiles p JOIN accounts a ON a.id = p.account_id WHERE a.name = $1', [NAME]);
  check('C2 they reach the server when the session is back', after.rows[0].doc.threat.selected === 2 && after.rows[0].doc.tutorial.skipped === true && Number(after.rows[0].rev) > Number(row.rows[0].rev));

  // ---- D: a second device with the same passkey
  const two = await device(b);
  const creds = await one.cdp.send('WebAuthn.getCredentials', { authenticatorId: one.auth });
  for (const c of creds.credentials) await two.cdp.send('WebAuthn.addCredential', { authenticatorId: two.auth, credential: c });
  await openAccount(two.p);
  await two.p.getByTestId('acct-tab-signin').click();
  await two.p.getByTestId('acct-name').fill(NAME);
  await two.p.getByTestId('acct-submit').click();
  await synced(two.p);
  const second = await ev(two.p, () => { const s = window.__rift.profile.save; return { items: s.items.length, tier: s.threat.selected }; });
  check('D1 the second device gets the account copy', second.items === guestSave.items.length && second.tier === 2, JSON.stringify(second));
  const revBefore = (await status(p)).rev;
  await ev(two.p, () => window.__rift.profile.op('selectTier', [1]));
  await synced(two.p, revBefore + 1);
  await waitFor(p, (r) => (window.__session?.()?.status.get().rev ?? 0) > r, revBefore, 20000);
  check('D2 a change on the second device reaches the first (push + pull)', (await ev(p, () => window.__rift.profile.save.threat.selected)) === 1);

  // ---- E: a forged entry is refused and the device copy is put back
  const credits = await ev(p, () => window.__rift.profile.save.resources.credits);
  await ev(p, () => {
    const pr = window.__rift.profile;
    pr.save.resources.credits += 1e8; // a local edit
    pr.journal.append({ run: { kind: 'bank', runId: 'run_forged', wave: 5, bosses: 0, loot: [], rewards: { salvage: 0, credits: 1e8, components: 0, shards: 0, xp: 0, items: [] } } });
    window.__session().nudge();
  });
  await waitFor(p, () => (window.__session?.()?.status.get().rejected.length ?? 0) > 0, null, 20000);
  await synced(p);
  check('E1 the server refuses the forged entry and the device copy is restored', (await ev(p, () => window.__rift.profile.save.resources.credits)) === credits);

  // ---- F: the shared war behind the gateway
  const war = await ev(p, async () => {
    const w = window.__rift.flow.war;
    w.base = '';
    const state = await w.refresh();
    const node = `r${state.regions[0].k}n0`;
    const before = state.secured;
    const r = await w.report(node, 'defense');
    const after = await w.refresh();
    return { source: w.source, ok: r.ok, gain: r.gain, before, after: after.secured };
  });
  check('F1 a signed-in warden secures a sector on the shared war (gateway)', war.source === 'server' && war.ok && war.gain > 0 && war.after > war.before, JSON.stringify(war));
  const three = await device(b);
  const guestWar = await ev(three.p, async () => {
    const w = window.__rift.flow.war;
    w.base = '';
    const s = await w.refresh();
    return w.report(`r${s.regions[0].k}n0`, 'defense');
  });
  check('F2 a guest report does not count toward the shared war', !guestWar.ok && /Sign in/.test(guestWar.reason ?? ''), guestWar.reason);
  await three.ctx.close();

  const errs = [...p.errs, ...two.p.errs];
  check('Z no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n${stats.passes} passed, ${stats.failures} failed`);
  await db.end();
  await b.close();
  process.exit(stats.failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
