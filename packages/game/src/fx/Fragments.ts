import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Quaternion, Vector3, type Vector4 } from '@babylonjs/core/Maths/math.vector';
import { type AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { type Mesh } from '@babylonjs/core/Meshes/mesh';
import { type TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { FLASH_BUFFER, initFlash } from '../visuals/hitFlashPlugin';
import type { CollisionBoxes } from './sparks';
import { pickFragments, type FragmentCandidate } from './fragmentPlan';

/** One detached piece of a destroyed rig: a GPU instance of the same kit template the part used. */
interface Frag {
  mesh: InstancedMesh;
  src: Mesh;
  vel: Vector3;
  spin: Vector3;
  life: number;
  max: number;
  radius: number;
  base: Vector3;
  /** Hot glow 0..1 (cools down; drives the hit-flash buffer and the smoke trail). */
  heat: number;
  flash: Vector4 | null;
}

const S = new Vector3();
const P = new Vector3();
const Q = new Quaternion();
const D = new Vector3();
const AXIS = new Quaternion();

/**
 * Mechanical fragmentation: when a robot bursts, its own armour plates, limbs, heads and housings are thrown
 * as physical pieces (same geometry and material as on the rig, so a walker's shin really flies off).
 * Pieces are pooled instances per kit template, bounced off the floor and level boxes, glow hot for a moment,
 * then shrink away. The total number of live pieces is capped: the oldest piece is recycled first.
 */
export class Fragments {
  private free = new Map<Mesh, InstancedMesh[]>();
  private live: Frag[] = [];
  private spare: Frag[] = [];
  /** Hard cap of live pieces (settings density scales it). */
  cap = 72;
  /** Hot pieces this frame (Effects' smoke trail emits from them). */
  readonly hot: AbstractMesh[] = [];

  constructor(private world: CollisionBoxes) {}

  get count(): number {
    return this.live.length;
  }

  /**
   * Throw up to `max` of the largest visible solid parts under `root` away from `center`.
   * `power` is the outward speed (m/s); `heat` 0..1 the initial glow. Returns the number of pieces thrown.
   */
  shatter(root: TransformNode, center: Vector3, power: number, max: number, heat = 1): number {
    if (max <= 0 || this.cap <= 0) return 0;
    const cands: FragmentCandidate<InstancedMesh>[] = [];
    for (const m of root.getChildMeshes(false)) {
      if (!(m instanceof InstancedMesh) || !m.isEnabled() || !m.isVisible) continue;
      const mat = m.sourceMesh.material;
      if (!(mat instanceof PBRMaterial) || mat.unlit || mat.alpha < 1 || mat.needAlphaBlending()) continue;
      m.computeWorldMatrix(true).decompose(S, undefined, undefined);
      cands.push({ item: m, sx: Math.abs(S.x), sy: Math.abs(S.y), sz: Math.abs(S.z) });
    }
    const picked = pickFragments(cands, max);
    for (const c of picked) this.throwPiece(c.item, center, power, heat);
    return picked.length;
  }

  private throwPiece(part: InstancedMesh, center: Vector3, power: number, heat: number): void {
    if (this.live.length >= this.cap) this.retire(0);
    const src = part.sourceMesh;
    const list = this.free.get(src);
    let mesh = list?.pop();
    if (!mesh) {
      mesh = src.createInstance('frag');
      mesh.isPickable = false;
      mesh.rotationQuaternion = new Quaternion();
    }
    const flash = src.instancedBuffers?.[FLASH_BUFFER] !== undefined ? (mesh.instancedBuffers[FLASH_BUFFER] as Vector4 | undefined) ?? initFlash(mesh) : null;
    part.computeWorldMatrix(true).decompose(S, Q, P);
    mesh.parent = null;
    mesh.position.copyFrom(P);
    mesh.rotationQuaternion!.copyFrom(Q);
    mesh.scaling.copyFrom(S);
    mesh.setEnabled(true);
    const f = this.spare.pop() ?? { mesh, src, vel: new Vector3(), spin: new Vector3(), life: 0, max: 1, radius: 0.1, base: new Vector3(), heat: 0, flash };
    f.mesh = mesh;
    f.src = src;
    f.flash = flash;
    f.base.copyFrom(S);
    const big = Math.max(Math.abs(S.x), Math.abs(S.y), Math.abs(S.z));
    f.radius = Math.max(0.05, Math.min(0.6, Math.min(Math.abs(S.x), Math.abs(S.y), Math.abs(S.z)) * 0.5 + big * 0.12));
    // Outward from the blast centre, biased upward; heavy pieces fly slower and spin less.
    D.copyFrom(P).subtractInPlace(center);
    D.y = Math.max(0, D.y) + 0.35;
    const l = D.length() || 1;
    const mass = Math.min(1, 0.25 + big * 0.6);
    const sp = power * (0.55 + Math.random() * 0.7) / Math.sqrt(mass + 0.4);
    f.vel.set((D.x / l) * sp + (Math.random() - 0.5) * 2, (D.y / l) * sp + 2.5 + Math.random() * 3.5, (D.z / l) * sp + (Math.random() - 0.5) * 2);
    const w = 9 / (0.6 + big * 2);
    f.spin.set((Math.random() - 0.5) * w, (Math.random() - 0.5) * w, (Math.random() - 0.5) * w);
    f.life = f.max = 2.6 + Math.random() * 1.6;
    f.heat = heat * (0.6 + Math.random() * 0.4);
    this.live.push(f);
  }

  private retire(i: number): void {
    const f = this.live[i];
    this.live.splice(i, 1);
    f.mesh.setEnabled(false);
    f.flash?.set(0, 0, 0, 0);
    let list = this.free.get(f.src);
    if (!list) this.free.set(f.src, (list = []));
    list.push(f.mesh);
    this.spare.push(f);
  }

  update(dt: number): void {
    this.hot.length = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.retire(i);
        continue;
      }
      const m = f.mesh;
      f.vel.y -= 24 * dt;
      m.position.addInPlace(D.copyFrom(f.vel).scaleInPlace(dt));
      if (this.world.collide(m.position, f.vel, f.radius, 0.28, 0.55)) {
        f.spin.scaleInPlace(0.55);
        f.heat *= 0.8;
      }
      const w = f.spin.length();
      if (w > 0.01) {
        Quaternion.RotationAxisToRef(D.copyFrom(f.spin).scaleInPlace(1 / w), w * dt, AXIS);
        AXIS.multiplyToRef(m.rotationQuaternion!, m.rotationQuaternion!);
      }
      f.heat = Math.max(0, f.heat - dt * 0.7);
      // Glowing edges cool from orange to a dull red (hit-flash buffer, additive).
      f.flash?.set(1, 0.22 + 0.25 * f.heat, 0.04, f.heat * f.heat * 0.6);
      if (f.heat > 0.35) this.hot.push(m);
      // Shrink away over the last 0.6 s.
      const k = f.life < 0.6 ? f.life / 0.6 : 1;
      m.scaling.copyFrom(f.base).scaleInPlace(Math.max(0.001, k));
    }
  }

  reset(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.retire(i);
    this.hot.length = 0;
  }
}
