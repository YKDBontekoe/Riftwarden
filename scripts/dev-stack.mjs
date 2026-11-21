// Development backend: gateway on :8090 (Vite proxies /auth, /session and /war to it) with a rules worker and a sim
// worker, on your own database (kept between runs). Ctrl+C stops everything.
//   DATABASE_URL=postgres://... REDIS_URL=redis://... node --import tsx scripts/dev-stack.mjs
// RIFT_TEST=1 behaviour (test login, relaxed limits) is on, as on any local stack.
import { startStack } from './lib/stack.mjs';

const db = process.env.DATABASE_URL;
if (!db) throw new Error('Set DATABASE_URL (PostgreSQL) and REDIS_URL (Redis)');
process.env.RIFT_TEST_REDIS_URL ??= process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const stack = await startStack({ port: 8090, databaseUrl: db, gatewayEnv: { RIFT_WAR_GAP_S: '45' } });
console.log('Riftwarden backend: gateway http://localhost:8090 (health: /health), rules :8091, sim :8092. Run `pnpm dev` for the client.');
const stop = async () => {
  await stack.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
setInterval(() => {
  for (const c of [stack.gateway, stack.rules, stack.sim]) if (c.exitCode !== null) {
    console.log(`${c.label} exited:\n${stack.log(30)}`);
    void stop();
  }
}, 2000);
