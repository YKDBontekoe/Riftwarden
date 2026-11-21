// Riftwarden worker (internal; only the gateway connects). Roles:
//   rules (default): profile replays and war steps, request/response
//   sim:             co-op lobbies and operations, a bidirectional stream with the gateway
//   RIFT_WORKER_ROLE=sim RIFT_WORKER_LISTEN=127.0.0.1:7201 node --import tsx apps/worker/src/main.ts
import { createServer, type Socket } from 'node:net';
import { FrameReader, frame } from './frames';

const role = process.env.RIFT_WORKER_ROLE ?? 'rules';
const listen = process.env.RIFT_WORKER_LISTEN ?? (role === 'sim' ? '127.0.0.1:7201' : '127.0.0.1:7101');
const [host, port] = listen.includes(':') ? [listen.slice(0, listen.lastIndexOf(':')), Number(listen.slice(listen.lastIndexOf(':') + 1))] : ['127.0.0.1', Number(listen)];
const log = (m: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), service: `riftwarden-worker-${role}`, msg: m, ...extra }));

function serve(onSocket: (sock: Socket, onFrame: (f: Uint8Array) => void) => void, onFrameFor: (sock: Socket) => (f: Uint8Array) => void) {
  const server = createServer((sock) => {
    const reader = new FrameReader();
    sock.setNoDelay(true);
    const onFrame = onFrameFor(sock);
    onSocket(sock, onFrame);
    sock.on('data', (chunk) => {
      let frames: Uint8Array[];
      try {
        frames = reader.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      } catch (e) {
        log('bad frame, closing', { error: (e as Error).message });
        return sock.destroy();
      }
      for (const f of frames) onFrame(f);
    });
    sock.on('error', () => sock.destroy());
  });
  server.listen(port, host, () => log('worker ready', { role, listen }));
  return server;
}

if (role === 'sim') {
  const { SimHost } = await import('./sim/host');
  let gateway: Socket | null = null;
  const simLog = (m: string) => log(m);
  const hostSim = new SimHost((up) => {
    if (gateway && !gateway.destroyed) gateway.write(frame(up));
  }, simLog);
  await hostSim.start();
  const capacity = Number(process.env.RIFT_SIM_CAPACITY ?? 6);
  // One gateway at a time; a new connection (gateway restart) takes over and the rooms keep running.
  const server = serve(
    (sock) => {
      gateway = sock;
      hostSim.hello(process.env.RIFT_BUILD ?? 'dev', capacity);
      sock.on('close', () => {
        if (gateway === sock) gateway = null;
      });
    },
    () => (f) => void hostSim.onDown(f),
  );
  const stop = async () => {
    await hostSim.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
} else {
  const { handle } = await import('./rules');
  const server = serve(
    () => {},
    (sock) => (f) => {
      const started = performance.now();
      sock.write(frame(handle(f)));
      const ms = performance.now() - started;
      if (ms > 200) log('slow call', { ms: Math.round(ms) });
    },
  );
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => server.close(() => process.exit(0)));
}
