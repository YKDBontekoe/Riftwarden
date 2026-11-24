import { BEAM_EMITTER, FLAMER, LAUNCHER, type Mechanism, PLASMA_REPEATER, RAILGUN, SWARM_HIVE, type WeaponDef, type WeaponFamily } from '../data/defs';
import { type ComponentDef, componentDef, componentsFor, type ComponentEffects } from './components';

/**
 * Weapon build: the persisted, fully rolled configuration of a generated weapon (pure).
 * The model builder, the stat composition and the UI all read this structure; nothing
 * about a weapon's look or behaviour is re-derived from a seed after generation.
 */
export type SocketKind = 'barrel' | 'power' | 'system';
export type Finish = 'arctic' | 'gunmetal' | 'sand' | 'slate' | 'gilded' | 'iridescent' | 'ascended';

export interface WeaponBuild {
  /** Build schema version. */
  v: number;
  family: WeaponFamily;
  /** Chassis = the weapon's base item id. */
  chassis: string;
  barrel: string;
  core: string;
  cooling: string;
  /** Mechanism component id (mc_*). */
  mechanism: string;
  attachments: string[];
  finish: Finish;
  /** Appearance parameters 0..1 (barrel length, body bulk, energy hue shift). Length also scales range slightly. */
  params: { length: number; bulk: number; hue: number };
  /** Kind of every module socket (length = item.sockets). */
  sockets: SocketKind[];
}

export const BUILD_VERSION = 1;

export interface FamilyDef {
  id: WeaponFamily;
  label: string;
  role: string;
  template: WeaponDef;
  /** Socket kinds in fill order (rarity decides how many are opened). */
  socketPattern: SocketKind[];
  /** Linear HDR energy colour. */
  energy: [number, number, number];
}

export const FAMILIES: Readonly<Record<WeaponFamily, FamilyDef>> = {
  plasma: { id: 'plasma', label: 'Plasma Repeater', role: 'Fast automatic fire, rapid heat build-up', template: PLASMA_REPEATER, socketPattern: ['barrel', 'power', 'system', 'system'], energy: [0.3, 1.7, 2.6] },
  rail: { id: 'rail', label: 'Railgun', role: 'Charged precision slugs that pierce targets', template: RAILGUN, socketPattern: ['power', 'barrel', 'system', 'power'], energy: [1.9, 0.7, 3.8] },
  beam: { id: 'beam', label: 'Beam Emitter', role: 'Continuous beam, damage ramps on a held target', template: BEAM_EMITTER, socketPattern: ['power', 'system', 'barrel', 'system'], energy: [0.5, 2.6, 0.9] },
  swarm: { id: 'swarm', label: 'Drone Swarm', role: 'Seeker drones that lock onto machines near the crosshair', template: SWARM_HIVE, socketPattern: ['system', 'power', 'barrel', 'system'], energy: [2.6, 1.7, 0.35] },
  launcher: { id: 'launcher', label: 'Launcher', role: 'Rockets that detonate on impact: splash damage around every hit', template: LAUNCHER, socketPattern: ['power', 'barrel', 'system', 'power'], energy: [2.7, 0.95, 0.25] },
  flamer: { id: 'flamer', label: 'Flamer', role: 'Short-range stream that sweeps several machines and stacks statuses', template: FLAMER, socketPattern: ['system', 'power', 'barrel', 'system'], energy: [2.9, 1.2, 0.2] },
};

export const SOCKET_LABEL: Record<SocketKind, string> = { barrel: 'BARREL', power: 'POWER', system: 'SYSTEM' };

export const FINISHES: Finish[] = ['arctic', 'gunmetal', 'sand', 'slate'];

function pick<T>(items: readonly T[], weight: (t: T) => number, rand: () => number): T {
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  let x = rand() * total;
  for (const it of items) {
    x -= Math.max(0, weight(it));
    if (x < 0) return it;
  }
  return items[items.length - 1];
}

/** Attachment count range per rarity index. */
const ATTACHMENTS: [number, number][] = [[0, 1], [1, 1], [1, 2], [2, 2], [2, 3], [3, 3], [3, 3]];

/**
 * Roll a valid component combination for a family. Only components offered for the
 * family (and rarity) are drawn, so every result has geometry and supported mechanics.
 */
