import { type AbstractMesh, type Mesh, MeshBuilder, Ray, type Scene, Vector3 } from '@babylonjs/core';
import type { CombatStats } from '../combat/stats';
import { SENTINEL } from '../data/defs';
import type { Player } from '../player/Player';
import type { Kit } from '../visuals/kit';
import type { Palette } from '../visuals/materials';
import { buildTurret, type TurretRig } from '../visuals/models';
import type { ArenaLayout } from '../world/layout';
import { FOOTPRINT_SAMPLES, PLACEMENT_MESSAGES, type PlacementReason, validatePlacement } from './placement';
import type { Turret } from './Turrets';

export const BUILD_REACH = 32;

const isSurface = (m: AbstractMesh) => !!m.metadata?.surface && m.isEnabled();

/**
 * Build mode: projects the crosshair onto level surfaces with engine picking,
 * samples the footprint with downward picks, and validates with pure rules.
 */
export class Construction {
  active = false;
  valid = false;
  reason: PlacementReason = 'no-surface';
  readonly point = new Vector3();
  private ghostOk: TurretRig;
  private ghostBad: TurretRig;
  private ring: Mesh;
  private inspectRing: Mesh;
  private ray = new Ray(Vector3.Zero(), Vector3.Forward(), BUILD_REACH);
  private downRay = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 20);

  constructor(private scene: Scene, kit: Kit, P: Palette, private layout: ArenaLayout) {
    this.ghostOk = buildTurret(kit, P, P.ghostOk);
    this.ghostBad = buildTurret(kit, P, P.ghostBad);
    this.ghostOk.root.setEnabled(false);
    this.ghostBad.root.setEnabled(false);
    this.ring = MeshBuilder.CreateTorus('rangeRing', { diameter: 2, thickness: 0.02, tessellation: 96 }, scene);
    this.ring.material = P.cyanGlow;
    this.ring.isPickable = false;
    this.ring.setEnabled(false);
    this.inspectRing = this.ring.clone('inspectRing');
    this.inspectRing.setEnabled(false);
  }

  get message(): string {
    return PLACEMENT_MESSAGES[this.reason];
  }

  setActive(a: boolean): void {
    this.active = a;
    if (!a) {
      this.ghostOk.root.setEnabled(false);
      this.ghostBad.root.setEnabled(false);
      this.ring.setEnabled(false);
    }
  }

  private surfaceHeight(x: number, z: number, fromY: number): number {
    this.downRay.origin.set(x, fromY, z);
    const hit = this.scene.pickWithRay(this.downRay, isSurface);
    return hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : -1;
  }

  update(player: Player, cores: number, turrets: readonly Turret[], stats: CombatStats): void {
    if (!this.active) return;
    const cam = player.camera;
    this.ray.origin.copyFrom(cam.position);
    cam.getDirectionToRef(Vector3.Forward(), this.ray.direction);
    this.ray.length = BUILD_REACH + 8;
    const hit = this.scene.pickWithRay(this.ray, isSurface);
    if (!hit?.hit || !hit.pickedPoint) {
      this.valid = false;
      this.reason = 'no-surface';
      this.ghostOk.root.setEnabled(false);
      this.ghostBad.root.setEnabled(false);
      this.ring.setEnabled(false);
      return;
    }
    const p = hit.pickedPoint;
    const n = hit.getNormal(true, true) ?? Vector3.Up();
    const surface = hit.pickedMesh?.metadata?.surface as string;
    const r = SENTINEL.radius;
    const heights = FOOTPRINT_SAMPLES.map(([ox, oz]) => this.surfaceHeight(p.x + ox * r, p.z + oz * r, p.y + 8));
    this.reason = validatePlacement(this.layout, {
      x: p.x,
      y: p.y,
      z: p.z,
      surface,
      normalY: n.y,
      footprintHeights: heights,
      radius: r,
      playerX: player.position.x,
      playerZ: player.position.z,
      maxRange: BUILD_REACH,
      cores,
      cost: SENTINEL.cost,
      towers: turrets.map((t) => ({ x: t.pos.x, z: t.pos.z, radius: t.def.radius })),
    });
    this.valid = this.reason === 'ok';
    this.point.copyFrom(p);
    const show = this.valid ? this.ghostOk : this.ghostBad;
    const hide = this.valid ? this.ghostBad : this.ghostOk;
    hide.root.setEnabled(false);
    show.root.setEnabled(true);
    show.root.position.copyFrom(p);
    show.yaw.rotation.y = player.yaw;
    const range = SENTINEL.range * stats.turretRangeMult;
    this.ring.setEnabled(true);
    this.ring.position.set(p.x, p.y + 0.06, p.z);
    this.ring.scaling.set(range, 1, range);
  }

  showInspect(t: Turret | null, stats: CombatStats): void {
    if (!t) {
      this.inspectRing.setEnabled(false);
      return;
    }
    const range = t.range(stats);
    this.inspectRing.setEnabled(true);
    this.inspectRing.position.set(t.pos.x, t.pos.y + 0.06, t.pos.z);
    this.inspectRing.scaling.set(range, 1, range);
  }
}
