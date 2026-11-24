import * as TX from '../economy/transactions';
import { SLOT_IDS, type SlotId } from './items';
import {
  equipFromStorage,
  expandStorage,
  installModule,
  loadPreset,
  type SaveData,
  savePreset,
  selectTier,
  transferModule,
  uninstallModule,
  unequipToStorage,
} from './save';
import { TOWER_SLOTS } from '../towers/components';
const COMPONENT_SLOTS = ['barrel', 'core', 'cooling', 'mechanism', 'attachment'] as const;
import { BUILD_OPS } from '../home/build/ops';
import { TUTORIAL_OPS } from './tutorial';
import { allocateNode, respecTree } from './treeOps';
import { lockedFamiliesOf, lockReason, lootLocks, opFeature, recipeFeature } from './unlocks';
import { PINNACLE, warCacheItem, warCacheShards } from './spikes';
import { allOwnedUids, sanitizeItem } from './save';
import { componentRank, FAMILY_NAME, finishesAt, MASTERY_FAMILIES, perkBlocker, rankOf } from './mastery';
import type { WeaponFamily } from '../data/defs';
import type { Finish } from '../weapons/build';
import { recipeDef } from '../economy/recipes';

/**
 * Named, serialisable profile operations (M7).
 *
 * Every persistent change a player can request from the HQ goes through one of these, so the
 * exact same validated rule runs locally (single player, `Profile.op`) and on the co-op server
 * against the player's online profile (the client cannot submit a state, only an operation).
 * Arguments are type-checked here before the rule sees them: malformed network input fails
 * with a reason instead of throwing inside a rule.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpResult = ({ ok: true } & Record<string, any>) | { ok: false; reason: string } | { ok: boolean; [k: string]: any };

type ArgKind = 'str' | 'str?' | 'int' | 'bool' | 'strs' | 'num' | 'json';
interface OpDef {
  args: ArgKind[];
  run(d: SaveData, a: unknown[], txId: string | undefined): OpResult;
}

const bool = (ok: boolean, reason: string): { ok: true } | { ok: false; reason: string } => (ok ? { ok: true } : { ok: false, reason });
const asSlot = (s: unknown): SlotId | null => ((SLOT_IDS as readonly string[]).includes(s as string) ? (s as SlotId) : null);

const DEFS: Record<string, OpDef> = {
  // ---- economy (M4) — transactions validate, mutate atomically and guard tx ids themselves
  setItemLock: { args: ['str', 'bool'], run: (d, a) => TX.setItemLock(d, a[0] as string, a[1] as boolean) },
  setAffixLock: { args: ['str', 'int', 'bool'], run: (d, a) => TX.setAffixLock(d, a[0] as string, a[1] as number, a[2] as boolean) },
  dismantleItems: { args: ['strs'], run: (d, a, tx) => TX.dismantleItems(d, a[0] as string[], tx) },
  sellItems: { args: ['strs'], run: (d, a, tx) => TX.sellItems(d, a[0] as string[], tx) },
  buyItem: { args: ['str', 'str'], run: (d, a, tx) => (a[0] === 'equipment' || a[0] === 'modules' ? TX.buyItem(d, a[0], a[1] as string, tx) : { ok: false, reason: 'Unknown merchant' }) },
  buyExchange: { args: ['str'], run: (d, a, tx) => TX.buyExchange(d, a[0] as string, tx) },
  refreshMarket: { args: [], run: (d, _a, tx) => TX.refreshMarket(d, tx) },
  rerollAffix: { args: ['str', 'int', 'str'], run: (d, a, tx) => (a[2] === 'stat' || a[2] === 'value' ? TX.rerollAffix(d, a[0] as string, a[1] as number, a[2], tx) : { ok: false, reason: 'Unknown mode' }) },
  rerollUnlocked: { args: ['str'], run: (d, a, tx) => TX.rerollUnlocked(d, a[0] as string, tx) },
  enhanceItem: { args: ['str'], run: (d, a, tx) => TX.enhanceItem(d, a[0] as string, tx) },
  ascendItem: { args: ['str'], run: (d, a, tx) => TX.ascendOwned(d, a[0] as string, tx) },
  modifyComponent: {
    args: ['str', 'str', 'str'],
    run: (d, a, tx) => ((COMPONENT_SLOTS as readonly string[]).includes(a[1] as string) ? TX.modifyComponent(d, a[0] as string, a[1] as never, a[2] as string, tx) : { ok: false, reason: 'Unknown component slot' }),
  },
  craft: { args: ['str', 'str?'], run: (d, a, tx) => TX.craft(d, a[0] as string, (a[1] as string | null) ?? null, tx) },
  researchTower: {
    args: ['str', 'str'],
    run: (d, a, tx) => ((TOWER_SLOTS as readonly string[]).includes(a[0] as string) ? TX.researchTower(d, a[0] as never, a[1] as string, tx) : { ok: false, reason: 'Unknown tower slot' }),
  },
  // ---- loadout / storage (M1-M3)
  equipFromStorage: {
    args: ['str', 'str?'],
    run: (d, a) => {
      const slot = a[1] == null ? undefined : asSlot(a[1]);
      if (slot === null) return { ok: false, reason: 'Unknown slot' };
      return bool(equipFromStorage(d, a[0] as string, slot), 'Cannot equip that item here');
    },
  },
  unequipToStorage: { args: ['str'], run: (d, a) => (asSlot(a[0]) ? bool(unequipToStorage(d, asSlot(a[0])!), 'Storage full or slot required') : { ok: false, reason: 'Unknown slot' }) },
  savePreset: { args: ['int'], run: (d, a) => bool(savePreset(d, a[0] as number), 'Cannot save preset') },
  loadPreset: { args: ['int'], run: (d, a) => bool(loadPreset(d, a[0] as number), 'Nothing to change') },
  expandStorage: { args: [], run: (d, _a, tx) => TX.withTx(d, tx, () => bool(expandStorage(d), 'Not enough salvage')) },
  installModule: { args: ['str', 'int', 'str'], run: (d, a) => installModule(d, a[0] as string, a[1] as number, a[2] as string) },
  uninstallModule: { args: ['str', 'int'], run: (d, a, tx) => TX.withTx(d, tx, () => uninstallModule(d, a[0] as string, a[1] as number)) },
  transferModule: { args: ['str', 'int', 'str', 'int'], run: (d, a, tx) => TX.withTx(d, tx, () => transferModule(d, a[0] as string, a[1] as number, a[2] as string, a[3] as number)) },
  selectTier: { args: ['int'], run: (d, a) => bool(selectTier(d, a[0] as number), 'Tier locked') },
  // ---- big spikes: pinnacle keys (fabricator), Rift War victory caches
  craftKey: { args: [], run: (d, _a, tx) => TX.withTx(d, tx, () => craftKey(d) as never) },
  warContribute: { args: ['int'], run: (d, a) => warContribute(d, a[0] as number) },
  claimWarCache: { args: ['int'], run: (d, a, tx) => TX.withTx(d, tx, () => claimWarCache(d, a[0] as number) as never) },
  // ---- weapon-family mastery (perk choices are free to change; finishes need the rank)
  masteryPerk: { args: ['str', 'int', 'int'], run: (d, a) => choosePerk(d, a[0] as string, a[1] as number, a[2] as number) },
  masteryFinish: { args: ['str', 'str?'], run: (d, a) => chooseFinish(d, a[0] as string, (a[1] as string | null) ?? null) },
  // ---- Warden skill tree
  treeAllocate: { args: ['str'], run: (d, a) => allocateNode(d, a[0] as string) },
  treeRespec: { args: [], run: (d, _a, tx) => TX.withTx(d, tx, () => respecTree(d) as never) },
  ...BUILD_OPS,
  ...TUTORIAL_OPS,
};

export type OpName = keyof typeof DEFS & string;
export const OP_NAMES = Object.keys(DEFS);

function checkArg(kind: ArgKind, v: unknown): boolean {
  switch (kind) {
    case 'str':
      return typeof v === 'string' && v.length <= 200;
    case 'str?':
      return v == null || (typeof v === 'string' && v.length <= 200);
    case 'int':
      return Number.isInteger(v) && Math.abs(v as number) < 1e9;
    case 'num':
      return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7;
    case 'bool':
      return typeof v === 'boolean';
    case 'strs':
      return Array.isArray(v) && v.length <= 200 && v.every((x) => typeof x === 'string' && x.length <= 200);
    case 'json':
      return v !== undefined && JSON.stringify(v).length <= 4000;
  }
}

/** Validate an op request's shape (name + argument types). */
export function opError(name: unknown, args: unknown): string | null {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(DEFS, name)) return 'Unknown operation';
  if (!Array.isArray(args)) return 'Malformed arguments';
  const def = DEFS[name];
  if (args.length > def.args.length) return 'Too many arguments';
  for (let i = 0; i < def.args.length; i++) if (!checkArg(def.args[i], args[i])) return `Invalid argument ${i + 1}`;
  return null;
}

