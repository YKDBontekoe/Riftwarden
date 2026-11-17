# Riftwarden: project notes for future sessions

Browser FPS + tower-defense roguelite. Current milestone: **M5 complete** (see "Milestones"). Read this before changing code.

## Stack

- **Babylon.js 8** (`@babylonjs/core`) for rendering, picking, particles, post-processing.
- **Havok** (`@babylonjs/havok`, Babylon Physics v2) for the static level collider, the player's `PhysicsCharacterController`, and line-of-sight raycasts.
- **React 18** for HUD and menus (`src/ui`), fed by a tiny external store.
- **Vite 7 + TypeScript (strict)**, **Vitest** for unit tests. No backend.

Use engine features before writing custom systems (user direction): collision, picking, raycasts and particles come from Babylon/Havok.

## Layout

```
src/main.tsx               boot: Havok WASM, Engine, Flow, React root, ?test hook; the ONLY render loop
src/core/Flow.ts           session controller: Input, Profile, HQ <-> arena scene swaps, run lifecycle, debug API
src/core/Game.ts           ONE survival run (arena world): scene/lights/pipeline, damage pipeline, checkpoints, HUD
src/home/HomeBase.ts       HQ world: scene, lights, Player reuse, station interaction, live station screens
src/home/HqBuilder.ts      HQ static shell from modular components (wall run, floor, ceiling, door frame, window...)
src/home/props.ts          station rigs (launch ring, holo-table, drone cradle, racks, workshop) + placeable builders
src/home/layout.ts         HQ rooms/portals/stations data + wallSegments()            [pure]
src/home/interaction.ts    pickInteractable: view cone + range + occlusion callback   [pure]
src/home/placeables.ts     persistent customisable HQ objects + defaults               [pure]
src/progression/save.ts    versioned/checksummed SaveData, sanitize, migrations, game-rule mutations [pure]
src/progression/run.ts     RunLedger: unsecured/secured/lost rewards, idempotent finalize [pure]
src/progression/items.ts   equipment slots (7, structured) + slot/category compatibility [pure]
src/loot/types.ts          Category, ItemInstance (persisted, fully rolled), RolledStat/Affix [pure]
src/loot/rarity.ts         6 rarities: weights, affix counts, quality floor, tier bias, sockets, colours; rollRarity [pure]
src/loot/affixes.ts        affix pool: one real stat each, per-category weights, groups, tier multipliers [pure]
src/loot/bases.ts          base item definitions (weapon family variants, armor, shields, reactors...) [pure]
src/loot/generate.ts       seeded generator, level scaling, naming, validation, starter weapon [pure]
src/loot/drops.ts          drop sources (walker/rusher/bulwark/wave/checkpoint/boss), item level, luck [pure]
src/loot/equipment.ts      items -> StatModifiers / WeaponDef, item comparison, stat preview [pure]
src/loot/runInventory.ts   run loadout + cargo + carried/secured/unsecured status, prep-only changes [pure]
src/loot/economy.ts        scrap value (= dismantle salvage), storage expansion cost [pure]
src/economy/config.ts      M4: ALL economy formulas: prices, dismantle yields, enhancement, reroll/swap costs, run income, market config [pure]
src/economy/engineering.ts affix rerolls (single stat/value, full w/ locks), component swaps (roll rescaled by effect ratios) [pure]
src/economy/market.ts      merchant stock generation (seeded by profile+rotation), progressLevel [pure]
src/economy/recipes.ts     fabrication recipes + quality grades, craft costs, odds, fabricate() [pure]
src/economy/transactions.ts every economy transaction: validate-all-then-apply, tx-id guard, ownership/protection [pure]
src/home/economyProps.ts   exchange wall, module vault/broker, reclamation press, fabricator, calibration ring (live displays)
src/combat/events.ts       M5: EffectBus (typed events, chain id/depth, per-effect cooldown/chance/chainLimit, budgeted queue)  [pure]
src/combat/status.ts       M5: burn/shock/chill statuses + 3 reactions (thermal shock, overload, superconduct)         [pure]
src/combat/gameEvents.ts   M5: HitEv/StatusEv/ReactionEv/TowerAttackEv payload types
src/combat/Director.ts     M5: per-run director: shared damage pipeline deal(), inflict(), blast(), chainLightning(), towerFire(), buffs, upgrade effects (effectsFor)
src/roguelite/upgrades.ts  M5: 36 run upgrades (UP numbers shared by text + effects), seeded 3-choice offers, RunBuild  [pure]
src/towers/components.ts   M5: tower bases/weapons/cores/modifiers, compatibility, composeTower, costs, tech list      [pure]
src/visuals/towers.ts      M5: procedural modular tower models (one builder, instanced kit)
src/ui/Roguelite.tsx       M5: UpgradePanel, BuildOverview (U), TowerPanel (T), RunBadges;  src/ui/TowerTech.tsx: HQ research tab
src/loot/LootField.ts      physical pickups (instanced holograms, beams, rings), lifetime + saturation rules
src/progression/tiers.ts   threat tiers + checkpoint interval                          [pure]
src/progression/Profile.ts owns the SaveData; mutate() persists + publishes a snapshot store
src/visuals/envCapture.ts  one-shot reflection-probe IBL capture (shared by arena and HQ)
src/core/Input.ts          keyboard/mouse edges, pointer lock, simulateKey/simulateMouse for automation
src/core/tactical.ts       TacticalEnergy (time dilation rules) + Wallet  [pure]
src/core/settings.ts       versioned/validated localStorage settings     [pure]
src/world/layout.ts        ARENA data: boxes, ramps, lane routes, reactor, spawn [pure, single source of truth]
src/world/geometry.ts      distance helpers                              [pure]
src/world/physicsGroups.ts Havok filter masks (ENV vs PLAYER)
src/visuals/arena.ts       builds arena meshes (merged per material, box-projected world UVs) + one static compound Havok body
src/visuals/kit.ts         unit-primitive model kit; one hidden source mesh per (shape, material), GPU instances everywhere
src/visuals/models.ts      walker/bulwark, rush drone, Sentinel turret, reactor rigs (animated plasma core, glass shell, beam)
src/visuals/materials.ts   PBR palette (metal/roughness + textures) and `unlit()` HDR emissives (> 1 feeds bloom)
src/visuals/textures.ts    procedural textures: tileable fbm, height->normal, floor/wall/wear PBR sets, particle sprites
src/visuals/uv.ts          box-projected UVs for merged static meshes
src/visuals/atmosphere.ts  storm sky shader + rift tear + lightning, rift portal shader, lamp light shafts, wall sconces,
                           distant skyline, dust/ash/gate embers, one-shot reflection-probe environment capture
src/visuals/postfx.ts      SSAO2 + SSR (high), HDR bloom, ACES, colour grade, grain, chromatic aberration kicks
src/player/Player.ts       hover drone movement on PhysicsCharacterController, camera, health/respawn
src/combat/Weapon.ts       equipped weapon: mechanisms (auto/burst/charge/cycle/beam), heat, spread, viewmodel (group 1)
src/weapons/components.ts  weapon components (barrels/emitters, cores, cooling, mechanisms, attachments) + effects [pure]
src/weapons/build.ts       WeaponBuild (persisted config), FAMILIES, rollBuild, socket kinds, buildEffects     [pure]
src/weapons/modules.ts     module types (socket kind, families, visual), canInstall, removalCost              [pure]
src/weapons/geometry.ts    chamfered lathe / profile-prism / box vertex generators (ear clipping)            [pure]
src/weapons/materials.ts   weapon material library per scene (graphite, satin, dark, polymer, glass, finishes)
src/weapons/model.ts       buildWeaponModel(build, installed): chassis per family + mounts, merged meshes, anim hooks
src/weapons/animator.ts    WeaponAnimator: springs for recoil/sway/sprint/dash/jump/land, heat/charge visuals
src/fx/WeaponFx.ts         plasma bolts, rail trails, continuous beam, arc lightning (camera-facing ribbons)
src/home/WeaponPreview.ts  HQ 3D inspection: small dedicated engine on its own canvas (studio env, ArcRotate)
src/ui/WeaponViewer.tsx    React wrapper for WeaponPreview (created/disposed with the terminal)
src/combat/damage.ts       rollDamage / applyDamage / mulberry32     [pure]
src/combat/stats.ts        CombatStats + StatModifier stacking         [pure]
src/enemies/EnemyManager.ts pooled enemies, route following, attacks, separation, stuck watchdog
src/defense/placement.ts   placement rules                            [pure]
src/defense/Construction.ts build mode: engine picks + footprint samples -> validatePlacement
src/defense/Turrets.ts     Sentinel targeting/aiming/firing
src/waves/waves.ts         wave definitions + endless generator       [pure]
src/waves/WaveManager.ts   prep/combat/cleared lifecycle, spawn cap   [pure, hooks-based]
src/fx/Effects.ts          pooled tracers, debris, enemy projectiles, particle bursts, flash light
src/audio/Sfx.ts           procedural WebAudio bank
src/ui/Market.tsx          M4 terminals: equipment exchange / module broker (buy, sell, exchange), reclamation, fabricator
src/ui/Engineering.tsx     M4 engineering workshop: MODULES (M3 ModuleBench) / AFFIXES / ENHANCE / COMPONENTS tabs
src/ui/economy.tsx         ResourceBar, CostLine, ConfirmButton, useTx (one tx at a time, fresh tx id, econ feedback event)
src/ui/                    React App (menus, pause, checkpoint, defeat, summary, transit), Hud (arena), HomeHud,
                           Terminals (deploy/loadout/storage/workshop/command), items.tsx (shared inventory view,
                           item detail, comparison), LootHud (prompt, feed, world labels, arena cargo), store + uiEvents
tests/                     Vitest suites for the [pure] modules
scripts/e2e-m1.cjs         M1 browser acceptance suite (70 checks: scenarios A-G, tiers, leaks, persistence)
scripts/e2e-m2.cjs         M2 browser acceptance suite (loot scenarios A-I, migration, leaks)
scripts/e2e-m4.cjs         M4 browser acceptance suite (A-K through the terminal UIs, reloads, exploits, rollback, leaks)
scripts/e2e-m3.cjs         M3 browser acceptance suite (families, generation, engineering UI, variation, loot, v2 migration, leaks)
```

