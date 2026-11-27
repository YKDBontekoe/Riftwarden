/**
 * CC0 prop catalogue (pure data, no Babylon): what each scanned model is, its footprint and where it belongs.
 * Sizes are the Poly Haven dimensions in metres (width x, height y, depth z) at scale 1. The files and their
 * provenance are in `assets/cc0/manifest.json` (scripts/fetch-cc0.mjs); `tests/asset-manifest.test.ts` checks
 * that every species here has a shipped model. Placement: `propPlan.ts`; loading: `game/visuals/propLibrary.ts`.
 */
export type PropSpecies =
  | 'barrel-red' | 'barrel-steel' | 'crate-military' | 'crate-plastic' | 'jerrycan' | 'propane-tank' | 'lpg-tank'
  | 'utility-box' | 'utility-box-tall' | 'aircon-unit' | 'generator' | 'tyre' | 'shelves' | 'tool-chest' | 'toolbox'
  | 'welding-cart' | 'cardboard-box' | 'extinguisher' | 'oil-tin'
  | 'airduct' | 'pipes' | 'street-lamp' | 'security-light' | 'road-barrier' | 'covered-car' | 'fire-barrel' | 'wheel-rim'
  | 'searchlight' | 'trash-can';

/**
 * Where a species reads right: `floor` = yard clutter at a wall foot, `deck` = larger pieces against a solid out on
 * the deck, `roof` = rooftop plant, `wall` = mounted on a wall face, `hq` = interior kit.
 */
export type PropRole = 'floor' | 'deck' | 'roof' | 'wall' | 'hq';

export interface PropDef {
  size: readonly [number, number, number];
  roles: readonly PropRole[];
  /** Can sit on top of another prop (small enough to stack on a crate or cart). */
  small?: boolean;
  /** The model's long side runs along z, not x (cars): rotated a quarter turn to lie along a wall. */
  longZ?: boolean;
}

export const PROP_SPECIES: Record<PropSpecies, PropDef> = {
  'barrel-red': { size: [0.56, 0.88, 0.56], roles: ['floor'] },
  'barrel-steel': { size: [0.63, 0.93, 0.64], roles: ['floor', 'hq'] },
  'crate-military': { size: [1.82, 0.3, 0.98], roles: ['floor', 'hq'] },
  'crate-plastic': { size: [0.51, 0.25, 0.41], roles: ['floor', 'hq'], small: true },
  jerrycan: { size: [0.37, 0.5, 0.17], roles: ['floor', 'hq'], small: true },
  'propane-tank': { size: [0.34, 0.55, 0.34], roles: ['floor', 'hq'] },
  'lpg-tank': { size: [0.41, 0.64, 0.41], roles: ['floor'] },
  'utility-box': { size: [0.52, 1.12, 0.43], roles: ['floor', 'roof'] },
  'utility-box-tall': { size: [0.92, 1.12, 0.43], roles: ['floor', 'roof'] },
  'aircon-unit': { size: [1.8, 0.93, 0.37], roles: ['roof'] },
  generator: { size: [0.82, 0.58, 0.56], roles: ['floor', 'roof', 'hq'] },
  tyre: { size: [0.6, 0.6, 0.17], roles: ['floor'] },
  shelves: { size: [1.1, 2.14, 0.5], roles: ['hq'] },
  'tool-chest': { size: [0.69, 0.65, 0.41], roles: ['hq'] },
  toolbox: { size: [0.4, 0.35, 0.29], roles: ['hq'], small: true },
  'welding-cart': { size: [0.84, 1.56, 0.66], roles: ['hq'] },
  'cardboard-box': { size: [0.39, 0.34, 0.52], roles: ['hq'], small: true },
  extinguisher: { size: [0.28, 0.66, 0.37], roles: ['floor', 'hq'] },
  'oil-tin': { size: [0.12, 0.21, 0.15], roles: ['hq'], small: true },
  airduct: { size: [4.17, 1.32, 1.46], roles: ['roof'] },
  pipes: { size: [1.4, 1.96, 0.31], roles: ['floor'] },
  'street-lamp': { size: [0.39, 1.68, 0.81], roles: ['wall'] },
  'security-light': { size: [0.32, 0.53, 0.42], roles: ['wall'] },
  'road-barrier': { size: [1.57, 1.11, 0.44], roles: ['deck', 'floor'] },
  'covered-car': { size: [1.79, 1.41, 4.38], roles: ['deck', 'floor'], longZ: true },
  'fire-barrel': { size: [0.6, 0.86, 0.6], roles: ['floor', 'deck'] },
  'wheel-rim': { size: [0.4, 0.4, 0.15], roles: ['floor'], small: true },
  searchlight: { size: [0.17, 0.19, 0.25], roles: ['roof'], small: true },
  'trash-can': { size: [1.85, 0.91, 0.56], roles: ['deck', 'floor'] },
};

/** One placed prop: position of its footprint centre on the ground (y = standing height), yaw in radians. */
export interface PropPlacement {
  species: PropSpecies;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

/** Footprint radius in the ground plane (for spacing and clearance checks). */
export function propRadius(species: PropSpecies, scale = 1): number {
  const [w, , d] = PROP_SPECIES[species].size;
  return (Math.hypot(w, d) / 2) * scale;
}
