/**
 * Procedural Warden skill tree (pure).
 *
 * Radial rings around a core, four branches (sectors). Every ring is generated from its own seeded
 * stream, so revealing ring N+1 never changes rings 1..N: a profile's tree is reproducible forever.
 * Nodes are rolled from per-branch templates like affixes: minor (one stat), notable (two stats,
 * stronger) and keystone (a big trade-off, sometimes a rule). Values grow mildly with the ring and the
 * total per stat is soft-capped, so the tree supports gear instead of replacing it.
 */
import { mulberry32 } from '../combat/damage';
import type { StatKey, StatModifier, StatOp } from '../combat/stats';
import { pointsAt, ringsAt } from './level';

export const TREE_VERSION = 1;
export const BRANCHES = ['hull', 'weapon', 'tower', 'tactical'] as const;
export type Branch = (typeof BRANCHES)[number];
/** One-letter id code per branch (node ids look like `r3e1`). */
const BRANCH_CODE: Record<Branch, string> = { hull: 'h', weapon: 'w', tower: 'e', tactical: 'v' };

export const BRANCH_INFO: Record<Branch, { name: string; color: string; blurb: string }> = {
  hull: { name: 'Bulwark', color: '#5fd0ff', blurb: 'Hull, armor and shields' },
  weapon: { name: 'Arsenal', color: '#ff8a4c', blurb: 'Weapon damage, rate, crits and heat' },
  tower: { name: 'Engineer', color: '#7dff9b', blurb: 'Towers and core income' },
  tactical: { name: 'Vector', color: '#c69bff', blurb: 'Mobility, tactical energy, elements and XP' },
};

export type NodeKind = 'minor' | 'notable' | 'keystone';

/** Rules a keystone can carry besides stats (read by the arena through treeRules). */
export interface TreeRules {
  /** XP multiplier for runs. */
  xpMult: number;
  /** Cores granted at the start of every run. */
  startCores: number;
}

export interface TreeMod {
  stat: StatKey;
  op: StatOp;
  value: number;
}

export interface TreeNode {
  id: string;
  ring: number;
  branch: Branch;
  /** Angle in radians (0 = right, counter-clockwise). */
  angle: number;
  kind: NodeKind;
  name: string;
  mods: TreeMod[];
  rule?: Partial<TreeRules>;
  /** Parent node ids (ring - 1) or 'core'. */
  parents: string[];
}

export const CORE_ID = 'core';

interface Template {
  stat: StatKey;
  op: StatOp;
  /** Value at ring 1. */
  v: number;
  name: string;
  w: number;
}

const T = (stat: StatKey, op: StatOp, v: number, name: string, w = 1): Template => ({ stat, op, v, name, w });

const TEMPLATES: Record<Branch, Template[]> = {
  hull: [
    T('maxHealthMult', 'pct', 0.04, 'Reinforced Frame', 1.4),
    T('shieldCapacity', 'add', 6, 'Shield Lattice', 1.2),
    T('shieldRegen', 'add', 1.2, 'Regen Coil'),
    T('armor', 'add', 4, 'Plate Weave'),
    T('damageResist', 'add', 0.01, 'Dampers', 0.7),
    T('shieldDelay', 'pct', -0.05, 'Quick Restart', 0.7),
  ],
  weapon: [
    T('weaponDamageMult', 'pct', 0.03, 'Focused Output', 1.4),
    T('fireRateMult', 'pct', 0.025, 'Trigger Tuning'),
    T('critChance', 'add', 0.01, 'Target Analysis'),
    T('critMultiplier', 'add', 0.06, 'Weakpoint Model'),
    T('coolRateMult', 'pct', 0.04, 'Heat Sinks', 0.8),
    T('heatEfficiency', 'pct', 0.04, 'Thermal Margin', 0.8),
    T('eliteDamageMult', 'pct', 0.04, 'Hunter Protocol', 0.7),
  ],
  tower: [
    T('turretDamageMult', 'pct', 0.04, 'Tower Calibration', 1.4),
    T('turretFireRateMult', 'pct', 0.03, 'Feed Actuators'),
    T('turretRangeMult', 'pct', 0.03, 'Sensor Masts'),
    T('buildCostMult', 'pct', -0.03, 'Prefab Frames', 0.8),
    T('coreIncomeMult', 'pct', 0.04, 'Core Harvest', 0.9),
  ],
  tactical: [
    T('tacticalRechargeMult', 'pct', 0.05, 'Time Capacitor', 1.2),
    T('dashRechargeMult', 'pct', 0.05, 'Vector Thrusters'),
    T('moveSpeedMult', 'pct', 0.02, 'Light Chassis', 0.8),
    T('elementalPower', 'pct', 0.04, 'Elemental Resonance'),
    T('abilityPowerMult', 'pct', 0.04, 'Payload Tuning', 0.8),
    T('abilityCooldownMult', 'pct', -0.03, 'Quick Recharge', 0.8),
    T('ultChargeMult', 'pct', 0.05, 'Ultimate Relay', 0.6),
  ],
};

