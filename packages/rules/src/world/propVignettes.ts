import { PROP_SPECIES, type PropPlacement, type PropSpecies } from './propCatalog';

/**
 * Hand-authored prop vignettes (pure): little scenes the way real yards accumulate stuff, instead of single props
 * spaced evenly along a wall. Each item sits in a wall-relative frame: `u` along the wall, `v` out from the wall
 * face (v = 0 is the face), `y` up. `yaw` is relative to "long side along the wall"; `tilt` leans the item about its
 * own x axis (pi/2 = lying on its side, the item then rests on its curved side). Stacks give `y` explicitly.
 */
export interface VignetteItem {
  species: PropSpecies;
  u: number;
  v: number;
  y?: number;
  yaw?: number;
  tilt?: number;
}

export interface Vignette {
  name: string;
  items: VignetteItem[];
}

const H = (s: PropSpecies) => PROP_SPECIES[s].size[1];

export const VIGNETTES: Record<string, Vignette> = {
  drumHuddle: { name: 'drums', items: [
    { species: 'barrel-red', u: 0, v: 0.36 },
    { species: 'barrel-red', u: 0.6, v: 0.33, yaw: 0.9 },
    { species: 'barrel-steel', u: 0.28, v: 0.88, yaw: 2.1 },
    { species: 'barrel-steel', u: 1.35, v: 0.95, yaw: 0.4, tilt: Math.PI / 2 },
    { species: 'jerrycan', u: -0.52, v: 0.24, yaw: 0.3, tilt: 0.18 },
  ] },
  palletStack: { name: 'pallets', items: [
    { species: 'crate-military', u: 0, v: 0.58 },
    { species: 'crate-military', u: 0.04, v: 0.56, y: H('crate-military'), yaw: 0.06 },
    { species: 'crate-military', u: -0.05, v: 0.6, y: H('crate-military') * 2, yaw: -0.08 },
    { species: 'crate-plastic', u: 0.3, v: 0.5, y: H('crate-military') * 3, yaw: 0.5 },
    { species: 'cardboard-box', u: 1.25, v: 0.35, yaw: 0.2 },
    { species: 'cardboard-box', u: 1.3, v: 0.36, y: H('cardboard-box'), yaw: -0.25 },
    { species: 'cardboard-box', u: 1.25, v: 0.9, yaw: 1.2, tilt: 0.22 },
  ] },
  tyrePile: { name: 'tyres', items: [
    { species: 'tyre', u: 0, v: 0.45, tilt: Math.PI / 2 },
    { species: 'tyre', u: 0.03, v: 0.46, y: 0.17, tilt: Math.PI / 2, yaw: 0.5 },
    { species: 'tyre', u: -0.02, v: 0.44, y: 0.34, tilt: Math.PI / 2, yaw: 1.1 },
    { species: 'tyre', u: 0.75, v: 0.14, tilt: -0.22 },
    { species: 'wheel-rim', u: 1.15, v: 0.5, tilt: Math.PI / 2, yaw: 0.7 },
    { species: 'tyre', u: 1.55, v: 0.75, tilt: Math.PI / 2, yaw: 2 },
  ] },
  generatorBay: { name: 'generator', items: [
    { species: 'generator', u: 0, v: 0.52, yaw: 0.12 },
    { species: 'jerrycan', u: 0.68, v: 0.24, yaw: -0.2 },
    { species: 'jerrycan', u: 0.95, v: 0.27, yaw: 0.35 },
    { species: 'jerrycan', u: 0.8, v: 0.7, yaw: 1.5, tilt: Math.PI / 2 },
    { species: 'extinguisher', u: -0.7, v: 0.22, yaw: 0.4 },
  ] },
  dumpster: { name: 'dumpster', items: [
    { species: 'trash-can', u: 0, v: 0.36, yaw: 0.05 },
    { species: 'cardboard-box', u: 1.28, v: 0.32, yaw: 0.4 },
    { species: 'cardboard-box', u: 1.42, v: 0.75, yaw: -0.6, tilt: 0.3 },
    { species: 'cardboard-box', u: 1.3, v: 0.34, y: H('cardboard-box'), yaw: 0.9 },
    { species: 'barrel-steel', u: -1.35, v: 0.36, yaw: 0.6 },
  ] },
  gasBottles: { name: 'gas', items: [
    { species: 'lpg-tank', u: 0, v: 0.26 },
    { species: 'propane-tank', u: 0.45, v: 0.24, yaw: 1 },
    { species: 'lpg-tank', u: 0.9, v: 0.27, yaw: 2.2 },
    { species: 'propane-tank', u: 1.45, v: 0.6, yaw: 0.5, tilt: Math.PI / 2 },
  ] },
  barrierRun: { name: 'barriers', items: [
    { species: 'road-barrier', u: 0, v: 0.45, yaw: 0.08 },
    { species: 'road-barrier', u: 1.62, v: 0.5, yaw: -0.12 },
    { species: 'road-barrier', u: 3.1, v: 0.75, yaw: 0.35 },
  ] },
  parkedCar: { name: 'car', items: [
    { species: 'covered-car', u: 0, v: 1.25, yaw: 0.22 },
    { species: 'tyre', u: 2.65, v: 0.14, tilt: -0.2 },
    { species: 'tyre', u: 3.05, v: 0.45, tilt: Math.PI / 2 },
  ] },
  pipeStore: { name: 'pipes', items: [
    { species: 'pipes', u: 0, v: 0.22 },
    { species: 'pipes', u: 1.45, v: 0.24, yaw: 0.05 },
    { species: 'utility-box-tall', u: 2.75, v: 0.3 },
  ] },
  fireCorner: { name: 'fire', items: [
    { species: 'fire-barrel', u: 0, v: 0.6, yaw: 0.4 },
    { species: 'barrel-steel', u: -0.75, v: 0.35, yaw: 1.3 },
    { species: 'crate-plastic', u: 0.75, v: 0.3, yaw: 0.4 },
    { species: 'crate-plastic', u: 0.72, v: 0.32, y: H('crate-plastic'), yaw: 0.1 },
  ] },
};

