import { type Material } from '@babylonjs/core/Materials/material';
import { type PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { type Scene } from '@babylonjs/core/scene';
import type { CurrencyKey } from '@riftwarden/rules/economy/currencies';
import { baseDef } from '@riftwarden/rules/loot/bases';
import { rarity, type RarityId } from '@riftwarden/rules/loot/rarity';
import type { Category, ItemInstance } from '@riftwarden/rules/loot/types';
import { defaultBuild, type WeaponBuild } from '@riftwarden/rules/weapons/build';
import { moduleTypeDef } from '@riftwarden/rules/weapons/modules';
import { Assembler, buildWeaponModel, type V3 } from '../weapons/model';
import { weaponGlow, weaponMaterials } from '../weapons/materials';
import { freshMaterial } from '../visuals/freshMaterial';
import { ACCENT, crateSculpt, CURRENCY_ACCENT, CURRENCY_SCULPTS, ITEM_SCULPTS, moduleSculpt, type Sculptor } from './itemShapes';

/**
 * 3D item models shared by arena pickups, terminal thumbnails and the item inspection stage.
 * Weapons reuse the procedural weapon builder (a stock build of the chassis, or the item's
 * own rolled build when `detailed`); every other base has a hand-made sculpt (itemShapes.ts).
 * A model is merged into one mesh per material, centred and scaled so its longest side is
 * `size` metres. `rimHull` adds an inverted-hull outline (rarity rim glow).
 */
export interface ItemLook {
  defId: string;
  category: Category;
  rarity: RarityId;
  build?: WeaponBuild;
  socketed?: (ItemInstance | null)[];
  element?: string;
  uniqueId?: string;
}

export interface ItemModel {
  /** Scaled root (scaling = size / longest side). Meshes are its direct children, centred. */
  root: TransformNode;
  meshes: Mesh[];
  /** Model-space extents (before the root scale). */
  extent: Vector3;
  scale: number;
  dispose(): void;
}

export interface ModelBuildOpts {
  /** Longest side in metres after scaling (default 1). */
  size?: number;
  /** Weapons: show the item's own rolled build, modules, element and unique hardware. */
  detailed?: boolean;
  /** Use the arena finish on weapon shells. */
  pickup?: boolean;
  name?: string;
}

export function lookOf(item: Pick<ItemInstance, 'defId' | 'category' | 'rarity' | 'build' | 'socketed' | 'weapon' | 'uniqueId'>): ItemLook {
  return { defId: item.defId, category: item.category, rarity: item.rarity, build: item.build, socketed: item.socketed, element: item.weapon?.element, uniqueId: item.uniqueId };
}

/** Cache key of a model: stock look per base + rarity, or the full weapon look when detailed. */
export function lookKey(look: ItemLook, detailed = false): string {
  if (look.category === 'weapon' && detailed && look.build) {
    return JSON.stringify([look.defId, look.rarity, look.build, (look.socketed ?? []).map((m) => m?.defId ?? null), look.element ?? null, look.uniqueId ?? null]);
  }
  return `${look.defId}|${look.category === 'weapon' ? 'stock' : look.rarity}`;
}

const CATEGORY_PAINT: Record<Exclude<Category, 'weapon'>, string> = {
  armor: '#646b62', shield: '#c7cbb9', reactor: '#407c84', processor: '#56746c',
  accessory: '#94a2a8', module: '#565f82', ability: '#9c8758', ultimate: '#a95c39',
};
const BASE_PAINT: Partial<Record<string, string>> = {
  composite_armor: '#798d99', bulwark_plating: '#87765b', colossus_plating: '#774b36',
  barrier_lattice: '#7ba6a2', fusion_cell: '#b79150', overseer_logic: '#776588',
  tactical_processor: '#7a8d80', field_uplink: '#a49673', targeting_lens: '#687584',
  frag_charge: '#9f6743', cryo_charge: '#8eb1c0', arc_pulse: '#627fa6', blink_drive: '#837490',
  aegis_cell: '#bb9b56', shield_wall: '#789cad', holo_decoy: '#6e9890', mini_sentry: '#99896c',
  overdrive_core: '#9f5439', siege_module: '#865641', prism_module: '#886477',
};
const BOSS_BASES = new Set(['colossus_plating', 'overseer_logic', 'siege_module', 'prism_module']);
const HEAVY_MODULES = new Set(['siege_module', 'prism_module']);

/** Sculpt builder for a non-weapon base (null: unknown base -> crate). */
export function sculptFor(defId: string): ((s: Sculptor) => void) | null {
  const direct = ITEM_SCULPTS[defId];
  if (direct) return direct;
  const mod = baseDef(defId)?.module;
  if (mod) return moduleSculpt(moduleTypeDef(mod.type)?.visual ?? 'chip', HEAVY_MODULES.has(defId));
  return null;
}

/** Arena pickups share accent glows per scene: a new PBR material mid-fight costs a scan of every mesh in the scene. */
const sharedGlows = new WeakMap<Scene, Map<string, PBRMaterial>>();
function sharedGlow(scene: Scene, c: V3): PBRMaterial {
  let byColor = sharedGlows.get(scene);
  if (!byColor) sharedGlows.set(scene, (byColor = new Map()));
  const key = c.join(',');
  let m = byColor.get(key);
  if (!m) byColor.set(key, (m = weaponGlow(scene, `itemGlow_${key}`, c)));
  return m;
}

function sculpted(scene: Scene, name: string, build: (s: Sculptor) => void, accent: V3, materials: Pick<Sculptor, 'M' | 'shell' | 'dark' | 'trim'>, shared = false) {
  const root = new TransformNode(`${name}Src`, scene);
  const a = new Assembler(scene, root, { name });
  const dimC: V3 = [accent[0] * 0.18, accent[1] * 0.18, accent[2] * 0.18];
  const glow = shared ? sharedGlow(scene, accent) : weaponGlow(scene, `${name}Glow`, accent);
  const dim = shared ? sharedGlow(scene, dimC) : weaponGlow(scene, `${name}Dim`, dimC);
  build({ a, root, glow, dim, ...materials });
  a.finalize();
  return { root, meshes: a.meshes, owned: (shared ? [] : [glow, dim]) as Material[] };
}

/** Bake a hierarchy into one mesh per material under `into` (world transforms applied). */
function flatten(meshes: Mesh[], into: TransformNode, name: string): Mesh[] {
  const groups = new Map<Material, Mesh[]>();
  for (const m of meshes) {
    if (!m.material || !m.getTotalVertices()) continue;
    m.computeWorldMatrix(true);
    const g = groups.get(m.material) ?? [];
    g.push(m);
    groups.set(m.material, g);
  }
  const out: Mesh[] = [];
  for (const [mat, group] of groups) {
    const merged = Mesh.MergeMeshes(group, false, true, undefined, false, false);
    if (!merged) continue;
    merged.name = `${name}_${mat.name}`;
    merged.material = mat;
    merged.parent = into;
    merged.isPickable = false;
    out.push(merged);
  }
  return out;
}

export function buildItemModel(scene: Scene, look: ItemLook, opts: ModelBuildOpts = {}): ItemModel {
  const name = opts.name ?? 'item';
  const r = rarity(look.rarity);
  let src: { root: TransformNode; meshes: Mesh[]; owned: Material[] };
  if (look.category === 'weapon') {
    const family = baseDef(look.defId)?.weapon?.family ?? 'plasma';
    const detailed = !!opts.detailed && !!look.build;
    const build = detailed ? look.build! : defaultBuild(look.defId, family);
    const rig = buildWeaponModel(scene, build, detailed ? (look.socketed ?? []) : [], {
      name, mount: false, pickup: opts.pickup,
      element: detailed ? look.element : undefined, uniqueId: detailed ? look.uniqueId : undefined,
    }, detailed ? r.index : 0);
    // Pickup rigs share their glow/heat materials per scene (buildWeaponModel): never dispose those with one model.
    src = { root: rig.root, meshes: rig.meshes, owned: opts.pickup ? [] : [rig.energy, rig.chargeGlow, rig.heat, rig.ledOn, rig.ledHot, rig.ledOff] };
  } else {
    const fn = sculptFor(look.defId) ?? crateSculpt;
    const paint = BASE_PAINT[look.defId] ?? CATEGORY_PAINT[look.category];
    const M = weaponMaterials(scene);
    src = sculpted(scene, name, fn, ACCENT[look.defId] ?? [1.6, 1.6, 1.8], {
      M, shell: M.equipmentPaint(paint), dark: BOSS_BASES.has(look.defId) ? M.graphite : M.dark, trim: M.satin,
    }, !!opts.pickup);
  }
  return finish(scene, src, name, opts.size ?? 1);
}

export function buildCurrencyModel(scene: Scene, key: CurrencyKey, opts: ModelBuildOpts = {}): ItemModel {
  const name = opts.name ?? `cur_${key}`;
  const M = weaponMaterials(scene);
  const currencyFinish = key === 'credits' ? 'slate' : 'gunmetal';
  const src = sculpted(scene, name, CURRENCY_SCULPTS[key] ?? crateSculpt, CURRENCY_ACCENT[key] ?? [1.6, 1.6, 1.8], {
    M, shell: M.shell(currencyFinish), dark: M.dark, trim: M.trim(currencyFinish),
  });
  return finish(scene, src, name, opts.size ?? 1);
}

function finish(scene: Scene, src: { root: TransformNode; meshes: Mesh[]; owned: Material[] }, name: string, size: number): ItemModel {
  const root = new TransformNode(`${name}Model`, scene);
  const meshes = flatten(src.meshes, root, name);
  src.root.dispose(false, false);
  // Centre on the bounding box and scale the longest side to `size`.
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of meshes) {
    const b = m.getBoundingInfo().boundingBox;
    min.minimizeInPlace(b.minimum);
    max.maximizeInPlace(b.maximum);
  }
  if (!meshes.length) {
    min.setAll(-0.5);
    max.setAll(0.5);
  }
  const centre = min.add(max).scaleInPlace(0.5);
  for (const m of meshes) {
    m.bakeTransformIntoVertices(Matrix.Translation(-centre.x, -centre.y, -centre.z));
    m.refreshBoundingInfo();
  }
  const extent = max.subtract(min);
  const scale = size / Math.max(1e-3, extent.x, extent.y, extent.z);
  root.scaling.setAll(scale);
  const owned = src.owned;
  return {
    root,
    meshes,
    extent,
    scale,
    dispose() {
      root.dispose(false, false);
      // Textures belong to the per-scene weapon library (see buildWeaponModel's dispose).
      for (const m of owned) m.dispose(true, false);
    },
  };
}

