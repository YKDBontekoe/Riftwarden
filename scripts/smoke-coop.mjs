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

// Minimal hand-written protobuf for the three messages this check needs (no dependencies, so the deploy job
// runs it without installing packages; it also cross-checks the generated codec against the .proto field numbers).
const enc = new TextEncoder();
const varint = (n) => { const out = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return out; };
const field = (no, type, bytes) => [...varint(no * 8 + type), ...bytes];
const lenField = (no, bytes) => field(no, 2, [...varint(bytes.length), ...bytes]);
const dbl = (v) => [...new Uint8Array(new Float64Array([v]).buffer)];
// ClientFrame.hello = 1 { protocol = 1, secret = 2, name = 3 }; ClientFrame.ping = 16 { c = 1 (double) }
const hello = (v, secret, name) => Uint8Array.from(lenField(1, [...field(1, 0, varint(v)), ...lenField(2, [...enc.encode(secret)]), ...lenField(3, [...enc.encode(name)])]));
const pingFrame = (c) => Uint8Array.from(lenField(16, field(1, 1, dbl(c))));

/** Read the fields of one message: number -> varint | Uint8Array (length-delimited) | double. */
function fields(bytes) {
  const out = new Map();
  let i = 0;
  const readVarint = () => { let n = 0, mul = 1, b; do { b = bytes[i++]; n += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80); return n; };
  while (i < bytes.length) {
    const key = readVarint();
    const no = Math.floor(key / 8), type = key % 8;
    if (type === 0) out.set(no, readVarint());
    else if (type === 1) { out.set(no, new DataView(bytes.buffer, bytes.byteOffset + i, 8).getFloat64(0, true)); i += 8; }
    else if (type === 2) { const len = readVarint(); out.set(no, bytes.subarray(i, i + len)); i += len; }
    else throw new Error(`unexpected wire type ${type}`);
  }
  return out;
}
const text = (b) => (b ? new TextDecoder().decode(b) : '');
// ServerFrame: welcome = 1 { protocol = 1, player_id = 2, name = 3 }, error = 2 { code = 1, msg = 2 }, pong = 13 { c = 1 }
function decode(data) {
  const frame = fields(new Uint8Array(data));
  if (frame.has(1)) { const w = fields(frame.get(1)); return { t: 'welcome', v: w.get(1) ?? 0, name: text(w.get(3)) }; }
  if (frame.has(2)) { const e = fields(frame.get(2)); return { t: 'error', code: text(e.get(1)), msg: text(e.get(2)) }; }
  if (frame.has(13)) { const p = fields(frame.get(13)); return { t: 'pong', c: p.get(1) ?? 0 }; }
  return { t: 'other' };
}

const url = new URL('/ws', origin);
url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(url);
socket.binaryType = 'arraybuffer';
const timeout = AbortSignal.timeout(8000);
const ping = Date.now();
try {
  await new Promise((resolve, reject) => {
    timeout.addEventListener('abort', () => reject(new Error(`Timed out waiting for co-op at ${url}`)), { once: true });
    socket.addEventListener('error', () => reject(new Error(`WebSocket connection failed at ${url}`)), { once: true });
    socket.addEventListener('close', ({ code, reason }) => reject(new Error(`WebSocket closed early (${code}) ${reason}`)), { once: true });
    socket.addEventListener('open', () => socket.send(hello(health.v, randomBytes(16).toString('hex'), 'Deploy Smoke')), { once: true });
    socket.addEventListener('message', ({ data }) => {
      try {
        const msg = decode(data);
        if (msg.t === 'welcome') {
          assert.equal(msg.v, health.v);
          assert.equal(msg.name, 'Deploy Smoke');
          socket.send(pingFrame(ping));
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
