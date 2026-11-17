/**
 * Persistent, user-customisable headquarters objects (pure data).
 * Static architecture (walls, floors, stations) is code; everything a player will
 * eventually move, add or recolour is a Placeable stored in the save and rebuilt
 * from it on every visit. M1 ships a default set; the editor comes later.
 */
export type PropType = 'planter' | 'crates' | 'serverRack' | 'lightPylon' | 'bench' | 'holoPanel';

export const PROP_TYPES: readonly PropType[] = ['planter', 'crates', 'serverRack', 'lightPylon', 'bench', 'holoPanel'];

export type PropValue = string | number | boolean;

export interface Placeable {
  uid: string;
  type: PropType;
  position: [number, number, number];
  /** Yaw in radians. */
  rotationY: number;
  scale: number;
  /** Type-specific customisation (e.g. accent colour). */
  props: Record<string, PropValue>;
}

/** Interior bounds placeables are clamped to (matches HQ_LAYOUT's outer shell). */
export const PLACEABLE_BOUNDS = { minX: -20.5, maxX: 22.5, minZ: -10.5, maxZ: 20.5, maxY: 6 };

export const ACCENTS = ['cyan', 'teal', 'white', 'amber'] as const;
export type Accent = (typeof ACCENTS)[number];

const p = (uid: string, type: PropType, x: number, z: number, rotationY = 0, props: Record<string, PropValue> = {}, scale = 1): Placeable => ({
  uid,
  type,
  position: [x, 0, z],
  rotationY,
  scale,
  props,
});

/** Default furnishing of a new headquarters. */
export const DEFAULT_PLACEABLES: readonly Placeable[] = [
  p('d_planter_1', 'planter', -9.6, -5.2, 0, { accent: 'teal' }),
  p('d_planter_2', 'planter', 9.6, -8.4, 0, { accent: 'teal' }),
  p('d_bench_1', 'bench', -4.2, -8.9, 0),
  p('d_bench_2', 'bench', 4.2, -8.9, 0),
  p('d_pylon_1', 'lightPylon', -10.1, 6.6, 0, { accent: 'cyan' }),
  p('d_pylon_2', 'lightPylon', 10.1, 6.6, 0, { accent: 'cyan' }),
  p('d_rack_1', 'serverRack', -19.9, -4.6, Math.PI / 2, { accent: 'cyan' }),
  p('d_rack_2', 'serverRack', -19.9, 4.6, Math.PI / 2, { accent: 'cyan' }),
  p('d_crates_1', 'crates', 21.3, -7.6, 0.2, { accent: 'amber' }),
  p('d_crates_2', 'crates', 12.4, 7.9, -0.15, { accent: 'white' }),
  p('d_holo_1', 'holoPanel', 10.2, -6.2, -Math.PI / 2, { accent: 'cyan' }),
];
