import { Color4, type DynamicTexture, ParticleSystem, type Scene, Vector3 } from '@babylonjs/core';
import { SEV_FIRE, SEV_SPARKS } from './wounds';
import { softenParticles } from './softParticles';
import { SMOKE_CELL, SMOKE_FRAMES } from '../visuals/textures';

interface Src {
  x: number;
  y: number;
  z: number;
  r: number;
}

interface Patch extends Src {
  life: number;
  max: number;
}

const MAX_WOUNDS = 64;
const MAX_PATCHES = 6;
const c4 = (r: number, g: number, b: number, a: number) => new Color4(r, g, b, a);

/**
 * Persistent damage presentation: wounded robots trail dark smoke, then spit sparks, then burn; heavy blasts leave
 * burning wreckage on the ground for a few seconds. Three particle systems for everything (sources are picked at
 * emission time), so the cost does not grow with the number of wounded enemies beyond the emission rate.
 */
export class Smolder {
  private pool: Src[] = Array.from({ length: MAX_WOUNDS }, () => ({ x: 0, y: 0, z: 0, r: 0 }));
  private used = 0;
  private frame = 0;
  private sev = new Float32Array(MAX_WOUNDS);
  private patches: Patch[] = [];
  private smokeSrc: Src[] = [];
  private sparkSrc: Src[] = [];
  private fireSrc: Src[] = [];
  private smoke: ParticleSystem;
  private sparks: ParticleSystem;
  private fire: ParticleSystem;
  /** Settings density (0.45..1) scales emission. */
  density = 1;

  constructor(scene: Scene, tex: { smoke: DynamicTexture; fire: DynamicTexture; spark: DynamicTexture }) {
    this.smoke = this.system(scene, 'woundSmoke', 220, tex.smoke, true);
    for (const [t, c] of [[0, c4(0.45, 0.3, 0.2, 0)], [0.08, c4(0.3, 0.28, 0.27, 0.8)], [0.5, c4(0.24, 0.24, 0.25, 0.55)], [1, c4(0.26, 0.26, 0.27, 0)]] as [number, Color4][]) this.smoke.addColorGradient(t, c);
    this.smoke.addSizeGradient(0, 0.5);
    this.smoke.addSizeGradient(0.4, 1.4);
    this.smoke.addSizeGradient(1, 2.6);
    this.smoke.minLifeTime = 1.1;
    this.smoke.maxLifeTime = 2.2;
    this.smoke.direction1.set(-0.25, 1, -0.25);
    this.smoke.direction2.set(0.25, 1.6, 0.25);
    this.smoke.minEmitPower = 0.6;
    this.smoke.maxEmitPower = 1.4;
    this.smoke.gravity.set(0.4, 0.5, 0.2); // drifts downwind a little
    this.smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    this.fire = this.system(scene, 'woundFire', 160, tex.fire);
    for (const [t, c] of [[0, c4(3.6, 2, 0.8, 0.9)], [0.3, c4(2.6, 0.9, 0.2, 0.7)], [0.7, c4(0.5, 0.15, 0.05, 0.3)], [1, c4(0, 0, 0, 0)]] as [number, Color4][]) this.fire.addColorGradient(t, c);
    this.fire.addSizeGradient(0, 0.35);
    this.fire.addSizeGradient(0.4, 0.85);
    this.fire.addSizeGradient(1, 0.4);
    this.fire.minLifeTime = 0.3;
    this.fire.maxLifeTime = 0.65;
    this.fire.direction1.set(-0.15, 1, -0.15);
    this.fire.direction2.set(0.15, 1.3, 0.15);
    this.fire.minEmitPower = 1.2;
    this.fire.maxEmitPower = 2.6;
    this.fire.gravity.set(0, 2, 0);
    this.fire.blendMode = ParticleSystem.BLENDMODE_ADD;
    this.fire.minAngularSpeed = -1.5;
    this.fire.maxAngularSpeed = 1.5;
    this.fire.maxInitialRotation = Math.PI * 2;

    this.sparks = this.system(scene, 'woundSparks', 200, tex.spark);
    for (const [t, c] of [[0, c4(4.5, 3, 1.3, 1)], [0.5, c4(3, 1, 0.2, 1)], [1, c4(0.8, 0.1, 0, 0)]] as [number, Color4][]) this.sparks.addColorGradient(t, c);
    this.sparks.minSize = 0.03;
    this.sparks.maxSize = 0.06;
    this.sparks.minScaleY = 3;
    this.sparks.maxScaleY = 6;
    this.sparks.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    this.sparks.minLifeTime = 0.2;
    this.sparks.maxLifeTime = 0.55;
    this.sparks.direction1.set(-1, 0.2, -1);
    this.sparks.direction2.set(1, 1.4, 1);
    this.sparks.minEmitPower = 3;
    this.sparks.maxEmitPower = 8;
    this.sparks.gravity.set(0, -16, 0);
    this.sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
  }

