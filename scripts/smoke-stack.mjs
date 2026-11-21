// Smoke test of a deployed backend (the compose stack in CI, or production through Cloudflare):
//   node scripts/smoke-stack.mjs <api-origin> <revision>
// No dependencies: the deploy job runs it without installing packages.
import assert from 'node:assert/strict';

const [origin, revision] = process.argv.slice(2);
assert(origin && revision, 'usage: node scripts/smoke-stack.mjs <api-origin> <revision>');
const get = (path, init) => fetch(new URL(path, origin), { signal: AbortSignal.timeout(5000), ...init });

const health = await (await get('/health')).json();
assert.equal(health.ok, true, `unhealthy: ${JSON.stringify(health)}`);
assert.equal(health.build, revision, `serving ${health.build}, expected ${revision}`);
assert(health.sims >= 1, `no sim worker connected: ${JSON.stringify(health)}`);

const war = await get('/war');
assert.equal(war.status, 200, `/war returned ${war.status}`);
const body = await war.json();
assert(body.war && Array.isArray(body.war.regions) && body.war.regions.length > 0, 'the war has no regions');

const me = await get('/auth/me');
assert.equal(me.status, 401, `/auth/me without a session returned ${me.status}`);
const login = await get('/auth/test-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"Smoke"}' });
assert.equal(login.status, 404, 'the test login must not exist on a production server');
const name = await get('/auth/name?name=Smoke%20Test');
assert.equal(name.status, 200, `/auth/name returned ${name.status}`);

console.log(`smoke ok: ${origin} serves ${revision} (${health.sims} sim workers, ${body.war.regions.length} regions)`);
