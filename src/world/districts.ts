/**
 * Arena districts: hand-shaped structure kits that the procedural generator drops into a sector, all pure data.
 * Each builder works in a local frame (x across, z along) centred on the origin; `orient` rotates the result by a
 * multiple of 90 degrees and moves it into place, so boxes stay axis-aligned for collision, nav and visuals.
 *
 *  - maze:        walled grid carved by a recursive backtracker, extra openings for loops, entrance/exit on the
 *                 two ends of the travel axis (lanes traced through it wind between the walls);
 *  - serpentine:  side walls + staggered baffles that force a zig-zag;
 *  - containers:  a yard of 1-2 high shipping-container stacks with alleys (tops are tower perches);
 *  - overpass:    two platforms either side of the travel axis, ramps, and a bridge across (enemies pass under);
 *  - redoubt:     an octagonal ring of barrier walls with two gaps.
 */
import type { Box, Ramp } from './layout';

export interface Piece {
  /** Footprint (world, after orient) for overlap tests. */
  rect: { x0: number; z0: number; x1: number; z1: number };
  boxes: Box[];
  ramps: Ramp[];
  /** District label (debug / loading screen). */
  tag: string;
}

type Rand = () => number;

const WALL_T = 0.9;
const WALL_H = 3.2;

/** Rotate a local point by k quarter turns (counter-clockwise seen from above, x->z). */
function rot(k: number, x: number, z: number): [number, number] {
  switch (((k % 4) + 4) % 4) {
    case 1:
      return [z, -x];
    case 2:
      return [-x, -z];
    case 3:
      return [-z, x];
    default:
      return [x, z];
  }
}

/** Rotate by k quarter turns and translate to (cx, cz). */
export function orient(p: Omit<Piece, 'rect'>, k: number, cx: number, cz: number): Piece {
  const boxes = p.boxes.map((b): Box => {
    const [ax, az] = rot(k, b.min[0], b.min[2]);
    const [bx, bz] = rot(k, b.max[0], b.max[2]);
    return { min: [Math.min(ax, bx) + cx, b.min[1], Math.min(az, bz) + cz], max: [Math.max(ax, bx) + cx, b.max[1], Math.max(az, bz) + cz], kind: b.kind };
  });
  const ramps = p.ramps.map((r): Ramp => {
    // Heights live at the two ends of the ramp axis: rotate both end centres and re-derive.
    const lo = r.axis === 'z' ? [(r.x0 + r.x1) / 2, r.z0] : [r.x0, (r.z0 + r.z1) / 2];
    const hi = r.axis === 'z' ? [(r.x0 + r.x1) / 2, r.z1] : [r.x1, (r.z0 + r.z1) / 2];
    const [lx, lz] = rot(k, lo[0], lo[1]);
    const [hx, hz] = rot(k, hi[0], hi[1]);
    const [ax, az] = rot(k, r.x0, r.z0);
    const [bx, bz] = rot(k, r.x1, r.z1);
    const x0 = Math.min(ax, bx) + cx;
    const x1 = Math.max(ax, bx) + cx;
    const z0 = Math.min(az, bz) + cz;
    const z1 = Math.max(az, bz) + cz;
    const axis: 'x' | 'z' = Math.abs(hx - lx) > Math.abs(hz - lz) ? 'x' : 'z';
    // hMin belongs to the world min end of the new axis.
    const loIsMin = axis === 'x' ? lx < hx : lz < hz;
    return { x0, x1, z0, z1, axis, hMin: loIsMin ? r.hMin : r.hMax, hMax: loIsMin ? r.hMax : r.hMin };
  });
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.min[0]);
    z0 = Math.min(z0, b.min[2]);
    x1 = Math.max(x1, b.max[0]);
    z1 = Math.max(z1, b.max[2]);
  }
  for (const r of ramps) {
    x0 = Math.min(x0, r.x0);
    z0 = Math.min(z0, r.z0);
    x1 = Math.max(x1, r.x1);
    z1 = Math.max(z1, r.z1);
  }
  return { rect: { x0, z0, x1, z1 }, boxes, ramps, tag: p.tag };
}

