# Riftwarden

A first-person sci-fi action tower-defense roguelite for the browser. You are a hovering combat drone defending an energy reactor against endless waves of robotic machines, using a plasma repeater, fast movement and automated Sentinel turrets.

**Status: Milestone M4 (persistent economy: merchants, salvaging, fabrication, affix engineering, enhancement, component engineering).**

## Run it

Requires Node 20+ and a desktop browser with WebGL2.

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL (default http://localhost:5173), click **ENTER HEADQUARTERS**, walk to the launch bay and press **E** at the deployment terminal.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck + production build into `dist/` (static, deployable anywhere) |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript only |
| `node scripts/e2e-m1.cjs` … `e2e-m4.cjs` | Browser acceptance suites per milestone (need `npm run dev` running and Playwright) |

## Contributing

Start short-lived branches from an up-to-date `main` and open a pull request back into `main`. For example, use `fix/pause-menu` for a pause menu fix.

Before merging, resolve review conversations and wait for **Build and unit tests** and **Dependency review** to pass. Update the branch from `main` if GitHub requests it. The dependency check blocks newly introduced high or critical vulnerabilities. Run the relevant browser acceptance suite locally for gameplay changes.

GitHub squash-merges pull requests and automatically deletes merged branches in this repository. Use the pull request title to summarize the change in `main` history.

See the [security policy](.github/SECURITY.md) for private vulnerability reporting.

## Controls

| Input | Action |
| --- | --- |
| WASD / Mouse | Move / aim |
| E | Use the terminal you are looking at (HQ); E or Esc closes it |
| LMB | Fire (in build mode: place turret) |
| Space | Jump; press again in the air for a vertical boost |
| Shift | Dash (2 charges); keep holding to sprint |
| 2 or B | Toggle Sentinel build mode (RMB or 1 cancels) |
| Q | Tactical mode: slows hostile time and opens build mode for rapid placement |
| Hold X | Recycle the turret you are looking at (75% refund) |
| G | Start the wave early |
| H | At a checkpoint (preparation phase): reopen the continue / return-to-HQ choice |
| Esc | Pause (releases the mouse); in a run the pause menu can abandon it |
| F3 | Performance overlay (FPS, enemies, draw calls, particles) |

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
