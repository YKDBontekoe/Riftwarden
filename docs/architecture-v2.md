# Riftwarden architecture v2 (prototype -> production)

Status: **approved 2026-11-21, implemented** (steps 1-11, section 13; the open items are listed under "Owner actions" in section 15). Once approved, this file is the plan for the "Architecture v2" milestone and wins over older notes in CLAUDE.md where they conflict.

## 1. Owner decisions (Q&A, 2026-11)

| Topic | Decision |
| --- | --- |
| Goal | Move from prototype to production grade: performance, scalability, maintainability, best tool for each job. |
| "Single API" | Both: **one protocol** for every client <-> server exchange **and** the server is the **source of truth** for player data. |
| Backend | **Option A**: Rust owns the backend (the only public service). Gameplay rules stay in **one TypeScript copy**, executed server-side by internal Node workers. |
| Offline | **Offline play stays.** The browser keeps simulating solo runs; results (loot, stats, progress) **sync** to the server, which validates them. |
| Accounts | **Passkeys** (WebAuthn) + a one-time **recovery code** shown at sign-up. **Unique display names**. Everyone starts fresh: no migration of existing local or online profiles. |
| Data | PostgreSQL (kept) + Redis (new). Migrations with the Rust tool (`sqlx`). No backups for now. |
| Protocol | Binary, schema-first (Protobuf); transport WebSocket (best performance and stability across browsers today). |
| Networking | Add lag compensation and better prediction for co-op. |
| Scale | Hundreds of concurrent players, one machine for now (4 cores, **4 GB RAM allocated** to the stack); topology must not block more later. |
| Hosting | The owner's personal server (Docker Compose, Cloudflare Tunnel, pull-based deploy timer kept). Static client on Cloudflare (CDN). API at `api.riftwarden.ykdbonte.dev`. No staging. |
| Deploys | Running co-op sessions are **drained**, not dropped. |
| Observability | OpenTelemetry traces, logs and metrics stored in **ClickHouse**, viewed in **Grafana** (no Sentry). Grafana behind Cloudflare Access. |
| Frontend | Vite + React 19 + TanStack Router (chosen over Next.js: the game is one canvas, no SSR, no website), Tailwind v4 with design tokens keeping the current look, lighter in-game HUD, Babylon **WebGPU** with WebGL2 fallback. |
| Repo | Monorepo (Cargo + pnpm workspaces). |
| Process | Feature freeze. One PR on `claude/dreamy-euler-ca3v9i`, many sessions, every step leaves the game working. Small gameplay differences are acceptable. All tests stay green (legacy suites rebuilt where the architecture removes what they drove). Dev tools kept for admin accounts and test servers. |

## 2. Principles

1. **Rules exist once.** Every gameplay and economy rule (loot, economy transactions, profile ops, run ledger, skill tree, war rules, the simulation) stays in TypeScript and is shared by the browser and the server workers. Rust never re-implements a game rule.
2. **Rust owns everything that is not a game rule**: the network edge, auth, sessions, persistence, sync orchestration, scheduling, rate limits, rooms/lobbies, worker supervision, draining, metrics.
3. **The server's word is final.** The client applies changes optimistically (offline-first), the server replays them and its result replaces the client's.
4. **One schema for the wire.** Every message is defined once in `proto/` and generated for Rust and TypeScript. No hand-written structural validators.
5. **Each step ships a working game.** No step leaves solo or co-op broken on the branch.

## 3. Target topology

```
                  Cloudflare (CDN)                        personal server (Docker Compose)
 browser ──HTTPS── riftwarden.ykdbonte.dev  (static client: Pages)
    │
    └──WSS / HTTPS── api.riftwarden.ykdbonte.dev ── cloudflared ──► gateway (Rust, axum)
                                                                    │  ├─ PostgreSQL 18
                                                                    │  ├─ Redis 8
                                                                    │  └─ Unix sockets (protobuf frames)
                                                                    ├──► rules workers (Node, N=cores/2)
                                                                    └──► sim workers   (Node, rooms)
                                    otel-collector ──► ClickHouse ◄── Grafana (grafana.riftwarden.ykdbonte.dev, Cloudflare Access)
```

