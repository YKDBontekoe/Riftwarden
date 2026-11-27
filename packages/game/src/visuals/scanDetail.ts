import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { type PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

/**
 * Scanned micro detail (CC0 Poly Haven scans high-passed into Babylon detail maps by scripts/fetch-cc0.mjs:
 * R = albedo, G = normal Y, B = roughness, A = normal X, all centred on 0.5). Layered on art-directed procedural
 * sets (HQ deck, walls, painted steel) so close-ups get real grain and scratches while the macro look stays.
 */
const DETAIL = {
  'cast-concrete': new URL('../assets/cc0/textures/cast-concrete-detail.webp', import.meta.url).href,
  'painted-metal': new URL('../assets/cc0/textures/painted-metal-detail.webp', import.meta.url).href,
  'steel-plate': new URL('../assets/cc0/textures/steel-plate-detail.webp', import.meta.url).href,
  'steel-plate-fine': new URL('../assets/cc0/textures/steel-plate-fine-detail.webp', import.meta.url).href,
  'panel-plaster': new URL('../assets/cc0/textures/panel-plaster-detail.webp', import.meta.url).href,
};
export type DetailId = keyof typeof DETAIL;

/** `repeat`: detail tiles per material UV unit (box-projected meshes: UV 1 = the projection tile in metres). */
export function applyScanDetail(m: PBRMaterial, scene: Scene, id: DetailId, repeat: number, strength = 1): void {
  if (scene.getEngine() instanceof NullEngine) return;
  const t = new Texture(DETAIL[id], scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  t.gammaSpace = false;
  t.anisotropicFilteringLevel = 8;
  t.uScale = t.vScale = repeat;
  m.detailMap.texture = t;
  m.detailMap.diffuseBlendLevel = 0.5 * strength;
  m.detailMap.bumpLevel = 0.6 * strength;
  m.detailMap.roughnessBlendLevel = 0.5 * strength;
  m.detailMap.isEnabled = true;
}
