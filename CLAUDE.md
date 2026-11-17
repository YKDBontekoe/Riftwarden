# Riftwarden: project notes for future sessions

Browser FPS + tower-defense roguelite. Current milestone: **M1 complete** (see "Milestones"). Read this before changing code.

## Stack

- **Babylon.js 8** (`@babylonjs/core`) for rendering, picking, particles, post-processing.
- **Havok** (`@babylonjs/havok`, Babylon Physics v2) for the static level collider, the player's `PhysicsCharacterController`, and line-of-sight raycasts.
- **React 18** for HUD and menus (`src/ui`), fed by a tiny external store.
- **Vite 7 + TypeScript (strict)**, **Vitest** for unit tests. No backend.

Use engine features before writing custom systems (user direction): collision, picking, raycasts and particles come from Babylon/Havok.

## Layout

```
src/main.tsx               boot: Havok WASM, Engine, Flow, React root, ?test hook; the ONLY render loop
src/core/Flow.ts           session controller: Input, Profile, HQ <-> arena scene swaps, run lifecycle, debug API
src/core/Game.ts           ONE survival run (arena world): scene/lights/pipeline, damage pipeline, checkpoints, HUD
src/home/HomeBase.ts       HQ world: scene, lights, Player reuse, station interaction, live station screens
src/home/HqBuilder.ts      HQ static shell from modular components (wall run, floor, ceiling, door frame, window...)
src/home/props.ts          station rigs (launch ring, holo-table, drone cradle, racks, workshop) + placeable builders
src/home/layout.ts         HQ rooms/portals/stations data + wallSegments()            [pure]
src/home/interaction.ts    pickInteractable: view cone + range + occlusion callback   [pure]
src/home/placeables.ts     persistent customisable HQ objects + defaults               [pure]
src/progression/save.ts    versioned/checksummed SaveData, sanitize, migrations, game-rule mutations [pure]
src/progression/run.ts     RunLedger: unsecured/secured/lost rewards, idempotent finalize [pure]
src/progression/items.ts   slot defs, item defs (point at real WeaponDefs), item instances [pure]
src/progression/tiers.ts   threat tiers + checkpoint interval                          [pure]
src/progression/Profile.ts owns the SaveData; mutate() persists + publishes a snapshot store
src/visuals/envCapture.ts  one-shot reflection-probe IBL capture (shared by arena and HQ)
src/core/Input.ts          keyboard/mouse edges, pointer lock, simulateKey/simulateMouse for automation
src/core/tactical.ts       TacticalEnergy (time dilation rules) + Wallet  [pure]
src/core/settings.ts       versioned/validated localStorage settings     [pure]
src/world/layout.ts        ARENA data: boxes, ramps, lane routes, reactor, spawn [pure, single source of truth]
src/world/geometry.ts      distance helpers                              [pure]
src/world/physicsGroups.ts Havok filter masks (ENV vs PLAYER)
src/visuals/arena.ts       builds arena meshes (merged per material, box-projected world UVs) + one static compound Havok body
src/visuals/kit.ts         unit-primitive model kit; one hidden source mesh per (shape, material), GPU instances everywhere
src/visuals/models.ts      walker/bulwark, rush drone, Sentinel turret, reactor rigs (animated plasma core, glass shell, beam)
src/visuals/materials.ts   PBR palette (metal/roughness + textures) and `unlit()` HDR emissives (> 1 feeds bloom)
src/visuals/textures.ts    procedural textures: tileable fbm, height->normal, floor/wall/wear PBR sets, particle sprites
src/visuals/uv.ts          box-projected UVs for merged static meshes
src/visuals/atmosphere.ts  storm sky shader + rift tear + lightning, rift portal shader, lamp light shafts, wall sconces,
                           distant skyline, dust/ash/gate embers, one-shot reflection-probe environment capture
src/visuals/postfx.ts      SSAO2 + SSR (high), HDR bloom, ACES, colour grade, grain, chromatic aberration kicks
src/player/Player.ts       hover drone movement on PhysicsCharacterController, camera, health/respawn
src/combat/Weapon.ts       plasma repeater: heat, spread, recoil, viewmodel (rendering group 1)
src/combat/damage.ts       rollDamage / applyDamage / mulberry32     [pure]
src/combat/stats.ts        CombatStats + StatModifier stacking         [pure]
src/enemies/EnemyManager.ts pooled enemies, route following, attacks, separation, stuck watchdog
src/defense/placement.ts   placement rules                            [pure]
src/defense/Construction.ts build mode: engine picks + footprint samples -> validatePlacement
src/defense/Turrets.ts     Sentinel targeting/aiming/firing
src/waves/waves.ts         wave definitions + endless generator       [pure]
src/waves/WaveManager.ts   prep/combat/cleared lifecycle, spawn cap   [pure, hooks-based]
src/fx/Effects.ts          pooled tracers, debris, enemy projectiles, particle bursts, flash light
src/audio/Sfx.ts           procedural WebAudio bank
src/ui/                    React App (menus, pause, checkpoint, defeat, summary, transit), Hud (arena), HomeHud,
                           Terminals (deploy/loadout/storage/workshop/command), store + uiEvents, CSS
tests/                     Vitest suites for the [pure] modules
scripts/e2e-m1.cjs         browser acceptance suite (70 checks: scenarios A-G, tiers, leaks, persistence)
```