/** Keystones: strong trade-offs. Each branch rotates through its list by ring. */
const KEYSTONES: Record<Branch, { name: string; mods: TreeMod[]; rule?: Partial<TreeRules> }[]> = {
  hull: [
    { name: 'Fortress Core', mods: [{ stat: 'maxHealthMult', op: 'pct', value: 0.18 }, { stat: 'moveSpeedMult', op: 'pct', value: -0.06 }] },
    { name: 'Aegis Overflow', mods: [{ stat: 'shieldCapacity', op: 'add', value: 40 }, { stat: 'maxHealthMult', op: 'pct', value: -0.08 }] },
    { name: 'Stalwart', mods: [{ stat: 'damageResist', op: 'add', value: 0.06 }, { stat: 'fireRateMult', op: 'pct', value: -0.05 }] },
  ],
  weapon: [
    { name: 'Glass Cannon', mods: [{ stat: 'weaponDamageMult', op: 'pct', value: 0.2 }, { stat: 'maxHealthMult', op: 'pct', value: -0.12 }] },
    { name: 'Overclock', mods: [{ stat: 'fireRateMult', op: 'pct', value: 0.15 }, { stat: 'heatEfficiency', op: 'pct', value: -0.15 }] },
    { name: 'Executioner', mods: [{ stat: 'critMultiplier', op: 'add', value: 0.5 }, { stat: 'critChance', op: 'add', value: -0.02 }] },
  ],
  tower: [
    { name: 'Field Foundry', mods: [{ stat: 'buildCostMult', op: 'pct', value: -0.15 }, { stat: 'heatEfficiency', op: 'pct', value: -0.12 }] },
    { name: 'Commander', mods: [{ stat: 'turretDamageMult', op: 'pct', value: 0.25 }, { stat: 'weaponDamageMult', op: 'pct', value: -0.08 }] },
    { name: 'Forward Depot', mods: [{ stat: 'coreIncomeMult', op: 'pct', value: -0.05 }], rule: { startCores: 120 } },
  ],
  tactical: [
    { name: 'Veteran Instinct', mods: [{ stat: 'tacticalRechargeMult', op: 'pct', value: -0.1 }], rule: { xpMult: 0.15 } },
    { name: 'Afterburner', mods: [{ stat: 'moveSpeedMult', op: 'pct', value: 0.1 }, { stat: 'maxHealthMult', op: 'pct', value: -0.06 }] },
    { name: 'Rift Attunement', mods: [{ stat: 'elementalPower', op: 'pct', value: 0.25 }, { stat: 'critChance', op: 'add', value: -0.02 }] },
  ],
};

/** Soft cap per stat: the summed bonus approaches cap but never reaches it. */
function softCap(t: Template): number {
  return Math.abs(t.v) * 12;
}
const CAP: Partial<Record<StatKey, number>> = {};
for (const b of BRANCHES) for (const t of TEMPLATES[b]) CAP[t.stat] = Math.max(CAP[t.stat] ?? 0, softCap(t));

export const ringScale = (ring: number): number => 1 + 0.15 * (Math.max(1, ring) - 1);
export const KEYSTONE_EVERY = 3;

const round = (v: number) => Math.round(v * 10000) / 10000;

