# Riftwarden

A first-person sci-fi action tower-defense roguelite for the browser. You are a hovering combat drone defending an energy reactor against endless waves of robotic machines, using a plasma repeater, fast movement and automated Sentinel turrets.

**Status: Milestone M0 (polished playable foundation).**

## Run it

Requires Node 20+ and a desktop browser with WebGL2.

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL (default http://localhost:5173), click **DEPLOY**.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck + production build into `dist/` (static, deployable anywhere) |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript only |

## Controls

| Input | Action |
| --- | --- |
| WASD / Mouse | Move / aim |
| LMB | Fire (in build mode: place turret) |
| Space | Jump; press again in the air for a vertical boost |
| Shift | Dash (2 charges); keep holding to sprint |
| 2 or B | Toggle Sentinel build mode (RMB or 1 cancels) |
| Q | Tactical mode: slows hostile time and opens build mode for rapid placement |
| Hold X | Recycle the turret you are looking at (75% refund) |
| G | Start the wave early |
| Esc | Pause (releases the mouse) |
| F3 | Performance overlay (FPS, enemies, draw calls, particles) |

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
