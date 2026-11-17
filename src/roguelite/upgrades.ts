import { mulberry32 } from '../combat/damage';
import type { StatModifier } from '../combat/stats';
import type { WeaponFamily } from '../data/defs';
import type { Archetype } from '../towers/components';

/**
 * M5 temporary run upgrades (pure data + selection + RunBuild).
 *
 * Upgrades live ONLY in a RunBuild owned by the arena `Game`; nothing here is ever written to
 * the save, so checkpoint banking cannot make them permanent and a new run starts empty.
 * Each upgrade is either plain StatModifiers (`stats`, applied per stack through the shared
 * stat pipeline) and/or registered effects (src/combat/effects.ts keyed by the same id).
 * The numbers used by effects and by descriptions come from `UP`, so text can't drift from behaviour.
 */
export type UpgradeRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type UpgradeCategory = 'weapon' | 'elemental' | 'defense' | 'mobility' | 'tower' | 'economy' | 'synergy';
export const RARITY_ORDER: readonly UpgradeRarity[] = ['common', 'rare', 'epic', 'legendary'];
export const RARITY_COLOR: Record<UpgradeRarity, string> = { common: '#9fb4c4', rare: '#4da3ff', epic: '#b366ff', legendary: '#ffb03b' };
export const CATEGORY_LABEL: Record<UpgradeCategory, string> = { weapon: 'WEAPON', elemental: 'ELEMENTAL', defense: 'DEFENSE', mobility: 'MOBILITY', tower: 'TOWER', economy: 'ECONOMY', synergy: 'SYNERGY' };

/** Shared numbers (stack count n >= 1). */
export const UP = {
  static: { chance: (n: number) => 0.2 * n, jumps: 2, dmg: 0.4 },
  stormCrit: { jumps: (n: number) => 2 + n, dmg: (n: number) => 0.35 + 0.1 * n },
  ignite: { chance: (n: number) => 0.3 + 0.1 * n, dps: (n: number) => 0.35 + 0.1 * n },
  cryo: { chill: (n: number) => 3 + 4 * n },
  conductive: { targets: (n: number) => 2 * n, radius: 6, chill: 25 },
  ember: { radius: 5, hit: 1.5, burn: 6 },
  stormfall: { chance: 0.7, radius: 5, dmg: 2.5, jumps: 4, jdmg: 0.5 },
  fission: { frags: 2, dmg: 0.35, radius: 9 },
  leech: { shield: (n: number) => 4 * n },
  surge: { dur: 3, move: (n: number) => 0.1 * n, rate: (n: number) => 0.08 * n },
  shockdash: { radius: 8, dmg: 2.5 },
  sync: { dur: (n: number) => 4 + 1.5 * (n - 1), radius: 30 },
  detonate: { mult: (n: number) => 0.75 * n, radius: 3 },
  precision: { crit: (n: number) => 0.12 * n, critDmg: (n: number) => 0.2 * n },
  feedback: { dur: 5, cool: (n: number) => 0.3 * n },
  network: { need: 20, radius: 35, mult: 2 },
  mentor: { per: (n: number) => 0.05 * n, dur: 6, max: 8 },
  conductor: { towers: 3, chance: 0.35, radius: 40 },
  grid: { need: 30, jumps: 8, dmg: 2 },
  rush: { perSec: (n: number) => 2 * n, cap: 150 },
  infuse: { burn: (n: number) => 0.3 * n },
  parallel: { extra: (n: number) => n },
} as const;

