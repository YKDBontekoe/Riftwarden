# packages/game: simulation and Babylon presentation

The arena (`core/Game.ts`, one run), the HQ (`home/HomeBase.ts`), enemies, weapons, towers, effects, audio, and the co-op
pair `net/ServerGame.ts` (authoritative, runs headless in the sim worker) / `net/ClientGame.ts` (replica).

## Rules

- **No React.** UI lives in `apps/client`; this package publishes HUD snapshots to `hudStore` (20 Hz) and instant
  feedback through `uiEvents`. Per-tick values bind through signals (`LiveText`/`LiveBar` in the client).
- **`Game.ts` is the hotspot** (~2400 lines). Do not grow it: put new arena systems in `arena/` behind a narrow host
  interface built by a private `*Host()` method (pattern: `arena/DevTools.ts`, `arena/PlayerCombat.ts`), and decision
  logic in `packages/rules`. No `Game` value import under `arena/` (architecture test).
- **Co-op twins.** Anything that changes simulation must work in three places: solo `Game`, `ServerGame` (per-avatar via
  `as(avatar, fn)`), and `ClientGame` (replica: no hostile simulation, puppets interpolated 100 ms behind). Overrides say
  `override`. Replicated presentation goes through `net/replicated.ts` and the recorder; new event tags go in
  `@riftwarden/protocol/events`.
- **Enemies**: archetypes are `Behavior` plug-ins registered by `Game`; `EnemyManager` (pool, routing, damage
  resolution) never imports a behaviour. Every rig is prebuilt and its materials force-compiled at arena build.
- **One damage pipeline**: every source goes through `Director.deal()`; player weapon hits through `PlayerCombat`.
- **Babylon**: deep imports only; side-effect registrations in `babylonSideEffects.ts`; glows and HDR emissives use
  `unlit()` (never StandardMaterial); never `clone()` a palette material or DynamicTexture; custom shaders need a WGSL
  twin in `visuals/wgsl.ts`. Use Havok/Babylon picking, raycasts, particles before custom systems.
- **Pooling and budgets**: effects are pooled and capped; gameplay never depends on a visual.
- **Two clocks**: real `dt` for the player, weapon, towers, UI; hostile `hdt` (tactical time, hitstop) for enemies.

## Docs

Start at [`docs/systems/README.md`](../../docs/systems/README.md); the core arena rules are in
[`core-arena.md`](../../docs/systems/core-arena.md), co-op in [`coop-construction.md`](../../docs/systems/coop-construction.md).
