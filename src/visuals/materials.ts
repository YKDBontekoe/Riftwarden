import { type BaseTexture, Color3, Constants, FresnelParameters, type Material, PBRMaterial, type Scene, StandardMaterial, type Texture } from '@babylonjs/core';
import { floorSet, type PbrSet, wallSet, wearSet } from './textures';

/**
 * Material palette. Surfaces are metallic/roughness PBR lit by the captured
 * environment (see atmosphere.ts) plus scene lights; "glow" materials are unlit
 * emissives whose values > 1 feed the HDR bloom.
 */
export interface Palette {
  white: PBRMaterial;
  panel: PBRMaterial;
  graphite: PBRMaterial;
  metal: PBRMaterial;
  floor: PBRMaterial;
  cyanGlow: PBRMaterial;
  cyanDim: PBRMaterial;
  orangeGlow: PBRMaterial;
  orangeDim: PBRMaterial;
  redGlow: PBRMaterial;
  whiteGlow: PBRMaterial;
  enemyArmor: PBRMaterial;
  enemyDark: PBRMaterial;
  shield: StandardMaterial;
  ghostOk: StandardMaterial;
  ghostBad: StandardMaterial;
  rift: StandardMaterial;
  /** All lit PBR materials (for global tweaks such as environment intensity). */
  lit: PBRMaterial[];
  wear: PbrSet;
}

export type AnyMaterial = Material;

interface PbrOpts {
  albedo: [number, number, number];
  metallic: number;
  roughness: number;
  set?: PbrSet;
  bump?: number;
  /** Use only the ORM/normal of the set, not its albedo. */
  noAlbedo?: boolean;
  clearCoat?: number;
}

function pbr(scene: Scene, name: string, o: PbrOpts): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = new Color3(...o.albedo);
  m.metallic = o.metallic;
  m.roughness = o.roughness;
  m.maxSimultaneousLights = 8;
  // Keep the range-based falloff the scene's light intensities were tuned for.
  m.usePhysicalLightFalloff = false;
  m.useRadianceOverAlpha = false;
  m.useSpecularOverAlpha = false;
  if (o.set) {
    if (!o.noAlbedo) m.albedoTexture = o.set.albedo;
    m.bumpTexture = o.set.normal;
    m.bumpTexture.level = o.bump ?? 1;
    m.metallicTexture = o.set.orm;
    m.useAmbientOcclusionFromMetallicTextureRed = true;
    m.useRoughnessFromMetallicTextureGreen = true;
    m.useMetallnessFromMetallicTextureBlue = true;
    m.useRoughnessFromMetallicTextureAlpha = false;
  }
  if (o.clearCoat) {
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = o.clearCoat;
    m.clearCoat.roughness = 0.08;
  }
  return m;
}

export interface UnlitOpts {
  /** Multiplied with the colour (unlike StandardMaterial, which adds it). */
  tex?: BaseTexture;
  opacity?: BaseTexture;
  additive?: boolean;
  zOffset?: number;
  twoSided?: boolean;
}

/**
 * Unlit HDR emissive material (PBR unlit path: colour x texture, never clamped, so
 * values > 1 drive the bloom). Used for every glow, beam, flash and additive sprite.
 */
export function unlit(scene: Scene, name: string, e: [number, number, number] | Color3, o: UnlitOpts = {}): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.unlit = true;
  m.albedoColor = Color3.Black();
  m.emissiveColor = e instanceof Color3 ? e.clone() : new Color3(...e);
  if (o.tex) m.emissiveTexture = o.tex;
  if (o.opacity) m.opacityTexture = o.opacity;
  if (o.additive) {
    m.alphaMode = Constants.ALPHA_ADD;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    m.disableDepthWrite = true;
  }
  if (o.zOffset) m.zOffset = o.zOffset;
  if (o.twoSided) m.backFaceCulling = false;
  return m;
}

/** Emissive "light" material. Values > 1 feed the HDR bloom. */
function glow(scene: Scene, name: string, e: [number, number, number]): PBRMaterial {
  return unlit(scene, name, e);
}

function scaled(t: Texture, u: number, v = u): Texture {
  // Each floor texture has a single user, so scale in place (DynamicTexture clones are blank).
  t.uScale = u;
  t.vScale = v;
  return t;
}

