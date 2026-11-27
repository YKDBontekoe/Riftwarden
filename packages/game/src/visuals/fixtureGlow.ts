import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Scene } from '@babylonjs/core/scene';
import type { BiomeId } from '@riftwarden/rules/world/biomes';
import type { PropPlacement } from '@riftwarden/rules/world/propCatalog';
import { splashTexture } from './atmosphere';
import { unlit } from './materials';
import { flareSprite } from './textures';

/** Lamp colour per biome: sodium amber in the outpost, cold white in the cryo yard, furnace orange in the foundry. */
const GLOW: Record<BiomeId, { splash: [number, number, number]; lens: [number, number, number]; pool: [number, number, number] }> = {
  outpost: { splash: [0.62, 0.42, 0.22], lens: [3.2, 2.4, 1.4], pool: [0.2, 0.14, 0.08] },
  cryo: { splash: [0.36, 0.46, 0.6], lens: [2.2, 2.7, 3.2], pool: [0.1, 0.14, 0.19] },
  foundry: { splash: [0.7, 0.32, 0.12], lens: [3.4, 1.6, 0.6], pool: [0.24, 0.1, 0.04] },
};

/**
 * Fake light for wall-mounted prop fixtures (no real lights: the per-material light budget is spent, see
 * docs/systems/performance.md): an additive splash fanning down the wall, a glowing lens and a soft pool on the
 * deck in front. Three merged meshes for the whole arena, built once, frozen, never pickable.
 */
export function buildFixtureGlow(scene: Scene, mounts: readonly PropPlacement[], biome: BiomeId): void {
  if (!mounts.length) return;
  const c = GLOW[biome];
  const splashes: Mesh[] = [];
  const lenses: Mesh[] = [];
  const pools: Mesh[] = [];
  for (const m of mounts) {
    // Mounted fixtures face the arena along their yaw (+z of the model).
    const nx = Math.sin(m.yaw);
    const nz = Math.cos(m.yaw);
    const sp = MeshBuilder.CreatePlane('fixtureSplash', { width: 5.5, height: m.y + 0.4 }, scene);
    sp.position.set(m.x - nx * 0.12 * m.scale + nx * 0.05, (m.y + 0.4) / 2 - 0.15, m.z - nz * 0.12 * m.scale + nz * 0.05);
    sp.rotation.y = m.yaw + Math.PI;
    splashes.push(sp);
    const ln = MeshBuilder.CreateDisc('fixtureLens', { radius: 0.16 * m.scale, tessellation: 12 }, scene);
    ln.position.set(m.x + nx * 0.25 * m.scale, m.y - 0.05, m.z + nz * 0.25 * m.scale);
    ln.rotation.x = -Math.PI / 2;
    lenses.push(ln);
    const pool = MeshBuilder.CreateDisc('fixturePool', { radius: 3.4, tessellation: 24 }, scene);
    pool.rotation.x = Math.PI / 2;
    pool.position.set(m.x + nx * 2.4, 0.035, m.z + nz * 2.4);
    pools.push(pool);
  }
  const cone = splashTexture(scene);
  const flare = flareSprite(scene);
  const merged: [Mesh[], ReturnType<typeof unlit>][] = [
    [splashes, unlit(scene, 'fixtureSplash', c.splash, { tex: cone, opacity: cone, additive: true, zOffset: -2 })],
    [lenses, unlit(scene, 'fixtureLens', c.lens, { twoSided: true })],
    [pools, unlit(scene, 'fixturePool', c.pool, { tex: flare, opacity: flare, additive: true, zOffset: -2 })],
  ];
  for (const [parts, mat] of merged) {
    const mesh = Mesh.MergeMeshes(parts, true, true);
    if (!mesh) continue;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
  }
}
