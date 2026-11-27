# Performance and frame pacing

How the arena stays smooth in late-game fights (hundreds of machines, towers, drops and effects), the rules that keep
it that way, and how to measure it. Numbers: [`../testing/performance.md`](../testing/performance.md). The frame-loop
decision: [ADR 0003](../decisions/0003-frame-pacing-adaptive-quality.md).

## Frame loop

- `Flow.frame` (the only render loop) runs one variable simulation step per rendered frame, then renders. `FrameClock`
  (`core/frameClock.ts`) removes timer jitter without losing time and clamps hitches to 1/20 s. The camera and the
  drone are updated in the frame they are shown (lowest input latency). The co-op server runs fixed 60 Hz steps;
  replicas interpolate enemies 100 ms behind (`net/ClientGame.ts` tracks).
- Frame-rate independence: smoothing and per-frame chances scale with `dt` (`1 - pow(1 - k, dt * 60)` keeps the 60 Hz
  behaviour exactly). Per-event chances (per hit, per DOT tick) need no scaling. A new per-frame `x += (t - x) * k` or
  `Math.random() < p` in an update loop is a bug at 144 Hz.

## Adaptive quality

- `core/adaptiveQuality.ts` [pure]: one-second windows judged by their 90th percentile frame time against the target
  (Settings > Display > Adaptive quality: Off / 60 / 120 / 144, default 60). Two overloaded windows step down, six
  windows with headroom step up, two-window cooldown after every change; frames over 250 ms (loading, tab switch) are
  ignored. Levels: cosmetic effect density first (x0.7), then render resolution (x0.9 / 0.8 / 0.7 with effects down
  to x0.45).
- Applied by `Flow.applyAdaptive` (render scale in `Flow.resize`, `Game.setEffectLoad` -> `Effects.setDensity(level,
  load)` and the atmosphere's ambient particles). Gameplay visuals (enemies, telegraphs, projectiles, HUD) are never
  scaled. A new scene keeps the level and measures afresh.
- Off under `?test` (suites need fixed visuals) unless `flow.adaptiveUnderTest = true`. In headless SwiftShader every
  frame exceeds the 250 ms cut-off, so the controller never acts there; real-time behaviour is unverified.
- F3 shows 1% / 0.1% low FPS and the p99 frame time (`core/frameStats.ts`, last 1200 frames) and `adaptive fx xN`
  when the effect load is below 1.

## Picking (rays against the level)

- Merged level shells (`arena:<mat>|wall` etc., 15k triangles on the classic arena, 125k on procedural ones) answer
  ray picks from a static triangle BVH (`world/triangleBvh.ts` [pure], installed by `world/fastPick.ts` at the merge in
  `visuals/arena.ts` / `home/HqBuilder.ts`). Results equal Babylon's brute force exactly (same Moller-Trumbore test,
  float64, nearest hit, lowest triangle index on ties). The mesh's geometry must not change after the call.
- Gameplay picks go through `metadataPicker(scene)` (`world/pickCandidates.ts`): Babylon's own `PickWithRay` /
  `MultiPickWithRay` over a scene view whose `meshes` are only the meshes with `metadata`, so the predicate is not
  run over 20k+ enemy part instances. Contract: pick-relevant `metadata` (`surface`, `enemy`, `turret`) is assigned when
  the mesh is created. The list is marked stale synchronously by wrapping the scene's `addMesh`/`removeMesh` (Babylon
  announces new meshes on a later tick).
- Arena and HQ set `skipPointerMove/Down/UpPicking`: nothing uses Babylon pointer events, and each click picked the
  whole scene.
- LOS stays on Havok raycasts (`Game.los`).

## Materials and shaders (hitches)

- Babylon marks a material's users dirty by scanning every mesh in the scene, on every property change. Never write a
  material property per frame (scorch decals fade with `mesh.visibility`, which is the same shader term); build
  materials created mid-fight inside `freshMaterial(() => ...)` (`visuals/freshMaterial.ts`), which skips the scan
  while the new material cannot have users yet. Item materials (`weapons/materials.ts` `surface`, `weaponGlow`,
  `heatMetal`, shells, paints, rims) do this.
