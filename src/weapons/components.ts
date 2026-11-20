import type { Mechanism, WeaponFamily } from '../data/defs';

/**
 * Procedural weapon components (pure data).
 *
 * A weapon = family + chassis (its base item) + one barrel/emitter, energy core, cooling
 * assembly and firing mechanism + 0..3 visual attachments. Every component that is
 * offered for a family has a geometry builder for that family (weapons/model.ts), so a
 * rolled combination is always renderable. Component effects are multipliers on the
 * rolled weapon parameters and are baked into the stored roll at generation time.
 */
export type ComponentSlot = 'barrel' | 'core' | 'cooling' | 'mechanism' | 'attachment';

/** Weapon parameters a component may scale (pierce is additive). */
export interface ComponentEffects {
  damage?: number;
  fireRate?: number;
  heatPerShot?: number;
  coolRate?: number;
  range?: number;
  /** Spread multiplier (lower = tighter). */
  accuracy?: number;
  chargeTime?: number;
  beamWidth?: number;
  rampMax?: number;
  /** Additive. */
  pierce?: number;
  /** Swarm: lock cone multiplier (higher = wider). */
  seekCone?: number;
  /** Swarm: additive seeker drones per launch. */
  drones?: number;
}

export interface ComponentDef {
  id: string;
  slot: ComponentSlot;
  name: string;
  /** What it is (visual/mechanical identity). Effects are listed separately from data. */
  blurb: string;
  families: readonly WeaponFamily[];
  weight: number;
  /** Lowest rarity index that can roll it. */
  minRarity?: number;
  effects: ComponentEffects;
  mechanism?: Mechanism;
}

const ALL: readonly WeaponFamily[] = ['plasma', 'rail', 'beam', 'swarm'];

