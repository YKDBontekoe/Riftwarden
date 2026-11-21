import { CascadedShadowGenerator, type AbstractMesh, type DirectionalLight, ShadowGenerator } from '@babylonjs/core';

export type ShadowQuality = 'off' | 'low' | 'high';

/**
 * Sun shadows for the arena. `high` graphics + `high` shadows use cascades (crisp near the player, coverage across
 * the arena); anything else a single map. Returns the generator (null when off) so callers can register casters.
 */
export function createSunShadows(sun: DirectionalLight, quality: ShadowQuality, highGraphics: boolean, casters: Iterable<AbstractMesh>): ShadowGenerator | null {
  if (quality === 'off') return null;
  const sg = quality === 'high' && highGraphics ? new CascadedShadowGenerator(2048, sun) : new ShadowGenerator(quality === 'high' ? 2048 : 1024, sun);
  if (sg instanceof CascadedShadowGenerator) {
    sg.numCascades = 4;
    sg.lambda = 0.82;
    sg.stabilizeCascades = true;
    sg.shadowMaxZ = 140;
    sg.cascadeBlendPercentage = 0.08;
    sg.autoCalcDepthBounds = false;
  } else {
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 260;
  }
  sg.usePercentageCloserFiltering = true;
  sg.filteringQuality = highGraphics ? ShadowGenerator.QUALITY_HIGH : ShadowGenerator.QUALITY_LOW;
  sg.bias = 0.004;
  sg.normalBias = 0.025;
  sg.darkness = 0;
  for (const m of casters) sg.addShadowCaster(m);
  return sg;
}
