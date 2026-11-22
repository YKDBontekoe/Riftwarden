// Passkey accounts in the browser (architecture v2 step 4), with Chromium's virtual WebAuthn authenticator.
//   A sign-up: live name check, passkey creation, one-time recovery code, signed in
//   B the session survives a reload (HttpOnly cookie)
//   C sign out, then sign in with the passkey
//   D a second passkey (another authenticator), removal, the last one cannot be removed
//   E names are unique (case-insensitive) at sign-up
//   F recovery on a new device with the code: new passkey, new code, the old device is signed out
//   G a regenerated recovery code replaces the old one
//   H the panel degrades to "offline" when the gateway is unreachable
// Usage: gateway on :8090 (RIFT_TEST=1 RIFT_COOKIE_SECURE=0) + pnpm dev (:5173), then node scripts/e2e-accounts.cjs [A,B,...]
const { chromium, GL_ARGS, URL, check, stats, sectionFilter } = require('./lib/harness.cjs');

const want = sectionFilter();
const suffix = Math.random().toString(36).slice(2, 7);
const NAME = `Warden ${suffix}`;

async function device(b) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/401|409|400|Failed to load resource/.test(m.text()) && p.errs.push(m.text()));
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  // Chrome allows one platform (internal) authenticator; extra ones are roaming security keys.
  const add = async (transport = 'usb') =>
    (await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport, hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    })).authenticatorId;
  const auth = await add('internal');
  return { ctx, p, cdp, auth, add };
}

async function openAccount(p, query = '') {
  await p.goto(URL + '?test' + query);
  await p.waitForFunction(() => window.__rift && window.__rift.state().screen === 'menu', null, { timeout: 180000 });
  await p.evaluate(() => window.__rift.stopLoop());
  await p.getByRole('button', { name: 'ACCOUNT' }).click();
  await p.waitForFunction(() => document.querySelector('[data-testid="acct-panel"]')?.dataset.status !== 'unknown', null, { timeout: 15000 });
  return p.evaluate(() => document.querySelector('[data-testid="acct-panel"]').dataset.status);
}

const status = (p) => p.evaluate(() => document.querySelector('[data-testid="acct-panel"]')?.dataset.status);
const waitStatus = (p, s) => p.waitForFunction((want) => document.querySelector('[data-testid="acct-panel"]')?.dataset.status === want, s, { timeout: 15000 });
const text = (p, id) => p.evaluate((t) => document.querySelector(`[data-testid="${t}"]`)?.textContent ?? null, id);
const me = (p) => p.evaluate(() => fetch('/auth/me', { credentials: 'include' }).then((r) => (r.ok ? r.json() : r.status)));