  /** Plain single-sprite systems (the plume sheet drawn whole reads as a cluster of puffs), randomly rotated. */
  private system(scene: Scene, name: string, cap: number, tex: DynamicTexture, smoke = false): ParticleSystem {
    const ps = new ParticleSystem(name, cap, scene, undefined, smoke);
    if (smoke) {
      // Standard-blend smoke renders through the soft-particle shader with the sprite sheet, like Effects' smoke.
      ps.spriteCellWidth = ps.spriteCellHeight = SMOKE_CELL;
      ps.endSpriteCellID = SMOKE_FRAMES - 1;
      ps.spriteCellChangeSpeed = 1;
      ps.spriteRandomStartCell = true;
      softenParticles(scene, ps, 0.35);
    }
    ps.minAngularSpeed = -0.8;
    ps.maxAngularSpeed = 0.8;
    ps.maxInitialRotation = Math.PI * 2;
    ps.particleTexture = tex;
    ps.emitter = Vector3.Zero();
    ps.emitRate = 0;
    ps.updateSpeed = 1 / 60;
    ps.start();
    return ps;
  }

  /** Report a wounded machine for this frame: centre, body radius and severity 0..1 (see woundSeverity). */
  wound(pos: Vector3, radius: number, severity: number): void {
    if (severity <= 0 || this.used >= MAX_WOUNDS) return;
    const s = this.pool[this.used];
    s.x = pos.x;
    s.y = pos.y + radius * 0.8;
    s.z = pos.z;
    s.r = radius * 0.55;
    this.sev[this.used++] = severity;
  }

  /** Burning wreckage on the ground (heavy explosions) for `seconds`. */
  linger(pos: Vector3, radius: number, seconds: number): void {
    if (seconds <= 0) return;
    let p: Patch;
    if (this.patches.length < MAX_PATCHES) this.patches.push((p = { x: 0, y: 0, z: 0, r: 0, life: 0, max: 0 }));
    else p = this.patches.reduce((a, b) => (a.life < b.life ? a : b));
    p.x = pos.x;
    p.y = Math.max(0.2, Math.min(pos.y, 1.2));
    p.z = pos.z;
    p.r = radius;
    p.life = p.max = seconds;
  }

  get active(): number {
    return this.smoke.getActiveCount() + this.fire.getActiveCount() + this.sparks.getActiveCount();
  }

  update(dt: number): void {
    this.smokeSrc.length = this.sparkSrc.length = this.fireSrc.length = 0;
    let smoke = 0, sparks = 0, fire = 0;
    for (let i = 0; i < this.used; i++) {
      const s = this.pool[i];
      const k = this.sev[i];
      this.smokeSrc.push(s);
      smoke += 12 + 22 * k;
      if (k >= SEV_SPARKS) {
        this.sparkSrc.push(s);
        sparks += 30 * k;
      }
      if (k >= SEV_FIRE) {
        this.fireSrc.push(s);
        fire += 45 * k;
      }
    }
    this.used = 0;
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.patches.splice(i, 1);
        continue;
      }
      const k = Math.min(1, p.life / (p.max * 0.5));
      this.smokeSrc.push(p);
      this.fireSrc.push(p);
      smoke += 14 * k;
      fire += 40 * k;
      if (Math.random() < dt * 3 * k) {
        this.sparkSrc.push(p);
        sparks += 30;
      }
    }
    // Damage states are gameplay readability: low settings thin them less than bursts.
    // One emitter per system hops between the sources frame by frame (custom start-position functions did not
    // render in testing); the emission box covers the source's body.
    this.frame++;
    anchor(this.smoke, this.smokeSrc, this.frame);
    anchor(this.sparks, this.sparkSrc, this.frame);
    anchor(this.fire, this.fireSrc, this.frame);
    const d = 0.55 + 0.45 * this.density;
    this.smoke.emitRate = smoke * d;
    this.sparks.emitRate = sparks * d;
    this.fire.emitRate = fire * d;
  }

  reset(): void {
    this.used = 0;
    this.patches.length = 0;
    this.smokeSrc.length = this.sparkSrc.length = this.fireSrc.length = 0;
    for (const ps of [this.smoke, this.sparks, this.fire]) {
      ps.emitRate = 0;
      ps.reset();
    }
  }
}

function anchor(ps: ParticleSystem, list: Src[], frame: number): void {
  const s = list[frame % Math.max(1, list.length)];
  if (!s) return;
  (ps.emitter as Vector3).set(s.x, s.y, s.z);
  ps.minEmitBox.set(-s.r, -s.r * 0.2, -s.r);
  ps.maxEmitBox.set(s.r, s.r * 0.4, s.r);
}
