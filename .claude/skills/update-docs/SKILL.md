---
name: update-docs
description: Record a Riftwarden change in the right documentation file (system notes, code map, ADRs, roadmap, testing, known limitations, AGENTS.md). Use after implementing a feature, fix or refactor, or when asked to document something.
---

# Update the docs for a change

1. List what the change did: new or changed behaviour, new/moved modules, new rules or gotchas, tests and their results,
   things left undone, decisions made between real alternatives.
2. Put each fact in its one home (table "Documentation rules" in `AGENTS.md`):
   - Behaviour, rules, gotchas, tests, "Not done yet" -> `docs/systems/<system>.md`. Edit the existing sentence when
     behaviour changed; do not append a dated diary entry. New system -> new file + a row in `docs/systems/README.md`.
   - New, moved or split module -> one line in `docs/architecture/code-map.md` (mark `[pure]` modules).
   - Lasting technical choice -> `docs/decisions/NNNN-title.md` from the template + a row in `docs/decisions/README.md`.
   - Milestone status or roadmap -> `docs/design/roadmap.md` and the status line in `AGENTS.md`.
   - Suites, sections, known failures -> `docs/testing/README.md`.
   - Fixed or found limitation -> `docs/known-limitations.md`, or the system note when it belongs to one system.
   - A rule every agent must follow everywhere -> `AGENTS.md` (keep it short) or the package's `AGENTS.md`.
3. Do not change owner decisions in `docs/design/` without the owner; note the conflict instead.
4. Use repository-relative paths and relative links, then run `pnpm vitest run tests/docs.test.ts`.
