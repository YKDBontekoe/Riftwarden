# CC0 art and music pass

Third-party CC0 assets (Poly Haven models and textures, OpenGameArt music) give each biome its own look and the game a
score. Pipeline and licence rules: [ADR 0004](../decisions/0004-cc0-asset-pipeline.md); provenance:
[`docs/assets/credits.md`](../assets/credits.md). Skies and backdrops are unchanged; each biome has its own light identity (below).

## Sources

- `assets-src/cc0.sources.json` lists every asset; `node scripts/fetch-cc0.mjs [ids] [--force]` downloads, checks the
  licence (Poly Haven is CC0; an OpenGameArt page must list CC0 as its only licence), converts and rewrites
  `packages/game/src/assets/cc0/manifest.json` and the credits file. Needs curl and ffmpeg (libwebp, libmp3lame).
- Output: `models/*.glb` (1K or 512 px WebP textures embedded with `EXT_texture_webp`), `sets/<id>-{albedo,normal,arm}.webp`
  (full surface sets; ground and masonry normals carry the height map in alpha), `textures/<id>-detail.webp` (high-passed
  scans in Babylon's detail map layout), `music/*.mp3` (-18 LUFS, 96 kbit/s).

## Arena surfaces (`visuals/biomeSurfaces.ts`)

- `applyBiomeSurfaces` replaces the procedural maps of the palette's `floor`, `concrete`, `panel` and `rust` with the
  biome's scanned set (`BIOME_SURFACES`): outpost = damaged concrete yard, cast concrete walls, red painted steel;
  cryo = packed snow, cast slabs, blue plate; foundry = scorched deck, factory brick, corroded sheet. Ground tiles
  every 5-6 m (the ground plane's UVs span the yard); box-projected solids keep their metre tiles (masonry 3 m,
  cladding 4 m).
- `graphite` (machinery casings, braces, housings, trims) takes the biome's worn painted steel (`*-casing`: outpost
  green, cryo grey plate, foundry rusted). A low-frequency stain / wear field (`yardMacro`, darker toward the walls)
  multiplies the ground through the lightmap slot (`useLightmapAsShadowmap`), so the tiled scan never reads as a carpet.
- High quality turns on parallax occlusion (`depth` per surface) from the height in the normal alpha.
- The maps share the palette's ARM layout, so swapping never changes shader defines. The old procedural maps are
  disposed. Headless (`NullEngine`) skips all of it.
- Scanned micro detail (`visuals/scanDetail.ts`) is layered on graphite, black steel and bare metal (paint scan) and on
  the HQ deck, walls and ceiling. Not on white trims or enamel: the paint streaks read as wood grain there.

## Sky light and sun shafts (`visuals/skyLight.ts`)

- Each biome lights its PBR surfaces from a CC0 Poly Haven HDRI (`assets/cc0/hdri/*.hdr`, 1K, prefiltered on load
  through `HDRCubeTexture`) as `scene.environmentTexture`; the visible sky dome is unchanged. The old in-scene cube
  capture is the fallback when the file cannot load (offline before first use; `.hdr` is not precached).
- High quality adds volumetric sun shafts: an additive, unfogged disc far along `Atmosphere.sunDir` feeds a
  `VolumetricLightScatteringPostProcess` (ratio 0.5, 60 samples), so gantries and stacks cut shafts through the haze.
- MSAA is 4x on High (Babylon's TAA disables itself while the camera moves, which an FPS camera always does).

## Biome light (`visuals/biomeLight.ts`)

`applyBiomeLight` (called once by `Game`) sets per biome: camera grade exposure / contrast (the mood director still adds
boss / event / reactor moods on top), the `stormFill` hemispheric light's sky colour, ground bounce and intensity, IBL
strength on the palette and props, and a sun multiplier. Outpost = warm dusk with dusty bounce (exposure 1.46),
cryo = cold daylight with snow bounce, foundry = furnace orange welling up from below. With the HDRI as real sky
light the fill is back to ~0.6-1.0 and exposure ~1.0-1.2; the ground's IBL is 55% of the rest (rough concrete and
snow mirrored the blue dusk sky as frost). No light is added
(frame budget). Black steel albedo is lifted x1.9 so panels stop reading as holes. Lightning flashes now add to the
biome sun (`Game.sunBase`) instead of resetting it to the bare constant.

