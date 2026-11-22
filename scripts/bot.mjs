// Protocol bot for co-op tests (no rendering). Usage: import { Bot } from './bot.mjs' (run the suite with `node --import tsx`).
// Signs in through the gateway's test login (RIFT_TEST=1 only), opens the account's session socket and speaks the
// co-op protocol tunnelled in it (packages/protocol: codec.ts for co-op frames, session.ts for the socket).
import WebSocket from 'ws';
import { decodeServer, encodeClient } from '../packages/protocol/src/codec.ts';
import { PROTOCOL_VERSION } from '../packages/protocol/src/protocol.ts';
import { decodeSession, sessionCoop, sessionSync } from '../packages/protocol/src/session.ts';

export class Bot {
  /** `stack`: { url, ws } of the gateway (scripts/lib/stack.mjs). The account is the name (same name = same account). */
  constructor(name, stack) {
    this.name = name; this.stack = stack;
    this.msgs = []; this.events = []; this.snap = null; this.lobby = null; this.seq = 0; this.actId = 1; this.acts = new Map();
    this.waiters = []; this.calls = new Map(); this.callId = 1; this.logSeq = 0;
    this.device = `bot-${name}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async login() {
    const r = await fetch(`${this.stack.url}/auth/test-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: this.name }) });
    if (!r.ok) throw new Error(`${this.name}: test login ${r.status} ${await r.text()}`);
    this.account = (await r.json()).account;
    this.cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  }

  /** Sign in, open the session socket, make sure the account has a profile, then say hello. Resolves to welcome (or the error). */
  async connect(v = PROTOCOL_VERSION) {
    await this.login();
    await new Promise((res, rej) => {
      this.ws = new WebSocket(this.stack.ws, { headers: { cookie: this.cookie } });
      this.ws.on('open', res);
      this.ws.on('error', rej);
      this.ws.on('close', () => { this.closed = true; for (const [, c] of this.calls) c(null); this.calls.clear(); });
      this.ws.on('message', (b) => this.onFrame(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)));
    });
    this.profile = (await this.sync()).doc;
    return new Promise((res) => {
      this.waitNew((m) => m.t === 'welcome' || m.t === 'error', 20000).then(res, (e) => res({ t: 'error', code: 'timeout', msg: e.message }));
      this.send({ t: 'hello', v });
    });
  }

  onFrame(bytes) {
    const f = decodeSession(bytes);
    if (!f) return;
    if (f.kind === 'response') { const c = this.calls.get(f.id); this.calls.delete(f.id); c?.(f); return; }
    if (f.kind === 'changed') { this.changed = f.rev; return; }
    if (f.kind !== 'coop') return;
    const m = decodeServer(f.frame);
    if (!m) return;
    this.msgs.push(m);
    if (m.t === 'welcome') this.welcome = m;
    if (m.t === 'lobby') this.lobby = m.lobby;
    if (m.t === 'snap') this.snap = m.s;
    if (m.t === 'ev') this.events.push(...m.e);
    if (m.t === 'runStart') this.run = m.run;
    if (m.t === 'runEnd') this.end = m;
    if (m.t === 'actResult' && typeof m.id === 'number') { const r = this.acts.get(m.id); this.acts.delete(m.id); if (typeof r === 'function') r(m); }
    for (const w of [...this.waiters]) if (w.fn(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); }
  }

  /** Sync call with this bot's own device log (entries: [{ op } | { run }]); returns the server answer. */
  sync(bodies = []) {
    const entries = bodies.map((body) => ({ seq: ++this.logSeq, at: Date.now(), body }));
    const id = this.callId++;
    return new Promise((res, rej) => {
      this.calls.set(id, (f) => (!f ? rej(new Error('closed')) : f.error ? rej(new Error(f.error.msg)) : res(f.sync)));
      this.ws.send(sessionSync(id, this.device, entries));
      setTimeout(() => { if (this.calls.delete(id)) rej(new Error(`${this.name}: sync timeout`)); }, 15000);
    });
  }

  /** The account's current profile document (from the server). */
  async pull() {
    this.profile = (await this.sync()).doc;
    return this.profile;
  }

  send(m) { this.ws.send(sessionCoop(encodeClient(m))); }
  /** A raw co-op frame (malformed-input tests). */
  sendRaw(bytes) { this.ws.send(sessionCoop(bytes)); }
  wait(fn, ms = 20000) {
    for (const m of this.msgs) if (fn(m)) return Promise.resolve(m);
    return this.waitNew(fn, ms);
  }
  waitNew(fn, ms = 20000) {
    return new Promise((res, rej) => { const w = { fn, res }; this.waiters.push(w); setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); rej(new Error(`${this.name}: timeout (last: ${this.msgs.slice(-4).map((m) => m.t + (m.t === 'error' ? ':' + m.msg : m.t === 'lobby' ? ':' + (m.lobby?.code ?? 'none') : '')).join(', ')})`)); } }, ms); });
  }
  act(a) { const id = this.actId++; return new Promise((res) => { this.acts.set(id, res); this.send({ t: 'act', id, ...a }); setTimeout(() => { if (this.acts.delete(id)) res({ ok: false, reason: 'timeout' }); }, 5000); }); }
  input(p, extra = {}) { this.send({ t: 'input', seq: ++this.seq, p, yaw: 0, pitch: 0, sp: 0, fl: 0, heat: 0, ...extra }); }
  me() { return this.snap?.a.find((a) => a[0] === this.welcome.playerId); }
  close() { this.ws.close(); }
  /** Drop the connection without a close handshake (a lost network). */
  terminate() { this.ws.terminate(); }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