/** Barrier wall along x at z (world or local). */
export const barrierX = (x0: number, x1: number, z: number, h = WALL_H): Box => wallX(x0, x1, z, h);
/** Barrier wall along z at x. */
export const barrierZ = (z0: number, z1: number, x: number, h = WALL_H): Box => wallZ(z0, z1, x, h);
const wallX = (x0: number, x1: number, z: number, h = WALL_H): Box => ({ min: [x0, 0, z - WALL_T / 2], max: [x1, h, z + WALL_T / 2], kind: 'barrier' });
const wallZ = (z0: number, z1: number, x: number, h = WALL_H): Box => ({ min: [x - WALL_T / 2, 0, z0], max: [x + WALL_T / 2, h, z1], kind: 'barrier' });

/**
 * Maze of nx x nz cells (size `cell` m). Entrance at the +z end, exit at the -z end (local), each in a random column.
 * Walls are merged into straight runs so a 5x4 maze is ~20 boxes.
 */
export function maze(rand: Rand, nx: number, nz: number, cell: number, loops = 0.22): Omit<Piece, 'rect'> {
  // Wall flags: h[j][i] = wall on the z = j line between rows j-1 and j (j = 0..nz); v[j][i] = wall on x = i line.
  const h: boolean[][] = Array.from({ length: nz + 1 }, () => Array<boolean>(nx).fill(true));
  const v: boolean[][] = Array.from({ length: nz }, () => Array<boolean>(nx + 1).fill(true));
  const seen: boolean[][] = Array.from({ length: nz }, () => Array<boolean>(nx).fill(false));
  const stack: [number, number][] = [[Math.floor(rand() * nx), Math.floor(rand() * nz)]];
  seen[stack[0][1]][stack[0][0]] = true;
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const opts: [number, number, () => void][] = [];
    if (i > 0 && !seen[j][i - 1]) opts.push([i - 1, j, () => (v[j][i] = false)]);
    if (i < nx - 1 && !seen[j][i + 1]) opts.push([i + 1, j, () => (v[j][i + 1] = false)]);
    if (j > 0 && !seen[j - 1][i]) opts.push([i, j - 1, () => (h[j][i] = false)]);
    if (j < nz - 1 && !seen[j + 1][i]) opts.push([i, j + 1, () => (h[j + 1][i] = false)]);
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [ni, nj, open] = opts[Math.floor(rand() * opts.length)];
    open();
    seen[nj][ni] = true;
    stack.push([ni, nj]);
  }
  // Loops: knock out some interior walls so there is more than one way through (and towers can re-route).
  for (let j = 1; j < nz; j++) for (let i = 0; i < nx; i++) if (h[j][i] && rand() < loops) h[j][i] = false;
  for (let j = 0; j < nz; j++) for (let i = 1; i < nx; i++) if (v[j][i] && rand() < loops) v[j][i] = false;
  // Entrance (far end, +z) and exit (-z), plus one side door each way.
  h[nz][Math.floor(rand() * nx)] = false;
  h[0][Math.floor(rand() * nx)] = false;
  v[Math.floor(rand() * nz)][0] = false;
  v[Math.floor(rand() * nz)][nx] = false;

  const ox = (-nx * cell) / 2;
  const oz = (-nz * cell) / 2;
  const boxes: Box[] = [];
  const e = WALL_T / 2;
  for (let j = 0; j <= nz; j++) {
    let start = -1;
    for (let i = 0; i <= nx; i++) {
      const on = i < nx && h[j][i];
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        boxes.push(wallX(ox + start * cell - e, ox + i * cell + e, oz + j * cell));
        start = -1;
      }
    }
  }
  for (let i = 0; i <= nx; i++) {
    let start = -1;
    for (let j = 0; j <= nz; j++) {
      const on = j < nz && v[j][i];
      if (on && start < 0) start = j;
      if (!on && start >= 0) {
        boxes.push(wallZ(oz + start * cell - e, oz + j * cell + e, ox + i * cell));
        start = -1;
      }
    }
  }
  return { boxes, ramps: [], tag: 'maze' };
}

