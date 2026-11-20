import { Color4, Mesh, ParticleSystem, type Scene, Vector3, VertexData } from '@babylonjs/core';
import { unlit } from '../visuals/materials';
import { canvas, flareSprite, rng, toTexture } from '../visuals/textures';
import { HQ_WINDOW } from './layout';

/**
 * HQ atmosphere: light shafts falling through the command deck's observation window along the
 * moonlight, and slow dust motes drifting through them. Additive, unlit, not pickable; one mesh for
 * all shafts plus one small particle system.
 *
 * `lightDir` is the direction the moonlight travels (the scene's directional light direction).
 */
export function buildHqAtmosphere(scene: Scene, lightDir: Vector3, high: boolean, particles: number): { dispose(): void } {
  const d = lightDir.normalize();
  const W = HQ_WINDOW;
  // Streaky gradient: bright at the window, fading toward the floor, broken into soft columns.
  const { c, ctx } = canvas(256, 64);
  const img = ctx.createImageData(256, 64);
  const r = rng(311);
  const cols = Array.from({ length: 24 }, () => 0.35 + r() * 0.65);
  for (let y = 0; y < 64; y++) {
    const v = y / 63;
    const fall = Math.pow(1 - v, 1.6) * Math.min(1, v * 8 + 0.15);
    for (let x = 0; x < 256; x++) {
      const u = x / 255;
      const k = u * (cols.length - 1);
      const i0 = Math.floor(k);
      const f = k - i0;
      const col = cols[i0] * (1 - f) + cols[Math.min(cols.length - 1, i0 + 1)] * f;
      const edge = Math.min(1, u * 12, (1 - u) * 12);
      const a = fall * col * edge;
      const p = (y * 256 + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = Math.min(255, a * 255);
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = toTexture('hqShaftTex', c, scene);
  const mat = unlit(scene, 'hqShaft', [0.5, 0.43, 0.33], { tex, additive: true, twoSided: true });

  // Sheets from the window line at several heights down to where that ray meets the floor.
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const sheets = high ? 6 : 4;
  for (let s = 0; s < sheets; s++) {
    const y = W.y0 + 0.2 + ((W.y1 - W.y0 - 0.4) * (s + 0.5)) / sheets;
    const t = y / -d.y;
    const base = pos.length / 3;
    const z = W.z + 0.05;
    pos.push(W.x0, y, z, W.x1, y, z, W.x1 + d.x * t, 0.02, z + d.z * t, W.x0 + d.x * t, 0.02, z + d.z * t);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const shafts = new Mesh('hqShafts', scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.uvs = uvs;
  vd.indices = idx;
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  vd.normals = normals;
  vd.applyToMesh(shafts);
  shafts.material = mat;
  shafts.isPickable = false;
  shafts.applyFog = false;
  shafts.freezeWorldMatrix();

  // Dust motes drifting through the deck (density follows the particle setting).
  const count = Math.round((high ? 140 : 70) * Math.max(0, Math.min(1.5, particles)));
  const dust = new ParticleSystem('hqDust', Math.max(1, count), scene);
  dust.particleTexture = flareSprite(scene);
  dust.emitter = new Vector3(0, 2.6, -4);
  dust.minEmitBox = new Vector3(-9, -2.2, -6.5);
  dust.maxEmitBox = new Vector3(9, 2.4, 9);
  dust.color1 = new Color4(1, 0.92, 0.8, 0.35);
  dust.color2 = new Color4(0.8, 0.9, 1, 0.2);
  dust.colorDead = new Color4(0, 0, 0, 0);
  dust.minSize = 0.015;
  dust.maxSize = 0.045;
  dust.minLifeTime = 7;
  dust.maxLifeTime = 14;
  dust.emitRate = count / 10;
  dust.direction1 = new Vector3(-0.06, -0.03, -0.05);
  dust.direction2 = new Vector3(0.06, 0.05, 0.05);
  dust.minEmitPower = 0.1;
  dust.maxEmitPower = 0.25;
  dust.blendMode = ParticleSystem.BLENDMODE_ADD;
  dust.preWarmCycles = 60;
  dust.preWarmStepOffset = 5;
  if (count > 0) dust.start();
  return {
    dispose() {
      dust.dispose();
      shafts.dispose();
    },
  };
}
