# crates: Rust gateway, database, protobuf types

- `gateway` (axum): the only public service. Passkeys + sessions + desktop sign-in (`auth/`), the `/session` socket
  (`session.rs`: sync calls + co-op tunnel), sync via the rules worker (`sync.rs`), war (`war.rs`), co-op routing
  (`coop.rs`), open squads (`rooms.rs`), boards, limits, telemetry, admin/drain listener (`admin.rs`).
- `db`: sqlx queries + migrations (`migrations/`, applied at gateway start). Queries use fixed SQL with bound parameters.
- `proto`: types generated from `proto/` by `pnpm proto` (do not edit by hand).

## Rules

- CI runs `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`, `cargo test --locked`. The toolchain
  is pinned in `rust-toolchain.toml`.
- Integration tests in `crates/gateway/tests/` need `RIFT_TEST_DATABASE_URL` and `RIFT_TEST_REDIS_URL`; the sync tests
  start the TypeScript rules worker.
- Rate-limit and size-cap every public endpoint (`limits.rs`); never trust client-reported values that are not replayed
  by the rules worker (solo war reports are the documented exception).
- A schema change is a new numbered migration; never edit an applied one.
- Gameplay rules stay in TypeScript (`packages/rules`); the gateway schedules and routes, it does not re-implement rules.

Docs: [`docs/architecture/architecture-v2.md`](../docs/architecture/architecture-v2.md),
[`deploy/README.md`](../deploy/README.md).
