import { type Mesh, MeshBuilder, type Scene, type TargetCamera } from '@babylonjs/core';
import { damp } from '../visuals/anim';
import { unlit } from '../visuals/materials';

/** The bits of a station this presentation needs. */
export interface FocusStation {
  readonly pos: readonly [number, number];
  readonly focus: readonly [number, number, number];
}

/** Shortest signed angle difference a -> b. */
export function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * Presentation for the HQ stations: a pulsing floor ring under the targeted station, and a short
 * push-in toward the station while its terminal is open. The camera offset is applied on top of the
 * pose the player wrote this frame, so closing the terminal returns to the exact pre-open view.
 */
export class StationFocus {
  private ring: Mesh;
  private shown: FocusStation | null = null;
  private open: FocusStation | null = null;
  private time = 0;
  /** 0..1 how far the camera has moved toward the open station (read by tests). */
  dolly = 0;

  constructor(scene: Scene, private camera: TargetCamera) {
    this.ring = MeshBuilder.CreateTorus('stationRing', { diameter: 2.6, thickness: 0.06, tessellation: 56 }, scene);
    this.ring.material = unlit(scene, 'stationRing', [0.15, 1.7, 2.3], { additive: true });
    this.ring.isPickable = false;
    this.ring.setEnabled(false);
  }

  /** The station under the crosshair (null: none). */
  setTarget(s: FocusStation | null): void {
    this.shown = s;
    if (s) this.ring.position.set(s.pos[0], 0.06, s.pos[1]);
    this.ring.setEnabled(!!s);
  }

  openStation(s: FocusStation): void {
    this.open = s;
  }

  closeStation(): void {
    this.open = null;
  }

  update(dt: number, reduceMotion: boolean): void {
    this.time += dt;
    if (this.shown) {
      const p = 1 + 0.06 * Math.sin(this.time * 4);
      this.ring.scaling.set(p, 1, p);
    }
    const want = this.open && !reduceMotion ? 1 : 0;
    this.dolly = damp(this.dolly, want, want ? 9 : 12, dt);
    if (this.dolly < 0.002 && !want) {
      this.dolly = 0;
      return;
    }
    const s = this.open;
    if (!s) return;
    const cam = this.camera;
    const dx = s.focus[0] - cam.position.x;
    const dy = s.focus[1] - cam.position.y;
    const dz = s.focus[2] - cam.position.z;
    const flat = Math.hypot(dx, dz);
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.01) return;
    const push = Math.min(0.7, Math.max(0, dist - 1.5)) * this.dolly;
    cam.position.x += (dx / dist) * push;
    cam.position.y += (dy / dist) * push;
    cam.position.z += (dz / dist) * push;
    cam.rotation.y += angleDelta(cam.rotation.y, Math.atan2(dx, dz)) * 0.7 * this.dolly;
    cam.rotation.x += (Math.atan2(-dy, flat) - cam.rotation.x) * 0.5 * this.dolly;
  }
}
