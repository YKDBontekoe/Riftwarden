import { type AssetContainer } from '@babylonjs/core/assetContainer';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import { type AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { type PropPlacement, type PropSpecies } from '@riftwarden/rules/world/propCatalog';

/**
 * Scanned CC0 props (Poly Haven, see assets/cc0/manifest.json). Visual only: never pickable, no physics body, so
 * placement, navigation, line of sight and hit tests are exactly what they were without them. One container per
 * species and scene, instanced per placement (one draw call per part and species); loaded on first use, so a
 * scene without props downloads nothing.
 */
const URLS: Record<PropSpecies, string> = {
  'barrel-red': new URL('../assets/cc0/models/barrel-red.glb', import.meta.url).href,
  'barrel-steel': new URL('../assets/cc0/models/barrel-steel.glb', import.meta.url).href,
  'crate-military': new URL('../assets/cc0/models/crate-military.glb', import.meta.url).href,
  'crate-plastic': new URL('../assets/cc0/models/crate-plastic.glb', import.meta.url).href,
  jerrycan: new URL('../assets/cc0/models/jerrycan.glb', import.meta.url).href,
  'propane-tank': new URL('../assets/cc0/models/propane-tank.glb', import.meta.url).href,
  'lpg-tank': new URL('../assets/cc0/models/lpg-tank.glb', import.meta.url).href,
  'utility-box': new URL('../assets/cc0/models/utility-box.glb', import.meta.url).href,
  'utility-box-tall': new URL('../assets/cc0/models/utility-box-tall.glb', import.meta.url).href,
  'aircon-unit': new URL('../assets/cc0/models/aircon-unit.glb', import.meta.url).href,
  generator: new URL('../assets/cc0/models/generator.glb', import.meta.url).href,
  tyre: new URL('../assets/cc0/models/tyre.glb', import.meta.url).href,
  shelves: new URL('../assets/cc0/models/shelves.glb', import.meta.url).href,
  'tool-chest': new URL('../assets/cc0/models/tool-chest.glb', import.meta.url).href,
  toolbox: new URL('../assets/cc0/models/toolbox.glb', import.meta.url).href,
  'welding-cart': new URL('../assets/cc0/models/welding-cart.glb', import.meta.url).href,
  'cardboard-box': new URL('../assets/cc0/models/cardboard-box.glb', import.meta.url).href,
  extinguisher: new URL('../assets/cc0/models/extinguisher.glb', import.meta.url).href,
  'oil-tin': new URL('../assets/cc0/models/oil-tin.glb', import.meta.url).href,
  airduct: new URL('../assets/cc0/models/airduct.glb', import.meta.url).href,
  pipes: new URL('../assets/cc0/models/pipes.glb', import.meta.url).href,
  'street-lamp': new URL('../assets/cc0/models/street-lamp.glb', import.meta.url).href,
  'security-light': new URL('../assets/cc0/models/security-light.glb', import.meta.url).href,
  'road-barrier': new URL('../assets/cc0/models/road-barrier.glb', import.meta.url).href,
  'covered-car': new URL('../assets/cc0/models/covered-car.glb', import.meta.url).href,
  'fire-barrel': new URL('../assets/cc0/models/fire-barrel.glb', import.meta.url).href,
  'wheel-rim': new URL('../assets/cc0/models/wheel-rim.glb', import.meta.url).href,
  searchlight: new URL('../assets/cc0/models/searchlight.glb', import.meta.url).href,
  'trash-can': new URL('../assets/cc0/models/trash-can.glb', import.meta.url).href,
};

/** How a scene lights its props (set once by the arena / HQ before placing any). */
export interface PropLook {
  /** `maxSimultaneousLights` of the scene's lit materials. */
  lights: number;
  /** IBL strength matching the scene palette (arena 0.89, HQ 1.15). */
  environment: number;
  /** Multiplies albedo: the scans are daylight-exposed, the storm-dusk arena reads them a little dark. */
  albedo?: number;
}

interface Library {
  look: PropLook;
  containers: Map<PropSpecies, Promise<{ container: AssetContainer; offset: Vector3 }>>;
  casters: AbstractMesh[];
  sink: ((m: AbstractMesh) => void) | null;
  placed: number;
}
const libraries = new WeakMap<Scene, Library>();

/** Configure prop lighting for a scene. Call before `placeProps` (later placements use the new look). */
export function configureProps(scene: Scene, look: PropLook): void {
  const lib = libraries.get(scene);
  if (lib) lib.look = look;
  else libraries.set(scene, { look, containers: new Map(), casters: [], sink: null, placed: 0 });
}

/** Shadow hook: props loaded before the sun's shadow generator exists are queued and handed over here. */
export function setPropShadowSink(scene: Scene, sink: (m: AbstractMesh) => void): void {
  const lib = library(scene);
  lib.sink = sink;
  for (const m of lib.casters.splice(0)) sink(m);
}

/** Number of prop instances placed in a scene (test hook and budget readout). */
export function propCount(scene: Scene): number {
  return libraries.get(scene)?.placed ?? 0;
}

function library(scene: Scene): Library {
  let lib = libraries.get(scene);
  if (!lib) libraries.set(scene, lib = { look: { lights: 8, environment: 1 }, containers: new Map(), casters: [], sink: null, placed: 0 });
  return lib;
}

function load(scene: Scene, lib: Library, species: PropSpecies) {
  let source = lib.containers.get(species);
  if (source) return source;
  const look = lib.look;
  // The glTF loader (~200 KB) is only needed for scanned assets: loaded on first use, not with the app.
  source = Promise.all([import('@babylonjs/loaders/glTF/2.0/glTFLoader'), import('@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp')])
    .then(() => LoadAssetContainerAsync(URLS[species], scene, { pluginExtension: '.glb' }))
    .then((container) => {
      for (const m of container.materials) if (m instanceof PBRMaterial) {
        m.usePhysicalLightFalloff = false;
        m.maxSimultaneousLights = look.lights;
        m.environmentIntensity = look.environment;
        if (look.albedo) m.albedoColor.scaleInPlace(look.albedo);
      }
      // Normalise the pivot: footprint centre on the ground, whatever the scan's own origin is.
      let min = new Vector3(Infinity, Infinity, Infinity);
      let max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const mesh of container.meshes) {
        if (!mesh.getTotalVertices()) continue;
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        min = Vector3.Minimize(min, box.minimumWorld);
        max = Vector3.Maximize(max, box.maximumWorld);
      }
      const offset = Number.isFinite(min.y) ? new Vector3(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2) : Vector3.Zero();
      return { container, offset };
    });
  lib.containers.set(species, source);
  return source;
}

