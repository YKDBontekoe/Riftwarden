import { Color3, Constants, PBRMaterial, type Scene, Texture } from '@babylonjs/core';
import { canvas, fbm, heightToNormal, rng, toTexture, vnoise } from '../visuals/textures';
import type { Finish } from './build';

/**
 * Weapon material library (one per scene, shared by every weapon model in it).
 * A small, consistent set: matte graphite, satin metal, dark mechanical parts, grip
 * polymer, tinted energy glass and a shell/trim pair per finish. Per-model animated
 * materials (energy glow, heat-reactive metal) are created by `weaponGlow`/`heatMetal`.
 */
export interface WeaponMaterials {
  graphite: PBRMaterial;
  satin: PBRMaterial;
  dark: PBRMaterial;
  polymer: PBRMaterial;
  copper: PBRMaterial;
  glass: PBRMaterial;
  markings: PBRMaterial;
  shell(f: Finish): PBRMaterial;
  trim(f: Finish): PBRMaterial;
}

interface Micro {
  albedo: Texture;
  orm: Texture;
  normal: Texture;
}

const LIBS = new WeakMap<Scene, WeaponMaterials>();

/** Brushed and lightly worn finish shared by the viewmodel and the workshop preview. */
function micro(scene: Scene): Micro {
  const size = 256;
  const { c: ac, ctx: a } = canvas(size);
  const { c: oc, ctx: o } = canvas(size);
  const albedo = a.createImageData(size, size);
  const orm = o.createImageData(size, size);
  const height = new Float32Array(size * size);
  const { ctx: scratch } = canvas(size);
  const random = rng(721);
  for (let i = 0; i < 96; i++) {
    const x = random() * size, y = random() * size;
    const length = 0.8 + random() ** 2.5 * 16;
    scratch.strokeStyle = `rgba(255,255,255,${0.19 + random() * 0.55})`;
    scratch.lineWidth = 0.6 + random() * 0.75;
    scratch.beginPath();
    scratch.moveTo(x, y);
    scratch.lineTo(x + length, y + length * 0.16);
    scratch.stroke();
  }
  const scratches = scratch.getImageData(0, 0, size, size).data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const grain = fbm(u, v, 8, 3, 77) - 0.5;
      const brush = vnoise((u + v) * 5, v * 112, 5, 12, 112) - 0.5;
      const rub = Math.max(0, fbm(u, v, 5, 3, 40) - 0.55);
      const i = (y * size + x) * 4;
      const scrape = scratches[i + 3] / 255;
      const tint = 0.90 + grain * 0.11 + brush * 0.06 + rub * 0.38 + scrape * 0.25;
      albedo.data[i] = albedo.data[i + 1] = albedo.data[i + 2] = tint * 255;
      albedo.data[i + 3] = 255;
      orm.data[i] = 255;
      orm.data[i + 1] = (0.89 + grain * 0.19 + brush * 0.15 - rub * 0.52 - scrape * 0.26) * 255;
      orm.data[i + 2] = orm.data[i + 3] = 255;
      height[y * size + x] = grain * 0.085 + brush * 0.05 - scrape * 0.037;
    }
  }
  a.putImageData(albedo, 0, 0);
  o.putImageData(orm, 0, 0);
  const normal = toTexture('wpnMicroNrm', heightToNormal(height, size, 2.2), scene, { srgb: false });
  normal.level = 0.31;
  return {
    albedo: toTexture('wpnMicroAlb', ac, scene),
    orm: toTexture('wpnMicroOrm', oc, scene, { srgb: false }),
    normal,
  };
}

function markingMaterial(scene: Scene): PBRMaterial {
  const { c, ctx } = canvas(384, 192);
  for (const [i, name] of ['PR–01', 'LC–02', 'FO–03'].entries()) {
    const row = i * 64;
    ctx.fillStyle = '#ff996e';
    ctx.save();
    ctx.translate(20, row + 9);
    ctx.transform(1, 0, -0.42, 1, 0, 0);
    ctx.fillRect(10, 0, 11, 43);
    ctx.fillRect(26, 0, 11, 43);
    ctx.restore();
    ctx.fillStyle = '#ecebdb';
    ctx.font = 'bold 41px Arial, sans-serif';
    ctx.fillText(name, 68, row + 47);
    ctx.fillRect(241, row + 44, 112, 2);
    ctx.fillStyle = '#ff996e';
    ctx.fillRect(333, row + 37, 20, 5);
  }
  const texture = toTexture('weaponMarkingAtlas', c, scene);
  texture.hasAlpha = true;
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  const material = new PBRMaterial('wpnMarkings', scene);
  material.albedoTexture = texture;
  material.useAlphaFromAlbedoTexture = true;
  material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
  material.alphaCutOff = 0.31;
  material.unlit = true;
  material.roughness = 1;
  material.metallic = 0;
  material.metallicF0Factor = 0;
  material.zOffset = -1;
  return material;
}

