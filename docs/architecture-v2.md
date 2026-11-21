# Riftwarden architecture v2 (prototype -> production)

Status: **approved 2026-11-21**; implementation in progress (see section 13). Once approved, this file is the plan for the "Architecture v2" milestone and wins over older notes in CLAUDE.md where they conflict.

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

### War reports
Secured sectors ride in the run journal. A report counts toward liberation only if it reaches the server within **6 h** of the action and the sector still exists in that state; older reports still give the player their rewards but no war credit. Rate limits move to Redis per account.

## 8. Co-op (rooms, workers, lag compensation)

- **Lobby in the gateway** (port of `server/room.ts`: codes, ready, host transfer, tier = min unlocked from profile columns, sector/mode pick, reconnect window). Room directory in Redis.
- **Operations in sim workers**: the gateway picks the least-loaded worker of the current version, sends `StartRoom {players, loadouts, tier, node...}`, then routes realtime frames both ways. Banking and results come back as worker -> gateway messages and are committed by the gateway (the worker never touches the database).
- **Crash isolation**: a worker crash ends its rooms with "operation lost" (unsecured rewards lost, banked safe); the gateway restarts the worker.
- **Lag compensation**: the sim keeps a 1 s ring buffer of enemy positions per tick; a shot claim carries the client's render tick (interpolation delay included), and validation rewinds the targets to that tick (capped at 250 ms) before the reach/LOS checks. Replaces today's fixed latency allowance.
- **Prediction**: local drone movement stays client-predicted with server corrections; corrections become smooth (error decay over 100 ms instead of snapping), and the client predicts its own shot effects, ability cooldowns and pickups with server confirmation (some of this exists: shot claims, `mirrorUse`).

## 9. Deployment

- **Images**: `gateway` (Rust, distroless, static binary), `worker` (node:24-slim + one esbuild bundle + Havok wasm). Built in CI, pushed to GHCR (as today).
- **Compose services**: `gateway`, `worker-rules`, `worker-sim` (replicas), `postgres`, `redis`, `otel-collector`, `clickhouse`, `grafana`. `cloudflared` stays a systemd unit, routing `api.` to the gateway and `grafana.` to Grafana. Every service has a memory limit (section 14).
- **Pull-based deploy kept**: the systemd timer runs `deploy.sh`, which now:
  1. pulls the new images and runs migrations (`sqlx migrate run`, from the gateway binary on start; migrations are additive-only within a release);
  2. starts new-version sim workers, marks old ones **draining** in Redis (no new rooms; existing rooms run to their end, capped at 3 h);
  3. restarts the gateway (clients reconnect inside the existing reconnect window and re-attach to their room via the Redis room directory) and the stateless rules workers;
  4. verifies `/health` + build id, rolls back on failure (as today), and stops drained workers when their last room ends.
- **Static client**: CI builds and uploads to Cloudflare Pages (hashed assets immutable, `index.html` no-cache). The client checks the gateway's protocol version on connect and asks to reload when it is behind.
- **CI**: Rust (`fmt`, `clippy -D warnings`, `cargo test` with the Postgres + Redis services), `buf lint/breaking`, TS (lint, typecheck, Vitest), build, a Playwright smoke suite on every PR, the full browser suites nightly (they take ~1 h in SwiftShader), image smoke test (as today) and the live verification after deploy.

## 10. Observability (OpenTelemetry -> ClickHouse -> Grafana)

- **One pipeline for traces, logs and metrics**: every process emits OTLP to an **OpenTelemetry Collector** (contrib build, `clickhouse` exporter), which batches into **ClickHouse** (`otel_traces`, `otel_logs`, `otel_metrics_*` tables, TTL 14 days for traces/logs, 90 days for metrics). No Prometheus, no Sentry.
- **Gateway**: `tracing` + `tracing-opentelemetry` + `opentelemetry-otlp`: a span per RPC / sync / room event with account, room and request ids; logs are `tracing` events exported as OTLP logs (and JSON to stdout as a fallback); metrics via the OTel metrics API.
- **Workers**: `@opentelemetry/sdk-node` (traces + logs + metrics); a rules replay or a room tick is a span; sim tick time p50/p99 per room as histograms.
- **Browser**: no third-party SDK. Uncaught errors, unhandled rejections and a few client metrics (FPS buckets, load time, renderer backend) are posted to the gateway's `/telemetry` endpoint (batched, sampled, size-capped, rate limited), which forwards them to the collector as logs/metrics tagged with release = git sha. Source maps are kept as a CI artifact for manual symbolication (a Grafana link opens them later).
- **Metrics tracked**: connections, RPC latency/errors per method, sync entries accepted/rejected, rejected runs by reason, rooms, worker queue depth, sim tick time per room, DB pool, Redis latency, client errors per release.
- **Grafana** with the ClickHouse data source plugin, provisioned dashboards (overview, RPC, co-op rooms, sync/anti-cheat, client errors) and alert rules (gateway down, error rate, tick time). Exposed as `grafana.riftwarden.ykdbonte.dev` through the existing Cloudflare Tunnel, protected by Cloudflare Access (the owner configures the Access policy), Grafana's own login kept as a second layer.
- **Memory budget (4 GB total)**: ClickHouse is tuned for small hosts (`max_server_memory_usage` ~900 MB, low mark cache, `max_threads` 2) and the collector uses a memory limiter. See section 14.

