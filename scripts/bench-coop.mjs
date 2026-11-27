// Headless co-op benchmark: the real authoritative ServerGame (NullEngine + Havok, as the sim worker runs it) in a
// late-game fight, measuring tick cost and the encoded size of what the server sends.
//
//   node --import tsx scripts/bench-coop.mjs [players=2] [enemies=120] [seconds=30]
//
// Prints tick time percentiles (60 Hz fixed steps), snapshot bytes per player (20 Hz) and event bytes per second.
// No network, database or browser needed. Results go in docs/testing/performance.md.
import '../apps/worker/src/sim/headless.ts';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { loadHavok } from '../apps/worker/src/sim/coopSim.ts';
import { ServerGame } from '@riftwarden/game/net/ServerGame';
import { encodeServer } from '@riftwarden/protocol/codec';
import { SIM_HZ, SNAP_HZ } from '@riftwarden/protocol/protocol';
import { RunLedger } from '@riftwarden/rules/progression/run';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { starterWeapon } from '@riftwarden/rules/loot/generate';
import { generateArena } from '@riftwarden/rules/world/arenaGen';

const PLAYERS = Number(process.argv[2] ?? 2);
const ENEMIES = Number(process.argv[3] ?? 120);
const SECONDS = Number(process.argv[4] ?? 30);

let seed = 12345;
Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

const havok = await loadHavok();
const engine = new NullEngine();
const tier = getTier(3);
const runId = 'run_bench';
const players = Array.from({ length: PLAYERS }, (_, i) => ({ id: `p${i}`, name: `P${i}`, slot: i, loadout: { weapon: starterWeapon(`it_bench${i}`, 0) }, ledger: new RunLedger(runId, tier.id, Date.now()) }));
const hooks = { bank: async () => true, defeat() {}, extract() {} };
const t0 = performance.now();
const game = new ServerGame(engine, havok, players, { tier, runId, seed: 777, layout: generateArena(4242), towerTech: [], milestones: [], mode: 'defense' }, hooks);
const buildMs = performance.now() - t0;

const KINDS = ['walker', 'enforcer', 'artillery', 'engineer', 'rusher', 'bulwark'];
const GATES = ['north', 'east', 'west', 'south'];
const MODS = [['overcharged'], ['armored', 'volatile'], [], []];
game.within(() => {
  game.dev.jump(30);
  game.startWave();
});
const step = 1 / SIM_HZ;
for (let i = 0; i < 30; i++) game.tick(step);
let spawned = 0;
const topUp = () => game.within(() => {
  for (let k = 0; k < 4 && game.enemies.count < ENEMIES; k++, spawned++) game.dev.spawn(KINDS[spawned % KINDS.length], MODS[spawned % MODS.length], GATES[spawned % 4]);
});
for (let i = 0; i < ENEMIES; i++) topUp();
for (let i = 0; i < 120; i++) game.tick(step);
game.rec.take();

const ticks = [];
const snapBytes = [];
let eventBytes = 0;
let maxEnemies = 0;
const steps = SECONDS * SIM_HZ;
const every = Math.round(SIM_HZ / SNAP_HZ);
for (let i = 0; i < steps; i++) {
  topUp();
  game.reactorHp = 1000;
  const a = performance.now();
  game.tick(step);
  ticks.push(performance.now() - a);
  maxEnemies = Math.max(maxEnemies, game.enemies.count);
  const evs = game.rec.take();
  if (evs.length) eventBytes += encodeServer({ t: 'ev', e: evs.map((x) => x.e) }).length;
  if (i % every === 0) {
    const shared = game.netSnapshot();
    for (const av of game.avatars) snapBytes.push(encodeServer({ t: 'snap', s: { ...shared, me: game.personal(av) } }).length);
  }
}
const pct = (l, q) => [...l].sort((x, y) => x - y)[Math.min(l.length - 1, Math.floor(l.length * q))];
const r = (x) => +x.toFixed(2);
const out = {
  players: PLAYERS,
  enemies: ENEMIES,
  maxEnemies,
  buildMs: Math.round(buildMs),
  tick: { avg: r(ticks.reduce((x, y) => x + y, 0) / ticks.length), p50: r(pct(ticks, 0.5)), p95: r(pct(ticks, 0.95)), p99: r(pct(ticks, 0.99)), max: r(pct(ticks, 1)) },
  snapshotBytes: { avg: Math.round(snapBytes.reduce((x, y) => x + y, 0) / snapBytes.length), max: pct(snapBytes, 1) },
  perPlayerKBps: r(((snapBytes.reduce((x, y) => x + y, 0) / PLAYERS + eventBytes) / SECONDS) / 1024),
  eventKBps: r(eventBytes / SECONDS / 1024),
  heapMB: Math.round(process.memoryUsage().heapUsed / 1048576),
};
console.log(JSON.stringify(out));
process.exit(0);
