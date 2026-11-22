// Run a command against a full local stack: gateway on :8090 (where the Vite dev server proxies /auth, /session
// and /war) with rules + sim workers on a fresh database, plus the Vite dev server on :5173 unless one is running.
// The command gets RIFT_GATEWAY_DATABASE_URL (the stack's database). Used by CI for the browser suites:
//   node --import tsx scripts/with-stack.mjs node scripts/e2e-accounts.cjs
import { spawn } from 'node:child_process';
import { startStack } from './lib/stack.mjs';

// --vite-only: just the dev server (for suites that start their own stack).
const viteOnly = process.argv[2] === '--vite-only';
const cmd = process.argv.slice(viteOnly ? 3 : 2);
if (!cmd.length) throw new Error('usage: with-stack.mjs [--vite-only] <command...>');
const stack = viteOnly ? null : await startStack({ port: 8090 });
const up = () => fetch('http://localhost:5173/').then((r) => r.ok, () => false);
let vite = null;
if (!(await up())) {
  vite = spawn('pnpm', ['--filter', '@riftwarden/client', 'dev'], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 120 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
}
const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env: { ...process.env, ...(stack ? { RIFT_GATEWAY_DATABASE_URL: stack.dbUrl } : {}) } });
const code = await new Promise((r) => child.on('exit', (c) => r(c ?? 1)));
if (code && stack) console.log(stack.log(40));
if (vite) process.kill(-vite.pid);
await stack?.stop();
process.exit(code);
