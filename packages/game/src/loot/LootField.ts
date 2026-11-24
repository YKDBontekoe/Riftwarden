import { type PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { type Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { type Texture } from '@babylonjs/core/Materials/Textures/texture';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { type AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { type Scene } from '@babylonjs/core/scene';
import type { Kit } from '../visuals/kit';
import { type Palette, unlit } from '../visuals/materials';
import { flareSprite } from '../visuals/textures';
import { buildItemModel, type ItemModel, lookKey, lookOf, rimHull, rimMaterial } from './itemModels';
import { RARITIES, type RarityId, rarity } from '@riftwarden/rules/loot/rarity';
import type { ItemInstance } from '@riftwarden/rules/loot/types';

/**
 * Physical loot in the arena. Lifetime and saturation rules live in lifetime.ts (pure).
 * Rendering: each drop shows its item's real 3D model (itemModels.ts) with a rarity rim.
 * Models are GPU instances of one template per (base, rarity); only rare+ weapons build
 * their own rolled model (barrel, attachments, finish, element) as per-drop meshes.
 * Epic+ drops add a small motes particle system.
 */
export { convertsToSalvage, expiresAfterWave, HARD_LIMIT, HOLO_HEIGHT, isExpired, LOOT_LIFETIME_WAVES, LOW_GRADE_LIMIT, PICKUP_RANGE } from '@riftwarden/rules/loot/lifetime';
import { HOLO_HEIGHT, isExpired } from '@riftwarden/rules/loot/lifetime';

const FLIGHT = 0.6;
/** Rarity rim thickness (metres). */
const RIM_WIDTH = 0.009;
/** Height where the rarity beam starts (above the hovering model). */
const BEAM_BASE = 1.45;

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
  /** Spinning model node (instances of a template, or an owned detailed model). */
  model: TransformNode;
  /** Owned per-drop model (rare+ weapons) and epic+ motes; disposed with the pickup. */
  own: ItemModel | null;
  motes: ParticleSystem | null;
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
  private templates = new Map<string, { model: ItemModel; rims: Map<RarityId, Mesh> }>();
  private rims = new Map<RarityId, PBRMaterial>();
  private moteTex: Texture | null = null;
  /** Detailed models built (tests). */
  detailedBuilds = 0;
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
    // Item models: warm a representative template per material family (weapon kit, painted
    // shell, glass, accent glow) and every rarity rim, instanced.
    for (const [defId, category] of [['plasma_repeater', 'weapon'], ['shield_matrix', 'shield'], ['frag_charge', 'ability']] as const) {
      const t = this.template({ defId, category, rarity: 'common' });
      for (const m of t.model.meshes) if (m.material) jobs.push(m.material.forceCompilationAsync(m, { useInstances: true }).catch(() => {}));
      if (defId === 'plasma_repeater') {
        for (const r of RARITIES) {
          const hull = this.rimOf(t, r.id);
          jobs.push(hull.material!.forceCompilationAsync(hull, { useInstances: true }).catch(() => {}));
        }
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
    const { model, own } = this.placeModel(item, holo);
    const k = this.kit;
    const ring = k.part('torusThin', glow, root, { pos: [0, 0.05, 0], scale: [1.15, 1, 1.15], shadow: false });
    k.part('cyl', this.P.graphite, root, { pos: [0, 0.03, 0], scale: [0.7, 0.05, 0.7], shadow: false });
    let halo: AbstractMesh | null = null;
    if (r.index >= 3) halo = k.part('torusThin', glow, holo, { scale: [1.15, 1, 1.15], rot: [0.22, 0, 0], shadow: false });
    if (r.index >= 3 || item.uniqueId) for (const i of [0, 1, 2, 3]) {
      const turn = Math.PI * i / 2 + Math.PI / 4;
      const radius = item.uniqueId ? 0.8 : 0.66;
      k.part('box', glow, root, { pos: [Math.sin(turn) * radius, 0.06, Math.cos(turn) * radius], rot: [0, turn, 0], scale: [0.29, 0.025, 0.065], shadow: false });
    }
    let halo2: AbstractMesh | null = null;
    if (r.id === 'ascended') {
      halo2 = k.part('torusThin', glow, holo, { scale: [1.3, 1, 1.3], rot: [-0.3, 0, 0.35], shadow: false });
      k.part('torusThin', glow, root, { pos: [0, 0.04, 0], scale: [1.9, 1, 1.9], shadow: false });
    }
    if (r.beam > 0) {
      const width = 0.1 + r.index * 0.02;
      // The beam rises from above the model so it never hides it.
      k.part('cyl', this.beam.get(r.id)!, root, { pos: [0, BEAM_BASE + r.beam / 2, 0], scale: [width, r.beam, width], shadow: false });
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
      model,
      own,
      motes: r.index >= 3 ? this.motes(ground, r.id, r.index) : null,
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

  /** Longest side of a dropped model (metres). */
  static sizeFor(category: string): number {
    return category === 'weapon' ? 1.15 : category === 'armor' || category === 'ultimate' ? 0.82 : 0.72;
  }

  /** Shared instanced template per (base, rarity); its meshes stay hidden below the arena. */
  private template(look: Parameters<typeof lookKey>[0]) {
    const key = lookKey(look);
    let t = this.templates.get(key);
    if (!t) {
      const model = buildItemModel(this.scene, look, { size: LootField.sizeFor(look.category), name: `lootTpl${this.templates.size}` });
      model.root.position.y = -500;
      for (const m of model.meshes) {
        m.isVisible = false;
        m.alwaysSelectAsActiveMesh = false;
      }
      t = { model, rims: new Map() };
      this.templates.set(key, t);
    }
    return t;
  }

  private rimMat(id: RarityId): PBRMaterial {
    let m = this.rims.get(id);
    if (!m) {
      m = rimMaterial(this.scene, id);
      this.rims.set(id, m);
    }
    return m;
  }

  private rimOf(t: { model: ItemModel; rims: Map<RarityId, Mesh> }, id: RarityId): Mesh {
    let hull = t.rims.get(id);
    if (!hull) {
      hull = rimHull(this.scene, t.model, this.rimMat(id), RIM_WIDTH, `lootRim_${id}`);
      hull.isVisible = false;
      t.rims.set(id, hull);
    }
    return hull;
  }

  /** The drop's model under `holo`: an owned rolled model for rare+ weapons, else template instances. */
  private placeModel(item: ItemInstance, holo: TransformNode): { model: TransformNode; own: ItemModel | null } {
    const look = lookOf(item);
    const r = rarity(item.rarity);
    const tilt = item.category === 'weapon' ? 0.22 : 0;
    if (item.category === 'weapon' && item.build && r.index >= 2) {
      const own = buildItemModel(this.scene, look, { size: LootField.sizeFor('weapon'), detailed: true, name: `loot${this.nextId}` });
      own.root.parent = holo;
      own.root.rotation.z = tilt;
      rimHull(this.scene, own, this.rimMat(item.rarity), RIM_WIDTH, `lootRim${this.nextId}`);
      this.detailedBuilds++;
      return { model: own.root, own };
    }
    const t = this.template(look);
    const node = new TransformNode('lootModel', this.scene);
    node.parent = holo;
    node.scaling.setAll(t.model.scale);
    node.rotation.z = tilt;
    for (const m of [...t.model.meshes, this.rimOf(t, item.rarity)]) {
      const inst = m.createInstance('lootPart');
      inst.parent = node;
      inst.isPickable = false;
    }
    return { model: node, own: null };
  }

  /** Rising motes around epic+ drops (emitter-positioned: see the particle notes in CLAUDE.md). */
  private motes(at: Vector3, id: RarityId, index: number): ParticleSystem {
    this.moteTex ??= flareSprite(this.scene);
    const g = rarity(id).glow;
    const ps = new ParticleSystem('lootMotes', 48, this.scene);
    ps.particleTexture = this.moteTex;
    ps.emitter = at.clone();
    ps.minEmitBox = new Vector3(-0.55, 0.05, -0.55);
    ps.maxEmitBox = new Vector3(0.55, 0.5, 0.55);
    ps.color1 = new Color4(g[0], g[1], g[2], 1);
    ps.color2 = new Color4(Math.min(1, g[0] * 0.6 + 0.4), Math.min(1, g[1] * 0.6 + 0.4), Math.min(1, g[2] * 0.6 + 0.4), 1);
    ps.colorDead = new Color4(g[0] * 0.3, g[1] * 0.3, g[2] * 0.3, 0);
    ps.minSize = 0.035;
    ps.maxSize = 0.08 + (index - 3) * 0.015;
    ps.minLifeTime = 1.1;
    ps.maxLifeTime = 2.1;
    ps.emitRate = 8 + (index - 3) * 5;
    ps.direction1 = new Vector3(-0.08, 0.5, -0.08);
    ps.direction2 = new Vector3(0.08, 1, 0.08);
    ps.minEmitPower = 0.45;
    ps.maxEmitPower = 0.85;
    ps.gravity = new Vector3(0, 0.15, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    ps.start();
    return ps;
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
      // Tilted rings precess around the model (spinning about z would tip them upright).
      if (p.halo) p.halo.rotation.y += dt * 1.8;
      if (p.halo2) p.halo2.rotation.y -= dt * 2.6;
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
    p.motes?.dispose(false);
    p.root.dispose(false, false);
    p.own?.dispose();
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
