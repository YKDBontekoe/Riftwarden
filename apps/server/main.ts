import './headless';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_PORT, MAX_MESSAGE_BYTES, normalizeCode, parseClientMsg, PROTOCOL_VERSION, RateLimiter, type ClientMsg, type ServerMsg } from '@riftwarden/game/net/protocol';
import { playerIdFor, ProfileStore } from './profiles';
import { type Peer, Room } from './room';
import { CoopSim, loadHavok } from './sim';
import { WarService } from './war';

/**
 * Riftwarden co-op server.
 *
 *   npm run server                     (ws://localhost:8787/ws)
 *   Configure PostgreSQL with DATABASE_URL or the standard PG* variables.
 *
 * Also serves the production build (dist/) on the same port, so `npm run build && npm run server`
 * is a complete deployment: open http://host:8787 and the client connects to /ws on the same origin.
 */
const PORT = Number(process.env.RIFT_PORT ?? DEFAULT_PORT);
const DIST = resolve(process.env.RIFT_DIST ?? 'dist');
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const store = new ProfileStore(log);
await store.migrate();
const havok = await loadHavok();
const rooms = new Map<string, Room>();
const online = new Map<string, Peer>();
// The shared Rift War: every connected warden counts toward the population; solo clients report over HTTP.
const war = await WarService.create(store, () => online.size, log);
const messages = new Set<Promise<void>>();
let shuttingDown = false;

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

async function serveHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  const path0 = (req.url ?? '/').split('?')[0];
  if (path0 === '/war' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(war.snapshot());
    return;
  }
  if (path0 === '/war/report' && req.method === 'POST') return warReport(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (pathname.includes('\0')) throw new URIError('Invalid pathname');
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, v: PROTOCOL_VERSION, rooms: rooms.size, players: online.size }));
    return;
  }

  const file = resolve(DIST, `.${pathname === '/' ? '/index.html' : pathname}`);
  const root = DIST.endsWith(sep) ? DIST : DIST + sep;
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }

  const info = await stat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  });
  if (!info?.isFile()) {
    res.writeHead(404).end();
    return;
  }
  const cache = file.startsWith(join(DIST, 'assets') + sep) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': file === join(DIST, 'build.txt') ? 'no-store' : cache,
  });
  if (req.method === 'HEAD') res.end();
  else await pipeline(createReadStream(file), res);
}

/** Solo clients report a secured sector: {node, mode, id}. Small JSON body, rate limited per address + identity. */
async function warReport(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2048) {
      res.writeHead(413).end();
      return;
    }
  }
  let msg: { node?: unknown; mode?: unknown; id?: unknown };
  try {
    msg = JSON.parse(body) as typeof msg;
  } catch {
    res.writeHead(400).end();
    return;
  }
  const who = `${req.socket.remoteAddress ?? '?'}|${typeof msg.id === 'string' ? msg.id.slice(0, 64) : ''}`;
  const r = war.report({ node: String(msg.node ?? ''), mode: msg.mode === 'survival' ? 'survival' : 'defense', players: 1 }, who);
  res.writeHead(r.ok ? 200 : 429, { 'content-type': 'application/json' });
  res.end(JSON.stringify(r));
}

const http = createServer((req, res) => {
  void serveHttp(req, res).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE') log(`HTTP error: ${error.message}`);
    if (!res.headersSent) res.writeHead(500).end();
  });
});
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });
const awaitingPong = new Set<WebSocket>();
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.readyState !== ws.OPEN) continue;
    if (awaitingPong.has(ws)) ws.terminate();
    else {
      awaitingPong.add(ws);
      ws.ping();
    }
  }
}, 30_000);

function deps() {
  return {
    store,
    log,
    createSim: (room: Room) => CoopSim.create(room, store, havok, log, war),
  };
}