export interface UpgradeDef {
  id: string;
  name: string;
  rarity: UpgradeRarity;
  category: UpgradeCategory;
  /** Used for build affinity weighting and prerequisites. */
  tags: readonly string[];
  icon: string;
  maxStacks: number;
  minWave?: number;
  /** StatModifiers applied once per stack. */
  stats?: readonly StatModifier[];
  /** Requirements (all must hold). */
  needs?: { towers?: boolean; notFamily?: readonly WeaponFamily[]; anyTag?: readonly string[]; towerArch?: readonly Archetype[] };
  /** Functional description at stack count n (what the upgrade does once taken). */
  text(n: number): string;
  /** Synergy note shown on the card. */
  hint?: string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const m = (stat: StatModifier['stat'], op: StatModifier['op'], value: number): StatModifier => ({ stat, op, value });

export const UPGRADES: readonly UpgradeDef[] = [
  // ---- weapon
  { id: 'w_calibrated', name: 'Calibrated Emitters', rarity: 'common', category: 'weapon', tags: ['weapon', 'damage'], icon: '✦', maxStacks: 5, stats: [m('weaponDamageMult', 'pct', 0.15)], text: (n) => `+15% weapon damage per stack (total +${pct(0.15 * n)}).` },
  { id: 'w_overclock', name: 'Overclocked Feed', rarity: 'common', category: 'weapon', tags: ['weapon', 'rate'], icon: '≫', maxStacks: 4, stats: [m('fireRateMult', 'pct', 0.1), m('heatEfficiency', 'pct', 0.05)], text: (n) => `+10% fire rate and +5% heat efficiency per stack (total +${pct(0.1 * n)} fire rate).` },
  { id: 'w_heatsink', name: 'Heat Sink Array', rarity: 'common', category: 'weapon', tags: ['weapon', 'heat'], icon: '❄', maxStacks: 4, stats: [m('coolRateMult', 'pct', 0.2), m('heatEfficiency', 'pct', 0.15)], text: (n) => `+20% cooling speed and +15% heat efficiency per stack (total +${pct(0.15 * n)} heat efficiency).` },
  { id: 'w_crit', name: 'Crit Tuning', rarity: 'rare', category: 'weapon', tags: ['weapon', 'crit'], icon: '◎', maxStacks: 3, stats: [m('critChance', 'add', 0.08), m('critMultiplier', 'add', 0.25)], text: (n) => `+8% critical chance and +0.25x critical damage per stack (total +${pct(0.08 * n)} / +${(0.25 * n).toFixed(2)}x).` },
  { id: 'w_multishot', name: 'Parallel Barrels', rarity: 'rare', category: 'weapon', tags: ['weapon', 'projectiles'], icon: '⫴', maxStacks: 2, needs: { notFamily: ['beam'] }, stats: [m('projectiles', 'add', 1)], text: (n) => `+1 projectile per shot (total ${1 + n}). Each projectile rolls its own damage and crit.` },
  { id: 'w_pierce', name: 'Penetrator Slugs', rarity: 'rare', category: 'weapon', tags: ['weapon', 'pierce'], icon: '➤', maxStacks: 2, needs: { notFamily: ['beam'] }, stats: [m('pierce', 'add', 1)], text: (n) => `Shots pass through +1 enemy per stack (total +${n}); each pass deals 15% less.` },
  { id: 'w_fission', name: 'Fission Rounds', rarity: 'epic', category: 'weapon', tags: ['weapon', 'projectiles', 'split'], icon: '⋔', minWave: 2, maxStacks: 1, text: () => `Weapon hits split into ${UP.fission.frags} fragments that strike the nearest other enemies within ${UP.fission.radius} m for ${pct(UP.fission.dmg)} damage.`, hint: 'Fragments inherit element but cannot split again.' },
  // ---- elemental
  { id: 'e_static', name: 'Static Rounds', rarity: 'common', category: 'elemental', tags: ['elemental', 'electric'], icon: 'ϟ', maxStacks: 3, text: (n) => `Weapon hits have a ${pct(UP.static.chance(n))} chance to arc lightning to ${UP.static.jumps} enemies for ${pct(UP.static.dmg)} damage and shock them.` },
  { id: 'e_stormcrit', name: 'Storm Crit', rarity: 'rare', category: 'elemental', tags: ['elemental', 'electric', 'crit', 'storm'], icon: 'ϟϟ', maxStacks: 3, text: (n) => `Critical hits chain lightning to ${UP.stormCrit.jumps(n)} additional enemies, dealing ${pct(UP.stormCrit.dmg(n))} of the hit.`, hint: 'Weakpoint hits always crit.' },
  { id: 'e_ignite', name: 'Incendiary Rounds', rarity: 'common', category: 'elemental', tags: ['elemental', 'thermal'], icon: '♨', maxStacks: 3, text: (n) => `Weapon hits have a ${pct(UP.ignite.chance(n))} chance to ignite: ${pct(UP.ignite.dps(n))} of the hit per second for 4 s (stacks to 5).`, hint: 'Electric hits on burning enemies trigger Overload.' },
  { id: 'e_cryo', name: 'Cryo Coolant', rarity: 'common', category: 'elemental', tags: ['elemental', 'cryo'], icon: '❅', maxStacks: 3, text: (n) => `Weapon hits add ${UP.cryo.chill(n)} chill. Chilled enemies slow down (up to 55%), freeze at full chill, and take extra damage.`, hint: 'Thermal hits on chilled enemies trigger Thermal Shock.' },
  { id: 'e_conductive', name: 'Conductive Spread', rarity: 'rare', category: 'elemental', tags: ['elemental', 'electric', 'spread'], icon: '⌬', maxStacks: 2, needs: { anyTag: ['electric'] }, text: (n) => `Electric hits on burning or chilled enemies spread that status to ${UP.conductive.targets(n)} other enemies within ${UP.conductive.radius} m.` },
  { id: 'e_ember', name: 'Ember Burst', rarity: 'epic', category: 'elemental', tags: ['elemental', 'thermal', 'death'], icon: '☄', maxStacks: 1, needs: { anyTag: ['thermal'] }, text: () => `Burning enemies explode on death: ${UP.ember.radius} m blast, ${pct(UP.ember.hit)} of your weapon damage plus their burn, igniting survivors.`, hint: 'Explosions can chain into further deaths (limited depth).' },
  { id: 'l_stormfall', name: 'Stormfall', rarity: 'legendary', category: 'elemental', tags: ['elemental', 'electric', 'death'], icon: '⚡', minWave: 4, maxStacks: 1, needs: { anyTag: ['electric'] }, text: () => `Enemies killed by electric damage have a ${pct(UP.stormfall.chance)} chance to burst: ${UP.stormfall.radius} m lightning explosion for ${UP.stormfall.dmg}x weapon damage that also chains ${UP.stormfall.jumps} jumps. Kills from the storm can cascade.` },
  // ---- defense / mobility
  { id: 'd_aegis', name: 'Aegis Matrix', rarity: 'common', category: 'defense', tags: ['defense', 'shield'], icon: '⛨', maxStacks: 4, stats: [m('shieldCapacity', 'add', 30), m('shieldRegen', 'add', 5)], text: (n) => `+30 shield capacity and +5 shield regen/s per stack (total +${30 * n} / +${5 * n}).` },
  { id: 'd_plating', name: 'Hardened Plating', rarity: 'common', category: 'defense', tags: ['defense'], icon: '▣', maxStacks: 3, stats: [m('damageResist', 'add', 0.06)], text: (n) => `+6% damage resistance per stack (total +${pct(0.06 * n)}, capped at 60%).` },
  { id: 'd_barrier', name: 'Crit Barrier', rarity: 'rare', category: 'defense', tags: ['defense', 'shield', 'crit'], icon: '◈', maxStacks: 3, text: (n) => `Critical hits restore ${UP.leech.shield(n)} shield (at most 5 times per second).` },
  { id: 'm_vector', name: 'Vector Thrusters', rarity: 'common', category: 'mobility', tags: ['mobility'], icon: '⇧', maxStacks: 3, stats: [m('moveSpeedMult', 'pct', 0.08), m('dashRechargeMult', 'pct', 0.15)], text: (n) => `+8% hover speed and +15% dash recharge per stack (total +${pct(0.08 * n)} / +${pct(0.15 * n)}).` },
  { id: 'm_surge', name: 'Adrenal Surge', rarity: 'rare', category: 'mobility', tags: ['mobility', 'rate', 'kill'], icon: '⚑', maxStacks: 3, text: (n) => `Kills grant ${UP.surge.dur} s of +${pct(UP.surge.move(n))} movement speed and +${pct(UP.surge.rate(n))} fire rate (refreshes).` },
  { id: 'm_shockdash', name: 'Shockwave Dash', rarity: 'epic', category: 'mobility', tags: ['mobility', 'electric', 'dash'], icon: '≋', maxStacks: 1, text: () => `Dashing releases an electric shockwave: ${UP.shockdash.radius} m radius, ${UP.shockdash.dmg}x weapon damage, shocks enemies.` },
  // ---- tower
  { id: 't_servo', name: 'Servo Tuning', rarity: 'common', category: 'tower', tags: ['tower', 'rate'], icon: '⚙', maxStacks: 4, needs: { towers: true }, stats: [m('turretFireRateMult', 'pct', 0.15)], text: (n) => `+15% tower fire rate per stack (total +${pct(0.15 * n)}).` },
  { id: 't_amps', name: 'Damage Amplifier', rarity: 'common', category: 'tower', tags: ['tower', 'damage'], icon: '⬆', maxStacks: 4, needs: { towers: true }, stats: [m('turretDamageMult', 'pct', 0.15)], text: (n) => `+15% tower damage per stack (total +${pct(0.15 * n)}).` },
  { id: 't_optics', name: 'Long-Range Optics', rarity: 'common', category: 'tower', tags: ['tower', 'range'], icon: '◉', maxStacks: 3, needs: { towers: true }, stats: [m('turretRangeMult', 'pct', 0.1)], text: (n) => `+10% tower range per stack (total +${pct(0.1 * n)}).` },
  { id: 't_parallel', name: 'Parallel Targeting', rarity: 'rare', category: 'tower', tags: ['tower', 'multi'], icon: '⋮', maxStacks: 2, needs: { towers: true, towerArch: ['ballistic', 'arc'] }, text: (n) => `Ballistic towers fire at +${UP.parallel.extra(n)} extra enemies; Arc towers chain +${UP.parallel.extra(n)} jumps.` },
  { id: 't_infuse', name: 'Thermal Infusion', rarity: 'rare', category: 'tower', tags: ['tower', 'thermal'], icon: '♨', maxStacks: 2, needs: { towers: true, towerArch: ['ballistic', 'arc'] }, text: (n) => `Tower hits ignite: ${pct(UP.infuse.burn(n))} of the hit per second for 4 s.` },
  // ---- economy
  { id: 'x_salvage', name: 'Combat Salvage', rarity: 'common', category: 'economy', tags: ['economy'], icon: '¤', maxStacks: 3, stats: [m('coreIncomeMult', 'pct', 0.2)], text: (n) => `+20% cores from kills per stack (total +${pct(0.2 * n)}).` },
  { id: 'x_prefab', name: 'Prefab Logistics', rarity: 'common', category: 'economy', tags: ['economy', 'tower'], icon: '▤', maxStacks: 3, needs: { towers: true }, stats: [m('buildCostMult', 'pct', -0.1)], text: (n) => `-10% construction, refit and upgrade costs per stack (total -${pct(0.1 * n)}, minimum 50% of base).` },
  { id: 'x_rush', name: 'Rapid Deployment', rarity: 'rare', category: 'economy', tags: ['economy'], icon: '⏩', maxStacks: 2, text: (n) => `Starting a wave early (G) pays ${UP.rush.perSec(n)} cores per skipped preparation second (max ${UP.rush.cap}).` },
  // ---- synergy
  { id: 's_sync', name: 'Phase Sync', rarity: 'epic', category: 'synergy', tags: ['synergy', 'electric', 'tower'], icon: '⟁', maxStacks: 2, needs: { towers: true, anyTag: ['storm'] }, text: (n) => `When Storm Crit lightning strikes, towers within ${UP.sync.radius} m are empowered for ${UP.sync.dur(n)} s: +40% fire rate, +2 chain jumps on Arc towers.`, hint: 'Requires Storm Crit. Empowered towers glow and pulse.' },
  { id: 's_detonate', name: 'Thermal Detonation', rarity: 'rare', category: 'synergy', tags: ['synergy', 'thermal', 'tower'], icon: '✹', maxStacks: 2, needs: { towers: true, anyTag: ['thermal'] }, text: (n) => `Tower hits on burning enemies detonate for ${pct(UP.detonate.mult(n))} of the hit in a ${UP.detonate.radius} m thermal blast.` },
  { id: 's_precision', name: 'Cryogenic Precision', rarity: 'rare', category: 'synergy', tags: ['synergy', 'cryo', 'crit'], icon: '⌖', maxStacks: 2, needs: { anyTag: ['cryo'], towerArch: ['cryo'] }, text: (n) => `Against chilled or slowed enemies your weapon gains +${pct(UP.precision.crit(n))} crit chance and +${pct(UP.precision.critDmg(n))} crit damage.`, hint: 'Also offered when a Cryogenic Field Projector is built.' },
  { id: 's_feedback', name: 'Defensive Feedback Loop', rarity: 'rare', category: 'synergy', tags: ['synergy', 'tower', 'heat'], icon: '↺', maxStacks: 3, needs: { towers: true }, text: (n) => `Tower kills give your weapon +${pct(UP.feedback.cool(n))} cooling speed for ${UP.feedback.dur} s.` },
  { id: 's_mentor', name: 'Battle Network Link', rarity: 'rare', category: 'synergy', tags: ['synergy', 'tower', 'damage'], icon: '⛓', maxStacks: 2, needs: { towers: true }, text: (n) => `Each tower kill gives +${pct(UP.mentor.per(n))} weapon damage for ${UP.mentor.dur} s (stacks up to ${UP.mentor.max}x).` },
  { id: 's_network', name: 'Overcharge Network', rarity: 'epic', category: 'synergy', tags: ['synergy', 'tower', 'electric'], icon: '⧉', maxStacks: 1, needs: { towers: true }, text: () => `Weapon hits build network charge. At ${UP.network.need}, every tower within ${UP.network.radius} m fires an Overcharge Discharge: an instant ${UP.network.mult}x damage attack with extra reach.` },
  { id: 'l_conductor', name: 'Conductor Link', rarity: 'legendary', category: 'synergy', tags: ['synergy', 'tower', 'crit'], icon: '⚯', minWave: 4, maxStacks: 1, needs: { towers: true }, text: () => `Weapon critical hits have a ${pct(UP.conductor.chance)} chance to make the ${UP.conductor.towers} nearest towers (within ${UP.conductor.radius} m) fire instantly, ignoring cooldown.` },
  { id: 'l_grid', name: 'Grid Capacitor', rarity: 'legendary', category: 'synergy', tags: ['synergy', 'tower', 'electric'], icon: '⎈', minWave: 4, maxStacks: 1, needs: { towers: true }, text: () => `Every tower attack charges your drone. At ${UP.grid.need} charge it discharges a storm: ${UP.grid.jumps} lightning strikes on the nearest enemies for ${UP.grid.dmg}x weapon damage.` },
];

export const UPGRADE_BY_ID: ReadonlyMap<string, UpgradeDef> = new Map(UPGRADES.map((u) => [u.id, u]));
export const upgradeDef = (id: string): UpgradeDef | undefined => UPGRADE_BY_ID.get(id);

/** Base selection weights; legendary offers are rare and gated by minWave. */
export const RARITY_WEIGHT: Record<UpgradeRarity, number> = { common: 100, rare: 42, epic: 15, legendary: 4 };
/** How much each shared tag with the current build boosts a candidate (capped), so builds lean without being deterministic. */
export const AFFINITY_PER_TAG = 0.35;
export const AFFINITY_CAP = 2.2;
export const OFFER_SIZE = 3;

export interface OfferContext {
  wave: number;
  family: WeaponFamily;
  towers: number;
  towerArchetypes: readonly Archetype[];
}

/** The run's upgrade selection (stack counts + pick history). */
export class RunBuild {
  readonly stacks = new Map<string, number>();
  readonly picks: { id: string; wave: number }[] = [];
  /** Offers generated so far (part of the deterministic sequence). */
  offers = 0;

