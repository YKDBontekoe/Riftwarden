# 0002. Agent guide in AGENTS.md, details in docs/

- Status: Accepted
- Date: 2026-11-27
- Deciders: owner (request), session

## Context

The root `CLAUDE.md` had grown to ~218 KB / 770 lines of milestone history. It was loaded into every agent session, cost
context on every task, mixed rules with diaries, and had drifted (stale paths, line counts, limitations that were fixed
long ago). Only Claude Code read it.

## Decision

- `AGENTS.md` (root) is the canonical, short guide: what the project is, the map, commands, workflow, enforced
  conventions, definition of done, documentation rules, gotchas. `CLAUDE.md` imports it (`@AGENTS.md`) and adds only
  Claude Code specifics, so every agent tool reads the same rules.
- Each package has its own `AGENTS.md` (+ a `CLAUDE.md` importing it) with the rules that only matter there; Claude Code
  loads them lazily when working in that directory.
- Details moved verbatim into `docs/`: `design/`, `architecture/`, `systems/` (one note per system), `testing/`,
  `decisions/`, `known-limitations.md`. `tests/docs.test.ts` keeps links from rotting.
- `.claude/skills/` holds the `verify` and `update-docs` workflows.

## Consequences

Sessions start with a fraction of the context. Agents must open the system note for their area instead of relying on
everything being preloaded; the guide says so. Docs must be updated per system file rather than appended to one log.