## Key design decisions

### M5: roguelite upgrades, elements, modular towers

- **One damage pipeline.** Every source (weapon, tower, status tick, effect, reaction) calls `Director.deal()`: vulnerability (chilled +, frozen +25%) -> elemental power -> `EnemyManager.damage` -> attribution (`damageBy`, per-tower kills/damage) -> reactions + statuses -> kill handling (`Game.onEnemyKilled`) -> typed events. `Game.damageEnemy` is the legacy entry (rolls crit, plays hitmarkers) and routes to it.
- **Effect bus** (`events.ts`): effects register under an owner id (`upgrade:<id>`) and are rebuilt from scratch on every pick (no duplicate listeners). Events carry `chain {id, depth}` and `source {kind,id,towerId}`. Rules: damage is never dropped, only trigger propagation: events deeper than `MAX_DEPTH` (4) reach no effects; an effect fires at most `chainLimit` (default 1) times per chain; cooldown + chance per effect; queue drained per frame with budget 300 (carry-over) and hard cap 1500 (refusals counted in `stats.dropped`). Pooled enemies carry `gen`; events compare it so recycled targets are ignored. Visual work (arcs, heavy explosions, numbers) has per-frame budgets; logic does not.
- **Statuses** (`status.ts`, stored on `Enemy.status`, reset on spawn/release): Burning (stacks to 5, 0.5 s ticks), Shocked (0.5 s disruption, 2 s internal cooldown), Chilled meter (slow up to 55%, freeze at 100 for 1.5 s then 5 s immunity). Statuses also scale enemy movement, attack timers and animation. Reactions use the contact element (hit element or applied status), consume their fuel and have per-target cooldowns: thermal shock (thermal on chill>=50), overload (electric on burning), superconduct (electric on chill>=40, +2 chain). DoT ticks never react.
- **Run upgrades** (`upgrades.ts`): live only in `Game.director.build` (never in the save; a new `Game` = empty build). Stat upgrades are StatModifiers per stack (`RunBuild.modifiers()`), others are bus effects keyed by upgrade id in `effectsFor`. `Game.rebuildStats()` composes equipment + debug + upgrades + temporary buffs (event driven). Offers: `RunBuild.roll(ctx, index)` seeded by (seed, index) -> deterministic; rarity weights x depth, tag affinity, stack penalty, eligibility (`needs`: towers, notFamily, anyTag, towerArch; `minWave`), max one legendary, category diversity. Flow: wave cleared -> prep start -> `openUpgrade()` (screen `upgrade`, sim and prep countdown frozen) -> `chooseUpgrade` -> checkpoint panel if due -> resume. Seed: `ArenaConfig.seed` (`flow.nextUpgradeSeed` for tests) else hash of run id. `skipUpgrades` (Flow/Game) is automation-only (legacy suites).
- **Modular towers** (`towers/components.ts`): `TowerConfig {base, weapon, core, modifier}`, archetypes ballistic / arc / cryo field. `composeTower` is the single source of numbers (base x weapon x core x modifier x level x run stats x empowerment), recomposed lazily when `statsVersion` changes. Default config == the old Sentinel (cost 100). Compatibility is explicit (`canInstall`). Refit (`Game.modifyTower`): weapon/core/modifier swap (net cost = new - 50% old, x `buildCostMult`) or level up (max 5); allowed in prep/cleared, and in combat only while tactical mode is active; base is fixed. Hotkeys: aim at tower + R/C/V/N (build mode: C/V/N/M cycle the template); T opens the panel (prep only); U shows the run build.
- **Synergies** are bus effects (Phase Sync empowers towers on Storm Crit lightning; Thermal Detonation; Cryogenic Precision in `damageEnemy`; Feedback Loop / Battle Network Link buffs on tower kills; Overcharge Network, Conductor Link, Grid Capacitor discharges). Tower attribution travels in `source.towerId`.
- **Persistence**: save v5 adds `towers.unlocked` (`slot:id`; starters implicit). `economy/transactions.researchTower` (HQ only, best wave + credits/components, tx id guard); UI = workshop "TOWER TECH" tab. `ArenaConfig.towerTech` snapshots unlocks at deploy. Deployed towers, levels and run upgrades are never persisted.
- **Diagnostics**: F3 shows FPS, enemies, towers, projectiles, bus queue, effects, triggers/s, statuses, dropped triggers, player/tower dps.
- **Tests**: `tests/m5.test.ts` (bus, statuses, reactions, upgrades, towers, research/migration); `node scripts/e2e-m5.cjs` (24 checks: upgrade flow, seeds, reset, statuses/reactions, tower refit incl. tactical, synergy, 42-enemy stress with 19 upgrades, research reload). Legacy e2e scripts set `flow.skipUpgrades`.
- **Limitations / not done**: no protective-barrier upgrade, no combat-drone legendary; towers are not damageable (base "durability" is not modelled); Cryogenic Field is not occluded by walls; element visuals reuse pooled bursts (zap/frost added); balance is first-pass; real-GPU FPS not measured (headless SwiftShader sim: 1.9 ms avg/frame, p95 12.7 ms with 42 enemies, 6 towers, 19 upgrades).

