import {
  type AbstractMesh,
  Color3,
  Color4,
  DynamicTexture,
  ParticleSystem,
  PointLight,
  type Scene,
  Vector3,
} from '@babylonjs/core';
import type { Kit } from '../visuals/kit';
import type { Palette } from '../visuals/materials';

export type BurstKind = 'spark' | 'crit' | 'enemySpark' | 'explosion' | 'smoke' | 'shield' | 'build' | 'impact';

interface BurstConfig {
  capacity: number;
  color1: Color4;
  color2: Color4;
  colorDead: Color4;
  minSize: number;
  maxSize: number;
  minLife: number;
  maxLife: number;
  minPower: number;
  maxPower: number;
  gravity: number;
  blend: number;
  spread: number; // 0 = along normal only, 1 = full sphere
}

const ADD = ParticleSystem.BLENDMODE_ADD;
const STD = ParticleSystem.BLENDMODE_STANDARD;
const c4 = (r: number, g: number, b: number, a = 1) => new Color4(r, g, b, a);

const BURSTS: Record<BurstKind, BurstConfig> = {
  spark: { capacity: 120, color1: c4(0.6, 1, 1), color2: c4(1, 1, 1), colorDead: c4(0, 0.3, 0.4, 0), minSize: 0.05, maxSize: 0.12, minLife: 0.12, maxLife: 0.3, minPower: 4, maxPower: 10, gravity: -9, blend: ADD, spread: 0.6 },
  crit: { capacity: 120, color1: c4(1, 0.85, 0.3), color2: c4(1, 1, 0.8), colorDead: c4(0.5, 0.2, 0, 0), minSize: 0.08, maxSize: 0.18, minLife: 0.15, maxLife: 0.35, minPower: 5, maxPower: 13, gravity: -9, blend: ADD, spread: 0.7 },
  enemySpark: { capacity: 120, color1: c4(1, 0.55, 0.15), color2: c4(1, 0.85, 0.5), colorDead: c4(0.4, 0.05, 0, 0), minSize: 0.06, maxSize: 0.14, minLife: 0.15, maxLife: 0.35, minPower: 3, maxPower: 9, gravity: -9, blend: ADD, spread: 0.7 },
  impact: { capacity: 80, color1: c4(0.7, 0.95, 1), color2: c4(0.4, 0.8, 1), colorDead: c4(0, 0.1, 0.2, 0), minSize: 0.04, maxSize: 0.1, minLife: 0.1, maxLife: 0.25, minPower: 2, maxPower: 6, gravity: -6, blend: ADD, spread: 0.5 },
  explosion: { capacity: 240, color1: c4(1, 0.6, 0.2), color2: c4(1, 0.9, 0.6), colorDead: c4(0.3, 0.05, 0, 0), minSize: 0.25, maxSize: 0.8, minLife: 0.25, maxLife: 0.6, minPower: 4, maxPower: 12, gravity: -2, blend: ADD, spread: 1 },
  smoke: { capacity: 120, color1: c4(0.18, 0.18, 0.2, 0.5), color2: c4(0.3, 0.3, 0.32, 0.4), colorDead: c4(0.1, 0.1, 0.1, 0), minSize: 0.6, maxSize: 1.4, minLife: 0.6, maxLife: 1.2, minPower: 0.5, maxPower: 2.5, gravity: 1.5, blend: STD, spread: 1 },
  shield: { capacity: 120, color1: c4(1, 0.7, 0.25), color2: c4(1, 0.5, 0.1), colorDead: c4(0.5, 0.2, 0, 0), minSize: 0.08, maxSize: 0.2, minLife: 0.15, maxLife: 0.3, minPower: 3, maxPower: 7, gravity: 0, blend: ADD, spread: 0.8 },
  build: { capacity: 160, color1: c4(0.3, 1, 1), color2: c4(0.8, 1, 1), colorDead: c4(0, 0.4, 0.5, 0), minSize: 0.06, maxSize: 0.16, minLife: 0.4, maxLife: 0.8, minPower: 1, maxPower: 4, gravity: 3, blend: ADD, spread: 1 },
};

