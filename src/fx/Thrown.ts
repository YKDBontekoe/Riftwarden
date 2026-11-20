import { type Mesh, MeshBuilder, type PBRMaterial, type Scene, Vector3 } from '@babylonjs/core';
import { throwStep } from '../abilities/defs';
import { unlit } from '../visuals/materials';

interface Body {
  mesh: Mesh;
  pos: Vector3;
  vel: Vector3;
  life: number;
}

/**
 * Visual of thrown ability charges: a glowing sphere on the same ballistic path as the logic (`throwStep`). It is
 * presentation only, so the co-op server replicates it as an fx call and every client draws the charge; the
 * thrower's logic ends it with `end(at)` when it bursts (also replicated).
 */
export class Thrown {
  private live: Body[] = [];
  private free: Mesh[] = [];
  private mats = new Map<string, PBRMaterial>();

  constructor(private readonly scene: Scene) {}

  spawn(pos: Vector3, vel: Vector3, life: number, cold: boolean): void {
    const key = cold ? 'cold' : 'hot';
    let mat = this.mats.get(key);
    if (!mat) {
      mat = unlit(this.scene, `thrown_${key}`, cold ? [0.9, 2.2, 3.4] : [3.2, 1.6, 0.5]);
      this.mats.set(key, mat);
    }
    const mesh = this.free.pop() ?? MeshBuilder.CreateSphere('abilityCharge', { diameter: 0.32, segments: 8 }, this.scene);
    mesh.isPickable = false;
    mesh.material = mat;
    mesh.setEnabled(true);
    mesh.position.copyFrom(pos);
    this.live.push({ mesh, pos: pos.clone(), vel: vel.clone(), life });
  }

  /** The charge burst near `at`: remove the closest visual. */
  end(at: Vector3): void {
    let best = -1;
    let bd = 9;
    for (let i = 0; i < this.live.length; i++) {
      const d = Vector3.DistanceSquared(this.live[i].pos, at);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) this.release(best);
  }

  get count(): number {
    return this.live.length;
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i];
      throwStep(b.pos, b.vel, dt);
      b.life -= dt;
      if (b.pos.y < 0.12) {
        b.pos.y = 0.12;
        b.vel.set(0, 0, 0);
      }
      b.mesh.position.copyFrom(b.pos);
      if (b.life <= 0) this.release(i);
    }
  }

  reset(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.release(i);
  }

  private release(i: number): void {
    const b = this.live[i];
    b.mesh.setEnabled(false);
    this.free.push(b.mesh);
    this.live.splice(i, 1);
  }
}
