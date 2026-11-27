import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { type PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import type { BiomeId } from '@riftwarden/rules/world/biomes';
import type { Palette } from './materials';

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
export const BIOME_SURFACES: Record<BiomeId, { ground: SurfaceLook & { tile: number }; masonry: SurfaceLook; cladding: SurfaceLook; rust: SurfaceLook }> = {
  outpost: {
    ground: { set: 'outpost-ground', tint: [1.05, 1.02, 0.98], normal: 1, tile: 5, depth: 0.045 },
    masonry: { set: 'outpost-masonry', tint: [0.8, 0.82, 0.84], normal: 0.9, depth: 0.03 },
    cladding: { set: 'outpost-metal', tint: [0.86, 0.8, 0.78], normal: 0.7 },
    rust: { set: 'shared-rust', tint: [1, 1, 1], normal: 0.8 },
  },
  cryo: {
    ground: { set: 'cryo-ground', tint: [0.93, 0.97, 1.04], normal: 0.9, tile: 6, depth: 0.04 },
    masonry: { set: 'cryo-masonry', tint: [0.86, 0.9, 0.95], normal: 0.8, depth: 0.03 },
    cladding: { set: 'cryo-metal', tint: [0.95, 1, 1.05], normal: 0.7 },
    rust: { set: 'shared-rust', tint: [0.8, 0.84, 0.9], normal: 0.8 },
  },
  foundry: {
    ground: { set: 'foundry-ground', tint: [0.78, 0.72, 0.68], normal: 1.1, tile: 5, depth: 0.05 },
    masonry: { set: 'foundry-masonry', tint: [0.82, 0.74, 0.7], normal: 1, depth: 0.04 },
    cladding: { set: 'foundry-metal', tint: [0.78, 0.74, 0.72], normal: 0.8 },
    rust: { set: 'shared-rust', tint: [0.9, 0.78, 0.7], normal: 0.9 },
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
  // ARM carries the real roughness and metal: the factors pass it through unchanged.
  m.metallic = 1;
  m.roughness = 1;
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
}
