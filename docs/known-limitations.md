# Known limitations and follow-ups

Cross-cutting limitations. System-specific gaps are listed under "Not done yet" in each
[`systems/`](systems/README.md) note; check there first.

## Verification gaps

- Real-GPU frame rate, transition time and look are unmeasured: development runs on headless SwiftShader. Profile with
  F3 on target hardware (it shows 1% / 0.1% lows and the p99 frame time). WebGPU stays opt-in (Settings > Renderer,
  `?webgpu`) until checked on a real GPU.
- Adaptive quality cannot be exercised headless (every SwiftShader frame is over its 250 ms cut-off); only the
  controller and its wiring are tested. Its feel on real hardware is unverified.
- Benchmarks (`scripts/bench-perf.cjs`) measure CPU-side simulation exactly; their render times are software GL and
  not representative of a GPU. The scenarios vary somewhat run to run (async compiles, loot ids), so compare medians of
  repeated runs.
- High preset cost (SSR + SSAO + MSAA + 8 lights on PBR) is unmeasured on real GPUs; the Performance preset drops
  SSR/SSAO/shadows/MSAA.
- No real-device check of mobile (iOS Safari fullscreen/orientation, Android install banner, phone frame rates).

## Engine and browser behaviour

- Transitions wait for `whenReadyAsync` (cap 8 s). The arena scene sometimes reports not-ready again after the first
  resolve (render targets); harmless.
- Closing a terminal with Esc cannot re-acquire pointer lock (browser rule): the pause overlay asks for a click. E closes
  and re-locks.
- Graphics quality applies immediately in the HQ (rebuild), on the next scene in the arena.
- The HQ item preview has its own WebGL context while a terminal is open (released on close).
- Gate frame pillars near the openings are visual only (no collider).

## Gameplay and balance

- Balance is first-pass across the board: enemy HP grows faster than item power in very deep endless runs; drop rates and
  weights are in `packages/rules/src/loot/drops.ts` / `rarity.ts`; economy numbers in `economy/config.ts` and
  `economy/recipes.ts`; progression pacing is pinned by `tests/progression-sim.test.ts`.
- Item names are not regenerated after affix rerolls. Weapon attachments are not swappable.
- Only weapons have sockets (gear sockets were removed in save v3).
- Arc Conductor arcs stay untyped (`none`) damage.
- A run closed mid-node is recorded as `interrupted` (secured rewards kept, unsecured lost); only map runs closed after a
  completed node resume, and online runs never resume.
- No music yet.

## Trust

- Solo runs simulate on the client; the server replays loot streams and ceilings (`runCheck.ts`) but solo Rift War
  reports and co-op airborne flags are trusted.