/** Serpentine chicane along local z: side walls and `n` staggered baffles, `gap` m openings. */
export function serpentine(rand: Rand, width: number, n: number, spacing: number, gap: number): Omit<Piece, 'rect'> {
  const len = (n + 1) * spacing;
  const boxes: Box[] = [wallZ(-len / 2, len / 2, -width / 2), wallZ(-len / 2, len / 2, width / 2)];
  let side = rand() < 0.5 ? -1 : 1;
  for (let k = 1; k <= n; k++) {
    const z = -len / 2 + k * spacing;
    if (side < 0) boxes.push(wallX(-width / 2, width / 2 - gap, z));
    else boxes.push(wallX(-width / 2 + gap, width / 2, z));
    side = -side;
  }
  return { boxes, ramps: [], tag: 'serpentine' };
}

/** Container yard: cols x rows slots (6.1 x 2.5 m containers, alleys), stacks 1-2 high, some slots empty. */
export function containerYard(rand: Rand, cols: number, rows: number): Omit<Piece, 'rect'> {
  const L = 6.1;
  const W = 2.5;
  const H = 2.6;
  const alleyX = 4.6;
  const alleyZ = 4.4;
  const boxes: Box[] = [];
  const sx = L + alleyX;
  const sz = W * 2 + alleyZ;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (rand() < 0.12) continue;
      // Alternate rows are staggered by half a slot, so alleys along z zig-zag instead of running straight.
      const x = (c - (cols - 1) / 2 + (r % 2 ? 0.5 : 0)) * sx;
      const z = (r - (rows - 1) / 2) * sz;
      // Two containers side by side per slot; each stack 1 or 2 high.
      for (const off of [-W / 2, W / 2]) {
        if (rand() < 0.12) continue;
        const tall = rand() < 0.4 ? 2 : 1;
        boxes.push({ min: [x - L / 2, 0, z + off - W / 2], max: [x + L / 2, H * tall, z + off + W / 2], kind: 'container' });
      }
    }
  }
  return { boxes, ramps: [], tag: 'containers' };
}

/**
 * Overpass across the local z axis: two platforms at +-(span/2 + depth/2) in x, each with a ramp running along z,
 * joined by a bridge deck (kind 'bridge', underside at h - 0.45) with two pairs of slim pylons.
 */
export function overpass(rand: Rand, span: number, h: number): Omit<Piece, 'rect'> {
  const pw = 9 + rand() * 4; // platform extent across (x)
  const pd = 9 + rand() * 4; // along (z)
  const bw = 4.2; // bridge width (z)
  const boxes: Box[] = [];
  const ramps: Ramp[] = [];
  const len = h * 2.8 + 1;
  for (const s of [-1, 1]) {
    const xi = s * (span / 2);
    const xo = s * (span / 2 + pw);
    boxes.push({ min: [Math.min(xi, xo), 0, -pd / 2], max: [Math.max(xi, xo), h, pd / 2], kind: 'platform' });
    // Ramp down the outer half of the platform, toward +z or -z.
    const rx0 = Math.min(xi, xo) + (s > 0 ? pw - 5 : 1);
    const toward = rand() < 0.5 ? 1 : -1;
    ramps.push(toward > 0
      ? { x0: rx0, x1: rx0 + 4, z0: pd / 2, z1: pd / 2 + len, axis: 'z', hMin: h, hMax: 0 }
      : { x0: rx0, x1: rx0 + 4, z0: -pd / 2 - len, z1: -pd / 2, axis: 'z', hMin: 0, hMax: h });
  }
  boxes.push({ min: [-span / 2, h - 0.45, -bw / 2], max: [span / 2, h, bw / 2], kind: 'bridge' });
  // Staggered baffles at both mouths of the underpass: enemies jink left then right beneath the bridge.
  const open = 6.5;
  const flip = rand() < 0.5 ? 1 : -1;
  const mouth = pd / 2 + 3.5;
  if (span - open > 2) {
    boxes.push(flip > 0 ? wallX(-span / 2, span / 2 - open, mouth) : wallX(-span / 2 + open, span / 2, mouth));
    boxes.push(flip > 0 ? wallX(-span / 2 + open, span / 2, -mouth) : wallX(-span / 2, span / 2 - open, -mouth));
  }
  for (const px of [-span / 6, span / 6]) {
    for (const pz of [-bw / 2 + 0.5, bw / 2 - 0.5]) boxes.push({ min: [px - 0.45, 0, pz - 0.45], max: [px + 0.45, h - 0.45, pz + 0.45], kind: 'barrier' });
  }
  return { boxes, ramps, tag: 'overpass' };
}