## Architecture: freight containers (`visuals/containerModel.ts`)

Container stacks are real ISO containers instead of a box with ribs: trapezoidal side corrugation at the 278 mm
pitch, corrugated rear wall, two door leaves with four locking bars, cam keepers, brackets, handles and hinges,
corner posts, side and end rails, eight corner castings and a dimpled roof (the top level's roof is the buildable
`platform` surface). One container per ~2.6 m level, door end and livery seeded from the box position. Liveries are
full scanned painted-steel sets (`scannedMaterial` in `biomeSurfaces.ts`), hardware is black steel. The layout box
stays the collider; contact grime keeps only its floor band on containers (`floorOnly`), since their walls sit inside
the box face. Geometry winding is clockwise-from-outside (Babylon is left-handed); normals come from
`VertexData.ComputeNormals`. Next in this pass: buildings (`block`), perimeter walls, machinery banks.

## Architecture: substations, barriers, gates

- `block` solids are dressed as transformer bays (`visuals/substationModel.ts`): plinth with kerb, ribbed tank,
  radiator fin banks with headers, porcelain HV/LV bushings, conservator on brackets, cable box, ladder. Inside the
  collision box; rooftop props are therefore placed on containers only.
- Barriers are precast panel walls (~3 m panels, recessed joints, proud cap, tie plates). Their ends stop 4 mm short
  of the box: an L-corner where an end face is flush with the other wall's side face z-fights, and SSAO turned that
  into a black streak.
- Gate tunnels are cast concrete; the sealed blast door's bevelled parts get world-scale box-projected UVs
  (`ArenaDynamics.part`). Architecture glows use the palette's `decorCyan` / `decorOrange` / `decorBright` (well
  below bloom); the shared `cyanGlow` / `orangeDim` / `cyanDim` stay at full strength because towers, enemies and the
  reactor use them for readability. Blast-door hazard chevrons are paint (`enamel`). Elevated decks get guard railings
  (`visuals/railing.ts`, open where a ramp lands). Slag pools are a molten crust texture (dark plates, glowing seams).

## Machinery (`visuals/machineModel.ts`)

`machine` solids are plant, not boxes with glow slots: rear enclosure with access doors and louvres, pump skids
(volute and finned motor in blue-grey drive enamel, yellow coupling guard, valved riser with handwheel) into a flanged
galvanised header, a roof cable tray and filter vessels at `machineRoofSlots`, exactly where the three gameplay
roof colliders stand. One dim status lamp per bay is the only emissive. Bare steel (`P.metal`) is weathered
galvanised (albedo 0.46, rough) instead of near-white.

## Ground relief (`visuals/groundRelief.ts` [pure], `uv.ts` `sculptGround`)

The ground is a subdivided grid (0.6 m high quality, 1.1 m otherwise) displaced by `GroundRelief.height`: settled
6 m slabs with their own offset and tilt, pooling dips, cryo drifts, sunken scorch around foundry slag (|h| <= 0.16 m).
A 1 m fade mask makes it exactly 0 on lanes, the reactor plaza, the spawn, build pads, hazards, rifts, vents, ramps
and within 2.2 m of solids, so feet, props, rubble, grime and floor paint stay flush. The Havok collider stays the
flat plane; the ground mesh gets `accelerateStaticPicking` (shots and placement pick it). The ground span is rounded up
to a multiple of 12 m (0.6 / 1.2 m lattice), so lattice lines fall on the 6 m slab grid and the relief steps sit
under the floor joints.

## Floor detail (`visuals/floorPlan.ts` [pure], `visuals/floorDetail.ts`)

