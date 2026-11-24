// Run-map hub station rigs build headlessly (the co-op sim worker builds them too), animate, dim when used,
// stay on their deck and leave nothing behind when disposed.
import '../apps/worker/src/sim/headless';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kit } from '@riftwarden/game/visuals/kit';
import { createPalette } from '@riftwarden/game/visuals/materials';
import { buildStation, type StationKind } from '@riftwarden/game/visuals/nodeProps';

const KINDS: StationKind[] = ['merchant', 'forge', 'rest', 'event', 'vault', 'exit'];

describe('hub station rigs', () => {
  let engine: NullEngine;
  let scene: Scene;
  let kit: Kit;
  let pal: ReturnType<typeof createPalette>;
  beforeAll(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    kit = new Kit(scene);
    pal = createPalette(scene, false);
  });
  afterAll(() => engine.dispose());

  it('every kind builds a detailed rig within its deck, animates and dims when used', () => {
    for (const kind of KINDS) {
      const rig = buildStation(scene, kit, pal, kind);
      const meshes = rig.root.getChildMeshes(false);
      expect(meshes.length, kind).toBeGreaterThan(20);
      expect(rig.glow.length, kind).toBeGreaterThan(5);
      rig.root.computeWorldMatrix(true);
      for (const m of meshes) m.computeWorldMatrix(true);
      const { min, max } = rig.root.getHierarchyBoundingVectors(true);
      expect(Math.max(-min.x, max.x, -min.z, max.z), kind).toBeLessThan(2.6);
      expect(max.y, kind).toBeLessThan(5.6);
      expect(rig.focusY).toBeGreaterThan(0.8);
      const glowMat = rig.glow[0].material as unknown as { emissiveColor: { r: number; g: number; b: number } };
      const before = glowMat.emissiveColor.r + glowMat.emissiveColor.g + glowMat.emissiveColor.b;
      for (let t = 0; t < 3; t += 0.25) rig.update(t);
      rig.setUsed(true);
      const after = glowMat.emissiveColor.r + glowMat.emissiveColor.g + glowMat.emissiveColor.b;
      expect(after, kind).toBeLessThan(before * 0.3);
      rig.update(4);
      for (const m of meshes) expect(Number.isFinite(m.position.y), kind).toBe(true);
      rig.dispose();
      expect(meshes.every((m) => m.isDisposed()), kind).toBe(true);
    }
  });
});
