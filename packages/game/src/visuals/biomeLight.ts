import type { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import type { Scene } from '@babylonjs/core/scene';
import type { BiomeId } from '@riftwarden/rules/world/biomes';
import type { Palette } from './materials';
import type { PostFx } from './postfx';

/**
 * Per-biome light identity for the arena (no extra lights, so the frame budget is unchanged): exposure and contrast
 * of the camera grade, the hemispheric fill's sky colour and ground bounce, IBL strength and the sun multiplier.
 * Outpost = warm dusk with dusty bounce, cryo = bright cold daylight with snow bounce, foundry = furnace orange
 * welling up from below. The sky and backdrops are untouched; the mood director still layers boss / event /
 * reactor moods on top (it adds to these bases).
 */
export interface BiomeLight {
  exposure: number;
  contrast: number;
  fill: number;
  sky: [number, number, number];
  ground: [number, number, number];
  env: number;
  sun: number;
}

export const BIOME_LIGHT: Record<BiomeId, BiomeLight> = {
  outpost: { exposure: 1.46, contrast: 1.06, fill: 1.05, sky: [0.74, 0.76, 0.84], ground: [0.4, 0.33, 0.26], env: 1.6, sun: 1.25 },
  cryo: { exposure: 1.4, contrast: 1.04, fill: 1.1, sky: [0.76, 0.86, 1], ground: [0.58, 0.64, 0.72], env: 1.6, sun: 1.2 },
  foundry: { exposure: 1.36, contrast: 1.1, fill: 0.95, sky: [0.66, 0.52, 0.44], ground: [0.55, 0.24, 0.09], env: 1.5, sun: 1.15 },
};

/** Applies the biome's light to an arena scene; returns the sun multiplier (on top of the biome's `sunMul`). */
export function applyBiomeLight(scene: Scene, post: PostFx, P: Palette, biome: BiomeId): number {
  const L = BIOME_LIGHT[biome];
  post.baseExposure = L.exposure;
  post.baseContrast = L.contrast;
  const fill = scene.getLightByName('stormFill') as HemisphericLight | null;
  if (fill) {
    fill.intensity = L.fill;
    fill.diffuse.set(...L.sky);
    fill.groundColor.set(...L.ground);
  }
  for (const m of P.lit) m.environmentIntensity = L.env;
  // Black steel panels were tuned for a dim scene; under brighter fill they read as holes. Lift to dark grey.
  P.steel.albedoColor.scaleInPlace(1.9);
  // Dark painted steel, not polished metal: as metal it only mirrored the dusk sky and read as a void.
  P.steel.metallic = 0.25;
  // Decorative emissive strips (wall bars, machine slots, rings) were tuned to carry a dark scene; in a lit one they
  // read as arcade neon. Real plant has small indicators, so they drop well below bloom threshold.
  for (const m of [P.cyanDim, P.orangeDim, P.cyanGlow, P.whiteGlow]) m.emissiveColor.scaleInPlace(0.42);
  return L.sun;
}
