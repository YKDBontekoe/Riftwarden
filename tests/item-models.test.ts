// 3D item models (loot/itemModels + itemShapes): every base and currency builds a real, bounded,
// centred model on a NullEngine scene; profiles face outward; the rim hull and template keys behave.
import '../apps/worker/src/sim/headless';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASES } from '@riftwarden/rules/loot/bases';
import { generateItem } from '@riftwarden/rules/loot/generate';
import { CURRENCIES, type CurrencyKey } from '@riftwarden/rules/economy/currencies';
import { buildCurrencyModel, buildItemModel, lookKey, lookOf, rimHull, rimMaterial, sculptFor, weldNormals } from '@riftwarden/game/loot/itemModels';
import { ACCENT, outward } from '@riftwarden/game/loot/itemShapes';

describe('item models', () => {
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

  it('every non-weapon base has its own sculpt and accent colour', () => {
    for (const b of BASES) {
      if (b.category === 'weapon') {
        expect(b.weapon?.family, b.id).toBeTruthy();
        continue;
      }
      expect(sculptFor(b.id), b.id).not.toBeNull();
      expect(ACCENT[b.id], b.id).toBeDefined();
    }
  });

  it('every base builds a centred model whose longest side is the requested size', () => {
    for (const b of BASES) {
      const m = buildItemModel(scene, { defId: b.id, category: b.category, rarity: 'rare' }, { size: 0.8, name: `t_${b.id}` });
      expect(m.meshes.length, b.id).toBeGreaterThan(0);
      const longest = Math.max(m.extent.x, m.extent.y, m.extent.z) * m.scale;
      expect(longest, b.id).toBeCloseTo(0.8, 5);
      // Merged per material: a handful of draw calls per item.
      expect(m.meshes.length, b.id).toBeLessThanOrEqual(b.category === 'weapon' ? 30 : 9);
      let lo = Infinity, hi = -Infinity;
      for (const mesh of m.meshes) {
        const bb = mesh.getBoundingInfo().boundingBox;
        lo = Math.min(lo, bb.minimum.y);
        hi = Math.max(hi, bb.maximum.y);
        for (const v of [bb.minimum, bb.maximum]) expect(Number.isFinite(v.x + v.y + v.z), b.id).toBe(true);
      }
      expect(Math.abs(lo + hi), `${b.id} centred`).toBeLessThan(1e-3);
      m.dispose();
    }
  });

  it('every currency has a prop', () => {
    for (const k of Object.keys(CURRENCIES) as CurrencyKey[]) {
      const m = buildCurrencyModel(scene, k, { size: 1 });
      expect(m.meshes.length, k).toBeGreaterThan(0);
      m.dispose();
    }
  });

  it('a detailed weapon model follows the rolled build; stock models share one key per base', () => {
    const a = generateItem({ uid: 'a', seed: 11, level: 10, rarity: 'legendary', category: 'weapon', source: 't' });
    const b = generateItem({ uid: 'b', seed: 12, level: 10, rarity: 'legendary', category: 'weapon', baseId: a.defId, source: 't' });
    expect(lookKey(lookOf(a))).toBe(lookKey(lookOf(b)));
    expect(lookKey(lookOf(a), true)).not.toBe(lookKey(lookOf(b), true));
    const m = buildItemModel(scene, lookOf(a), { detailed: true, size: 1 });
    expect(m.meshes.length).toBeGreaterThan(3);
    m.dispose();
    // Non-weapons key by base + rarity (the rim colour comes from the rarity).
    const armour = { defId: 'kinetic_plating', category: 'armor' as const };
    expect(lookKey({ ...armour, rarity: 'rare' })).not.toBe(lookKey({ ...armour, rarity: 'epic' }));
  });

  it('the rim hull wraps the model with outward-welded normals', () => {
    const m = buildItemModel(scene, { defId: 'shield_matrix', category: 'shield', rarity: 'epic' }, { size: 1 });
    const hull = rimHull(scene, m, rimMaterial(scene, 'epic'), 0.02);
    const hb = hull.getBoundingInfo().boundingBox;
    let max = 0;
    for (const mesh of m.meshes) if (mesh.material!.alpha >= 1) max = Math.max(max, mesh.getBoundingInfo().boundingBox.maximum.y);
    expect(hb.maximum.y).toBeGreaterThan(max);
    expect(hull.material!.cullBackFaces).toBe(false);
    m.dispose();
  });

  it('disposing a weapon model keeps the shared weapon library textures alive', async () => {
    const { weaponMaterials } = await import('@riftwarden/game/weapons/materials');
    const { buildWeaponModel } = await import('@riftwarden/game/weapons/model');
    const { defaultBuild } = await import('@riftwarden/rules/weapons/build');
    const lib = weaponMaterials(scene);
    const bump = lib.dark.bumpTexture!;
    buildWeaponModel(scene, defaultBuild('plasma_repeater', 'plasma')).dispose();
    buildItemModel(scene, { defId: 'rail_lancer', category: 'weapon', rarity: 'epic' }).dispose();
    expect(scene.textures.includes(bump)).toBe(true);
    expect(lib.dark.bumpTexture).toBe(bump);
  });

  it('weldNormals averages normals of coincident vertices', () => {
    const p = [0, 0, 0, 0, 0, 0, 1, 0, 0];
    const n = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const w = weldNormals(p, n);
    expect(w[0]).toBeCloseTo(Math.SQRT1_2);
    expect(w[1]).toBeCloseTo(Math.SQRT1_2);
    expect(w.slice(0, 3)).toEqual(w.slice(3, 6));
    expect(w.slice(6)).toEqual([0, 0, 1]);
  });

  it('lathe profiles are oriented counter-clockwise (outward) whichever way they were written', () => {
    const up: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(outward(up)).toBe(up);
    expect(outward([...up].reverse())).toEqual(up);
  });
});
