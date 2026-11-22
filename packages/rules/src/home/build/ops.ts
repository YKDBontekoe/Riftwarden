import type { OpResult } from '../../progression/ops';
import { ANNEX_BAYS, type SaveData } from '../../progression/save';
import { type PieceDef, LIGHT_COLORS, LIMITS, pieceDef } from './catalog';
import {
  cellKey,
  checkCeiling,
  checkEdge,
  checkFloor,
  checkFree,
  checkPillar,
  checkRemoveFloor,
  edgeCells,
  isMovableStation,
  type PlacedProp,
  stationsReachable,
} from './model';

type ArgKind = 'str' | 'str?' | 'int' | 'bool' | 'strs' | 'num' | 'json';
type Op = { args: ArgKind[]; run(d: SaveData, a: unknown[], txId: string | undefined): OpResult };
type Cost = { credits?: number; salvage?: number; components?: number };

const fail = (reason: string): OpResult => ({ ok: false, reason });
const KEYS = ['credits', 'salvage', 'components'] as const;

/** Blueprint state: starter, bought, or derived from persisted progression (milestones, tiers). */
export function blueprintStatus(d: Pick<SaveData, 'base' | 'milestones' | 'threat'>, def: PieceDef): { unlocked: boolean; how: string } {
  const u = def.unlock;
  switch (u.by) {
    case 'starter':
      return { unlocked: true, how: 'Standard blueprint' };
    case 'merchant':
      return { unlocked: d.base.blueprints.includes(def.id), how: `Architect catalogue · ${u.price} cr` };
    case 'milestone':
      return { unlocked: d.milestones.includes(u.id), how: u.text };
    case 'tier':
      return { unlocked: d.threat.unlocked >= u.tier, how: `Unlock threat tier ${['', 'I', 'II', 'III', 'IV', 'V'][u.tier]}` };
    case 'craft':
      return { unlocked: true, how: u.text };
  }
}

function hqOnly(d: SaveData): OpResult | null {
  return d.activeRun ? fail('Construction is only possible at HQ between operations') : null;
}

function afford(d: SaveData, c: Cost): string | null {
  for (const k of KEYS) if ((c[k] ?? 0) > d.resources[k]) return `Not enough ${k} (need ${c[k]})`;
  return null;
}
function pay(d: SaveData, c: Cost): void {
  for (const k of KEYS) d.resources[k] -= c[k] ?? 0;
}
function refund(d: SaveData, c: Cost): void {
  for (const k of KEYS) d.resources[k] += c[k] ?? 0;
}

/** Common checks to build piece `id`: known, kind, blueprint, owned stock or resources. */
function canBuild(d: SaveData, id: string, kinds: PieceDef['kind'][]): { def: PieceDef } | { reason: string } {
  const def = pieceDef(id);
  if (!def || !kinds.includes(def.kind)) return { reason: 'Unknown construction piece' };
  if (!blueprintStatus(d, def).unlocked) return { reason: `Blueprint locked: ${blueprintStatus(d, def).how}` };
  if (def.owned) {
    if ((d.base.owned[id] ?? 0) <= 0) return { reason: `You own no ${def.name} (${blueprintStatus(d, def).how.toLowerCase()})` };
  } else {
    const why = afford(d, def.cost);
    if (why) return { reason: why };
  }
  if (def.limit && d.base.placeables.filter((p) => p.type === id).length >= def.limit) return { reason: `Limit reached: ${def.limit} ${def.name}` };
  return { def };
}

function take(d: SaveData, def: PieceDef): void {
  if (def.owned) d.base.owned[def.id] = (d.base.owned[def.id] ?? 0) - 1;
  else pay(d, def.cost);
}
function giveBack(d: SaveData, def: PieceDef): void {
  if (def.owned) d.base.owned[def.id] = (d.base.owned[def.id] ?? 0) + 1;
  else refund(d, def.cost);
}

const props = (d: SaveData): PlacedProp[] => d.base.placeables as PlacedProp[];

