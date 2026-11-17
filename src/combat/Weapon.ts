import {
  Color3,
  type Material,
  PBRMaterial,
  type Mesh,
  MeshBuilder,
  PointLight,
  type Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import type { WeaponDef } from '../data/defs';
import type { Player } from '../player/Player';
import { type Palette, unlit } from '../visuals/materials';
import { starSprite } from '../visuals/textures';
import type { CombatStats } from './stats';

export interface ShotRequest {
  origin: Vector3;
  dir: Vector3;
  range: number;
  damage: number;
}
export interface ShotOutcome {
  point: Vector3;
}

/**
 * Hitscan plasma repeater with heat management. The weapon only owns timing,
 * spread, heat and the first-person viewmodel; hit resolution is delegated so
 * other weapon archetypes can share it.
 */
export class Weapon {
  heat = 0;
  overheated = false;
  private cooldown = 0;
  private sinceShot = 99;
  spread: number;
  private vm: TransformNode;
  private muzzle: TransformNode;
  private flashMeshes: Mesh[] = [];
  private flashT = 0;
  private kick = 0;
  private swayX = 0;
  private swayY = 0;
  private heatMat: PBRMaterial;
  private coilMat: PBRMaterial;
  private light: PointLight;
  private coils: Mesh[] = [];
  private spin = 0;
  private holster = 0; // 0 = ready, 1 = lowered (build mode)
  private readonly tmpDir = new Vector3();
  private readonly tmpPos = new Vector3();

  constructor(scene: Scene, P: Palette, public def: WeaponDef, private player: Player) {
    this.spread = def.spreadMin;
    const cam = player.camera;
    this.vm = new TransformNode('viewmodel', scene);
    this.vm.parent = cam;
    this.vm.position.set(0.3, -0.3, 0.62);
    this.vm.scaling.setAll(0.6);

    this.heatMat = new PBRMaterial('heatVent', scene);
    this.heatMat.albedoColor = new Color3(0.04, 0.04, 0.045);
    this.heatMat.metallic = 0.8;
    this.heatMat.roughness = 0.4;
    this.heatMat.usePhysicalLightFalloff = false;
    this.coilMat = unlit(scene, 'vmCoil', [0.25, 1.8, 2.1]);

    const mk = (m: Mesh, mat: Material, pos: [number, number, number], rot?: [number, number, number]): Mesh => {
      m.material = mat;
      m.parent = this.vm;
      m.position.set(...pos);
      if (rot) m.rotation.set(...rot);
      m.renderingGroupId = 1;
      m.isPickable = false;
      return m;
    };
    // Receiver & frame
    mk(MeshBuilder.CreateBox('vmBody', { width: 0.13, height: 0.15, depth: 0.5 }, scene), P.white, [0, 0, 0]);
    mk(MeshBuilder.CreateBox('vmTop', { width: 0.09, height: 0.04, depth: 0.36 }, scene), P.graphite, [0, 0.09, -0.02]);
    mk(MeshBuilder.CreateBox('vmUnder', { width: 0.11, height: 0.07, depth: 0.42 }, scene), P.graphite, [0, -0.1, 0.02]);
    mk(MeshBuilder.CreateBox('vmSide', { width: 0.015, height: 0.08, depth: 0.3 }, scene), P.cyanDim, [-0.068, 0.0, 0.0]);
    mk(MeshBuilder.CreateBox('vmGrip', { width: 0.07, height: 0.17, depth: 0.08 }, scene), P.graphite, [0, -0.17, -0.12], [0.35, 0, 0]);
    mk(MeshBuilder.CreateBox('vmStock', { width: 0.09, height: 0.1, depth: 0.16 }, scene), P.white, [0, -0.02, -0.31], [0.1, 0, 0]);
    // Heat vents (glow orange as heat rises)
    for (let i = 0; i < 4; i++) mk(MeshBuilder.CreateBox('vmVent', { width: 0.07, height: 0.012, depth: 0.018 }, scene), this.heatMat, [0, 0.112, -0.1 + i * 0.045]);
    // Barrel assembly
    mk(MeshBuilder.CreateCylinder('vmBarrel', { diameter: 0.055, height: 0.42, tessellation: 16 }, scene), P.graphite, [0, 0.0, 0.42], [Math.PI / 2, 0, 0]);
    mk(MeshBuilder.CreateCylinder('vmShroud', { diameter: 0.1, height: 0.16, tessellation: 6 }, scene), P.white, [0, 0.0, 0.3], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 3; i++) {
      this.coils.push(mk(MeshBuilder.CreateTorus('vmCoil', { diameter: 0.085, thickness: 0.016, tessellation: 20 }, scene), this.coilMat, [0, 0, 0.42 + i * 0.06], [Math.PI / 2, 0, 0]));
    }
    // Energy cell
    mk(MeshBuilder.CreateCylinder('vmCell', { diameter: 0.05, height: 0.2, tessellation: 12 }, scene), this.coilMat, [0.075, -0.04, 0.05], [Math.PI / 2, 0, 0]);
    mk(MeshBuilder.CreateBox('vmCellCage', { width: 0.03, height: 0.07, depth: 0.22 }, scene), P.graphite, [0.09, -0.04, 0.05]);

    this.muzzle = new TransformNode('muzzle', scene);
    this.muzzle.parent = this.vm;
    this.muzzle.position.set(0, 0, 0.66);
    // Muzzle flash: crossed additive star sprites plus a front-facing burst.
    const star = starSprite(scene);
    const flashMat = unlit(scene, 'vmFlashMat', [2.4, 3.6, 4.4], { tex: star, opacity: star, additive: true, twoSided: true });
    for (let i = 0; i < 2; i++) {
      const dims = i ? { width: 0.5, height: 0.22 } : { width: 0.22, height: 0.5 };
      const f = mk(MeshBuilder.CreatePlane('vmFlash', dims, scene), flashMat, [0, 0, 0.84], i ? [0, Math.PI / 2, 0] : [Math.PI / 2, 0, 0]);
      f.setEnabled(false);
      this.flashMeshes.push(f);
    }
    const fc = mk(MeshBuilder.CreatePlane('vmFlashC', { size: 0.42 }, scene), flashMat, [0, 0, 0.7]);
    fc.setEnabled(false);
    this.flashMeshes.push(fc);
    this.light = new PointLight('muzzleLight', Vector3.Zero(), scene);
    this.light.diffuse = new Color3(0.6, 0.9, 1);
    this.light.specular = new Color3(0.3, 0.5, 0.6);
    this.light.range = 14;
    this.light.intensity = 0;
  }

  muzzleWorld(out = new Vector3()): Vector3 {
    this.muzzle.computeWorldMatrix(true);
    return out.copyFrom(this.muzzle.getAbsolutePosition());
  }

  /** Swap the weapon parameters (equipment change during preparation). */
  setDef(def: WeaponDef): void {
    this.def = def;
    this.spread = Math.max(def.spreadMin, Math.min(def.spreadMax, this.spread));
  }

  reset(): void {
    this.heat = 0;
    this.overheated = false;
    this.cooldown = 0;
    this.spread = this.def.spreadMin;
  }

  setVisible(v: boolean): void {
    this.vm.setEnabled(v);
  }

  setHolstered(h: boolean): void {
    this.holster = h ? 1 : 0;
  }

  /** Returns true if a shot was fired this frame. */
  update(dt: number, trigger: boolean, stats: CombatStats, shoot: (r: ShotRequest) => ShotOutcome): boolean {
    const d = this.def;
    this.cooldown -= dt;
    this.sinceShot += dt;
    let fired = false;
    const ready = this.holster === 0 && this.player.alive;

    if (trigger && ready && !this.overheated && this.cooldown <= 0) {
      fired = true;
      this.cooldown += 1 / (d.fireRate * stats.fireRateMult);
      if (this.cooldown < 0) this.cooldown = 0;
      this.sinceShot = 0;
      this.heat += d.heatPerShot / stats.heatEfficiency;
      if (this.heat >= 100) {
        this.heat = 100;
        this.overheated = true;
        sfx.play('overheat');
      }
      // Spread: first shot is pinpoint, sustained fire blooms.
      const cam = this.player.camera;
      cam.getDirectionToRef(Vector3.Forward(), this.tmpDir);
      const r = this.spread * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const right = cam.getDirection(Vector3.Right());
      const up = cam.getDirection(Vector3.Up());
      this.tmpDir.addInPlace(right.scaleInPlace(Math.cos(a) * r)).addInPlace(up.scaleInPlace(Math.sin(a) * r)).normalize();
      this.spread = Math.min(d.spreadMax, this.spread + d.spreadPerShot);

      const out = shoot({ origin: cam.position.clone(), dir: this.tmpDir.clone(), range: d.range, damage: d.damage * stats.weaponDamageMult });
      this.lastShot = { from: this.muzzleWorld(this.tmpPos).clone(), to: out.point };

      this.player.recoil += d.recoilPitch * (0.8 + Math.random() * 0.4);
      this.kick = 1;
      this.flashT = 0.045;
      for (const f of this.flashMeshes) {
        f.setEnabled(true);
        f.scaling.setAll(0.8 + Math.random() * 0.6);
      }
      this.flashMeshes[2].rotation.z = Math.random() * Math.PI;
      this.light.position.copyFrom(this.tmpPos);
      this.light.intensity = 3.2;
      sfx.play('shoot', { pitch: 1 + this.heat / 400 });
    } else {
      this.lastShot = null;
    }

    if (!fired) {
      this.spread = Math.max(d.spreadMin, this.spread - d.spreadRecover * dt);
      if (this.sinceShot > d.coolDelay || this.overheated) {
        const cool = d.coolRate * stats.coolRateMult;
        const rate = this.overheated ? cool * 0.75 : cool;
        this.heat = Math.max(0, this.heat - rate * dt);
        if (this.overheated && this.heat <= d.overheatRecover) this.overheated = false;
      }
    }

    // --- Viewmodel animation ---
    this.flashT -= dt;
    if (this.flashT <= 0) for (const f of this.flashMeshes) f.setEnabled(false);
    this.light.intensity = Math.max(0, this.light.intensity - dt * 50);
    this.kick *= Math.exp(-dt * 22);
    const speed = this.player.speed;
    this.swayX += ((this.player.grounded ? Math.sin(performance.now() * 0.009) * 0.006 * Math.min(1, speed / 11) : 0) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += ((this.player.grounded ? Math.abs(Math.cos(performance.now() * 0.009)) * 0.006 * Math.min(1, speed / 11) : 0.01) - this.swayY) * Math.min(1, dt * 10);
    const hol = this.holsterAnim(dt);
    const oh = this.overheated ? 0.06 : 0;
    this.vm.position.set(0.25 + this.swayX, -0.25 - this.swayY - hol * 0.25 - oh * 0.5, 0.52 - this.kick * 0.045);
    this.vm.rotation.set(-this.kick * 0.05 + hol * 0.6 + oh, oh * 2, oh * 2.5);
    this.spin += dt * (2 + this.heat * 0.15);
    for (let i = 0; i < this.coils.length; i++) this.coils[i].rotation.y = this.spin * (i % 2 ? -1 : 1);

    const h = this.heat / 100;
    this.heatMat.emissiveColor.set(h * h * 2.4, h * h * 0.6, 0.02 * h);
    const pulse = this.overheated ? 0.4 + 0.3 * Math.sin(performance.now() * 0.03) : 1;
    this.coilMat.emissiveColor.set(0.25 * pulse + h * 1.2, 1.8 * pulse * (1 - h * 0.5), 2.1 * pulse * (1 - h * 0.6));
    return fired;
  }

  lastShot: { from: Vector3; to: Vector3 } | null = null;

  private holsterCur = 0;
  private holsterAnim(dt: number): number {
    this.holsterCur += (this.holster - this.holsterCur) * Math.min(1, dt * 12);
    return this.holsterCur;
  }
}
