/**
 * M10 ground hazards: frost fields (cryo biome) and slag pools (foundry biome, and the trails of Molten
 * mutants). Static patches come from the layout (reserved for construction by the generator); transient ones
 * (slag trails) fade out. Narrow host interface, no Game import.
 *
 *   frost: the drone moves 35% slower while low over it; ground enemies on it build chill (towers combo with it).
 *   slag:  scorches the drone while it skims low over it (12 / s); ground enemies on it burn (Molten ones do not).
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { type Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { type Scene } from '@babylonjs/core/scene';
import type { Enemy } from '../enemies/EnemyManager';
import type { Player } from '../player/Player';
import { unlit } from '../visuals/materials';
import { canvas, ringSprite, rng, toTexture } from '../visuals/textures';

export const HAZARD = {
  frostSlow: 0.65,
  frostChill: 22,
  slagDps: 12,
  slagBurn: 6,
  /** The drone is affected below this height above the floor. */
  low: 2.6,
  tick: 0.25,
  maxTransient: 48,
} as const;

export type HazardKind = 'frost' | 'slag';

interface Patch {
  x: number;
  z: number;
  r: number;
  kind: HazardKind;
  /** Remaining life (Infinity = static). */
  life: number;
  max: number;
  mesh: Mesh;
}

export interface HazardHost {
  readonly scene: Scene;
  enemies(): readonly Enemy[];
  readonly player: Player;
  hurtPlayer(amount: number, from: { x: number; y: number; z: number }): void;
  inflict(e: Enemy, p: { burn?: number; chill?: number }): void;
}

const FLYING = new Set(['rusher', 'skimmer', 'jammer', 'artillery', 'courier', 'overseer', 'pylon']);

export class Hazards {
  private patches: Patch[] = [];
  private mats: Record<HazardKind, PBRMaterial>;
  private rims: Record<HazardKind, PBRMaterial>;
  /** Current drone speed multiplier (1 = free). */
  playerSpeed = 1;
  /** Statistics / tests. */
  playerDamage = 0;

  constructor(private h: HazardHost, statics: readonly { x: number; z: number; r: number; kind: HazardKind }[]) {
    const ring = ringSprite(h.scene);
    this.mats = {
      frost: unlit(h.scene, 'hazFrost', [0.5, 0.85, 1.15], { additive: true, zOffset: -3 }),
      // Molten pool: dark crust plates with glowing seams (a flat additive orange disc read as plastic).
      slag: slagMaterial(h.scene),
    };
    this.rims = {
      frost: unlit(h.scene, 'hazFrostRim', [1.2, 1.9, 2.6], { tex: ring, opacity: ring, additive: true, zOffset: -4 }),
      slag: unlit(h.scene, 'hazSlagRim', [3.2, 1.1, 0.2], { tex: ring, opacity: ring, additive: true, zOffset: -4 }),
    };
    for (const s of statics) this.add(s.x, s.z, s.r, s.kind, Infinity);
  }

  get count(): number {
    return this.patches.length;
  }