/** Octagonal ring of barrier walls (radius r) with two opposite gaps along local z. */
export function redoubt(rand: Rand, r: number): Omit<Piece, 'rect'> {
  const boxes: Box[] = [];
  const s = r * Math.tan(Math.PI / 8); // half side of the octagon
  // Axis-aligned sides only (N/S/E/W faces) + corner bastions, which keeps boxes axis-aligned.
  const gapSide = rand() < 0.5;
  for (const side of [-1, 1]) {
    // E/W faces: solid.
    boxes.push(wallZ(-s, s, side * r));
    // N/S faces: split around a 4.5 m gap (or solid on the alternate axis).
    if (gapSide) {
      boxes.push(wallX(-s, -2.25, side * r));
      boxes.push(wallX(2.25, s, side * r));
    } else boxes.push(wallX(-s, s, side * r));
  }
  if (!gapSide) {
    // Gaps on E/W instead: rebuild those faces split.
    boxes.splice(0, boxes.length);
    for (const side of [-1, 1]) {
      boxes.push(wallX(-s, s, side * r));
      boxes.push(wallZ(-s, -2.25, side * r));
      boxes.push(wallZ(2.25, s, side * r));
    }
  }
  // Corner bastions (chunky blocks on the diagonals).
  const c = (r + s) / 2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    boxes.push({ min: [sx * c - 1.4, 0, sz * c - 1.4], max: [sx * c + 1.4, WALL_H + 0.8, sz * c + 1.4], kind: 'barrier' });
  }
  return { boxes, ramps: [], tag: 'redoubt' };
}

/** Bridge deck between two facing platform edges (world coords), with pylons every ~10 m. */
export function skyway(ax: number, az: number, bx: number, bz: number, h: number, width = 3.6): Box[] {
  const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
  const out: Box[] = [];
  if (alongX) {
    const x0 = Math.min(ax, bx);
    const x1 = Math.max(ax, bx);
    out.push({ min: [x0, h - 0.45, az - width / 2], max: [x1, h, az + width / 2], kind: 'bridge' });
    const n = Math.max(1, Math.floor((x1 - x0) / 10));
    for (let k = 1; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / (n + 1);
      out.push({ min: [x - 0.5, 0, az - 0.5], max: [x + 0.5, h - 0.45, az + 0.5], kind: 'barrier' });
    }
  } else {
    const z0 = Math.min(az, bz);
    const z1 = Math.max(az, bz);
    out.push({ min: [ax - width / 2, h - 0.45, z0], max: [ax + width / 2, h, z1], kind: 'bridge' });
    const n = Math.max(1, Math.floor((z1 - z0) / 10));
    for (let k = 1; k <= n; k++) {
      const z = z0 + ((z1 - z0) * k) / (n + 1);
      out.push({ min: [ax - 0.5, 0, z - 0.5], max: [ax + 0.5, h - 0.45, z + 0.5], kind: 'barrier' });
    }
  }
  return out;
}

/**
 * Wing walls (local frame, before orient): barriers running sideways from both flanks of a district at local z = `z`,
 * `wing` m long, so going around costs more than going through. Sometimes (`gapChance`) a 4.5 m gap near a wing's
 * tip keeps a long bypass for when players seal the district with towers.
 */
export function withWings(p: Omit<Piece, 'rect'>, wing: number, z: number, rand: Rand, gapChance = 0.35): Omit<Piece, 'rect'> {
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const b of p.boxes) {
    x0 = Math.min(x0, b.min[0]);
    x1 = Math.max(x1, b.max[0]);
  }
  const boxes = [...p.boxes];
  for (const [from, dir] of [[x0, -1], [x1, 1]] as const) {
    const tip = from + dir * wing;
    if (rand() >= gapChance) {
      boxes.push(wallX(Math.min(from, tip), Math.max(from, tip), z));
      continue;
    }
    const gapAt = from + dir * wing * (0.8 + rand() * 0.1);
    const a0 = Math.min(from, gapAt - dir * 2.25);
    const a1 = Math.max(from, gapAt - dir * 2.25);
    const b0 = Math.min(gapAt + dir * 2.25, tip);
    const b1 = Math.max(gapAt + dir * 2.25, tip);
    boxes.push(wallX(a0, a1, z), wallX(b0, b1, z));
  }
  return { ...p, boxes };
}