function surface(scene: Scene, m: Micro, name: string, albedo: [number, number, number], metallic: number, roughness: number, clearCoat = 0): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  mat.albedoColor = new Color3(...albedo);
  mat.albedoTexture = m.albedo;
  mat.metallic = metallic;
  mat.roughness = roughness;
  mat.usePhysicalLightFalloff = false;
  mat.maxSimultaneousLights = 6;
  mat.metallicTexture = m.orm;
  mat.useAmbientOcclusionFromMetallicTextureRed = true;
  mat.useRoughnessFromMetallicTextureGreen = true;
  mat.useMetallnessFromMetallicTextureBlue = true;
  mat.useRoughnessFromMetallicTextureAlpha = false;
  mat.bumpTexture = m.normal;
  mat.environmentIntensity = 1.3;
  if (clearCoat) {
    mat.clearCoat.isEnabled = true;
    mat.clearCoat.intensity = clearCoat;
    mat.clearCoat.roughness = 0.12;
  }
  return mat;
}

const SHELL: Record<Finish, [[number, number, number], number, number, number?]> = {
  arctic: [[0.85, 0.85, 0.76], 0.07, 0.48, 0.19],
  gunmetal: [[0.15, 0.16, 0.18], 0.65, 0.34, 0.3],
  sand: [[0.58, 0.51, 0.39], 0.02, 0.5, 0.35],
  slate: [[0.22, 0.29, 0.37], 0.08, 0.42, 0.5],
  gilded: [[0.045, 0.045, 0.05], 0.1, 0.32, 0.8],
  iridescent: [[0.06, 0.06, 0.075], 1, 0.16],
};

const TRIM: Record<Finish, [[number, number, number], number, number]> = {
  arctic: [[0.55, 0.57, 0.6], 1, 0.3],
  gunmetal: [[0.7, 0.71, 0.74], 1, 0.24],
  sand: [[0.12, 0.12, 0.13], 0.8, 0.42],
  slate: [[0.68, 0.7, 0.72], 1, 0.26],
  gilded: [[1.0, 0.74, 0.36], 1, 0.22],
  iridescent: [[0.62, 0.62, 0.66], 1, 0.18],
};

export function weaponMaterials(scene: Scene): WeaponMaterials {
  const cached = LIBS.get(scene);
  if (cached) return cached;
  const m = micro(scene);
  const shells = new Map<Finish, PBRMaterial>();
  const trims = new Map<Finish, PBRMaterial>();
  const glass = new PBRMaterial('wpnGlass', scene);
  glass.albedoColor = new Color3(0.05, 0.09, 0.11);
  glass.metallic = 0;
  glass.roughness = 0.04;
  glass.alpha = 0.32;
  glass.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  glass.usePhysicalLightFalloff = false;
  glass.environmentIntensity = 1.6;
  glass.useRadianceOverAlpha = true;
  glass.useSpecularOverAlpha = true;
  glass.backFaceCulling = true;
  const lib: WeaponMaterials = {
    graphite: surface(scene, m, 'wpnGraphite', [0.08, 0.087, 0.096], 0.52, 0.64),
    satin: surface(scene, m, 'wpnSatin', [0.47, 0.48, 0.52], 0.82, 0.46),
    dark: surface(scene, m, 'wpnDark', [0.03, 0.031, 0.035], 0.85, 0.4),
    polymer: surface(scene, m, 'wpnPolymer', [0.028, 0.028, 0.03], 0, 0.82),
    copper: surface(scene, m, 'wpnCopper', [0.62, 0.32, 0.17], 0.73, 0.43),
    glass,
    markings: markingMaterial(scene),
    shell(f) {
      let mat = shells.get(f);
      if (!mat) {
        const [a, met, r, cc] = SHELL[f];
        mat = surface(scene, m, `wpnShell_${f}`, a, met, r, cc);
        if (f === 'iridescent') {
          mat.iridescence.isEnabled = true;
          mat.iridescence.intensity = 1;
          mat.iridescence.indexOfRefraction = 1.6;
          mat.iridescence.minimumThickness = 250;
          mat.iridescence.maximumThickness = 650;
        }
        shells.set(f, mat);
      }
      return mat;
    },
    trim(f) {
      let mat = trims.get(f);
      if (!mat) {
        const [a, met, r] = TRIM[f];
        mat = surface(scene, m, `wpnTrim_${f}`, a, met, r);
        trims.set(f, mat);
      }
      return mat;
    },
  };
  LIBS.set(scene, lib);
  return lib;
}

/** Unlit HDR energy material owned by one model (animated: pulses, charge, heat tint). */
export function weaponGlow(scene: Scene, name: string, c: [number, number, number], additive = false): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.unlit = true;
  m.albedoColor = Color3.Black();
  m.metallic = 0;
  m.roughness = 1;
  m.metallicF0Factor = 0;
  m.emissiveColor = new Color3(...c);
  if (additive) {
    m.alphaMode = Constants.ALPHA_ADD;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    m.disableDepthWrite = true;
    m.backFaceCulling = false;
  }
  return m;
}

/** Heat-reactive dark metal owned by one model: emissive rises from black to orange-white. */
export function heatMetal(scene: Scene, name: string): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = new Color3(0.05, 0.05, 0.055);
  m.metallic = 0.85;
  m.roughness = 0.38;
  m.usePhysicalLightFalloff = false;
  m.emissiveColor = new Color3(0, 0, 0);
  m.environmentIntensity = 1.2;
  return m;
}

/** Emissive colour of glowing metal at heat h (0..1): black -> deep red -> orange -> yellow-white. */
export function heatColor(h: number, out: Color3): Color3 {
  const x = Math.max(0, Math.min(1, h));
  const k = x * x;
  return out.set(k * 3.2 + x * 0.25, k * k * 1.6 + k * 0.35, k * k * k * 0.6);
}