/**
 * Inverted-hull rim: every vertex is pushed out along its welded (position-averaged)
 * normal by `width` (model units) and only back faces are drawn, so the model gets a
 * continuous outline of `mat` even across hard edges. One mesh for the whole model.
 */
export function rimHull(scene: Scene, model: ItemModel, mat: PBRMaterial, widthMetres = 0.02, name = 'rim'): Mesh {
  const width = widthMetres / model.scale;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const m of model.meshes) {
    if (m.material && m.material.alpha < 1) continue;
    const p = m.getVerticesData(VertexBuffer.PositionKind);
    const n = m.getVerticesData(VertexBuffer.NormalKind);
    const idx = m.getIndices();
    if (!p || !n || !idx) continue;
    const base = positions.length / 3;
    for (let i = 0; i < p.length; i++) positions.push(p[i]);
    for (let i = 0; i < n.length; i++) normals.push(n[i]);
    for (let i = 0; i < idx.length; i++) indices.push(idx[i] + base);
  }
  const welded = weldNormals(positions, normals);
  for (let i = 0; i < positions.length; i++) positions[i] += welded[i] * width;
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = welded;
  vd.indices = indices;
  const hull = new Mesh(name, scene);
  vd.applyToMesh(hull);
  hull.parent = model.root;
  hull.material = mat;
  hull.isPickable = false;
  return hull;
}

