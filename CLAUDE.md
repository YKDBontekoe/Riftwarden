# Riftwarden

@AGENTS.md

## Claude Code specifics

- The shared rules above are the whole contract; this file only adds what is specific to Claude Code.
- Package guides (`packages/*/AGENTS.md`, `apps/*/AGENTS.md`, `crates/AGENTS.md`) are imported by the `CLAUDE.md` next to
  them and load when you work in that directory.
- Project skills in `.claude/skills/`: `verify` (pick and run the right checks for a change) and `update-docs` (where a
  change must be recorded). Use them before reporting a task as done.
- For broad searches across the many packages, prefer `Grep`/`Glob` over reading whole files: `Game.ts` is ~2400 lines and
  most system notes are long. Read the system note for your area first, then only the files it names.