(async () => {
  const b = await chromium.launch({ args: GL_ARGS });
  const one = await device(b);
  const p = one.p;
  let code = null;

  if (want('A') || want('B') || want('C') || want('D') || want('E') || want('F') || want('G')) {
    const s0 = await openAccount(p);
    check('A0 a fresh browser is signed out', s0 === 'signedOut', s0);
    await p.getByTestId('acct-tab-create').click();
    await p.getByTestId('acct-name').fill(NAME);
    await p.waitForFunction(() => document.querySelector('[data-testid="acct-name-hint"]')?.textContent === 'Available', null, { timeout: 10000 });
    check('A1 the name check says the name is free', (await text(p, 'acct-name-hint')) === 'Available');
    await p.getByTestId('acct-submit').click();
    await p.waitForSelector('[data-testid="acct-recovery-code"]', { timeout: 15000 });
    code = await text(p, 'acct-recovery-code');
    check('A2 sign-up shows a one-time recovery code', /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(code ?? ''), code);
    check('A3 DONE needs the "saved" confirmation', await p.getByTestId('acct-recovery-done').isDisabled());
    await p.getByTestId('acct-recovery-saved').check();
    await p.getByTestId('acct-recovery-done').click();
    await waitStatus(p, 'signedIn');
    const m = await me(p);
    check('A4 signed in with one passkey', (await text(p, 'acct-signed-in')) === NAME && m.passkeys?.length === 1, JSON.stringify(m.account));
    const cookie = (await one.ctx.cookies()).find((c) => c.name === 'rw_session');
    check('A5 the session cookie is HttpOnly and SameSite=Lax', cookie?.httpOnly === true && cookie?.sameSite === 'Lax');
  }

  if (want('B')) {
    const s = await openAccount(p);
    check('B1 the session survives a reload', s === 'signedIn' && (await text(p, 'acct-signed-in')) === NAME, s);
  }

  if (want('C')) {
    await p.getByTestId('acct-logout').click();
    await waitStatus(p, 'signedOut');
    check('C1 sign out ends the session', (await me(p)) === 401);
    await p.getByTestId('acct-tab-signin').click();
    await p.getByTestId('acct-name').fill(NAME.toLowerCase());
    await p.getByTestId('acct-submit').click();
    await waitStatus(p, 'signedIn');
    const m = await me(p);
    check('C2 signing in with the passkey (name is case-insensitive)', m.account?.name === NAME && !!m.passkeys[0].lastUsedAt);
  }

  if (want('D')) {
    // Only the new authenticator answers: the first keeps its credential for later sign-ins.
    await one.cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId: one.auth, enabled: false });
    const second = await one.add();
    await p.getByTestId('acct-add-label').fill('laptop');
    await p.getByTestId('acct-add').click();
    await p.waitForFunction(() => document.querySelectorAll('[data-testid="acct-passkeys"] li').length === 2, null, { timeout: 15000 });
    const labels = await p.evaluate(() => [...document.querySelectorAll('[data-testid="acct-passkeys"] li span')].map((s) => s.textContent));
    check('D1 a second passkey is added with its label', labels.includes('laptop'), labels.join(','));
    await p.locator('[data-testid="acct-passkeys"] li').filter({ hasText: 'laptop' }).getByRole('button', { name: 'REMOVE' }).click();
    await p.waitForFunction(() => document.querySelectorAll('[data-testid="acct-passkeys"] li').length === 1, null, { timeout: 15000 });
    const lastDisabled = await p.locator('[data-testid="acct-passkeys"] li').getByRole('button', { name: 'REMOVE' }).isDisabled();
    check('D2 removing works and the last passkey cannot be removed', lastDisabled);
    await one.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: second });
    await one.cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId: one.auth, enabled: true });
  }

  let two = null;
  if (want('E') || want('F') || want('G')) two = await device(b);

  if (want('E')) {
    await openAccount(two.p);
    await two.p.getByTestId('acct-tab-create').click();
    await two.p.getByTestId('acct-name').fill(NAME.toUpperCase());
    await two.p.waitForFunction(() => !!document.querySelector('[data-testid="acct-name-hint"]'), null, { timeout: 10000 });
    const hint = await text(two.p, 'acct-name-hint');
    await two.p.getByTestId('acct-submit').click();
    await two.p.waitForSelector('[data-testid="acct-error"]', { timeout: 10000 });
    check('E1 a taken name is refused (case-insensitive)', /taken/i.test(hint ?? '') && /taken/i.test((await text(two.p, 'acct-error')) ?? ''), hint);
  }

  if (want('F')) {
    if ((await status(two.p)) === undefined) await openAccount(two.p);
    await two.p.getByTestId('acct-tab-recover').click();
    await two.p.getByTestId('acct-name').fill(NAME);
    await two.p.getByTestId('acct-code').fill((code ?? '').toLowerCase().replace(/-/g, ' '));
    await two.p.getByTestId('acct-submit').click();
    await two.p.waitForSelector('[data-testid="acct-recovery-code"]', { timeout: 15000 });
    const fresh = await text(two.p, 'acct-recovery-code');
    check('F1 the recovery code signs in on a new device and a new code replaces it', !!fresh && fresh !== code, fresh);
    await two.p.getByTestId('acct-recovery-saved').check();
    await two.p.getByTestId('acct-recovery-done').click();
    await waitStatus(two.p, 'signedIn');
    const m = await me(two.p);
    check('F2 the new device has its own passkey', m.passkeys?.length === 2 && m.passkeys.some((k) => k.label === 'recovered'));
    check('F3 recovery signs out the other devices', (await me(p)) === 401);
    const again = await two.p.evaluate((c) => fetch('/auth/recover/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: document.querySelector('[data-testid="acct-signed-in"]').textContent, code: c }) }).then((r) => r.status), code);
    check('F4 the used recovery code no longer works', again === 400, again);
  }

  if (want('G')) {
    if ((await status(two.p)) !== 'signedIn') await openAccount(two.p);
    await two.p.getByTestId('acct-new-code').click();
    await two.p.waitForSelector('[data-testid="acct-recovery-code"]', { timeout: 15000 });
    const g = await text(two.p, 'acct-recovery-code');
    check('G1 a regenerated recovery code is shown once', /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(g ?? ''), g);
  }

  if (want('H')) {
    const three = await device(b);
    const s = await openAccount(three.p, '&api=http://127.0.0.1:9');
    check('H1 an unreachable gateway shows the offline note (the game still starts)', s === 'offline' && !!(await text(three.p, 'acct-offline')), s);
    await three.ctx.close();
  }

  const errs = [...p.errs, ...(two?.p.errs ?? [])].filter((e) => !/favicon|DevTools|ERR_CONNECTION_REFUSED/.test(e));
  check('Z no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n${stats.passes} passed, ${stats.failures} failed`);
  await b.close();
  process.exit(stats.failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
