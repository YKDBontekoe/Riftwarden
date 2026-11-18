import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const [origin, revision] = process.argv.slice(2);
assert(origin && revision, 'Usage: node scripts/smoke-coop.mjs <http-origin> <revision>');

async function get(path) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `${path} returned HTTP ${response.status}`);
  return response;
}

const build = await get('/build.txt');
assert.equal((await build.text()).trim(), revision, 'Unexpected build revision');
const page = await get('/?join=SMOKE');
assert.match(await page.text(), /<canvas id="game"/, 'The invite URL did not serve the game');
const health = await (await get('/health')).json();
assert(health.ok === true && Number.isInteger(health.v), 'Co-op server is not ready');

const url = new URL('/ws', origin);
url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(url);
const timeout = AbortSignal.timeout(8000);
const ping = Date.now();
try {
  await new Promise((resolve, reject) => {
    timeout.addEventListener('abort', () => reject(new Error(`Timed out waiting for co-op at ${url}`)), { once: true });
    socket.addEventListener('error', () => reject(new Error(`WebSocket connection failed at ${url}`)), { once: true });
    socket.addEventListener('close', ({ code, reason }) => reject(new Error(`WebSocket closed early (${code}) ${reason}`)), { once: true });
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      t: 'hello', v: health.v, secret: randomBytes(16).toString('hex'), name: 'Deploy Smoke',
    })), { once: true });
    socket.addEventListener('message', ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.t === 'welcome') {
          assert.equal(msg.v, health.v);
          assert.equal(msg.name, 'Deploy Smoke');
          socket.send(JSON.stringify({ t: 'ping', c: ping }));
        } else if (msg.t === 'pong') {
          assert.equal(msg.c, ping);
          resolve();
        } else if (msg.t === 'error') {
          throw new Error(msg.msg);
        }
      } catch (error) {
        reject(error);
      }
    });
  });
} finally {
  socket.close();
}
console.log(`Riftwarden ${revision} served the game and answered a co-op handshake and ping at ${origin}`);
