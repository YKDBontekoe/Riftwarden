import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { HDRCubeTexture } from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VolumetricLightScatteringPostProcess } from '@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess';
import { unlit } from './materials';
import type { BiomeId } from '@riftwarden/rules/world/biomes';

/**
 * Real sky light: a CC0 Poly Haven HDRI per biome as the scene's image-based light (reflections and ambient on every
 * PBR surface), prefiltered on load. The visible sky dome is unchanged. Replaces the cube capture of the arena
 * itself, which only ever reflected the arena's own dark walls back onto them. `fallback` runs when the HDRI cannot
 * be loaded (offline before first use), so the old capture still lights the scene.
 */
const HDRI: Record<BiomeId, string> = {
  outpost: new URL('../assets/cc0/hdri/outpost-sky.hdr', import.meta.url).href,
  cryo: new URL('../assets/cc0/hdri/cryo-sky.hdr', import.meta.url).href,
  foundry: new URL('../assets/cc0/hdri/foundry-sky.hdr', import.meta.url).href,
};

/** Rotation (radians about y) that puts each HDRI's sun roughly where the arena sun is. */
const ROTATION: Record<BiomeId, number> = { outpost: 0, cryo: 0, foundry: 0 };

export function applySkyLight(scene: Scene, biome: BiomeId, high: boolean, fallback: () => void): void {
  if (scene.getEngine() instanceof NullEngine) return;
  let done = false;
  const fail = () => {
    if (done || scene.isDisposed) return;
    done = true;
    fallback();
  };
  try {
    const tex = new HDRCubeTexture(HDRI[biome], scene, high ? 256 : 128, false, true, false, true, () => {
      if (scene.isDisposed) return;
      done = true;
      tex.rotationY = ROTATION[biome];
      scene.environmentTexture = tex;
    }, fail);
  } catch {
    fail();
  }
}

/**
 * Volumetric sun shafts (High only): a sun disc far out along the sun direction, rendered into Babylon's light
 * scattering pass so gantries, stacks and walls cut visible shafts through the dusk haze.
 */
export function addSunShafts(scene: Scene, camera: Camera, sunDir: Vector3, color: [number, number, number]): void {
  if (scene.getEngine() instanceof NullEngine) return;
  const sun = MeshBuilder.CreateDisc('sunShaftSource', { radius: 7, tessellation: 24 }, scene);
  sun.position.copyFrom(sunDir.normalizeToNew().scale(260));
  sun.billboardMode = Mesh.BILLBOARDMODE_ALL;
  sun.isPickable = false;
  sun.infiniteDistance = true;
  // Additive and unfogged: in the main pass it only brightens the sky's own sun disc (an opaque disc covered it).
  const mat = unlit(scene, 'sunShaftSource', color, { additive: true });
  sun.material = mat;
  sun.applyFog = false;
  const vls = new VolumetricLightScatteringPostProcess('sunShafts', 0.5, camera, sun, 60, Texture.BILINEAR_SAMPLINGMODE, scene.getEngine(), false, scene);
  vls.exposure = 0.12;
  vls.decay = 0.965;
  vls.weight = 0.55;
  vls.density = 0.9;
}