  constructor(public seed: number) {}

  reset(seed = this.seed): void {
    this.seed = seed >>> 0;
    this.stacks.clear();
    this.picks.length = 0;
    this.offers = 0;
  }

  count(id: string): number {
    return this.stacks.get(id) ?? 0;
  }
  get total(): number {
    return this.picks.length;
  }

  /** Tags of every owned upgrade (weighted by stacks: counted once per upgrade). */
  ownedTags(): Map<string, number> {
    const t = new Map<string, number>();
    for (const id of this.stacks.keys()) for (const tag of upgradeDef(id)?.tags ?? []) t.set(tag, (t.get(tag) ?? 0) + 1);
    return t;
  }

  /** Stat modifiers: each stack of every owned upgrade contributes its `stats` (rebuilt from scratch). */
  modifiers(): StatModifier[] {
    const out: StatModifier[] = [];
    for (const [id, n] of this.stacks) {
      const d = upgradeDef(id);
      if (!d?.stats) continue;
      for (let i = 0; i < n; i++) for (const s of d.stats) out.push({ ...s, source: `upgrade:${id}` });
    }
    return out;
  }

  eligible(u: UpgradeDef, ctx: OfferContext): boolean {
    if (this.count(u.id) >= u.maxStacks) return false;
    if (u.minWave && ctx.wave < u.minWave) return false;
    const n = u.needs;
    if (!n) return true;
    if (n.towers && ctx.towers <= 0) return false;
    if (n.notFamily?.includes(ctx.family)) return false;
    const tagOk = n.anyTag ? this.hasAnyTag(n.anyTag) : undefined;
    const archOk = n.towerArch ? n.towerArch.some((a) => ctx.towerArchetypes.includes(a)) : undefined;
    // Both given: either route qualifies; one given: it is required.
    if (tagOk !== undefined || archOk !== undefined) return !!(tagOk || archOk);
    return true;
  }