class BurstPool {
  private systems: ParticleSystem[] = [];
  private next = 0;
  constructor(scene: Scene, tex: DynamicTexture, private cfg: BurstConfig, count: number) {
    for (let i = 0; i < count; i++) {
      const ps = new ParticleSystem('burst', cfg.capacity, scene);
      ps.particleTexture = tex;
      ps.emitter = Vector3.Zero();
      ps.minEmitBox = Vector3.Zero();
      ps.maxEmitBox = Vector3.Zero();
      ps.color1 = cfg.color1;
      ps.color2 = cfg.color2;
      ps.colorDead = cfg.colorDead;
      ps.minSize = cfg.minSize;
      ps.maxSize = cfg.maxSize;
      ps.minLifeTime = cfg.minLife;
      ps.maxLifeTime = cfg.maxLife;
      ps.minEmitPower = cfg.minPower;
      ps.maxEmitPower = cfg.maxPower;
      ps.gravity = new Vector3(0, cfg.gravity, 0);
      ps.blendMode = cfg.blend;
      ps.emitRate = 0;
      ps.updateSpeed = 1 / 60;
      ps.start();
      this.systems.push(ps);
    }
  }
  emit(pos: Vector3, count: number, normal?: Vector3, scale = 1): void {
    const ps = this.systems[this.next];
    this.next = (this.next + 1) % this.systems.length;
    (ps.emitter as Vector3).copyFrom(pos);
    const n = normal ?? Vector3.Up();
    const s = this.cfg.spread;
    ps.direction1.set(n.x - s, n.y - s, n.z - s);
    ps.direction2.set(n.x + s, n.y + s, n.z + s);
    ps.minSize = this.cfg.minSize * scale;
    ps.maxSize = this.cfg.maxSize * scale;
    ps.manualEmitCount = Math.min(this.cfg.capacity, (ps.manualEmitCount > 0 ? ps.manualEmitCount : 0) + count);
  }
  get active(): number {
    let n = 0;
    for (const s of this.systems) n += s.getActiveCount();
    return n;
  }
  reset(): void {
    for (const s of this.systems) s.reset();
  }
}

interface Tracer {
  mesh: AbstractMesh;
  life: number;
  max: number;
  width: number;
}

interface Debris {
  mesh: AbstractMesh;
  vel: Vector3;
  spin: Vector3;
  life: number;
  size: number;
}

export interface Projectile {
  mesh: AbstractMesh;
  pos: Vector3;
  vel: Vector3;
  damage: number;
  life: number;
  active: boolean;
}

const TMP = new Vector3();

/**
 * All transient visuals. Gameplay never depends on these; they can be capped or
 * thinned without changing outcomes (logical events != rendered particles).
 */
export class Effects {
  private bursts = new Map<BurstKind, BurstPool>();
  private tracers: { pool: Tracer[]; next: number }[] = [];
  private debris: Debris[] = [];
  private debrisNext = 0;
  readonly projectiles: Projectile[] = [];
  private flash: PointLight;
  private flashLife = 0;
  private flashMax = 1;
  private flashPeak = 0;
  /** Visual budget: when particles exceed this, bursts are thinned. */
  particleBudget = 1400;

