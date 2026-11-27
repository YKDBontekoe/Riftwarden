# Riftwarden documentation

Start with the agent/contributor guide in the repository root ([`AGENTS.md`](../AGENTS.md)); it holds the rules. This
folder holds the detail.

| Folder | What lives there | When to read it |
| --- | --- | --- |
| [`design/`](design/) | Owner decisions: [design direction](design/design-direction.md), [progression design](design/progression-design.md), [milestones + roadmap](design/roadmap.md) | Before any gameplay, balance or scope decision |
| [`architecture/`](architecture/) | [Architecture v2 plan](architecture/architecture-v2.md), [implementation notes](architecture/v2-implementation-notes.md), [code map](architecture/code-map.md), [refactoring backlog](architecture/refactoring-backlog.md) | Before changing boundaries, the backend, sync or co-op |
| [`systems/`](systems/README.md) | One note per game system: how it works, gotchas, tests, not done yet | Before changing that system; update it in the same change |
| [`decisions/`](decisions/README.md) | Architecture decision records (ADRs) | When making or questioning a lasting technical choice |
| [`testing/`](testing/README.md) | How to run every suite, the `?test` debug API, [recorded results](testing/history.md), [performance](testing/performance.md) | Before verifying a change |
| [`known-limitations.md`](known-limitations.md) | Cross-cutting limitations and follow-ups | Before promising behaviour |
| [`reviews/`](reviews/) | Visual review captures | Art and UI passes |

Also: [`README.md`](../README.md) (player/developer quick start), [`deploy/README.md`](../deploy/README.md) (deploy and
operations), [`.github/SECURITY.md`](../.github/SECURITY.md).

## Writing docs

- **Current state, not a diary.** Describe how things work now; when behaviour changes, edit the sentence instead of
  appending "update:". History belongs in git and in ADRs.
- **One home per fact.** Link instead of copying. Numbers that code owns (prices, pacing) are named by file and constant,
  not restated, unless a design doc pins them on purpose.
- **Each system note ends with** "Tests" (suites and the last recorded result) and "Not done yet".
- **Use repository-relative paths** in backticks and relative Markdown links; `tests/docs.test.ts` checks that links
  resolve.
- **Precedence** when docs disagree: code and tests > `design/` (owner answers) > `architecture/` > `systems/`. Fix the
  stale one when you notice.
