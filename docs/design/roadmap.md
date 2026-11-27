# Milestones and roadmap

## Milestones

- **M0 (done):** arena, movement, plasma repeater, Sentinel turret + placement, tactical mode, walker + rush drone (+ Bulwark elite), 3 hand waves + endless generator, HUD/menus, restart.
- **M1 (done):** explorable HQ with interactive stations, deployment with threat tiers I-III, 5-wave checkpoints with automatic banking and continue/return choice, defeat/abandon handling, versioned persistent save (records, salvage, loadout, storage, placeables), repeated scene transitions without leaks.
- **M2 (done):** procedural loot (6 rarities, 20 affixes, 19 bases over 7 categories, seeded generator, level scaling), drop tables per source incl. elite/target-farm and checkpoint cache, physical pickups with lifetime rules, run cargo + prep-only equipping, functional armor/shield/reactor/processor/accessory stats, comparison UI, banking/loss/ownership rules, HQ storage (scrap, expansion sink), presets, module drops (stored), save v2 migration.
- **M3 (done):** three weapon families with distinct mechanics/effects/sound, procedural components baked into rolls, procedural first-person models with mechanical animation and heat visuals, 8 functional module types in rarity-based typed sockets, HQ weapon engineering (install/remove/transfer for salvage) with live 3D inspection, save v3 migration.
- **M4 (done):** credits + advanced components, equipment exchange and module broker with persisted rotating stock and material exchange, reclamation press with batch dismantling and item locks, affix recalibration with locks and escalation, enhancement, component refits, fabrication recipes with quality grades, two new HQ rooms with live station displays, transactional saves with rollback, save v4.
- **M5 (done):** see the M5 section.
- **M7:** 2-4 player co-op with an authoritative server, HQ construction with blueprints, new firing styles/towers/enemies/upgrades/signatures, onboarding, settings v2, spatial audio.
- **M6 (done):** survival director (budgets, themes, seeded plans), Shielded Enforcer / Artillery Drone / Support Engineer / Vault Courier, four elite modifiers with combinations, four dynamic events, two arena evolutions, Siege Colossus and Overseer Core bosses with dynamic scheduling, tiers IV-V with unlock rules, boss/elite/event/HVT loot (target farming), survival records + milestones (save v6), run summaries, F4 dev lab, shader/pool pre-warming.
- **M8 (done):** Warden levels (XP banked like loot), per-profile procedural skill tree at the Neural Lattice, currency table + tooltips, station purposes and directory, save v8.
- **M9 (done):** procedural arenas with districts, nav-grid mazing with breachable towers, forward rifts, loading screens.
- **M10 (done):** biomes with factions and hazards, six mutations, four faction archetypes.
- **Game.ts refactor (done):** PlayerCombat + shotTrace, LootPickups, TowerControl, wave lifecycle out of the constructor.
- **Combat kit (done):** second weapon slot (save v9), shoot-off parts, abilities + ultimates as loot (save v10, protocol v9), movement kit (protocol v10), TTK pass, hit feedback, deployables + ability modifiers + co-op ability fixes, wheel swap.
- **Elements (done):** six damage types on weapons and tower cores, faction/boss affinities, corrode, void pierce.
- **M11 loot depth, part 1 (done):** Drone Swarm family, Ascended tier + rift shards (ascension at the workshop), 15 hand-made uniques with target farming. Next: the rest of M11.
- **Branching run map (done):** endless seeded acts, eight node kinds, node modifiers, act bosses + chests, curses/blessings, hub stations, carry + tower refund, node banking, resume, map records + codex, co-op map votes with server-side travel (protocol v11).

## Roadmap (owner-approved order; details and rationale in `docs/design/design-direction.md`)

1. **Combat kit (finish)**
   - Movement: done (slide, ground pound, wall-run, grapple). Follow-ups: movement modifiers from skill tree / run upgrades / affixes (grapple cooldown, pound power), grapple onto enemies (pull small ones), replicate grapple lines in co-op, slide viewmodel pose, real-GPU feel check. Vertical arenas come later (step 5).
   - Done: TTK pass, hit feedback (audio, kill flash, oil, legs + crawling), ability modifiers, deployables, co-op ability replication, wheel swap. Later: swap-triggered affixes (M11 conditional affixes), more deployables (pylon), real-GPU feel check.
2. **Elements (done)**: six damage types (kinetic, thermal, electric, cryo, corrosive = armour shred + DoT, void = pierces shields) rolled on weapons and towers; per-faction resistances / weaknesses.
3. **M11 loot depth** (part 1 done: Drone Swarm, Ascended + rift shards, 15 uniques): Launcher and Flamer/Cryo-spray weapon families; more uniques; 3-4 sets (tower, crit, element, tank); conditional affixes ("while airborne", "on dash", "after swap"); build-aware "is this an upgrade?" score; more target farming; pinnacle bosses summoned with keys (keys from elites, crafted at HQ); tower parts as loot; full trading at an HQ trading post (Ascended/pinnacle trade-locked, level/time gate, credit tax; live lobby trades done, async listings not yet).
4. **Branching run map (done)**: a node per 5-wave segment (combat sectors, elite/boss nodes, merchant/forge, events/anomalies); bank + choose next node or extract at every node; towers reset between nodes, cores carry over.
5. **Enemies and world**: faction bosses (Rime/cryo first), player hunters (one stalker per faction + greed bounties for hoarded unsecured loot), mini-bosses (procedural named elites, later hand-made), wave intel via a scanner upgrade, 5-6 factions, biomes (orbital station with low gravity, ruined city vertical, rift core endgame), destructible props, weather shifts, vertical arenas.
6. **Towers support layer**: cheap breachable player walls, hazards affect towers (frost slows fire, slag damages).
7. **Progression and economy**: upgrade tag set bonuses, reroll/banish, cursed upgrades, meta-unlocked upgrade pool; consumables, gamble vendor; fixed core + procedural outer rings for the skill tree; paragon alongside endless levels.
8. **HQ, co-op, presentation**: firing range with DPS readout (done), facility bonuses, lobby browser (done: open-squad list), adaptive industrial/synth music, art refinement with CC0 assets (Poly Haven, ambientCG, Kenney).
- Ongoing: remaining Game.ts extractions (upgrade flow, summon/ordnance, publishHud/snapshot, constructor scene setup), Terminals.tsx/items.tsx split, deep-import bundle split, team HUD levels, deeper keystone rules.
