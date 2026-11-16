# Riftwarden: project notes for future sessions

Browser FPS + tower-defense roguelite. Current milestone: **M0 complete** (see "Milestones"). Read this before changing code.

## Stack

- **Babylon.js 8** (`@babylonjs/core`) for rendering, picking, particles, post-processing.
- **Havok** (`@babylonjs/havok`, Babylon Physics v2) for the static level collider, the player's `PhysicsCharacterController`, and line-of-sight raycasts.
- **React 18** for HUD and menus (`src/ui`), fed by a tiny external store.
- **Vite 7 + TypeScript (strict)**, **Vitest** for unit tests. No backend.

Use engine features before writing custom systems (user direction): collision, picking, raycasts and particles come from Babylon/Havok.

## Layout

```
src/main.tsx               boot: Havok WASM, Engine, Game, React root, ?test hook
src/core/Game.ts           orchestrator: scene/lights/pipeline, frame loop, damage pipeline, HUD publishing
src/core/Input.ts          keyboard/mouse edges, pointer lock, simulateKey/simulateMouse for automation
src/core/tactical.ts       TacticalEnergy (time dilation rules) + Wallet  [pure]
src/core/settings.ts       versioned/validated localStorage settings     [pure]
src/world/layout.ts        ARENA data: boxes, ramps, lane routes, reactor, spawn [pure, single source of truth]
src/world/geometry.ts      distance helpers                              [pure]
src/world/physicsGroups.ts Havok filter masks (ENV vs PLAYER)
src/visuals/arena.ts       builds arena meshes (merged per material) + one static compound Havok body
src/visuals/kit.ts         unit-primitive model kit; one hidden source mesh per (shape, material), GPU instances everywhere
src/visuals/models.ts      walker/bulwark, rush drone, Sentinel turret, reactor rigs
src/visuals/materials.ts   palette (emissive > 1 feeds HDR bloom)
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
src/ui/                    React App/Hud, store (useSyncExternalStore) + uiEvents emitter, CSS
tests/                     Vitest suites for the [pure] modules
```

## Key design decisions

- **Two clocks.** `update(dt)` uses real time for player, weapon, turrets, UI; `hdt = dt * tactical.hostileScale` for enemies, enemy projectiles and spawn timing. Tactical mode only dilates hostiles.
- **Lanes are reserved.** Enemies follow fixed polylines (`ARENA.routes`) with per-enemy lateral offset; placement forbids towers within `laneHalfWidth + radius` of a lane on the floor, so construction can never block navigation. A 5 s stuck watchdog snaps enemies to their waypoint.
- **Hit detection.** Player hitscan uses `scene.multiPickWithRay` against meshes tagged `metadata.surface` (level) or `metadata.enemy` (invisible hitbox spheres: body + weakpoint). Turret hitboxes (`metadata.turret`) are only used for inspection, shots pass through. LOS checks use Havok raycasts with `ENV_QUERY` so they ignore the player capsule.
- **Damage pipeline.** All damage goes through `Game.damageEnemy` -> `rollDamage` -> `EnemyManager.damage` (`applyDamage`: shields first, energy +50% vs shields). Feedback (hitmarker, numbers, sounds) is emitted from there. Future triggered effects hook in here.
- **Stats.** `Game.modifiers: StatModifier[]` -> `computeStats` -> `Game.stats`, read by weapon, turrets and movement. Loot and run upgrades should only add modifiers.
- **Gameplay vs visuals.** Effects are pooled and capped (`Effects.particleBudget`); logic never depends on them.
- **UI.** Game publishes a HUD snapshot to `hudStore` at 20 Hz; instant feedback goes through `uiEvents`. Damage numbers animate imperatively (no per-frame React renders).
- **Data-driven content** in `src/data/defs.ts` (weapon, enemies, tower, economy).

## Testing

- `npm test`: unit tests for damage, stats, tactical/wallet, layout lane clearance, placement rules, wave generation and the wave lifecycle, settings.
- Browser automation: open `/?test`. This sets `input.forceCapture` (no pointer lock needed) and exposes `window.__rift` with `state()`, `look(yaw, pitch)`, `advance(seconds)` (fixed 60 Hz simulation without rendering) and `game`. Drive input with `game.input.simulateKey(code, down)` / `simulateMouse(button, down)`. Headless Chromium uses SwiftShader (very low FPS), so verify gameplay with `advance()` and take screenshots between calls.

## Measured (headless SwiftShader, so GPU numbers are not representative)

- Simulation: ~0.8 ms/frame with 42 enemies + 6 turrets, ~1.5 ms while firing.
- Draw calls: ~87 baseline, ~130 with 40 enemies + 6 turrets (instancing works).
- Production bundle: ~1.4 MB gzip JS (Babylon barrel import) + 0.66 MB gzip Havok WASM.

## Known limitations / follow-ups

- Real-GPU frame rate not measured in this environment; use F3 on target hardware.
- Babylon is imported from the barrel (`@babylonjs/core`), so the bundle is large. Switching to deep imports would cut startup size.
- Turrets cannot be damaged and have no upgrades; core income outpaces spending in later waves (needs sinks in M1/M4).
- Enemies do not attack turrets; walkers only target the reactor and shoot the player.
- Gate frame pillars near the openings are visual only (no collider).
- No loot, banking, run upgrades, bosses, music, or multiplayer yet (by design for M0).

## Milestones

- **M0 (done):** arena, movement, plasma repeater, Sentinel turret + placement, tactical mode, walker + rush drone (+ Bulwark elite), 3 hand waves + endless generator, HUD/menus, restart.
- **M1 next:** combat polish and depth: second weapon archetype, second tower, turret upgrades as a core sink, enemy variety, hit flash on enemies, audio pass, deep-import bundle split, real-GPU profiling.
- M2 loot + banking, M3 run upgrades, M4 modular towers, M5 advanced endless (bosses/events), M6 content, M7 co-op evaluation.