/** Craft a pinnacle key from rift shards (fabricator, RL 8+). */
function craftKey(d: SaveData): OpResult {
  if (d.activeRun) return { ok: false, reason: 'Not during an operation' };
  if (d.threat.unlocked < PINNACLE.minRl) return { ok: false, reason: `Pinnacle keys open at Rift Level ${PINNACLE.minRl}` };
  if (d.resources.shards < PINNACLE.craftShards) return { ok: false, reason: `Needs ${PINNACLE.craftShards} rift shards` };
  if ((d.pinnacle?.keys ?? 0) >= PINNACLE.maxKeys) return { ok: false, reason: 'Key rack full' };
  d.resources.shards -= PINNACLE.craftShards;
  d.pinnacle = { runs: d.pinnacle?.runs ?? 0, keys: (d.pinnacle?.keys ?? 0) + 1 };
  return { ok: true };
}

/** Remember that this warden secured a sector in Rift War region `k` (victory cache eligibility). */
function warContribute(d: SaveData, k: number): OpResult {
  if (!(k >= 0 && k < 100_000)) return { ok: false, reason: 'Unknown region' };
  const w = d.war ?? { fought: [], claimed: [] };
  if (w.fought.includes(k)) return { ok: true };
  d.war = { fought: [...w.fought, k].slice(-500), claimed: w.claimed };
  return { ok: true };
}

