---
name: verify
description: Pick and run the right Riftwarden checks for the current change (typecheck, lint ratchet, Vitest, Rust, browser and protocol suites) and report results faithfully. Use before saying a task is done, or when asked to test or verify a change.
---

# Verify a Riftwarden change

1. See what changed: `git status --short` and `git diff --stat` (staged, unstaged and untracked).
2. Always run, from the repository root:
   - `pnpm typecheck`
   - `pnpm lint`: errors are blockers; the warning count must not grow (compare with the base commit if unsure).
   - `pnpm test` (set `RIFT_TEST_DATABASE_URL` when a local PostgreSQL is running, see `docs/testing/README.md`).
3. Add checks by area (table in `docs/testing/README.md`):
   - `crates/**` or `Cargo.*`: `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`,
     `cargo test --locked`.
   - `proto/**`: `pnpm proto`, then `git diff --exit-code packages/protocol/src/gen`.
   - Shaders (`visuals/wgsl.ts`, custom shader materials): `node --import tsx scripts/check-wgsl.mjs`.
   - Client build, service worker, `apps/client/public/`: `pnpm build`.
   - Gameplay or UI: start `pnpm dev` in the background, then run only the affected sections of the matching
     `scripts/e2e-*.cjs` suite (pass section letters). Co-op or wire: `node --import tsx scripts/e2e-coop-protocol.mjs`.
4. Before blaming the change for a failure, check "Known failures" in `docs/testing/README.md`; if still unsure, run the
   same check on the base commit in a separate worktree.
5. Report each check with pass/fail and counts, the output of every failure, and every check you skipped with the
   reason. Never call a change verified on checks you did not run.
