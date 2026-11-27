# apps/worker: internal Node workers

`src/main.ts` starts one role over framed TCP to the gateway: **rules** (`rules.ts`, `war.ts`: profile replay, run
validation, war steps) or **sim** (`sim/`: co-op rooms, lobbies, trades, and `CoopSim` running the real `ServerGame`
headless with `NullEngine` + Havok wasm, `sim/headless.ts`). Production bundle: `build.mjs` (esbuild + Havok wasm).

## Rules

- Workers are internal: never exposed publicly, the gateway is the only entry point. The worker counts a TCP connection
  as the gateway only after its first frame (health probes must not steal the stream).
- Game rules come from `@riftwarden/rules`/`@riftwarden/game`; do not fork logic here.
- Trusted entries (co-op run results, trades) are applied by the gateway; `sync.replay` refuses untrusted `trade` entries.
- Deploys drain sim workers (`sim-blue`/`sim-green`): rooms must survive a gateway restart by re-sending bindings.
- Test with the protocol suites: `node --import tsx scripts/e2e-coop-protocol.mjs` and `scripts/e2e-coop-map.mjs`
  (own stack via `scripts/lib/stack.mjs`; `RIFT_MAP`, `RIFT_ARENA`, `RIFT_UNLOCK_ALL`, `RIFT_SIM_CAPACITY` tune it).

Docs: [`docs/architecture/architecture-v2.md`](../../docs/architecture/architecture-v2.md) sections 7-8,
[`docs/architecture/v2-implementation-notes.md`](../../docs/architecture/v2-implementation-notes.md).
