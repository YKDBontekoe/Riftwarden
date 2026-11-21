// Test stack for the protocol suites: a fresh PostgreSQL database, a rules worker, a sim worker and the Rust
// gateway (built with cargo if needed). Needs RIFT_TEST_DATABASE_URL (a role that may create databases) and
// RIFT_TEST_REDIS_URL. Usage:
//   const stack = await startStack({ port: 8799, simEnv: { RIFT_MAP: '1' } });
//   ... new Bot('Alpha', stack) ...; await stack.restartSim('SIGKILL'); await stack.stop();
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import pg from 'pg';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function proc(name, cmd, args, env) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.log = '';
  const keep = (d) => {
    child.log += d;
    if (child.log.length > 400_000) child.log = child.log.slice(-200_000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.label = name;
  return child;
}

async function stop(child, sig = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = new Promise((r) => child.once('exit', r));
  child.kill(sig);
  await Promise.race([done, sleep(5000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await fn()) return;
    } catch {
      /* not yet */
    }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}

export async function startStack({ port = 8799, simEnv = {}, gatewayEnv = {} } = {}) {
  if (!process.env.RIFT_TEST_DATABASE_URL) throw new Error('Set RIFT_TEST_DATABASE_URL to a PostgreSQL test database');
  if (!process.env.RIFT_TEST_REDIS_URL) throw new Error('Set RIFT_TEST_REDIS_URL to a Redis test instance');
  // A leftover stack (a crashed suite) would answer our health checks with its own database: refuse.
  const busy = await fetch(`http://127.0.0.1:${port}/health`).then(() => true, () => false);
  if (busy) throw new Error(`port ${port} is already serving (a stack left over from an earlier run?)`);
  const admin = new pg.Pool({ connectionString: process.env.RIFT_TEST_DATABASE_URL, max: 1 });
  const name = `rift_e2e_${randomBytes(6).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const dbUrl = new URL(process.env.RIFT_TEST_DATABASE_URL);
  dbUrl.pathname = `/${name}`;

  const bin = process.env.RIFT_GATEWAY_BIN ?? 'target/debug/riftwarden-gateway';
  if (!process.env.RIFT_GATEWAY_BIN) execFileSync('cargo', ['build', '-q', '-p', 'riftwarden-gateway'], { stdio: 'inherit' });
  if (!existsSync(bin)) throw new Error(`gateway binary missing: ${bin}`);

  const rulesAddr = `127.0.0.1:${port + 1}`;
  const simAddr = `127.0.0.1:${port + 2}`;
  const worker = (role, listen, env = {}) => proc(role, process.execPath, ['--import', 'tsx', 'apps/worker/src/main.ts'], { RIFT_WORKER_ROLE: role, RIFT_WORKER_LISTEN: listen, RIFT_TEST: '1', ...env });
  const s = {
    url: `http://127.0.0.1:${port}`,
    ws: `ws://127.0.0.1:${port}/session`,
    db: new pg.Pool({ connectionString: dbUrl.href }),
    rules: worker('rules', rulesAddr),
    sim: worker('sim', simAddr, simEnv),
    gateway: null,
    async health() {
      const r = await fetch(`${s.url}/health`);
      return r.json();
    },
    /** Kill (or stop) the sim worker and start a new one; resolves once the gateway has it again. */
    async restartSim(sig = 'SIGTERM') {
      await stop(s.sim, sig);
      await waitFor(async () => (await s.health()).sims === 0, 15000, 'the gateway to notice the sim worker');
      s.sim = worker('sim', simAddr, simEnv);
      await waitFor(async () => (await s.health()).sims === 1, 40000, 'the sim worker');
    },
    log(n = 40) {
      return [s.gateway, s.sim, s.rules].map((c) => `--- ${c?.label} ---\n${(c?.log ?? '').split('\n').slice(-n).join('\n')}`).join('\n');
    },
    async stop() {
      await Promise.all([stop(s.gateway), stop(s.sim), stop(s.rules)]);
      await s.db.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
      await admin.end();
    },
  };
  // Never leave the stack behind when the suite dies.
  process.once('exit', () => {
    for (const c of [s.gateway, s.sim, s.rules]) if (c && c.exitCode === null) c.kill('SIGKILL');
  });
  s.gateway = proc('gateway', bin, [], {
    RIFT_LISTEN: `127.0.0.1:${port}`,
    RIFT_ADMIN_LISTEN: `127.0.0.1:${port + 3}`,
    RIFT_TEST: '1',
    RIFT_COOKIE_SECURE: '0',
    RIFT_WAR_GAP_S: '0',
    RIFT_LOG_FORMAT: 'pretty',
    RIFT_RULES_WORKERS: rulesAddr,
    RIFT_SIM_WORKERS: simAddr,
    DATABASE_URL: dbUrl.href,
    REDIS_URL: process.env.RIFT_TEST_REDIS_URL,
    ...gatewayEnv,
  });
  try {
    await waitFor(async () => {
      const h = await s.health();
      return h.ok && h.sims === 1;
    }, 60000, 'the gateway and its sim worker');
  } catch (e) {
    console.log(s.log());
    await s.stop();
    throw e;
  }
  return s;
}

/** A profile document straight from the gateway's database. */
export async function profileDoc(stack, account) {
  const { rows } = await stack.db.query('SELECT doc FROM profiles WHERE account_id = $1', [account]);
  return rows[0]?.doc ?? null;
}
