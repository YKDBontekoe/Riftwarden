# packages/rules: pure gameplay rules

Every decision the game makes that can be computed without an engine: loot rolls, economy prices, progression, Rift War
steps, run map, combat math, nav grid, placement, wave plans. The browser, the co-op sim worker and the rules worker all
run this exact code, so the server can replay and validate what a client did.

## Rules

- **Pure only.** No Babylon values, React, DOM or Node modules (`tests/architecture.test.ts`). Type-only imports from
  Babylon are also avoided; use plain `{x, y, z}` shapes.
- **Inject what is not pure**: randomness (`mulberry32`, seeded streams), ids, time, line of sight (`clearShot`
  callbacks). Never call `Math.random()` or `Date.now()` inside a rule.
- **Never shift an existing stream.** A new random decision gets its own stream (`seed ^ 0x...`) or a seed hash
  (`setFor`, `uniqueForDrop`, `ascendDrop` are the pattern). `tests/loot-roll.test.ts` pins reference rolls.
- **Profile changes** are named ops in `progression/ops.ts` (validated, then applied) or run entries in
  `progression/runRules.ts`; `progression/sync.ts` replays both on the server. Economy actions go through
  `economy/transactions.ts` (validate everything, then mutate; tx-id guard).
- **Save shape** lives in `progression/save/` (types, defaults, coerce, sanitize, migrations, codec). Prefer optional
  fields + sanitize; a version bump needs `MIGRATIONS[n]`, a `crates/db` migration and a round-trip test.
  `tests/save-surface.test.ts` pins the barrel's exports.
- **Numbers live in one place**: economy in `economy/config.ts`, pacing in `waves/pace.ts`, war in `war/state.ts`
  (`WAR`), progression pacing pinned by `tests/progression-sim.test.ts` (retune there, ask the owner first).
- **Memoised generators** (`generateArena`, `regionLayout`) must stay deterministic for a seed; layouts are never stored.
- Every new module gets a suite in the root `tests/` folder.

## Docs

Systems: [`docs/systems/`](../../docs/systems/README.md). Progression numbers:
[`docs/design/progression-design.md`](../../docs/design/progression-design.md) §12.
