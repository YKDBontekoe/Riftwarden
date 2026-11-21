/**
 * M10: apply a biome's material tints to a freshly created outdoor palette (albedo multipliers on the big
 * surfaces). The palette is per scene, so nothing leaks into other worlds.
 */
import type { PBRMaterial } from '@babylonjs/core';
import type { BiomeDef } from '@riftwarden/rules/world/biomes';
import type { Palette } from './materials';

export function tintPalette(P: Palette, biome: BiomeDef): Palette {
  const tint = (m: PBRMaterial, k: [number, number, number]) => {
    if (k[0] === 1 && k[1] === 1 && k[2] === 1) return;
    m.albedoColor.set(m.albedoColor.r * k[0], m.albedoColor.g * k[1], m.albedoColor.b * k[2]);
  };
  tint(P.concrete, biome.tint.concrete);
  tint(P.panel, biome.tint.panel);
  tint(P.floor, biome.tint.floor);
  tint(P.steel, biome.tint.steel);
  return P;
}
