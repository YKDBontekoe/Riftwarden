# packages/protocol: wire types and codecs

Protobuf types generated from `proto/riftwarden/v1` (into `src/gen/`, never edit by hand) plus the frame codecs
(`codec.ts`, `eventCodec.ts`, `snapshotCodec.ts`), the replicated event union (`events.ts`) and `PROTOCOL_VERSION`
(`protocol.ts`).

## Rules

- Edit `proto/` then run `pnpm proto` (buf lint + generate TS + Rust, `cargo fmt -p riftwarden-proto`). CI fails if
  `src/gen` differs from a fresh generation.
- A wire change bumps `PROTOCOL_VERSION`, updates `scripts/bot.mjs` (protocol test bot) and the Rust side
  (`crates/proto`, `crates/gateway`), and gets a section in `scripts/e2e-coop-protocol.mjs` or `tests/codec.test.ts`.
- Every server-emitted event tag is in `events.ts` (`parseEvent` validates structure) and handled exhaustively in
  `packages/game/src/net/ClientGame.ts` `applyEvent`; `tests/net-events.test.ts` checks both sides.
- Imports only `@riftwarden/rules`.

Background: [`docs/architecture/architecture-v2.md`](../../docs/architecture/architecture-v2.md) section 5.