- **gateway** (Rust): the only process reachable from outside. HTTP for passkey ceremonies, `/health`, `/war` snapshot for caching, `/telemetry` (browser errors and client metrics, rate limited); one WebSocket per client for everything else.
- **rules workers** (Node, stateless): execute TypeScript rules on demand: replay profile ops and run journals, tick the war, compute derived fields. Pure CPU, no Babylon, no Havok.
- **sim workers** (Node, stateful): run co-op operations (`ServerGame` + Havok + NullEngine, as today). Each hosts several rooms. Players never connect to them; the gateway routes frames.
- **PostgreSQL**: accounts, passkeys, sessions, profile documents + sync log, run records, war state.
- **Redis**: sessions cache, rate limits, presence and online samples, room directory (room -> worker), worker registry with version + draining flag, pub/sub for future multi-gateway.

Why Node workers and not an embedded JS engine in Rust: the sim needs Babylon's NullEngine, Havok wasm and Node APIs; the rules worker shares the same bundle. Separate processes also isolate a crashing room from the gateway and let sim workers outlive gateway restarts.

## 4. Repository layout

```
Cargo.toml / pnpm-workspace.yaml
proto/                     *.proto (buf lint + breaking checks)
crates/
  gateway/                 axum server: http, ws, auth, sync, rooms, war scheduling, workers, metrics
  proto/                   prost-generated types (build.rs)
  db/                      sqlx queries + migrations/
packages/
  rules/                   pure TS rules (today's [pure] modules: loot, economy, progression/save, ops,
                           runmap, war rules, survival plan, combat rules...). No Babylon values (architecture test).
  game/                    the simulation + presentation (Game, arena, enemies, visuals, fx, audio): Babylon
  protocol/                generated TS (protobuf-es) + thin helpers (envelope, rpc ids)
apps/
  client/                  Vite app: shell, routes, menus/terminals (React 19), HUD layer, net, sync, offline store
  worker/                  Node entry: role=rules | sim, bundled with esbuild (no tsx in production)
deploy/                    compose.yml, Dockerfiles, deploy.sh, systemd, grafana/
scripts/                   e2e suites + harness (kept, paths updated)
tests/                     Vitest suites (moved next to their package over time)
```

The split follows the boundary the architecture tests already enforce (pure modules free of Babylon values). `packages/rules` is what the rules worker loads, so it stays small and fast to start.

## 5. Protocol

- **Schema**: Protobuf 3 in `proto/`, generated with `prost` (Rust) and `@bufbuild/protobuf` v2 / protobuf-es (TypeScript). `buf breaking` in CI guards compatibility.
- **Transport**: one WebSocket per client to the gateway, binary frames. WebTransport is a later option behind the same `Transport` interface (it is not stable in every target browser).
- **Envelope**: `Frame { oneof { Request{id, ...}, Response{id, ...}, Push{...}, Realtime{...} } }`.
  - **RPC** (request/response with ids, timeouts, typed errors): profile ops, sync, war, lobby, account.
  - **Push**: server-initiated (war updates, lobby state, profile replaced, notices).
  - **Realtime** (co-op): input, shot claims, acts upstream; snapshots, events, corrections downstream.
- **Opaque payloads**: the profile document (`SaveData`) is owned by the TS rules, so the wire carries it as bytes (JSON, compressed) instead of duplicating its 200-field shape in proto. Snapshots/events are proto messages produced by the sim worker; the gateway routes them by recipient header without decoding the body.
- **Snapshots**: quantised fields (positions in cm, angles in 1/1024 turn), per-client delta against the last acknowledged snapshot, 20 Hz; events replace the `ev` tuples of `net/events.ts` with typed messages.
- **Versioning**: `hello {protocol, build}`; the gateway refuses mismatches with a reload notice (as today).
- Limits: 64 KiB per frame, token buckets per connection (gateway, Redis-backed per account/IP for expensive RPCs).

## 6. Accounts and sessions

