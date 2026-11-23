import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Palette } from './materials';

type Role = 'bulwark' | 'rusher' | 'artillery' | 'engineer' | 'enforcer';
const COLORS: Record<Role, [number, number, number]> = {
  bulwark: [0.26, 0.34, 0.42], rusher: [0.75, 0.46, 0.13],
  artillery: [0.68, 0.65, 0.51], engineer: [0.16, 0.40, 0.29], enforcer: [0.36, 0.39, 0.40],
};
const variants = new WeakMap<Palette, Map<Role, Palette>>();

/** Role colours sit on solid armour; the existing emissive weakpoints retain their meaning. */
export function enemyRolePalette(base: Palette, role: Role): Palette {
  let roles = variants.get(base);
  if (!roles) variants.set(base, roles = new Map());
  const cached = roles.get(role);
  if (cached) return cached;
  const source = base.enemyArmor;
  const armour = new PBRMaterial(`enemyArmour:${role}`, source.getScene());
  armour.albedoColor = new Color3(...COLORS[role]);
  armour.metallic = 0.18;
  armour.roughness = 0.86;
  armour.albedoTexture = source.albedoTexture;
  armour.bumpTexture = source.bumpTexture;
  armour.metallicTexture = source.metallicTexture;
  armour.useAmbientOcclusionFromMetallicTextureRed = true;
  armour.useRoughnessFromMetallicTextureGreen = true;
  armour.useRoughnessFromMetallicTextureAlpha = false;
  armour.useMetallnessFromMetallicTextureBlue = true;
  armour.usePhysicalLightFalloff = false;
  armour.maxSimultaneousLights = 8;
  armour.environmentIntensity = source.environmentIntensity;
  base.lit.push(armour);
  const palette = { ...base, enemyArmor: armour };
  roles.set(role, palette);
  return palette;
}