  /** Add a patch (transient when `life` is finite; the oldest transient is recycled beyond the cap). */
  add(x: number, z: number, r: number, kind: HazardKind, life: number): void {
    if (Number.isFinite(life)) {
      const transient = this.patches.filter((p) => Number.isFinite(p.life));
      if (transient.length >= HAZARD.maxTransient) this.remove(transient[0]);
    }
    const mesh = MeshBuilder.CreateDisc('hazard', { radius: r, tessellation: Number.isFinite(life) ? 18 : 40 }, this.h.scene);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, 0.035, z);
    mesh.material = this.mats[kind];
    mesh.isPickable = false;
    const rim = MeshBuilder.CreatePlane('hazardRim', { size: r * 2.3 }, this.h.scene);
    rim.rotation.x = Math.PI / 2;
    rim.parent = mesh;
    rim.rotation.x = 0;
    rim.position.z = -0.01;
    rim.material = this.rims[kind];
    rim.isPickable = false;
    this.patches.push({ x, z, r, kind, life, max: life, mesh });
    if (Number.isFinite(life)) this.onAdd?.(x, z, r, kind, life);
  }

  private remove(p: Patch): void {
    p.mesh.dispose(false, false);
    const i = this.patches.indexOf(p);
    if (i >= 0) this.patches.splice(i, 1);
  }

  /** Which hazard covers (x, z), if any. */
  at(x: number, z: number): HazardKind | null {
    for (const p of this.patches) if ((x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r) return p.kind;
    return null;
  }

  /** dt = real time (the drone), hdt = hostile time (enemies, transient decay). Single-player / host entry. */
  update(dt: number, hdt: number, t: number): void {
    this.decay(hdt, t);
    this.affectPlayer(dt);
    if (this.affectEnemies) this.affectEnemyList(dt);
  }

  /** Replicas render hazards and slow their own drone, but never touch (puppet) enemies. */
  affectEnemies = true;
  /** Called for every patch added at runtime (co-op servers replicate slag trails). */
  onAdd: ((x: number, z: number, r: number, kind: HazardKind, life: number) => void) | null = null;
  private playerTick = new WeakMap<object, number>();
  private enemyTick = 0;

  /** Transient patches shrink and expire; static slag shimmers. */
  decay(hdt: number, t: number): void {
    for (const p of [...this.patches]) {
      if (Number.isFinite(p.life)) {
        p.life -= hdt;
        if (p.life <= 0) {
          this.remove(p);
          continue;
        }
        const k = Math.min(1, p.life / Math.min(1.2, p.max));
        p.mesh.scaling.setAll(0.4 + 0.6 * k);
      } else if (p.kind === 'slag') p.mesh.visibility = 0.85 + 0.15 * Math.sin(t * 2 + p.x);
    }
  }

  /** Effects on the host's current drone (co-op servers call this once per avatar). */
  affectPlayer(dt: number): void {
    const pl = this.h.player;
    const low = pl.alive && pl.position.y < HAZARD.low;
    const under = low ? this.at(pl.position.x, pl.position.z) : null;
    this.playerSpeed = under === 'frost' ? HAZARD.frostSlow : 1;
    const left = (this.playerTick.get(pl) ?? 0) - dt;
    if (left > 0) {
      this.playerTick.set(pl, left);
      return;
    }
    this.playerTick.set(pl, HAZARD.tick);
    if (under === 'slag') {
      const dmg = HAZARD.slagDps * HAZARD.tick;
      this.playerDamage += dmg;
      this.h.hurtPlayer(dmg, { x: pl.position.x, y: 0, z: pl.position.z });
    }
  }

  /** Ground enemies standing in hazards: chill on frost, burn on slag (Molten mutants are immune). */
  affectEnemyList(dt: number): void {
    this.enemyTick -= dt;
    if (this.enemyTick > 0 || !this.patches.length) return;
    this.enemyTick = HAZARD.tick;
    for (const e of this.h.enemies()) {
      if (!e.alive || e.hidden || FLYING.has(e.kind) || e.pos.y > 1) continue;
      const kind = this.at(e.pos.x, e.pos.z);
      if (kind === 'frost') this.h.inflict(e, { chill: HAZARD.frostChill * HAZARD.tick });
      else if (kind === 'slag' && !e.has('molten')) this.h.inflict(e, { burn: HAZARD.slagBurn });
    }
  }

  dispose(): void {
    for (const p of [...this.patches]) this.remove(p);
  }
}

export const HAZARD_COLOR: Record<HazardKind, Color3> = { frost: new Color3(0.6, 0.9, 1.2), slag: new Color3(2.6, 0.7, 0.12) };

/** Slag pool material: dark cooled crust broken into plates by glowing seams, fading out at the rim. */
function slagMaterial(scene: Scene): PBRMaterial {
  const N = 512;
  const { c, ctx } = canvas(N);
  const img = ctx.createImageData(N, N);
  const r = rng(0x51a6);
  const pts = Array.from({ length: 46 }, () => [r(), r()] as const);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      let f1 = 9, f2 = 9;
      for (const [px, py] of pts) {
        const d = Math.hypot(px - u, py - v);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      const seam = Math.max(0, 1 - (f2 - f1) / 0.022);
      const glow = seam * seam;
      const radial = Math.hypot(u - 0.5, v - 0.5) * 2;
      const edge = Math.max(0, Math.min(1, (1 - radial) / 0.18));
      // Crust: almost black with a dull red cast near the seams; seams white-hot to orange.
      const heat = glow * (0.75 + 0.25 * Math.sin(u * 40 + v * 33));
      const i = (y * N + x) * 4;
      img.data[i] = Math.min(255, 18 + heat * 255 + seam * 40);
      img.data[i + 1] = Math.min(255, 8 + heat * 130);
      img.data[i + 2] = Math.min(255, 4 + heat * 30);
      img.data[i + 3] = edge * 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = toTexture('slagPool', c, scene, { aniso: 4 });
  t.hasAlpha = true;
  const m = unlit(scene, 'hazSlag', [2.4, 1.6, 1.2], { tex: t, opacity: t, zOffset: -3 });
  m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  m.useAlphaFromAlbedoTexture = false;
  return m;
}