What turns one tiled scan into a worked yard; visual only, never pickable, one mesh per layer.

- **Slab tones**: the yard macro lightmap (`biomeSurfaces.ts` `yardMacro`, 2048 px, cryo 512) gives every 6 m slab
  its own shade (0.8-1.1) on top of the wear field.
- **Saw-cut joints** on the slab grid (not cryo): two-tone strips, a near-black core with pale spalled shoulders, so
  they read on any deck. Replaced slabs and trench strips get the same cut around their outline.
- **Patches**: the biome's second scanned set (`*-patch`: outpost asphalt_02 repairs, foundry metal_plate tread
  covers, cryo snow_02 powder drifts with a ragged alpha-tested outline), 1 cm proud.
- **Cracks** (branching random-walk mask, not cryo), **oil / soot spots**, **worn yellow walkway lines** 3.6 m off
  each perimeter wall (not cryo), broken wherever something stands on them.
- **Standing water / ice**: flat discs at a water level found by walking down the relief's dips; the disc is the
  smallest one whose rim is everywhere above the water, so the ground forms the shoreline. Dark, low-roughness and
  dimmed IBL (full IBL mirrored the dusk sky as flat blue blobs; foundry at 0.35).
- `floorFree` keeps all layers off solids, the reactor plaza (11.6 m), pads, hazards, vents, rifts, ramps and the
  1.2 m wall band. `GroundSurface.height` reproduces the ground mesh's triangles (CreateGround lattice and diagonal),
  so overlays follow the relief without floating. Own seed stream `seed ^ 0x5f1a7`.

## PBR corrections for scans

`SET_PBR` (biomeSurfaces.ts) fixes scans that mark painted steel as metal (metal_plate_02 averages 0.91 metal) or are
very glossy (blue plate): under an IBL captured from a dusk scene they rendered near-black. Painted steel is a
dielectric; black steel is lifted and set to metallic 0.25.

## Props

- Catalogue `rules/world/propCatalog.ts` (species, footprint, roles, `longZ`), loader `visuals/propLibrary.ts`:
  lazy glTF loader plus `EXT_texture_webp` (deep imports: every extension must be imported), one container per
  species and scene, instanced, pivot moved to the footprint centre on the floor, never pickable, no physics,
  frozen world matrices. `configureProps` sets lights / IBL / albedo per scene; `setPropShadowSink` hands loaded parts
  to the sun's shadow generator (queued until it exists). The co-op server and tests skip loading.
- Arena placement `rules/world/propPlan.ts` (pure, seed `seed ^ 0xa55e7`, never shifts rubble or gameplay rolls):
  wall-foot vignettes (`rules/world/propVignettes.ts`: hand-authored story clusters such as drum huddles with a tipped
  barrel, three-high pallet stacks, tyre piles, generator bays, dumpsters, gas bottles, parked cars, pipe stores, fire
  corners) at inside corners first, then at irregular 6-15 m gaps, mirrored and turned slightly off the wall line,
  each with a ragged ground stain (`contactGrime.ts` `buildStains`); props take an optional `tilt` (lying items rest
  on their side), wall-mounted lamps every other bay, deck clusters
  on the long sides of blocks / machinery / containers, rooftop plant (air-con, ducts, cabinets, searchlights). Every
  floor prop passes the rubble plan's `spotBlocked` (lanes with margin, reactor, spawn, reserved, vents, ramps, inside
  solids) and keeps clear of rubble. Per-biome recipes (foundry fire barrels and gas, cryo crates and cars, outpost
  drums and barriers). Cap `MAX_ARENA_PROPS` = 160.
- Wall lamps get fake light (`visuals/fixtureGlow.ts`): additive splash down the wall, glowing lens, floor pool, one
  merged mesh each, coloured per biome. No real lights (budget).
