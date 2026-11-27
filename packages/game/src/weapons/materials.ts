import { Constants } from '@babylonjs/core/Engines/constants';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { type Scene } from '@babylonjs/core/scene';
import { surfaceGrain } from '../visuals/surfaceSources';
import { freshMaterial } from '../visuals/freshMaterial';
import { canvas, fbm, heightToNormal, rng, toTexture, vnoise } from '../visuals/textures';
import type { Finish } from '@riftwarden/rules/weapons/build';

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
  frostCeramic: PBRMaterial;
  glass: PBRMaterial;
  markings: PBRMaterial;
  shell(f: Finish, pickup?: boolean): PBRMaterial;
  trim(f: Finish): PBRMaterial;
  equipmentPaint(color: string): PBRMaterial;
  equipmentFin: PBRMaterial;
  equipmentContacts: PBRMaterial;
  equipmentCeramic: PBRMaterial;
}

interface Micro {
  albedo: Texture;
  orm: Texture;
  normal: Texture;
}

const LIBS = new WeakMap<Scene, WeaponMaterials>();

/** Seam positions across the tile (irregular so panels differ in length). */
const SEAMS_U = [0.07, 0.31, 0.49, 0.78];

/** Brushed and lightly worn finish shared by the viewmodel and the workshop preview. */
function micro(scene: Scene, finish: 'paint' | 'metal' | 'polymer' | 'equipment'): Micro {
  const size = 256;
  const chipped = finish === 'equipment';
  const coated = finish === 'paint' || chipped;
  const { c: ac, ctx: a } = canvas(size);
  const { c: oc, ctx: o } = canvas(size);
  const albedo = a.createImageData(size, size);
  const orm = o.createImageData(size, size);
  const height = new Float32Array(size * size);
  const { ctx: scratch } = canvas(size);
  const random = rng(721);
  for (let i = 0; i < (finish === 'polymer' ? 0 : chipped ? 138 : 96); i++) {
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
  const steel = surfaceGrain('steel', size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const grain = fbm(u, v, 8, 3, 77) - 0.5;
      const brush = vnoise((u + v) * 5, v * 112, 5, 12, 112) - 0.5 + steel(x, y) * 0.6;
      const rub = Math.max(0, fbm(u, v, 5, 3, 40) - 0.55);
      const i = (y * size + x) * 4;
      const scrape = scratches[i + 3] / 255;
      // Handling grime collects in broad patches; rubbed-through areas and scratches read brighter.
      const grime = Math.max(0, fbm(u, v, 4, 3, 91) - 0.5) * 0.55;
      // Machined panel breaks (tile = 0.5 m of weapon): irregular seams across the length,
      // one along it, with a fastener beside each seam. Grooves are dark, rough and recessed.
      let seam = 0;
      for (const su of SEAMS_U) seam = Math.max(seam, 1 - Math.min(1, Math.abs(u - su) * size / 1.3));
      seam = Math.max(seam, 1 - Math.min(1, Math.abs(v - 0.58) * size / 1.3));
      let bolt = 0;
      for (const su of SEAMS_U) for (const bv of [0.14, 0.39, 0.83]) {
        const d = Math.hypot((u - su - 0.022) * size, (v - bv) * size);
        if (d < 2.6) bolt = Math.max(bolt, 1 - d / 2.6);
      }
      const rim = Math.min(u, 1 - u, v, 1 - v);
      const wear = coated ? Math.max(0, 1 - rim / .018) * Math.max(0, .6 + grain * 3) : 0;
      const brokenPaint = chipped ? Math.min(1, Math.max(0, grain + brush * .44 - .035) * 7 * (wear + seam * .48 + bolt * 1.6 + scrape * .36)) : 0;
      if (!coated) { seam *= finish === 'polymer' ? 0 : .25; bolt = 0; }
      const stipple = finish === 'polymer' ? Math.sin(u * 420) * Math.sin(v * 420) * .035 : 0;
      const tint = (0.88 + grain * 0.10 + brush * (finish === 'metal' ? .12 : .035) + rub * .22 + scrape * .25 + wear * .22 - grime) * (1 - seam * .45) + bolt * .2 + stipple + brokenPaint * .35;
      albedo.data[i] = albedo.data[i + 1] = albedo.data[i + 2] = Math.min(1, tint) * 255;
      albedo.data[i + 3] = 255;
      orm.data[i] = (1 - seam * 0.5) * 255;
      const rough = finish === 'polymer' ? .97 + stipple : (finish === 'metal' ? .64 : .88) + grain * .10 + brush * .06 - rub * .25 - scrape * .2 - wear * .48 + seam * .1 - brokenPaint * .45;
      orm.data[i + 1] = Math.max(.15, Math.min(1, rough)) * 255;
      orm.data[i + 2] = (coated ? Math.min(1, .045 + wear * .9 + scrape * .55 + brokenPaint) : 1) * 255;
      orm.data[i + 3] = 255;
      height[y * size + x] = grain * .04 + brush * (finish === 'metal' ? .025 : .008) - scrape * .022 - seam * .2 + bolt * .16 + stipple - brokenPaint * .05;
    }
  }
  a.putImageData(albedo, 0, 0);
  o.putImageData(orm, 0, 0);
  const normal = toTexture(`wpn${finish}Nrm`, heightToNormal(height, size, 2.2), scene, { srgb: false });
  normal.level = finish === 'polymer' ? .32 : chipped ? .36 : .22;
  return {
    albedo: toTexture(`wpn${finish}Alb`, ac, scene),
    orm: toTexture(`wpn${finish}Orm`, oc, scene, { srgb: false }),
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

// Item materials are created mid-fight (loot drops): build them inside `freshMaterial` (no scene-wide dirty scans).
function surface(scene: Scene, m: Micro, name: string, albedo: [number, number, number], metallic: number, roughness: number, clearCoat = 0): PBRMaterial {
  return freshMaterial(() => surfaceMaterial(scene, m, name, albedo, metallic, roughness, clearCoat));
}

function surfaceMaterial(scene: Scene, m: Micro, name: string, albedo: [number, number, number], metallic: number, roughness: number, clearCoat: number): PBRMaterial {
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
  mat.environmentIntensity = 1.05;
  if (clearCoat) {
    mat.clearCoat.isEnabled = true;
    mat.clearCoat.intensity = clearCoat;
    mat.clearCoat.roughness = 0.28;
  }
  return mat;
}

const SHELL: Record<Finish, [[number, number, number], number, number, number?]> = {
  arctic: [[0.64, 0.65, 0.63], 0.12, 0.56, 0.12],
  gunmetal: [[0.15, 0.16, 0.18], 0.65, 0.34, 0.3],
  sand: [[0.58, 0.51, 0.39], 0.02, 0.5, 0.35],
  slate: [[0.22, 0.29, 0.37], 0.08, 0.42, 0.5],
  gilded: [[0.045, 0.045, 0.05], 0.1, 0.32, 0.8],
  iridescent: [[0.06, 0.06, 0.075], 1, 0.16],
  /** Ascended: pale pearl ceramic with a heavy clear coat. */
  ascended: [[0.82, 0.86, 0.9], 0.05, 0.22, 1],
};

const TRIM: Record<Finish, [[number, number, number], number, number]> = {
  arctic: [[0.55, 0.57, 0.6], 1, 0.3],
  gunmetal: [[0.7, 0.71, 0.74], 1, 0.24],
  sand: [[0.12, 0.12, 0.13], 0.8, 0.42],
  slate: [[0.68, 0.7, 0.72], 1, 0.26],
  gilded: [[1.0, 0.74, 0.36], 1, 0.22],
  iridescent: [[0.62, 0.62, 0.66], 1, 0.18],
  ascended: [[0.55, 0.9, 1.0], 1, 0.12],
};

export function weaponMaterials(scene: Scene): WeaponMaterials {
  const cached = LIBS.get(scene);
  if (cached) return cached;
  const m = micro(scene, 'metal');
  const paint = micro(scene, 'paint');
  const polymer = micro(scene, 'polymer');
  const shells = new Map<Finish, PBRMaterial>();
  const pickupShells = new Map<Finish, PBRMaterial>();
  const trims = new Map<Finish, PBRMaterial>();
  const equipmentPaints = new Map<string, PBRMaterial>();
  let equipmentCoating: Micro | undefined;
  let fin: PBRMaterial | undefined;
  let contacts: PBRMaterial | undefined;
  let ceramic: PBRMaterial | undefined;
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
    satin: surface(scene, m, 'wpnSatin', [0.56, 0.59, 0.64], 0.82, 0.46),
    dark: surface(scene, m, 'wpnDark', [0.045, 0.051, 0.064], 0.85, 0.48),
    polymer: surface(scene, polymer, 'wpnPolymer', [0.028, 0.028, 0.03], 0, 0.96),
    copper: surface(scene, m, 'wpnCopper', [0.62, 0.32, 0.17], 0.73, 0.43),
    frostCeramic: surface(scene, m, 'wpnFrostCeramic', [0.68, 0.82, 0.9], 0.06, 0.73),
    glass,
    markings: markingMaterial(scene),
    shell(f, pickup = false) {
      const finishes = pickup ? pickupShells : shells;
      let mat = finishes.get(f);
      if (!mat) {
        const [a, met, r, cc] = SHELL[f];
        const painted = f === 'arctic' || f === 'sand' || f === 'slate';
        mat = freshMaterial(() => {
          const shell = surface(scene, painted ? paint : m, `${pickup ? 'pickupShell' : 'wpnShell'}_${f}`, a, painted ? 1 : met, r, cc);
          if (pickup) {
            shell.albedoColor = Color3.Lerp(shell.albedoColor, new Color3(0.62, 0.65, 0.68), 0.18);
            if (!painted && f !== 'iridescent') shell.metallic = Math.min(met, 0.42);
            shell.emissiveColor = shell.albedoColor.scale(0.095);
            shell.emissiveTexture = shell.albedoTexture;
          }
          if (f === 'iridescent') {
            shell.iridescence.isEnabled = true;
            shell.iridescence.intensity = 1;
            shell.iridescence.indexOfRefraction = 1.6;
            shell.iridescence.minimumThickness = 250;
            shell.iridescence.maximumThickness = 650;
          }
          return shell;
        });
        finishes.set(f, mat);
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
    equipmentPaint(color) {
      let mat = equipmentPaints.get(color);
      if (!mat) {
        const coating = equipmentCoating ??= micro(scene, 'equipment');
        const { r, g, b } = Color3.FromHexString(color);
        mat = freshMaterial(() => {
          const paint = surface(scene, coating, `equipmentPaint_${color.slice(1)}`, [r, g, b], 0.82, 0.68);
          paint.emissiveColor = paint.albedoColor.scale(0.11);
          paint.emissiveTexture = coating.albedo;
          return paint;
        });
        equipmentPaints.set(color, mat);
      }
      return mat;
    },
    get equipmentFin() {
      return fin ??= surface(scene, { ...m, albedo: temperTexture(scene) }, 'equipmentHeatTint', [0.72, 0.73, 0.75], 0.8, 0.58);
    },
    get equipmentContacts() {
      return contacts ??= surface(scene, m, 'equipmentWornContacts', [0.81, 0.61, 0.32], 0.84, 0.5);
    },
    get equipmentCeramic() {
      return ceramic ??= surface(scene, polymer, 'equipmentMatteCeramic', [0.72, 0.8, 0.8], 0, 0.88);
    },
  };
  LIBS.set(scene, lib);
  return lib;
}

/** Unlit HDR energy material owned by one model (animated: pulses, charge, heat tint). */
export function weaponGlow(scene: Scene, name: string, c: [number, number, number], additive = false): PBRMaterial {
  return freshMaterial(() => glowMaterial(scene, name, c, additive));
}

function glowMaterial(scene: Scene, name: string, c: [number, number, number], additive: boolean): PBRMaterial {
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
  // Library and temper map first: they may be created now and are not part of this material's scope.
  const albedo = temperTexture(scene);
  const bump = weaponMaterials(scene).dark.bumpTexture;
  return freshMaterial(() => heatMaterial(scene, name, albedo, bump));
}

function heatMaterial(scene: Scene, name: string, albedo: Texture, bump: PBRMaterial['bumpTexture']): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = new Color3(0.30, 0.33, 0.39);
  m.albedoTexture = albedo;
  m.bumpTexture = bump;
  m.metallic = 0.85;
  m.roughness = 0.46;
  m.usePhysicalLightFalloff = false;
  m.emissiveColor = new Color3(0, 0, 0);
  m.environmentIntensity = 1.2;
  return m;
}

const temperMaps = new WeakMap<Scene, Texture>();

/** Restrained blue/purple/straw oxidation bands under the animated hot-metal glow. */
function temperTexture(scene: Scene): Texture {
  const cached = temperMaps.get(scene);
  if (cached) return cached;
  const { c, ctx } = canvas(64, 128);
  const gradient = ctx.createLinearGradient(0, 0, 0, 128);
  for (const [stop, color] of [[0, '#758798'], [.32, '#485f78'], [.53, '#766b87'], [.7, '#97846a'], [1, '#4b535d']]) gradient.addColorStop(stop as number, color as string);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 128);
  const texture = toTexture('weaponTemper', c, scene);
  temperMaps.set(scene, texture);
  return texture;
}

/** Emissive colour of glowing metal at heat h (0..1): black -> deep red -> orange -> yellow-white. */
export function heatColor(h: number, out: Color3): Color3 {
  const x = Math.max(0, Math.min(1, h));
  const k = x * x;
  return out.set(k * 3.2 + x * 0.25, k * k * 1.6 + k * 0.35, k * k * k * 0.6);
}
