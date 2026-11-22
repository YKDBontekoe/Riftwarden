import { Constants } from '@babylonjs/core/Engines/constants';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
import { type Material } from '@babylonjs/core/Materials/material';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { type BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { type Scene } from '@babylonjs/core/scene';
import type { ArenaLayout } from '@riftwarden/rules/world/layout';
import { floorSet, type PbrSet, rustSet, wallSet, wearSet, yardDeckSet } from './textures';

/**
 * Material palette. Surfaces are metallic/roughness PBR lit by the captured
 * environment (see atmosphere.ts) plus scene lights; "glow" materials are unlit
 * emissives whose values > 1 feed the HDR bloom.
 */
export interface Palette {
  white: PBRMaterial;
  panel: PBRMaterial;
  concrete: PBRMaterial;
  glazing: PBRMaterial;
  graphite: PBRMaterial;
  metal: PBRMaterial;
  enamel: PBRMaterial;
  floor: PBRMaterial;
  cyanGlow: PBRMaterial;
  cyanDim: PBRMaterial;
  orangeGlow: PBRMaterial;
  orangeDim: PBRMaterial;
  redGlow: PBRMaterial;
  whiteGlow: PBRMaterial;
  enemyArmor: PBRMaterial;
  enemyDark: PBRMaterial;
  /** Corroded steel (wreckage, scrap, rebar). */
  rust: PBRMaterial;
  /** Broken, dusty concrete (rubble chunks, fallen slabs). */
  debris: PBRMaterial;
  /** Blackened structural steel for large slabs (gate tunnels): wear in the finish only, no rust blotches. */
  steel: PBRMaterial;
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
  // Zero reflectance so screen-space reflections never paint over glows, screens or signs.
  m.metallic = 0;
  m.roughness = 1;
  m.metallicF0Factor = 0;
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

export function createPalette(scene: Scene, high: boolean, indoor = false, layout?: ArenaLayout): Palette {
  const floorTex = indoor ? floorSet(scene, high) : yardDeckSet(scene, high, layout?.biome, layout?.seed);
  const wallTex = wallSet(scene, high, indoor);
  // Outdoors (arena) the paint fails in patches; the HQ is maintained, so only light rust.
  const wear = wearSet(scene, high, indoor ? 0.3 : 0.6);

  const floor = pbr(scene, indoor ? 'hqFloor' : 'floor', {
    albedo: indoor ? [0.59, 0.60, 0.54] : [0.80, 0.81, 0.82],
    metallic: 1,
    roughness: 1,
    set: floorTex,
  });
  floorTex.normal.level = indoor ? 0.20 : 0.32;

  const shield = new StandardMaterial('shield', scene);
  shield.diffuseColor = Color3.Black();
  shield.specularColor = Color3.Black();
  shield.emissiveColor = new Color3(1.55, 0.58, 0.16);
  shield.alpha = 0.09;
  shield.disableLighting = true;
  // Front faces only: back faces read as grazing angles to the fresnel and filled the whole sphere.
  shield.backFaceCulling = true;
  shield.opacityFresnelParameters = new FresnelParameters({ bias: 0, power: 0.75, leftColor: new Color3(0.57, 0.57, 0.57), rightColor: Color3.Black() });
  shield.emissiveFresnelParameters = new FresnelParameters({ bias: 0, power: 0.72, leftColor: Color3.White(), rightColor: new Color3(0.05, 0.025, 0.01) });
  // Additive: a bright rim with a nearly clear centre, so the machine inside stays readable.
  shield.alphaMode = Constants.ALPHA_ADD;

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
  // Outdoors everything is weathered: grey cast concrete and dirty composite, no cream.
  const panel = pbr(scene, 'panel', { albedo: indoor ? [0.88, 0.87, 0.78] : [0.5, 0.52, 0.52], metallic: 0.12, roughness: 1, set: wallTex, clearCoat: indoor ? 0.3 : 0.1 });
  const concrete = indoor ? panel : pbr(scene, 'castConcrete', { albedo: [0.4, 0.4, 0.39], metallic: 0, roughness: 0.9 });
  const glazing = pbr(scene, 'smokedFacade', { albedo: [0.06, 0.17, 0.20], metallic: 0.67, roughness: 0.17, clearCoat: 0.65 });
  const white = pbr(scene, 'white', { albedo: indoor ? [0.87, 0.86, 0.76] : [0.5, 0.5, 0.48], metallic: 0.08, roughness: 0.65, set: wear, noAlbedo: true, clearCoat: 0.18 });
  // Outdoors: painted steel, cooler and less metallic, so the low warm sun does not turn it tan-brown.
  const graphite = pbr(scene, 'graphite', indoor ? { albedo: [0.155, 0.185, 0.18], metallic: 0.44, roughness: 0.67, set: wear } : { albedo: [0.12, 0.135, 0.145], metallic: 0.22, roughness: 0.7, set: wear });
  const metal = pbr(scene, 'metal', { albedo: [0.69, 0.74, 0.78], metallic: 0.78, roughness: 0.49, set: wear, noAlbedo: true });
  const enamel = pbr(scene, 'safetyEnamel', { albedo: [0.84, 0.30, 0.14], metallic: 0.12, roughness: 0.65, set: wear });
  const enemyArmor = pbr(scene, 'enemyArmor', { albedo: [0.65, 0.29, 0.15], metallic: 0.24, roughness: 0.66, set: wear, clearCoat: 0.21 });
  const enemyDark = pbr(scene, 'enemyDark', { albedo: [0.12, 0.13, 0.15], metallic: 0.52, roughness: 0.59, set: wear });

  wallTex.normal.level = indoor ? 0.19 : 0.36;
  wear.normal.level = 0.21;

  const rust = pbr(scene, 'rustMetal', { albedo: [1, 1, 1], metallic: 1, roughness: 1, set: rustSet(scene, high) });
  const debris = pbr(scene, 'rubbleConcrete', { albedo: [0.25, 0.24, 0.22], metallic: 0, roughness: 1, set: wear, noAlbedo: true });
  const steel = pbr(scene, 'blackSteel', { albedo: [0.1, 0.105, 0.11], metallic: 0.6, roughness: 0.72, set: wear, noAlbedo: true });
  const lit = [white, panel, graphite, metal, enamel, floor, enemyArmor, enemyDark, rust, debris, steel];
  if (!indoor) {
    lit.push(concrete, glazing);
    if (!(scene.getEngine() instanceof NullEngine)) {
      const grit = new Texture(new URL('../assets/yard-concrete-detail.png', import.meta.url).href, scene);
      grit.gammaSpace = false;
      grit.anisotropicFilteringLevel = 12;
      const deckGrit = grit.clone();
      deckGrit.uScale = deckGrit.vScale = 40;
      for (const [material, detail] of [[concrete, grit], [floor, deckGrit]] as const) {
        material.detailMap.texture = detail;
        material.detailMap.diffuseBlendLevel = 0.42;
        material.detailMap.bumpLevel = material === floor ? 0.21 : 0.43;
        material.detailMap.roughnessBlendLevel = 0;
        material.detailMap.isEnabled = true;
      }
    }
  }
  for (const m of lit) m.environmentIntensity = indoor ? 1.15 : 0.89;

  return {
    white,
    panel,
    concrete, glazing,
    graphite,
    metal,
    enamel,
    floor,
    cyanGlow: glow(scene, 'cyanGlow', [0.68, 1.49, 1.24]),
    cyanDim: glow(scene, 'cyanDim', [0.18, 0.45, 0.38]),
    orangeGlow: glow(scene, 'orangeGlow', [2.9, 0.45, 0.03]),
    orangeDim: glow(scene, 'orangeDim', [0.75, 0.13, 0.01]),
    redGlow: glow(scene, 'redGlow', [2.6, 0.28, 0.12]),
    whiteGlow: glow(scene, 'whiteGlow', [2.4, 2.6, 2.9]),
    enemyArmor,
    rust,
    debris,
    steel,
    enemyDark,
    shield,
    ghostOk: ghost('ghostOk', [0.2, 1.4, 1.6]),
    ghostBad: ghost('ghostBad', [1.8, 0.2, 0.12]),
    rift,
    lit,
    wear,
  };
}