- **Passkeys only** (`webauthn-rs`): register (create account + display name + first passkey), sign in, add/remove passkeys from settings. RP ID `riftwarden.ykdbonte.dev`, allowed origin `https://riftwarden.ykdbonte.dev` (+ localhost in dev).
- **Session**: opaque random token, stored hashed in Postgres, cached in Redis; delivered as an `HttpOnly; Secure; SameSite=Lax` cookie scoped to `.riftwarden.ykdbonte.dev` (client and API are same-site), so the WebSocket upgrade carries it. Sliding expiry 30 days, revocable.
- **Guest play**: playing without an account works fully offline on a local profile. Creating a passkey creates the account and uploads the local log as the first sync (replayed from an empty profile, so it is validated like any other).
- **Recovery code**: 16 random characters (grouped, Crockford base32) shown once at sign-up and regenerable from settings; stored as an Argon2id hash. Redeeming it signs in once and requires registering a new passkey; the code is then consumed and a new one shown. Rate limited per account and IP.
- **Display names**: unique, case-insensitive (`lower(name)` unique index), 3-18 characters from the current allowed set, checked live at sign-up; renaming allowed with a cooldown.

## 7. Profiles and offline sync

### Storage
- `profiles(account_id, doc JSONB, rev BIGINT, rules_version, updated_at)` + generated columns for what the backend queries (level, best wave per tier, unlocked tier) and `run_records` for history/leaderboards later. The document shape is owned by `packages/rules` (`SaveData` + its sanitize/migrations), so a rule change never needs a Rust change. This replaces today's relational `profileRows` mapping (everyone starts fresh, so no data migration).
- Client: IndexedDB (replaces localStorage): `{doc, baseRev, log[]}` per account, plus the guest profile.

### The log
Every persistent change on the client is already either a **named op** (`progression/ops.ts`) or a **run rule** (`beginRun`, `bankRewards`, `bankNodeRewards`, `saveMapProgress`, `recordRun`, `resolveInterruptedRun`). Both become log entries:

```
LogEntry = { seq, at, op {name, args, txId} }
         | { seq, at, run {runId, kind: start|bank|node|map|end, payload, journal} }
```

The client applies each entry locally at once (same code as today: `Profile.op` / `Profile.mutate`), appends it to the log, and pushes it immediately when online. Offline, entries queue.

### Sync
`Sync { baseRev, entries[] }` -> gateway locks the profile row -> rules worker replays the entries in order **on the current server document** -> per-entry accept/reject + new document + rev -> gateway commits in one transaction -> client replaces its document and drops acknowledged entries. Rejected entries are reported in the UI (rare: e.g. two devices spending the same credits offline). Online play uses the same path with one entry per message, so there is one code path, not two.

