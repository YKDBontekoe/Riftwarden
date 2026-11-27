# Riftwarden: agent guide

This is the canonical guide for AI coding agents (Claude Code reads it through `CLAUDE.md`; Codex, Cursor and others read
`AGENTS.md`). Keep it short: rules and pointers live here, details live in [`docs/`](docs/README.md). Package-specific
rules are in the `AGENTS.md` next to each package and load when you work there.

## What this is

A first-person sci-fi action tower-defense roguelite for the browser (plus a Tauri desktop shell). You fly a combat drone,
defend a reactor against endless machine waves, chase procedural loot, travel a branching run map on a shared persistent
war map, and play solo offline or 2-4 player co-op.

**Status (2026-11):** Architecture v2 is done; the progression overhaul is done; the desktop client with signed updates
just landed. Next on the roadmap: the rest of M11 (tower parts as loot, more uniques, async trading), then enemies and
world. See [`docs/design/roadmap.md`](docs/design/roadmap.md).

**Source of truth when notes disagree** (highest first): the code and its tests > owner Q&A in
[`docs/design/design-direction.md`](docs/design/design-direction.md) and
[`docs/design/progression-design.md`](docs/design/progression-design.md) (§12 has the shipped numbers) >
[`docs/architecture/architecture-v2.md`](docs/architecture/architecture-v2.md) > system notes in `docs/systems/`.

## Repository map

| Path | Role | May import |
| --- | --- | --- |
| `packages/rules` | Pure rules: loot, economy, progression, war, run map, combat math, nav grid | nothing outside itself |
| `packages/protocol` | Protobuf types generated from `proto/` + frame codecs | `rules` |
| `packages/game` | Simulation + Babylon presentation: arena, HQ, enemies, weapons, co-op authority/replica | `protocol`, `rules` (never React) |
| `apps/client` | Browser shell, Flow, React UI, routes, account/sync glue, PWA, touch, desktop (`src-tauri/`) | all packages |
| `apps/worker` | Node workers: `rules` role (replay, run validation, war) and `sim` role (co-op rooms, headless `Game`) | all packages |
| `crates/gateway`, `crates/db`, `crates/proto` | Rust gateway (the only public service), sqlx queries + migrations, Rust protobuf types | - |
| `tests/` | All Vitest suites (unit, architecture, property) | - |
| `scripts/` | Browser (Playwright) and protocol suites, dev stacks, capture tools | - |
| `deploy/` | Docker images, Compose stack, `deploy.sh` (drain + rollback) | - |

Cross-package imports use the package name: `@riftwarden/rules/loot/roll`. Inside a package, paths keep the historic
`src/` sub-paths (`core/Game.ts` = `packages/game/src/core/Game.ts`). Find a module in
[`docs/architecture/code-map.md`](docs/architecture/code-map.md), or just search.

## Commands

```bash
pnpm install --frozen-lockfile   # Node >= 22 (CI uses 24), pnpm 10 via corepack
pnpm typecheck                   # tsc --noEmit over the workspace
pnpm lint                        # ESLint ratchet (see Conventions)
pnpm test                        # Vitest; DB suites skip without RIFT_TEST_DATABASE_URL
pnpm vitest run tests/loot.test.ts   # one suite
pnpm build                       # typecheck + production client into ./dist
pnpm dev                         # client on :5173 (solo play needs no backend)
pnpm backend                     # gateway :8090 + workers (DATABASE_URL, REDIS_URL)
pnpm proto                       # after editing proto/: lint + regenerate TS and Rust types
cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked   # Rust (RIFT_TEST_DATABASE_URL, RIFT_TEST_REDIS_URL)
```

Browser suites, co-op protocol suites, test stacks and the `?test` debug API are in
[`docs/testing/README.md`](docs/testing/README.md).

## How to work here

1. **Read before you change.** Open the system note for the area (`docs/systems/README.md` indexes them) and the
   relevant design doc. They record rules that are invisible in a single file (seed streams that must not shift,
   co-op overrides, known SwiftShader quirks).
2. **Plan the rule, then the effect.** Decide which pure function in `packages/rules` owns the decision; `Game` and the
   UI only apply results.
3. **Test at the right level.** Pure logic: a Vitest suite in `tests/` (equivalence or property tests where possible).
   Gameplay in the browser: extend the matching `scripts/e2e-*.cjs` section. Wire changes: the protocol suite.
4. **Verify before you claim done** (see "Definition of done"). Report failures with their output; say which checks you
   did not run and why.
5. **Update the docs in the same change** (see "Documentation rules").

Ask the owner before: changing a design decision recorded in `docs/design/`, bumping the save or protocol version,
changing economy/progression numbers pinned by `tests/progression-sim.test.ts`, adding a dependency, or touching
`deploy/` and CI workflows.

## Conventions (architecture rules, enforced where possible)

- **Dependency direction** `apps/client -> packages/game -> packages/protocol -> packages/rules`. `packages/rules` imports
  no Babylon, React, DOM or Node modules. `packages/game` never imports React (`useHud` lives in the client). Enforced by
  `tests/architecture.test.ts`; extend it when you add a boundary.
