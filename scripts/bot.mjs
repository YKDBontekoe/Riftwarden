// Protocol bot for co-op tests (no rendering). Usage: import { Bot } from './bot.mjs'
import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';

export class Bot {
  constructor(name, url = process.env.RIFT_WS ?? 'ws://localhost:8787/ws', secret = randomBytes(16).toString('hex')) {
    this.name = name; this.url = url; this.secret = secret;
    this.msgs = []; this.events = []; this.snap = null; this.lobby = null; this.seq = 0; this.actId = 1; this.acts = new Map();
    this.waiters = [];
  }
  connect(v = 7) {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => { this.send({ t: 'hello', v, secret: this.secret, name: this.name }); });
      this.ws.on('message', (b) => {
        const m = JSON.parse(b.toString());
        this.msgs.push(m);
        if (m.t === 'welcome') { this.welcome = m; res(m); }
        if (m.t === 'error' && !this.welcome) res(m);
        if (m.t === 'lobby') this.lobby = m.lobby;
        if (m.t === 'snap') this.snap = m.s;
        if (m.t === 'ev') this.events.push(...m.e);
        if (m.t === 'profile') this.profile = m.save;
        if (m.t === 'runStart') this.run = m.run;
        if (m.t === 'runEnd') this.end = m;
        if (m.t === 'actResult' && typeof m.id === 'number') { const r = this.acts.get(m.id); this.acts.delete(m.id); if (typeof r === 'function') r(m); }
        for (const w of [...this.waiters]) if (w.fn(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); }
      });
      this.ws.on('error', rej);
      this.ws.on('close', () => { this.closed = true; });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(fn, ms = 20000) {
    for (const m of this.msgs) if (fn(m)) return Promise.resolve(m);
    return new Promise((res, rej) => { const w = { fn, res }; this.waiters.push(w); setTimeout(() => rej(new Error(`${this.name}: timeout`)), ms); });
  }
  waitNew(fn, ms = 20000) {
    return new Promise((res, rej) => { const w = { fn, res }; this.waiters.push(w); setTimeout(() => rej(new Error(`${this.name}: timeout`)), ms); });
  }
  act(a) { const id = this.actId++; return new Promise((res) => { this.acts.set(id, res); this.send({ t: 'act', id, ...a }); setTimeout(() => { if (this.acts.delete(id)) res({ ok: false, reason: 'timeout' }); }, 5000); }); }
  input(p, extra = {}) { this.send({ t: 'input', seq: ++this.seq, p, yaw: 0, pitch: 0, sp: 0, fl: 0, heat: 0, ...extra }); }
  me() { return this.snap?.a.find((a) => a[0] === this.welcome.playerId); }
  close() { this.ws.close(); }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