### Validating runs
Solo runs are simulated by the client, so the server validates rather than trusts:
- **Loot is re-rolled.** Loot is pure and seeded (`rollLoot` over the run's loot stream). The run journal records every roll call in order (source id, wave, faction; dev multipliers disqualify the run). The rules worker replays the stream and accepts only items it generated itself; any other item is a forgery. Same for shards and uniques (seed-decided).
- **Plausibility caps** on kills, waves, rewards and XP per minute of run time, per tier; credits/salvage/components must match the income rules for the reported waves within a margin.
- Rejected run entries keep the run recorded as `rejected` (visible to the player, nothing banked).
- This does not stop a determined cheater the way server-simulated solo would, but it blocks item forgery and resource editing, which is what matters for a loot game. Co-op stays fully server-authoritative.
- **Known limits of run validation**: a client can still fish run ids offline for a lucky loot stream (bounded: the stream is fixed per run id, sources and luck are clamped); co-op runs are fully server-simulated.

### War reports
Signed-in wardens report secured sectors to the gateway right away (`POST /war/report`, session cookie, Redis rate limits per account: 45 s gap, 40 per hour). Guests and offline players play on their local copy of the war, which never counts (the device has no connection to report through, so there is nothing to time-limit). Co-op operations report as trusted from the sim worker (step 7).

## 8. Co-op (rooms, workers, lag compensation)

As built in step 7 (the first draft put the lobby in Rust; it stayed in TypeScript because rooms, operations and the run map vote share state and rules, and porting them would have meant two copies):

- **One socket.** Co-op frames (`ClientFrame` / `ServerFrame`, protocol v13) ride inside the account's session socket (`SessionClientFrame.coop` / `SessionServerFrame.coop`). Co-op needs a signed-in account; the player id is the account id and the name is the account name (hello carries only the protocol version). No guest identities, no "online profile": a player's profile is their account copy, synced like solo play.
- **Gateway** (`crates/gateway/src/coop.rs`): authenticates, answers pings, keeps the room directory (code -> worker, account -> worker, both reported by the workers) and routes frames. The first frame for a worker attaches the account (`SimAttach` with the profile document from PostgreSQL); a sync from a device pushes the new copy (`SimProfile`). New rooms go to the least-loaded worker that is not draining. A second window of the same account takes over the co-op stream ("replaced").
- **Sim workers** (`apps/worker/src/sim/`: `host.ts`, `room.ts`, `coopSim.ts`): lobbies and operations as before (`Room`, `CoopSim` around `ServerGame`). Profiles change only through run entries (`start` / `bank` / `nodeBank` / `map` / `end` / `interrupt`, the same `runRules` as solo play), applied to the worker's copy and streamed to the gateway (`SimEntries`, log `op:<run id>`), which applies them in arrival order as **trusted** entries (the server played the run, so the run checks are skipped) and notifies the account's devices, which pull the new copy. War reports from operations are forwarded as trusted (`SimUp.report`); war changes are pushed to every worker.
- **Crash isolation**: when the gateway loses a worker it tells that worker's players ("the operation was lost") and records each of their operations as interrupted (an `interrupt` entry on the operation's log: secured rewards stay, the rest is lost). A restarted worker comes back empty and takes new rooms.
- **Draining**: `drain` stops new rooms on every worker; running operations finish (deploy script, step 8).
- **Lag compensation** (`packages/rules/src/net/lagComp.ts`): the server samples every hostile's centre at the snapshot rate and keeps 0.5 s of trail; a shot claim's hit point is checked against the nearest point of that trail (segments between samples) instead of the current position plus a speed-based slack. No client timestamp is trusted, the window is fixed.
- **Prediction**: local drone movement stays client-predicted; server corrections up to 6 m blend in over 0.2 s (`blendStep`), larger ones snap. Shot effects, ability cooldowns (`mirrorUse`) and pickups were already predicted with server confirmation.

## 9. Deployment

As built in step 8 (operator notes: `deploy/README.md`):