wss.on('connection', (ws: WebSocket) => {
  let peer: Peer | null = null;
  let processing = Promise.resolve();
  const limiter = new RateLimiter(90, 180);
  let strikes = 0;
  const send = (msg: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const fail = (code: string, msg: string) => send({ t: 'error', code, msg });

  ws.on('pong', () => awaitingPong.delete(ws));
  ws.on('error', (error) => log(`WebSocket error: ${error.message}`));
  ws.on('message', (buf, isBinary) => {
    if (shuttingDown) return;
    if (isBinary) return ws.close(1003, 'binary not supported');
    if (!limiter.take()) {
      if (++strikes > 50) ws.close(1008, 'rate limit');
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(buf.toString());
    } catch {
      return fail('malformed', 'Unreadable message');
    }
    const msg = parseClientMsg(raw);
    if (!msg) {
      if (++strikes > 50) ws.close(1008, 'malformed traffic');
      return fail('malformed', 'Invalid message');
    }
    if (msg.t === 'ping') return send({ t: 'pong', c: msg.c, s: Date.now() });
    const job = processing.then(async () => {
      if (ws.readyState === ws.OPEN) await handle(msg);
    }).catch((e: Error) => {
      log(`handler error (${msg.t}): ${e.stack}`);
      fail('server', 'Server error');
    });
    processing = job;
    messages.add(job);
    void job.then(() => messages.delete(job));
  });

  async function handle(msg: ClientMsg): Promise<void> {
    if (msg.t === 'hello') {
      if (peer) return fail('hello', 'Already connected');
      if (msg.v !== PROTOCOL_VERSION) {
        fail('version', `Protocol mismatch: server v${PROTOCOL_VERSION}, client v${msg.v}. Reload the page.`);
        return void ws.close(1008, 'version');
      }
      const id = playerIdFor(msg.secret);
      const prof = await store.load(id);
      if (ws.readyState !== ws.OPEN) return;
      const prev = online.get(id);
      if (prev) prev.send({ t: 'error', code: 'replaced', msg: 'Signed in from another window' });
      const name = msg.name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 18) || 'Warden';
      peer = { id, name, send, profile: prof, room: prev?.room ?? null, presence: null, visiting: false };
      online.set(id, peer);
      send({ t: 'welcome', v: PROTOCOL_VERSION, playerId: id, name, hasProfile: !!prof, profile: prof?.data ?? null });
      // Reconnect into a session (and a running operation) this identity still belongs to.
      for (const r of rooms.values()) {
        if (r.members.has(id)) {
          r.add(peer);
          r.broadcastLobby();
          r.sim?.playerReconnected(id, peer);
          break;
        }
      }
      return;
    }
    if (!peer) return fail('hello', 'Say hello first');
    const me = peer;
    if (online.get(me.id) !== me) return fail('replaced', 'Signed in from another window');
    if (msg.t === 'profileInit') {
      if (me.profile) return fail('profile', 'Online profile already exists');
      const p = await store.create(me.id, me.name);
      if (!p) return fail('profile', 'Could not create the online profile');
      me.profile = p;
      log(`profile ${me.id.slice(0, 6)} initialized`);
      return send({ t: 'profile', save: p.data });
    }
    if (!me.profile) return fail('profile', 'Create an online profile first');
    if (me.room?.state === 'deploying' && (msg.t === 'leave' || msg.t === 'create' || msg.t === 'join')) {
      return fail('deploying', 'Wait for the operation to finish deploying');
    }
    switch (msg.t) {
      case 'op': {
        const r = await store.op(me.profile, msg.name, msg.args, msg.tx);
        send({ t: 'opResult', tx: msg.tx, ok: r.ok, reason: r.ok ? undefined : (r as { reason: string }).reason });
        send({ t: 'profile', save: me.profile.data });
        if (r.ok && me.room && me.room.hostId === me.id && msg.name.startsWith('hq')) me.room.broadcast({ t: 'hostHq', owner: me.id, base: me.profile.data.base });
        if (r.ok && me.room) me.room.broadcastLobby();
        return;
      }
      case 'create': {
        if (me.room) me.room.leave(me.id);
        const code = Room.newCode((c) => rooms.has(c));
        const room = new Room(code, me, msg.tier, deps());
        rooms.set(code, room);
        log(`room ${code} created by ${me.name}`);
        return room.broadcastLobby();
      }
      case 'join': {
        const room = rooms.get(normalizeCode(msg.code));
        if (!room) return fail('join', 'No session with that code');
        if (me.room && me.room !== room) me.room.leave(me.id);
        const why = room.add(me);
        if (why) return fail('join', why);
        log(`room ${room.code}: ${me.name} joined`);
        return room.broadcastLobby();
      }
      case 'leave':
        if (me.room) {
          const r = me.room;
          r.leave(me.id);
          me.room = null;
          send({ t: 'lobby', lobby: null });
        }
        return;
      case 'ready':
        return me.room?.setReady(me.id, msg.ready);
      case 'tier': {
        const why = me.room?.setTier(me.id, msg.tier);
        if (why) fail('tier', why);
        return;
      }
      case 'mode': {
        const why = me.room?.setMode(me.id, msg.mode);
        if (why) fail('mode', why);
        return;
      }
      case 'node': {
        const why = me.room?.setNode(me.id, msg.node);
        if (why) fail('node', why);
        return;
      }
      case 'start': {
        if (!me.room) return fail('start', 'Not in a session');
        const why = await me.room.start(me.id);
        if (why) fail('start', why);
        return;
      }
      case 'presence':
        me.presence = { p: msg.p, yaw: msg.yaw };
        return;
      case 'visit':
        me.visiting = msg.on;
        if (msg.on && me.room) {
          const host = store.get(me.room.hostId);
          if (host) send({ t: 'hostHq', owner: me.room.hostId, base: host.data.base });
        }
        return;
      case 'input':
      case 'act':
        me.room?.sim?.onMessage(me.id, msg);
        return;
    }
  }

  ws.on('close', () => {
    awaitingPong.delete(ws);
    if (!peer || online.get(peer.id) !== peer) return;
    online.delete(peer.id);
    if (peer.room) peer.room.disconnected(peer.id);
  });
});