- **Rules before effects.** What is rolled, what something costs, who a blast hits, which hint shows: pure functions with
  injected randomness/ids/line-of-sight, plus a test. `Game` applies the result.
- **Extract by narrow interface, not by passing `Game`.** New arena systems take a small host interface (`DevHost`,
  `CombatHost`, `TowerHost`, ...) built by a private `*Host()` method of lazy getters, so `ServerGame`/`ClientGame`
  overrides keep working. No `Game` value imports in `packages/game/src/arena` (architecture test).
- **`noImplicitOverride`**: `ServerGame`/`ClientGame` overrides say `override`.
- **Every profile change is a named op** (`packages/rules/src/progression/ops.ts`) **or a run entry** (`runRules.ts`), or
  it will not survive offline sync and server replay.
- **Seeded determinism.** New random decisions get their own stream (e.g. `seed ^ 0x...`) or a hash of the seed, so
  existing rolls for the same seed never shift. Tests pin reference rolls (`tests/loot-roll.test.ts`).
- **Save and wire compatibility.** Optional fields + `sanitize` instead of a version bump where possible; a real change
  gets a `MIGRATIONS[n]` entry, a PostgreSQL migration in `crates/db` and a round-trip test. Protocol changes bump
  `PROTOCOL_VERSION` (`packages/protocol/src/protocol.ts`) and update `scripts/bot.mjs`.
- **Typed wire events**: every server-emitted tuple tag is in `packages/protocol/src/events.ts` and handled in `ClientGame.applyEvent`
  (`tests/net-events.test.ts` greps both sides). Replicated presentation calls go in `packages/game/src/net/replicated.ts`.
- **Behaviours**: every enemy archetype is a `Behavior` registered by `Game`; `EnemyManager` never imports one.
- **Babylon**: deep imports only (`@babylonjs/core/<Module>/<file>`, never the barrel); side-effect registrations go in
  `packages/game/src/babylonSideEffects.ts`. Use engine features (Havok collision, picking, raycasts, particles) before
  custom systems. A custom shader needs a WGSL twin in `visuals/wgsl.ts` (`node --import tsx scripts/check-wgsl.mjs`).
- **Lint is a ratchet**: errors for real bugs (`any`, awaiting non-promises, hook rules); warnings for floating promises
  and size (`max-lines` 800, `max-lines-per-function` 250). Do not add warnings; new files stay under the limits; split
  big files rather than growing them.
- **Naming**: by intent, never by milestone (`nextTowerCost`, not `m5Cost`). The HUD keys `m5`/`m6` are legacy.
- **Unlock track**: a new player-facing feature needs an entry in `packages/rules/src/progression/unlocks.ts`.
- **Frame budget**: no per-frame material property writes or light enable/disable mid-run (shader recompiles), no
  per-frame chances or smoothing without `dt`, gameplay ray picks through `metadataPicker`. Details and the rest:
  [`docs/systems/performance.md`](docs/systems/performance.md).
- **Comments** explain why (a constraint, a gotcha, a link to a doc section), not what the code says.

## Definition of done

- `pnpm typecheck`, `pnpm lint` (no new warnings) and `pnpm test` pass; Rust changes also pass `cargo fmt --check`,
  `cargo clippy --all-targets -- -D warnings` and `cargo test`.
- New rules have unit tests; changed gameplay has a browser check in the matching e2e suite (run the affected sections).
- `pnpm build` succeeds when client code, assets or the service worker changed.
- Docs updated (below). Commit messages say what changed and why; no model names in commits, code or docs.

## Documentation rules

| You changed | Update |
| --- | --- |
| How a system works, its rules, gotchas, tests, "not done yet" | its file in `docs/systems/` (create one for a new system and list it in `docs/systems/README.md`) |
| Added, moved or split a module | `docs/architecture/code-map.md` |
| A decision with lasting trade-offs (format, protocol, boundary, tool) | a new ADR in `docs/decisions/` |
| Milestone status or roadmap order | `docs/design/roadmap.md` and the status line above |
| A limitation fixed or found | `docs/known-limitations.md` |
| A test suite, its sections or known failures | `docs/testing/README.md` |
| A rule every agent must follow everywhere | this file (keep it short; move detail to `docs/`) |

Write docs as current-state facts, not diaries; record regression numbers in the system note under "Tests".

## Gotchas that cost hours

- Headless Chromium runs SwiftShader: low FPS, async shader compiles, a known hit-flash PBR compile error (e2e m1 "Z").
  Verify gameplay with `__rift.advance()`, not wall-clock time; let the page idle before screenshots.
- Do not edit client-served files while a browser suite runs (Vite HMR reloads the page); restart Vite after deleting or
  renaming files.
- Never `clone()` a palette material or a DynamicTexture (blank texture, readiness stalls); build fresh materials.
- Particle systems positioned only through `startPositionFunction` rendered nothing in SwiftShader; move the emitter.
- `?test` keeps legacy flows (classic arena, classic endless run, local war, unlock-all); opt in with `&procedural`,
  `&map`, `&war`, `&locks`.
- The local test databases in the cloud container: PostgreSQL on 55432 (`postgres://rift@127.0.0.1:55432/rift_test`),
  Redis on 56379, when they have been started (see `docs/testing/README.md`).