export function createPalette(scene: Scene): Palette {
  const floorTex = floorSet(scene);
  const wallTex = wallSet(scene);
  const wear = wearSet(scene);

  // Ground is a 120 m plane with 0..1 UVs: albedo/normal tile every 8 m, wetness every ~23 m.
  const floor = pbr(scene, 'floor', { albedo: [1, 1, 1], metallic: 0.08, roughness: 1 });
  floor.albedoTexture = scaled(floorTex.albedo, 15);
  floor.bumpTexture = scaled(floorTex.normal, 15);
  floor.bumpTexture.level = 0.55;
  floor.metallicTexture = scaled(floorTex.orm, 120 / 23.3);
  floor.useRoughnessFromMetallicTextureGreen = true;
  floor.useMetallnessFromMetallicTextureBlue = true;
  floor.useAmbientOcclusionFromMetallicTextureRed = true;
  floor.useRoughnessFromMetallicTextureAlpha = false;

  const shield = new StandardMaterial('shield', scene);
  shield.diffuseColor = Color3.Black();
  shield.specularColor = Color3.Black();
  shield.emissiveColor = new Color3(2.2, 0.55, 0.08);
  shield.alpha = 0.5;
  shield.disableLighting = true;
  shield.backFaceCulling = false;
  shield.opacityFresnelParameters = new FresnelParameters({ bias: 0.08, power: 2.4, leftColor: Color3.White(), rightColor: Color3.Black() });
  shield.emissiveFresnelParameters = new FresnelParameters({ bias: 0.25, power: 1.6, leftColor: new Color3(2.6, 0.9, 0.2), rightColor: new Color3(0.6, 0.08, 0.0) });

  const ghost = (name: string, c: [number, number, number]) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = new Color3(...c);
    m.disableLighting = true;
    m.alpha = 0.38;
    m.backFaceCulling = false;
    m.opacityFresnelParameters = new FresnelParameters({ bias: 0.25, power: 1.5, leftColor: Color3.White(), rightColor: Color3.Black() });
    return m;
  };

  const rift = new StandardMaterial('rift', scene);
  rift.emissiveColor = new Color3(1, 0.2, 0.03);
  rift.disableLighting = true;
  rift.backFaceCulling = false;

  // Clean hard-surface set: off-white composite panels, dark gunmetal trims, bright machined metal.
  const panel = pbr(scene, 'panel', { albedo: [0.86, 0.88, 0.9], metallic: 0.12, roughness: 1, set: wallTex, bump: 0.6, clearCoat: 0.3 });
  const white = pbr(scene, 'white', { albedo: [0.88, 0.89, 0.9], metallic: 0.05, roughness: 0.45, set: wear, bump: 0.1, clearCoat: 0.7 });
  const graphite = pbr(scene, 'graphite', { albedo: [0.13, 0.14, 0.16], metallic: 0.75, roughness: 0.5, set: wear, bump: 0.1 });
  const metal = pbr(scene, 'metal', { albedo: [0.82, 0.83, 0.86], metallic: 1, roughness: 0.32, set: wear, noAlbedo: true, bump: 0.1 });
  const enemyArmor = pbr(scene, 'enemyArmor', { albedo: [0.55, 0.22, 0.12], metallic: 0.35, roughness: 0.5, set: wear, bump: 0.15, clearCoat: 0.4 });
  const enemyDark = pbr(scene, 'enemyDark', { albedo: [0.07, 0.065, 0.07], metallic: 0.85, roughness: 0.38, set: wear, bump: 0.15 });

  // Generous sky fill so shadowed areas stay readable (daylight bounce).
  for (const m of [white, panel, graphite, metal, floor, enemyArmor, enemyDark]) m.environmentIntensity = 1.45;

  return {
    white,
    panel,
    graphite,
    metal,
    floor,
    cyanGlow: glow(scene, 'cyanGlow', [0.25, 1.9, 2.2]),
    cyanDim: glow(scene, 'cyanDim', [0.05, 0.55, 0.65]),
    orangeGlow: glow(scene, 'orangeGlow', [2.9, 0.45, 0.03]),
    orangeDim: glow(scene, 'orangeDim', [0.75, 0.13, 0.01]),
    redGlow: glow(scene, 'redGlow', [2.6, 0.28, 0.12]),
    whiteGlow: glow(scene, 'whiteGlow', [2.4, 2.6, 2.9]),
    enemyArmor,
    enemyDark,
    shield,
    ghostOk: ghost('ghostOk', [0.2, 1.4, 1.6]),
    ghostBad: ghost('ghostBad', [1.8, 0.2, 0.12]),
    rift,
    lit: [white, panel, graphite, metal, floor, enemyArmor, enemyDark],
    wear,
  };
}
