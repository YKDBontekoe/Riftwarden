// metadataPicker: Babylon's own picking over only the metadata-tagged meshes must equal scene picking for any
// predicate that requires metadata (nearest hit, tie order, instances, disabled meshes, adds/removes between picks).
import '../apps/worker/src/sim/headless';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { metadataPicker } from '@riftwarden/game/world/pickCandidates';

let engine: NullEngine;
let scene: Scene;
beforeAll(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterAll(() => {
  scene.dispose();
  engine.dispose();
});

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const surface = (m: AbstractMesh) => !!m.metadata?.surface && m.isEnabled();
const target = (m: AbstractMesh) => (!!m.metadata?.surface || !!m.metadata?.enemy) && m.isEnabled();
const view = (p: { hit: boolean; pickedMesh: AbstractMesh | null; distance: number; faceId: number } | null) => (p?.hit ? [p.pickedMesh!.uniqueId, p.distance, p.faceId] : null);

describe('metadata picker', () => {
  it('equals scene picking while meshes come and go', () => {
    const r = rng(42);
    const spawned: AbstractMesh[] = [];
    const spawn = (i: number) => {
      const box = MeshBuilder.CreateBox(`b${i}`, { size: 0.5 + r() * 3 }, scene);
      box.position.set((r() - 0.5) * 60, r() * 6, (r() - 0.5) * 60);
      const kind = i % 4;
      if (kind === 0) box.metadata = { surface: 'wall' };
      else if (kind === 1) box.metadata = { enemy: { id: i } };
      else if (kind === 2) box.metadata = { other: true };
      // Instances of a tagged source, some disabled.
      if (i % 5 === 0 && box.metadata) {
        const inst = box.createInstance(`i${i}`);
        inst.position.set((r() - 0.5) * 60, r() * 6, (r() - 0.5) * 60);
        inst.metadata = box.metadata;
        spawned.push(inst);
      }
      if (i % 7 === 0) box.setEnabled(false);
      spawned.push(box);
    };
    for (let i = 0; i < 200; i++) spawn(i);
    const picker = metadataPicker(scene);
    for (let round = 0; round < 6; round++) {
      for (let k = 0; k < 150; k++) {
        const o = new Vector3((r() - 0.5) * 70, r() * 8, (r() - 0.5) * 70);
        const d = new Vector3(r() - 0.5, (r() - 0.5) * 0.3, r() - 0.5).normalize();
        const ray = new Ray(o, d, 80);
        expect(view(picker.pickWithRay(ray, surface))).toEqual(view(scene.pickWithRay(ray, surface)));
        expect(view(picker.pickWithRay(ray, target))).toEqual(view(scene.pickWithRay(ray, target)));
        expect(picker.pickWithRay(ray, surface, true)?.hit ?? false).toBe(scene.pickWithRay(ray, surface, true)?.hit ?? false);
        const a = (scene.multiPickWithRay(ray, target) ?? []).map(view);
        const b = (picker.multiPickWithRay(ray, target) ?? []).map(view);
        expect(b).toEqual(a);
      }
      // Churn: remove some, add some (metadata assigned at creation, as the game does).
      for (const m of spawned.splice(0, 25)) m.dispose();
      for (let i = 0; i < 25; i++) spawn(1000 + round * 100 + i);
    }
    expect(picker.size).toBeLessThan(scene.meshes.length);
  });

  it('sees a mesh created in the same tick (Babylon announces new meshes asynchronously)', () => {
    const picker = metadataPicker(scene);
    const ray = new Ray(new Vector3(500, 1, 480), new Vector3(0, 0, 1), 100);
    expect(picker.pickWithRay(ray, surface)?.hit ?? false).toBe(false);
    const wall = MeshBuilder.CreateBox('late', { width: 10, height: 10, depth: 1 }, scene);
    wall.position.set(500, 1, 500);
    wall.metadata = { surface: 'wall' };
    wall.computeWorldMatrix(true);
    expect(scene.pickWithRay(ray, surface)?.pickedMesh).toBe(wall);
    expect(picker.pickWithRay(ray, surface)?.pickedMesh).toBe(wall);
  });
});
