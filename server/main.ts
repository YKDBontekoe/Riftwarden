import './headless';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { accessSync, constants, createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_PORT, MAX_MESSAGE_BYTES, normalizeCode, parseClientMsg, PROTOCOL_VERSION, RateLimiter, type ClientMsg, type ServerMsg } from '../src/net/protocol';
import { playerIdFor, ProfileStore } from './profiles';
import { type Peer, Room } from './room';
import { CoopSim, loadHavok } from './sim';

/**
 * Riftwarden co-op server.
 *
 *   npm run server                     (ws://localhost:8787/ws, profiles in ./server-data)
 *   RIFT_PORT=9000 RIFT_DATA=/srv/rift npm run server
 *
 * Also serves the production build (dist/) on the same port, so `npm run build && npm run server`
 * is a complete deployment: open http://host:8787 and the client connects to /ws on the same origin.
 */
const PORT = Number(process.env.RIFT_PORT ?? DEFAULT_PORT);
const DATA = resolve(process.env.RIFT_DATA ?? 'server-data');
const DIST = resolve(process.env.RIFT_DIST ?? 'dist');
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const profiles = join(DATA, 'profiles');
const store = new ProfileStore(profiles);
accessSync(profiles, constants.W_OK);
const havok = await loadHavok();
const rooms = new Map<string, Room>();
const online = new Map<string, Peer>();

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

async function serveHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
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
    createSim: async (room: Room) => new CoopSim(room, store, havok, log),
  };
}

wss.on('connection', (ws: WebSocket) => {
  let peer: Peer | null = null;
  const limiter = new RateLimiter(90, 180);
  let strikes = 0;
  const send = (msg: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const fail = (code: string, msg: string) => send({ t: 'error', code, msg });

  ws.on('pong', () => awaitingPong.delete(ws));
  ws.on('error', (error) => log(`WebSocket error: ${error.message}`));
  ws.on('message', (buf, isBinary) => {
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
    void handle(msg).catch((e: Error) => {
      log(`handler error (${msg.t}): ${e.stack}`);
      fail('server', 'Server error');
    });
  });

  async function handle(msg: ClientMsg): Promise<void> {
    if (msg.t === 'ping') return send({ t: 'pong', c: msg.c, s: Date.now() });
    if (msg.t === 'hello') {
      if (msg.v !== PROTOCOL_VERSION) {
        fail('version', `Protocol mismatch: server v${PROTOCOL_VERSION}, client v${msg.v}. Reload the page.`);
        return void ws.close(1008, 'version');
      }
      const id = playerIdFor(msg.secret);
      const prev = online.get(id);
      if (prev) prev.send({ t: 'error', code: 'replaced', msg: 'Signed in from another window' });
      const name = msg.name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 18) || 'Warden';
      const prof = store.get(id);
      peer = { id, name, send, profile: prof!, room: prev?.room ?? null, presence: null, visiting: false };
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
    if (msg.t === 'profileInit') {
      if (me.profile) return fail('profile', 'Online profile already exists');
      const p = store.create(me.id, msg.mode, msg.save, me.name);
      if (!p) return fail('profile', 'Could not create the online profile');
      me.profile = p;
      log(`profile ${me.id.slice(0, 6)} created (${msg.mode})`);
      return send({ t: 'profile', save: p.data });
    }
    if (!me.profile) return fail('profile', 'Create an online profile first');
    switch (msg.t) {
      case 'op': {
        const r = store.op(me.profile, msg.name, msg.args, msg.tx);
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
    if (!peer) return;
    if (online.get(peer.id) === peer) online.delete(peer.id);
    if (peer.room) peer.room.disconnected(peer.id);
  });
});

// Housekeeping: reconnect windows, empty rooms, lobby presence (10 Hz).
setInterval(() => {
  for (const [code, r] of rooms) {
    r.tick();
    if (r.empty) {
      r.sim?.shutdown('empty');
      rooms.delete(code);
      log(`room ${code} closed`);
    }
  }
}, 1000);
setInterval(() => {
  for (const r of rooms.values()) {
    if (r.state !== 'lobby') continue;
    const players = r.connected.filter((m) => m.peer?.presence && (m.peer.visiting || m.id === r.hostId)).map((m) => ({ id: m.id, name: m.name, p: m.peer!.presence!.p, yaw: m.peer!.presence!.yaw }));
    for (const m of r.connected) m.peer!.send({ t: 'presence', players: players.filter((x) => x.id !== m.id) });
  }
}, 100);

function shutdown(sig: string): void {
  log(`${sig}: closing ${rooms.size} sessions`);
  clearInterval(heartbeat);
  for (const r of rooms.values()) r.sim?.shutdown('server');
  for (const p of online.values()) p.send({ t: 'error', code: 'shutdown', msg: 'The server is shutting down' });
  for (const ws of wss.clients) ws.close(1012, 'Server restarting');
  wss.close();
  http.close();
  setTimeout(() => process.exit(0), 200);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

http.listen(PORT, () => log(`Riftwarden co-op server v${PROTOCOL_VERSION} on :${PORT} (ws path /ws, data ${DATA})`));