  constructor(private scene: Scene, kit: Kit, P: Palette) {
    const tex = new DynamicTexture('particleTex', { width: 64, height: 64 }, scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    tex.update();
    tex.hasAlpha = true;

    const poolSizes: Record<BurstKind, number> = { spark: 10, crit: 6, enemySpark: 8, impact: 10, explosion: 8, smoke: 6, shield: 5, build: 3 };
    for (const k of Object.keys(BURSTS) as BurstKind[]) this.bursts.set(k, new BurstPool(scene, tex, BURSTS[k], poolSizes[k]));

    const root = kit.node('fxRoot', null);
    for (const mat of [P.whiteGlow, P.cyanGlow, P.orangeGlow]) {
      const pool: Tracer[] = [];
      for (let i = 0; i < 48; i++) {
        const m = kit.part('box', mat, root, { scale: [0, 0, 0] });
        m.setEnabled(false);
        pool.push({ mesh: m, life: 0, max: 1, width: 0.05 });
      }
      this.tracers.push({ pool, next: 0 });
    }
    for (let i = 0; i < 80; i++) {
      const m = kit.part('box', i % 3 === 0 ? P.enemyDark : i % 3 === 1 ? P.enemyArmor : P.orangeGlow, root);
      m.setEnabled(false);
      this.debris.push({ mesh: m, vel: new Vector3(), spin: new Vector3(), life: 0, size: 0.2 });
    }
    for (let i = 0; i < 48; i++) {
      const m = kit.part('sphere', P.orangeGlow, root, { scale: [0.38, 0.38, 0.38] });
      kit.part('sphere', P.whiteGlow, m as never, { scale: [0.5, 0.5, 0.5] });
      m.setEnabled(false);
      this.projectiles.push({ mesh: m, pos: new Vector3(), vel: new Vector3(), damage: 0, life: 0, active: false });
    }

    this.flash = new PointLight('fxFlash', Vector3.Zero(), scene);
    this.flash.diffuse = new Color3(1, 0.6, 0.25);
    this.flash.specular = new Color3(0.4, 0.3, 0.2);
    this.flash.range = 16;
    this.flash.intensity = 0;
  }

  get particleCount(): number {
    let n = 0;
    for (const p of this.bursts.values()) n += p.active;
    return n;
  }

  burst(kind: BurstKind, pos: Vector3, count: number, normal?: Vector3, scale = 1): void {
    const over = this.particleCount > this.particleBudget;
    this.bursts.get(kind)!.emit(pos, over ? Math.ceil(count * 0.3) : count, normal, scale);
  }

  /** color: 0 = player (white-blue), 1 = turret (cyan), 2 = hostile (orange) */
  tracer(from: Vector3, to: Vector3, color: 0 | 1 | 2, width = 0.05, life = 0.07): void {
    const t = this.tracers[color];
    const tr = t.pool[t.next];
    t.next = (t.next + 1) % t.pool.length;
    const len = Vector3.Distance(from, to);
    if (len < 0.01) return;
    const m = tr.mesh;
    m.setEnabled(true);
    Vector3.LerpToRef(from, to, 0.5, m.position);
    m.lookAt(to);
    m.scaling.set(width, width, len);
    tr.life = life;
    tr.max = life;
    tr.width = width;
  }

  flashLight(pos: Vector3, intensity: number, duration: number, color?: Color3): void {
    this.flash.position.copyFrom(pos);
    if (color) this.flash.diffuse.copyFrom(color);
    else this.flash.diffuse.set(1, 0.6, 0.25);
    this.flashPeak = intensity;
    this.flashLife = duration;
    this.flashMax = duration;
  }

  debrisBurst(pos: Vector3, count: number, power: number, sizeScale = 1): void {
    for (let i = 0; i < count; i++) {
      const d = this.debris[this.debrisNext];
      this.debrisNext = (this.debrisNext + 1) % this.debris.length;
      d.mesh.setEnabled(true);
      d.mesh.position.copyFrom(pos).addInPlaceFromFloats((Math.random() - 0.5) * 0.6, (Math.random() - 0.2) * 0.6, (Math.random() - 0.5) * 0.6);
      d.vel.set((Math.random() - 0.5) * power, Math.random() * power * 0.9 + 2, (Math.random() - 0.5) * power);
      d.spin.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
      d.size = (0.1 + Math.random() * 0.22) * sizeScale;
      d.mesh.scaling.setAll(d.size);
      d.life = 1.2 + Math.random() * 0.6;
    }
  }

  spawnProjectile(pos: Vector3, vel: Vector3, damage: number): void {
    const p = this.projectiles.find((x) => !x.active);
    if (!p) return;
    p.active = true;
    p.pos.copyFrom(pos);
    p.vel.copyFrom(vel);
    p.damage = damage;
    p.life = 4;
    p.mesh.position.copyFrom(pos);
    p.mesh.setEnabled(true);
  }

  killProjectile(p: Projectile): void {
    p.active = false;
    p.mesh.setEnabled(false);
  }

  /** dt = real time; hdt = hostile (dilated) time. Projectiles are hostile and use hdt. */
  update(dt: number): void {
    for (const t of this.tracers) {
      for (const tr of t.pool) {
        if (tr.life <= 0) continue;
        tr.life -= dt;
        if (tr.life <= 0) {
          tr.mesh.setEnabled(false);
          continue;
        }
        const f = tr.life / tr.max;
        tr.mesh.scaling.x = tr.mesh.scaling.y = tr.width * f;
      }
    }
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.mesh.setEnabled(false);
        continue;
      }
      d.vel.y -= 22 * dt;
      d.mesh.position.addInPlace(d.vel.scaleToRef(dt, TMP));
      if (d.mesh.position.y < d.size * 0.5) {
        d.mesh.position.y = d.size * 0.5;
        d.vel.y *= -0.35;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
        d.spin.scaleInPlace(0.5);
      }
      d.mesh.rotation.addInPlace(d.spin.scaleToRef(dt, TMP));
      if (d.life < 0.4) d.mesh.scaling.setAll(d.size * (d.life / 0.4));
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flash.intensity = Math.max(0, this.flashLife / this.flashMax) * this.flashPeak;
    } else this.flash.intensity = 0;
  }

  reset(): void {
    for (const t of this.tracers) for (const tr of t.pool) {
      tr.life = 0;
      tr.mesh.setEnabled(false);
    }
    for (const d of this.debris) {
      d.life = 0;
      d.mesh.setEnabled(false);
    }
    for (const p of this.projectiles) this.killProjectile(p);
    for (const b of this.bursts.values()) b.reset();
    this.flashLife = 0;
    void this.scene;
  }
}