- **Images** (GHCR, both labelled with the git revision): `riftwarden-gateway` (`deploy/gateway.Dockerfile`: release build, distroless `cc` image, 14 MB compressed; `riftwarden-gateway health` is the healthcheck, `riftwarden-gateway admin status|drain` replace curl) and `riftwarden-worker` (`deploy/worker.Dockerfile`: one esbuild bundle from `apps/worker/build.mjs` + Havok wasm on node:24-slim, no node_modules; `RIFT_WORKER_ROLE` picks rules or sim).
- **Compose** (`deploy/compose.yml`): `gateway` (127.0.0.1:18084), `rules`, two sim slots `sim-blue` / `sim-green`, `db` (PostgreSQL 18), `redis` (no persistence, LRU), `clickhouse`, `otel-collector`, `grafana` (127.0.0.1:18085), all with memory limits (~3.3 GB of 4 GB; idle ~0.5 GB measured). cloudflared stays a systemd unit (`deploy/cloudflared.example.yml`: `api.` -> gateway, `grafana.` -> Grafana behind Cloudflare Access). Secrets in `.env` (`deploy/.env.example`); image digests in `images.env`, written by the deploy script.
- **Gateway admin listener** (`crates/gateway/src/admin.rs`, `RIFT_ADMIN_LISTEN`, never published): sim workers with connected / draining / running, per-worker drain.
- **Pull-based deploy** (`deploy/deploy.sh`, systemd timer every minute, flock): pull both `:production` images; skip when they are from different builds or the build already failed here (`.failed-build`). Then infrastructure `up` (no-op unless compose changed), rules worker, gateway (migrations run at gateway start; players' sockets drop and reconnect, operations keep running in the sims, which re-send their room bindings to the new gateway so rejoining players are routed back), health + build check with rollback of gateway and rules. Then each sim slot in turn: drain, wait until its operations end (`DRAIN_TIMEOUT`, default 30 min; then SIGTERM ends them: secured rewards stay), replace, undrain. The other slot takes new rooms meanwhile. Verified locally on the real images: first deploy, rolling update with an operation held on a slot (rejoin after the gateway restart, drain until the operation ended), drain timeout, broken gateway rollback, no retry of a failed build.
- **Static client**: Cloudflare Pages (`wrangler pages deploy` in the deploy job, after the API is live; skipped with a warning until the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets exist). The production build sets `VITE_API_URL=https://api.riftwarden.ykdbonte.dev`; the session cookie is host-only on `api.` (same site as the client, SameSite=Lax), WebAuthn RP id `riftwarden.ykdbonte.dev`.
- **CI** (`.github/workflows/ci.yml`): build + unit tests + lint + protocol codegen check; Rust (`fmt`, `clippy -D warnings`, `cargo test`, then the co-op protocol and map suites against a real stack); browser suites (accounts, sync, run map, browser co-op X; `scripts/with-stack.mjs`); on `main`: both images, a compose smoke test (`scripts/smoke-stack.mjs`: health with both sims, build id, war, auth, no test login), GHCR push, live API verification, Pages publish.

## 10. Observability (OpenTelemetry -> ClickHouse -> Grafana)

As built in step 8:

- **Pipeline**: the gateway exports traces, logs and metrics over OTLP/gRPC (`telemetry.rs`); the workers export logs over OTLP/HTTP JSON (`apps/worker/src/telemetry.ts`, no SDK: batched every 2 s, stdout stays the fallback). The collector (`deploy/otel-collector.yml`: memory limiter, health-check spans filtered, batch) writes to ClickHouse (`otel` database, tables created by the exporter, 30-day TTL). ClickHouse runs with small caches and compact system logs (`deploy/clickhouse/low-memory.xml`).
- **Grafana**: ClickHouse datasource and the "Riftwarden overview" dashboard are provisioned (`deploy/grafana/`): gateway requests and latency, warnings/errors per service, co-op rooms and operations, syncs, sessions, latest warnings/errors. Every query was run against a live stack. Grafana's own login stays as a second layer behind Cloudflare Access.
- **Not done yet**: browser error reporting (`/telemetry`), worker traces/metrics (sim tick time is in the operation's end log line), alert rules, more dashboards (RPC, anti-cheat).

## 11. Frontend

As built in steps 9-10:

- **Shell and routes**: `apps/client/src/main.tsx` is a 1 KB shell (styles + a boot splash in `index.html`) that loads the game chunk (`boot.tsx`: engine, Havok, Flow, React). React 19; TanStack Router with hash history (`#/account`, `#/settings`, `#/co-op`, `#/join/CODE`; automation query strings survive, static hosting needs no fallback) decides the main-menu sheet; the Babylon canvas and the in-game screens stay outside routing. Old `?join=CODE` links still work.
- **Styling**: Tailwind v4 (`apps/client/src/ui/app.css`): theme + utilities layers without preflight (the panels were designed on browser defaults), `style.css` as the components layer, design tokens mapped from the existing `:root` colours and fonts (`text-cyan`, `bg-glass`, `font-mono`, ...). The account panel is migrated to utilities with identical rendering (screenshot comparison); the other panels keep their component classes and move to utilities when they are next touched.
- **HUD**: `ui/hud/live.tsx`: the HUD snapshot is a `@preact/signals-core` signal; `LiveText`, `LiveBar` and `useLiveStyle` write timers, bars, heat, cooldowns, cores and respawn time straight into their DOM nodes, so 20 Hz values never re-render React. React renders structure only (a panel appears, an ability slot fills).
- **Splits**: `Terminals.tsx` -> `ui/terminals/` (Deploy, Loadout, Storage, ModuleBench, Command) and `items.tsx` -> `ui/inventory/` (glyphs, entry, detail, compare, InventoryView); the old files are barrels (`scripts/split-module.py` did it mechanically, pruning unused imports with the compiler).
- **Bundle**: deep Babylon imports everywhere (`scripts/babylon-deep-imports.mjs`; side effects in `packages/game/src/babylonSideEffects.ts`), shaders and the glTF loader load on demand. First load 31 KB gzip (was 1.87 MB); the game chunk behind the splash 994 KB gzip.
- **Offline**: a service worker generated at build time (`apps/client/sw-plugin.ts`: hashed assets cache-first, `index.html` network-first, other origins untouched, old caches dropped). Verified: with the network cut, a reload starts the menu and the HQ from the cache.
- **Rendering**: `apps/client/src/core/engine.ts` creates WebGL2 or, when the settings (Renderer: WebGPU beta) or `?webgpu` ask, Babylon's `WebGPUEngine` with its extensions (falls back to WebGL2 when unavailable). Every custom shader has a WGSL twin (`packages/game/src/visuals/wgsl.ts`: sky, rift portal, lamp beams, lane paths, landmark energy, gate mist, reactor plasma, soft particles) chosen per engine (`shaderLanguageFor`), and the hit-flash material plugin injects WGSL on WebGPU, so WebGPU never downloads Babylon's GLSL translator. `scripts/check-wgsl.mjs` compiles all 15 WGSL shaders with the browser's real WGSL compiler (Tint) in CI. **WebGPU is opt-in** until it has been checked on real GPUs: headless SwiftShader cannot present WebGPU frames (a bare WebGPU device that renders to a canvas is destroyed within seconds there, an idle one is not), so its frames could not be verified end to end in this environment.

## 12. Testing

- **Rust**: unit tests per module; integration tests against real Postgres + Redis (CI services, as the current DB suites); protocol round-trip tests against the generated TS (golden frames).
- **Rules worker**: Vitest for sync replay (accept/reject, idempotent replays, multi-device conflicts), run validation (genuine journals pass, forged/edited items and impossible rewards fail), war ticking parity.
- **Browser suites**: solo still simulates in the browser, so `?test`, `window.__rift` and the solo suites (m1-m10, combat, runmap, arenas, polish, progression) keep working with path updates. The co-op suites (`e2e-coop-protocol`, `e2e-coop-map`, construction X, bot client) are rebuilt against the gateway + workers (the bot speaks protobuf). New suites: passkey sign-in (virtual authenticator in Playwright), offline play -> reconnect -> sync, draining deploy.
- Architecture tests extended: `packages/rules` imports nothing from `packages/game`; no Rust crate contains game rules (review rule); generated code is never edited.
- As built: the co-op suites start a real stack (`scripts/lib/stack.mjs`); the browser suites that need accounts run through `scripts/with-stack.mjs`; CI runs both, plus `scripts/check-wgsl.mjs`.

## 13. Steps (one PR, each step keeps the game working)

| # | Step | Done when |
| --- | --- | --- |
| 1 | **Monorepo** restructure (pnpm workspaces, `packages/rules` / `packages/game` / `apps/client` / `apps/server`; the Cargo workspace and `apps/worker` arrive with steps 3 and 5), no behaviour change | **done**: unit 492/492 (with DB), co-op protocol 51/51, co-op map 28/28, image smoke test, e2e arenas 16/16, combat 37/37, runmap 54/54, m10 21/24 and m1 69/70 (the known C1-C3 / Z failures) |
| 2 | **Protocol schema** in `proto/`, TS codegen; the existing Node server + client switch from JSON to protobuf frames | **done**: protocol v12 (binary frames; legacy JSON tabs get a reload notice), `packages/protocol` (generated protobuf-es + `codec.ts` / `eventCodec.ts` / `snapshotCodec.ts`, exact round-trips, `tests/codec.test.ts`), Rust types in `crates/proto`; unit 501/501, co-op protocol 52/52, co-op map 28/28, browser co-op X 13/13 (0 of ~2400 events rejected), smoke over hand-encoded frames. Snapshots ~33% smaller than JSON (rows ~43%); delta compression comes with step 7 |
| 3 | **Gateway skeleton**: config, OTel tracing/logs/metrics, health, sqlx migrations (new schema), Redis, CI Rust jobs | **done**: `crates/gateway` (lib + bin, env config, OTLP/gRPC export when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, verified against a collector; JSON stdout logs; `/health` 503 when Postgres or Redis is down; graceful SIGTERM), `crates/db` (`0001_accounts.sql`: accounts, passkeys, recovery codes, sessions, profile documents, war state), CI job (fmt, clippy -D warnings, tests on Postgres + Redis services), toolchain 1.97 |
| 4 | **Passkeys + sessions** + client sign-in/sign-up screens | **done**: `crates/gateway/src/auth` (webauthn-rs 0.6, name-first sign-in, single-use ceremonies in Redis, Argon2id recovery codes, opaque session cookies hashed in Postgres + 60 s Redis cache with immediate revocation on recovery, Redis rate limits, unique case-insensitive names, 7-day rename cooldown, hourly expired-session purge), `crates/db/src/accounts.rs`; client `apps/client/src/account` (main menu ACCOUNT: create / sign in / recover, passkeys, recovery code, rename, offline fallback); Rust auth tests 3/3, `scripts/e2e-accounts.cjs` 19/19 with Chromium's virtual authenticator. Accounts are not yet linked to game progress (step 5) |
| 5 | **Rules worker + sync**: IndexedDB store, log, `Sync` RPC, profile ops through the gateway, run journals + loot re-roll validation | **done**: `packages/rules` `progression/runRules.ts` (named run entries), `runCheck.ts` (loot stream replay per node, source/tier bounds, merchant regeneration, reward/kill/timing ceilings), `sync.ts` (genesis check, atomic replay); `apps/worker` (rules role, TCP frames); gateway `/session` socket (cookie auth, protobuf `session.proto`), `sync.rs` (row lock, per-device seq de-duplication, guest adoption, change pushes), `workers.rs`; device `SyncJournal` + `Profile.runEntry/useNamespace/adoptServer`, `SessionClient`, account glue; `Game` records the loot journal. The device store stays localStorage (synchronous boot, well under quota) instead of IndexedDB. Tests: `tests/sync.test.ts` 10/10, Rust sync 1/1, `scripts/e2e-sync.cjs` 12/12 (real run drops re-rolled by the server) |
| 6 | **War** moves behind the gateway (storage, schedule, samples in Rust/Redis; rules in the worker) | **done**: `packages/rules/src/war/service.ts` (stored document, population samples, steps, reports), worker war call, gateway `war.rs` (document in memory + `war_state` row, 30 s tick, public `GET /war`, signed-in `POST /war/report` with Redis limits per account, online = open session sockets); `WarClient` targets the gateway (`apiBase`, credentials; guests get a sign-in note). Co-op operations still use the legacy server's war until step 7. Tests: Rust war 1/1, e2e-sync F1-F2, e2e-runmap 54/54 (twice; the W4 setup no longer depends on the random local war seed) |
| 7 | **Co-op through the gateway**: sim workers (lobby + operations), routing, lag compensation, smooth corrections | **done**: see section 8; `apps/server` deleted (its PostgreSQL tables with it); protocol v13 (no guest identity, no online-profile messages); gateway test login (`POST /auth/test-login`, RIFT_TEST=1 only), Origin check on `/session`, `/health` reports sim workers, 2 KB cap on war reports; suites run against a real stack (`scripts/lib/stack.mjs`: fresh database, rules + sim workers, gateway). Tests: unit 512/512, co-op protocol 52/52 (B-S incl. the sim worker crash S11-S13), co-op map 28/28, browser co-op X 13/13 (0 of ~2400 events rejected), Rust tests, lint unchanged (6 warnings) |
| 8 | **Deploy**: images, compose, `deploy.sh` with draining, Cloudflare Pages, collector + ClickHouse + Grafana dashboards | **done**: see sections 9-10. A rolling deploy during a running co-op operation kept it alive: the gateway restarted, both players rejoined the same operation, and its sim slot was replaced only once the operation ended. Fixed on the way: a health probe on a sim worker's port used to take over the gateway stream (connections now become the gateway with their first frame); workers re-send room bindings to a restarted gateway and report load whenever it changes. Pages publishing waits for the Cloudflare token |
| 9 | **Frontend**: React 19, TanStack Router, Tailwind tokens, signal HUD, terminal split, deep imports, service worker | **done**: see section 11. First load 31 KB gzip (target < 0.6 MB). UI suites: accounts 19/19, sync 14/14, run map 54/54, m4 39/39 (terminals), m2 51/54 (known C8/C9/I4), combat 37/37, arenas 16/16, m1 69/70 (known Z); account panel screenshot identical; offline start verified |
| 10 | **WebGPU** with WebGL2 fallback, WGSL ports | **done, opt-in**: engine factory, WebGPU extensions, WGSL twins of every custom shader + the hit-flash plugin, all 15 shaders compile with Tint (CI); suites pass on WebGL2. Rendering frames on WebGPU could not be verified headless (see section 11): WebGPU stays a beta setting until a real-GPU check |
| 11 | **Docs**: README, CLAUDE.md, this file marked done | **done** |

Steps 9-10 do not depend on 3-8 and can be interleaved when a session is blocked on something else.

## 14. Capacity notes (to measure, not assumed)

- Solo players cost the server only sync traffic and rules-worker replays (milliseconds per run), so hundreds of solo players are cheap.
- A co-op room costs ~2-9 ms of CPU per 60 Hz tick today (SwiftShader-era measurement of the headless sim), i.e. roughly 2-6 heavy rooms per core.
- **The server: 4 cores, 4 GB allocated.** Plan: 2 sim workers (one core each, ~4-10 concurrent co-op rooms in total), 1 rules worker, the gateway and the databases sharing the rest. Starting memory limits:

  | service | limit |
  | --- | --- |
  | gateway | 128 MB |
  | worker-rules (1) | 256 MB |
  | worker-sim (2) | 2 x 512 MB |
  | postgres | 512 MB (`shared_buffers` 128 MB) |
  | redis | 96 MB (`maxmemory`, `allkeys-lru` for caches only) |
  | clickhouse | 1 GB |
  | otel-collector | 128 MB |
  | grafana | 192 MB |
  | **total** | ~3.3 GB (headroom for spikes) |

  Idle stack measured at ~0.5 GB (step 8). The gateway refuses new co-op sessions when every sim worker is at capacity (`RIFT_SIM_CAPACITY` operations each; "servers full", solo unaffected; co-op protocol K1-K3). The room directory and worker links allow a second sim host later.

## 15. Owner actions (what the code cannot do)

1. **Cloudflare Pages**: create the project `riftwarden` with the custom domain `riftwarden.ykdbonte.dev`, add the repository secrets `CLOUDFLARE_API_TOKEN` (Pages: edit) and `CLOUDFLARE_ACCOUNT_ID`. Until then the deploy job publishes the API and skips the client with a warning.
2. **Server**: install the new `deploy/` files in `~/stacks/riftwarden` (`.env` from `.env.example`, systemd units, tunnel ingress from `cloudflared.example.yml`: `api.` and `grafana.`), see `deploy/README.md`. Everyone starts fresh (the old `profiles` volume is no longer used).
3. **Cloudflare Access** application for `grafana.riftwarden.ykdbonte.dev`.
4. **Real-GPU check of WebGPU** (Settings > Renderer > WebGPU beta, or `?webgpu`): the HQ and an arena on Chrome/Edge with a real GPU. If it looks and plays right, make WebGPU the default in `packages/game/src/core/settings.ts` (`renderer`).
5. **Backups**: none yet (owner decision); `pg_dump` of the `riftwarden` database is the first thing to schedule when that changes.
