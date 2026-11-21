import { type AbstractMesh, type Material, type Mesh, MeshBuilder, Ray, type Scene, Vector3 } from '@babylonjs/core';
import type { CombatStats } from '@riftwarden/rules/combat/stats';
import type { Player } from '../player/Player';
import type { Palette } from '../visuals/materials';
import type { TurretRig } from '../visuals/models';
import { BASES, composeTower, configCost, DEFAULT_CONFIG, NO_RUN_INPUT, type TowerConfig } from '@riftwarden/rules/towers/components';
import type { ArenaLayout } from '@riftwarden/rules/world/layout';
import { FOOTPRINT_SAMPLES, PLACEMENT_MESSAGES, type PlacementReason, validatePlacement } from '@riftwarden/rules/defense/placement';
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
  private ghostOk!: TurretRig;
  private ghostBad!: TurretRig;
  template: TowerConfig = { ...DEFAULT_CONFIG };
  private ring: Mesh;
  private inspectRing: Mesh;
  private ray = new Ray(Vector3.Zero(), Vector3.Forward(), BUILD_REACH);
  private downRay = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 20);

  constructor(private scene: Scene, private buildGhost: (cfg: TowerConfig, unique: Material) => TurretRig, private P: Palette, private layout: ArenaLayout) {
    this.makeGhosts();
    this.ring = MeshBuilder.CreateTorus('rangeRing', { diameter: 2, thickness: 0.02, tessellation: 96 }, scene);
    this.ring.material = P.cyanGlow;
    this.ring.isPickable = false;
    this.ring.setEnabled(false);
    this.inspectRing = this.ring.clone('inspectRing');
    this.inspectRing.setEnabled(false);
  }

  /** (Re)build the placement ghosts for a tower configuration. */
  private makeGhosts(): void {
    this.ghostOk?.root.dispose(false, false);
    this.ghostBad?.root.dispose(false, false);
    this.ghostOk = this.buildGhost(this.template, this.P.ghostOk);
    this.ghostBad = this.buildGhost(this.template, this.P.ghostBad);
    this.ghostOk.root.setEnabled(false);
    this.ghostBad.root.setEnabled(false);
  }

  setTemplate(cfg: TowerConfig): void {
    this.template = { ...cfg };
    this.makeGhosts();
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
    const r = BASES[this.template.base]?.radius ?? 1.1;
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
      cost: configCost(this.template, stats.buildCostMult),
      towers: turrets.map((t) => ({ x: t.pos.x, z: t.pos.z, radius: t.radius })),
    });
    this.valid = this.reason === 'ok';
    this.point.copyFrom(p);
    const show = this.valid ? this.ghostOk : this.ghostBad;
    const hide = this.valid ? this.ghostBad : this.ghostOk;
    hide.root.setEnabled(false);
    show.root.setEnabled(true);
    show.root.position.copyFrom(p);
    show.yaw.rotation.y = player.yaw;
    const range = composeTower(this.template, 1, { ...NO_RUN_INPUT, rangeMult: stats.turretRangeMult }).range;
    this.ring.setEnabled(true);
    this.ring.position.set(p.x, p.y + 0.06, p.z);
    this.ring.scaling.set(range, 1, range);
  }

  /**
   * M7 (co-op server): validate a placement request at a claimed point with the same rules as the
   * local preview: a downward pick finds the real surface under the point, the footprint is sampled.
   */
  validateAt(x: number, z: number, cfg: TowerConfig, from: Vector3, cores: number, turrets: readonly Turret[], stats: CombatStats): { reason: PlacementReason; point: Vector3 } {
    this.downRay.origin.set(x, 18, z);
    const hit = this.scene.pickWithRay(this.downRay, isSurface);
    if (!hit?.hit || !hit.pickedPoint) return { reason: 'no-surface', point: new Vector3(x, 0, z) };
    const p = hit.pickedPoint.clone();
    const n = hit.getNormal(true, true) ?? Vector3.Up();
    const r = BASES[cfg.base]?.radius ?? 1.1;
    const heights = FOOTPRINT_SAMPLES.map(([ox, oz]) => this.surfaceHeight(p.x + ox * r, p.z + oz * r, p.y + 8));
    const reason = validatePlacement(this.layout, {
      x: p.x,
      y: p.y,
      z: p.z,
      surface: hit.pickedMesh?.metadata?.surface as string,
      normalY: n.y,
      footprintHeights: heights,
      radius: r,
      playerX: from.x,
      playerZ: from.z,
      maxRange: BUILD_REACH + 4,
      cores,
      cost: configCost(cfg, stats.buildCostMult),
      towers: turrets.map((t) => ({ x: t.pos.x, z: t.pos.z, radius: t.radius })),
    });
    return { reason, point: p };
  }

  showInspect(t: Turret | null): void {
    if (!t) {
      this.inspectRing.setEnabled(false);
      return;
    }
    const range = t.range();
    this.inspectRing.setEnabled(true);
    this.inspectRing.position.set(t.pos.x, t.pos.y + 0.06, t.pos.z);
    this.inspectRing.scaling.set(range, 1, range);
  }
}
