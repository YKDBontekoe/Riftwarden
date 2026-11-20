import { Color4, ParticleSystem, type Scene, Vector3 } from '@babylonjs/core';
import { plumeSprite, SMOKE_CELL, SMOKE_FRAMES } from '../visuals/textures';

/**
 * Heat presentation at the muzzle: thin smoke wisps curl off a hot barrel between bursts, and an overheat lockout
 * vents a jet of steam. One small particle system; the weapon feeds it heat and the muzzle position each frame.
 */
export class MuzzleHeat {
  private ps: ParticleSystem;
  private at = new Vector3();

  constructor(scene: Scene) {
    const ps = new ParticleSystem('muzzleHeat', 90, scene, undefined, true);
    ps.spriteCellWidth = ps.spriteCellHeight = SMOKE_CELL;
    ps.endSpriteCellID = SMOKE_FRAMES - 1;
    ps.spriteCellChangeSpeed = 1;
    ps.spriteRandomStartCell = true;
    ps.particleTexture = plumeSprite(scene);
    ps.emitter = this.at;
    ps.minEmitBox.setAll(-0.015);
    ps.maxEmitBox.setAll(0.015);
    for (const [t, c] of [[0, new Color4(0.75, 0.78, 0.82, 0)], [0.15, new Color4(0.7, 0.72, 0.76, 0.16)], [1, new Color4(0.6, 0.62, 0.66, 0)]] as [number, Color4][]) ps.addColorGradient(t, c);
    ps.addSizeGradient(0, 0.04);
    ps.addSizeGradient(1, 0.32);
    ps.minLifeTime = 0.5;
    ps.maxLifeTime = 1.1;
    ps.direction1.set(-0.15, 0.5, -0.15);
    ps.direction2.set(0.15, 1, 0.15);
    ps.minEmitPower = 0.15;
    ps.maxEmitPower = 0.45;
    ps.gravity.set(0, 0.35, 0);
    ps.minAngularSpeed = -2;
    ps.maxAngularSpeed = 2;
    ps.maxInitialRotation = Math.PI * 2;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = 0;
    ps.updateSpeed = 1 / 60;
    ps.start();
    this.ps = ps;
  }

  /**
   * heat 0..1; `idle` = seconds since the last shot; `overheated` = locked out (venting). The emitter sits at
   * `muzzle` (world). Wisps only rise between shots, so they never veil the sight picture while firing.
   */
  update(muzzle: Vector3, heat: number, idle: number, overheated: boolean, visible: boolean): void {
    this.at.copyFrom(muzzle);
    let rate = 0;
    if (visible) {
      if (overheated) rate = 55;
      else if (idle > 0.12 && heat > 0.4) rate = (heat - 0.4) * 70 * Math.min(1, (idle - 0.12) * 4) * Math.max(0, 1 - (idle - 2) * 0.5);
    }
    this.ps.emitRate = rate;
    this.ps.minEmitPower = overheated ? 0.5 : 0.15;
    this.ps.maxEmitPower = overheated ? 1.3 : 0.45;
  }

  reset(): void {
    this.ps.emitRate = 0;
    this.ps.reset();
  }
}