  private hasAnyTag(tags: readonly string[]): boolean {
    for (const id of this.stacks.keys()) if (upgradeDef(id)?.tags.some((t) => tags.includes(t))) return true;
    return false;
  }

  /** Weight of a candidate for the current build and wave. */
  weight(u: UpgradeDef, ctx: OfferContext): number {
    let w = RARITY_WEIGHT[u.rarity];
    // Better rarities become more common with depth (bounded).
    const depth = Math.min(30, Math.max(0, ctx.wave - 1));
    if (u.rarity === 'rare') w *= 1 + depth * 0.03;
    else if (u.rarity === 'epic') w *= 1 + depth * 0.06;
    else if (u.rarity === 'legendary') w *= 1 + depth * 0.08;
    else w *= Math.max(0.5, 1 - depth * 0.01);
    const tags = this.ownedTags();
    let shared = 0;
    for (const t of u.tags) if (t !== u.category && tags.has(t)) shared++;
    w *= Math.min(AFFINITY_CAP, 1 + shared * AFFINITY_PER_TAG);
    // Diminishing interest in more stacks of the same thing.
    w *= Math.pow(0.7, this.count(u.id));
    return w;
  }

  /**
   * Deterministic offer #index: the stream depends only on (seed, index), so the same seed and
   * the same state always yield the same three choices, independent of other randomness.
   */
  roll(ctx: OfferContext, index = this.offers, size = OFFER_SIZE): UpgradeDef[] {
    const rng = mulberry32((this.seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    for (let i = 0; i < 3; i++) rng();
    const pool = UPGRADES.filter((u) => this.eligible(u, ctx));
    const out: UpgradeDef[] = [];
    let legendary = false;
    const catCount = new Map<UpgradeCategory, number>();
    while (out.length < size && pool.length) {
      const ws = pool.map((u) => {
        if (u.rarity === 'legendary' && legendary) return 0;
        return this.weight(u, ctx) * Math.pow(0.5, catCount.get(u.category) ?? 0);
      });
      const total = ws.reduce((a, b) => a + b, 0);
      if (total <= 0) break;
      let r = rng() * total;
      let k = 0;
      for (; k < pool.length - 1; k++) {
        r -= ws[k];
        if (r < 0) break;
      }
      const u = pool.splice(k, 1)[0];
      out.push(u);
      if (u.rarity === 'legendary') legendary = true;
      catCount.set(u.category, (catCount.get(u.category) ?? 0) + 1);
    }
    return out;
  }

  /** Generate the next offer (advances the sequence). */
  nextOffer(ctx: OfferContext): UpgradeDef[] {
    const o = this.roll(ctx, this.offers);
    this.offers++;
    return o;
  }

  /** Take an upgrade. Returns false when unknown or at its stack limit. */
  take(id: string, wave: number): boolean {
    const d = upgradeDef(id);
    if (!d || this.count(id) >= d.maxStacks) return false;
    this.stacks.set(id, this.count(id) + 1);
    this.picks.push({ id, wave });
    return true;
  }

  /** Active synergy/archetype labels for the build overview. */
  archetypes(): { id: string; name: string; score: number }[] {
    const t = this.ownedTags();
    const sc = (k: string) => t.get(k) ?? 0;
    const list = [
      { id: 'storm', name: 'Storm Network', score: sc('electric') + sc('crit') * 0.5 + (this.count('s_sync') + this.count('s_network') + this.count('l_grid')) },
      { id: 'thermal', name: 'Thermal Cascade', score: sc('thermal') + sc('death') * 0.5 },
      { id: 'cryo', name: 'Cryogenic Fortress', score: sc('cryo') + this.count('s_precision') },
      { id: 'drone', name: 'Hypervelocity Drone', score: sc('mobility') + sc('rate') + sc('crit') * 0.5 },
      { id: 'war', name: 'Automated War Machine', score: sc('tower') + sc('economy') * 0.5 },
    ];
    return list.filter((a) => a.score >= 2).sort((a, b) => b.score - a.score);
  }
}

export const hashRunSeed = (s: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
};
