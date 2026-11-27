# Architecture decision records

Short records of decisions with lasting trade-offs (formats, protocols, boundaries, tools), so later work does not
re-litigate them by accident. Gameplay and scope decisions by the owner live in [`../design/`](../design/) instead.

## When to write one

Write an ADR when a change picks one option over real alternatives and is costly to reverse: a new dependency or tool, a
save/protocol/storage format, a package boundary, a trust or security model, a deploy topology. Bug fixes and features
inside an existing design do not need one.

## How

Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md` (next free number), fill it in, add it to the list
below. Never rewrite an accepted ADR's decision: supersede it with a new one and set the old one's status to
"Superseded by NNNN".

## Records

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-architecture-v2.md) | Rust gateway as the only backend, TypeScript rules in Node workers, Protobuf over one WebSocket | Accepted (2026-11-21) |
| [0002](0002-agent-docs-layout.md) | Agent guide in `AGENTS.md` (imported by `CLAUDE.md`), details in `docs/` | Accepted (2026-11-27) |
