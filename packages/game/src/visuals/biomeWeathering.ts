import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { ArenaLayout } from '@riftwarden/rules/world/layout';
import type { DressingHost } from './arenaDressing';
import type { Palette } from './materials';
import { canvas, fbm, rng, toTexture } from './textures';
import { rimeSurface } from './rimeSurface';

/** Settled snow, icicles, ash and clinker hug existing solids. No collision or hazard semantics. */
export function biomeWeathering(h: DressingHost, P: Palette, L: ArenaLayout): void {
  if (h.scene.getEngine() instanceof NullEngine) return;
  const cryo = L.biome === 'cryo';
  const foundry = L.biome === 'foundry';
  const random = rng((L.seed ?? 0) ^ 0x4927);
  const powder = new PBRMaterial('biomeDeposit:powder', h.scene);
  powder.albedoColor = cryo ? new Color3(0.72, 0.85, 0.94) : foundry ? new Color3(0.10, 0.065, 0.045) : new Color3(0.22, 0.20, 0.16);
  powder.metallic = 0;
  powder.roughness = 1;
  const { c, ctx } = canvas(128);
  const pixels = ctx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const u = (x + .5) / 128, v = (y + .5) / 128;
    const n = fbm(u, v, 9, 3, 82);
    const edge = Math.hypot((u - .5) * 2, (v - .5) * 2);
    const i = (y * 128 + x) * 4;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = (0.78 + n * .22) * 255;
    pixels.data[i + 3] = Math.max(0, Math.min(1, (1 - edge + (n - .5) * .55) * 3)) * 255;
  }
  ctx.putImageData(pixels, 0, 0);
  powder.albedoTexture = toTexture('settledPowder', c, h.scene);
  powder.albedoTexture.hasAlpha = true;
  powder.useAlphaFromAlbedoTexture = true;
  powder.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
  powder.alphaCutOff = 0.22;
  const deposit = new PBRMaterial(cryo ? 'biomeDeposit:snow' : 'biomeDeposit:clinker', h.scene);
  deposit.albedoColor = cryo ? new Color3(0.76, 0.86, 0.94) : new Color3(0.085, 0.064, 0.050);
  deposit.roughness = cryo ? 0.91 : 0.98;
  deposit.metallic = cryo ? 0 : 0.12;
  if (cryo) deposit.bumpTexture = rimeSurface(h.scene).bumpTexture;
  else { deposit.bumpTexture = P.rust.bumpTexture; deposit.albedoTexture = P.wear.albedo; }
  P.lit.push(powder, deposit);
  const solids = L.boxes.filter(b => ['block', 'machine', 'container', 'platform', 'barrier'].includes(b.kind) && b.min[1] < .1).slice(0, 40);
  for (const [index, b] of solids.entries()) {
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const width = b.max[0] - b.min[0], depth = b.max[2] - b.min[2];
    for (const side of [-1, 1]) {
      const x = cx + side * (width / 2 - .08);
      const stamp = MeshBuilder.CreateGround('settledPowder', { width: 1.7, height: Math.min(6, depth + 1.2) }, h.scene);
      stamp.position.set(x, .022, cz);
      h.add(stamp, powder, null);
      if (cryo || foundry) {
        const drift = MeshBuilder.CreateSphere('settledDrift', { diameter: 1, segments: 12 }, h.scene);
        drift.position.set(x, -.035, cz + (random() - .5) * depth * .3);
        drift.scaling.set(cryo ? 1.25 : .8, cryo ? .38 + random() * .23 : .22, Math.min(5.5, depth * .8 + .5));
        drift.rotation.y = (random() - .5) * .12;
        h.add(drift, deposit, null);
      }
      if (cryo && b.kind === 'platform' && index % 2 === 0) {
        // Ice hangs from service sills, with its base touching the existing facade.
        const bays = Math.max(1, Math.floor(depth / 3.4));
        const bay = Math.floor(random() * bays);
        const sillZ = b.min[2] + (bay + .5) * depth / bays;
        const sillY = b.min[1] + (b.max[1] - b.min[1]) * .38 - .675;
        for (let k = 0; k < 4; k++) {
          const height = Math.min(Math.max(.15, sillY - .18), .18 + random() * .48);
          const ice = MeshBuilder.CreateCylinder('sillIce', { height, diameterTop: .08 + random() * .06, diameterBottom: .008, tessellation: 6 }, h.scene);
          ice.position.set(cx + side * (width / 2 + .08), sillY + .015 - height / 2, sillZ + (k - 1.5) * .18);
          h.add(ice, deposit, null);
        }
      }
    }
    if (foundry && b.kind === 'machine') {
      const vent = MeshBuilder.CreateBox('hotServiceVent', { width: .07, height: .16, depth: Math.min(1.4, depth * .5) }, h.scene);
      vent.position.set(b.min[0] - .025, .65, cz);
      h.add(vent, P.orangeDim, null);
    }
  }
}