- Arena pickups share accent glows (`loot/itemModels.ts`) and weapon rig materials (`weapons/model.ts`, `pickup`)
  per scene; never dispose them with one model. Viewmodel and previews keep their own (they animate them).
- `Game.warmShaders` compiles every pooled (disabled) mesh's shader through `visuals/warmPools.ts` (one job per
  material, geometry and instanced variant): `whenReadyAsync` skips disabled meshes, so pools used to compile on first
  use mid-fight. Blended unlit effect materials ignore non-uniform scaling (`flatEffectMaterial`), so stretching a
  pooled bolt, tracer, ring or decal no longer flips the `NONUNIFORMSCALING` variant.
- Never enable or disable a light mid-run: it changes every lit mesh's light list, and every lit material compiles a
  new variant at once. The sealed south gate keeps its light enabled at intensity 0 (`visuals/atmosphere.ts`
  `setGateOpen`). Since 8-light materials take the first eight enabled lights, the sealed gate's light now holds its
  slot from the start, as it already did once the gate opened.
- Never set `visibility` on an `InstancedMesh` (no effect, and Babylon logs a warning each time). Any per-frame Babylon
  warning is a leak: `Logger` prepends every message to one cache string (`Logger._LogCache`).

## Simulation scaling

- Enemy separation (`enemies/separation.ts` [pure]): uniform grid above 48 bodies, same pairs in the same order as
  the pairwise loop (bit-identical, tests).
- Navigation: a field change (tower placed/wrecked, survival retarget) re-plans at most `NAV_TUNING.replansPerFrame`
  (32) agents per frame; the rest follow their previous path until their turn (~130 ms for 250 agents at 60 Hz).
  Forced re-plans (`navV = -1`) are never deferred. `NavGrid` memoises string-pulled path tails per cell and field
  version (identical paths).
- Loot drops: several drops in one frame build the first model at once and the rest one per frame while in flight
  (`loot/LootField.ts` `pendingModels`).

## HUD

- `Store.set` keeps the previous reference for deep-equal plain data (`ui/store.ts` `samePlain`), so HUD blocks the
  game rebuilds every 20 Hz publish (`abilities`, `moves`, `conds`, `m5`, `m6`) no longer re-render their components.
  `runHud` publishes whole seconds. Per-tick values still bind through `LiveText` / `LiveBar`.

## Co-op

- Server tick and bandwidth are measured by `scripts/bench-coop.mjs` (headless `ServerGame`, no network). Snapshots
  are protobuf with quantised fields and per-enemy AI deltas (`ServerGame.netSnapshot`); the generic `ai` map
  (string-keyed values) is most of the bytes.

## Tests

- `tests/fast-pick.test.ts` (BVH = Babylon brute force on 3000 rays, scene picks, predicates), `tests/pick-candidates.test.ts`
  (metadata picker = scene picks under churn; same-tick mesh), `tests/fresh-material.test.ts`, `tests/separation.test.ts`
  (grid = pairwise loop, 5 crowds x 30 frames), `tests/navgrid-pull.test.ts` (memoised pull = plain pull),
  `tests/arena-gen.test.ts` (re-plan budget), `tests/adaptive-quality.test.ts` (controller, frame stats, setting),
  `tests/hud-store.test.ts`.
- Benchmarks: `scripts/bench-perf.cjs` (browser scenarios early / late / extreme / loot / extended, optional CPU
  profile with `BENCH_PROFILE=1`, new shader variants with `BENCH_EFFECTS=<prefix>`), `scripts/bench-coop.mjs`.

## Not done yet

- Enemy rigs are ~75 instanced kit parts each (19k instances at 250 machines): rendering is instanced, but Babylon
  still evaluates every part node per frame (`_evaluateActiveMeshes`, world matrices). Baking the static parts under
  each animated node into one template mesh per kind would cut that several-fold; it is an art-pipeline change.
- Snapshot bandwidth: ~190 KB/s per player at 120 enemies. Packed per-archetype AI fields and interest management
  (send far machines less often) need a protocol change (`PROTOCOL_VERSION`, owner approval); the gateway has no
  WebSocket compression.
- Real-GPU frame times, GPU cost of the high preset and adaptive quality's feel are unmeasured (SwiftShader only).
- Loot templates for a new base still build on first drop (one per frame at most).