/** Average normals over vertices sharing a position (pure; exported for tests). */
export function weldNormals(positions: ArrayLike<number>, normals: ArrayLike<number>, eps = 1e-4): number[] {
  const key = (i: number) => `${Math.round(positions[i] / eps)},${Math.round(positions[i + 1] / eps)},${Math.round(positions[i + 2] / eps)}`;
  const sums = new Map<string, [number, number, number]>();
  for (let i = 0; i < positions.length; i += 3) {
    const k = key(i);
    const s = sums.get(k) ?? [0, 0, 0];
    s[0] += normals[i];
    s[1] += normals[i + 1];
    s[2] += normals[i + 2];
    sums.set(k, s);
  }
  const out: number[] = new Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const s = sums.get(key(i))!;
    const l = Math.hypot(s[0], s[1], s[2]);
    const [x, y, z] = l > 1e-6 ? [s[0] / l, s[1] / l, s[2] / l] : [normals[i], normals[i + 1], normals[i + 2]];
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = z;
  }
  return out;
}

/** Rim material (rarity colour, unlit HDR, front faces culled). */
export function rimMaterial(scene: Scene, id: RarityId, gain = 1.25): PBRMaterial {
  const g = rarity(id).glow;
  // Commons get a faint rim: the outline should signal value, not add noise to every scrap drop.
  if (rarity(id).index === 0) gain *= 0.35;
  return freshMaterial(() => {
    const m = weaponGlow(scene, `rim_${id}`, [g[0] * gain, g[1] * gain, g[2] * gain]);
    m.backFaceCulling = true;
    m.cullBackFaces = false;
    return m;
  });
}
