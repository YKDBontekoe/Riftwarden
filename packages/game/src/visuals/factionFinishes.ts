import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { Palette } from './materials';

type Coat = 'scrap' | 'rime' | 'crucible';
type Surface = Coat | 'casting' | 'machined' | 'tracks' | 'heat' | 'warning';
type Finish = Surface | 'marking';

const COATS: Record<Surface, { color: [number, number, number]; polish: number; clearCoat: number; relief: number }> = {
  scrap:    { color: [0.36, 0.245, 0.15],  polish: 0.78, clearCoat: 0.14, relief: 0.75 },
  rime:     { color: [0.25, 0.34, 0.40],   polish: 0.75, clearCoat: 0.12, relief: 0.68 },
  crucible: { color: [0.31, 0.12, 0.074],  polish: 0.69, clearCoat: 0.11, relief: 0.78 },
  casting:  { color: [0.18, 0.21, 0.24],   polish: 0.68, clearCoat: 0.13, relief: 0.75 },
  machined: { color: [0.45, 0.47, 0.49],   polish: 1.0,  clearCoat: 0.49, relief: 0.43 },
  tracks:   { color: [0.12, 0.14, 0.15],   polish: 0.43, clearCoat: 0,    relief: 0.86 },
  heat:     { color: [0.16, 0.125, 0.108], polish: 0.65, clearCoat: 0.16, relief: 0.78 },
  warning:  { color: [0.71, 0.40, 0.085],  polish: 0.63, clearCoat: 0.05, relief: 0.56 },
};

const caches = new WeakMap<Scene, Map<Finish, PBRMaterial>>();

function makeMaps(scene: Scene) {
  const albedo = new Texture(new URL('../assets/faction-finishes/alloy-albedo.webp', import.meta.url).href, scene);
  const normal = new Texture(new URL('../assets/faction-finishes/alloy-normal.png', import.meta.url).href, scene);
  const specular = new Texture(new URL('../assets/faction-finishes/alloy-specular.webp', import.meta.url).href, scene);
  const occlusion = new Texture(new URL('../assets/faction-finishes/alloy-occlusion.webp', import.meta.url).href, scene);
  normal.gammaSpace = specular.gammaSpace = occlusion.gammaSpace = false;
  for (const texture of [albedo, normal, specular, occlusion]) texture.anisotropicFilteringLevel = 8;
  return { albedo, normal, specular, occlusion };
}

function materials(scene: Scene): Map<Finish, PBRMaterial> {
  const existing = caches.get(scene);
  if (existing) return existing;
  const output = new Map<Finish, PBRMaterial>();
  const headless = scene.getEngine() instanceof NullEngine;
  const maps = headless ? null : makeMaps(scene);
  for (const [finish, value] of Object.entries(COATS) as [Surface, typeof COATS[Surface]][]) {
    const mat = new PBRMaterial(`factionFinish:${finish}`, scene);
    mat.albedoColor = new Color3(...value.color);
    mat.microSurface = maps ? value.polish : value.polish * 0.47;
    mat.reflectivityColor = new Color3(0.90, 0.93, 0.97);
    mat.clearCoat.isEnabled = value.clearCoat > 0;
    mat.clearCoat.intensity = value.clearCoat;
    mat.clearCoat.roughness = 0.28;
    mat.maxSimultaneousLights = 8;
    mat.usePhysicalLightFalloff = false;
    mat.environmentIntensity = 1.25;
    if (maps) {
      mat.albedoTexture = maps.albedo;
      mat.bumpTexture = maps.normal.clone();
      mat.bumpTexture.level = value.relief;
      // Keep the moving hull's reflection signal below the wet-floor SSR threshold.
      // The PBR environment and clear coat still light the worn edges and machined parts.
      mat.reflectivityTexture = maps.specular;
      mat.useMicroSurfaceFromReflectivityMapAlpha = true;
      mat.ambientTexture = maps.occlusion;
      mat.useAmbientInGrayScale = true;
      mat.ambientTextureStrength = 0.67;
    }
    output.set(finish, mat);
  }
  const marking = new PBRMaterial('factionFinish:marking', scene);
  marking.metallic = 0;
  marking.roughness = 0.72;
  marking.backFaceCulling = false;
  marking.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
  marking.alphaCutOff = 0.28;
  if (!headless) {
    marking.albedoTexture = new Texture(new URL('../assets/faction-finishes/identification.webp', import.meta.url).href, scene);
    marking.albedoTexture.hasAlpha = true;
  }
  output.set('marking', marking);
  caches.set(scene, output);
  return output;
}

export function factionFinishes(base: Palette, coat: Coat) {
  const mats = materials(base.white.getScene());
  for (const mat of mats.values()) if (!base.lit.includes(mat)) base.lit.push(mat);
  return {
    armor: mats.get(coat)!,
    casting: mats.get('casting')!,
    machined: mats.get('machined')!,
    tracks: mats.get('tracks')!,
    heat: mats.get('heat')!,
    warning: mats.get('warning')!,
    marking: mats.get('marking')!,
  };
}