- HQ clutter (`home/hqClutter.ts`, pure): per room, seeded wall slots offer small clusters (tool chests, shelves, boxes,
  welding cart, drums in reclamation, freight in the launch bay) clear of portals and station consoles (relocated
  consoles included). HomeBase keeps up to five per room whose footprint passes `footprintClear` (3x3 downward ray
  picks from just above the cluster height): the room's own racks, shelves and scrap are never overlapped. HQ walls
  have a 0.3 m plinth and a rail at ~0.8 m, so clusters stand 0.36 m (low) / 0.5 m (tall) off the wall line.

## Contact grime (`visuals/contactGrime.ts`)

Every grounded solid's open faces (arena) and every HQ wall base get three merged strips (floor strips fade out
past their ends through vertex alpha, so they never end in a tile-like edge): a tight contact shadow, a
ragged floor band (outpost mud, cryo snow drift, foundry pale ash so it reads on the dark deck, HQ light dust) and staining up the wall. Lit,
alpha-blended, no depth write, z-offset under decals. Removes the clean CG line where floor meets wall.

## Music (`audio/musicPlan.ts` [pure], `audio/Music.ts`)

- Four CC0 loops: HQ (Airy, SRG774), prep (Pulse, SRG774), combat (Fight or Flee, Tsorthan Grove), boss
  (Hunter-class Lifeform, vitalezzz). `musicTarget` gives one track weight per state (boss wins in combat) and
  layer levels: pulse (sawtooth bass, minor pentatonic, root per run seed), drums (always on in combat, harder with
  intensity), riser (low reactor). Intensity grows with enemies alive / cap, events, boss, reactor damage, kill chain.
- Runtime on the shared `Sfx` context: `musicBus` -> tactical lowpass -> master. Loops crossfade (~2.5 s) and
  overlap 2 s at the wrap; muted tracks stop. Layers are scheduled on the audio clock (25 ms timer, 0.12 s
  lookahead, 118 BPM). Stingers (synthesised): wave start / clear, checkpoint, boss in (ducks), boss down,
  legendary+ drop (`jackpot`), defeat. `music.update` runs in `Game`, `ClientGame` (replicated phase) and `HomeBase`.
- Setting `musicVolume` (default 0.6, optional field, no settings version bump); Settings > Audio > Music.
- `window.__rift.music.state` exposes track weights, layers and intensity.

## Budget

37.6 MB in the repository. Props and loops are not precached by the service worker (`apps/client/sw-plugin.ts`
`LAZY`); surface sets are. An arena downloads only its biome's sets (~3-5 MB) and the props it places.

## Tests

- `tests/asset-manifest.test.ts`: every file listed, CC0, hash and size match, 40 MB budget, every species and track
  has a file. `tests/prop-plan.test.ts`: deterministic, dense, off lanes / reactor / spawn, per-biome dressing, rubble
  stream unchanged, HQ clutter inside rooms and clear of doors and consoles, vignette items rest on the floor.
  `tests/floor-plan.test.ts`: every floor layer off solids and gameplay floor, joints on the slab grid, pools inside
  a dry rim, deterministic, ground sampler exact at lattice vertices. `tests/music.test.ts`: one track per
  state, calm HQ, monotone intensity, deterministic patterns, `dt`-correct easing, setting sanitize.
- Browser: music state HQ -> prep -> combat checked through `__rift.music.state`; screenshot reviews of the three
  biomes and the HQ rooms (SwiftShader, not representative of GPU colour).

## Not done yet

- Real-GPU look check of the new exposure / fill levels (tuned on SwiftShader captures).
- Loops were picked by licence and metadata, not auditioned; swap in `assets-src/cc0.sources.json`.
- Props have no collision: the drone and shots pass through them (like rubble). Large deck pieces (cars, dumpsters)
  are the most noticeable.
- No fire / smoke on foundry fire barrels; no real light from wall lamps.
- Player-built Architect rooms get no clutter or grime.
- Multi-part Poly Haven models with nested node transforms (steel shelves, tool cart, storage cart) render as one
  oversized part through `placeProps`' pivot normalisation; they are left out of every recipe until that is fixed.
