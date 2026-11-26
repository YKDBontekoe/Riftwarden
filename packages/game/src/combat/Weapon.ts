import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { type Material } from '@babylonjs/core/Materials/material';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { type Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { type Scene } from '@babylonjs/core/scene';
import { sfx } from '../audio/Sfx';
import type { WeaponDef, WeaponFamily } from '@riftwarden/rules/data/defs';
import { chargeFactor } from '@riftwarden/rules/loot/equipment';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { rarity } from '@riftwarden/rules/loot/rarity';
import type { Player } from '../player/Player';
import { WeaponAnimator } from '../weapons/animator';
import { defaultBuild, type WeaponBuild, type Finish } from '@riftwarden/rules/weapons/build';
import { buildWeaponModel, type WeaponRig } from '../weapons/model';
import { unlit } from '../visuals/materials';
import { starSprite } from '../visuals/textures';
import { MuzzleHeat } from '../fx/MuzzleHeat';
import { DAMAGE_PACE, HEAT_PACE, type HeatState } from '@riftwarden/rules/combat/heat';
import { shotFeel, yawPattern } from './weaponFeel';
import type { CombatStats } from '@riftwarden/rules/combat/stats';

export interface ShotRequest {
  origin: Vector3;
  dir: Vector3;
  range: number;
  damage: number;
  family: WeaponFamily;
  /** Extra enemies a shot passes through (rail). */
  pierce: number;
  /** Aim-assist radius around the ray (beam). */
  width: number;
  /** Swarm: lock cone (tangent of the half-angle); the drone locks onto a machine in it instead of following the ray. */
  seek?: number;
  /** Swarm: which lock candidate (nearest the crosshair first) this drone takes, so a launch spreads over targets. */
  seekIndex?: number;
  /** Flamer: spray cone (tangent of the half-angle); every machine in it (up to `targets`, in sight) is struck. */
  cone?: number;
  targets?: number;
}

export type ShotTarget = 'enemy' | 'shield' | 'surface' | 'none';
export type SurfaceImpact = 'alloy' | 'ceramic' | 'wetDeck';

export interface ShotOutcome {
  point: Vector3;
  normal: Vector3 | null;
  target: ShotTarget;
  surface?: SurfaceImpact;
  /** Stable id of the first enemy hit (beam ramp tracking), null if none. */
  enemyId: number | null;
}

/** Presentation callbacks (world-space effects live in the game's WeaponFx). */
export interface WeaponFxHooks {
  shot(family: WeaponFamily, from: Vector3, out: ShotOutcome, power: number, speed: number): void;
  beam(on: boolean, from: Vector3, to: Vector3, intensity: number, contact: boolean): void;
}

/** Fill optional outcome fields (callers may return only a point). */
function normalize(o: Partial<ShotOutcome> & { point: Vector3 }): ShotOutcome {
  return { point: o.point, normal: o.normal ?? null, target: o.target ?? 'none', surface: o.surface, enemyId: o.enemyId ?? null };
}

/** Presentation no-op (automation / headless callers). */
const NO_FX: WeaponFxHooks = { shot: () => {}, beam: () => {} };

/** Salvo Lock: drones released for a lock fraction (0.6x at a tap, 3x the launch count at full lock). */
export function salvoDrones(perLaunch: number, lock: number): number {
  const l = Math.max(0, Math.min(1, Number.isFinite(lock) ? lock : 0));
  return Math.max(1, Math.round(perLaunch * (0.6 + 2.4 * l)));
}

/** Vertical FOV the viewmodel layout is tuned for (90° horizontal at 16:9). */
/** M7: pellets per Scatter Choke shot (+2 per extra projectile from Splitter modules). */
export const SCATTER_PELLETS = 7;

const FORWARD = Vector3.Forward();
const REF_FOV = 2 * Math.atan(Math.tan(Math.PI / 4) / (16 / 9));
/** Viewmodel anchor relative to the camera (metres). */
const ANCHOR = { x: 0.19, y: -0.172, z: 0.46, scale: 0.72, yaw: -0.085, pitch: 0.015, roll: -0.04 };

/**
 * The equipped weapon: firing mechanics per mechanism, heat, spread and the procedural
 * first-person model. Hit resolution is delegated to the game (`shoot`), visuals of the
 * world-space shot to `fx`, so every family shares the damage pipeline.
 *
 * Mechanisms: auto (hold), burst (3-round sequences at the same average rate), charge
 * (hold to charge, release to fire; damage 30..100%), cycle (automatic full slugs) and
 * beam (continuous ticks with damage ramp on a held target).
 */
export class Weapon {
  heat = 0;
  overheated = false;
  spread: number;
  /** Rail charge 0..1. */
  charge = 0;
  /** Beam currently emitting. */
  beaming = false;
  /** Beam ramp multiplier currently applied. */
  ramp = 1;
  shotsFired = 0;
  private cooldown = 0;
  private sinceShot = 99;
  private burstLeft = 0;
  private burstT = 0;
  private triggerWas = false;
  private fireBuffer = 0;
  private beamTick = 0;
  private rampT = 0;
  private rampTarget: number | null = null;
  private beamDist = 0;
  private beamContact = false;
  private beamFx: WeaponFxHooks | null = null;
  private chargeSfx = false;
  private holster = 0;
  private switchT = 0;
  private visible = true;

  private readonly vmProjection: TransformNode;
  private readonly vm: TransformNode;
  rig!: WeaponRig;
  anim!: WeaponAnimator;
  private buildKey = '';
  /** Mastery cosmetic finish per family (undefined = the item's own finish). */
  finishFor: (family: WeaponFamily) => Finish | undefined = () => undefined;
  /** Built viewmodels by look key, most recently used last (at most two). */
  private models = new Map<string, { rig: WeaponRig; anim: WeaponAnimator }>();
  private flashMeshes: Mesh[] = [];
  private flashRoot: TransformNode;
  private flashMat: Material & { emissiveColor: Color3 };
  private flashT = 0;
  private flashScale = 1;
  private light: PointLight;
  private readonly heatFx: MuzzleHeat;
  private readonly modelKey: DirectionalLight;
  private readonly tmpDir = new Vector3();
  private readonly tmpPos = new Vector3();
  private readonly tmpTo = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();

  lastShot: { from: Vector3; to: Vector3 } | null = null;

  constructor(private scene: Scene, public def: WeaponDef, private player: Player, item?: ItemInstance | null) {
    this.spread = def.spreadMin;
    this.vmProjection = new TransformNode('viewmodelProjection', scene);
    this.vmProjection.parent = player.camera;
    this.vm = new TransformNode('viewmodel', scene);
    this.vm.parent = this.vmProjection;
    this.vm.scaling.setAll(ANCHOR.scale);
    this.flashRoot = new TransformNode('flashRoot', scene);
    const star = starSprite(scene);
    this.flashMat = unlit(scene, 'vmFlashMat', [2.4, 3.6, 4.4], { tex: star, opacity: star, additive: true, twoSided: true });
    for (let i = 0; i < 3; i++) {
      const f = i < 2 ? MeshBuilder.CreatePlane('vmFlash', i ? { width: 0.42, height: 0.16 } : { width: 0.16, height: 0.42 }, scene) : MeshBuilder.CreatePlane('vmFlashC', { size: 0.3 }, scene);
      f.material = this.flashMat;
      f.parent = this.flashRoot;
      if (i === 1) f.rotation.set(0, Math.PI / 2, 0);
      if (i === 0) f.rotation.set(Math.PI / 2, 0, 0);
      f.position.z = i < 2 ? 0.12 : 0.02;
      f.renderingGroupId = 1;
      f.isPickable = false;
      f.setEnabled(false);
      this.flashMeshes.push(f);
    }
    this.heatFx = new MuzzleHeat(scene);
    this.light = new PointLight('muzzleLight', Vector3.Zero(), scene);
    this.light.range = 14;
    this.light.intensity = 0;
    this.modelKey = new DirectionalLight('viewmodelKey', new Vector3(0.55, -1, 0.28), scene);
    this.modelKey.parent = player.camera;
    this.modelKey.diffuse.set(0.9, 0.94, 1);
    this.modelKey.specular.set(0.8, 0.86, 1);
    this.modelKey.intensity = 0.86;
    this.modelKey.renderPriority = 2;
    this.setItem(item ?? null, def, true);
    // A scene may render before its first simulation tick (loading-screen handoff).
    this.syncViewmodelPose();
  }

  private syncViewmodelPose(): void {
    const p = this.anim.pose;
    // Compensate on the camera's X/Y axes so FOV kicks cannot stretch the model in depth.
    const s = Math.tan(this.player.camera.fov / 2) / Math.tan(REF_FOV / 2);
    this.vmProjection.scaling.set(s, s, 1);
    this.vm.position.set(ANCHOR.x + p.x, ANCHOR.y + p.y, ANCHOR.z + p.z);
    this.vm.rotation.set(ANCHOR.pitch + p.pitch, ANCHOR.yaw + p.yaw, ANCHOR.roll + p.roll);
  }

  /** Build/rebuild the model for an item (no-op if its look did not change). */
  setItem(item: ItemInstance | null, def: WeaponDef, initial = false, quick = false): void {
    this.def = def;
    this.spread = Math.max(def.spreadMin, Math.min(def.spreadMax, this.spread));
    const own: WeaponBuild = item?.build ?? defaultBuild(def.id, def.family);
    const finish = this.finishFor(own.family);
    const build: WeaponBuild = finish && finish !== own.finish ? { ...own, finish } : own;
    const installed = item?.socketed ?? [];
    const key = JSON.stringify([build, installed.map((m) => m?.uid ?? null), item?.rarity, def.element, item?.uniqueId]);
    if (key === this.buildKey) return;
    this.buildKey = key;
    // Up to two models stay built (primary + secondary), so swapping weapons never rebuilds geometry.
    this.rig?.root.setEnabled(false);
    let cached = this.models.get(key);
    if (cached) this.models.delete(key);
    else {
      const ri = rarity(item?.rarity ?? 'common').index;
      const rig = buildWeaponModel(this.scene, build, installed, { renderingGroupId: 1, name: 'vm', element: def.element, uniqueId: item?.uniqueId }, Math.max(0, ri));
      rig.root.parent = this.vm;
      cached = { rig, anim: new WeaponAnimator(rig) };
    }
    this.models.set(key, cached);
    for (const [k, m] of this.models) {
      if (this.models.size <= 2) break;
      if (k !== key) {
        m.rig.dispose();
        this.models.delete(k);
      }
    }
    this.rig = cached.rig;
    this.anim = cached.anim;
    this.modelKey.includedOnlyMeshes = this.rig.meshes;
    const e = this.rig.energyBase;
    this.flashMat.emissiveColor.set(1.4 + e.r * 0.9, 1.4 + e.g * 0.9, 1.4 + e.b * 0.9);
    this.light.diffuse.copyFrom(e).scaleInPlace(0.4);
    this.light.specular.copyFrom(e).scaleInPlace(0.2);
    this.cancelFire();
    this.flashRoot.parent = this.rig.muzzles[0] ?? this.rig.root;
    if (!initial) {
      // A quick swap (between the two carried weapons) is ready to fire after ~70 ms instead of ~200 ms.
      this.switchT = quick ? 0.6 : 1;
      sfx.play('weaponSwitch', quick ? { pitch: 1.25 } : undefined);
    }
    this.rig.root.setEnabled(this.visible);
  }

  /** Heat state of the weapon in hand (parked while it is holstered by a swap). */
  heatState(): HeatState {
    return { heat: this.heat, overheated: this.overheated };
  }

  restoreHeat(s: HeatState): void {
    this.heat = s.heat;
    this.overheated = s.overheated;
    this.cancelFire();
  }

  /** Swap the weapon parameters only (same model). */
  setDef(def: WeaponDef): void {
    this.def = def;
    this.spread = Math.max(def.spreadMin, Math.min(def.spreadMax, this.spread));
  }

  get family(): WeaponFamily {
    return this.def.family;
  }

  muzzleWorld(out = new Vector3(), index = this.anim?.muzzleIndex ?? 0): Vector3 {
    const m = this.rig.muzzles[index] ?? this.rig.muzzles[0] ?? this.rig.root;
    m.computeWorldMatrix(true);
    return out.copyFrom(m.getAbsolutePosition());
  }

  reset(): void {
    this.switchT = 0;
    this.heat = 0;
    this.overheated = false;
    this.cooldown = 0;
    this.cancelFire();
    this.spread = this.def.spreadMin;
  }

  /** Interrupt an attack when leaving play, holstering or changing weapons. */
  cancelFire(): void {
    this.charge = 0;
    this.chargeSfx = false;
    this.triggerWas = false;
    this.fireBuffer = 0;
    this.burstLeft = 0;
    this.beaming = false;
    this.beamTick = 0;
    this.beamDist = 0;
    this.beamContact = false;
    this.ramp = 1;
    this.rampT = 0;
    this.rampTarget = null;
    if (this.beamFx) {
      const zero = Vector3.ZeroReadOnly;
      this.beamFx.beam(false, zero, zero, 0, false);
      this.beamFx = null;
      this.flashMeshes[2].setEnabled(false);
      this.light.intensity = 0;
      sfx.beamLoop(false);
    }
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.vm.setEnabled(v);
  }

  setHolstered(h: boolean): void {
    if (h && this.holster === 0) this.cancelFire();
    this.holster = h ? 1 : 0;
  }

  private feelDef: WeaponDef | null = null;
  private feelCache = shotFeel('plasma', 'auto');
  private feelFor(d: WeaponDef) {
    if (this.feelDef !== d) {
      this.feelDef = d;
      this.feelCache = shotFeel(d.family, d.mechanism);
    }
    return this.feelCache;
  }

  /** Effective range after stats. */
  range(stats: CombatStats): number {
    return this.def.range * stats.rangeMult;
  }

  private aimDir(stats: CombatStats, extraSpread = 0): Vector3 {
    const cam = this.player.camera;
    cam.getDirectionToRef(Vector3.Forward(), this.tmpDir);
    const s = this.spread * stats.spreadMult + extraSpread;
    if (s > 0) {
      const r = s * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      cam.getDirectionToRef(Vector3.Right(), this.right);
      cam.getDirectionToRef(Vector3.Up(), this.up);
      this.tmpDir.addInPlace(this.right.scaleInPlace(Math.cos(a) * r)).addInPlace(this.up.scaleInPlace(Math.sin(a) * r)).normalize();
    }
    return this.tmpDir.clone();
  }

  /** Fire one shot (all projectiles). power: rail charge factor / burst etc. */
  private fireShot(stats: CombatStats, shoot: (r: ShotRequest) => ShotOutcome, fx: WeaponFxHooks, power: number, heatScale: number): void {
    const d = this.def;
    const scatter = d.mechanism === 'scatter';
    const swarm = d.family === 'swarm';
    // Swarm: drones per launch x projectiles; a salvo releases more drones the longer it was locked (power = lock).
    const drones = Math.max(1, d.drones) * Math.max(1, Math.floor(stats.projectiles));
    const proj = d.family === 'beam' ? 1 : scatter ? SCATTER_PELLETS + 2 * Math.max(0, Math.floor(stats.projectiles) - 1) : swarm ? (d.mechanism === 'salvo' ? salvoDrones(drones, power) : drones) : Math.max(1, Math.floor(stats.projectiles));
    if (swarm) power = 1;
    const thermal = 1 + stats.heatDamage * (this.heat / 100);
    const dmg = d.damage * DAMAGE_PACE * stats.weaponDamageMult * power * thermal;
    const muzzleIndex = this.anim.muzzleIndex;
    const from = this.muzzleWorld(this.tmpPos, muzzleIndex).clone();
    const origin = this.player.camera.position.clone();
    for (let i = 0; i < proj; i++) {
      // Split projectiles fan out around the aim point.
      const extra = swarm ? 0 : scatter ? 0.07 : proj > 1 ? 0.012 + 0.006 * proj : 0;
      const dir = this.aimDir(stats, i === 0 && proj > 1 ? extra * 0.3 : extra);
      const out = normalize(shoot({ origin, dir, range: this.range(stats), damage: dmg, family: d.family, pierce: swarm ? 0 : d.pierce + Math.floor(stats.pierce), width: 0, seek: swarm ? d.seekCone : undefined, seekIndex: swarm ? i : undefined }));
      fx.shot(d.family, from, out, d.mechanism === 'pulse' ? -1 : power, d.boltSpeed);
      if (i === 0) this.lastShot = { from, to: out.point };
    }
    this.shotsFired++;
    this.sinceShot = 0;
    this.heat += (d.heatPerShot * heatScale * HEAT_PACE.gain) / stats.heatEfficiency;
    if (this.heat >= 100) {
      this.heat = 100;
      this.overheated = true;
      sfx.play('overheat');
    }
    this.spread = Math.min(d.spreadMax, this.spread + d.spreadPerShot);
    // Camera: pitch kick from the def, a patterned sideways kick, a lens punch and (heavy weapons) shake.
    const feel = shotFeel(d.family, d.mechanism, power);
    const kick = d.recoilPitch * power * stats.spreadMult * (0.85 + Math.random() * 0.3);
    this.player.recoil += kick;
    this.player.recoilYaw += kick * feel.yawKick * yawPattern(this.shotsFired);
    this.player.punch(feel.punchFov, feel.punchRoll * (Math.random() < 0.5 ? -1 : 1));
    if (feel.trauma > 0) this.player.addTrauma(feel.trauma);
    this.anim.fire(power * (d.family === 'rail' ? 1 : 0.9 + 0.1 * proj));
    // Muzzle flash on the firing barrel.
    this.flashRoot.parent = this.rig.muzzles[muzzleIndex] ?? this.rig.muzzles[0] ?? this.rig.root;
    this.flashT = feel.flashTime;
    this.flashScale = feel.flashScale[0] + Math.random() * (feel.flashScale[1] - feel.flashScale[0]);
    for (const f of this.flashMeshes) f.setEnabled(true);
    this.flashMeshes[2].rotation.z = Math.random() * Math.PI;
    this.light.position.copyFrom(from);
    this.light.intensity = feel.light;
    if (d.family === 'launcher') sfx.play('rocketLaunch', { pitch: (d.mechanism === 'cluster' ? 0.88 : 1) * (0.95 + Math.random() * 0.1), volume: 0.85 });
    else if (swarm) sfx.play('swarmLaunch', { pitch: (d.mechanism === 'salvo' ? 0.85 : 1) * (0.95 + Math.random() * 0.1), volume: Math.min(1.2, 0.55 + 0.08 * proj) });
    else if (d.mechanism === 'pulse') sfx.play('railFire', { pitch: 1.5, volume: 0.7 });
    else if (scatter) {
      sfx.play('shoot', { pitch: 0.62, volume: 1 });
      sfx.play('explosion', { pitch: 2.4, volume: 0.25 });
    } else if (d.family === 'rail') sfx.play('railFire', { pitch: 0.9 + 0.2 * (1 - power), volume: 0.6 + 0.4 * power });
    else sfx.play('shoot', { pitch: (d.mechanism === 'burst' ? 1.12 : 1) * (1 + this.heat / 400) * (proj > 1 ? 0.9 : 1) });
  }

  /** Returns true if a shot (or beam tick) was fired this frame. */
  update(dt: number, trigger: boolean, stats: CombatStats, shoot: (r: ShotRequest) => ShotOutcome, fx: WeaponFxHooks = NO_FX, pressed = false): boolean {
    const d = this.def;
    this.cooldown -= dt;
    this.sinceShot += dt;
    this.lastShot = null;
    const armed = this.holster === 0 && this.player.alive && !this.overheated;
    const ready = armed && this.switchT < 0.4;
    // A short press survives an animation frame or the end of a cycle. It never carries through a lockout.
    this.fireBuffer = !armed ? 0 : pressed ? 0.12 : Math.max(0, this.fireBuffer - dt);
    const requested = trigger || this.fireBuffer > 0;
    const rate = d.fireRate * stats.fireRateMult;
    let fired = false;
    let active = 0;

    switch (d.mechanism) {
      case 'auto':
      case 'cycle':
      case 'scatter':
      case 'pulse':
      case 'swarm':
      case 'rocket':
      case 'cluster':
        if (requested && ready && this.cooldown <= 0) {
          this.fireBuffer = 0;
          this.cooldown = Math.max(0, this.cooldown) + 1 / rate;
          this.fireShot(stats, shoot, fx, 1, 1);
          fired = true;
        }
        if (d.mechanism === 'cycle') this.charge = Math.max(0, Math.min(1, 1 - this.cooldown * rate));
        break;
      case 'burst': {
        const n = Math.max(2, d.burstCount);
        const inner = 1 / (rate * 2);
        if (this.burstLeft === 0 && requested && ready && this.cooldown <= 0) {
          this.fireBuffer = 0;
          this.burstLeft = n;
          this.burstT = 0;
        }
        if (this.burstLeft > 0) {
          this.burstT -= dt;
          if (this.burstT <= 0 && ready) {
            this.fireShot(stats, shoot, fx, 1, 1);
            fired = true;
            this.burstLeft--;
            this.burstT += inner;
            // Average rate stays `rate`: the reset after a burst absorbs the fast inner cadence.
            if (this.burstLeft === 0) this.cooldown = n / rate - (n - 1) * inner;
          }
          if (!ready) this.burstLeft = 0;
        }
        break;
      }
      case 'salvo':
      case 'charge': {
        const salvo = d.mechanism === 'salvo';
        if (trigger && ready && this.cooldown <= 0) {
          if (!this.chargeSfx) {
            this.chargeSfx = true;
            sfx.play('railCharge', { pitch: Math.min(2, stats.chargeRateMult / Math.max(0.2, d.chargeTime / 0.8)) });
          }
          const before = this.charge;
          this.charge = Math.min(1, this.charge + (dt * stats.chargeRateMult) / Math.max(0.05, d.chargeTime));
          if (before < 1 && this.charge >= 1) sfx.play('chargeReady');
        } else if (!trigger && this.triggerWas && this.charge >= 0.12 && ready) {
          // Salvo: power carries the lock fraction (drone count); heat follows the drones released.
          const power = salvo ? this.charge : chargeFactor(this.charge);
          this.fireShot(stats, shoot, fx, power, salvo ? (0.6 + 2.4 * this.charge) * 1.2 : 0.4 + 0.6 * this.charge);
          fired = true;
          this.cooldown = 1 / rate;
          this.charge = 0;
          this.chargeSfx = false;
        } else if (!trigger || !ready) {
          this.charge = Math.max(0, this.charge - dt * 3);
          if (this.charge === 0) this.chargeSfx = false;
        }
        break;
      }
      case 'spray':
      case 'jet': {
        // Flamer: continuous ticks; each reaches every machine in the cone (up to `targets`).
        const on = (trigger || pressed) && ready;
        if (on) {
          active = 1;
          this.beamTick -= dt;
          const tick = 1 / rate;
          let guard = 0;
          while (this.beamTick <= 0 && guard++ < 8) {
            this.beamTick += tick;
            const thermal = 1 + stats.heatDamage * (this.heat / 100);
            const origin = this.player.camera.position.clone();
            const out = normalize(shoot({ origin, dir: this.aimDir(stats), range: this.range(stats), damage: d.damage * DAMAGE_PACE * stats.weaponDamageMult * thermal, family: d.family, pierce: 0, width: 0, cone: d.spray, targets: Math.max(1, d.targets) }));
            fx.shot(d.family, this.muzzleWorld(this.tmpPos).clone(), out, 1, 0);
            if (this.shotsFired % 2 === 0) sfx.play('flame', { pitch: d.mechanism === 'jet' ? 1.35 : 1 });
            this.heat += (d.heatPerShot * HEAT_PACE.gain) / stats.heatEfficiency;
            this.shotsFired++;
            this.sinceShot = 0;
            fired = true;
            if (this.heat >= 100) {
              this.heat = 100;
              this.overheated = true;
              sfx.play('overheat');
              break;
            }
          }
          this.player.recoil += d.recoilPitch * dt * 20 * stats.spreadMult;
        } else this.beamTick = 0;
        this.beaming = on && !this.overheated;
        break;
      }
      case 'beam': {
        const on = (trigger || pressed) && ready;
        if (on) {
          active = 1;
          this.beamTick -= dt;
          const tick = 1 / rate;
          let guard = 0;
          while (this.beamTick <= 0 && guard++ < 8) {
            this.beamTick += tick;
            const thermal = 1 + stats.heatDamage * (this.heat / 100);
            const rampTime = d.rampTime / stats.chargeRateMult;
            this.ramp = 1 + (d.rampMax - 1) * Math.min(1, this.rampT / Math.max(0.05, rampTime));
            const dir = this.aimDir(stats);
            const out = normalize(shoot({ origin: this.player.camera.position.clone(), dir, range: this.range(stats), damage: d.damage * DAMAGE_PACE * stats.weaponDamageMult * thermal * this.ramp, family: 'beam', pierce: 0, width: d.beamWidth }));
            if (out.enemyId !== null && out.enemyId === this.rampTarget) this.rampT += tick;
            else this.rampT = 0;
            this.rampTarget = out.enemyId;
            this.beamDist = Vector3.Distance(this.player.camera.position, out.point);
            this.beamContact = out.target !== 'none';
            fx.shot('beam', this.muzzleWorld(this.tmpPos), out, this.ramp, 0);
            this.heat += (d.heatPerShot * HEAT_PACE.gain) / stats.heatEfficiency;
            this.shotsFired++;
            this.sinceShot = 0;
            fired = true;
            if (this.heat >= 100) {
              this.heat = 100;
              this.overheated = true;
              sfx.play('overheat');
              break;
            }
          }
          this.beaming = !this.overheated;
          this.player.recoil += d.recoilPitch * dt * 20 * stats.spreadMult;
        } else {
          this.beaming = false;
          this.beamTick = 0;
          this.rampT = Math.max(0, this.rampT - dt * 2);
          this.ramp = 1;
        }
        this.beamFx = this.beaming ? fx : null;
        sfx.beamLoop(this.beaming);
        // Visual endpoint follows the current aim at the last resolved distance.
        // Reused vectors: this runs every frame for beam weapons (allocation-free).
        const from = this.muzzleWorld(this.tmpPos);
        const cam = this.player.camera;
        cam.getDirectionToRef(FORWARD, this.tmpTo);
        const to = this.tmpTo.scaleInPlace(Math.max(1, this.beamDist || this.range(stats))).addInPlace(cam.position);
        fx.beam(this.beaming, from, to, this.ramp, this.beamContact);
        if (this.beaming) sfx.beamLevel(this.ramp, this.heat / 100);
        break;
      }
    }
    this.triggerWas = trigger;

    if (!fired && !this.beaming) {
      this.spread = Math.max(d.spreadMin, this.spread - d.spreadRecover * dt);
      if (this.sinceShot > d.coolDelay * HEAT_PACE.delay || this.overheated) {
        const cool = d.coolRate * stats.coolRateMult * HEAT_PACE.cool;
        const r = this.overheated ? cool * HEAT_PACE.lockout : cool;
        this.heat = Math.max(0, this.heat - r * dt);
        if (this.overheated && this.heat <= d.overheatRecover) {
          this.overheated = false;
          sfx.play('weaponReady');
          this.anim.impulse(-1.2, 0);
        }
      }
    }

    // --- presentation
    // Recoil recovers slower while the trigger is held (sustained fire climbs a little) and fast after release.
    const feel = this.feelFor(d);
    this.player.recoilRecover = trigger && this.sinceShot < 0.25 ? feel.recoverFiring : feel.recoverIdle;
    this.switchT = Math.max(0, this.switchT - dt * 2.8);
    this.anim.update({
      dt,
      lookDx: this.player.lookDx,
      lookDy: this.player.lookDy,
      speed: this.player.speed,
      grounded: this.player.grounded,
      // Firing breaks the sprint pose: shots never leave a weapon turned 25 degrees off-axis.
      sprinting: this.player.sprinting && this.sinceShot > 0.35,
      dashing: this.player.dashing,
      verticalSpeed: this.player.verticalSpeed,
      heat: this.heat / 100,
      overheated: this.overheated,
      charge: d.mechanism === 'charge' || d.mechanism === 'cycle' || d.mechanism === 'salvo' ? this.charge : 0,
      active: this.beaming ? Math.min(1, 0.5 + this.ramp / (2 * Math.max(1, d.rampMax))) : active,
      holster: Math.max(this.holster, this.switchT),
    });
    this.syncViewmodelPose();

    this.flashT -= dt;
    if (this.flashT <= 0) for (const f of this.flashMeshes) f.setEnabled(false);
    else this.flashRoot.scaling.setAll(this.flashScale * (0.6 + this.flashT * 10));
    // Beam: steady emitter glow at the muzzle while firing.
    if (this.beaming) {
      this.flashRoot.parent = this.rig.muzzles[0] ?? this.rig.root;
      this.flashMeshes[2].setEnabled(true);
      this.flashMeshes[2].rotation.z += dt * 9;
      this.flashRoot.scaling.setAll(0.35 + 0.08 * Math.sin(performance.now() * 0.05) + 0.1 * this.ramp);
      this.light.position.copyFrom(this.muzzleWorld(this.tmpPos));
      this.light.intensity = Math.max(this.light.intensity, 1.5 + this.ramp);
    } else if ((d.mechanism === 'charge' || d.mechanism === 'salvo') && this.charge > 0) {
      this.light.position.copyFrom(this.muzzleWorld(this.tmpPos));
      this.light.intensity = Math.max(this.light.intensity, this.charge * this.charge * 2.5);
    }
    this.light.intensity = Math.max(0, this.light.intensity - dt * 50);
    this.heatFx.update(this.muzzleWorld(this.tmpPos), this.heat / 100, this.sinceShot, this.overheated, this.visible && this.player.alive && !this.beaming);
    return fired;
  }
}
