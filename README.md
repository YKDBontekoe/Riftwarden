# Riftwarden

A first-person sci-fi action tower-defense roguelite for the browser. You are a hovering combat drone defending an energy reactor against endless waves of robotic machines, with procedural loot, a branching run map on a shared war map, towers, and 2-4 player co-op.

**Status: Architecture v2** (prototype -> production, [docs/architecture-v2.md](docs/architecture-v2.md)): a Rust gateway is the only backend, gameplay rules stay in one TypeScript copy executed by internal Node workers, Protobuf over one WebSocket, passkey accounts, offline play with server-validated sync, and a Vite + React 19 + Tailwind client with an optional WebGPU renderer.

## Repository layout

| Path | What |
| --- | --- |
| `packages/rules` | Pure gameplay, loot, economy, progression and war rules (no Babylon, no DOM) |
| `packages/game` | Simulation and Babylon presentation (arena, HQ, enemies, weapons, co-op replica/authority) |
| `packages/protocol` | Protobuf types generated from `proto/` plus the frame codecs |
| `apps/client` | Browser client: shell, routes, React UI, account + sync glue, service worker |
| `apps/worker` | Internal workers: `rules` (profile replay, run validation, war steps) and `sim` (co-op lobbies and operations) |
| `crates/gateway` | Rust gateway (axum): passkeys, sessions, sync, war, co-op routing, admin listener |
| `crates/db`, `crates/proto` | PostgreSQL access + migrations (sqlx), Rust protobuf types |
| `deploy/` | Images, Compose stack, deploy script ([deploy/README.md](deploy/README.md)) |
| `scripts/`, `tests/` | Browser + protocol suites, Vitest suites |

## Run it

Node 24, pnpm 10 (`corepack enable`), Rust 1.97 (`rust-toolchain.toml`), a desktop browser with WebGL2.

```bash
pnpm install
pnpm dev                # client on http://localhost:5173 (solo play works without a backend)
```

Click **ENTER HEADQUARTERS**, walk to the launch bay and press **E** at the deployment terminal. A first-time profile gets a short onboarding tutorial (skip with F10 or in Settings).

### Backend (accounts, sync, Rift War, co-op)

PostgreSQL and Redis, then the gateway with its workers next to `pnpm dev` (Vite proxies `/auth`, `/session` and `/war` to it):

```bash
docker run -d --name rift-pg -p 127.0.0.1:5432:5432 -e POSTGRES_USER=rift -e POSTGRES_PASSWORD=rift -e POSTGRES_DB=rift postgres:18
docker run -d --name rift-redis -p 127.0.0.1:6379:6379 redis:8-alpine
DATABASE_URL=postgres://rift:rift@127.0.0.1:5432/rift REDIS_URL=redis://127.0.0.1:6379 pnpm backend
```

`pnpm backend` builds the gateway with cargo and starts it on :8090 with a rules worker and a sim worker (migrations run at gateway start). In **ACCOUNT** (main menu) create an account with a passkey; your progress then syncs to the server and to every device you sign in on, and play continues offline (changes sync when the connection is back). **CO-OP** needs a signed-in account: one player creates a session and shares the code or the invite link (`#/join/CODE`), the others join and ready up, the host picks the threat tier, mode and Rift War sector and deploys.

In a co-op run the sim worker owns enemies, waves, the reactor, towers and loot; each player keeps their own equipment and drops, banks individually at checkpoints into their own account, and the team votes on the run map. Disconnected players keep their slot for 120 s and rejoin the running operation.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Client dev server with hot reload |
| `pnpm backend` | Gateway + workers for development (`DATABASE_URL`, `REDIS_URL`) |
| `pnpm build` | Typecheck + production client build into `dist/` |
| `pnpm test` / `pnpm lint` | Unit tests (Vitest) / lint (ESLint ratchet) |
| `cargo test` | Rust tests (`RIFT_TEST_DATABASE_URL`, `RIFT_TEST_REDIS_URL` for the database suites) |
| `pnpm proto` | Regenerate protocol code after changing `proto/` |
| `node --import tsx scripts/e2e-coop-protocol.mjs` | Co-op protocol suite (own stack; `RIFT_TEST_DATABASE_URL`, `RIFT_TEST_REDIS_URL`) |
| `node --import tsx scripts/with-stack.mjs node scripts/e2e-accounts.cjs` | A browser suite that needs the backend |
| `node scripts/e2e-m1.cjs` … | Solo browser acceptance suites (Playwright; `RIFT_URL` selects the client) |
| `node scripts/e2e-feel-polish.cjs` | Movement, reduced-motion camera, first-frame weapon, enemy contacts and combat screenshots (`E2E_OUT` selects the output directory; `QA_GRAPHICS=high` checks high graphics) |
| `node scripts/e2e-render-lifecycle.cjs` | Rapid scene disposal, asynchronous lighting lookup decode, and repeated deployment cleanup |
| `node scripts/visual-review.cjs` | Seven matched high-preset captures; set `E2E_OUT` to `review/before` or `review/after` and reuse the generated profile |
| `node scripts/visual-comparison.cjs review` | Build a self-contained HTML before/after comparison with sliders and side-by-side views |
| `node --import tsx scripts/check-wgsl.mjs` | Compile the WebGPU shaders with the browser's WGSL compiler |

