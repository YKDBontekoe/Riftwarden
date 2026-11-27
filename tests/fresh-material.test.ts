// freshMaterial: skips Babylon's scene-wide "mark users dirty" scan only while new materials are being built.
import '../apps/worker/src/sim/headless';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshMaterial, freshMaterialDepth } from '@riftwarden/game/visuals/freshMaterial';

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

/** Count scene-mesh scans by watching `subMesh.getMaterial` calls (the scan's per-submesh probe). */
function countScans(run: () => void): number {
  let n = 0;
  const meshes = scene.meshes.flatMap((m) => m.subMeshes ?? []);
  const originals = meshes.map((sm) => sm.getMaterial);
  meshes.forEach((sm, i) => {
    sm.getMaterial = (...args: Parameters<typeof sm.getMaterial>) => {
      n++;
      return originals[i].apply(sm, args);
    };
  });
  try {
    run();
  } finally {
    meshes.forEach((sm, i) => (sm.getMaterial = originals[i]));
  }
  return n;
}

describe('freshMaterial', () => {
  it('builds materials without scanning the scene, and restores the scan afterwards', () => {
    for (let i = 0; i < 50; i++) MeshBuilder.CreateBox(`b${i}`, { size: 1 }, scene);
    const plain = countScans(() => {
      const m = new PBRMaterial('plain', scene);
      m.unlit = true;
      m.metallic = 0.2;
    });
    expect(plain).toBeGreaterThan(50);
    let built: PBRMaterial | null = null;
    const scoped = countScans(() => {
      built = freshMaterial(() => {
        const m = new PBRMaterial('fresh', scene);
        m.unlit = true;
        m.metallic = 0.2;
        return m;
      });
    });
    expect(scoped).toBe(0);
    expect(built!.unlit).toBe(true);
    expect(freshMaterialDepth()).toBe(0);
  });

  it('a material in use is still marked dirty outside the scope', () => {
    const box = MeshBuilder.CreateBox('user', { size: 1 }, scene);
    const mat = freshMaterial(() => new PBRMaterial('used', scene));
    box.material = mat;
    // Prepare defines once so there is something to mark.
    mat.isReadyForSubMesh(box, box.subMeshes[0]);
    const defines = box.subMeshes[0].materialDefines as unknown as { isDirty: boolean; markAsProcessed(): void } | null;
    defines?.markAsProcessed();
    mat.metallic = 0.7;
    expect(defines?.isDirty).toBe(true);
  });

  it('the scope closes even when the builder throws', () => {
    expect(() => freshMaterial(() => {
      throw new Error('boom');
    })).toThrow('boom');
    expect(freshMaterialDepth()).toBe(0);
  });
});