/** Half-extent along the wall (u) and depth out from it (v) of a vignette, for spacing and clearance. */
export function vignetteExtent(v: Vignette): { u0: number; u1: number; depth: number } {
  let u0 = Infinity, u1 = -Infinity, depth = 0;
  for (const it of v.items) {
    const [w, , d] = PROP_SPECIES[it.species].size;
    const r = Math.hypot(w, d) / 2;
    u0 = Math.min(u0, it.u - r);
    u1 = Math.max(u1, it.u + r);
    depth = Math.max(depth, it.v + r);
  }
  return { u0, u1, depth };
}

/**
 * Place a vignette: anchor at (ax, az) on the wall face, `along` = unit vector along the wall, `out` = unit
 * vector away from it, `wallYaw` = yaw that lays a model's long side along the wall, `spin` = small extra rotation
 * of the whole group (groups never line up perfectly with the wall). Items lying on their side get their pivot
 * moved so they rest on the ground at their centre position.
 */
export function placeVignette(v: Vignette, ax: number, az: number, along: [number, number], out: [number, number], wallYaw: number, spin: number): PropPlacement[] {
  const cs = Math.cos(spin), sn = Math.sin(spin);
  return v.items.map((it) => {
    // Rotate (u, v) by the group spin in the wall frame, then map to world.
    const u = it.u * cs - it.v * sn;
    const w = it.u * sn + it.v * cs;
    let x = ax + along[0] * u + out[0] * w;
    let z = az + along[1] * u + out[1] * w;
    const yaw = wallYaw + spin + (it.yaw ?? 0);
    const tilt = it.tilt ?? 0;
    let y = it.y ?? 0;
    if (Math.abs(tilt) > 1.2) {
      // Lying: the model's height axis now runs along its local z; rest on the side and centre the length.
      const [width, height] = PROP_SPECIES[it.species].size;
      const s = Math.sign(tilt);
      x -= Math.sin(yaw) * (height / 2) * s;
      z -= Math.cos(yaw) * (height / 2) * s;
      y += width / 2;
    }
    return { species: it.species, x, y, z, yaw, scale: 1, tilt };
  });
}
