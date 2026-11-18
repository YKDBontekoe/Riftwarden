# Riftwarden

A first-person sci-fi action tower-defense roguelite for the browser. You are a hovering combat drone defending an energy reactor against endless waves of robotic machines, using a plasma repeater, fast movement and automated Sentinel turrets.

**Status: Milestone M7: online co-op for 2-4 players (authoritative server), HQ construction, new weapons/towers/enemies/upgrades/signatures, onboarding, settings and audio overhaul.**

## Run it

Use Node 24 (the version used in CI) and a desktop browser with WebGL2.

```bash
npm install
npm run dev            # single player: http://localhost:5173
```

Click **ENTER HEADQUARTERS**, walk to the launch bay and press **E** at the deployment terminal. A first-time profile gets a short onboarding tutorial (skip with F10 or in Settings).

### Co-op (2-4 players)

For local co-op development, run PostgreSQL alongside the game server.

```bash
docker run -d --name riftwarden-dev-db -p 127.0.0.1:5432:5432 \
  -e POSTGRES_DB=riftwarden -e POSTGRES_USER=riftwarden -e POSTGRES_PASSWORD=riftwarden-dev \
  -v riftwarden_dev_db:/var/lib/postgresql postgres:18
export DATABASE_URL=postgresql://riftwarden:riftwarden-dev@127.0.0.1:5432/riftwarden
npm run serve          # builds the client, then serves it AND the co-op server on http://<host>:8787
```

Every player opens `http://<host>:8787`, chooses **CO-OP** in the menu (or the *Co-op* tab of the deployment terminal), connects and creates a fresh online profile. The host clicks **CREATE SESSION** and shares the 5-letter code or the invite link (`?join=CODE`); the others join, press **READY**, and the host picks the threat tier (every player must have unlocked it) and deploys. A host can also deploy alone with their online profile. While waiting in the lobby, guests can **VISIT HOST HQ** (read-only; only the owner can construct).

For development run `npm run server` (co-op server on :8787, overridable with `RIFT_PORT`) next to `npm run dev`; the dev server proxies `/ws`. The server creates the database tables on first startup. It accepts either `DATABASE_URL` or the standard PostgreSQL connection variables `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`. A different game server can be chosen with `?server=ws://host:port/ws`.

In a co-op run the server owns enemies, waves, the reactor, towers, loot, rewards and profiles. Each player keeps their own equipment and loot drops (ownership per player), banks individually at every 5th wave, and the team votes unanimously at checkpoints to continue or return. Towers, cores, tactical time and the reactor are shared. Disconnected players keep their slot for 120 s and rejoin the running operation.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run preview` | Serve the production build locally (proxies `/ws` like dev) |
| `npm run server` | Co-op server (WebSocket `/ws`, also serves `dist/`) |
| `npm run serve` | Build + co-op server: a complete deployment on one port |
| `npm test` | Unit tests (Vitest) |
| `node scripts/e2e-m1.cjs` … `e2e-m6.cjs` | Browser acceptance suites per earlier milestone (Playwright; `RIFT_URL` selects the client) |
| `node scripts/e2e-construction-coop.cjs [G,H,I,J,X]` | Browser suite: HQ construction, decorations, station relocation, blueprints, real browser co-op |
| `node scripts/e2e-coop-protocol.mjs` | Co-op protocol suite (starts its own server and uses an isolated schema in `RIFT_TEST_DATABASE_URL`) |

### HQ construction

The **Architect console** in the command deck opens construction mode: an overhead camera over the 5 m expansion grid east and west of the core HQ (gateways behind the side walls). Pieces: floors, walls, corners, doorways, doors, windows, ceilings, pillars (snapped), furniture, machinery, trophies and lights (free placement: move, rotate R, scale +/-, snap toggle G), plus functional facilities (storage annex, market uplink, calibrator). Undo/redo (Ctrl+Z / Ctrl+Y), removal refunds in full. The validator refuses floating rooms, overlaps, blocked spawn/launch pad/doorways and anything that would make a station unreachable. Stations can be relocated onto built floors. Blueprints are unlocked by progression (tiers, milestones, bosses), bought from the architect catalogue or fabricated; all costs use credits/salvage/components already secured at HQ.

## Contributing

Start short-lived branches from an up-to-date `main` and open a pull request back into `main`. For example, use `fix/pause-menu` for a pause menu fix.

Before merging, resolve review conversations and wait for **Build and unit tests** and **Dependency review** to pass. Update the branch from `main` if GitHub requests it. The dependency check blocks newly introduced high or critical vulnerabilities. Run the relevant browser acceptance suite locally for gameplay changes.

GitHub squash-merges pull requests and automatically deletes merged branches in this repository. Use the pull request title to summarize the change in `main` history.

See the [security policy](.github/SECURITY.md) for private vulnerability reporting.

## Production deployment

Merges to `main` run the tests and build, smoke-test the game and co-op WebSocket inside the production container, and publish the image to GitHub Container Registry. CI checks the deployed commit and repeats the WebSocket handshake and ping through Cloudflare. The `production` GitHub environment only accepts `main`. You can also run the CI workflow manually on `main` to redeploy it.

Play at [riftwarden.ykdbonte.dev](https://riftwarden.ykdbonte.dev) and select **CO-OP**. The Cloudflare Tunnel publishes both the game and `wss://riftwarden.ykdbonte.dev/ws` from the container's loopback port. PostgreSQL runs on the private Compose network. Online profiles and banked rewards live in the `riftwarden_postgres` volume and survive container updates. Lobbies and in-progress sessions end when the server restarts.

Before publishing the PostgreSQL build, install the updated Compose file and deploy script in `~/stacks/riftwarden`. Generate a secret with `openssl rand -hex 32` and set it as `RIFT_POSTGRES_PASSWORD` in that directory's `.env`. Back up the `riftwarden` database off-host with `pg_dump`. The first PostgreSQL deployment starts fresh online profiles. The Solo tab uses browser saves. [Compose file](deploy/compose.yml) · [Deploy script](deploy/deploy.sh)

The Ubuntu server checks for a new image every minute and restores the previous image if the update fails its local health or revision check. Run `systemctl --user start riftwarden-deploy.service` to check for an update immediately and `journalctl --user -u riftwarden-deploy.service` to inspect deployment logs. [Systemd units](deploy/systemd/)

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
