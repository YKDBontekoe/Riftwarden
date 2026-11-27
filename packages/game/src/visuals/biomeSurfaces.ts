import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { PBRMaterial as PBRMaterialCtor, type PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import type { BiomeId } from '@riftwarden/rules/world/biomes';
import { SLAB } from './groundRelief';
import type { Palette } from './materials';
import { canvas, fbm, toTexture, vnoise } from './textures';

/**
 * Scanned CC0 surface sets per biome (Poly Haven, `assets/cc0/sets`, provenance in the manifest): they replace the
 * procedural yard deck, masonry, wall cladding and rust maps outright, so each biome reads as its own place:
 * outpost = weathered concrete yard with red-painted steel, cryo = packed snow with blue plate and cast slabs,
 * foundry = scorched brown deck with factory brick and corroded sheet. Everything else (trims, enamel, glows,
 * enemies) keeps its palette material. Same texture layout as the palette sets (ARM = AO / roughness / metal), so
 * swapping maps never changes shader defines; the textures load behind the arena loading screen (transitions wait
 * for scene readiness).
 */
const set = (id: string) => ({
  albedo: new URL(`../assets/cc0/sets/${id}-albedo.webp`, import.meta.url).href,
  normal: new URL(`../assets/cc0/sets/${id}-normal.webp`, import.meta.url).href,
  arm: new URL(`../assets/cc0/sets/${id}-arm.webp`, import.meta.url).href,
});

/** Static URLs (Vite only rewrites literal `new URL` patterns, so every file is spelled out here). */
const SETS = {
  'outpost-ground': {
    albedo: new URL('../assets/cc0/sets/outpost-ground-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/outpost-ground-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/outpost-ground-arm.webp', import.meta.url).href,
  },
  'outpost-masonry': {
    albedo: new URL('../assets/cc0/sets/outpost-masonry-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/outpost-masonry-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/outpost-masonry-arm.webp', import.meta.url).href,
  },
  'outpost-metal': {
    albedo: new URL('../assets/cc0/sets/outpost-metal-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/outpost-metal-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/outpost-metal-arm.webp', import.meta.url).href,
  },
  'cryo-ground': {
    albedo: new URL('../assets/cc0/sets/cryo-ground-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/cryo-ground-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/cryo-ground-arm.webp', import.meta.url).href,
  },
  'cryo-masonry': {
    albedo: new URL('../assets/cc0/sets/cryo-masonry-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/cryo-masonry-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/cryo-masonry-arm.webp', import.meta.url).href,
  },
  'cryo-metal': {
    albedo: new URL('../assets/cc0/sets/cryo-metal-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/cryo-metal-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/cryo-metal-arm.webp', import.meta.url).href,
  },
  'foundry-ground': {
    albedo: new URL('../assets/cc0/sets/foundry-ground-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/foundry-ground-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/foundry-ground-arm.webp', import.meta.url).href,
  },
  'foundry-masonry': {
    albedo: new URL('../assets/cc0/sets/foundry-masonry-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/foundry-masonry-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/foundry-masonry-arm.webp', import.meta.url).href,
  },
  'foundry-metal': {
    albedo: new URL('../assets/cc0/sets/foundry-metal-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/foundry-metal-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/foundry-metal-arm.webp', import.meta.url).href,
  },
  'outpost-casing': {
    albedo: new URL('../assets/cc0/sets/outpost-casing-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/outpost-casing-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/outpost-casing-arm.webp', import.meta.url).href,
  },
  'cryo-casing': {
    albedo: new URL('../assets/cc0/sets/cryo-casing-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/cryo-casing-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/cryo-casing-arm.webp', import.meta.url).href,
  },
  'foundry-casing': {
    albedo: new URL('../assets/cc0/sets/foundry-casing-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/foundry-casing-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/foundry-casing-arm.webp', import.meta.url).href,
  },
  'shared-rust': {
    albedo: new URL('../assets/cc0/sets/shared-rust-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/shared-rust-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/shared-rust-arm.webp', import.meta.url).href,
  },
  'shared-steel': {
    albedo: new URL('../assets/cc0/sets/shared-steel-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/shared-steel-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/shared-steel-arm.webp', import.meta.url).href,
  },
  'outpost-patch': {
    albedo: new URL('../assets/cc0/sets/outpost-patch-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/outpost-patch-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/outpost-patch-arm.webp', import.meta.url).href,
  },
  'cryo-patch': {
    albedo: new URL('../assets/cc0/sets/cryo-patch-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/cryo-patch-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/cryo-patch-arm.webp', import.meta.url).href,
  },
  'foundry-patch': {
    albedo: new URL('../assets/cc0/sets/foundry-patch-albedo.webp', import.meta.url).href,
    normal: new URL('../assets/cc0/sets/foundry-patch-normal.webp', import.meta.url).href,
    arm: new URL('../assets/cc0/sets/foundry-patch-arm.webp', import.meta.url).href,
  },
} satisfies Record<string, ReturnType<typeof set>>;
export type SurfaceSetId = keyof typeof SETS;

/** Which set each palette surface takes per biome, its tint (multiplies the scan) and its tile size in metres. */
interface SurfaceLook {
  set: SurfaceSetId;
  tint: [number, number, number];
  normal: number;
  /** Parallax occlusion depth (UV units) from the height packed in the normal map's alpha; high quality only. */
  depth?: number;
}

/**
 * Per-set PBR corrections. Some scans mark painted steel as bare metal (metal_plate_02 averages 0.91 metal) or are
 * very glossy (blue plate, 0.28 roughness): with an IBL captured from a dusk scene those render near-black, as
 * mirrors of dark surroundings. Painted steel is a dielectric: metal factor down, roughness up.
 */
const SET_PBR: Partial<Record<SurfaceSetId, { metal: number; rough: number }>> = {
  'cryo-casing': { metal: 0.12, rough: 1.1 },
  'cryo-metal': { metal: 1, rough: 1.9 },
  'foundry-casing': { metal: 0.6, rough: 1 },
  'foundry-patch': { metal: 0.4, rough: 1.3 },
};
export const BIOME_SURFACES: Record<BiomeId, { ground: SurfaceLook & { tile: number }; masonry: SurfaceLook; cladding: SurfaceLook; casing: SurfaceLook; rust: SurfaceLook }> = {
  outpost: {
    ground: { set: 'outpost-ground', tint: [0.92, 0.9, 0.87], normal: 1, tile: 7, depth: 0.045 },
    masonry: { set: 'outpost-masonry', tint: [0.8, 0.82, 0.84], normal: 0.9, depth: 0.03 },
    cladding: { set: 'cryo-casing', tint: [0.82, 0.8, 0.76], normal: 0.7 },
    // Weathered grey steel: the green paint covered every gantry, ramp and roof and read as a toy set.
    casing: { set: 'foundry-casing', tint: [0.62, 0.64, 0.66], normal: 0.8 },
    rust: { set: 'foundry-casing', tint: [0.85, 0.8, 0.75], normal: 0.8 },
  },
  cryo: {
    ground: { set: 'cryo-ground', tint: [0.93, 0.97, 1.04], normal: 0.9, tile: 6, depth: 0.04 },
    masonry: { set: 'outpost-masonry', tint: [0.78, 0.84, 0.92], normal: 0.9, depth: 0.03 },
    cladding: { set: 'cryo-metal', tint: [0.95, 1, 1.05], normal: 0.7 },
    casing: { set: 'cryo-casing', tint: [0.6, 0.64, 0.7], normal: 0.8 },
    rust: { set: 'foundry-casing', tint: [0.75, 0.78, 0.84], normal: 0.8 },
  },
  foundry: {
    ground: { set: 'foundry-ground', tint: [0.78, 0.72, 0.68], normal: 1.1, tile: 5, depth: 0.05 },
    masonry: { set: 'foundry-masonry', tint: [0.82, 0.74, 0.7], normal: 1, depth: 0.04 },
    cladding: { set: 'foundry-metal', tint: [0.78, 0.74, 0.72], normal: 0.8 },
    casing: { set: 'foundry-casing', tint: [0.72, 0.66, 0.62], normal: 0.9 },
    rust: { set: 'foundry-casing', tint: [0.9, 0.8, 0.72], normal: 0.9 },
  },
};

function load(scene: Scene, id: SurfaceSetId, scale: number) {
  const urls = SETS[id];
  const tex = (url: string, srgb: boolean) => {
    const t = new Texture(url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    t.gammaSpace = srgb;
    t.anisotropicFilteringLevel = 8;
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.uScale = t.vScale = scale;
    return t;
  };
  return { albedo: tex(urls.albedo, true), normal: tex(urls.normal, false), arm: tex(urls.arm, false) };
}

function apply(m: PBRMaterial, scene: Scene, look: SurfaceLook, scale: number, high: boolean): void {
  const maps = load(scene, look.set, scale);
  // The procedural maps are only replaced, never shared, so disposing them frees their canvases.
  for (const old of [m.albedoTexture, m.bumpTexture, m.metallicTexture]) if (old && old !== maps.albedo) old.dispose();
  m.albedoTexture = maps.albedo;
  m.bumpTexture = maps.normal;
  maps.normal.level = look.normal;
  m.metallicTexture = maps.arm;
  m.albedoColor.set(...look.tint);
  // ARM carries the real roughness and metal; the factors correct scans that mislabel paint as metal.
  const fix = SET_PBR[look.set];
  m.metallic = fix?.metal ?? 1;
  m.roughness = fix?.rough ?? 1;
  if (high && look.depth) {
    // Real relief in joints, cracks and gravel without extra geometry (the scan's height map, steep-parallax).
    m.useParallax = true;
    m.useParallaxOcclusion = true;
    m.parallaxScaleBias = look.depth;
  }
}

/**
 * Swap the arena palette's main surfaces for the biome's scanned sets. `span` is the ground plane's size (its UVs
 * run 0..1 across it); box-projected solids already tile in metres (masonry 3 m, cladding 4 m, metal 2.5 m).
 */
export function applyBiomeSurfaces(scene: Scene, P: Palette, biome: BiomeId, span: number, high = true): void {
  if (scene.getEngine() instanceof NullEngine) return;
  const look = BIOME_SURFACES[biome];
  apply(P.floor, scene, look.ground, span / look.ground.tile, high);
  apply(P.concrete, scene, look.masonry, 1, high);
  apply(P.panel, scene, look.cladding, 1, high);
  apply(P.rust, scene, look.rust, 1, high);
  // Machinery casings, braces, housings and trims (the dark "graphite" paint) get worn painted steel.
  apply(P.graphite, scene, look.casing, 1, high);
  // Macro variation across the whole yard (stains, wet and worn patches, darker ground near the walls), so the
  // tiled scan never reads as one uniform carpet. Multiplies the lighting through the lightmap slot.
  const macro = yardMacro(scene, biome, span);
  P.floor.lightmapTexture = macro;
  P.floor.useLightmapAsShadowmap = true;
}

/**
 * Low-frequency stain / wear field over the ground plane (UV 0..1 = the whole yard), plus a tone per 6 m slab
 * (no two concrete pours cure to the same shade) so the joint grid reads as separate slabs. The noise field is
 * computed at 512 and upsampled; the slab tones are evaluated at 2048 so their edges stay under the joint strips.
 */
function yardMacro(scene: Scene, biome: BiomeId, span: number) {
  const N = 512;
  const field = new Float32Array(N * N);
  const seed = biome === 'cryo' ? 41 : biome === 'foundry' ? 73 : 17;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const broad = fbm(u, v, 6, 4, seed);
      const blotch = Math.max(0, fbm(u, v, 18, 3, seed + 9) - 0.55) * 2.2;
      const streak = Math.max(0, vnoise(u * 40, v * 4, 40, seed + 3, 4) - 0.7) * 1.5;
      // Ground darkens toward the yard edge (runoff and dirt collect along the walls).
      const edge = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
      const rim = Math.max(0, (edge - (1 - 24 / span)) * (span / 24));
      // Gentle: strong blotches on top of a scan's own stains read as camouflage.
      field[y * N + x] = 0.86 + (broad - 0.5) * 0.26 - blotch * 0.16 - streak * 0.1 - rim * 0.22;
    }
  const M = biome === 'cryo' ? N : 2048;
  const { c, ctx } = canvas(M);
  const img = ctx.createImageData(M, M);
  const tone = (si: number, sj: number) => {
    let h = Math.imul(si, 374761393) ^ Math.imul(sj, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const r = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    return r < 0.12 ? 0.8 : r > 0.9 ? 1.1 : 0.9 + r * 0.14;
  };
  for (let y = 0; y < M; y++)
    for (let x = 0; x < M; x++) {
      let k = field[Math.floor((y * N) / M) * N + Math.floor((x * N) / M)];
      if (M !== N) k *= tone(Math.floor(((x + 0.5) / M - 0.5) * span / SLAB), Math.floor(((y + 0.5) / M - 0.5) * span / SLAB));
      const i = (y * M + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0.5, Math.min(1, k)) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = toTexture('yardMacro', c, scene, { srgb: false, aniso: 4 });
  t.wrapU = t.wrapV = 0;
  return t;
}

/** A standalone lit material from a scanned set (containers and other kit that is not a palette surface). */
export function scannedMaterial(scene: Scene, name: string, id: SurfaceSetId, tint: [number, number, number], normal: number, environment: number): PBRMaterial {
  const m = new PBRMaterialCtor(name, scene);
  m.usePhysicalLightFalloff = false;
  m.maxSimultaneousLights = 8;
  m.environmentIntensity = environment;
  m.useAmbientOcclusionFromMetallicTextureRed = true;
  m.useRoughnessFromMetallicTextureGreen = true;
  m.useMetallnessFromMetallicTextureBlue = true;
  if (scene.getEngine() instanceof NullEngine) {
    m.albedoColor.set(...tint);
    return m;
  }
  const maps = load(scene, id, 1);
  m.albedoTexture = maps.albedo;
  m.bumpTexture = maps.normal;
  maps.normal.level = normal;
  m.metallicTexture = maps.arm;
  m.albedoColor.set(...tint);
  const fix = SET_PBR[id];
  m.metallic = fix?.metal ?? 1;
  m.roughness = fix?.rough ?? 1;
  return m;
}
