import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { type Material } from '@babylonjs/core/Materials/material';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { type Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { type Scene } from '@babylonjs/core/scene';

/** Per-chunk shade: most pieces dusty grey, some darker, a few scorched black. */
function chunkShade(rand: () => number): [number, number, number] {
  const scorched = rand() < 0.14;
  const v = scorched ? 0.3 + rand() * 0.15 : 0.75 + rand() * 0.45;
  const warm = 1 + (rand() - 0.5) * 0.08;
  return [v * warm, v, v / warm];
}
import { mulberry32 } from '@riftwarden/rules/combat/damage';
import type { RubbleSpot } from '@riftwarden/rules/world/rubblePlan';

/**
 * Rubble and wreckage geometry: broken concrete chunks (jittered icospheres, flat shaded),
 * torn rusty plate, rebar, fallen I-beams, dented drums and cracked wall slabs. Every piece is
 * handed to the host's per-material merge, so a whole field of debris costs a few draw calls.
 * Purely visual: no colliders, no picking surface.
 */
export interface RubbleHost {
  readonly scene: Scene;
  add(mesh: Mesh, mat: Material, surface: string | null): void;
}

export interface RubbleMaterials {
  concrete: Material;
  rust: Material;
  graphite: Material;
  enamel: Material;
}

type Rand = () => number;

export class RubbleBuilder {
  private n = 0;

  /**
   * @param tint give concrete pieces per-chunk vertex colours (only where the concrete material's
   * merge group holds nothing but rubble, i.e. its own material in the arena).
   */
  constructor(
    private h: RubbleHost,
    private M: RubbleMaterials,
    private tint = false,
  ) {}

  private shade(m: Mesh, rand: Rand, mat: Material): void {
    if (!this.tint || mat !== this.M.concrete) return;
    const [r, g, b] = chunkShade(rand);
    const n = m.getTotalVertices();
    const c = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) c.set([r, g, b, 1], i * 4);
    m.setVerticesData(VertexBuffer.ColorKind, c);
  }

  /** Build every planned spot. */
  build(spots: readonly RubbleSpot[]): void {
    for (const s of spots) {
      const rand = mulberry32(s.seed);
      switch (s.kind) {
        case 'pile':
          this.pile(rand, s.x, s.z, s.r, this.M.concrete);
          break;
        case 'scatter':
          this.scatter(rand, s.x, s.z, s.r);
          break;
        case 'beam':
          this.beam(rand, s.x, s.z, s.yaw);
          break;
        case 'barrels':
          this.barrels(rand, s.x, s.z, s.yaw);
          break;
        case 'slab':
          this.slab(rand, s.x, s.z, s.yaw);
          break;
      }
    }
  }

  /** Heap of scrap metal (HQ reclamation): rusty chunks, plates, rods and a crushed drum. */
  scrapPile(x: number, z: number, r: number, seed: number): void {
    const rand = mulberry32(seed);
    this.pile(rand, x, z, r * 1.2, this.M.rust, 0.55);
    this.pile(rand, x + (rand() - 0.5) * r, z + (rand() - 0.5) * r, r * 0.6, this.M.graphite, 0.5);
    this.drum(rand, x + (rand() - 0.5) * r, z + (rand() - 0.5) * r, true, false, this.M.rust);
  }

  // ------------------------------------------------------------------ pieces

  /** Irregular broken chunk: icosahedron with per-vertex jitter, scaled, rotated, flat shaded. */
  private chunk(rand: Rand, x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: Material, rot?: Quaternion): void {
    // Mostly blocky fragments (a box whose 8 corners are pushed around, faces stay joined);
    // a minority of rounder lumps from a jittered icosahedron.
    const blocky = rot !== undefined || rand() < 0.7;
    const m = blocky ? MeshBuilder.CreateBox(`rb${this.n++}`, { size: 1 }, this.h.scene) : MeshBuilder.CreateIcoSphere(`rb${this.n++}`, { radius: 0.5, subdivisions: 1, flat: false }, this.h.scene);
    const pos = m.getVerticesData(VertexBuffer.PositionKind);
    if (pos && blocky) {
      const corner = new Map<string, [number, number, number]>();
      for (let i = 0; i < pos.length; i += 3) {
        const key = `${Math.sign(pos[i])}${Math.sign(pos[i + 1])}${Math.sign(pos[i + 2])}`;
        let j = corner.get(key);
        if (!j) {
          j = [(rand() - 0.5) * 0.36, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.36];
          corner.set(key, j);
        }
        pos[i] += j[0];
        pos[i + 1] += j[1];
        pos[i + 2] += j[2];
      }
      m.updateVerticesData(VertexBuffer.PositionKind, pos);
    } else if (pos) {
      for (let i = 0; i < pos.length; i += 3) {
        const k = 0.7 + rand() * 0.5;
        // Flatten one side now and then: fracture faces read as planar breaks.
        const cut = pos[i + 1] < -0.2 && rand() < 0.7 ? 0.7 : 1;
        pos[i] *= k;
        pos[i + 1] *= k * cut;
        pos[i + 2] *= k;
      }
      m.updateVerticesData(VertexBuffer.PositionKind, pos);
    }
    m.scaling.set(sx, sy, sz);
    m.rotationQuaternion = rot ?? Quaternion.RotationYawPitchRoll(rand() * Math.PI * 2, (rand() - 0.5) * 0.9, (rand() - 0.5) * 0.9);
    m.position.set(x, y, z);
    m.convertToFlatShadedMesh();
    this.shade(m, rand, mat);
    this.h.add(m, mat, null);
  }

  /** Thin box (torn plate, flange, shard) with an arbitrary orientation. */
  private plate(x: number, y: number, z: number, w: number, t: number, d: number, rot: Quaternion, mat: Material): void {
    const m = MeshBuilder.CreateBox(`rp${this.n++}`, { width: w, height: t, depth: d }, this.h.scene);
    m.rotationQuaternion = rot;
    m.position.set(x, y, z);
    this.h.add(m, mat, null);
  }

  /** Rebar / rod from a to b. */
  private rod(a: Vector3, b: Vector3, d: number, mat: Material): void {
    const dir = b.subtract(a);
    const len = dir.length();
    if (len < 0.05) return;
    const m = MeshBuilder.CreateCylinder(`rr${this.n++}`, { height: len, diameter: d, tessellation: 5 }, this.h.scene);
    const up = new Vector3(0, 1, 0);
    const axis = Vector3.Cross(up, dir.normalize());
    const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(up, dir.normalize()))));
    m.rotationQuaternion = axis.lengthSquared() < 1e-9 ? Quaternion.Identity() : Quaternion.RotationAxis(axis.normalize(), angle);
    m.position.copyFrom(a.add(b).scale(0.5));
    this.h.add(m, mat, null);
  }

  private drum(rand: Rand, x: number, z: number, crushed: boolean, onSide = false, force?: Material): void {
    const m = MeshBuilder.CreateCylinder(`rd${this.n++}`, { height: 0.9, diameter: 0.6, tessellation: 12 }, this.h.scene);
    const mat = force ?? (rand() < 0.5 ? this.M.rust : this.M.enamel);
    if (crushed) m.scaling.set(1.18, 0.55, 0.92);
    if (onSide) {
      m.rotationQuaternion = Quaternion.RotationYawPitchRoll(rand() * Math.PI * 2, 0, Math.PI / 2);
      m.position.set(x, 0.3, z);
    } else {
      m.rotationQuaternion = Quaternion.RotationYawPitchRoll(rand() * Math.PI * 2, (rand() - 0.5) * 0.12, (rand() - 0.5) * 0.12);
      m.position.set(x, crushed ? 0.24 : 0.45, z);
    }
    this.h.add(m, mat, null);
  }

  // ------------------------------------------------------------------ compositions

  /** Mound of chunks (biggest in the middle), torn plates and bent rebar sticking out. */
  private pile(rand: Rand, x: number, z: number, r: number, mat: Material, metalShare = 0.22): void {
    const count = Math.round(6 + r * 8);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const d = r * Math.sqrt(rand());
      const fall = 1 - d / r;
      const s = (0.12 + rand() * 0.32) * (0.45 + fall * 0.8) * Math.min(1.4, r);
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      const py = fall * r * 0.32 + s * 0.25;
      if (rand() < metalShare) {
        this.plate(px, py, pz, s * 2.2, 0.03, s * 1.4, Quaternion.RotationYawPitchRoll(rand() * 6.3, (rand() - 0.5) * 1.2, (rand() - 0.5) * 1.2), this.M.rust);
      } else {
        this.chunk(rand, px, py, pz, s * (1 + rand() * 0.5), s * (0.75 + rand() * 0.5), s * (1 + rand() * 0.4), mat);
      }
    }
    const rods = Math.floor(rand() * 3 * Math.min(1, r));
    for (let i = 0; i < rods; i++) {
      const a = rand() * Math.PI * 2;
      const base = new Vector3(x + Math.cos(a) * r * 0.3, r * 0.15, z + Math.sin(a) * r * 0.3);
      const len = 0.6 + rand() * 1.0;
      const tip = base.add(new Vector3(Math.cos(a) * len * 0.6, len * (0.4 + rand() * 0.5), Math.sin(a) * len * 0.6));
      const bend = tip.add(new Vector3((rand() - 0.5) * 0.5, -0.15 - rand() * 0.3, (rand() - 0.5) * 0.5));
      this.rod(base, tip, 0.035, this.M.rust);
      this.rod(tip, bend, 0.035, this.M.rust);
    }
  }

  private scatter(rand: Rand, x: number, z: number, r: number): void {
    const n = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const s = 0.05 + rand() * 0.13;
      const px = x + (rand() - 0.5) * r * 2;
      const pz = z + (rand() - 0.5) * r * 2;
      if (rand() < 0.25) this.plate(px, 0.02, pz, s * 3, 0.02, s * 2, Quaternion.RotationYawPitchRoll(rand() * 6.3, (rand() - 0.5) * 0.2, (rand() - 0.5) * 0.2), this.M.rust);
      else this.chunk(rand, px, s * 0.3, pz, s, s * 0.85, s, this.M.concrete);
    }
  }

  /** Fallen I-beam: foot on the deck, head resting against the wall (yaw = toward the wall). */
  private beam(rand: Rand, x: number, z: number, yaw: number): void {
    const L = 4.2;
    const rise = 1.6 + rand() * 0.6;
    const pitch = Math.asin(rise / L);
    const run = Math.sqrt(L * L - rise * rise);
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    // Head touches the wall ~1.8 m ahead of the spot; the foot lands `run` back from there.
    const fx = x + dx * (1.8 - run), fz = z + dz * (1.8 - run);
    const rot = Quaternion.RotationYawPitchRoll(yaw, -pitch, (rand() - 0.5) * 0.15);
    const centre = new Vector3(fx + dx * run * 0.5, rise * 0.5 + 0.12, fz + dz * run * 0.5);
    const at = (o: Vector3) => centre.add(o.rotateByQuaternionToRef(rot, new Vector3()));
    for (const s of [-1, 1]) {
      const p = at(new Vector3(0, s * 0.15, 0));
      this.plate(p.x, p.y, p.z, 0.3, 0.035, L, rot, this.M.rust);
    }
    const w = at(Vector3.Zero());
    this.plate(w.x, w.y, w.z, 0.03, 0.3, L, rot, this.M.rust);
    // Concrete it knocked loose at the foot.
    this.pile(rand, fx, fz, 0.8, this.M.concrete);
  }

  /** Cluster of drums: upright, crushed and one rolled onto its side. */
  private barrels(rand: Rand, x: number, z: number, yaw: number): void {
    const n = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const a = yaw + (i - n / 2) * 0.9 + (rand() - 0.5) * 0.4;
      const d = 0.35 + rand() * 0.7;
      this.drum(rand, x + Math.sin(a) * d, z + Math.cos(a) * d, rand() < 0.3, i === n - 1);
    }
    this.scatter(rand, x, z, 1.2);
  }

  /** Cracked wall slab leaning against the wall, rebar sticking out of its broken edge. */
  private slab(rand: Rand, x: number, z: number, yaw: number): void {
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    const rot = Quaternion.RotationYawPitchRoll(yaw + (rand() - 0.5) * 0.3, -1.05, 0);
    const c = new Vector3(x + dx * 0.55, 0.9, z + dz * 0.55);
    // A broken panel: three irregular slabs (jittered, flattened chunks) stacked against the wall.
    for (const side of [-1, 0, 1]) {
      const off = new Vector3(side * 0.7, side === 0 ? 0.35 : 0, (rand() - 0.5) * 0.15).rotateByQuaternionToRef(rot, new Vector3());
      const p = c.add(off);
      this.chunk(rand, p.x, p.y, p.z, 1.2, 0.32, 1.5 + rand() * 0.6, this.M.concrete, rot.multiply(Quaternion.RotationYawPitchRoll((rand() - 0.5) * 0.2, (rand() - 0.5) * 0.15, (rand() - 0.5) * 0.2)));
    }
    for (let i = 0; i < 4; i++) {
      const b = c.add(new Vector3((rand() - 0.5) * 1.8, 0.7, 0).rotateByQuaternionToRef(rot, new Vector3()));
      const tip = b.add(new Vector3((rand() - 0.5) * 0.3, 0.35 + rand() * 0.35, (rand() - 0.5) * 0.3));
      this.rod(b, tip, 0.03, this.M.rust);
    }
    this.pile(rand, x - dx * 0.4, z - dz * 0.4, 0.9, this.M.concrete);
  }
}
