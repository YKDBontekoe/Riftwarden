# 0001. Architecture v2: Rust gateway, TypeScript rules in workers, Protobuf over WebSocket

- Status: Accepted
- Date: 2026-11-21
- Deciders: owner

## Context

The prototype had a Node server and local saves. Production needed one source of truth for player data, offline play,
passkey accounts, co-op for hundreds of concurrent players on one 4 GB machine, and drained deploys.

## Decision

A Rust (axum) gateway is the only public service; gameplay rules stay in one TypeScript copy executed by internal Node
workers (`rules` and `sim` roles); one Protobuf protocol over the account's session WebSocket; PostgreSQL + Redis; offline
play with server-validated sync. Full plan and owner Q&A: [`../architecture/architecture-v2.md`](../architecture/architecture-v2.md).

## Consequences

Rules are never re-implemented in Rust; every profile change must be a replayable op or run entry; wire changes touch
`proto/`, both codecs and the bot. Observability (ClickHouse + Grafana) is postponed.