/** Light/visual properties a player may set on free pieces. */
function cleanProps(def: PieceDef, raw: unknown): Record<string, string | number | boolean> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string | number | boolean> = {};
  if (def.kind === 'light' || def.id === 'lightStrip') {
    out.color = typeof r.color === 'string' && r.color in LIGHT_COLORS ? r.color : 'white';
    out.intensity = typeof r.intensity === 'number' && Number.isFinite(r.intensity) ? Math.max(0.2, Math.min(1.6, Math.round(r.intensity * 10) / 10)) : 1;
    out.on = r.on !== false;
  }
  if (typeof r.accent === 'string' && ['cyan', 'teal', 'white', 'amber'].includes(r.accent)) out.accent = r.accent;
  return out;
}

const uidOk = (u: unknown): u is string => typeof u === 'string' && /^[a-z0-9_.-]{4,40}$/i.test(u);

/**
 * Construction operations. Every op validates everything, then mutates in one step; removal refunds
 * exactly what placing cost (or returns the owned piece), so no sequence of build/remove/undo/redo
 * can create or destroy resources. Placing never accepts a state, only a validated intent.
 */
export const BUILD_OPS: Record<string, Op> = {
  hqFloor: {
    args: ['int', 'int', 'str'],
    run: (d, a) => {
      const g = hqOnly(d);
      if (g) return g;
      const [i, j, id] = a as [number, number, string];
      const c = canBuild(d, id, ['floor']);
      if ('reason' in c) return fail(c.reason);
      const v = checkFloor(d.base.structure, i, j, id);
      if (!v.ok) return v;
      take(d, c.def);
      d.base.structure.floors[cellKey(i, j)] = id;
      return { ok: true };
    },
  },
  hqUnfloor: {
    args: ['int', 'int'],
    run: (d, a) => {
      const g = hqOnly(d);
      if (g) return g;
      const [i, j] = a as [number, number];
      const id = d.base.structure.floors[cellKey(i, j)];
      const v = checkRemoveFloor(d.base.structure, i, j, props(d), d.base.stations);
      if (!v.ok) return v;
      delete d.base.structure.floors[cellKey(i, j)];
      giveBack(d, pieceDef(id)!);
      return { ok: true, id };
    },
  },
  hqEdge: {
    args: ['str', 'str'],
    run: (d, a) => {
      const g = hqOnly(d);
      if (g) return g;
      const [key, id] = a as [string, string];
      if (!/^-?\d+,-?\d+,[ne]$/.test(key)) return fail('Invalid wall slot');
      const c = canBuild(d, id, ['edge']);
      if ('reason' in c) return fail(c.reason);
      const v = checkEdge(d.base.structure, key, id, d.base.stations);
      if (!v.ok) return v;
      take(d, c.def);
      d.base.structure.edges[key] = id;
      return { ok: true };
    },
  },
  hqUnedge: {
    args: ['str'],
    run: (d, a) => {
      const g = hqOnly(d);
      if (g) return g;
      const id = d.base.structure.edges[a[0] as string];
      if (!id) return fail('Nothing to remove');
      delete d.base.structure.edges[a[0] as string];
      giveBack(d, pieceDef(id)!);
      return { ok: true, id };
    },
  },
  hqCeiling: {
    args: ['int', 'int', 'str'],
    run: (d, a) => {
      const g = hqOnly(d);
      if (g) return g;
      const [i, j, id] = a as [number, number, string];
      const c = canBuild(d, id, ['ceiling']);
      if ('reason' in c) return fail(c.reason);
      const v = checkCeiling(d.base.structure, i, j, id);
      if (!v.ok) return v;
      take(d, c.def);
      d.base.structure.ceilings[cellKey(i, j)] = id;
      return { ok: true };
    },
  },
  hqUnceiling: {
    args: ['int', 'int'],
    run: (d, a) => {
      const g = hqOnly(d);
      if (g) return g;
      const k = cellKey(a[0] as number, a[1] as number);
      const id = d.base.structure.ceilings[k];
      if (!id) return fail('Nothing to remove');
      delete d.base.structure.ceilings[k];
      giveBack(d, pieceDef(id)!);
      return { ok: true, id };
    },
  },
  hqPillar: {
    args: ['int', 'int'],
    run: (d, a) => {
      const g = hqOnly(d);
      if (g) return g;
      const [i, j] = a as [number, number];
      const c = canBuild(d, 'pillar', ['pillar']);
      if ('reason' in c) return fail(c.reason);
      const v = checkPillar(d.base.structure, i, j);
      if (!v.ok) return v;
      take(d, c.def);
      d.base.structure.pillars[cellKey(i, j)] = 'pillar';
      return { ok: true };
    },
  },
  hqUnpillar: {
    args: ['int', 'int'],
    run: (d, a) => {
      const g = hqOnly(d);
      if (g) return g;
      const k = cellKey(a[0] as number, a[1] as number);
      if (!d.base.structure.pillars[k]) return fail('Nothing to remove');
      delete d.base.structure.pillars[k];
      giveBack(d, pieceDef('pillar')!);
      return { ok: true };
    },
  },
  /** Free placement: uid (client generated, unique), type, x, z, yaw, scale, props. */
  hqPlace: {
    args: ['str', 'str', 'num', 'num', 'num', 'num', 'json'],
    run: (d, a) => {
      const g = hqOnly(d);
      if (g) return g;
      const [uid, id, x, z, yaw, scale, raw] = a as [string, string, number, number, number, number, unknown];
      if (!uidOk(uid) || d.base.placeables.some((p) => p.uid === uid)) return fail('Invalid object id');
      if (d.base.placeables.length >= LIMITS.props) return fail(`Decoration limit: ${LIMITS.props} objects`);
      const c = canBuild(d, id, ['prop', 'light', 'facility']);
      if ('reason' in c) return fail(c.reason);
      const p = cleanProps(c.def, raw);
      if (c.def.light && p.on !== false && litCount(d) >= LIMITS.lights) p.on = false;
      const v = checkFree(d.base.structure, id, x, z, scale, props(d), d.base.stations);
      if (!v.ok) return v;
      take(d, c.def);
      d.base.placeables.push({ uid, type: id, position: [round(x), 0, round(z)], rotationY: round(yaw), scale: round(scale), props: p });
      if (id === 'storageAnnex') d.storage.capacity += ANNEX_BAYS;
      return { ok: true, uid, lightBudget: c.def.light && p.on === false };
    },
  },
  hqMove: {
    args: ['str', 'num', 'num', 'num', 'num'],
    run: (d, a) => {
      const g = hqOnly(d);
      if (g) return g;
      const [uid, x, z, yaw, scale] = a as [string, number, number, number, number];
      const p = d.base.placeables.find((q) => q.uid === uid);
      if (!p) return fail('Object not found');
      const v = checkFree(d.base.structure, p.type, x, z, scale, props(d), d.base.stations, uid);
      if (!v.ok) return v;
      const before = { x: p.position[0], z: p.position[2], yaw: p.rotationY, scale: p.scale };
      p.position = [round(x), 0, round(z)];
      p.rotationY = round(yaw);
      p.scale = round(scale);
      return { ok: true, before };
    },
  },
  hqRemove: {
    args: ['str'],
    run: (d, a) => {
      const g = hqOnly(d);
      if (g) return g;
      const i = d.base.placeables.findIndex((q) => q.uid === a[0]);
      if (i < 0) return fail('Object not found');
      const p = d.base.placeables[i];
      const def = pieceDef(p.type);
      if (p.type === 'storageAnnex' && d.storage.uids.length > d.storage.capacity - ANNEX_BAYS) return fail('Storage would overflow: free some bays first');
      d.base.placeables.splice(i, 1);
      if (p.type === 'storageAnnex') d.storage.capacity -= ANNEX_BAYS;
      if (def) giveBack(d, def);
      return { ok: true, removed: JSON.parse(JSON.stringify(p)) };
    },
  },
  /** Light colour/intensity/on and accents. */
  hqSet: {
    args: ['str', 'json'],
    run: (d, a) => {
      const g = hqOnly(d);
      if (g) return g;
      const p = d.base.placeables.find((q) => q.uid === a[0]);
      const def = p && pieceDef(p.type);
      if (!p || !def) return fail('Object not found');
      const next = cleanProps(def, { ...p.props, ...(a[1] as object) });
      if (def.light && next.on !== false && p.props.on === false && litCount(d) >= LIMITS.lights) return fail(`Light budget: at most ${LIMITS.lights} real lights may be switched on`);
      const before = { ...p.props };
      p.props = next;
      return { ok: true, before };
    },
  },
  hqStation: {
    args: ['str', 'num', 'num', 'num'],
    run: (d, a) => {
      const g = hqOnly(d);
      if (g) return g;
      const [id, x, z, yaw] = a as [string, number, number, number];
      if (!isMovableStation(id)) return fail('This station is anchored');
      const v = checkFree(d.base.structure, `station:${id}`, x, z, 1, props(d), d.base.stations, undefined, id);
      if (!v.ok) return v;
      const before = d.base.stations[id] ?? null;
      const next = { ...d.base.stations, [id]: { x: round(x), z: round(z), yaw: round(yaw) } };
      const reach = stationsReachable(d.base.structure, next);
      if (!reach.ok) return reach;
      d.base.stations = next;
      return { ok: true, before };
    },
  },
  hqStationReset: {
    args: ['str'],
    run: (d, a) => {
      const g = hqOnly(d);
      if (g) return g;
      const id = a[0] as string;
      if (!d.base.stations[id]) return fail('Already at its original place');
      const before = d.base.stations[id];
      delete d.base.stations[id];
      return { ok: true, before };
    },
  },
  hqBlueprint: {
    args: ['str'],
    run: (d, a, tx) => {
      const g = hqOnly(d);
      if (g) return g;
      if (tx && d.economy.tx.includes(tx)) return fail('Transaction already processed');
      const def = pieceDef(a[0] as string);
      if (!def || def.unlock.by !== 'merchant') return fail('Not sold by the architect');
      if (d.base.blueprints.includes(def.id)) return fail('Already owned');
      if (d.resources.credits < def.unlock.price) return fail(`Not enough credits (need ${def.unlock.price})`);
      d.resources.credits -= def.unlock.price;
      d.base.blueprints.push(def.id);
      if (tx) d.economy.tx.push(tx);
      return { ok: true };
    },
  },
  /** Fabricate an owned construction piece (crafting integration). */
  hqFabricate: {
    args: ['str'],
    run: (d, a, tx) => {
      const g = hqOnly(d);
      if (g) return g;
      if (tx && d.economy.tx.includes(tx)) return fail('Transaction already processed');
      const def = pieceDef(a[0] as string);
      const recipe = def && CRAFT_PIECES[def.id];
      if (!def || !recipe) return fail('No fabrication recipe');
      const why = afford(d, recipe);
      if (why) return fail(why);
      if ((d.base.owned[def.id] ?? 0) >= 9) return fail('Hold limit reached (9)');
      pay(d, recipe);
      d.base.owned[def.id] = (d.base.owned[def.id] ?? 0) + 1;
      d.economy.crafts++;
      if (tx) d.economy.tx.push(tx);
      return { ok: true };
    },
  },
};

/** Fabrication recipes for owned construction pieces (resources -> one piece). */
export const CRAFT_PIECES: Record<string, Cost> = {
  machinery: { credits: 160, salvage: 120, components: 2 },
};

function litCount(d: SaveData): number {
  return d.base.placeables.filter((p) => pieceDef(p.type)?.light && p.props.on !== false).length;
}

const round = (v: number) => Math.round(v * 100) / 100;

export { edgeCells };