### M4: persistent economy, merchants, salvage, fabrication, engineering

- **Three resources** in `save.resources`: `credits`, `salvage`, `components` (advanced components). Run income (`RUN_INCOME`): wave clear credits, checkpoint credits + components (tier-scaled), credits per kill (elites most), 25% elite component chance. They go through `RunLedger` (unsecured -> banked at checkpoints -> lost on defeat) exactly like salvage; `bankRewards` applies them. New profiles and v3 migrations get `STARTING_CREDITS` (200).
- **One formula file** (`economy/config.ts`). Everything grows linearly with `levelFactor(L) = 1 + 0.1(L-1)` (levels are clamped, counters capped, results rounded non-negative integers): no unbounded exponentials. Item value = 18 × levelFactor × rarity value × category × affix quality; buy = value × 2.3-2.4, sell = value × 0.3, enhancement never adds value. Unit tests assert buy→sell/dismantle and craft→sell/dismantle are always lossy at exchange prices (`EXCHANGE_UNIT`), and that material conversions are lossy both ways.
- **Transactions** (`economy/transactions.ts`): every action validates everything first (HQ only, ownership incl. modules installed in owned weapons, protection, eligibility, cost, storage bay) then mutates synchronously; failures return `{ok:false, reason}` with the save untouched. `withTx` remembers the last 40 committed tx ids (repeat submissions rejected). UI goes through `useTx` -> `Profile.transact`, which restores the pre-transaction state if a rule fails and **rolls back if the storage write fails** (so success is only reported once persisted; `profile.failWrites` test hook). Batch dismantle/sell are all-or-nothing.
- **Protection**: equipped items, installed modules and `item.locked` items cannot be sold or dismantled. Selling/dismantling a weapon returns its modules to storage. Presets referencing a removed item are cleared.
- **Merchants**: `save.market` holds the stock (8 equipment, 6 modules, featured slot = rare floor, max epic), generated by `generateItem` at `progressLevel` (best cleared wave + that tier's loot bonus) from `marketSeed(profile, rotation)`. Reopening never rerolls; `recordRun`/interrupted runs rotate it; paid refresh escalates per rotation. Stock items are full `ItemInstance`s (sanitized on load; an entry whose uid is already owned is forced sold). Exchange packs are limited per rotation and cannot be sold back.
- **Affix engineering** (`economy/engineering.ts`): single 'stat' reroll (any compatible affix from the same pool/weights, group uniqueness kept), 'value' refine (same affix, new tier+roll), full reroll of unlocked affixes. Tiers use the generator's `rollTier` + rarity minTopTier guarantee; values use `rollAffix` (level scaling, quality floor, affixMult). Randomness = `engineeringRand(uid, seed, rerolls)`: deterministic, so restoring a backup cannot fish. Locks are per affix (`affix.locked`), max affixes-1, each lock adds salvage + components to a full reroll. Costs escalate +15%/op (`item.rerolls`, capped ×10). Item names and `signature` never change.
- **Enhancement**: `item.enhance` 0..`MAX_ENHANCE[rarity]` (4/6/8/10/12/15). Applied in the stat pipeline only (`itemModifiers`, `weaponDefFor`; stored rolls untouched): weapons +4% damage +1.5% cooling per level, gear +4% to beneficial implicits, modules +5% to all beneficial stats (penalties never amplified, counts like projectiles never scaled). Never fails.
- **Component engineering**: barrel/core/cooling/mechanism swaps limited to `componentsFor(slot, family, rarity)` (prism core stays legendary+; a railgun can only get rail mechanisms). Because effects are baked into rolls, the roll is rescaled by new/old `buildEffects` ratios (quality preserved). The model builder reads the build, so preview/viewmodel update automatically.
- **Fabrication** (`economy/recipes.ts`): recipe (category, weapon family or module base) × quality grade (standard C-U, refined U-R +1 comp, superior R-E needs tier II, masterwork E-L needs tier III with luck 0.5 → ~10% legendary). Output = `generateItem` at `progressLevel`, source 'crafted', seed from `economy.crafts` counter. Exotics are never craftable; merchants cap at epic.
- **HQ**: two new rooms from layout data (`market` east of storage, `reclaim` west of the drone bay; portals at x=±23/-21; sealed doors moved to the far walls), 4 new stations (`merchant`, `modules`, `salvage`, `fabricate`). Live displays: exchange wall bays mirror stock rarity/sold state, broker vault cores + exchange tanks, press hopper fill (log of salvage) and component cells. `uiEvents 'econ'` triggers `HomeBase.stationFx` (press stroke, fabricator glow, vault spin, calibration ring, sounds) and HUD resource deltas. Interior materials take 10 lights.
- **Save v4**: `MIGRATIONS[3]` adds credits/components; sanitize generates the market/economy if missing and validates item engineering fields (`locked`, `enhance` capped by rarity, `rerolls`, `mods`, `affix.locked` with at least one affix unlocked).

### M3: weapon families, procedural weapons, modules, engineering

- **Families** (`data/defs.ts` templates, `weapons/build.ts` FAMILIES): Plasma Repeater (hitscan + travelling bolt visuals, `auto`/`burst`), Railgun (`charge`: hold to charge, release fires 30..100% damage, partial charge = less heat; or `cycle`: automatic full slugs; slugs pierce `pierce` extra enemies at -15% each), Beam Emitter (`beam`: 15 damage ticks/s, damage ramps to `rampMax` while the beam stays on the same enemy, `beamWidth` aim-assist radius, shorter range). All damage still goes through `Game.shoot` -> `damageEnemy` -> `rollDamage` -> `EnemyManager.damage`.
- **Bases are chassis**: 3 per family (`plasma_repeater/heavy/light`, `rail_lancer/siege/striker`, `beam_prism/lattice/focus`). `generateItem` rolls the base numbers, then `rollBuild` (own seeded stream: `seed ^ 0x5bd1e995`) picks barrel, core, cooling, mechanism, 0-3 attachments (by rarity), finish (legendary = gilded, exotic = iridescent) and appearance params; component multipliers (`buildEffects`) are **baked into the stored `WeaponRoll`** (+ `range/accuracy/pierce/chargeTime/beamWidth/rampMax`). Only components offered for the family (and rarity: prism core = legendary+) can roll, and every one has geometry for that family, so no invalid combination exists. `GENERATOR_VERSION = 2`.
- **Stat composition** (`loot/equipment.ts`): `weaponDefFor` = family template -> stored roll -> build mechanism. Everything else is StatModifiers in `CombatStats` (affixes, installed modules, other gear, run modifiers), applied at fire time: damage × weaponDamageMult × thermal (1 + heatDamage × heat), rate × fireRateMult, heat / heatEfficiency, spread/recoil × spreadMult, charge/ramp × chargeRateMult, range × rangeMult, projectiles (floor), pierce (+). New stat keys: `projectiles, spreadMult, chargeRateMult, arcChance, arcDamage, heatDamage, pierce, rangeMult` (only modules/components produce them).
- **Sockets**: weapons only; count per rarity in `rarity.ts` (0/1/2/3/4/4); kinds (`barrel`/`power`/`system`) follow a per-family pattern and are stored in `build.sockets`. Module types (8 + 3 legacy M2 inserts) each fit one socket kind and a family list (splitter = plasma only). `canInstall` is the single rule.
- **Ownership**: installed modules live **inside** the weapon item (`socketed: (ItemInstance|null)[]`), not in `items`/storage, so a module can never be in two places and always shares the weapon's carried/secured/unsecured status. `itemModifiers(weapon)` includes its modules (exactly once); loose modules contribute nothing. `allOwnedUids` covers nested uids (banking duplicate guard).
- **Engineering transactions** (`save.ts`): `installModule` (free), `uninstallModule` (salvage = `removalCost`, needs a free storage bay), `transferModule` (same cost, no bay needed). HQ only (`activeRun` blocks), owned weapons only (equipped or stored), validate everything before mutating. Scrapping a weapon returns its modules to storage.
- **Save v3**: `MIGRATIONS[2]` sets M3 socket counts (weapons) / 0 (others) and drops the old `modules` uid list; `sanitizeItem` validates builds (invalid -> `defaultBuild(chassis)`: stats untouched), validates nested modules against their socket (incompatible ones are evicted to storage, never deleted) and de-duplicates uids across nesting. M2 module bases stay (weight 0) and install into barrel/system/power sockets.
- **Viewmodel**: `buildWeaponModel` builds per-family chassis that expose mount points (barrel axis/z, core bay, top, flank, sockets); components attach to those mounts, so parts never float. Static parts merge per (animated node, material) => ~25-35 meshes per weapon. Animated hooks: slide (recoil), spinners (coils, rings, prism core), fins (open with heat), charge nodes (rail capacitors/rings), 5 heat LEDs (material swap), per-model energy/charge/heat materials. A drone hardpoint arm (viewmodel only) runs off-screen. The animator is spring based and dt driven (deterministic under `advance()`).
- **First person**: anchored at `Weapon.ts` `ANCHOR`; x/y offsets and scale are multiplied by `tan(fov/2)/tan(ref/2)` so the weapon keeps its screen footprint under FOV changes (sprint kick, settings). Shots are resolved from the camera ray (crosshair accurate); visuals start at the muzzle and end at the resolved hit point.
- **Effects** (`WeaponFx`): streak quads are rotated around their axis to face the camera (crossed quads vanish when viewed along their length). Plasma bolts have a tail toward the muzzle and run their impact effect on arrival; rail trails fade/widen; the beam is one persistent ribbon pair + endpoint flare + light; arcs are 6 jagged segments. Impacts differ per target (surface, shield, armour) and family.
- **Preview**: `WeaponPreview` uses a second small `Engine` on its own canvas because the terminal overlay blurs the main canvas; it captures a studio env once, rebuilds the model only when uid/build/installed modules change, and disposes engine+scene on terminal close (`window.__preview` while open, for tests). Debug: `__rift.lab(items, opts)` renders models in front of the camera for visual QA.

### M2: loot, equipment and inventory

- **Definitions vs instances.** `bases.ts` + `affixes.ts` + `rarity.ts` are data; `generateItem(spec)` turns a (seed, base/category, level, rarity) into an `ItemInstance` that stores *every* rolled number (implicit stats, affixes with tier/roll, weapon roll, sockets, seed, generator version). Loading never rerolls; formula changes only affect new drops. Same seed + spec + `GENERATOR_VERSION` reproduces an item.
- **Every stat is real.** Affixes and implicits only target `CombatStats` keys that a system reads (weapon damage/rate/crit/heat/cooling, hull, armor, resist, shield cap/regen/delay, move, dash recharge, turret dmg/rate/range, Sentinel cost, tactical recharge). `STAT_DEFS` holds base, clamps, labels. Stacking: `(base + Σadd) × (1 + Σpct) × Π(1+mul)`, then clamp.
- **Single pipeline.** `equipment.ts` turns the equipped items into modifiers and the weapon item into a `WeaponDef`; `Game.refreshEquipment()` rebuilds stats from scratch on every equipment change (never per frame), so swapping/unequipping cannot leave bonuses behind. Player gets hull/shield/mitigation via `Player.applyStats`; armor is measured against `flatScale(wave + tier bonus)` so its value tracks enemy level.
- **Scaling.** Flat values grow with `flatScale(L) = 1 + 0.08(L-1) + 0.0009(L-1)²`; percentages with `pctScale` (log2); chances/delays do not scale (stat clamps bound them). Affix tiers unlock with level (`maxTierFor`). Item level = wave + tier `lootLevelBonus` (0/8/18) + source bonus + (-1..+2). Rarity luck = source × tier `lootLuck` × (1 + 1.2%/wave), capped (`MAX_LUCK`). `MAX_ITEM_LEVEL` (1e6) is a numeric safety bound only.
- **Rarity** sets affix count, roll floor (`quality`), tier bias, guaranteed top tier, base multiplier, future sockets, colours and beam height. Ranges overlap so rolls and tiers matter as much as rarity. Legendary/exotic have no signature effects yet (`signature: null` is reserved in the save shape).
- **Drop tables** (`drops.ts`): walker 8.5%, rusher 5%, bulwark (elite) 55% + uncommon floor + exclusive Bulwark Plating (target farming), wave clear 40% (guaranteed on wave 1), checkpoint cache 2× rare+ (granted *with* banking), boss (data only). Category weights per source.
- **Physical loot** (`LootField`): instanced hologram per category icon, rarity ground ring, halo (epic+), additive beam (uncommon+), landing pulse/flash/chime for rare+, banner for legendary+. Loot shaders are force-compiled at arena build and awaited by the transition. Lifetime (`lifetime.ts`): dropped in wave W → expires when W+2 is cleared; evaluated only on wave clears (pauses/inspection never age loot). Saturation: at 40 pickups, sub-rare drops become salvage at drop time (never deleted after appearing); rare+ always spawn (hard guard 120).
- **Interaction**: `pickInteractable` (same as HQ) over landed pickups within 3.4 m + Havok occlusion; E collects into the run cargo. Prompt shows rarity/category/level and a quick level comparison; nearby pickups get projected name tags (imperative DOM pool).
- **Ownership is decided by the ledger, not slots** (`RunInventory`): `carried` (equipped at deploy, never lost), `secured` (banked this run, in the save), `unsecured` (cargo, cap 20). The arena gets *clones* of the equipped items; arena equip/unequip/discard only touch the run loadout and are allowed only in the `prep` phase (`Game.equipAllowed`). At run end `Flow.endRun` records the run and then `applyLoadout(save, inventory.ownedLoadout())`: slots holding lost items are skipped, so the profile keeps its previous secured gear.
- **Banking** reuses M1: kills/pickups → `RunLedger.collect` (idempotent by uid) → `bank(wave)` → `bankRewards` validates every item (`sanitizeItem`) then applies in one step; guarded by `bankedThroughWave`. The checkpoint UI says "secured" only if the write succeeded (`Profile.lastWriteOk`). Banking never drops items: storage may exceed capacity, which blocks deployment until the player scraps items or buys an expansion.
- **HQ**: storage terminal = shared `InventoryView` (filter by category, sort rarity/level/newest/name, detail, raw comparison + "drone stats if equipped" via the real stat pipeline, equip/unequip, scrap for salvage, +10 bays for salvage = first salvage sink). Drone configuration = slots, calculated stats, 3 saved presets (references into owned items; missing items skipped). Workshop became weapon engineering in M3 (see above).
- **Modules** are `category: 'module'` items with `module {type, compatible, socketCost}` and at least one affix; `itemModifiers` returns nothing for them and the UI states they are inactive.
- **Save v2**: `MIGRATIONS[1]` drops the unused `module` slot, adds `presets` and `storage.expansions`; `sanitizeItem` upgrades M1 items to the deterministic level-1 common roll (same 13 damage repeater), keeps unknown-base items (inert, unequippable), validates every number. Capacity = 50 + 10 × expansions.

### M1: sessions, scenes and persistence

- **One world at a time.** `Flow` owns the engine loop, the single `Input` (window listeners are registered once), the `Profile` and either a `HomeBase` or a `Game`. `Flow.transition()` paints the transit overlay, disposes the old Babylon scene completely (`scene.dispose()`: meshes, materials, textures, physics world, post-processes, observers), builds the next, waits (bounded 8 s) for `whenReadyAsync` while rendering but not simulating, then reveals it. A new run is always a new `Game`, so towers, enemies, waves, effects and wallet can never leak between runs. Pointer lock lives on the shared canvas and survives the swap (request it inside the click gesture, before any await).
- **Never `clone()` a palette material** (it clones DynamicTextures, which come out blank and never report ready; that stalled readiness for 8 s on every transition). Build fresh `PBRMaterial`s instead.
- **Run lifecycle.** HQ deploy → `beginRun` (save.activeRun) → arena. Kills and wave clears `collect` salvage into `RunLedger.unsecured`. Every 5th cleared wave the ledger `bank()`s and `Flow` commits it with `bankRewards` (guarded by `activeRun.bankedThroughWave`, so repeated hooks cannot duplicate). The following prep phase opens the checkpoint choice (`Game.checkpointOpen`; H reopens it until combat starts). `returnHome` / defeat / pause-abandon → `RunLedger.finalize()` (idempotent; unsecured becomes lost) → `recordRun` (idempotent by run id) → HQ. A save that still has `activeRun` on load was closed mid-run and is recorded once as `interrupted`.
- **Save format** (`riftwarden.save` in localStorage): `{"v":1,"sum":"<fnv1a of data json>","data":SaveData}`. SaveData = profile, resources.salvage, items[] (every owned item; each uid is in exactly one of loadout/storage), storage{capacity,uids}, loadout{weapon,armor,shield,reactor,processor,module,accessory}, threat{selected,unlocked}, records{tier:{bestWave(cleared),bestKills,runs,checkpoints,salvageSecured,longestRun}}, totals, history (last 12), activeRun, base{layoutVersion, placeables[], facilities[]}. Load: checksum/parse failure → raw text kept in `riftwarden.save.corrupt`, previous good save restored from `riftwarden.save.bak` (rotated on every write) or defaults. Newer versions are refused, older ones go through `MIGRATIONS[n]`. `sanitizeSave` repairs everything else (never deletes owned items, re-equips a weapon if needed). Writes happen only on committed rule changes (deploy, bank, run end, tier select, equip), never per frame.
- **Rewards in M1** are salvage only (persistent resource, no sink yet; the workshop says so). Items are modelled end to end (ledger, banking into storage, equip-from-storage for functional slots) but nothing drops them until M2; tests use fixture items. Only the weapon slot is functional; other slots are defined and shown as empty.
- **Threat tiers** (`tiers.ts`) multiply wave hp/damage/speed/count via `getWave(n, scaling)`; salvage scales by `salvageMult`. Tier N+1 unlocks at the first checkpoint on tier N. Records are per tier.
- **HQ customisation foundation.** Static architecture is code (`layout.ts` + `HqBuilder`); everything a player will later move/add is a `Placeable {uid,type,position,rotationY,scale,props}` in `save.base.placeables`, rebuilt by `buildPlaceable` on every visit (sanitised: unknown types dropped, positions clamped to `PLACEABLE_BOUNDS`).
- **Interaction.** `pickInteractable` picks the station focus point closest to view centre inside a cone (widens up close) and range (`INTERACT_RANGE`, per-station override), rejecting points occluded by a Havok `ENV_QUERY` ray that stops 0.4 m short (the focus sits on the station's own collider). E opens a terminal (screen `terminal`, pointer released); E/Esc closes (Esc cannot re-lock the pointer in browsers, so it falls back to the pause overlay).
- **Canvas textures on planes** go through `props.planeBuilder` (faces local +z, V flipped for DynamicTexture). Unlit materials have zero reflectance (`metallicF0Factor = 0`) so SSR never paints over screens/glows.

### M0

- **Two clocks.** `update(dt)` uses real time for player, weapon, turrets, UI; `hdt = dt * tactical.hostileScale` for enemies, enemy projectiles and spawn timing. Tactical mode only dilates hostiles.
- **Lanes are reserved.** Enemies follow fixed polylines (`ARENA.routes`) with per-enemy lateral offset; placement forbids towers within `laneHalfWidth + radius` of a lane on the floor, so construction can never block navigation. A 5 s stuck watchdog snaps enemies to their waypoint.
- **Hit detection.** Player hitscan uses `scene.multiPickWithRay` against meshes tagged `metadata.surface` (level) or `metadata.enemy` (invisible hitbox spheres: body + weakpoint). Turret hitboxes (`metadata.turret`) are only used for inspection, shots pass through. LOS checks use Havok raycasts with `ENV_QUERY` so they ignore the player capsule.
- **Damage pipeline.** All damage goes through `Game.damageEnemy` -> `rollDamage` -> `EnemyManager.damage` (`applyDamage`: shields first, energy +50% vs shields). Feedback (hitmarker, numbers, sounds) is emitted from there. Future triggered effects hook in here.
- **Stats.** `Game.modifiers: StatModifier[]` -> `computeStats` -> `Game.stats`, read by weapon, turrets and movement. Loot and run upgrades should only add modifiers.
- **Gameplay vs visuals.** Effects are pooled and capped (`Effects.particleBudget`); logic never depends on them.
- **Rendering.** Surfaces are `PBRMaterial` (`usePhysicalLightFalloff = false`, so light intensities/ranges behave like the old StandardMaterial setup). Every glow/beam/additive sprite uses `unlit()` (PBR unlit = colour x texture, unclamped HDR). Do NOT use StandardMaterial for tinted or HDR glows: it adds emissive textures and clamps to 1.
- **Environment.** `Atmosphere.captureEnvironment` renders the static scene once (after `executeWhenReady`) into a ReflectionProbe, wraps the cube in a plain `BaseTexture`, prefilters it with `HDRFiltering`, and sets `scene.environmentTexture`. Never reference the probe's RTT from a material (it would re-render while sampled: GL feedback loop). DynamicTexture `clone()` yields a blank texture: build a second texture from the canvas instead.
- **Screen-space passes** (SSAO/SSR) use a separate geometry buffer (`forceGeometryBuffer`), not the prepass MRT, because prepass breaks particle rendering. Sprite-sheet particle systems also rendered incorrectly; use single sprites with random rotation.
- **Explosions** go through `Effects.explode(pos, {scale, debris, color})`: star flash, additive fireball, stretched sparks, embers, rising smoke, ground + air shockwave rings, smoke-trailing debris, flash light, scorch decal and a camera-shake request (`onShake` -> `Player.addTrauma` + lens kick). Shots on level geometry use `Effects.impact` (sparks, dust puff, burn decal).
- **UI.** Game publishes a HUD snapshot to `hudStore` at 20 Hz; instant feedback goes through `uiEvents`. Damage numbers animate imperatively (no per-frame React renders).
- **Data-driven content** in `src/data/defs.ts` (weapon, enemies, tower, economy).

## Testing

- `npm test` (147): M4 economy (`economy.test.ts`: formulas finite at extreme levels, exploit invariants, dismantle/sell/buy/exchange/refresh, protection and atomic batches, rerolls/locks/determinism/signature, enhancement effects, component swaps, crafting windows/gating, v3->v4 migration, run income, Profile.transact rollback), plus (104) M3 weapon generation/compatibility/engineering transactions/v2->v3 migration (`weapons.test.ts`), plus loot generation/rarity/drops/equipment/lifetime (`loot.test.ts`), save v2 migration, banking and ownership scenarios D/E/F, presets/scrap/expansion (`save-m2.test.ts`), plus the M1 suites: damage, stats, tactical/wallet, layout lane clearance, placement rules, wave generation and the wave lifecycle, settings, save format/migration/corruption, run ledger + banking rules, tiers, HQ layout and interaction targeting.
- `node scripts/e2e-m1.cjs` (dev server on :5173, Playwright): M1 acceptance scenarios A-G, tiers, interrupted runs, 4 deploy/return cycles with resource/listener/heap leak checks. Last run (after M2): ALL PASSED.
- `node scripts/e2e-m4.cjs`: M4 scenarios A-K driven through the terminal UIs (salvage + reload, lock protection, purchase + reload, stock stability/rotation, double-click purchase, exchange, fabrication + equip + fire, affix reroll + reload, locked affixes, enhancement changes real shot damage, component refit + preview rebuild, failed transactions, save-failure rollback, exploit loops, station targeting, leak cycles). Last run: 39/39 passed (~6 min). After M4, M1 (ALL PASSED), M2 (54/54) and M3 (35/35; its H1 now accepts save v>=3) were re-run and pass.
- `node scripts/e2e-m3.cjs` (last run: 35/35 passed, ~2 min): A families (plasma bolts, rail charge/release/pierce/trail, beam ticks/ramp, visible overheat), B generation (108 weapons, determinism, sockets, geometry budget), F visual variation, G loot drop -> equip -> fire -> bank -> HQ, C/D/E workshop install/preview/remove/incompatible through the UI + reload, H M2 save migration + install, I splitter/arc/movement/perf + leak cycles. M1 (all) and M2 (54/54) suites were re-run after M3 and pass.
- `node scripts/e2e-m2.cjs` (last run after M3: 54/54 passed): M2 scenarios A-I in the browser (drops near kills, targeting + E pickup, live roll validity, real shot damage/cooling/shield/movement/Sentinel cost changes, combat lock, banking + storage UI + reload, unsecured loss, equip-before-bank exploit via the inventory UI, lifetime, M1-save migration + reloads, leak cycles with loot). Extra debug API: `spawnLoot`, `pickups`, `approach(id)`, `teleport`, `makeItem`, `grant`, `damageReactor`; `game.dropChanceMult`, `game.rollItems(source)`. Do not edit `src/` while an e2e runs against the dev server (Vite HMR reloads the page).
- Browser automation: open `/?test`. This sets `input.forceCapture` (no pointer lock needed) and exposes `window.__rift` (`Flow.debugApi()`) with `state()` (location, screen, profile summary + current world snapshot), `look(yaw, pitch)`, `advance(seconds)` (fixed 60 Hz simulation of the current world, no rendering), `stopLoop()`, `render(frames)`, `killAll()` (through the real damage pipeline), `leakStats()`, and `flow`, `profile`, `game` (current arena or null), `home`. Drive the loop with `flow.enterHq()`, `flow.deploy(tier)`, `flow.returnHome()`, `flow.abandonRun()`, `flow.leaveArena()`. Note: a real Playwright mouse move feeds `mouseDx` while `forceCapture` is on; `advance(1/60)` before `look()` after DOM clicks. In SwiftShader the high preset takes ~1 s per frame: call `stopLoop()`, wait for `game.scene.environmentTexture`, then interleave `advance(1/60)` + `render(1)` and screenshot with a long timeout. Drive input with `game.input.simulateKey(code, down)` / `simulateMouse(button, down)`. Headless Chromium uses SwiftShader (very low FPS), so verify gameplay with `advance()` and take screenshots between calls.

## Measured (headless SwiftShader, so GPU numbers are not representative)

- M1 HQ (high preset): ~110 draw calls, 165 active meshes, 0.23 ms simulation per frame. Arena with 9 enemies, high preset with cascaded shadows: ~320 draw calls.
- Scene build (CPU, incl. procedural textures): arena ~1.0-1.4 s, HQ ~0.9-2.7 s; dispose ~20-50 ms. Readiness (shader compile) dominates in SwiftShader (6-8 s); expected far shorter on a real GPU (unmeasured).
- 4 deploy -> wave 5 -> return cycles: 1 scene alive; HQ textures/meshes/materials/lights identical every cycle (35/392/56/8 on the low preset), arena identical (31/556/61/8), listener counts flat, JS heap flat (133 MB).

- Simulation: ~0.8 ms/frame with 42 enemies + 6 turrets, ~1.5 ms while firing.
- M2 loot: one drop roll + generation ~13-15 µs; 30 live pickups (far above normal, ~5-10) add ~0.5 ms/frame of simulation in SwiftShader (hologram animation + targeting). Each pickup is ~10 GPU instances of shared templates; no per-drop materials. Arena with loot: meshes/materials/textures flat over 3 deploy cycles (e2e I3).
- Bundle: app chunk 373 kB (125 kB gzip) after M3.
- M3 weapons: 25-42 meshes per procedural weapon (static parts merged per animated node/material), 8-15k vertices; model build is a few ms and happens only on equipment change. Firing simulation 0.6-2.3 ms/frame in SwiftShader incl. picking (varies with enemy count); HQ resources flat over 4 workshop+deploy cycles (412 meshes / 56 materials / 30 textures, one canvas).
- M4 HQ (low preset, two new rooms, 4 stations): 672 meshes / 78 materials / 41 textures, flat over 3 terminal+deploy cycles; HQ simulation 0.14-0.23 ms/frame. Station displays keep a fixed instance count (rarity templates are created up front). App chunk 447 kB (149 kB gzip).
- Draw calls: ~87 baseline, ~130 with 40 enemies + 6 turrets (instancing works).
- Production bundle: ~1.4 MB gzip JS (Babylon barrel import) + 0.66 MB gzip Havok WASM.

## Known limitations / follow-ups

- Real-GPU frame rate not measured in this environment; use F3 on target hardware.
- Babylon is imported from the barrel (`@babylonjs/core`), so the bundle is large. Switching to deep imports would cut startup size.
- Turrets cannot be damaged and have no upgrades; core income outpaces spending in later waves (needs sinks later).
- Legendary signature effects are not implemented; no elemental damage types exist (Arc Conductor arcs are energy damage).
- Economy balance is first-pass (prices/costs in `economy/config.ts`, recipes in `economy/recipes.ts`). Item names are not regenerated after affix rerolls. Attachments are not swappable.
- Only the weapon has sockets; armor/shield/etc. sockets were never functional and were removed in save v3.
- The HQ preview has its own WebGL context while a terminal is open (released on close).
- Dropped weapons use the shared rifle hologram (no per-family world model).
- Balance is first-pass: enemy HP grows quadratically with waves while item power grows roughly linearly + affixes, so very deep endless runs still get harder. Drop rates/weights are in `drops.ts`/`rarity.ts`.
- Transitions wait for `whenReadyAsync` (cap 8 s); real-GPU transition time is unmeasured. The arena scene sometimes reports not-ready again after the first resolve (render targets); harmless.
- Closing a terminal with Esc cannot re-acquire pointer lock (browser rule): the pause overlay asks for a click. E closes and re-locks.
- Graphics quality applies immediately in the HQ (rebuild), on the next scene in the arena.
- Run suspension/resume is out of scope: closing the tab mid-run records it as `interrupted` (secured salvage kept, unsecured lost).
- High preset cost (SSR + SSAO + MSAA + 8 lights on PBR) is unmeasured on real GPUs; `Performance` preset drops SSR/SSAO/shadows/MSAA. Profile with F3.
- No per-enemy hit flash yet (instanced PBR parts would need an instanced colour buffer).
- Enemies do not attack turrets; walkers only target the reactor and shoot the player.
- Gate frame pillars near the openings are visual only (no collider).
- No run upgrades, bosses, music, or multiplayer yet (by design).

## Milestones

- **M0 (done):** arena, movement, plasma repeater, Sentinel turret + placement, tactical mode, walker + rush drone (+ Bulwark elite), 3 hand waves + endless generator, HUD/menus, restart.
- **M1 (done):** explorable HQ with interactive stations, deployment with threat tiers I-III, 5-wave checkpoints with automatic banking and continue/return choice, defeat/abandon handling, versioned persistent save (records, salvage, loadout, storage, placeables), repeated scene transitions without leaks.
- **M2 (done):** procedural loot (6 rarities, 20 affixes, 19 bases over 7 categories, seeded generator, level scaling), drop tables per source incl. elite/target-farm and checkpoint cache, physical pickups with lifetime rules, run cargo + prep-only equipping, functional armor/shield/reactor/processor/accessory stats, comparison UI, banking/loss/ownership rules, HQ storage (scrap, expansion sink), presets, module drops (stored), save v2 migration.
- **M3 (done):** three weapon families with distinct mechanics/effects/sound, procedural components baked into rolls, procedural first-person models with mechanical animation and heat visuals, 8 functional module types in rarity-based typed sockets, HQ weapon engineering (install/remove/transfer for salvage) with live 3D inspection, save v3 migration.
- **M4 (done):** credits + advanced components, equipment exchange and module broker with persisted rotating stock and material exchange, reclamation press with batch dismantling and item locks, affix recalibration with locks and escalation, enhancement, component refits, fabrication recipes with quality grades, two new HQ rooms with live station displays, transactional saves with rollback, save v4.
- **M5 (done):** see the M5 section.
- **Next:** legendary signature effects (`signature` is still reserved; rerolls already preserve it).
- Later: combat depth (second tower, turret upgrades, enemy variety, hit flash, audio pass, deep-import bundle split), run upgrades, M4 modular towers, M5 advanced endless (bosses/events), M6 content, M7 co-op evaluation.
