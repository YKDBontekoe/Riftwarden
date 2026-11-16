import { type DynamicTexture, type Particle, ParticleSystem, type Scene, Vector3 } from '@babylonjs/core';
import type { ArenaLayout } from '../world/layout';

/** Static collision volumes (AABBs) for cheap visual-only physics. */
export class CollisionBoxes {
  private b: Float32Array;
  readonly count: number;
  constructor(layout: ArenaLayout) {
    const list = layout.boxes;
    this.b = new Float32Array(list.length * 6);
    list.forEach((box, i) => {
      this.b.set([...box.min, ...box.max], i * 6);
    });
    this.count = list.length;
  }

  /**
   * Resolve a point (with radius) against the floor and all boxes. Reflects the velocity
   * component along the contact normal with `bounce` restitution and applies `friction`
   * to the tangential components. Returns true on contact.
   */
  collide(p: Vector3, v: Vector3, r: number, bounce: number, friction: number): boolean {
    let hit = false;
    if (p.y < r) {
      p.y = r;
      if (v.y < 0) {
        v.y = -v.y * bounce;
        v.x *= friction;
        v.z *= friction;
      }
      hit = true;
    }
    const b = this.b;
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      const x0 = b[o] - r, y0 = b[o + 1] - r, z0 = b[o + 2] - r;
      const x1 = b[o + 3] + r, y1 = b[o + 4] + r, z1 = b[o + 5] + r;
      if (p.x <= x0 || p.x >= x1 || p.y <= y0 || p.y >= y1 || p.z <= z0 || p.z >= z1) continue;
      // Push out along the axis of least penetration.
      const dx0 = p.x - x0, dx1 = x1 - p.x, dy0 = p.y - y0, dy1 = y1 - p.y, dz0 = p.z - z0, dz1 = z1 - p.z;
      const m = Math.min(dx0, dx1, dy0, dy1, dz0, dz1);
      if (m === dy1) {
        p.y = y1;
        if (v.y < 0) v.y = -v.y * bounce;
        v.x *= friction;
        v.z *= friction;
      } else if (m === dy0) {
        p.y = y0;
        if (v.y > 0) v.y = -v.y * bounce;
      } else if (m === dx0) {
        p.x = x0;
        if (v.x > 0) v.x = -v.x * bounce;
        v.y *= friction;
        v.z *= friction;
      } else if (m === dx1) {
        p.x = x1;
        if (v.x < 0) v.x = -v.x * bounce;
        v.y *= friction;
        v.z *= friction;
      } else if (m === dz0) {
        p.z = z0;
        if (v.z > 0) v.z = -v.z * bounce;
        v.x *= friction;
        v.y *= friction;
      } else {
        p.z = z1;
        if (v.z < 0) v.z = -v.z * bounce;
        v.x *= friction;
        v.y *= friction;
      }
      hit = true;
    }
    return hit;
  }
}

interface EmitRequest {
  pos: Vector3;
  normal: Vector3;
  spread: number;
  power: number;
  count: number;
}

/**
 * Molten sparks that live in the world: gravity, air drag, bouncing and skidding on the
 * deck, walls, platforms and machines, cooling from white-hot to dull red. Rendered as
 * stretched additive billboards whose length follows speed (motion-blur streaks).
 */
export class BounceSparks {
  readonly ps: ParticleSystem;
  private queue: EmitRequest[] = [];
  private pool: EmitRequest[] = [];

  constructor(scene: Scene, tex: DynamicTexture, private world: CollisionBoxes) {
    const ps = new ParticleSystem('bounceSparks', 1600, scene);
    ps.particleTexture = tex;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    ps.emitter = Vector3.Zero();
    ps.emitRate = 0;
    ps.updateSpeed = 1 / 60;
    ps.minLifeTime = 0.6;
    ps.maxLifeTime = 1.7;
    ps.minSize = 0.03;
    ps.maxSize = 0.06;
    // Direction is initialised before position for each particle; position consumes the request.
    ps.startDirectionFunction = (_wm, dir) => {
      const r = this.queue[0];
      if (!r) {
        dir.set(0, 1, 0);
        return;
      }
      const n = r.normal;
      let x = n.x + (Math.random() * 2 - 1) * r.spread;
      let y = n.y + (Math.random() * 2 - 1) * r.spread;
      let z = n.z + (Math.random() * 2 - 1) * r.spread;
      const l = Math.hypot(x, y, z) || 1;
      const s = (r.power * (0.3 + 0.7 * Math.random())) / l;
      x *= s;
      y *= s;
      z *= s;
      dir.set(x, y + r.power * 0.15, z);
    };
    ps.startPositionFunction = (_wm, pos) => {
      const r = this.queue[0];
      if (!r) return;
      pos.copyFrom(r.pos);
      if (--r.count <= 0) this.pool.push(this.queue.shift()!);
    };
    ps.updateFunction = (particles) => this.step(particles);
    ps.start();
    this.ps = ps;
  }

  emit(pos: Vector3, normal: Vector3, count: number, power: number, spread = 0.9): void {
    if (count <= 0) return;
    if (this.ps.getActiveCount() > 1400) count = Math.ceil(count * 0.3);
    const r = this.pool.pop() ?? { pos: new Vector3(), normal: new Vector3(), spread, power, count };
    r.pos.copyFrom(pos);
    r.normal.copyFrom(normal);
    r.spread = spread;
    r.power = power;
    r.count = count;
    this.queue.push(r);
    this.ps.manualEmitCount = Math.max(0, this.ps.manualEmitCount) + count;
  }

  private step(particles: Particle[]): void {
    const dt = (this.ps as unknown as { _scaledUpdateSpeed: number })._scaledUpdateSpeed;
    const drag = Math.max(0, 1 - 0.9 * dt);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.lifeTime) {
        this.ps.recycleParticle(p);
        i--;
        continue;
      }
      const v = p.direction;
      v.y -= 17 * dt;
      v.scaleInPlace(drag);
      const pos = p.position;
      pos.x += v.x * dt;
      pos.y += v.y * dt;
      pos.z += v.z * dt;
      this.world.collide(pos, v, 0.02, 0.42, 0.7);
      // Cooling: white-yellow -> orange -> deep red, fading at the end.
      const t = p.age / p.lifeTime;
      const k = 1 - t;
      const a = t > 0.7 ? (1 - t) / 0.3 : 1;
      p.color.set(5 * (0.55 + 0.45 * k), 3.6 * k * k, 2 * k * k * k * k, a);
      const speed = Math.hypot(v.x, v.y, v.z);
      p.scale.x = 1;
      p.scale.y = Math.min(7, 0.8 + speed * 0.32);
    }
  }

  reset(): void {
    this.ps.reset();
    this.queue.length = 0;
  }
}
