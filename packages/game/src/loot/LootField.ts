import { type PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { type AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { type Scene } from '@babylonjs/core/scene';
import type { Kit } from '../visuals/kit';
import { type Palette, unlit } from '../visuals/materials';
import { baseDef, type IconKind } from '@riftwarden/rules/loot/bases';
import { RARITIES, type RarityId, rarity } from '@riftwarden/rules/loot/rarity';
import type { ItemInstance } from '@riftwarden/rules/loot/types';

/**
 * Physical loot in the arena. Lifetime and saturation rules live in lifetime.ts (pure).
 * Rendering: every part is a GPU instance of a shared template (one per shape and
 * rarity material); no per-drop meshes or materials are created.
 */
export { convertsToSalvage, expiresAfterWave, HARD_LIMIT, HOLO_HEIGHT, isExpired, LOOT_LIFETIME_WAVES, LOW_GRADE_LIMIT, PICKUP_RANGE } from '@riftwarden/rules/loot/lifetime';
import { HOLO_HEIGHT, isExpired } from '@riftwarden/rules/loot/lifetime';

const FLIGHT = 0.6;

export interface Pickup {
  id: number;
  item: ItemInstance;
  droppedWave: number;
  /** Ground point the hologram floats above. */
  ground: Vector3;
  focus: Vector3;
  root: TransformNode;
  holo: TransformNode;
  halo: AbstractMesh | null;
  /** Ascended: a second, counter-rotating halo crossing the first and an outer ground ring. */
  halo2: AbstractMesh | null;
  ring: AbstractMesh;
  flightT: number;
  from: Vector3;
  t: number;
  /** Will expire when the current wave is cleared. */
  expiring: boolean;
}

export class LootField {
  readonly pickups: Pickup[] = [];
  /** Resolves once every loot shader has compiled (awaited by the scene transition). */
  readonly warmup: Promise<void>;
  private glow = new Map<RarityId, PBRMaterial>();
  private beam = new Map<RarityId, PBRMaterial>();
  private nextId = 1;
  private readonly tmp = new Vector3();
  /** Called when a pickup lands (rarity reveal). */
  onLand: ((p: Pickup) => void) | null = null;

  constructor(
    private scene: Scene,
    private kit: Kit,
    private P: Palette,
  ) {
    const grad = new DynamicTexture('lootBeamGrad', { width: 4, height: 128 }, scene, false);
    const ctx = grad.getContext();
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    // Canvas top maps to the beam's base: bright at the ground, fading upward.
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 128);
    grad.hasAlpha = true;
    grad.update(false);
    for (const r of RARITIES) {
      this.glow.set(r.id, unlit(scene, `lootGlow_${r.id}`, r.glow));
      const c = r.glow.map((v) => v * 0.42) as [number, number, number];
      this.beam.set(r.id, unlit(scene, `lootBeam_${r.id}`, c, { tex: grad, opacity: grad, additive: true, twoSided: true }));
    }
    // Compile every loot shader up front (instanced variant), so the first drop of each
    // rarity neither hitches nor appears without its beam while the shader compiles.
    const jobs: Promise<void>[] = [];
    for (const r of RARITIES) {
      for (const [shape, mat] of [
        ['torusThin', this.glow.get(r.id)!],
        ['cyl', this.beam.get(r.id)!],
      ] as const) {
        const t = kit.template(shape, mat);
        jobs.push(mat.forceCompilationAsync(t, { useInstances: true }).catch(() => {}));
      }
    }
    this.warmup = Promise.all(jobs).then(() => {});
  }

  get count(): number {
    return this.pickups.length;
  }

  /** Drop an item: it arcs from `from` to `ground` and becomes collectible on landing. */
  spawn(item: ItemInstance, from: Vector3, ground: Vector3, wave: number): Pickup {
    const r = rarity(item.rarity);
    const root = new TransformNode(`loot_${this.nextId}`, this.scene);
    root.position.copyFrom(ground);
    const holo = new TransformNode('lootHolo', this.scene);
    holo.parent = root;
    holo.position.y = HOLO_HEIGHT;
    const glow = this.glow.get(r.id)!;
    this.buildIcon(baseDef(item.defId)?.icon ?? 'cube', holo, glow);
    const k = this.kit;
    const ring = k.part('torusThin', glow, root, { pos: [0, 0.05, 0], scale: [1.15, 1, 1.15], shadow: false });
    k.part('cyl', this.P.graphite, root, { pos: [0, 0.03, 0], scale: [0.7, 0.05, 0.7], shadow: false });
    let halo: AbstractMesh | null = null;
    if (r.index >= 3) halo = k.part('torusThin', glow, holo, { scale: [0.9, 1, 0.9], rot: [Math.PI / 2.4, 0, 0], shadow: false });
    if (r.index >= 3 || item.uniqueId) for (const i of [0, 1, 2, 3]) {
      const turn = Math.PI * i / 2 + Math.PI / 4;
      const radius = item.uniqueId ? 0.8 : 0.66;
      k.part('box', glow, root, { pos: [Math.sin(turn) * radius, 0.06, Math.cos(turn) * radius], rot: [0, turn, 0], scale: [0.29, 0.025, 0.065], shadow: false });
    }
    let halo2: AbstractMesh | null = null;
    if (r.id === 'ascended') {
      halo2 = k.part('torusThin', glow, holo, { scale: [1.1, 1, 1.1], rot: [-Math.PI / 2.6, 0, 0.6], shadow: false });
      k.part('torusThin', glow, root, { pos: [0, 0.04, 0], scale: [1.9, 1, 1.9], shadow: false });
    }
    if (r.beam > 0) {
      const width = 0.1 + r.index * 0.02;
      k.part('cyl', this.beam.get(r.id)!, root, { pos: [0, r.beam / 2, 0], scale: [width, r.beam, width], shadow: false });
    }
    const p: Pickup = {
      id: this.nextId++,
      item,
      droppedWave: wave,
      ground: ground.clone(),
      focus: ground.add(new Vector3(0, HOLO_HEIGHT, 0)),
      root,
      holo,
      halo,
      halo2,
      ring,
      flightT: 0,
      from: from.clone(),
      t: Math.random() * 10,
      expiring: false,
    };
    // Start in the air at the source; update() flies it to the ground point.
    holo.position.set(from.x - ground.x, from.y - ground.y, from.z - ground.z);
    for (const m of root.getChildMeshes()) m.isPickable = false;
    this.pickups.push(p);
    return p;
  }

  private buildIcon(kind: IconKind, holo: TransformNode, glow: PBRMaterial): void {
    const k = this.kit;
    const P = this.P;
    const o = (pos: [number, number, number], scale: [number, number, number], rot?: [number, number, number]) => ({ pos, scale, rot, shadow: false });
    switch (kind) {
      case 'rifle':
        k.part('box', P.white, holo, o([0, 0, 0], [0.18, 0.2, 0.75]));
        k.part('box', P.graphite, holo, o([0, -0.14, -0.12], [0.1, 0.22, 0.12], [0.35, 0, 0]));
        k.part('cyl', P.graphite, holo, o([0, 0.02, 0.5], [0.08, 0.36, 0.08], [Math.PI / 2, 0, 0]));
        k.part('box', glow, holo, o([0.1, 0.02, 0.05], [0.02, 0.06, 0.5]));
        k.part('box', glow, holo, o([-0.1, 0.02, 0.05], [0.02, 0.06, 0.5]));
        break;
      case 'plate':
        k.part('cyl6', P.white, holo, o([0, 0, 0], [0.62, 0.12, 0.62], [Math.PI / 2, 0, 0]));
        k.part('cyl6', glow, holo, o([0, 0, 0.065], [0.36, 0.02, 0.36], [Math.PI / 2, 0, 0]));
        break;
      case 'ring':
        k.part('torus', glow, holo, o([0, 0, 0], [0.62, 0.62, 0.62], [Math.PI / 2, 0, 0]));
        k.part('sphere', P.white, holo, o([0, 0, 0], [0.26, 0.26, 0.26]));
        break;
      case 'core':
        k.part('cyl8', P.graphite, holo, o([0, 0, 0], [0.34, 0.5, 0.34]));
        k.part('cyl8', glow, holo, o([0, 0, 0], [0.22, 0.56, 0.22]));
        k.part('torus', P.white, holo, o([0, 0, 0], [0.48, 0.48, 0.48]));
        break;
      case 'chip':
        k.part('box', P.graphite, holo, o([0, 0, 0], [0.5, 0.5, 0.07]));
        k.part('box', glow, holo, o([0, 0, 0.04], [0.26, 0.26, 0.02]));
        for (const s of [-1, 1]) k.part('box', P.white, holo, o([0.31 * s, 0, 0], [0.08, 0.4, 0.04]));
        break;
      case 'gem':
        k.part('ico', glow, holo, o([0, 0, 0], [0.42, 0.56, 0.42]));
        k.part('torusThin', P.white, holo, o([0, 0, 0], [0.56, 0.56, 0.56]));
        break;
      case 'cube':
        k.part('box', P.graphite, holo, o([0, 0, 0], [0.32, 0.32, 0.32], [0.6, 0.6, 0]));
        k.part('box', glow, holo, o([0, 0, 0], [0.2, 0.38, 0.2], [0.6, 0.6, 0]));
        break;
    }
  }

  /** Animate drops in flight, hover and spin, blink expiring pickups. Real time. */
  update(dt: number): void {
    for (const p of this.pickups) {
      p.t += dt;
      if (p.flightT < FLIGHT) {
        p.flightT = Math.min(FLIGHT, p.flightT + dt);
        const u = p.flightT / FLIGHT;
        const e = 1 - (1 - u) * (1 - u);
        const fx = p.from.x + (p.ground.x - p.from.x) * e;
        const fz = p.from.z + (p.ground.z - p.from.z) * e;
        const fy = p.from.y + (p.ground.y + HOLO_HEIGHT - p.from.y) * u + 2.2 * 4 * u * (1 - u);
        p.holo.position.set(fx - p.ground.x, fy - p.ground.y, fz - p.ground.z);
        p.holo.rotation.y += dt * 9;
        if (p.flightT >= FLIGHT) this.onLand?.(p);
        continue;
      }
      p.holo.position.set(0, HOLO_HEIGHT + Math.sin(p.t * 2.1) * 0.08, 0);
      p.holo.rotation.y += dt * 1.3;
      if (p.halo) p.halo.rotation.z += dt * 1.8;
      if (p.halo2) p.halo2.rotation.z -= dt * 2.6;
      const pulse = 1.1 + Math.sin(p.t * 3) * 0.06;
      p.ring.scaling.set(pulse, 1, pulse);
      // Expiring soon: blink at 3 Hz.
      p.holo.setEnabled(!p.expiring || Math.sin(p.t * 19) > -0.4);
    }
  }

  landed(p: Pickup): boolean {
    return p.flightT >= FLIGHT;
  }

  remove(p: Pickup): void {
    const i = this.pickups.indexOf(p);
    if (i >= 0) this.pickups.splice(i, 1);
    p.root.dispose(false, false);
  }

  /** Apply the lifetime rule after `clearedWave` was cleared. Returns the expired pickups. */
  expire(clearedWave: number): Pickup[] {
    const gone = this.pickups.filter((p) => isExpired(p.droppedWave, clearedWave));
    for (const p of gone) this.remove(p);
    for (const p of this.pickups) p.expiring = isExpired(p.droppedWave, clearedWave + 1);
    return gone;
  }

  clear(): void {
    for (const p of [...this.pickups]) this.remove(p);
  }

  /** Rarity colour for UI/effects. */
  static color(r: RarityId): Color3 {
    const g = rarity(r).glow;
    return new Color3(g[0], g[1], g[2]);
  }

  /** Visible pickups near a point (UI labels / radar). */
  near(pos: Vector3, range: number): Pickup[] {
    const r2 = range * range;
    return this.pickups.filter((p) => Vector3.DistanceSquared(this.tmp.copyFrom(p.ground), pos) < r2);
  }
}
