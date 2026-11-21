/**
 * Forward rift anchors (procedural arenas): a scorched ground ring with hazard ticks and a vertical tear of
 * additive light that idles faintly and flares when enemies come through. Visual only (not pickable).
 */
import { Color3, Mesh, MeshBuilder, type PBRMaterial, type Scene, TransformNode } from '@babylonjs/core';
import type { Rift } from '@riftwarden/rules/world/layout';
import { unlit } from './materials';
import { flareSprite, ringSprite } from './textures';

interface Anchor {
  root: TransformNode;
  tear: Mesh[];
  flash: number;
  phase: number;
}

export class RiftAnchors {
  private anchors: Anchor[] = [];
  private tearMat: PBRMaterial;
  private ringMat: PBRMaterial;
  private base = new Color3(2.4, 0.55, 0.12);

  constructor(scene: Scene, rifts: readonly Rift[]) {
    const flare = flareSprite(scene);
    const ring = ringSprite(scene);
    this.tearMat = unlit(scene, 'riftTear', this.base, { tex: flare, opacity: flare, additive: true, twoSided: true });
    this.ringMat = unlit(scene, 'riftRing', [1.6, 0.42, 0.1], { tex: ring, opacity: ring, additive: true, zOffset: -3 });
    const scorch = unlit(scene, 'riftScorch', [0.02, 0.015, 0.012], { zOffset: -2 });
    rifts.forEach((r, i) => {
      const root = new TransformNode(`rift${i}`, scene);
      root.position.set(r.x, 0, r.z);
      const pad = MeshBuilder.CreateDisc('riftPad', { radius: 3.4, tessellation: 32 }, scene);
      pad.rotation.x = Math.PI / 2;
      pad.position.y = 0.012;
      pad.material = scorch;
      const glow = MeshBuilder.CreatePlane('riftGlow', { size: 7.6 }, scene);
      glow.rotation.x = Math.PI / 2;
      glow.position.y = 0.03;
      glow.material = this.ringMat;
      const tear: Mesh[] = [];
      for (let k = 0; k < 2; k++) {
        const p = MeshBuilder.CreatePlane('riftTearPlane', { width: 2.2, height: 5.2 }, scene);
        p.position.y = 2.7;
        p.rotation.y = (k * Math.PI) / 2 + i;
        p.material = this.tearMat;
        tear.push(p);
      }
      for (const m of [pad, glow, ...tear]) {
        m.parent = root;
        m.isPickable = false;
      }
      this.anchors.push({ root, tear, flash: 0, phase: i * 1.7 });
    });
  }

  /** Enemies came through near (x, z): flare the closest anchor. */
  spawned(x: number, z: number): void {
    let best: Anchor | null = null;
    let bd = 16;
    for (const a of this.anchors) {
      const d = Math.hypot(a.root.position.x - x, a.root.position.z - z);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    if (best) best.flash = 1;
  }

  update(dt: number, t: number): void {
    for (const a of this.anchors) {
      a.flash = Math.max(0, a.flash - dt * 1.4);
      const k = 0.35 + a.flash * 1.1 + Math.sin(t * 3 + a.phase) * 0.06;
      for (const p of a.tear) {
        p.scaling.set(0.6 + k * 0.6, 0.5 + k * 0.7, 1);
        p.rotation.y += dt * (0.4 + a.flash * 3);
      }
    }
  }

  get count(): number {
    return this.anchors.length;
  }
}
