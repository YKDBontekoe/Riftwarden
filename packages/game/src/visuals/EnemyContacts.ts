import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { PhysicsRaycastResult } from '@babylonjs/core/Physics/physicsRaycastResult';
import type { PhysicsEngine as PhysicsEngineV2 } from '@babylonjs/core/Physics/v2/physicsEngine';
import type { Scene } from '@babylonjs/core/scene';
import { ENV_QUERY } from '../world/physicsGroups';
import { contactShadow } from './grounding';

interface ContactActor {
  readonly alive: boolean;
  readonly hidden: boolean;
  readonly pos: Vector3;
  readonly def: { radius: number; bodyY: number };
}

/** Grounding for the shadows-off preset. Pooled GPU instances share one mesh and material. */
export function enemyContacts(scene: Scene, actors: { readonly active: readonly ContactActor[] }, eye: Vector3): void {
  if (scene.getEngine() instanceof NullEngine) return;
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2 | null;
  if (!physics) return;
  const source = contactShadow(scene, 0, 0, 1, 1);
  source.name = 'enemyContactSource';
  source.isVisible = false;
  const slots: InstancedMesh[] = [];
  const ray = new PhysicsRaycastResult();
  const from = new Vector3();
  const to = new Vector3();
  const up = Vector3.Up();
  scene.onBeforeRenderObservable.add(() => {
    let used = 0;
    for (const e of actors.active) {
      if (!e.alive || e.hidden || Vector3.DistanceSquared(e.pos, eye) > 70 * 70) continue;
      from.set(e.pos.x, e.pos.y + Math.max(0.5, e.def.bodyY), e.pos.z);
      to.set(from.x, e.pos.y - 12, from.z);
      physics.raycastToRef(from, to, ray, ENV_QUERY);
      if (!ray.hasHit || ray.hitNormalWorld.y < 0.55) continue;
      let mesh = slots[used];
      if (!mesh) {
        if (slots.length >= 64) break;
        mesh = source.createInstance('enemyContact');
        mesh.isPickable = false;
        mesh.rotationQuaternion = Quaternion.Identity();
        slots.push(mesh);
      }
      mesh.position.copyFrom(ray.hitPointWorld).addInPlaceFromFloats(0, 0.018, 0);
      Quaternion.FromUnitVectorsToRef(up, ray.hitNormalWorld, mesh.rotationQuaternion!);
      const diameter = Math.max(1.4, e.def.radius * 3);
      mesh.scaling.set(diameter, 1, diameter);
      mesh.isVisible = true;
      mesh.setEnabled(true);
      used++;
    }
    for (let i = used; i < slots.length; i++) slots[i].setEnabled(false);
  });
}