// Housekeeping: reconnect windows, empty rooms, lobby presence (10 Hz).
const warTimer = setInterval(() => war.tick(), 30_000);
const housekeeping = setInterval(() => {
  for (const [code, r] of rooms) {
    r.tick();
    if (r.empty) {
      rooms.delete(code);
      log(`room ${code} closed`);
    }
  }
}, 1000);
const presence = setInterval(() => {
  for (const r of rooms.values()) {
    if (r.state !== 'lobby') continue;
    const players = r.connected.filter((m) => m.peer?.presence && (m.peer.visiting || m.id === r.hostId)).map((m) => ({ id: m.id, name: m.name, p: m.peer!.presence!.p, yaw: m.peer!.presence!.yaw }));
    for (const m of r.connected) m.peer!.send({ t: 'presence', players: players.filter((x) => x.id !== m.id) });
  }
}, 100);

async function shutdown(sig: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${sig}: closing ${rooms.size} sessions`);
  clearInterval(heartbeat);
  clearInterval(housekeeping);
  clearInterval(warTimer);
  await war.flush();
  clearInterval(presence);
  http.close();
  await Promise.allSettled(messages);
  const endings = [...rooms.values()].map((r) => r.sim?.shutdown()).filter((ending) => ending !== undefined);
  await Promise.allSettled(endings);
  for (const p of online.values()) p.send({ t: 'error', code: 'shutdown', msg: 'The server is shutting down' });
  for (const ws of wss.clients) ws.close(1012, 'Server restarting');
  wss.close();
  const close = setTimeout(() => { for (const ws of wss.clients) ws.terminate(); }, 1000);
  close.unref();
  await store.close();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

http.listen(PORT, () => log(`Riftwarden co-op server v${PROTOCOL_VERSION} on :${PORT} (ws path /ws, PostgreSQL profiles)`));