export const COMPONENTS: readonly ComponentDef[] = [
  // ---------------------------------------------------------------- barrels / emitters
  { id: 'pb_single', slot: 'barrel', name: 'Coil Barrel', blurb: 'Single shrouded barrel with spinning accelerator coils.', families: ['plasma'], weight: 10, effects: {} },
  { id: 'pb_twin', slot: 'barrel', name: 'Twin Barrel', blurb: 'Stacked twin barrels that fire alternately.', families: ['plasma'], weight: 7, effects: { fireRate: 1.12, damage: 0.92, heatPerShot: 1.05 } },
  { id: 'pb_long', slot: 'barrel', name: 'Long Shroud', blurb: 'Extended vented shroud with a muzzle brake.', families: ['plasma'], weight: 7, effects: { range: 1.25, accuracy: 0.7, damage: 1.06, fireRate: 0.94 } },
  { id: 'rb_open', slot: 'barrel', name: 'Open Rails', blurb: 'Exposed twin accelerator rails.', families: ['rail'], weight: 10, effects: {} },
  { id: 'rb_quad', slot: 'barrel', name: 'Quad Rails', blurb: 'Four rails in a square: slugs keep their energy through targets.', families: ['rail'], weight: 6, effects: { pierce: 1, chargeTime: 1.12, heatPerShot: 1.08 } },
  { id: 'rb_shroud', slot: 'barrel', name: 'Shrouded Rails', blurb: 'Rails enclosed in a slotted thermal shroud.', families: ['rail'], weight: 7, effects: { heatPerShot: 0.85, damage: 0.95 } },
  { id: 'be_lens', slot: 'barrel', name: 'Focus Lens', blurb: 'Crystal focusing lens: a tight, long beam.', families: ['beam'], weight: 10, effects: { range: 1.2, beamWidth: 0.7, damage: 1.08 } },
  { id: 'be_array', slot: 'barrel', name: 'Splay Array', blurb: 'Three-prong emitter: a wide, forgiving beam.', families: ['beam'], weight: 7, effects: { beamWidth: 1.6, damage: 0.94, range: 0.9 } },
  { id: 'be_ring', slot: 'barrel', name: 'Resonator Rings', blurb: 'Counter-rotating resonator rings that build intensity.', families: ['beam'], weight: 7, effects: { rampMax: 1.25, heatPerShot: 1.06 } },
  { id: 'sw_pod', slot: 'barrel', name: 'Hex Launch Pod', blurb: 'Hexagonal launch pod with six drone tubes and a rotating loader.', families: ['swarm'], weight: 10, effects: {} },
  { id: 'sw_twin', slot: 'barrel', name: 'Twin Racks', blurb: 'Two stacked launch racks that fire alternately.', families: ['swarm'], weight: 7, effects: { fireRate: 1.14, damage: 0.92, heatPerShot: 1.04 } },
  { id: 'sw_hive', slot: 'barrel', name: 'Hive Cluster', blurb: 'Dense honeycomb cluster: one more drone per launch, each a little weaker.', families: ['swarm'], weight: 6, effects: { drones: 1, damage: 0.8, heatPerShot: 1.1 } },
  { id: 'sw_uplink', slot: 'barrel', name: 'Long Uplink', blurb: 'Pod with a tracking mast: drones lock from further off the crosshair and fly further.', families: ['swarm'], weight: 7, effects: { seekCone: 1.45, range: 1.25, damage: 0.95 } },
  // ---------------------------------------------------------------- energy cores
  { id: 'co_cell', slot: 'core', name: 'Plasma Cell', blurb: 'Side-loaded energy cell behind a glass window.', families: ALL, weight: 10, effects: {} },
  { id: 'co_ring', slot: 'core', name: 'Toroid Chamber', blurb: 'Ring-shaped containment chamber that sheds heat well.', families: ALL, weight: 8, effects: { coolRate: 1.1, damage: 0.97 } },
  { id: 'co_dense', slot: 'core', name: 'Dense Core', blurb: 'Compressed vertical canister: more energy, more heat.', families: ALL, weight: 7, effects: { damage: 1.1, heatPerShot: 1.12 } },
  { id: 'co_prism', slot: 'core', name: 'Prism Core', blurb: 'Faceted crystal core in a rotating gimbal (legendary grade).', families: ALL, weight: 6, minRarity: 4, effects: { damage: 1.06, coolRate: 1.06, heatPerShot: 0.95 } },
  // ---------------------------------------------------------------- cooling
  { id: 'cl_fins', slot: 'cooling', name: 'Fin Stack', blurb: 'Radiator fins that flare open as heat builds.', families: ALL, weight: 10, effects: { coolRate: 1.08 } },
  { id: 'cl_jacket', slot: 'cooling', name: 'Coolant Jacket', blurb: 'Ribbed liquid jacket around the barrel root.', families: ALL, weight: 8, effects: { coolRate: 1.15, heatPerShot: 1.04 } },
  { id: 'cl_sink', slot: 'cooling', name: 'Heat Sink', blurb: 'Dense heat-sink block: less heat per shot, slower to shed it.', families: ALL, weight: 8, effects: { heatPerShot: 0.92, coolRate: 0.95 } },
  // ---------------------------------------------------------------- firing mechanisms
  { id: 'mc_auto', slot: 'mechanism', name: 'Automatic Cycler', blurb: 'Fires continuously while the trigger is held.', families: ['plasma'], weight: 10, mechanism: 'auto', effects: {} },
  { id: 'mc_burst', slot: 'mechanism', name: 'Burst Sequencer', blurb: 'Three-round bursts with a short reset; tighter, harder-hitting rounds.', families: ['plasma'], weight: 6, mechanism: 'burst', effects: { damage: 1.12, accuracy: 0.8 } },
  { id: 'mc_charge', slot: 'mechanism', name: 'Charge Capacitor', blurb: 'Hold to charge, release to fire. Partial charges fire weaker slugs.', families: ['rail'], weight: 10, mechanism: 'charge', effects: {} },
  { id: 'mc_cycle', slot: 'mechanism', name: 'Auto-Cycler', blurb: 'Fires full slugs automatically at a fixed cycle, no charging.', families: ['rail'], weight: 6, mechanism: 'cycle', effects: { damage: 0.78 } },
  // M7 firing styles
  { id: 'mc_scatter', slot: 'mechanism', name: 'Scatter Choke', blurb: 'Fires a cone of seven plasma pellets per shot: devastating up close, weak at range.', families: ['plasma'], weight: 6, mechanism: 'scatter', effects: { damage: 0.5, fireRate: 0.2, heatPerShot: 2.6, range: 0.4 } },
  { id: 'mc_pulse', slot: 'mechanism', name: 'Pulse Capacitor', blurb: 'Discharges the emitter as detonating pulses: splash damage around the impact, no ramp.', families: ['beam'], weight: 6, mechanism: 'pulse', effects: { damage: 8.5, fireRate: 0.095, heatPerShot: 6.2, range: 1.15 } },
  { id: 'mc_swarm', slot: 'mechanism', name: 'Hive Release', blurb: 'Launches seeker drones continuously while the trigger is held.', families: ['swarm'], weight: 10, mechanism: 'swarm', effects: {} },
  { id: 'mc_salvo', slot: 'mechanism', name: 'Salvo Lock', blurb: 'Hold to paint locks, release to launch a salvo: up to three times the drones at full lock.', families: ['swarm'], weight: 6, mechanism: 'salvo', effects: { damage: 1.12, fireRate: 0.5 } },
  { id: 'mc_beam', slot: 'mechanism', name: 'Continuous Emitter', blurb: 'Sustained beam; damage ramps up while held on one target.', families: ['beam'], weight: 10, mechanism: 'beam', effects: {} },
  // ---------------------------------------------------------------- visual attachments
  { id: 'at_sight', slot: 'attachment', name: 'Holo Sight', blurb: 'Holographic sight housing.', families: ALL, weight: 8, effects: { accuracy: 0.94 } },
  { id: 'at_plating', slot: 'attachment', name: 'Armor Plating', blurb: 'Bolted protective side plates (cosmetic).', families: ALL, weight: 8, effects: {} },
  { id: 'at_conduit', slot: 'attachment', name: 'Power Conduits', blurb: 'External conduits from core to barrel.', families: ALL, weight: 7, effects: { damage: 1.03 } },
  { id: 'at_capacitor', slot: 'attachment', name: 'Aux Capacitors', blurb: 'Auxiliary capacitor cans.', families: ALL, weight: 6, effects: { chargeTime: 0.94, fireRate: 1.02 } },
];