## 11. Frontend

- **Shell**: Vite 7, React 19, TanStack Router for the out-of-game screens (title, sign-in, settings, co-op join `/join/:code`); the Babylon canvas lives outside the router and survives navigation.
- **Styling**: Tailwind v4 with the current colours, fonts and terminal accents as design tokens (`--acc`, verdict colours, rarity palettes incl. colour-vision variants). Migrate `style.css` panel by panel; the look stays the same. Split `Terminals.tsx` / `items.tsx` per panel while migrating.
- **HUD**: an imperative DOM layer bound to the 20 Hz HUD snapshot through fine-grained signals (`@preact/signals-core`), so per-frame/20 Hz updates never re-render React. React keeps menus, terminals, panels and the run map.
- **Rendering**: `WebGPUEngine` when supported, WebGL2 `Engine` otherwise (one factory in `main.tsx`). Port the custom shaders (`atmosphere`, `riftMist`, `reactorField`, `pathLighting`, `arenaLandmark`, `softParticles`) and the `hitFlashPlugin` material plugin to WGSL alongside their GLSL, verify Havok/picking/particles/post-processing on both backends, and keep the SwiftShader (WebGL2) path for automated tests.
- **Bundle**: deep imports from `@babylonjs/core` (side-effect imports where Babylon needs them) and route-level code splitting, target < 0.6 MB gzip JS for first load (today ~1.4 MB).
- **Offline**: a service worker caches the app shell and assets so the game starts without a network.

## 12. Testing

- **Rust**: unit tests per module; integration tests against real Postgres + Redis (CI services, as the current DB suites); protocol round-trip tests against the generated TS (golden frames).
- **Rules worker**: Vitest for sync replay (accept/reject, idempotent replays, multi-device conflicts), run validation (genuine journals pass, forged/edited items and impossible rewards fail), war ticking parity.
- **Browser suites**: solo still simulates in the browser, so `?test`, `window.__rift` and the solo suites (m1-m10, combat, runmap, arenas, polish, progression) keep working with path updates. The co-op suites (`e2e-coop-protocol`, `e2e-coop-map`, construction X, bot client) are rebuilt against the gateway + workers (the bot speaks protobuf). New suites: passkey sign-in (virtual authenticator in Playwright), offline play -> reconnect -> sync, draining deploy.
- Architecture tests extended: `packages/rules` imports nothing from `packages/game`; no Rust crate contains game rules (review rule); generated code is never edited.

## 13. Steps (one PR, each step keeps the game working)

| # | Step | Done when |
| --- | --- | --- |
| 1 | **Monorepo** restructure (pnpm + Cargo workspaces, `packages/rules` / `game` / `apps/client` / `apps/worker`), no behaviour change | all current tests and suites pass from the new paths |
| 2 | **Protocol schema** in `proto/`, TS codegen; the existing Node server + client switch from JSON to protobuf frames | co-op protocol suites pass over protobuf |
| 3 | **Gateway skeleton**: config, OTel tracing/logs/metrics, health, sqlx migrations (new schema), Redis, CI Rust jobs | gateway serves `/health`, migrations run in CI, spans reach the collector |
| 4 | **Passkeys + sessions** + client sign-in/sign-up screens | Playwright virtual-authenticator suite passes |
| 5 | **Rules worker + sync**: IndexedDB store, log, `Sync` RPC, profile ops through the gateway, run journals + loot re-roll validation | offline -> online sync suite; forged-item tests reject |
| 6 | **War** moves behind the gateway (storage, schedule, samples in Rust/Redis; rules in the worker) | war suites (W*) pass against the gateway |
| 7 | **Co-op through the gateway**: lobby in Rust, sim workers, routing, lag compensation, smooth corrections | rebuilt co-op suites pass; old `server/` deleted |
| 8 | **Deploy**: images, compose, `deploy.sh` with draining, Cloudflare Pages, collector + ClickHouse + Grafana dashboards | a deploy during a running co-op test room keeps the room alive |
| 9 | **Frontend**: React 19, TanStack Router, Tailwind tokens, signal HUD, terminal split, deep imports, service worker | UI suites pass, bundle target met, screenshots match the current look |
| 10 | **WebGPU** with WebGL2 fallback, WGSL ports | both backends render the HQ and an arena; suites pass on WebGL2 |
| 11 | **Docs**: README, CLAUDE.md, this file marked done | |

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

  Measured on the box in step 8; the gateway refuses new co-op rooms when every sim worker is at capacity ("servers full", solo unaffected). The room directory and worker registry allow a second sim host later.

## 15. Open questions (do not block steps 1-7)

1. **Cloudflare Pages**: CI needs a Cloudflare API token (Pages edit) as a GitHub secret before step 8 (owner adds it later).
2. **Cloudflare Access** policy for `grafana.` (owner configures it in step 8).