/**
 * Place props under `parent`. Returns immediately; instances appear when their model has loaded. Skipped on the
 * headless engine (co-op server, unit tests), which has no use for them and no fetch for the files.
 */
export function placeProps(parent: TransformNode, placements: readonly PropPlacement[], opts: { shadows?: boolean } = {}): void {
  const scene = parent.getScene();
  if (scene.getEngine() instanceof NullEngine || !placements.length) return;
  const lib = library(scene);
  const bySpecies = new Map<PropSpecies, PropPlacement[]>();
  for (const p of placements) {
    const list = bySpecies.get(p.species);
    if (list) list.push(p);
    else bySpecies.set(p.species, [p]);
  }
  for (const [species, list] of bySpecies) {
    void load(scene, lib, species).then(({ container, offset }) => {
      if (scene.isDisposed || parent.isDisposed()) return;
      for (const p of list) {
        const holder = new TransformNode(`prop:${species}`, scene);
        holder.parent = parent;
        holder.position.set(p.x, p.y, p.z);
        holder.rotation.y = p.yaw;
        holder.scaling.setAll(p.scale);
        const instance = container.instantiateModelsToScene((name) => `prop:${species}:${name}`, false, { doNotInstantiate: false });
        for (const node of instance.rootNodes) {
          if (!(node instanceof TransformNode)) continue;
          node.parent = holder;
          // The glTF root carries the handedness conversion; shift it so the pivot sits on the footprint centre.
          node.position.addInPlace(offset);
        }
        holder.computeWorldMatrix(true);
        for (const part of holder.getChildMeshes()) {
          part.isPickable = false;
          part.receiveShadows = true;
          part.computeWorldMatrix(true);
          part.freezeWorldMatrix();
          if (opts.shadows !== false) {
            if (lib.sink) lib.sink(part);
            else lib.casters.push(part);
          }
        }
        lib.placed++;
      }
    }).catch((error: unknown) => {
      if (!scene.isDisposed) console.warn('Prop asset unavailable', species, error);
    });
  }
}

/**
 * Is a floor footprint (centre, half extents in x / z) free of existing geometry up to `top` m? Casts a 3x3 grid
 * of downward rays (whatever their pickability, other props excluded) and reports blocked when any lands above
 * the floor. For one-off layout decisions at build time, never per frame.
 */
export function footprintClear(scene: Scene, x: number, z: number, hx: number, hz: number, top = 2.6, floor = 0): boolean {
  const ray = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), top + 0.5);
  const solid = (m: AbstractMesh) => m.isEnabled() && m.isVisible && m.visibility > 0 && !m.name.startsWith('prop:') && m.getTotalVertices() > 0;
  for (const fx of [-1, 0, 1]) for (const fz of [-1, 0, 1]) {
    ray.origin.set(x + fx * hx, floor + top, z + fz * hz);
    const hit = scene.pickWithRay(ray, solid);
    if (hit?.hit && hit.pickedPoint && hit.pickedPoint.y > floor + 0.05) return false;
  }
  return true;
}