const BY_ID = new Map(COMPONENTS.map((c) => [c.id, c]));

export function componentDef(id: string | undefined): ComponentDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function componentsFor(slot: ComponentSlot, family: WeaponFamily, rarityIndex = 0): ComponentDef[] {
  return COMPONENTS.filter((c) => c.slot === slot && c.families.includes(family) && (c.minRarity ?? 0) <= rarityIndex);
}

const EFFECT_LABEL: Record<keyof ComponentEffects, [string, 'mult' | 'add', 'higher' | 'lower']> = {
  damage: ['damage', 'mult', 'higher'],
  fireRate: ['fire rate', 'mult', 'higher'],
  heatPerShot: ['heat per shot', 'mult', 'lower'],
  coolRate: ['cooling', 'mult', 'higher'],
  range: ['range', 'mult', 'higher'],
  accuracy: ['spread', 'mult', 'lower'],
  chargeTime: ['charge time', 'mult', 'lower'],
  beamWidth: ['beam width', 'mult', 'higher'],
  rampMax: ['ramp ceiling', 'mult', 'higher'],
  pierce: ['pierce', 'add', 'higher'],
  seekCone: ['lock cone', 'mult', 'higher'],
  drones: ['drones per launch', 'add', 'higher'],
};

/** Human readable effects, e.g. [{text:'+12% fire rate', good:true}]. */
export function describeEffects(e: ComponentEffects): { text: string; good: boolean }[] {
  const out: { text: string; good: boolean }[] = [];
  for (const k of Object.keys(e) as (keyof ComponentEffects)[]) {
    const v = e[k];
    if (v === undefined) continue;
    const [label, kind, better] = EFFECT_LABEL[k];
    if (kind === 'add') {
      out.push({ text: `${v >= 0 ? '+' : '−'}${Math.abs(v)} ${label}`, good: (v > 0) === (better === 'higher') });
      continue;
    }
    if (Math.abs(v - 1) < 1e-9) continue;
    const pct = Math.round((v - 1) * 100);
    out.push({ text: `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}% ${label}`, good: (v > 1) === (better === 'higher') });
  }
  return out;
}
