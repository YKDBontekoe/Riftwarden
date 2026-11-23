import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { type Scene } from '@babylonjs/core/scene';
import { canvas, fbm, heightToNormal, toTexture } from './textures';
import { surfaceGrain } from './surfaceSources';

const cache = new WeakMap<Scene, PBRMaterial>();

/** Feathered, opaque frost on lower walls and drainage grates. Separate from hazard effects. */
export function rimeSurface(scene: Scene): PBRMaterial {
  const cached = cache.get(scene);
  if (cached) return cached;
  const size = 128;
  const { c, ctx } = canvas(size);
  const image = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const detail = surfaceGrain('frost', size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size;
    const v = (y + 0.5) / size;
    const noise = fbm(u, v, 6, 3, 80);
    const edge = Math.min(u, 1 - u, v, 1 - v);
    const ice = detail(x, y);
    const spread = edge * (0.65 + noise) - 0.055 - noise * noise * 0.2 + ice * 0.065;
    const shade = 0.69 + noise * 0.21 + ice * 0.23;
    const i = (y * size + x) * 4;
    image.data[i] = shade * 209;
    image.data[i + 1] = shade * 228;
    image.data[i + 2] = shade * 245;
    image.data[i + 3] = Math.max(0, Math.min(1, spread * 18)) * 255;
    height[i / 4] = Math.max(0, spread) * 0.2 + 0.5 + ice * 0.043;
  }
  ctx.putImageData(image, 0, 0);
  const frost = new PBRMaterial('rimeDeposit', scene);
  frost.albedoColor = new Color3(0.83, 0.92, 1);
  frost.albedoTexture = toTexture('rimeMask', c, scene, { aniso: 8 });
  frost.albedoTexture.hasAlpha = true;
  frost.useAlphaFromAlbedoTexture = true;
  frost.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
  frost.alphaCutOff = 0.35;
  frost.bumpTexture = toTexture('rimeRelief', heightToNormal(height, size, 3), scene, { srgb: false });
  frost.bumpTexture.level = 0.32;
  frost.metallic = 0;
  frost.roughness = 0.86;
  frost.backFaceCulling = false;
  cache.set(scene, frost);
  return frost;
}
