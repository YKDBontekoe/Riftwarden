import { BEAM_EMITTER, type Mechanism, PLASMA_REPEATER, RAILGUN, type WeaponDef, type WeaponFamily } from '../data/defs';
import { type ComponentDef, componentDef, componentsFor, type ComponentEffects } from './components';

/**
 * Weapon build: the persisted, fully rolled configuration of a generated weapon (pure).
 * The model builder, the stat composition and the UI all read this structure; nothing
 * about a weapon's look or behaviour is re-derived from a seed after generation.
 */
export type SocketKind = 'barrel' | 'power' | 'system';
export type Finish = 'arctic' | 'gunmetal' | 'sand' | 'slate' | 'gilded' | 'iridescent';

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
};

export const SOCKET_LABEL: Record<SocketKind, string> = { barrel: 'BARREL', power: 'POWER', system: 'SYSTEM' };

const FINISHES: Finish[] = ['arctic', 'gunmetal', 'sand', 'slate'];

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
const ATTACHMENTS: [number, number][] = [[0, 1], [1, 1], [1, 2], [2, 2], [2, 3], [3, 3]];

/**
 * Roll a valid component combination for a family. Only components offered for the
 * family (and rarity) are drawn, so every result has geometry and supported mechanics.
 */
export function rollBuild(rand: () => number, family: WeaponFamily, chassis: string, rarityIndex: number, sockets: number): WeaponBuild {
  const ri = Math.max(0, Math.min(5, rarityIndex));
  const one = (slot: 'barrel' | 'core' | 'cooling' | 'mechanism') => pick(componentsFor(slot, family, ri), (c) => c.weight * (c.minRarity ? 2 : 1), rand).id;
  const barrel = one('barrel');
  const core = one('core');
  const cooling = one('cooling');
  const mechanism = one('mechanism');
  const [lo, hi] = ATTACHMENTS[ri];
  const n = lo + Math.floor(rand() * (hi - lo + 1));
  const pool = [...componentsFor('attachment', family, ri)];
  const attachments: string[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    const c = pick(pool, (x) => x.weight, rand);
    attachments.push(c.id);
    pool.splice(pool.indexOf(c), 1);
  }
  const finish: Finish = ri === 5 ? 'iridescent' : ri === 4 ? 'gilded' : FINISHES[Math.floor(rand() * FINISHES.length)];
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const params = { length: r2(rand()), bulk: r2(rand()), hue: r2(rand()) };
  return { v: BUILD_VERSION, family, chassis, barrel, core, cooling, mechanism, attachments, finish, params, sockets: socketKinds(family, sockets) };
}

export function socketKinds(family: WeaponFamily, count: number): SocketKind[] {
  const pat = FAMILIES[family].socketPattern;
  return Array.from({ length: Math.max(0, Math.min(8, Math.floor(count))) }, (_, i) => pat[i % pat.length]);
}

/** Deterministic default build for weapons created before M3 (stats are left untouched). */
export function defaultBuild(chassis: string, family: WeaponFamily = 'plasma', sockets = 0): WeaponBuild {
  const barrel = family === 'plasma' ? (chassis === 'light_repeater' ? 'pb_twin' : 'pb_single') : family === 'rail' ? 'rb_open' : 'be_lens';
  const mechanism = family === 'plasma' ? 'mc_auto' : family === 'rail' ? 'mc_charge' : 'mc_beam';
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
  const out: Required<ComponentEffects> = { damage: 1, fireRate: 1, heatPerShot: 1, coolRate: 1, range: 1, accuracy: 1, chargeTime: 1, beamWidth: 1, rampMax: 1, pierce: 0 };
  for (const c of buildComponents(b)) {
    for (const k of Object.keys(c.effects) as (keyof ComponentEffects)[]) {
      const v = c.effects[k]!;
      if (k === 'pierce') out.pierce += v;
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
