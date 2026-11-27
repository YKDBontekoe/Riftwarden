# Testing

Pick checks by what you changed (the `verify` skill in `.claude/skills/verify/` encodes this):

| Change | Minimum | Also |
| --- | --- | --- |
| Pure rules (`packages/rules`) | `pnpm vitest run tests/<area>.test.ts`, then `pnpm test` | property/equivalence test for new logic |
| Game/presentation (`packages/game`, client UI) | `pnpm typecheck`, `pnpm test` | the matching browser suite sections (below), screenshots for visual work |
| Wire, sync, co-op | `pnpm test` (with DB), protocol suites | `cargo test` when the gateway is involved |
| Rust (`crates/`) | `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`, `cargo test --locked` | |
| Shaders | `node --import tsx scripts/check-wgsl.mjs` | real-GPU look check (cannot be done headless) |
| Client build, service worker, assets | `pnpm build` | `node scripts/e2e-pwa.cjs` after a build; `tests/asset-manifest.test.ts` for CC0 assets |

Always: `pnpm lint` must not add warnings.

## Unit tests (Vitest)

All suites live in the root `tests/` folder (`vitest.config.ts` includes `tests/**/*.test.ts`). PostgreSQL-backed suites
skip unless `RIFT_TEST_DATABASE_URL` is set. Boundary tests: `architecture.test.ts` (dependency direction, purity),
`save-surface.test.ts` (save barrel exports), `net-events.test.ts` (wire event tags on both sides), `docs.test.ts`
(documentation links).
`desktop-release.test.ts` checks first-release tag lookup, annotated tags, and remote lookup failures.
`asset-manifest.test.ts` pins every third-party CC0 file to `assets/cc0/manifest.json` (licence, hash, budget); re-run
`node scripts/fetch-cc0.mjs` after changing `assets-src/cc0.sources.json`. `prop-plan.test.ts` and `music.test.ts`
cover the prop planner, HQ clutter and the adaptive score.

## Browser suites (Playwright, headless Chromium)

Most need `pnpm dev` running on :5173. Suites that need the backend run through a throwaway stack:
`node --import tsx scripts/with-stack.mjs node scripts/e2e-<suite>.cjs`. Run single sections by passing letters
(`node scripts/e2e-combat.cjs A,C`). All import `scripts/lib/harness.cjs` (launch, boot, check, waitFor, shot,
collectErrors); do not copy helpers.

| Suite | Covers |
| --- | --- |
| `e2e-m1` .. `e2e-m6`, `e2e-m10` | Milestone acceptance (sessions/persistence, loot, weapons, economy, towers/upgrades, survival director, biomes) |
| `e2e-combat` | Combat kit, elements, loot depth (sections A-J) |
| `e2e-arenas` | Procedural arenas, loading screen, rifts, breaching |
| `e2e-runmap` | Run map, hubs, resume, Rift War, survival mode (`?test&map`) |
| `e2e-riftlevels`, `e2e-progression` | Rift Levels, unlock track, mastery, spikes, seasons; Warden XP and the lattice |
| `e2e-range` | Firing range + DPS meter |
| `e2e-polish`, `e2e-feel-polish`, `e2e-render-lifecycle` | Presentation, feel, scene lifecycle |
| `e2e-mobile`, `e2e-pwa` | Touch controls (emulated phone); installability/offline/update (production build) |
| `e2e-accounts`, `e2e-sync` | Passkeys and offline sync (need the stack) |
| `e2e-construction-coop` | HQ construction; section X = real two-browser co-op (own stack, `node --import tsx`) |
| `e2e-coop-protocol.mjs`, `e2e-coop-map.mjs` | Co-op protocol with bot clients (own stack; needs a DB role that may create databases) |

CI runs unit + Rust + lint + build on every PR, plus the browser matrix accounts-and-sync, run-map and
construction-and-coop (`.github/workflows/ci.yml`).

### Known failures (do not chase these first)

- e2e-m1 **Z** "no runtime errors": SwiftShader fails to compile a hit-flash PBR variant (uniform limit). Also filtered in
  e2e-runmap.
- e2e-m2 **C8/C9** fail on the pre-existing code; A2/A6/D8/F1 are intermittent random-loot checks; H stops at
  `deploy(p, 2)` since the v11 progression restart.
- e2e-m3 **H1** is stale since the v11 restart (reads a weapon the wipe removed).
- Open (performance overhaul): the wider pool shader warm-up (`visuals/warmPools.ts`) compiles a 13-light PBR variant
  that SwiftShader cannot compile, so the "no console errors" checks (e2e-combat Z, e2e-m2 I4, e2e-arenas Z,
  e2e-render-lifecycle, e2e-range Z, e2e-m5 Z, e2e-polish) now report it; they pass on `88c0d92`. Every other check
  matches the base commit. Next step: find the material (effects with a compilation error after `warmShaders`) and
  skip or cap it in the warm-up.
- e2e-m1 A5 (deployment terminal label) and e2e-m6 E4/D5/D6/H2/I1 also fail on `88c0d92`.
- e2e-m6 B6/B7/C4 fail identically on older commits (fast-pace speeds); C1 is timing-flaky under load.

Details and older numbers: [`history.md`](history.md).

## Driving the game from a test (`?test`)

`/?test` sets `input.forceCapture` (no pointer lock) and exposes `window.__rift` (`apps/client/src/core/debugApi.ts`):
`state()`, `look(yaw, pitch)`, `advance(seconds)` (fixed 60 Hz simulation, no rendering), `stopLoop()`, `render(frames)`,
`killAll()`, `leakStats()`, `hud` (the HUD store), `spawnLoot`, `teleport`, `makeItem`, `grant`, `previewLoading`, plus `flow`, `profile`,
`game`, `home`, `dev`. Drive input with `game.input.simulateKey(code, down)` / `simulateMouse(button, down)`.

`?test` defaults (keep legacy suites stable): classic arena (`&procedural` opts in), classic endless run (`&map`), local
war (`&war`), everything unlocked (`&locks` or `&account` keeps the real track), no item thumbnails (`&thumbs`), no live
item stage (`&stage`), no touch fullscreen (`?touch` forces touch mode).

SwiftShader tips: the high preset takes ~1 s per frame; call `stopLoop()`, wait for `game.scene.environmentTexture`, then
interleave `advance(1/60)` + `render(1)`; let the page idle between renders of new viewpoints (async shader compiles);
particles only age while rendering. Take screenshots with a long timeout.

## Local databases (cloud container)

```bash
# PostgreSQL throwaway cluster on 55432 (run as the postgres user), Redis on 56379
export RIFT_TEST_DATABASE_URL=postgres://rift@127.0.0.1:55432/rift_test
export RIFT_TEST_REDIS_URL=redis://127.0.0.1:56379
```

## Tools

`scripts/bench-perf.cjs` (performance scenarios early/late/extreme/loot/extended: frame-time percentiles, draws, heap, spikes; `BENCH_PROFILE=1` adds CPU-profile hotspots, `BENCH_EFFECTS=<prefix>` dumps shader variants compiled mid-fight; see [`performance.md`](performance.md)), `scripts/bench-coop.mjs` (headless co-op server: tick cost, snapshot/event bytes; `node --import tsx scripts/bench-coop.mjs 2 120 30`), `scripts/playtest.cjs` (bot plays N waves, prints pacing), `feel-shots.cjs`, `vfx-shots.cjs`, `loot-shots.cjs`,
`item-sheet.cjs`, `ui-shots.cjs` + `ui-diff.cjs` (UI regression captures), `smoke-stack.mjs` (deploy smoke).
