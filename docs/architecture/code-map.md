# Code map

> Where things live, one line per module (`[pure]` = no Babylon/DOM, unit-testable). Moved from the old root `CLAUDE.md`. Package `src/` paths are relative to their package (`core/Game.ts` = `packages/game/src/core/Game.ts`). Keep this current when you add, move or split a module; `rg`/`Glob` are the ground truth.

Workspace (pnpm, `pnpm-workspace.yaml` with a version catalog): every package keeps the old `src/` sub-paths, so `core/Game.ts` lives at `packages/game/src/core/Game.ts`. Dependency direction is enforced by `tests/architecture.test.ts`: `apps/client` -> `packages/game` -> `packages/protocol` -> `packages/rules`; `packages/rules` imports nothing outside itself (no Babylon, React, DOM libraries or Node modules); `packages/game` never imports React (`useHud` lives in `apps/client/src/ui/useHud.ts`). Cross-package imports use the package name (`@riftwarden/rules/loot/roll`); directory barrels have explicit `exports` entries (`progression/save`, `enemies/bosses`). The client build writes to the repository root `dist/` (server, Docker image and CI read it there). Tests stay in the root `tests/`; browser suites import modules in the page with `/@id/@riftwarden/<pkg>/<path>`.


```
apps/client/src/main.tsx               boot: Havok WASM, Engine, Flow, React root, ?test hook; the ONLY render loop
crates/gateway/src/            V2: lib.rs (router, state), auth/ (passkeys, sessions, names, recovery, test login), session.rs (/session socket: sync calls + co-op tunnel),
                           sync.rs (profile sync via the rules worker, trusted entries), coop.rs (sim worker links, room directory, routing, capacity, lost operations),
                           war.rs (war document, tick, GET /war, POST /war/report), admin.rs (drain/status listener + CLI client), workers.rs, limits.rs, telemetry.rs
crates/db/                 V2: sqlx queries + migrations (accounts, passkeys, sessions, recovery codes, profiles, profile_devices, war_state)
apps/worker/src/           V2: main.ts (role rules|sim, framed TCP), rules.ts (replay/war calls), telemetry.ts (OTLP logs), sim/host.ts (players, rooms, bindings,
                           load, capacity), sim/room.ts (lobby), sim/coopSim.ts (CoopSim: 60 Hz loop around ServerGame), sim/store.ts (profiles + run entries), sim/headless.ts
apps/worker/build.mjs      V2: production esbuild bundle + Havok wasm
apps/client/src/main.tsx   V2: 1 KB shell (styles, splash, PWA init) -> boot.tsx (engine, Havok, Flow, React root); core/engine.ts (WebGL2 / WebGPU)
packages/game/src/core/touch.ts           MOBILE: touch rules: stickVector (dead zone, analog drive, sprint past the ring), knobOffset, lookDelta, wantsTouch / nextTouchState, isPortrait [pure]
apps/client/src/touch/     MOBILE: touchMode.ts (touch mode store, auto switch on pointer kind, pauseWorld, enterImmersive = fullscreen + landscape lock), TouchControls.tsx (overlay), MobileUi.tsx (RotateHint, UpdateToast, InstallApp), touch.css (overlay + touch-mode HUD layout)
apps/client/src/pwa.ts     MOBILE: service worker registration, waiting-update detection (skip-waiting message), beforeinstallprompt / iOS install hint, pwaStore
apps/client/public/        MOBILE: manifest.webmanifest + icons/ (rendered by scripts/make-icons.cjs from the warden mark)
scripts/e2e-mobile.cjs     MOBILE browser suite (emulated landscape phone, real CDP multi-touch): A boot/defaults/PWA UI, B HQ stick/look, C arena fire/aim/jump/dash/sprint/abilities/swap/wave/ult, D build + pause + legend + cargo, E portrait hint, F mouse leaves auto touch mode, G terminal scroll + close, V screenshots
scripts/e2e-pwa.cjs        MOBILE: production-build suite with its own static server (installability, offline start, update waits for RELOAD)
apps/client/src/ui/router.tsx, ui/hud/live.tsx, ui/app.css, sw-plugin.ts   V2: routes, signal HUD bindings, Tailwind entry, service worker generator
apps/client/src/account/   V2: passkey API + WebAuthn, account store, AccountPanel, sync.ts (account <-> profile namespace, guest adoption, SessionClient)
apps/client/src-tauri/src/  DESKTOP: main.rs (shell and local API proxy), cors.rs (credentialed proxy CORS and preflight test)
packages/game/src/net/SessionClient.ts, NetClient.ts   V2: session socket (sync, change notices, co-op tunnel); co-op client over that tunnel
packages/game/src/progression/SyncJournal.ts            V2: offline log per profile namespace (genesis + entries)
packages/rules/src/progression/sync.ts, runRules.ts, runCheck.ts   V2: replay, run entries, run validation (loot stream replay, ceilings)
packages/rules/src/net/lagComp.ts                       V2: hostile position trails for shot claims, correction blending [pure]
packages/game/src/babylonSideEffects.ts, visuals/wgsl.ts    V2: Babylon side-effect imports; WGSL twins of every custom shader
deploy/                    V2: gateway/worker Dockerfiles, compose.yml, deploy.sh (drain + rollback), README (observability stack postponed)
scripts/lib/stack.mjs, with-stack.mjs, dev-stack.mjs, bot.mjs, smoke-stack.mjs, check-wgsl.mjs   V2: test/dev stacks, protocol bot, deploy smoke, WGSL compile check
packages/rules/src/progression/{tiers,riftLevel,unlocks,mastery,spikes,seasons}.ts  PROGRESSION: Rift Levels, readiness, unlock track, weapon mastery, codex/breakthroughs/pinnacle/war caches, seasons [pure]
packages/rules/src/loot/feedback.ts, packages/game/src/arena/LootVerdicts.ts   PROGRESSION: NEW BEST / build verdicts / recap
apps/client/src/ui/{RiftLevel,UnlockTrack,Mastery,RunRecap,Spikes,Seasons}.tsx, core/unlockWatch.ts   PROGRESSION UI; crates/db/src/boards.rs + crates/gateway/src/boards.rs: GET /boards
packages/rules/src/war/regions.ts         RIFT WAR: regionLayout(seed, k) (memoised): free sector network (MST + short non-crossing links), landing / capital / rift source, biome-coherent arena seeds, globe lat/lon, cross-region links; regionNode, parseRegionId [pure]
packages/rules/src/war/state.ts           RIFT WAR: WarState + rules: newWar, tickWar (hourly, seeded per hour: resistance, corruption spread + defense events + fallback, distress, convoys, orders), secureNode (liberation / avg online, purge, repel, order progress, conquest -> next region), liveMods, buffEffect, sanitizeWar; WAR tuning [pure]
packages/rules/src/war/world.ts           RIFT WAR: run view: findNode, liveNode (live mods), reachable (links in unlocked regions), defaultEntry, regionOf, pathCode [pure]
packages/game/src/war/client.ts          RIFT WAR: WarClient (GET /war, POST /war/report, local war in localStorage when offline / ?test, seen marker for reactions)
apps/client/src/war/GlobeView.ts       RIFT WAR: Babylon mini globe on its own canvas (grid, region markers by status, selection ring, spin to region)
apps/client/src/ui/WarMap.tsx          RIFT WAR: Globe, RegionMap (territory glow, liberation rings, corruption, live events with timers, path, lookahead, fresh-change pings), RegionStrip, RegionTabs, OrderBanner, WarReport, WarHeader
packages/rules/src/war/service.ts         RIFT WAR: stored document, population samples, steps, reports (run by the rules worker; crates/gateway/src/war.rs schedules and serves it) [pure]
packages/rules/src/runmap/defs.ts         RUN MAP: node kinds, node modifiers (NODE_MODS), curses/blessings, anomalies, forge/rest/merchant services, ACT_BOSSES, priceScale [pure]
packages/rules/src/runmap/map.ts          RUN MAP: MapNode shape, rollMods, nodeEffect/combineEffects, actEffect, segmentTier, nodeInfo (layouts now come from war/regions) [pure]
packages/rules/src/runmap/carry.ts        RUN MAP: RunCarry (what crosses nodes), towerRefund, carryStats (curses/blessings/forge), curse rules, sanitizeCarry [pure]
packages/rules/src/runmap/hub.ts          RUN MAP: merchantStock, forgePrice, resolveAnomaly (seeded outcomes), GUARDIAN tuning [pure]
packages/rules/src/runmap/state.ts        RUN MAP: RunMapState (persisted on activeRun.map), resumable, sanitizeMapState [pure]
packages/rules/src/runmap/brief.ts, view.ts RUN MAP: NodeBrief (map/loading cards), NodeHud / RunMapView / StationPanel view models [pure]
packages/game/src/arena/RunNode.ts       RUN MAP: the arena side of a node (NodeHost): carry restore, segment completion + rewards, hub stations (E), panels, guardians, map trigger, exportCarry; replica mode for co-op clients (netState/applyNet)
packages/game/src/core/mapSession.ts     RUN MAP: solo map session (Flow helper): entered/leave bookkeeping, node leftovers banking, resume point, map view
packages/game/src/visuals/nodeProps.ts   RUN MAP: station rigs on a shared octagonal deck (trade kiosk, forge + hammer, repair arch + scanner, anomaly shard cluster, armoured safe, standing exit portal with the rift shader); used = glow material dimmed; tests/hub-stations.test.ts (headless build, bounds, dim, dispose)
packages/rules/src/runmap/intel.ts        NODE INTEL: nodeIntel (the arena planner's real roster for a node: hostiles, elites, boss, events, total HP, time to clear at your DPS, threat 1-5, effect deltas, reward lines), lookahead (downstream nodes, rows to boss, fight range, shop/rest ahead) [pure]
packages/rules/src/arena/Hunt.ts          SURVIVAL: Hunt (enemy layout whose reactor follows the hunted drone, nav re-seeding on the living drones), HUNT tuning
packages/rules/src/net/mapVote.ts         RUN MAP: resolveMapVote / voteComplete (majority, host tie-break, home voters) [pure]
apps/client/src/ui/RunMap.tsx          RUN MAP: MapChart (SVG star chart), RunMapScreen, StationScreen, NodeChip (HUD), NodeCard, DeployMapPreview;  apps/client/src/ui/DeployMap.tsx: deploy terminal panel + resume card + codex
scripts/e2e-runmap.cjs     RUN MAP browser suite (A deploy, B completion + map, C travel + carry, D five hub kinds, F resume after reload, E extraction + records + HQ preview, G null field, V screenshots); `?test&map`
scripts/e2e-coop-map.mjs   RUN MAP co-op protocol suite (own server, RIFT_MAP=1): map runStart, vote, home voter extracts alone, travel + carry, PostgreSQL records
packages/rules/src/world/arenaGen.ts      M9: generateArena(seed) -> ArenaLayout (memoised): perimeter, lane benders, platforms+ramps, blocks, pillars, wall machines, lanes traced on the nav grid, forward rifts, vents, reserved zones; sectorName, arenaStats [pure]
packages/rules/src/world/biomes.ts        M10: BIOMES (outpost / cryo / foundry: fog, horizon, sun, palette tints, air particles, lane colour, hazard, faction, name words), biomeForSeed, biomeOf, factionMix [pure]
packages/game/src/arena/Hazards.ts       M10: frost fields / slag pools (static from the layout, transient slag trails): drone slow + burn, enemy chill/burn; split decay / affectPlayer / affectEnemyList for co-op
packages/game/src/enemies/mutations.ts   M10: runtime of the six mutations (regenerating, splitting, shielded, blinking, frostbound, molten); state in Enemy.mut
packages/game/src/enemies/factionBehaviors.ts M10: Sapper, Skimmer, Marksman, Burrower behaviours (shared walker/drone/crawler rigs + extra kit parts)
packages/game/src/visuals/biomeLook.ts   M10: tintPalette (biome albedo multipliers on the outdoor palette)
scripts/e2e-m10.cjs        M10 browser suite (A biomes, B hazards, C archetypes, D mutations, E planner factions, V screenshots)
packages/rules/src/world/districts.ts     M9: district kits in a local frame + orient (quarter turns): maze (backtracker + loops), serpentine, containerYard (staggered), overpass (platforms + bridge + underpass baffles), redoubt, skyway, withWings, barrierX/Z [pure]
packages/rules/src/world/navgrid.ts       M9: NavGrid: 1 m flow field (Dijkstra from the reactor ring), towers = high cost (not blocked), pathFrom + string pulling   [pure]
packages/rules/src/enemies/navigation.ts  M9: EnemyNavigator (EnemyManager.nav): ground/air fields, spawn at gate or forward rift, re-plan on field change, breaching  [no Babylon values]
packages/rules/src/towers/durability.ts   M9: tower max HP / repair cost / wreck refund rules                                  [pure]
packages/game/src/arena/TowerWear.ts     M9: breach hits, wrecks, repairs (F), wave-clear mending (narrow host, no Game import)
packages/game/src/visuals/riftAnchors.ts M9: forward rift anchors (scorch pad, ring, additive tear; flare on spawn)
apps/client/src/ui/LoadingScreen.tsx   M9: scene-swap loading screen (sector briefing + SVG map, stages, tips; HQ recovery art); apps/client/src/ui/loadingTips.ts [pure]
scripts/e2e-arenas.cjs     M9: browser suite (A loading screen, B generated arena, C rifts + re-planning, D breach/wreck/repair, E HQ screen + determinism, V screenshots)
packages/rules/src/waves/pace.ts          Run tempo: prep / clear timings, spawn schedule compression, early-call core bonus      [pure]
packages/rules/src/combat/elements.ts     ELEMENTS (kinetic/thermal/electric/cryo/corrosive/void): info + colours, FACTION_AFFINITY / BOSS_AFFINITY + overrides (affinity, sectorAffinity), rollElement, procWeight, elementPayload, elementEnergy [pure]
packages/rules/src/loot/sets.ts           M11: SETS (bastion / deadeye / conflux / architect, 2 + 4 piece bonuses), setFor (seed-decided, rare+ gear, 20%), setCounts, activeSetBonuses, setBonusModifiers (in equipmentModifiers) [pure]
packages/rules/src/combat/conditions.ts   M11: conditional affixes: CONDITIONS (airborne / dash 2 s / swap 3 s / lowhull < 40% / kill 3 s, uptimes), ConditionTracker (per drone, change detection), expectedModifiers (scoring), hasConditional [pure]
packages/rules/src/loot/uniques.ts        M11: UNIQUES (15 hand-made items: base, fixed affixes, extra stats, flavour, weapon signature or gear effect, drop sources/faction/chance), uniqueForDrop (seed-decided), generateUnique, gearUniques [pure]
packages/rules/src/loot/ascend.ts         M11: Ascended tier: ASCEND tuning, ascendDrop (seed-based promotion of exotic drops), ascendItem / ascendBlock / perfectAffix [pure]
packages/game/src/weapons/swarmModel.ts  M11: Drone Swarm hive chassis (hive / brood / wasp) + launch pods (hex pod, twin racks, hive cluster, long uplink); tubes are the muzzles
packages/game/src/weapons/heavyModels.ts M11: Launcher (receiver + launch tube + venturi; tube / twin / guided / thermobaric barrels with warheads) and Flamer (pump body + fuel tanks + feed line; nozzle / fan / lance / twin barrels with pilot lights) chassis
packages/game/src/weapons/shapes.ts      vertex-data helpers shared by the weapon model builders (alongZ/X, lathe, cylZ, tubeZ, cylX)
apps/client/src/ui/ElementTag.tsx      element chip (item readout, weapon card, holster row, briefing AffinityRow)
packages/rules/src/combat/heat.ts         Global heat tempo applied at fire time (and in weaponSummary) on top of stored item heat   [pure]
packages/game/src/core/frameClock.ts     Frame pacing filter (jitter -> steady dt, time debt repaid, hitches clamped)              [pure]
scripts/playtest.cjs       Bot playtest: plays N waves (aims, fires, strafes, dashes, builds towers, picks upgrades), prints pacing metrics + screenshots
scripts/feel-shots.cjs     Close-up captures: walker gait at speed, kill pop / knock-back / merged numbers
packages/rules/src/progression/level.ts   M8: Warden XP formula (xpFor from run statistics), level curve, points/rings per level     [pure]
packages/rules/src/progression/skilltree.ts M8: procedural radial skill tree (seeded per profile, ring per 5 levels), allocation rules, soft-capped modifiers, keystone rules [pure]
packages/rules/src/progression/treeOps.ts M8: treeAllocate / treeRespec profile operations                                       [pure]
packages/rules/src/economy/currencies.ts  M8: one table for every currency (name, icon, earned/spent/banking) for tooltips and cost text [pure]
packages/rules/src/home/stationInfo.ts    M8: purpose + currencies per HQ station (terminal headers, HQ prompt, Command Console directory) [pure]
packages/game/src/home/stationScreens.ts M8: live station screen drawing (moved out of HomeBase)
packages/rules/src/loot/loadoutScore.ts   loadout headline scores (firepower/survivability/mobility/towers), swapImpact + verdict, statSources  [pure]
apps/client/src/ui/compare.tsx         ImpactBanner / ImpactChips / VerdictTag / ScoreCards / statTooltip (shared comparison widgets)
apps/client/src/ui/statHelp.ts         one-line help text per stat key (tooltips)                                         [pure]
apps/client/src/ui/DroneStats.tsx      drone configuration stat panel (score cards, per-stat source tooltips)
packages/game/src/visuals/hqTextures.ts  HQ-only surface sets with emissive maps: deck plates (LED seam, grates), wall panels (lit recess band, hatch, stencils), ceiling tiles (light slots)
packages/game/src/home/roomStyle.ts      accent colour + light tint per HQ room (room identity)                             [pure]
packages/rules/src/world/propCatalog.ts   scanned CC0 prop species: footprint, roles (floor/deck/roof/wall/hq), orientation [pure]
packages/rules/src/world/propPlan.ts      where arena props go per biome (wall-foot clusters, wall lamps, deck clusters, rooftop plant), own seed stream [pure]
packages/rules/src/world/rubblePlan.ts    where arena rubble/wreckage goes (piles at wall bases + block corners, wall wrecks, deck scatter), kept off lanes/reactor/spawn/reserved/vents/ramps [pure]
packages/game/src/visuals/arenaFloor.ts  arena floor zoning: reactor steel plaza + hazard border, wall gutters with grates, gate-mouth chevrons (8 mm inlays under decals 16 mm / lane lights 28 mm, not pickable)
packages/game/src/visuals/riftMist.ts    RiftMist: additive noise vapour rolling out of each gate (floor + waist layers, orange open / grey sealed; Game.openGate lights it)
packages/game/src/home/hqAtmosphere.ts   HQ window light shafts (slanted additive sheets along the moonlight) + dust motes (density follows the particle setting)
packages/game/src/combat/weaponFeel.ts   shotFeel(family, mechanism, power): lens punch, sideways kick share, shake, flash/light, recoil recovery rates; yawPattern(n) [pure]
packages/game/src/visuals/rubble.ts      RubbleBuilder: blocky concrete chunks (corner-jittered boxes, flat shaded, per-chunk vertex tint), rusty plates, rebar, fallen I-beams, drums, cracked slabs; HQ scrap heaps
apps/client/src/ui/SkillTree.tsx       M8: Neural Lattice terminal (SVG radial tree, pan/zoom, allocate, respec);  apps/client/src/ui/Directory.tsx: level/XP widgets + station directory
packages/rules/src/net/teamLedger.ts      TeamLedger (shared co-op ledger mirrored into each player's ledger)
packages/protocol/src/protocol.ts        M7: message types, PROTOCOL_VERSION, structural validation, RateLimiter         [pure]
packages/game/src/net/ServerGame.ts      M7: authoritative Game subclass: Avatars per player, shot validation, acts, TeamLedger, votes
packages/game/src/net/recorder.ts        M7: Recorder + capturePresentation (fx/sfx/ui/telegraph/ordnance -> event tuples), withRecorder scoping
packages/game/src/net/replicated.ts      M7: the replicated presentation call names (FX_CALLS, ...) shared by server capture and client replay
packages/game/src/net/ClientGame.ts      M7: replica Game subclass: puppet enemies (interpolated 100 ms), shot claims, actions with replies, remote wardens
packages/game/src/net/NetClient.ts       M7: browser WebSocket session: identity, reconnect/backoff, act() with timeout, RTT
packages/rules/src/progression/ops.ts     M7: named profile operations shared by client (Profile.op) and server (ProfileStore.op) [pure]
packages/rules/src/progression/tutorial.ts M7: onboarding steps + ops                                                      [pure]
packages/game/src/core/TutorialDirector.ts M7: shows one tutorial card at a time (F10 skips)
{packages/game,packages/rules}/src/home/build/            M7: catalog.ts (pieces, limits), model.ts (grid, validation, reachability) [pure], ops.ts (BUILD_OPS) [pure],
                           ExpansionLayer.ts (incremental meshes/colliders/lights), BuildMode.ts (construction camera + tools)
packages/game/src/enemies/jammerCrawlerBehaviors.ts M7: Jammer Drone, Siege Crawler behaviours
packages/game/src/enemies/coreBehaviors.ts Walker / Bulwark / Rush Drone as Behavior plug-ins (CORE_BEHAVIORS); EnemyManager has one dispatch path
packages/game/src/visuals/anim.ts        Spring, damp, smoothstep, impulse (shared by weapons, enemies, HQ)                                             [pure]
packages/game/src/visuals/hitFlashPlugin.ts per-instance additive hit flash: PBR material plugin + `instanceFlash` instanced buffer (Kit flash mode)
packages/game/src/visuals/mood.ts        moodFor(): fog/exposure/sun tint/tension from tier, boss, event, reactor (blendMood smoothing)                  [pure]
packages/game/src/visuals/moodDirector.ts applies the mood to scene fog, sun colour and PostFx offsets
packages/game/src/enemies/deathAnims.ts  DEATH_TIME per kind + deathPose(): collapse animation of destroyed regular enemies                              [pure]
packages/game/src/home/ambientNav.ts     waypoint graph (rooms, doorways, stations) + Dijkstra for ambient drones                                       [pure]
packages/game/src/home/AmbientDrones.ts  3 cosmetic service drones patrolling between stations (hum emitters follow them)
packages/game/src/home/hqVista.ts        3D middle ground outside the observation window (landing deck, dropship, lit towers, blinking beacons), merged, unlit glows only
packages/game/src/home/StationFocus.ts   HQ station floor ring under the targeted station + camera push-in while a terminal is open
packages/game/src/arena/PlayerCombat.ts  player weapon combat: shoot (hit resolution + damage), legacy damage entry (crit, situational upgrades, signatures, Arc Conductor), kill feel (hitstop/chain/dash refund), per-family shot fx (CombatHost)
packages/game/src/arena/shotTrace.ts     traceShot(): hitscan geometry (pierce, weakpoint overlap, beam aim assist) shared by Game and ClientGame (claims); shotOutcome in PlayerCombat
packages/game/src/arena/WeaponSlots.ts   primary + secondary weapon: active slot, swap (Z / 1), holstered heat (coolHolstered in combat/heat.ts), stat exclusion of the holstered weapon (WeaponSlotsHost)
packages/rules/src/abilities/defs.ts      ABILITIES (frag, cryo, emp, blink, aegis; ultimates orbital, overdrive): power from item level x rarity x abilityPowerMult, cooldown/radius/ult charge rules, blink clamp, throw physics, AbilityHudRow [pure]
packages/game/src/arena/Abilities.ts     ability runtime (AbilityHost): RMB ability I, F ability II, T ultimate (combat); thrown charges, pulse, blink, aegis/overdrive buffs, orbital mark + strike, ult charge from Director.deal
packages/game/src/arena/LootPickups.ts   loot landing point (Havok), landing/pickup/refused presentation, pickup targeting (LootHost)
packages/game/src/arena/TowerControl.ts  tower inspection (crosshair pick), hold-X recycle, F repair, refit hotkeys, build template, refit/place local rules (TowerHost; ClientGame overrides recycleTower/repairTower/modifyTower/tryPlace)
packages/game/src/arena/DevTools.ts      dev lab actions behind `game.dev` (narrow DevHost interface, no Game dependency)
packages/game/src/arena/shadows.ts       createSunShadows(): cascaded / single sun shadow generator
packages/rules/src/loot/roll.ts           rollLoot(): one pure roll+generate for run, team and per-player streams (Game.rollFrom, ServerGame.rollFor)   [pure]
packages/rules/src/towers/refit.ts        planRefit / planBuildConfig: tower refit + build-template rules; Game applies the plan (spend, model, fx)      [pure]
packages/rules/src/combat/blast.ts        planBlast(): hostile area-blast rules (falloff, cover via injected clearShot, tower suppression)              [pure]
packages/game/src/ui/hudModel.ts         hintFor / lootTargetInfo / runHud: HUD view-model pieces from plain data                                       [pure]
apps/client/src/ui/hud/                Hud.tsx parts: widgets (SegBar, Key, Num, fmtClock), Radar, Feedback (crosshair, hitmarker, numbers, bars), Panels
packages/protocol/src/events.ts          ReplicatedEvent union + parseEvent (structural validation); ClientGame.applyEvent switches on it exhaustively (moved to packages/protocol in v2)
packages/rules/src/loot/signatures.ts     M7: legendary/exotic signature effects                                          [pure]
packages/game/src/visuals/droneModel.ts  M7: warden drone rig for teammates (slot colours)
apps/client/src/ui/Coop.tsx, TeamHud.tsx, Construction.tsx, SettingsPanel.tsx, TutorialCard.tsx   M7 UI
scripts/e2e-coop-protocol.mjs M7: protocol suite with bot clients (scripts/bot.mjs) against a spawned server
scripts/e2e-construction-coop.cjs M7: browser suite: G construction, H decorations, I station relocation, J blueprint progression, X real browser co-op
apps/client/src/core/Flow.ts           session controller: Input, Profile, HQ <-> arena scene swaps, run lifecycle, debug API
packages/game/src/core/Game.ts           ONE survival run (arena world): scene/lights/pipeline, damage pipeline, checkpoints, HUD
packages/game/src/home/HomeBase.ts       HQ world: scene, lights, Player reuse, station interaction, live station screens
packages/game/src/home/HqBuilder.ts      HQ static shell from modular components (wall run, floor, ceiling, door frame, window...)
packages/game/src/home/props.ts          station rigs (launch ring, holo-table, drone cradle, racks, workshop) + placeable builders
packages/rules/src/home/layout.ts         HQ rooms/portals/stations data + wallSegments()            [pure]
packages/game/src/home/interaction.ts    pickInteractable: view cone + range + occlusion callback   [pure]
packages/rules/src/home/placeables.ts     persistent customisable HQ objects + defaults               [pure]
packages/rules/src/progression/save/      versioned/checksummed SaveData [pure]: types, defaults, coerce, sanitize, migrations, codec, ownership (leaf lookups),
                           rules (game-rule mutations), engineering (M3 modules); index.ts re-exports (import from '.../progression/save')
packages/rules/src/progression/run.ts     RunLedger: unsecured/secured/lost rewards, idempotent finalize [pure]
packages/rules/src/progression/items.ts   equipment slots (7, structured) + slot/category compatibility [pure]
packages/rules/src/loot/types.ts          Category, ItemInstance (persisted, fully rolled), RolledStat/Affix [pure]
packages/rules/src/loot/rarity.ts         6 rarities: weights, affix counts, quality floor, tier bias, sockets, colours; rollRarity [pure]
packages/rules/src/loot/affixes.ts        affix pool: one real stat each, per-category weights, groups, tier multipliers [pure]
packages/rules/src/loot/bases.ts          base item definitions (weapon family variants, armor, shields, reactors...) [pure]
packages/rules/src/loot/generate.ts       seeded generator, level scaling, naming, validation, starter weapon [pure]
packages/rules/src/loot/drops.ts          drop sources (walker/rusher/bulwark/wave/checkpoint/boss), item level, luck [pure]
packages/rules/src/loot/equipment.ts      items -> StatModifiers / WeaponDef, item comparison, stat preview [pure]
packages/rules/src/loot/runInventory.ts   run loadout + cargo + carried/secured/unsecured status, prep-only changes [pure]
packages/rules/src/loot/economy.ts        scrap value (= dismantle salvage), storage expansion cost [pure]
packages/rules/src/economy/config.ts      M4: ALL economy formulas: prices, dismantle yields, enhancement, reroll/swap costs, run income, market config [pure]
packages/rules/src/economy/engineering.ts affix rerolls (single stat/value, full w/ locks), component swaps (roll rescaled by effect ratios) [pure]
packages/rules/src/economy/market.ts      merchant stock generation (seeded by profile+rotation), progressLevel [pure]
packages/rules/src/economy/recipes.ts     fabrication recipes + quality grades, craft costs, odds, fabricate() [pure]
packages/rules/src/economy/transactions.ts every economy transaction: validate-all-then-apply, tx-id guard, ownership/protection [pure]
packages/game/src/home/economyProps.ts   exchange wall, module vault/broker, reclamation press, fabricator, calibration ring (live displays)
packages/rules/src/combat/events.ts       M5: EffectBus (typed events, chain id/depth, per-effect cooldown/chance/chainLimit, budgeted queue)  [pure]
packages/rules/src/combat/status.ts       M5: burn/shock/chill statuses + 3 reactions (thermal shock, overload, superconduct)         [pure]
packages/game/src/combat/gameEvents.ts   M5: HitEv/StatusEv/ReactionEv/TowerAttackEv payload types
packages/game/src/combat/Director.ts     M5: per-run director: shared damage pipeline deal(), inflict(), blast(), chainLightning(), towerFire(), buffs, upgrade effects (effectsFor)
packages/rules/src/roguelite/upgrades.ts  M5: 36 run upgrades (UP numbers shared by text + effects), seeded 3-choice offers, RunBuild  [pure]
packages/rules/src/towers/components.ts   M5: tower bases/weapons/cores/modifiers, compatibility, composeTower, costs, tech list      [pure]
packages/game/src/visuals/towers.ts      M5: procedural modular tower models (one builder, instanced kit)
apps/client/src/ui/Roguelite.tsx       M5: UpgradePanel, BuildOverview (U), TowerPanel (T), RunBadges;  apps/client/src/ui/TowerTech.tsx: HQ research tab
packages/rules/src/survival/plan.ts       M6: SurvivalPlanner (seeded per run+tier): encounter budgets, themes, events, boss + evolution scheduling, composeSpawns [pure]
packages/rules/src/survival/elites.ts     M6: elite modifier defs (overcharged/armored/accelerated/volatile), compatibility, rolls  [pure]
packages/rules/src/survival/events.ts     M6: dynamic event defs (swarm, eliteAssault, instability, hvt) + tuning                  [pure]
packages/rules/src/survival/bosses.ts     M6: boss defs, phase thresholds, repeat-encounter scaling                              [pure]
packages/rules/src/survival/records.ts    M6: survival milestones                                                                [pure]
packages/game/src/survival/SurvivalRuntime.ts M6: per-run arena side: announcements, evolution, event mechanics/rewards/cleanup, HVT, milestones, tower boosts, HUD
packages/game/src/enemies/behaviors.ts   M6: Behavior plug-ins: Shielded Enforcer, Artillery Drone, Support Engineer, Vault Courier
packages/game/src/enemies/bosses/        M6: colossus.ts (Siege Colossus), overseer.ts (Overseer Core + shield emitters), index.ts
packages/game/src/fx/Hostile.ts          M6: Telegraphs (ground markers fill-to-ring, laser lines) + Ordnance (lobbed shells/bombs, orbs, homing missiles)
packages/game/src/world/ArenaDynamics.ts M6: evolving arena: south blast door, containment bulkheads (player-safe), plasma vents
packages/game/src/visuals/enemyModels.ts M6: enforcer/artillery/engineer/courier rigs + shared enemy/boss materials (enemyMats)
packages/game/src/visuals/bossModels.ts  M6: Siege Colossus, Overseer Core, shield emitter rigs
packages/game/src/visuals/eliteParts.ts  M6: elite modifier hardware + threat marks
apps/client/src/ui/SurvivalHud.tsx     M6: boss bar, event/HVT chips, alert feed;  apps/client/src/ui/DevPanel.tsx: F4 survival lab (?dev/?test only)
packages/game/src/loot/LootField.ts      physical pickups (real 3D item models, rarity rim + beam + rings, epic+ motes), lifetime + saturation rules
packages/game/src/loot/itemModels.ts     ITEMS: buildItemModel / buildCurrencyModel (merged per material, centred, sized), lookKey, rimHull (inverted-hull rarity outline), weldNormals
packages/game/src/loot/itemShapes.ts     ITEMS: hand-made sculpts per non-weapon base + currency props (weapon kit primitives + materials), ACCENT colours
apps/client/src/home/ItemThumbs.ts     ITEMS: thumbnail renderer (detached engine, queued renders -> cached PNG object URLs, idle release); home/studio.ts shared studio lights/env
apps/client/src/ui/inventory/thumbs.tsx, ui/ItemStage.tsx   ITEMS: useItemThumb / CurrencyIcon; live spinning model in the item detail panel
scripts/loot-shots.cjs, scripts/item-sheet.cjs   ITEMS: arena drop + terminal captures; contact sheet of every base/currency thumbnail
packages/rules/src/progression/tiers.ts   threat tiers + checkpoint interval                          [pure]
packages/game/src/progression/Profile.ts owns the SaveData; mutate() persists + publishes a snapshot store
packages/game/src/visuals/envCapture.ts  one-shot reflection-probe IBL capture (shared by arena and HQ)
packages/game/src/core/Input.ts          keyboard/mouse edges, pointer lock, simulateKey/simulateMouse for automation
packages/rules/src/core/tactical.ts       TacticalEnergy (time dilation rules) + Wallet  [pure]
packages/game/src/core/settings.ts       versioned/validated localStorage settings     [pure]
packages/rules/src/world/layout.ts        ARENA data: boxes, ramps, lane routes, reactor, spawn [pure, single source of truth]
packages/rules/src/world/geometry.ts      distance helpers                              [pure]
packages/game/src/world/physicsGroups.ts Havok filter masks (ENV vs PLAYER)
packages/game/src/visuals/propLibrary.ts  loads/instances scanned CC0 props (lazy glTF + WebP), pivot normalisation, shadow hook, footprint ray test
packages/game/src/visuals/biomeSurfaces.ts scanned PBR surface sets per biome for ground / masonry / cladding / rust (+ parallax occlusion on high)
packages/game/src/visuals/containerModel.ts real ISO container geometry (corrugation, doors, locking bars, castings) + stacked builder with scanned liveries
packages/game/src/visuals/biomeLight.ts   per-biome exposure / fill / bounce / IBL / sun for the arena
packages/game/src/visuals/contactGrime.ts contact shadow + grime / snow / soot strips along floor-wall seams (arena and HQ)
packages/game/src/visuals/fixtureGlow.ts  fake light splashes, lenses and pools for wall-mounted prop fixtures
packages/game/src/visuals/scanDetail.ts   scanned micro detail maps (Babylon detail map layout) for procedural sets
packages/game/src/home/hqClutter.ts       HQ clutter candidates per room + picker (occupancy test injected) [pure]
packages/game/src/visuals/arenaDressing.ts arena set dressing (wall services, partition detail, tunnel ribs, drains, industrial skyline): visual only, no collision, merged per material
packages/game/src/visuals/arena.ts       builds arena meshes (merged per material, box-projected world UVs) + one static compound Havok body
packages/game/src/visuals/kit.ts         unit-primitive model kit; one hidden source mesh per (shape, material), GPU instances everywhere
packages/game/src/visuals/models.ts      walker/bulwark, rush drone, Sentinel turret, reactor rigs (animated plasma core, glass shell, beam)
packages/game/src/visuals/materials.ts   PBR palette (metal/roughness + textures) and `unlit()` HDR emissives (> 1 feeds bloom)
packages/game/src/visuals/textures.ts    procedural textures: tileable fbm, height->normal, floor/wall/wear PBR sets, particle sprites
packages/game/src/visuals/uv.ts          box-projected UVs for merged static meshes
packages/game/src/visuals/atmosphere.ts  storm sky shader + rift tear + lightning, rift portal shader, lamp light shafts, wall sconces,
                           distant skyline, dust/ash/gate embers, one-shot reflection-probe environment capture
packages/game/src/visuals/postfx.ts      SSAO2 + SSR (high), HDR bloom, ACES, colour grade, grain, chromatic aberration kicks
packages/game/src/player/Player.ts       hover drone movement on PhysicsCharacterController, camera, health/respawn
packages/rules/src/player/movement.ts     KIT: slide / wall-run / grapple / ground pound rules (entry, friction, slope pull, wall tests, rope pull, pound blast) [pure]
packages/game/src/player/MoveKit.ts      movement-kit state machine on a KitBody (Player implements it; collision probes injected), owns velocity while active
packages/game/src/arena/Deployables.ts   Shield Wall (temporary ENV collider), Holo Decoy (stand-in Player body enemies focus), Mini-Sentry (temporary tower); co-op hooks onPlaced/onSentry
packages/game/src/fx/Thrown.ts           visual of thrown ability charges (replicated fx call `thrown` / `thrownEnd`)
packages/game/src/arena/Movement.ts      arena side of the kit (MovementHost): grapple input (R / MMB), pound blast via director, grapple line, MoveHud
packages/game/src/combat/Weapon.ts       equipped weapon: mechanisms (auto/burst/charge/cycle/beam), heat, spread, viewmodel (group 1)
packages/rules/src/weapons/components.ts  weapon components (barrels/emitters, cores, cooling, mechanisms, attachments) + effects [pure]
packages/rules/src/weapons/build.ts       WeaponBuild (persisted config), FAMILIES, rollBuild, socket kinds, buildEffects     [pure]
packages/rules/src/weapons/modules.ts     module types (socket kind, families, visual), canInstall, removalCost              [pure]
packages/game/src/weapons/geometry.ts    chamfered lathe / profile-prism / box vertex generators (ear clipping)            [pure]
packages/game/src/weapons/materials.ts   weapon material library per scene (graphite, satin, dark, polymer, glass, finishes)
packages/game/src/weapons/model.ts       buildWeaponModel(build, installed): chassis per family + mounts, merged meshes, anim hooks
packages/game/src/weapons/animator.ts    WeaponAnimator: springs for recoil/sway/sprint/dash/jump/land, heat/charge visuals
packages/game/src/fx/WeaponFx.ts         plasma bolts, rail trails, continuous beam, arc lightning (camera-facing ribbons)
apps/client/src/home/WeaponPreview.ts  HQ 3D inspection: small dedicated engine on its own canvas (studio env, ArcRotate)
apps/client/src/ui/WeaponViewer.tsx    React wrapper for WeaponPreview (created/disposed with the terminal)
packages/rules/src/combat/damage.ts       rollDamage / applyDamage / mulberry32     [pure]
packages/rules/src/combat/stats.ts        CombatStats + StatModifier stacking         [pure]
packages/game/src/enemies/EnemyManager.ts pooled enemies, route following, attacks, separation, stuck watchdog
packages/rules/src/defense/placement.ts   placement rules                            [pure]
packages/game/src/defense/Construction.ts build mode: engine picks + footprint samples -> validatePlacement
packages/game/src/defense/Turrets.ts     Sentinel targeting/aiming/firing
packages/rules/src/waves/waves.ts         wave definitions + endless generator       [pure]
packages/game/src/waves/WaveManager.ts   prep/combat/cleared lifecycle, spawn cap   [pure, hooks-based]
packages/game/src/fx/Effects.ts          pooled tracers, debris, enemy projectiles, particle bursts, flash light, styled explosions (+ Fragments, Smolder)
packages/game/src/audio/Sfx.ts           procedural WebAudio bank (+ music bus)
packages/game/src/audio/musicPlan.ts     adaptive score decisions: track weights, layer levels, intensity, step patterns [pure]
packages/game/src/audio/Music.ts         adaptive score runtime: CC0 loop crossfades, procedural pulse/drums/riser, stingers
scripts/fetch-cc0.mjs                    CC0 asset fetch + licence check + conversion (manifest, docs/assets/credits.md)
apps/client/src/ui/Market.tsx          M4 terminals: equipment exchange / module broker (buy, sell, exchange), reclamation, fabricator
apps/client/src/ui/Engineering.tsx     M4 engineering workshop: MODULES (M3 ModuleBench) / AFFIXES / ENHANCE / COMPONENTS tabs
apps/client/src/ui/economy.tsx         ResourceBar, CostLine, ConfirmButton, useTx (one tx at a time, fresh tx id, econ feedback event)
{apps/client,packages/game}/src/ui/                    React App (menus, pause, checkpoint, defeat, summary, transit), Hud (arena), HomeHud,
                           Terminals (deploy/loadout/storage/workshop/command), items.tsx (shared inventory view,
                           item detail, comparison), LootHud (prompt, feed, world labels, arena cargo), store + uiEvents
tests/                     Vitest suites for the [pure] modules
packages/game/src/world/triangleBvh.ts, world/fastPick.ts   PERF: static triangle BVH for ray picks on merged level shells (Babylon-identical results) [BVH pure]
packages/game/src/world/pickCandidates.ts   PERF: metadataPicker (Babylon picking over metadata-tagged meshes only), skipPointerPicking
packages/game/src/visuals/freshMaterial.ts, visuals/warmPools.ts   PERF: material creation without scene-wide dirty scans; shader warm-up of pooled meshes
packages/game/src/enemies/separation.ts   PERF: crowd separation (grid pass identical to the pairwise loop) [pure]
packages/game/src/core/adaptiveQuality.ts, core/frameStats.ts   PERF: adaptive quality controller, F3 1% / 0.1% lows [pure]
scripts/bench-perf.cjs, scripts/bench-coop.mjs   PERF: browser benchmark scenarios (+ CPU profile, shader variants), headless co-op server benchmark
scripts/lib/harness.cjs    shared e2e helpers: launch/boot/check/stats/waitFor/shot/collectErrors (all browser suites import it)
scripts/e2e-m1.cjs         M1 browser acceptance suite (70 checks: scenarios A-G, tiers, leaks, persistence)
scripts/e2e-m2.cjs         M2 browser acceptance suite (loot scenarios A-I, migration, leaks)
scripts/e2e-m4.cjs         M4 browser acceptance suite (A-K through the terminal UIs, reloads, exploits, rollback, leaks)
scripts/e2e-m3.cjs         M3 browser acceptance suite (families, generation, engineering UI, variation, loot, v2 migration, leaks)
scripts/e2e-m5.cjs         M5 browser acceptance suite
scripts/e2e-polish.cjs     Polish suite: A hit flash, B wreck deaths, C mood, D terminal push-in, E ambient drones, V screenshots
scripts/e2e-m6.cjs         M6 browser acceptance suite (A-L: plans, enemies, elites, evolution, events, bosses, tiers, high waves, banking/records, perf, dev isolation)
```
