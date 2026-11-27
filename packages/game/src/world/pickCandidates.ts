import { MultiPickWithRay, PickWithRay, type Ray } from '@babylonjs/core/Culling/ray.core';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Nullable } from '@babylonjs/core/types';

type MeshPredicate = (mesh: AbstractMesh, thinInstanceIndex: number) => boolean;

/**
 * Gameplay ray picks (shots, crosshair, LOS cones, build placement) only ever accept meshes tagged through
 * `metadata` (`surface`, `enemy`, `turret`), but `scene.pickWithRay` runs the predicate over every mesh in the scene:
 * 20-27k in a late fight (enemy rigs are ~75 instanced parts each), several times per frame.
 *
 * `metadataPicker(scene)` runs Babylon's own `PickWithRay` / `MultiPickWithRay` over a view of the scene whose
 * `meshes` are only the meshes with metadata, in scene order, so results (nearest hit, tie order, instances, world
 * matrices) are exactly Babylon's for any predicate that rejects meshes without metadata. The list is rebuilt lazily
 * on the next pick after a mesh is added to or removed from the scene.
 *
 * Contract: pick-relevant metadata is assigned when the mesh is created (before the next pick), never later on a
 * mesh that had none. Every current tag is set at creation (arena/HQ shells, reactor, dynamics, turret and enemy
 * hitboxes, expansion floors).
 */
export interface MetadataPicker {
  pickWithRay(ray: Ray, predicate: MeshPredicate, fastCheck?: boolean): Nullable<PickingInfo>;
  multiPickWithRay(ray: Ray, predicate: MeshPredicate): Nullable<PickingInfo[]>;
  /** Current candidate count (diagnostics/tests). */
  readonly size: number;
}

const pickers = new WeakMap<Scene, MetadataPicker>();

export function metadataPicker(scene: Scene): MetadataPicker {
  let picker = pickers.get(scene);
  if (picker) return picker;
  let dirty = true;
  const list: AbstractMesh[] = [];
  // A view that reads everything else (cameras, ray caches) from the real scene.
  const view = Object.create(scene) as Scene & { meshes: AbstractMesh[] };
  Object.defineProperty(view, 'meshes', { value: list, writable: false });
  // Babylon announces new meshes asynchronously (onNewMeshAddedObservable fires on a later tick), but a mesh made this
  // frame can be shot this frame: wrap this scene's own add/remove so the list is marked stale synchronously.
  const add = scene.addMesh;
  const remove = scene.removeMesh;
  scene.addMesh = function (this: Scene, ...args: Parameters<Scene['addMesh']>) {
    dirty = true;
    return add.apply(this, args);
  };
  scene.removeMesh = function (this: Scene, ...args: Parameters<Scene['removeMesh']>) {
    dirty = true;
    return remove.apply(this, args);
  };
  let count = -1;
  const sync = () => {
    // Belt and braces: any direct edit of scene.meshes that changes its length also rebuilds.
    if (!dirty && count === scene.meshes.length) return;
    dirty = false;
    count = scene.meshes.length;
    list.length = 0;
    for (const m of scene.meshes) if (m.metadata != null) list.push(m);
  };
  picker = {
    pickWithRay(ray, predicate, fastCheck) {
      sync();
      return PickWithRay(view, ray, predicate, fastCheck);
    },
    multiPickWithRay(ray, predicate) {
      sync();
      return MultiPickWithRay(view, ray, predicate);
    },
    get size() {
      sync();
      return list.length;
    },
  };
  pickers.set(scene, picker);
  return picker;
}

/**
 * Gameplay scenes use no Babylon pointer events: without these flags every mouse move, press and release picked the
 * whole scene (triangle tests against the level shells) on the input thread.
 */
export function skipPointerPicking(scene: Scene): void {
  scene.skipPointerMovePicking = true;
  scene.skipPointerDownPicking = true;
  scene.skipPointerUpPicking = true;
}
