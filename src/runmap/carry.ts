import { BLESSING_IDS, BLESSINGS, type BlessingId, CURSE_IDS, CURSES, type CurseId, FORGE, FORGE_IDS, type ForgeId, MAX_CURSES, type NodeEffect, type StatMod } from './defs';

/**
 * What crosses from one node to the next (pure). Towers never do: the next node is a new arena, so
 * they are refunded into cores. Equipment, cargo and the ledger are carried by reference in a live
 * run; this record is what a resumed run (or the co-op server's next ServerGame) is rebuilt from.
 */
export interface RunCarry {
  /** Last cleared wave (the next combat node starts at wave + 1). */
  wave: number;
  cores: number;
  reactorHp: number;
  /** Ultimate charge 0..1. */
  ult: number;
  build: { stacks: [string, number][]; picks: { id: string; wave: number }[]; offers: number };
  /** Run loadout (item uids per slot). */
  loadout: Record<string, string | null>;
  curses: CurseId[];
  blessings: BlessingId[];
  /** Forge tempering stacks (run-only stat buffs). */
  forge: Partial<Record<ForgeId, number>>;
  /** Tower blueprints unlocked for this run only (forge). */
  runTech: string[];
  /** Free upgrade picks owed to the player (opened at the start of the next node). */
  picks: number;
  /** Loot uid counter (uids stay unique across nodes). */
  lootCounter: number;
  /** Damage dealt in earlier nodes (survival statistics continue across arenas). */
  dealt: { player: number; tower: number };
}

export const emptyCarry = (): RunCarry => ({
  wave: 0,
  cores: 0,
  reactorHp: 0,
  ult: 0,
  build: { stacks: [], picks: [], offers: 0 },
  loadout: {},
  curses: [],
  blessings: [],
  forge: {},
  runTech: [],
  picks: 0,
  lootCounter: 0,
  dealt: { player: 0, tower: 0 },
});

/** Share of the cores a tower cost that come back when the run leaves its arena. */
export const TOWER_CARRY_REFUND = 0.5;

/** Cores refunded for the towers left behind (wrecks refund a quarter of the normal share). */
export function towerRefund(towers: readonly { paid: number; wrecked?: boolean }[], share = TOWER_CARRY_REFUND): number {
  let s = 0;
  for (const t of towers) s += Math.max(0, t.paid) * share * (t.wrecked ? 0.25 : 1);
  return Math.floor(s);
}

/** Effects of the act's curses and blessings on a segment. */
export function actEffects(c: Pick<RunCarry, 'curses' | 'blessings'>): NodeEffect[] {
  const out: NodeEffect[] = [];
  for (const id of c.curses) if (CURSES[id]?.effect) out.push(CURSES[id].effect!);
  for (const id of c.blessings) if (BLESSINGS[id]?.effect) out.push(BLESSINGS[id].effect!);
  return out;
}

/** Run-only stat modifiers: curses, blessings and forge tempering. */
export function carryStats(c: Pick<RunCarry, 'curses' | 'blessings' | 'forge'>): (StatMod & { source: string })[] {
  const out: (StatMod & { source: string })[] = [];
  for (const id of c.curses) for (const s of CURSES[id]?.stats ?? []) out.push({ ...s, source: `curse:${id}` });
  for (const id of c.blessings) for (const s of BLESSINGS[id]?.stats ?? []) out.push({ ...s, source: `blessing:${id}` });
  for (const id of FORGE_IDS) {
    const n = Math.min(FORGE[id].max, Math.max(0, Math.floor(c.forge[id] ?? 0)));
    for (let i = 0; i < n; i++) out.push({ ...FORGE[id].stat, source: `forge:${id}` });
  }
  return out;
}

/** Add a curse (no duplicates, capped). Returns the added id or null. */
export function addCurse(c: Pick<RunCarry, 'curses'>, id: CurseId): CurseId | null {
  if (c.curses.includes(id) || c.curses.length >= MAX_CURSES) return null;
  c.curses.push(id);
  return id;
}

/** A random curse the run does not have yet. */
export function randomCurse(c: Pick<RunCarry, 'curses'>, r: () => number): CurseId | null {
  const pool = CURSE_IDS.filter((id) => !c.curses.includes(id));
  return pool.length ? pool[Math.floor(r() * pool.length) % pool.length] : null;
}

/** Remove the oldest curse. */
export function purgeCurse(c: Pick<RunCarry, 'curses'>): CurseId | null {
  return c.curses.shift() ?? null;
}

/** Clearing an act boss lifts every curse and blessing of the act. */
export function endAct(c: Pick<RunCarry, 'curses' | 'blessings'>): void {
  c.curses.length = 0;
  c.blessings.length = 0;
}

const num = (v: unknown, d = 0, lo = 0, hi = 1e12): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const strs = (v: unknown, max = 64): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.slice(0, 64)).slice(0, max) : []);

/** Validate a stored carry (save data is untrusted). */
export function sanitizeCarry(raw: unknown): RunCarry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const b = (r.build && typeof r.build === 'object' ? r.build : {}) as Record<string, unknown>;
  const stacks: [string, number][] = Array.isArray(b.stacks)
    ? b.stacks.filter((s): s is [string, number] => Array.isArray(s) && typeof s[0] === 'string' && typeof s[1] === 'number').map(([id, n]) => [id.slice(0, 48), Math.floor(num(n, 0, 0, 99))] as [string, number]).filter(([, n]) => n > 0).slice(0, 80)
    : [];
  const picks = Array.isArray(b.picks)
    ? b.picks.filter((p): p is { id: string; wave: number } => !!p && typeof (p as { id: unknown }).id === 'string').map((p) => ({ id: p.id.slice(0, 48), wave: Math.floor(num(p.wave, 1, 1)) })).slice(0, 400)
    : [];
  const lo = (r.loadout && typeof r.loadout === 'object' ? r.loadout : {}) as Record<string, unknown>;
  const loadout: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(lo).slice(0, 16)) loadout[k.slice(0, 24)] = typeof v === 'string' ? v.slice(0, 96) : null;
  const fo = (r.forge && typeof r.forge === 'object' ? r.forge : {}) as Record<string, unknown>;
  const forge: Partial<Record<ForgeId, number>> = {};
  for (const id of FORGE_IDS) if (typeof fo[id] === 'number') forge[id] = Math.floor(num(fo[id], 0, 0, FORGE[id].max));
  const d = (r.dealt && typeof r.dealt === 'object' ? r.dealt : {}) as Record<string, unknown>;
  return {
    wave: Math.floor(num(r.wave, 0, 0, 1_000_000)),
    cores: Math.floor(num(r.cores, 0, 0, 1e9)),
    reactorHp: num(r.reactorHp, 0, 0, 1e6),
    ult: num(r.ult, 0, 0, 1),
    build: { stacks, picks, offers: Math.floor(num(b.offers, 0, 0, 1e6)) },
    loadout,
    curses: [...new Set(strs(r.curses).filter((x): x is CurseId => (CURSE_IDS as string[]).includes(x)))].slice(0, MAX_CURSES),
    blessings: [...new Set(strs(r.blessings).filter((x): x is BlessingId => (BLESSING_IDS as string[]).includes(x)))],
    forge,
    runTech: strs(r.runTech, 32),
    picks: Math.floor(num(r.picks, 0, 0, 10)),
    lootCounter: Math.floor(num(r.lootCounter, 0, 0, 1e9)),
    dealt: { player: num(d.player, 0, 0, 1e15), tower: num(d.tower, 0, 0, 1e15) },
  };
}
