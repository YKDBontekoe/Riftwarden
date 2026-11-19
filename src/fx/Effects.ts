import {
  type AbstractMesh,
  Color3,
  Color4,
  type DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PBRMaterial,
  PointLight,
  type Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import type { SurfaceImpact } from '../combat/Weapon';
import { softenParticles } from './softParticles';
import type { Kit } from '../visuals/kit';
import type { ArenaLayout } from '../world/layout';
import { BounceSparks, CollisionBoxes } from './sparks';
import { type Palette, unlit } from '../visuals/materials';
import { flareSprite, plumeSprite, ringSprite, scorchSprite, SMOKE_CELL, SMOKE_FRAMES, sparkSprite, starSprite } from '../visuals/textures';

export type BurstKind =
  | 'spark'
  | 'crit'
  | 'enemySpark'
  | 'explosion'
  | 'smoke'
  | 'shield'
  | 'build'
  | 'impact'
  | 'flash'
  | 'fire'
  | 'sparks'
  | 'embers'
  | 'puff'
  | 'zap'
  | 'frost'
  | 'mist';


type TexKey = 'flare' | 'fire' | 'smoke' | 'spark' | 'star';

interface BurstConfig {
  tex: TexKey;
  capacity: number;
  colors: [number, Color4][];
  /** Absolute particle size over life (scaled per emission). Without it, min/maxSize is used. */
  sizes?: [number, number][];
  minSize: number;
  maxSize: number;
  minLife: number;
  maxLife: number;
  minPower: number;
  maxPower: number;
  gravity: number;
  blend: number;
  spread: number; // 0 = along normal only, 1 = full sphere
  /** Stretched billboards: length multiplier along velocity. */
  stretch?: number;
  drag?: number;
  spin?: number;
  emitRadius?: number;
}

const ADD = ParticleSystem.BLENDMODE_ADD;
const STD = ParticleSystem.BLENDMODE_STANDARD;
const c4 = (r: number, g: number, b: number, a = 1) => new Color4(r, g, b, a);

const BURSTS: Record<BurstKind, BurstConfig> = {
  // Player hits: bright cyan-white streaks.
  spark: { tex: 'spark', capacity: 120, colors: [[0, c4(2, 3, 3.4)], [0.6, c4(0.6, 1.6, 2)], [1, c4(0, 0.3, 0.4, 0)]], minSize: 0.04, maxSize: 0.07, minLife: 0.12, maxLife: 0.32, minPower: 5, maxPower: 13, gravity: -12, blend: ADD, spread: 0.6, stretch: 5 },
  crit: { tex: 'spark', capacity: 140, colors: [[0, c4(4, 3.4, 1.4)], [0.5, c4(3, 1.8, 0.3)], [1, c4(0.6, 0.2, 0, 0)]], minSize: 0.05, maxSize: 0.09, minLife: 0.15, maxLife: 0.4, minPower: 7, maxPower: 16, gravity: -12, blend: ADD, spread: 0.75, stretch: 6 },
  enemySpark: { tex: 'spark', capacity: 140, colors: [[0, c4(3.6, 1.9, 0.6)], [0.6, c4(2.4, 0.6, 0.1)], [1, c4(0.4, 0.05, 0, 0)]], minSize: 0.045, maxSize: 0.08, minLife: 0.15, maxLife: 0.4, minPower: 4, maxPower: 11, gravity: -12, blend: ADD, spread: 0.7, stretch: 5 },
  impact: { tex: 'spark', capacity: 100, colors: [[0, c4(2.2, 3, 3.4)], [0.5, c4(0.8, 1.8, 2.4)], [1, c4(0, 0.15, 0.25, 0)]], minSize: 0.03, maxSize: 0.06, minLife: 0.1, maxLife: 0.3, minPower: 3, maxPower: 9, gravity: -10, blend: ADD, spread: 0.55, stretch: 4 },
  // Legacy generic explosion glow (still used for small pops).
  explosion: { tex: 'flare', capacity: 240, colors: [[0, c4(3, 1.6, 0.6)], [0.4, c4(2, 0.6, 0.12)], [1, c4(0.3, 0.05, 0, 0)]], minSize: 0.25, maxSize: 0.8, minLife: 0.25, maxLife: 0.6, minPower: 4, maxPower: 12, gravity: -2, blend: ADD, spread: 1, drag: 2 },
  // Thick billowing smoke that lingers and rises.
  smoke: {
    tex: 'smoke', capacity: 160,
    colors: [[0, c4(0.5, 0.22, 0.08, 0)], [0.06, c4(0.32, 0.19, 0.13, 0.68)], [0.3, c4(0.095, 0.1, 0.12, 0.69)], [1, c4(0.13, 0.13, 0.14, 0)]],
    sizes: [[0, 0.85], [0.25, 2.55], [0.65, 3.6], [1, 4.6]],
    minSize: 1, maxSize: 1, minLife: 1.8, maxLife: 3.6, minPower: 0.8, maxPower: 3, gravity: 1.3, blend: STD, spread: 1, drag: 1.4, spin: 0.6, emitRadius: 0.5,
  },
  shield: { tex: 'spark', capacity: 140, colors: [[0, c4(3.4, 1.6, 0.4)], [1, c4(1, 0.2, 0, 0)]], minSize: 0.05, maxSize: 0.1, minLife: 0.15, maxLife: 0.35, minPower: 3, maxPower: 8, gravity: 0, blend: ADD, spread: 0.85, stretch: 3 },
  build: { tex: 'flare', capacity: 160, colors: [[0, c4(0.5, 2.2, 2.6)], [0.6, c4(0.2, 1.2, 1.6)], [1, c4(0, 0.4, 0.5, 0)]], minSize: 0.06, maxSize: 0.16, minLife: 0.4, maxLife: 0.9, minPower: 1, maxPower: 4, gravity: 3, blend: ADD, spread: 1, drag: 1 },
  // Explosion layers
  flash: { tex: 'star', capacity: 8, colors: [[0, c4(6, 4.4, 3, 1)], [1, c4(2, 0.6, 0.1, 0)]], minSize: 3, maxSize: 4.2, minLife: 0.07, maxLife: 0.13, minPower: 0, maxPower: 0, gravity: 0, blend: ADD, spread: 0, spin: 0 },
  fire: {
    tex: 'fire', capacity: 120,
    colors: [[0, c4(4.2, 2.6, 1.25, 1)], [0.15, c4(4, 1.6, 0.4, 1)], [0.4, c4(1.6, 0.55, 0.15, 0.7)], [0.7, c4(0.18, 0.12, 0.08, 0.35)], [1, c4(0, 0, 0, 0)]],
    sizes: [[0, 0.7], [0.25, 1.8], [1, 2.6]],
    minSize: 1, maxSize: 1, minLife: 0.35, maxLife: 0.85, minPower: 1.5, maxPower: 5.5, gravity: 2.2, blend: ADD, spread: 1, drag: 3.2, spin: 1.5, emitRadius: 0.35,
  },
  sparks: { tex: 'spark', capacity: 220, colors: [[0, c4(5, 3.2, 1.4)], [0.5, c4(3.6, 1.1, 0.2)], [1, c4(1, 0.15, 0, 0)]], minSize: 0.05, maxSize: 0.1, minLife: 0.35, maxLife: 1.0, minPower: 8, maxPower: 22, gravity: -15, blend: ADD, spread: 1, stretch: 7, drag: 0.8 },
  embers: { tex: 'flare', capacity: 200, colors: [[0, c4(4, 1.6, 0.4)], [0.5, c4(2.4, 0.5, 0.08)], [1, c4(0.4, 0.05, 0, 0)]], minSize: 0.05, maxSize: 0.13, minLife: 1, maxLife: 2.4, minPower: 2, maxPower: 7, gravity: -2.5, blend: ADD, spread: 1, drag: 2.2 },
  // M5 elemental identities: electric = hard blue-white zaps, cryo = pale drifting frost motes.
  zap: { tex: 'spark', capacity: 200, colors: [[0, c4(3.2, 4, 5)], [0.4, c4(0.9, 1.9, 4.5)], [1, c4(0.1, 0.3, 1.6, 0)]], minSize: 0.04, maxSize: 0.08, minLife: 0.1, maxLife: 0.28, minPower: 6, maxPower: 15, gravity: 0, blend: ADD, spread: 1, stretch: 7 },
  frost: { tex: 'flare', capacity: 220, colors: [[0, c4(1.8, 2.6, 3)], [0.5, c4(0.9, 1.7, 2.4)], [1, c4(0.4, 0.9, 1.4, 0)]], minSize: 0.07, maxSize: 0.2, minLife: 0.5, maxLife: 1.1, minPower: 0.6, maxPower: 3, gravity: 1.6, blend: ADD, spread: 1, drag: 1.5, emitRadius: 0.4 },
  // Small dust/smoke puff for surface impacts.
  puff: {
    tex: 'smoke', capacity: 80,
    colors: [[0, c4(0.35, 0.37, 0.4, 0)], [0.1, c4(0.32, 0.34, 0.37, 0.35)], [1, c4(0.3, 0.3, 0.32, 0)]],
    sizes: [[0, 0.15], [1, 0.8]],
    minSize: 1, maxSize: 1, minLife: 0.5, maxLife: 0.9, minPower: 0.3, maxPower: 1.2, gravity: 0.6, blend: STD, spread: 0.4, drag: 2, spin: 0.8,
  },
  mist: {
    tex: 'smoke', capacity: 70,
    colors: [[0, c4(0.48, 0.69, 0.78, 0.23)], [0.24, c4(0.4, 0.54, 0.63, 0.36)], [1, c4(0.34, 0.45, 0.51, 0)]],
    sizes: [[0, 0.18], [0.32, 0.45], [1, 0.93]],
    minSize: 1, maxSize: 1, minLife: 0.36, maxLife: 0.69, minPower: 0.8, maxPower: 2.4,
    gravity: 0.36, blend: STD, spread: 0.77, drag: 2.1, spin: 0.9,
  },

};

function configureSmoke(ps: ParticleSystem): void {
  ps.spriteCellWidth = ps.spriteCellHeight = SMOKE_CELL;
  ps.endSpriteCellID = SMOKE_FRAMES - 1;
  ps.spriteCellChangeSpeed = 1;
  ps.spriteRandomStartCell = true;
}

class BurstPool {
  private systems: ParticleSystem[] = [];
  private next = 0;
  constructor(scene: Scene, tex: DynamicTexture, private cfg: BurstConfig, count: number) {
    for (let i = 0; i < count; i++) {
      const smoke = cfg.tex === 'smoke';
      const ps = new ParticleSystem('burst', cfg.capacity, scene, undefined, smoke);
      if (smoke) {
        configureSmoke(ps);
        softenParticles(scene, ps, cfg.capacity === BURSTS.smoke.capacity ? 0.6 : 0.26);
      }
      ps.particleTexture = tex;
      ps.emitter = Vector3.Zero();
      const r = cfg.emitRadius ?? 0;
      ps.minEmitBox = new Vector3(-r, -r, -r);
      ps.maxEmitBox = new Vector3(r, r, r);
      for (const [t, c] of cfg.colors) ps.addColorGradient(t, c);
      if (cfg.sizes) for (const [t, s] of cfg.sizes) ps.addSizeGradient(t, s);
      ps.minSize = cfg.minSize;
      ps.maxSize = cfg.maxSize;
      ps.minLifeTime = cfg.minLife;
      ps.maxLifeTime = cfg.maxLife;
      ps.minEmitPower = cfg.minPower;
      ps.maxEmitPower = cfg.maxPower;
      ps.gravity = new Vector3(0, cfg.gravity, 0);
      ps.blendMode = cfg.blend;
      if (cfg.stretch) ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
      if (cfg.drag) ps.addDragGradient(0, Math.min(1, cfg.drag / 10));
      if (cfg.spin !== undefined) {
        ps.minAngularSpeed = -cfg.spin;
        ps.maxAngularSpeed = cfg.spin;
        ps.minInitialRotation = 0;
        ps.maxInitialRotation = Math.PI * 2;
      }
      ps.emitRate = 0;
      ps.updateSpeed = 1 / 60;
      ps.start();
      this.systems.push(ps);
    }
  }
  emit(pos: Vector3, count: number, normal?: Vector3, scale = 1): void {
    if (count <= 0) return;
    const ps = this.systems[this.next];
    this.next = (this.next + 1) % this.systems.length;
    (ps.emitter as Vector3).copyFrom(pos);
    const n = normal ?? Vector3.Up();
    const s = this.cfg.spread;
    ps.direction1.set(n.x - s, n.y - s, n.z - s);
    ps.direction2.set(n.x + s, n.y + s, n.z + s);
    const stretch = this.cfg.stretch ?? 1;
    ps.minScaleX = ps.maxScaleX = scale;
    ps.minScaleY = scale * stretch * 0.6;
    ps.maxScaleY = scale * stretch;
    const pk = Math.sqrt(scale);
    ps.minEmitPower = this.cfg.minPower * pk;
    ps.maxEmitPower = this.cfg.maxPower * pk;
    const r = (this.cfg.emitRadius ?? 0) * scale;
    ps.minEmitBox.setAll(-r);
    ps.maxEmitBox.setAll(r);
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
  hot: number;
}

export interface Projectile {
  mesh: AbstractMesh;
  pos: Vector3;
  vel: Vector3;
  damage: number;
  life: number;
  active: boolean;
}

interface Ring {
  mesh: Mesh;
  mat: PBRMaterial;
  life: number;
  max: number;
  size: number;
  color: Color3;
}

interface Decal {
  mesh: Mesh;
  mat: StandardMaterial;
  life: number;
}

interface FlashLight {
  light: PointLight;
  life: number;
  max: number;
  peak: number;
}

const TMP = new Vector3();
const TMP2 = new Vector3();
const SHIELD_RIPPLE = new Color3(2.8, 1.4, 0.42);

export interface ExplosionOpts {
  /** Overall size multiplier (1 = walker). */
  scale?: number;
  /** Tint of the fireball/flash light: default warm orange. */
  color?: Color3;
  debris?: number;
  /** Leave a scorch mark when close to the deck. */
  scorch?: boolean;
}

/**
 * All transient visuals. Gameplay never depends on these; they can be capped or
 * thinned without changing outcomes (logical events != rendered particles).
 */
/** Plasma burn marks last this long and shrink away over the final HOLE_FADE seconds. */
const HOLE_LIFE = 22;
const HOLE_FADE = 5;

export class Effects {
  private bursts = new Map<BurstKind, BurstPool>();
  private tracers: { pool: Tracer[]; next: number }[] = [];
  private debris: Debris[] = [];
  private debrisNext = 0;
  readonly projectiles: Projectile[] = [];
  private flashes: FlashLight[] = [];
  private rings: Ring[] = [];
  private ringNext = 0;
  private scorches: Decal[] = [];
  private scorchNext = 0;
  private holes: AbstractMesh[] = [];
  private holeNext = 0;
  /** Seconds left per burn mark and its full size (marks shrink away over their last seconds). */
  private holeLife = new Float32Array(64);
  private holeSize = new Float32Array(64);
  private trail: ParticleSystem;
  private plasmaTrail: ParticleSystem;
  private liveDebris: Debris[] = [];
  private liveProjectiles: Projectile[] = [];
  /** Visual budget: when particles exceed this, bursts are thinned. */
  particleBudget = 1800;
  /** M7 settings: particle density multiplier (low 0.45, medium 0.75, high 1). */
  density = 1;
  setDensity(level: 'low' | 'medium' | 'high'): void {
    this.density = level === 'low' ? 0.45 : level === 'medium' ? 0.75 : 1;
    this.particleBudget = Math.round((this.high ? 1800 : 1050) * this.density);
  }
  /** Camera shake request: world position and strength (0..1 at the source). */
  onShake: ((pos: Vector3, strength: number) => void) | null = null;

  private world: CollisionBoxes;
  private hotSparks: BounceSparks;

  constructor(private scene: Scene, kit: Kit, P: Palette, layout: ArenaLayout, private high: boolean) {
    this.particleBudget = high ? 1800 : 1050;
    const tex: Record<TexKey, DynamicTexture> = {
      flare: flareSprite(scene),
      smoke: plumeSprite(scene),
      fire: plumeSprite(scene, true),
      spark: sparkSprite(scene),
      star: starSprite(scene),
    };

    this.world = new CollisionBoxes(layout);
    this.hotSparks = new BounceSparks(scene, tex.spark, this.world);

    const poolSizes: Record<BurstKind, number> = { spark: 10, crit: 6, enemySpark: 8, impact: 10, explosion: 6, smoke: 8, shield: 5, build: 3, flash: 6, fire: 8, sparks: 8, embers: 6, puff: 8, mist: 5, zap: 8, frost: 6 };
    for (const k of Object.keys(BURSTS) as BurstKind[]) this.bursts.set(k, new BurstPool(scene, tex[BURSTS[k].tex], BURSTS[k], poolSizes[k]));

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
    for (let i = 0; i < 90; i++) {
      // Mostly charred armour plates; every fifth piece is a glowing ember chunk.
      const m = kit.part(i % 4 === 3 ? 'ico' : 'box', i % 5 === 4 ? P.orangeGlow : i % 2 ? P.enemyDark : P.enemyArmor, root);
      m.setEnabled(false);
      this.debris.push({ mesh: m, vel: new Vector3(), spin: new Vector3(), life: 0, size: 0.2, hot: 0 });
    }
    for (let i = 0; i < 48; i++) {
      const m = kit.part('sphere', P.orangeGlow, root, { scale: [0.34, 0.34, 0.34] });
      kit.part('sphere', P.whiteGlow, m as never, { scale: [0.55, 0.55, 0.55] });
      m.setEnabled(false);
      this.projectiles.push({ mesh: m, pos: new Vector3(), vel: new Vector3(), damage: 0, life: 0, active: false });
    }

    for (let i = 0; i < 2; i++) {
      const light = new PointLight('fxFlash', Vector3.Zero(), scene);
      light.diffuse = new Color3(1, 0.6, 0.25);
      light.specular = new Color3(0.6, 0.4, 0.25);
      light.range = 20;
      light.intensity = 0;
      this.flashes.push({ light, life: 0, max: 1, peak: 0 });
    }

    // Shockwave rings (own material each so they can fade independently).
    const ringTex = ringSprite(scene);
    for (let i = 0; i < 8; i++) {
      const mesh = MeshBuilder.CreatePlane('shock', { size: 1 }, scene);
      const mat = unlit(scene, 'shockMat', [0, 0, 0], { tex: ringTex, opacity: ringTex, additive: true, twoSided: true });
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.rings.push({ mesh, mat, life: 0, max: 1, size: 1, color: new Color3(3, 1.4, 0.5) });
    }

    // Scorch marks on the deck: fade out slowly.
    const scorchTex = scorchSprite(scene);
    for (let i = 0; i < 16; i++) {
      const mesh = MeshBuilder.CreateGround('scorch', { width: 1, height: 1 }, scene);
      const mat = new StandardMaterial('scorchMat', scene);
      mat.disableLighting = true;
      mat.emissiveColor = new Color3(0.0, 0.0, 0.0);
      mat.diffuseColor = Color3.Black();
      mat.opacityTexture = scorchTex;
      mat.zOffset = -4;
      mat.disableDepthWrite = true;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.scorches.push({ mesh, mat, life: 0 });
    }

    // Plasma burn marks where shots hit level geometry: instanced, recycled oldest-first.
    const holeMat = new StandardMaterial('holeMat', scene);
    holeMat.disableLighting = true;
    holeMat.emissiveColor = new Color3(0.15, 0.4, 0.5);
    holeMat.diffuseColor = Color3.Black();
    holeMat.opacityTexture = scorchTex;
    holeMat.zOffset = -3;
    holeMat.disableDepthWrite = true;
    holeMat.backFaceCulling = false;
    const holeSrc = MeshBuilder.CreatePlane('holeSrc', { size: 1 }, scene);
    holeSrc.material = holeMat;
    holeSrc.isPickable = false;
    holeSrc.isVisible = false;
    for (let i = 0; i < 64; i++) {
      const h = holeSrc.createInstance('hole');
      h.isPickable = false;
      h.setEnabled(false);
      this.holes.push(h);
    }

    // Smoke trails behind hot debris and enemy plasma bolts: one system each, spawning
    // at a random live source every particle (startPositionFunction).
    this.trail = this.makeTrail(tex.smoke, 'debrisTrail', 260, (out) => {
      const n = this.liveDebris.length;
      if (!n) return;
      out.copyFrom(this.liveDebris[(Math.random() * n) | 0].mesh.position);
    }, true);
    for (const [t, c] of [[0, c4(1.6, 0.6, 0.15, 0.5)], [0.15, c4(0.2, 0.16, 0.14, 0.45)], [1, c4(0.12, 0.12, 0.13, 0)]] as [number, Color4][]) this.trail.addColorGradient(t, c);
    this.trail.addSizeGradient(0, 0.25);
    this.trail.addSizeGradient(1, 1.1);
    this.trail.minLifeTime = 0.5;
    this.trail.maxLifeTime = 1.1;
    this.trail.blendMode = STD;

    this.plasmaTrail = this.makeTrail(tex.flare, 'plasmaTrail', 300, (out) => {
      const n = this.liveProjectiles.length;
      if (!n) return;
      out.copyFrom(this.liveProjectiles[(Math.random() * n) | 0].pos);
    });
    for (const [t, c] of [[0, c4(3, 0.9, 0.15, 1)], [1, c4(0.6, 0.05, 0, 0)]] as [number, Color4][]) this.plasmaTrail.addColorGradient(t, c);
    this.plasmaTrail.minSize = 0.12;
    this.plasmaTrail.maxSize = 0.26;
    this.plasmaTrail.minLifeTime = 0.12;
    this.plasmaTrail.maxLifeTime = 0.25;
    this.plasmaTrail.blendMode = ADD;
  }

  private makeTrail(tex: DynamicTexture, name: string, cap: number, pick: (out: Vector3) => void, smoke = false): ParticleSystem {
    const ps = new ParticleSystem(name, cap, this.scene, undefined, smoke);
    if (smoke) {
      configureSmoke(ps);
      softenParticles(this.scene, ps, 0.35);
    }
    ps.particleTexture = tex;
    ps.emitter = Vector3.Zero();
    ps.startPositionFunction = (_wm, out) => pick(out);
    ps.direction1 = new Vector3(-0.2, 0.3, -0.2);
    ps.direction2 = new Vector3(0.2, 0.8, 0.2);
    ps.minEmitPower = 0.2;
    ps.maxEmitPower = 0.6;
    ps.minAngularSpeed = -1;
    ps.maxAngularSpeed = 1;
    ps.maxInitialRotation = Math.PI * 2;
    ps.emitRate = 0;
    ps.updateSpeed = 1 / 60;
    ps.start();
    return ps;
  }

  get particleCount(): number {
    let n = 0;
    for (const p of this.bursts.values()) n += p.active;
    return n + this.trail.getActiveCount() + this.plasmaTrail.getActiveCount() + this.hotSparks.ps.getActiveCount();
  }

  burst(kind: BurstKind, pos: Vector3, count: number, normal?: Vector3, scale = 1): void {
    if (this.density < 1) count = Math.max(1, Math.round(count * this.density));
    const over = this.particleCount > this.particleBudget;
    this.bursts.get(kind)!.emit(pos, over ? Math.ceil(count * 0.3) : count, normal, scale);
  }

  /**
   * Layered explosion: white-hot flash, expanding fireball, stretched sparks, drifting
   * embers, a rising smoke column, shockwave rings, flying debris with smoke trails,
   * a dynamic light, a scorch mark and a camera-shake request.
   */
  explode(pos: Vector3, o: ExplosionOpts = {}): void {
    const s = o.scale ?? 1;
    const over = this.particleCount > this.particleBudget;
    const k = over ? 0.4 : this.high ? 1 : 0.65;
    // One star for ordinary wrecks (a pair from big blasts): a pack fight must stay readable through the bloom.
    this.burst('flash', pos, s >= 1.5 ? 2 : 1, undefined, s * 0.75);
    this.burst('fire', pos, Math.round(13 * s * k), undefined, s);
    this.burst('sparks', pos, Math.round(10 * s * k), undefined, Math.sqrt(s));
    // Molten sparks that rain down, bounce and skid across the arena.
    this.hotSparks.emit(pos, Vector3.UpReadOnly, Math.round(55 * s * k), 13 * Math.sqrt(s), 1.1);
    this.burst('embers', pos, Math.round(16 * s * k), undefined, Math.sqrt(s));
    this.burst('smoke', TMP.copyFrom(pos).addInPlaceFromFloats(0, 0.35 * s, 0), Math.round(12 * s * k), undefined, s);
    if (pos.y < 3.5) this.ring(pos, 8 * s, 0.5, o.color ?? new Color3(3, 1.3, 0.4), true);
    this.ring(pos, 3.6 * s, 0.16, new Color3(1.6, 1.1, 0.7), false);
    if (o.debris) this.debrisBurst(pos, Math.ceil(o.debris * k), 7 * Math.sqrt(s), Math.sqrt(s));
    this.flashLight(pos, 4 + 2 * s, 0.35 + 0.15 * s, o.color);
    if (o.scorch !== false && pos.y < 4) this.scorch(pos, 2.6 * s);
    this.onShake?.(pos, Math.min(1, 0.35 * s + 0.15));
  }

  /** Contacts keep a distinct silhouette even when the particle budget is tight. */
  impact(pos: Vector3, normal: Vector3, surface: SurfaceImpact = 'alloy', light = false): void {
    const contact = TMP.copyFrom(normal).scaleInPlace(0.065).addInPlace(pos);
    const sparks = surface === 'alloy' ? (this.high ? 9 : 6) : 3;
    this.burst('impact', contact, light ? 2 : sparks, normal);
    this.burst(surface === 'wetDeck' ? 'mist' : 'puff', contact, light ? 1 : surface === 'alloy' ? 1 : 4, normal);
    if (light) return;
    if (this.high && surface === 'alloy') this.burst('flash', contact, 1, normal, 0.13);
    if (surface === 'alloy') this.hotSparks.emit(pos, normal, 7, 6.8, 0.5);
    const hi = this.holeNext;
    const h = this.holes[hi];
    this.holeNext = (this.holeNext + 1) % this.holes.length;
    h.setEnabled(true);
    h.position.copyFrom(pos).addInPlace(TMP2.copyFrom(normal).scaleInPlace(0.015));
    h.lookAt(TMP.copyFrom(h.position).addInPlace(normal));
    h.rotation.z = Math.random() * Math.PI * 2;
    const size = 0.16 + Math.random() * 0.1;
    h.scaling.setAll(size);
    this.holeLife[hi] = HOLE_LIFE;
    this.holeSize[hi] = size;
  }

  shieldRipple(pos: Vector3, normal: Vector3): void {
    this.ring(pos, 1.3, 0.33, SHIELD_RIPPLE, false, normal);
  }

  ring(pos: Vector3, size: number, life: number, color: Color3, ground: boolean, normal?: Vector3): void {
    const r = this.rings[this.ringNext];
    this.ringNext = (this.ringNext + 1) % this.rings.length;
    r.mesh.setEnabled(true);
    r.mesh.position.copyFrom(pos);
    if (ground) {
      r.mesh.position.y = 0.06;
      r.mesh.billboardMode = Mesh.BILLBOARDMODE_NONE;
      r.mesh.rotation.set(Math.PI / 2, 0, 0);
    } else if (normal) {
      r.mesh.billboardMode = Mesh.BILLBOARDMODE_NONE;
      r.mesh.lookAt(TMP.copyFrom(r.mesh.position).addInPlace(normal));
    } else {
      r.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      r.mesh.rotation.set(0, 0, 0);
    }
    r.life = r.max = life;
    r.size = size;
    r.color.copyFrom(color);
    r.mesh.scaling.setAll(0.01);
  }

  private scorch(pos: Vector3, size: number): void {
    const d = this.scorches[this.scorchNext];
    this.scorchNext = (this.scorchNext + 1) % this.scorches.length;
    d.mesh.setEnabled(true);
    d.mesh.position.set(pos.x, 0.03 + this.scorchNext * 0.001, pos.z);
    d.mesh.rotation.y = Math.random() * Math.PI * 2;
    d.mesh.scaling.set(size, 1, size);
    d.life = 26;
    d.mat.alpha = 1;
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
    // Reuse the dimmest light so overlapping explosions keep the brightest one.
    let f = this.flashes[0];
    for (const x of this.flashes) if (x.light.intensity < f.light.intensity) f = x;
    f.light.position.copyFrom(pos);
    if (color) f.light.diffuse.copyFrom(color);
    else f.light.diffuse.set(1, 0.55, 0.22);
    f.peak = intensity;
    f.life = duration;
    f.max = duration;
    f.light.intensity = intensity;
  }

  debrisBurst(pos: Vector3, count: number, power: number, sizeScale = 1): void {
    for (let i = 0; i < count; i++) {
      const d = this.debris[this.debrisNext];
      this.debrisNext = (this.debrisNext + 1) % this.debris.length;
      d.mesh.setEnabled(true);
      d.mesh.position.copyFrom(pos).addInPlaceFromFloats((Math.random() - 0.5) * 0.6, (Math.random() - 0.2) * 0.6, (Math.random() - 0.5) * 0.6);
      d.vel.set((Math.random() - 0.5) * power, Math.random() * power * 0.9 + 2, (Math.random() - 0.5) * power);
      d.spin.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
      d.size = (0.06 + Math.random() * 0.16) * sizeScale;
      d.mesh.scaling.set(d.size, d.size * (0.3 + Math.random() * 0.5), d.size * (0.6 + Math.random() * 0.8));
      d.life = 1.6 + Math.random() * 0.9;
      d.hot = Math.random() < 0.7 ? 1 : 0;
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

  /** dt = real time. Projectiles are hostile and integrated by the game with hostile time. */
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
    this.liveDebris.length = 0;
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.mesh.setEnabled(false);
        continue;
      }
      d.vel.y -= 22 * dt;
      d.mesh.position.addInPlace(d.vel.scaleToRef(dt, TMP));
      if (this.world.collide(d.mesh.position, d.vel, d.size * 0.5, 0.35, 0.6)) {
        d.spin.scaleInPlace(0.6);
        d.hot *= 0.7;
      }
      d.mesh.rotation.addInPlace(d.spin.scaleToRef(dt, TMP));
      if (d.life < 0.4) d.mesh.scaling.scaleInPlace(Math.max(0.01, 1 - dt / Math.max(0.01, d.life)));
      if (d.hot > 0.3) this.liveDebris.push(d);
    }
    this.trail.emitRate = this.liveDebris.length * 14;

    this.liveProjectiles.length = 0;
    for (const p of this.projectiles) if (p.active) this.liveProjectiles.push(p);
    this.plasmaTrail.emitRate = this.liveProjectiles.length * 40;

    for (const f of this.flashes) {
      if (f.life > 0) {
        f.life -= dt;
        const k = Math.max(0, f.life / f.max);
        f.light.intensity = k * k * f.peak;
      } else f.light.intensity = 0;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.mesh.setEnabled(false);
        continue;
      }
      const t = 1 - r.life / r.max;
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      r.mesh.scaling.setAll(Math.max(0.01, r.size * e));
      const a = (1 - t) * (1 - t);
      r.mat.emissiveColor.set(r.color.r * a, r.color.g * a, r.color.b * a);
    }
    for (let i = 0; i < this.holes.length; i++) {
      if (this.holeLife[i] <= 0) continue;
      this.holeLife[i] -= dt;
      const h = this.holes[i];
      if (this.holeLife[i] <= 0) h.setEnabled(false);
      else if (this.holeLife[i] < HOLE_FADE) h.scaling.setAll(this.holeSize[i] * (this.holeLife[i] / HOLE_FADE));
    }
    for (const d of this.scorches) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.mat.alpha = Math.min(1, d.life / 6) * 0.92;
      if (d.life <= 0) d.mesh.setEnabled(false);
    }
  }

  reset(): void {
    for (const t of this.tracers)
      for (const tr of t.pool) {
        tr.life = 0;
        tr.mesh.setEnabled(false);
      }
    for (const d of this.debris) {
      d.life = 0;
      d.mesh.setEnabled(false);
    }
    for (const p of this.projectiles) this.killProjectile(p);
    for (const b of this.bursts.values()) b.reset();
    for (const r of this.rings) {
      r.life = 0;
      r.mesh.setEnabled(false);
    }
    for (const d of this.scorches) {
      d.life = 0;
      d.mesh.setEnabled(false);
    }
    for (const h of this.holes) h.setEnabled(false);
    this.holeLife.fill(0);
    for (const f of this.flashes) {
      f.life = 0;
      f.light.intensity = 0;
    }
    this.trail.reset();
    this.plasmaTrail.reset();
    this.hotSparks.reset();
  }
}