function pick<T extends { w: number }>(rand: () => number, list: T[]): T {
  const total = list.reduce((s, x) => s + x.w, 0);
  let r = rand() * total;
  for (const x of list) if ((r -= x.w) <= 0) return x;
  return list[list.length - 1];
}

/** Nodes per branch in a ring. */
export const nodesPerBranch = (ring: number): number => Math.min(5, 2 + Math.floor((ring - 1) / 2));

const SECTOR = (Math.PI * 2) / BRANCHES.length;

function genRing(seed: number, ring: number, prev: TreeNode[]): TreeNode[] {
  const rand = mulberry32((seed ^ Math.imul(ring, 0x9e3779b1) ^ (TREE_VERSION << 24)) >>> 0);
  const out: TreeNode[] = [];
  const scale = ringScale(ring);
  BRANCHES.forEach((branch, bi) => {
    const n = nodesPerBranch(ring);
    const keyIdx = ring % KEYSTONE_EVERY === 0 ? Math.floor(n / 2) : -1;
    const parentsPool = prev.filter((p) => p.branch === branch);
    for (let k = 0; k < n; k++) {
      const jitter = (rand() - 0.5) * 0.35;
      const angle = bi * SECTOR + ((k + 0.5 + jitter) / n) * SECTOR;
      let node: TreeNode;
      const id = `r${ring}${BRANCH_CODE[branch]}${k}`;
      if (k === keyIdx) {
        const list = KEYSTONES[branch];
        const ks = list[(Math.floor(ring / KEYSTONE_EVERY) - 1) % list.length];
        const lvl = 1 + Math.floor((ring / KEYSTONE_EVERY - 1) / list.length) * 0.5;
        node = { id, ring, branch, angle, kind: 'keystone', name: ks.name, mods: ks.mods.map((m) => ({ ...m, value: round(m.value * lvl) })), rule: ks.rule && Object.fromEntries(Object.entries(ks.rule).map(([key, v]) => [key, round((v ?? 0) * lvl)])), parents: [] };
      } else {
        const notable = ring >= 2 && rand() < 0.22;
        const a = pick(rand, TEMPLATES[branch]);
        const mods: TreeMod[] = [{ stat: a.stat, op: a.op, value: round(a.v * scale * (notable ? 1.6 : 1)) }];
        let name = a.name;
        if (notable) {
          const rest = TEMPLATES[branch].filter((t) => t.stat !== a.stat);
          const b = pick(rand, rest);
          mods.push({ stat: b.stat, op: b.op, value: round(b.v * scale * 1.6) });
          name = `${a.name.split(' ')[0]} ${b.name.split(' ').slice(-1)[0]}`;
        }
        node = { id, ring, branch, angle, kind: notable ? 'notable' : 'minor', name, mods, parents: [] };
      }
      // Parents: nearest node(s) of the same branch one ring inward (ring 1 hangs off the core).
      if (ring === 1 || parentsPool.length === 0) node.parents = [CORE_ID];
      else {
        const sorted = [...parentsPool].sort((p, q) => Math.abs(p.angle - angle) - Math.abs(q.angle - angle));
        node.parents = [sorted[0].id];
        if (sorted[1] && rand() < 0.4) node.parents.push(sorted[1].id);
      }
      out.push(node);
    }
  });
  return out;
}

export interface SkillTree {
  seed: number;
  rings: number;
  nodes: TreeNode[];
  byId: Map<string, TreeNode>;
}

const cache = new Map<string, SkillTree>();