/**
 * Claim the victory cache of a liberated region this warden fought in (the HQ offers it once the war reports the
 * region liberated; like solo war reports, the liberation itself is not re-checked here).
 */
function claimWarCache(d: SaveData, k: number): OpResult {
  const w = d.war;
  if (d.activeRun) return { ok: false, reason: 'Not during an operation' };
  if (!w?.fought.includes(k)) return { ok: false, reason: 'You did not fight in that region' };
  if (w.claimed.includes(k)) return { ok: false, reason: 'Already claimed' };
  const locks = lootLocks(d);
  const it = sanitizeItem(warCacheItem(d.profile.id, k, d.threat.unlocked, { families: lockedFamiliesOf(locks), components: locks.filter((l) => l.startsWith('comp:')) }));
  if (!it || allOwnedUids(d).includes(it.uid)) return { ok: false, reason: 'Cache unavailable' };
  d.items.push(it);
  d.storage.uids.push(it.uid);
  d.resources.shards += warCacheShards(k);
  d.war = { fought: w.fought, claimed: [...w.claimed, k] };
  return { ok: true, item: it };
}

/** Choose a mastery perk option for a tier (free to change: there is no respec cost). */
function choosePerk(d: SaveData, family: string, tier: number, option: number): OpResult {
  const f = family as WeaponFamily;
  const why = perkBlocker(d.progress.mastery, f, tier, option);
  if (why) return { ok: false, reason: why };
  const m = { ...(d.progress.mastery ?? {}) };
  const cur = m[f] ?? { xp: 0, perks: [] };
  const perks = [...cur.perks];
  while (perks.length < tier) perks.push(-1);
  perks[tier - 1] = option;
  m[f] = { ...cur, perks };
  d.progress.mastery = m;
  return { ok: true };
}

/** Pick (or clear with null) the cosmetic finish for a family's weapons. */
function chooseFinish(d: SaveData, family: string, finish: string | null): OpResult {
  const f = family as WeaponFamily;
  if (!MASTERY_FAMILIES.includes(f)) return { ok: false, reason: 'Unknown weapon family' };
  const cur = d.progress.mastery?.[f];
  if (finish !== null && !finishesAt(rankOf(d.progress.mastery, f)).includes(finish as Finish)) return { ok: false, reason: 'That finish is not unlocked yet' };
  const m = { ...(d.progress.mastery ?? {}) };
  const next = { ...(cur ?? { xp: 0, perks: [] }) };
  if (finish === null) delete next.finish;
  else next.finish = finish as Finish;
  m[f] = next;
  d.progress.mastery = m;
  return { ok: true };
}

/** Staged unlocks (progression/unlocks): a locked station, system or recipe refuses its operations. */
function lockError(d: SaveData, name: string, args: unknown[]): string | null {
  const feature = name in BUILD_OPS ? 'station:architect' : opFeature(name, args);
  const reason = feature ? lockReason(d, feature) : null;
  if (reason) return reason;
  if (name === 'modifyComponent') {
    // Mastery components refit only once the family's rank unlocks them.
    const it = d.items.find((x) => x.uid === args[0]);
    const fam = it?.build?.family;
    if (fam && lootLocks(d).includes(`comp:${fam}:${args[2] as string}`)) return `${FAMILY_NAME[fam]} mastery rank ${componentRank(fam, args[2] as string)} unlocks that component.`;
  }
  if (name === 'craft') {
    const r = recipeDef(args[0] as string);
    const f = r ? recipeFeature(r.output) : null;
    return f ? lockReason(d, f) : null;
  }
  return null;
}

/** Run a named operation against a save (mutates on success; the caller persists). */
export function runOp(d: SaveData, name: string, args: unknown[], txId?: string): OpResult {
  const err = opError(name, args);
  if (err) return { ok: false, reason: err };
  const locked = lockError(d, name, args);
  if (locked) return { ok: false, reason: locked };
  if (txId !== undefined && (typeof txId !== 'string' || txId.length > 80)) return { ok: false, reason: 'Invalid transaction id' };
  return DEFS[name].run(d, args, txId);
}