## Key design decisions

### M1: sessions, scenes and persistence

- **One world at a time.** `Flow` owns the engine loop, the single `Input` (window listeners are registered once), the `Profile` and either a `HomeBase` or a `Game`. `Flow.transition()` paints the transit overlay, disposes the old Babylon scene completely (`scene.dispose()`: meshes, materials, textures, physics world, post-processes, observers), builds the next, waits (bounded 8 s) for `whenReadyAsync` while rendering but not simulating, then reveals it. A new run is always a new `Game`, so towers, enemies, waves, effects and wallet can never leak between runs. Pointer lock lives on the shared canvas and survives the swap (request it inside the click gesture, before any await).
- **Never `clone()` a palette material** (it clones DynamicTextures, which come out blank and never report ready; that stalled readiness for 8 s on every transition). Build fresh `PBRMaterial`s instead.
- **Run lifecycle.** HQ deploy → `beginRun` (save.activeRun) → arena. Kills and wave clears `collect` salvage into `RunLedger.unsecured`. Every 5th cleared wave the ledger `bank()`s and `Flow` commits it with `bankRewards` (guarded by `activeRun.bankedThroughWave`, so repeated hooks cannot duplicate). The following prep phase opens the checkpoint choice (`Game.checkpointOpen`; H reopens it until combat starts). `returnHome` / defeat / pause-abandon → `RunLedger.finalize()` (idempotent; unsecured becomes lost) → `recordRun` (idempotent by run id) → HQ. A save that still has `activeRun` on load was closed mid-run and is recorded once as `interrupted`.
- **Save format** (`riftwarden.save` in localStorage): `{"v":1,"sum":"<fnv1a of data json>","data":SaveData}`. SaveData = profile, resources.salvage, items[] (every owned item; each uid is in exactly one of loadout/storage), storage{capacity,uids}, loadout{weapon,armor,shield,reactor,processor,module,accessory}, threat{selected,unlocked}, records{tier:{bestWave(cleared),bestKills,runs,checkpoints,salvageSecured,longestRun}}, totals, history (last 12), activeRun, base{layoutVersion, placeables[], facilities[]}. Load: checksum/parse failure → raw text kept in `riftwarden.save.corrupt`, previous good save restored from `riftwarden.save.bak` (rotated on every write) or defaults. Newer versions are refused, older ones go through `MIGRATIONS[n]`. `sanitizeSave` repairs everything else (never deletes owned items, re-equips a weapon if needed). Writes happen only on committed rule changes (deploy, bank, run end, tier select, equip), never per frame.
- **Rewards in M1** are salvage only (persistent resource, no sink yet; the workshop says so). Items are modelled end to end (ledger, banking into storage, equip-from-storage for functional slots) but nothing drops them until M2; tests use fixture items. Only the weapon slot is functional; other slots are defined and shown as empty.
- **Threat tiers** (`tiers.ts`) multiply wave hp/damage/speed/count via `getWave(n, scaling)`; salvage scales by `salvageMult`. Tier N+1 unlocks at the first checkpoint on tier N. Records are per tier.
- **HQ customisation foundation.** Static architecture is code (`layout.ts` + `HqBuilder`); everything a player will later move/add is a `Placeable {uid,type,position,rotationY,scale,props}` in `save.base.placeables`, rebuilt by `buildPlaceable` on every visit (sanitised: unknown types dropped, positions clamped to `PLACEABLE_BOUNDS`).
- **Interaction.** `pickInteractable` picks the station focus point closest to view centre inside a cone (widens up close) and range (`INTERACT_RANGE`, per-station override), rejecting points occluded by a Havok `ENV_QUERY` ray that stops 0.4 m short (the focus sits on the station's own collider). E opens a terminal (screen `terminal`, pointer released); E/Esc closes (Esc cannot re-lock the pointer in browsers, so it falls back to the pause overlay).
- **Canvas textures on planes** go through `props.planeBuilder` (faces local +z, V flipped for DynamicTexture). Unlit materials have zero reflectance (`metallicF0Factor = 0`) so SSR never paints over screens/glows.

### M0

- **Two clocks.** `update(dt)` uses real time for player, weapon, turrets, UI; `hdt = dt * tactical.hostileScale` for enemies, enemy projectiles and spawn timing. Tactical mode only dilates hostiles.
- **Lanes are reserved.** Enemies follow fixed polylines (`ARENA.routes`) with per-enemy lateral offset; placement forbids towers within `laneHalfWidth + radius` of a lane on the floor, so construction can never block navigation. A 5 s stuck watchdog snaps enemies to their waypoint.
- **Hit detection.** Player hitscan uses `scene.multiPickWithRay` against meshes tagged `metadata.surface` (level) or `metadata.enemy` (invisible hitbox spheres: body + weakpoint). Turret hitboxes (`metadata.turret`) are only used for inspection, shots pass through. LOS checks use Havok raycasts with `ENV_QUERY` so they ignore the player capsule.
- **Damage pipeline.** All damage goes through `Game.damageEnemy` -> `rollDamage` -> `EnemyManager.damage` (`applyDamage`: shields first, energy +50% vs shields). Feedback (hitmarker, numbers, sounds) is emitted from there. Future triggered effects hook in here.
- **Stats.** `Game.modifiers: StatModifier[]` -> `computeStats` -> `Game.stats`, read by weapon, turrets and movement. Loot and run upgrades should only add modifiers.
- **Gameplay vs visuals.** Effects are pooled and capped (`Effects.particleBudget`); logic never depends on them.
- **Rendering.** Surfaces are `PBRMaterial` (`usePhysicalLightFalloff = false`, so light intensities/ranges behave like the old StandardMaterial setup). Every glow/beam/additive sprite uses `unlit()` (PBR unlit = colour x texture, unclamped HDR). Do NOT use StandardMaterial for tinted or HDR glows: it adds emissive textures and clamps to 1.
- **Environment.** `Atmosphere.captureEnvironment` renders the static scene once (after `executeWhenReady`) into a ReflectionProbe, wraps the cube in a plain `BaseTexture`, prefilters it with `HDRFiltering`, and sets `scene.environmentTexture`. Never reference the probe's RTT from a material (it would re-render while sampled: GL feedback loop). DynamicTexture `clone()` yields a blank texture: build a second texture from the canvas instead.
- **Screen-space passes** (SSAO/SSR) use a separate geometry buffer (`forceGeometryBuffer`), not the prepass MRT, because prepass breaks particle rendering. Sprite-sheet particle systems also rendered incorrectly; use single sprites with random rotation.
- **Explosions** go through `Effects.explode(pos, {scale, debris, color})`: star flash, additive fireball, stretched sparks, embers, rising smoke, ground + air shockwave rings, smoke-trailing debris, flash light, scorch decal and a camera-shake request (`onShake` -> `Player.addTrauma` + lens kick). Shots on level geometry use `Effects.impact` (sparks, dust puff, burn decal).
- **UI.** Game publishes a HUD snapshot to `hudStore` at 20 Hz; instant feedback goes through `uiEvents`. Damage numbers animate imperatively (no per-frame React renders).
- **Data-driven content** in `src/data/defs.ts` (weapon, enemies, tower, economy).

## Testing

- `npm test`: unit tests for damage, stats, tactical/wallet, layout lane clearance, placement rules, wave generation and the wave lifecycle, settings, save format/migration/corruption, run ledger + banking rules, tiers, HQ layout and interaction targeting.
- `node scripts/e2e-m1.cjs` (dev server on :5173, Playwright): M1 acceptance scenarios A-G, tiers, interrupted runs, 4 deploy/return cycles with resource/listener/heap leak checks. Last run: 70/70 passed.
- Browser automation: open `/?test`. This sets `input.forceCapture` (no pointer lock needed) and exposes `window.__rift` (`Flow.debugApi()`) with `state()` (location, screen, profile summary + current world snapshot), `look(yaw, pitch)`, `advance(seconds)` (fixed 60 Hz simulation of the current world, no rendering), `stopLoop()`, `render(frames)`, `killAll()` (through the real damage pipeline), `leakStats()`, and `flow`, `profile`, `game` (current arena or null), `home`. Drive the loop with `flow.enterHq()`, `flow.deploy(tier)`, `flow.returnHome()`, `flow.abandonRun()`, `flow.leaveArena()`. Note: a real Playwright mouse move feeds `mouseDx` while `forceCapture` is on; `advance(1/60)` before `look()` after DOM clicks. In SwiftShader the high preset takes ~1 s per frame: call `stopLoop()`, wait for `game.scene.environmentTexture`, then interleave `advance(1/60)` + `render(1)` and screenshot with a long timeout. Drive input with `game.input.simulateKey(code, down)` / `simulateMouse(button, down)`. Headless Chromium uses SwiftShader (very low FPS), so verify gameplay with `advance()` and take screenshots between calls.

## Measured (headless SwiftShader, so GPU numbers are not representative)

- M1 HQ (high preset): ~110 draw calls, 165 active meshes, 0.23 ms simulation per frame. Arena with 9 enemies, high preset with cascaded shadows: ~320 draw calls.
- Scene build (CPU, incl. procedural textures): arena ~1.0-1.4 s, HQ ~0.9-2.7 s; dispose ~20-50 ms. Readiness (shader compile) dominates in SwiftShader (6-8 s); expected far shorter on a real GPU (unmeasured).
- 4 deploy -> wave 5 -> return cycles: 1 scene alive; HQ textures/meshes/materials/lights identical every cycle (35/392/56/8 on the low preset), arena identical (31/556/61/8), listener counts flat, JS heap flat (133 MB).

- Simulation: ~0.8 ms/frame with 42 enemies + 6 turrets, ~1.5 ms while firing.
- Draw calls: ~87 baseline, ~130 with 40 enemies + 6 turrets (instancing works).
- Production bundle: ~1.4 MB gzip JS (Babylon barrel import) + 0.66 MB gzip Havok WASM.

## Known limitations / follow-ups

- Real-GPU frame rate not measured in this environment; use F3 on target hardware.
- Babylon is imported from the barrel (`@babylonjs/core`), so the bundle is large. Switching to deep imports would cut startup size.
- Turrets cannot be damaged and have no upgrades; core income outpaces spending in later waves (needs sinks later).
- Salvage has no sink yet (workshop/merchants come later). No item drops exist, so storage stays empty in normal play (item path verified with fixtures).
- Transitions wait for `whenReadyAsync` (cap 8 s); real-GPU transition time is unmeasured. The arena scene sometimes reports not-ready again after the first resolve (render targets); harmless.
- Closing a terminal with Esc cannot re-acquire pointer lock (browser rule): the pause overlay asks for a click. E closes and re-locks.
- Graphics quality applies immediately in the HQ (rebuild), on the next scene in the arena.
- Run suspension/resume is out of scope: closing the tab mid-run records it as `interrupted` (secured salvage kept, unsecured lost).
- High preset cost (SSR + SSAO + MSAA + 8 lights on PBR) is unmeasured on real GPUs; `Performance` preset drops SSR/SSAO/shadows/MSAA. Profile with F3.
- No per-enemy hit flash yet (instanced PBR parts would need an instanced colour buffer).
- Enemies do not attack turrets; walkers only target the reactor and shoot the player.
- Gate frame pillars near the openings are visual only (no collider).
- No loot drops, run upgrades, bosses, music, or multiplayer yet (by design).

## Milestones

- **M0 (done):** arena, movement, plasma repeater, Sentinel turret + placement, tactical mode, walker + rush drone (+ Bulwark elite), 3 hand waves + endless generator, HUD/menus, restart.
- **M1 (done):** explorable HQ with interactive stations, deployment with threat tiers I-III, 5-wave checkpoints with automatic banking and continue/return choice, defeat/abandon handling, versioned persistent save (records, salvage, loadout, storage, placeables), repeated scene transitions without leaks.
- **M2 next:** loot: equipment drops (physical pickups, collected -> unsecured -> banked into storage via the existing ledger), item generation/rarity, more weapon archetypes to make the loadout/storage UI meaningful, a first salvage sink.
- Later: combat depth (second tower, turret upgrades, enemy variety, hit flash, audio pass, deep-import bundle split), M3 run upgrades, M4 modular towers, M5 advanced endless (bosses/events), M6 content, M7 co-op evaluation.