Graphics: WebGL2 by default; **Settings > Graphics > Renderer > WebGPU (beta)** (or `?webgpu`) switches to Babylon's WebGPU renderer on the next start.

### HQ construction

The **Architect console** in the command deck opens construction mode: an overhead camera over the 5 m expansion grid east and west of the core HQ (gateways behind the side walls). Pieces: floors, walls, corners, doorways, doors, windows, ceilings, pillars (snapped), furniture, machinery, trophies and lights (free placement: move, rotate R, scale +/-, snap toggle G), plus functional facilities (storage annex, market uplink, calibrator). Undo/redo (Ctrl+Z / Ctrl+Y), removal refunds in full. The validator refuses floating rooms, overlaps, blocked spawn/launch pad/doorways and anything that would make a station unreachable. Stations can be relocated onto built floors. Blueprints are unlocked by progression (tiers, milestones, bosses), bought from the architect catalogue or fabricated; all costs use credits/salvage/components already secured at HQ.

## Contributing

Start short-lived branches from an up-to-date `main` and open a pull request back into `main`. For example, use `fix/pause-menu` for a pause menu fix.

Before merging, resolve review conversations and wait for **Build and unit tests**, **Rust gateway** (Rust tests and the co-op protocol suites), **Browser suites** and **Dependency review** to pass. Update the branch from `main` if GitHub requests it. The dependency check blocks newly introduced high or critical vulnerabilities. Run the relevant browser acceptance suite locally for gameplay changes.

GitHub squash-merges pull requests and automatically deletes merged branches in this repository. Use the pull request title to summarize the change in `main` history.

See the [security policy](.github/SECURITY.md) for private vulnerability reporting.

## Production deployment

Merges to `main` run the tests (unit, Rust, co-op protocol suites against a real stack, browser suites), build the gateway and worker images, smoke-test the whole Compose stack, and publish both images to GitHub Container Registry. The server's deploy timer pulls them: it restarts the gateway in place (players reconnect; co-op operations keep running in the sim workers), then drains and replaces each sim slot only when its operations have finished, and rolls back a gateway that does not come up healthy. The static client is published to Cloudflare Pages once the API serves the new build. Details, first-time setup and operating notes: [deploy/README.md](deploy/README.md).

