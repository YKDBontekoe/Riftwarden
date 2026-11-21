// Riftwarden worker (internal; only the gateway connects). Role `rules`: profile replays.
//   RIFT_WORKER_LISTEN=127.0.0.1:7101 node --import tsx apps/worker/src/main.ts
import { createServer } from 'node:net';
import { FrameReader, frame } from './frames';
import { handle } from './rules';

const listen = process.env.RIFT_WORKER_LISTEN ?? '127.0.0.1:7101';
const [host, port] = listen.includes(':') ? [listen.slice(0, listen.lastIndexOf(':')), Number(listen.slice(listen.lastIndexOf(':') + 1))] : ['127.0.0.1', Number(listen)];
const log = (m: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), service: 'riftwarden-worker', msg: m, ...extra }));

const server = createServer((sock) => {
  const reader = new FrameReader();
  sock.setNoDelay(true);
  sock.on('data', (chunk) => {
    let frames: Uint8Array[];
    try {
      frames = reader.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    } catch (e) {
      log('bad frame, closing', { error: (e as Error).message });
      return sock.destroy();
    }
    for (const f of frames) {
      const started = performance.now();
      const out = handle(f);
      sock.write(frame(out));
      const ms = performance.now() - started;
      if (ms > 200) log('slow call', { ms: Math.round(ms) });
    }
  });
  sock.on('error', () => sock.destroy());
});

server.listen(port, host, () => log('worker ready', { role: 'rules', listen }));
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => server.close(() => process.exit(0)));