/** Deterministic tree with `rings` rings revealed. */
export function generateTree(seed: number, rings: number): SkillTree {
  const r = Math.max(1, Math.min(400, Math.floor(rings)));
  const key = `${seed >>> 0}:${r}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const nodes: TreeNode[] = [];
  let prev: TreeNode[] = [];
  for (let i = 1; i <= r; i++) {
    prev = genRing(seed >>> 0, i, prev);
    nodes.push(...prev);
  }
  const tree: SkillTree = { seed: seed >>> 0, rings: r, nodes, byId: new Map(nodes.map((n) => [n.id, n])) };
  if (cache.size > 16) cache.clear();
  cache.set(key, tree);
  return tree;
}

export const treeForLevel = (seed: number, level: number): SkillTree => generateTree(seed, ringsAt(level));

/** Why a node cannot be allocated (null = it can). */
export function allocateBlocker(tree: SkillTree, allocated: readonly string[], id: string, level: number): string | null {
  const node = tree.byId.get(id);
  if (!node) return 'Unknown node';
  if (node.ring > ringsAt(level)) return 'Ring not revealed yet';
  const have = new Set(allocated);
  if (have.has(id)) return 'Already allocated';
  if (allocated.length >= pointsAt(level)) return 'No skill points left';
  if (!node.parents.some((p) => p === CORE_ID || have.has(p))) return 'Allocate a connected node first';
  return null;
}

/** Keep only allocations that are valid in order (connected, revealed, within the point budget). */
export function pruneAllocation(seed: number, level: number, allocated: readonly string[]): string[] {
  const tree = treeForLevel(seed, level);
  const out: string[] = [];
  for (const id of allocated) if (allocateBlocker(tree, out, id, level) === null) out.push(id);
  return out;
}

export const freePoints = (level: number, allocated: readonly string[]): number => Math.max(0, pointsAt(level) - allocated.length);

/** Credits for the next full respec (escalates, bounded). */
export const respecCost = (respecs: number): number => Math.min(5000, 150 + 150 * Math.max(0, Math.floor(respecs)));

/** Combined stat modifiers of the allocated nodes (per-stat soft cap, source 'tree'). */
export function treeModifiers(seed: number, allocated: readonly string[]): StatModifier[] {
  if (!allocated.length) return [];
  const tree = generateTree(seed, maxRing(allocated));
  const sums = new Map<string, { stat: StatKey; op: StatOp; value: number }>();
  for (const id of allocated) {
    const n = tree.byId.get(id);
    if (!n) continue;
    for (const m of n.mods) {
      const k = `${m.stat}|${m.op}`;
      const s = sums.get(k) ?? { stat: m.stat, op: m.op, value: 0 };
      s.value += m.value;
      sums.set(k, s);
    }
  }
  const out: StatModifier[] = [];
  for (const s of sums.values()) {
    const cap = CAP[s.stat] ?? Math.abs(s.value) * 2;
    const eff = s.value >= 0 ? cap * (1 - Math.exp(-s.value / cap)) : s.value; // penalties are never softened
    if (eff !== 0) out.push({ stat: s.stat, op: s.op, value: round(eff), source: 'tree' });
  }
  return out;
}

/** Rule effects of the allocated keystones. */
export function treeRules(seed: number, allocated: readonly string[]): TreeRules {
  const rules: TreeRules = { xpMult: 1, startCores: 0 };
  if (!allocated.length) return rules;
  const tree = generateTree(seed, maxRing(allocated));
  for (const id of allocated) {
    const r = tree.byId.get(id)?.rule;
    if (!r) continue;
    rules.xpMult += r.xpMult ?? 0;
    rules.startCores += r.startCores ?? 0;
  }
  return rules;
}

/** Highest ring referenced by a list of node ids. */
export function maxRing(ids: readonly string[]): number {
  let m = 1;
  for (const id of ids) {
    const r = /^r(\d+)/.exec(id);
    if (r) m = Math.max(m, Math.min(400, Number(r[1])));
  }
  return m;
}

/** Human-readable description of a modifier. */
export function describeMod(m: TreeMod, label: (k: StatKey) => string, kind: (k: StatKey) => string): string {
  const sign = m.value >= 0 ? '+' : '−';
  const v = Math.abs(m.value);
  const k = kind(m.stat);
  const txt = m.op === 'pct' || k === 'chance' || k === 'ratio' ? `${Math.round(v * 1000) / 10}%` : `${Math.round(v * 100) / 100}`;
  return `${sign}${txt} ${label(m.stat)}`;
}

export function describeRule(r: Partial<TreeRules>): string[] {
  const out: string[] = [];
  if (r.xpMult) out.push(`+${Math.round(r.xpMult * 100)}% Warden XP`);
  if (r.startCores) out.push(`Start every operation with +${r.startCores} cores`);
  return out;
}