/** `exclude`: component ids the warden has not mastered yet (one rand draw per pick either way, so streams never shift). */
export function rollBuild(rand: () => number, family: WeaponFamily, chassis: string, rarityIndex: number, sockets: number, exclude: readonly string[] = []): WeaponBuild {
  const ri = Math.max(0, Math.min(6, rarityIndex));
  const open = (slot: 'barrel' | 'core' | 'cooling' | 'mechanism' | 'attachment') => {
    const all = componentsFor(slot, family, ri);
    const ok = exclude.length ? all.filter((c) => !exclude.includes(c.id)) : all;
    return ok.length ? ok : all;
  };
  const one = (slot: 'barrel' | 'core' | 'cooling' | 'mechanism') => pick(open(slot), (c) => c.weight * (c.minRarity ? 2 : 1), rand).id;
  const barrel = one('barrel');
  const core = one('core');
  const cooling = one('cooling');
  const mechanism = one('mechanism');
  const [lo, hi] = ATTACHMENTS[ri];
  const n = lo + Math.floor(rand() * (hi - lo + 1));
  const pool = [...open('attachment')];
  const attachments: string[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    const c = pick(pool, (x) => x.weight, rand);
    attachments.push(c.id);
    pool.splice(pool.indexOf(c), 1);
  }
  const finish: Finish = ri === 6 ? 'ascended' : ri === 5 ? 'iridescent' : ri === 4 ? 'gilded' : FINISHES[Math.floor(rand() * FINISHES.length)];
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const params = { length: r2(rand()), bulk: r2(rand()), hue: r2(rand()) };
  return { v: BUILD_VERSION, family, chassis, barrel, core, cooling, mechanism, attachments, finish, params, sockets: socketKinds(family, sockets) };
}

export function socketKinds(family: WeaponFamily, count: number): SocketKind[] {
  const pat = FAMILIES[family].socketPattern;
  return Array.from({ length: Math.max(0, Math.min(8, Math.floor(count))) }, (_, i) => pat[i % pat.length]);
}

/** Plain default barrel + mechanism per family (starter kit, pre-M3 weapons, repairs). */
export const DEFAULT_PARTS: Readonly<Record<WeaponFamily, { barrel: string; mechanism: string }>> = {
  plasma: { barrel: 'pb_single', mechanism: 'mc_auto' },
  rail: { barrel: 'rb_open', mechanism: 'mc_charge' },
  beam: { barrel: 'be_lens', mechanism: 'mc_beam' },
  swarm: { barrel: 'sw_pod', mechanism: 'mc_swarm' },
  launcher: { barrel: 'ln_tube', mechanism: 'mc_rocket' },
  flamer: { barrel: 'fl_nozzle', mechanism: 'mc_spray' },
};

/** Deterministic default build for weapons created before M3 (stats are left untouched). */
export function defaultBuild(chassis: string, family: WeaponFamily = 'plasma', sockets = 0): WeaponBuild {
  const barrel = family === 'plasma' ? (chassis === 'light_repeater' ? 'pb_twin' : 'pb_single') : DEFAULT_PARTS[family].barrel;
  const mechanism = DEFAULT_PARTS[family].mechanism;
  return { v: BUILD_VERSION, family, chassis, barrel, core: 'co_cell', cooling: 'cl_fins', mechanism, attachments: [], finish: 'arctic', params: { length: 0.5, bulk: chassis === 'heavy_repeater' ? 0.8 : 0.5, hue: 0.5 }, sockets: socketKinds(family, sockets) };
}

/** Components of a build in display order (barrel, core, cooling, mechanism, attachments). */
export function buildComponents(b: WeaponBuild): ComponentDef[] {
  return [b.barrel, b.core, b.cooling, b.mechanism, ...b.attachments].map((id) => componentDef(id)).filter((c): c is ComponentDef => !!c);
}

export function buildMechanism(b: WeaponBuild | undefined): Mechanism | undefined {
  return b ? componentDef(b.mechanism)?.mechanism : undefined;
}

/** Product of all component effects (pierce summed), plus the barrel-length range factor. */
export function buildEffects(b: WeaponBuild): Required<ComponentEffects> {
  const out: Required<ComponentEffects> = { damage: 1, fireRate: 1, heatPerShot: 1, coolRate: 1, range: 1, accuracy: 1, chargeTime: 1, beamWidth: 1, rampMax: 1, pierce: 0, seekCone: 1, drones: 0, splash: 1, spray: 1, targets: 0 };
  for (const c of buildComponents(b)) {
    for (const k of Object.keys(c.effects) as (keyof ComponentEffects)[]) {
      const v = c.effects[k]!;
      if (k === 'pierce' || k === 'drones' || k === 'targets') out[k] += v;
      else out[k] *= v;
    }
  }
  out.range *= 0.96 + 0.08 * b.params.length;
  return out;
}

/**
 * True when every component exists, belongs to the slot and family, and the mechanism is
 * one the family supports. Used by sanitize (invalid builds fall back to the default).
 */
export function isValidBuild(b: WeaponBuild): boolean {
  const ok = (id: string, slot: ComponentDef['slot']) => {
    const c = componentDef(id);
    return !!c && c.slot === slot && c.families.includes(b.family);
  };
  if (!FAMILIES[b.family]) return false;
  if (!ok(b.barrel, 'barrel') || !ok(b.core, 'core') || !ok(b.cooling, 'cooling') || !ok(b.mechanism, 'mechanism')) return false;
  if (new Set(b.attachments).size !== b.attachments.length || !b.attachments.every((a) => ok(a, 'attachment'))) return false;
  const p = b.params;
  return [p.length, p.bulk, p.hue].every((v) => Number.isFinite(v) && v >= 0 && v <= 1);
}