Play at [riftwarden.ykdbonte.dev](https://riftwarden.ykdbonte.dev) (API: `api.riftwarden.ykdbonte.dev`). Logs are JSON on stdout (observability with ClickHouse + Grafana is postponed).

## Controls

| Input | Action |
| --- | --- |
| WASD / Mouse | Move / aim |
| E | Use the terminal you are looking at (HQ); E or Esc closes it |
| LMB | Fire (in build mode: place turret) |
| Space | Jump; press again in the air for a vertical boost |
| Shift | Dash (2 charges); keep holding to sprint |
| 2 or B | Toggle tower build mode (RMB or 1 cancels; C/V/N/M cycle components) |
| Q | Tactical mode: slows hostile time and opens build mode for rapid placement |
| Hold X | Recycle the turret you are looking at (75% refund) |
| G | Start the wave early |
| H | At a checkpoint (preparation phase): reopen the continue / return-to-HQ choice |
| Esc | Pause (releases the mouse); in a run the pause menu can abandon it |
| F3 | Performance overlay (FPS, enemies, draw calls, particles) |
| F10 | Skip the onboarding tutorial |
| U / T | Run build overview / tower refit panel |

All keys can be rebound in Settings > Controls. In co-op the team panel shows each warden's state and your latency.

## The economy loop (M4)

**Deploy -> survive -> bank loot, salvage, credits and advanced components every 5 waves -> return to HQ -> sell / dismantle / buy / craft / engineer -> deploy stronger.**

- **Resources:** *credits* (trade currency: wave clears, checkpoints, elite kills, selling), *salvage* (dismantling, kills, waves) and *advanced components* (rare: checkpoints by threat tier, elite kills, dismantling rare+ gear). All three are unsecured until banked, exactly like loot.
- **Market Concourse** (east of storage): the *Equipment Exchange* sells 8 generated items (one featured rare+) and buys your gear; the *Module Broker* sells 6 modules (compatibility with your weapons shown), buys modules and runs a limited material exchange. Stock is persisted and restocks after every completed operation (or a paid, escalating manifest refresh). Merchants never sell legendary or exotic gear.
- **Reclamation** (west of the drone bay): the press dismantles single items or batches (quick-select by rarity) with a full yield preview. Equipped and locked items are protected; lock any item from storage, the press or the market.
- **Engineering Workshop:** modules (M3 install/remove/transfer), *affixes* (recalibrate one stat, refine its value, or reroll every unlocked affix; locks cost components; costs escalate per item), *enhancement* (+levels with rarity caps, never fails), *components* (refit barrel, core, cooling or firing mechanism within the family; the 3D preview shows the result).
- **Fabricator** (workshop): craft weapons by family, armor, shields, reactors, processors, accessories and each module type in four quality grades (standard, refined, superior, masterwork) at your progress level, plus material conversions.

## The loop (M1)

**Headquarters -> deployment terminal -> pick a threat tier -> deploy -> survive waves -> checkpoint every 5 waves (salvage banked) -> continue or return home -> HQ.**

- **Headquarters:** an explorable 3D base (same hover-drone controller as the arena) with a command deck (holo-table, live service-record and salvage displays), a launch bay with the deployment terminal, a drone bay (configuration terminal, your drone on a cradle), storage racks with a storage terminal, a workshop bench, and sealed doors reserved for future facilities.
- **Terminals:** *Deployment* (arena, tier selection with modifiers and per-tier records, deploy), *Drone configuration* (equipped Plasma Repeater with real stats, drone stats, all seven equipment slots), *Storage* (secured salvage, equipment bays, empty state), *Workshop* (status only: fabrication is not available yet), *Command console* (service record, per-tier survival records, recent operations, save status).
- **Threat tiers:** I Standard, II Advanced, III Extreme scale enemy health, damage, speed and count (and salvage). Each tier unlocks at the first checkpoint on the tier below.
- **Salvage and banking:** kills and cleared waves earn salvage. It is *unsecured* until the next checkpoint (waves 5, 10, 15...), where it is banked to HQ automatically. Losing the reactor or abandoning the run loses unsecured salvage; secured salvage and equipped gear are always kept.
- **Persistence:** a versioned, checksummed save in localStorage with automatic backup and corruption recovery. It survives refreshes and browser restarts. A run interrupted by closing the tab is recorded as interrupted.

## What is in M0

- **Arena:** procedurally built research facility: central reactor, three rift gates (N/E/W), lit orange enemy lanes, elevated platforms with ramps, cover pillars, machinery.
- **Player:** Havok character controller with snappy acceleration, air control, jump + air boost, 2-charge dash, sprint, recoil, landing dip, FOV kick.
- **Weapon:** hitscan plasma repeater with heat/overheat, spread bloom, crits (weakpoints always crit), tracers, muzzle flash and light, impact sparks, hitmarkers (hit/crit/shield/kill) and damage numbers.
- **Enemies:** Strider walker (shoots telegraphed, dodgeable bolts at the player; attacks the reactor), Rush drone (fast kamikaze), Bulwark elite (regenerating shield, wave 4+).
- **Tower defense:** Sentinel turret with free-form placement, ghost preview with valid/invalid reasons, costs, lane-protection rules, build-in animation, priority targeting (enemy closest to the reactor), line-of-sight, inspection and recycling.
- **Tactical mode:** limited energy pool, slows hostile simulation to 22% while the player and turrets run at full speed.
- **Waves:** 3 hand-designed waves, then a deterministic endless generator (count/health/damage scaling, more gates, rush swarms, Bulwark elites). Prep phase, combat, clear rewards, reactor repair, defeat and restart.
- **UI:** React HUD and menus, settings (sensitivity, FOV, graphics quality, volume) persisted in versioned localStorage.
- **Audio:** procedural WebAudio sound effects (no asset files), positional panning, low-pass during tactical mode.

See [CLAUDE.md](CLAUDE.md) for architecture, design decisions and known limitations.
