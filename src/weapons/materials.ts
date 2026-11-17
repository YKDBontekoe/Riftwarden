import { Color3, Constants, PBRMaterial, type Scene, type Texture } from '@babylonjs/core';
import { canvas, fbm, heightToNormal, toTexture, vnoise } from '../visuals/textures';
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
  glass: PBRMaterial;
  shell(f: Finish): PBRMaterial;
  trim(f: Finish): PBRMaterial;
}

interface Micro {
  orm: Texture;
  normal: Texture;
}

const LIBS = new WeakMap<Scene, WeaponMaterials>();

/** Fine micro-surface: roughness breakup + faint brushing (tileable, metre-scaled UVs). */
function micro(scene: Scene): Micro {
  const S = 256;
  const { c: oc, ctx: o } = canvas(S);
  const img = o.createImageData(S, S);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const g = fbm(u, v, 8, 4, 77);
      const brush = vnoise(u * 2, v * 128, 128, 12);
      const i = (y * S + x) * 4;
      img.data[i] = 255; // AO
      img.data[i + 1] = Math.max(0.05, Math.min(1, 0.86 + (g - 0.5) * 0.28 + (brush - 0.5) * 0.12)) * 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
      height[y * S + x] = g * 0.08 + brush * 0.025;
    }
  }
  o.putImageData(img, 0, 0);
  return {
    orm: toTexture('wpnMicroOrm', oc, scene, { srgb: false, aniso: 8 }),
    normal: toTexture('wpnMicroNrm', heightToNormal(height, S, 1.2), scene, { srgb: false, aniso: 8 }),
  };
}

function surface(scene: Scene, m: Micro, name: string, albedo: [number, number, number], metallic: number, roughness: number, opts: { clearCoat?: number; bump?: number } = {}): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  mat.albedoColor = new Color3(...albedo);
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
  mat.bumpTexture.level = opts.bump ?? 0.35;
  mat.environmentIntensity = 1.3;
  if (opts.clearCoat) {
    mat.clearCoat.isEnabled = true;
    mat.clearCoat.intensity = opts.clearCoat;
    mat.clearCoat.roughness = 0.12;
  }
  return mat;
}

const SHELL: Record<Finish, [[number, number, number], number, number, number?]> = {
  arctic: [[0.8, 0.81, 0.82], 0.02, 0.4, 0.55],
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
    graphite: surface(scene, m, 'wpnGraphite', [0.045, 0.048, 0.054], 0.35, 0.58, { bump: 0.5 }),
    satin: surface(scene, m, 'wpnSatin', [0.66, 0.67, 0.7], 1, 0.3, { bump: 0.25 }),
    dark: surface(scene, m, 'wpnDark', [0.03, 0.031, 0.035], 0.85, 0.4),
    polymer: surface(scene, m, 'wpnPolymer', [0.028, 0.028, 0.03], 0, 0.82, { bump: 0.8 }),
    glass,
    shell(f) {
      let mat = shells.get(f);
      if (!mat) {
        const [a, met, r, cc] = SHELL[f];
        mat = surface(scene, m, `wpnShell_${f}`, a, met, r, { clearCoat: cc, bump: 0.2 });
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
        mat = surface(scene, m, `wpnTrim_${f}`, a, met, r, { bump: 0.15 });
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
