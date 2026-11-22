import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { type Scene } from '@babylonjs/core/scene';
import { canvas, toTexture } from './textures';

const materials = new WeakMap<Scene, StandardMaterial>();

/** Soft contact near the foot of large props, including the lower graphics presets. */
export function contactShadow(scene: Scene, x: number, z: number, width: number, depth: number) {
  let material = materials.get(scene);
  if (!material) {
    const { c, ctx } = canvas(64);
    const gradient = ctx.createRadialGradient(32, 32, 5, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.57)');
    gradient.addColorStop(0.52, 'rgba(0, 0, 0, 0.34)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const tex = toTexture('contactShadowMask', c, scene);
    tex.hasAlpha = true;
    material = new StandardMaterial('contactShadow', scene);
    material.disableLighting = true;
    material.diffuseColor = Color3.Black();
    material.emissiveColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.diffuseTexture = tex;
    material.useAlphaFromDiffuseTexture = true;
    material.disableDepthWrite = true;
    materials.set(scene, material);
  }
  const mesh = MeshBuilder.CreateGround('contactShadow', { width, height: depth }, scene);
  mesh.position.set(x, 0.012, z);
  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}
