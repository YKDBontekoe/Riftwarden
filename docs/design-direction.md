# Riftwarden design direction (owner Q&A, 2026-11)

Answers from the owner, recorded so every session builds toward the same game. When a choice here conflicts with an older note in CLAUDE.md, this file wins.

## Pillars

- **FPS first.** When the two halves conflict, gunplay and movement win. Towers are a **support layer** (buy time, cover flanks); the player gets most kills.
- **Audience: loot chasers.** Itemisation depth, chase drops and "is this better?" clarity matter most.
- **Run length: player chooses.** Short exits at every checkpoint, plus deep endless for those who want it.
- **Endless only**: no per-run win state. Your best wave measures your build.
- **Stakes stay as they are**: unsecured loot is lost on defeat, 25% XP kept, banking at checkpoints.
- **Lore: light flavour only** (item text, sector names, codex-style text). No campaign, no voice: **alerts stay text + SFX**.
- **Tempo stays fast**: 12 s prep, 20-35 s waves.
- **Solo-first balance**; co-op scales on top. **Browser** is the only target platform.

## Run structure: branching map

- A run is a **branching map**. Each node is a 5-wave segment (= one checkpoint). At each checkpoint: bank, then pick the next node **or extract home** (allowed at every node).
- Node types: normal combat sectors (biomes/factions), elite/boss nodes (harder, better loot), merchant/forge (in-run shop, crafting, upgrade rerolls), events/anomalies (risk/reward, curses, gambles, vaults).
- Between nodes **towers reset** (new arena). Cores carry over.

## Combat kit (build first, after the Game.ts refactor)

- **Two weapons, any family in either slot, instant swap**, heat tracked per weapon (swapping lets the other cool).
- **Abilities: 2 free slots + 1 ultimate.** Types: grenades/throwables, deployables (shield wall, decoy, mini-turret, pylon), movement, ultimates (orbital strike, overdrive, ...). Small abilities run on **cooldowns**; the **ultimate charges from damage dealt**.
- Where abilities come from: a **mix**: the base ability is a loot item (rarity, affixes); the skill tree and run upgrades add modifiers.
- **Movement additions**: slide (needs a free key), grapple, wall-run, ground pound. *(Done: slide + pound on L-Ctrl, grapple on R / middle mouse, wall-run automatic.)*
- **Target TTK ~0.3 s** for a basic walker with a matched weapon (Doom-like trash).
- **Hit feedback is the top complaint.** Strengthen every layer: enemy reaction (stagger), meatier audio and crit dings, hitmarkers/crit pops/kill flashes, sparks/oil sprays. **Robots lose parts when shot** (limbs/armour detach and change behaviour, e.g. a legless walker crawls).

## Elements

- A full system with **six damage types**: kinetic, thermal, electric, cryo, corrosive (shreds armour, DoT), void (pierces shields). Weapons and towers roll elements; **enemies resist or are weak per faction**.

## Loot (M11 and later)

- New families: **Launcher, Drone Swarm, Flamer/Cryo spray**.
- **Hand-made uniques**, **3-4 sets** (one per playstyle: tower, crit, element, tank), **conditional affixes** ("while airborne", "on dash", "after swap"), and a chase tier above Exotic: **Ascended** (an Exotic with an extra perfectly rolled affix and a unique visual; ultra rare).
- Top-end farming: **target farming** (bosses/factions drop specific uniques) and **pinnacle bosses summoned with keys** (keys drop from elites, crafted at the HQ).
- **Deep endless is a soft wall on purpose.** **Paragon** points run alongside endless levels (no cap).
- "Is this an upgrade?": a **build-aware score** that weights the stats your build actually uses.
- **Full trading** between profiles at an HQ trading post. Safeguards: Ascended/pinnacle items are trade-locked, a level/time gate for new profiles, a credit tax.

## Towers and walls

- Towers stay a support layer. **Tower parts drop as loot** (weapon/core/modifier parts with rarity).
- **Cheap, breachable player walls** shape paths (nav cost like towers, cheap repair).
- **Hazards affect towers**: frost slows fire, slag damages.

## Enemies and world

- Next: **faction bosses** (Rime/cryo first), **player hunters** (one stalker per faction **and** greed bounties triggered by hoarding unsecured loot), **mini-bosses** (procedural named elites now, hand-made per faction later).
- Wave intel (composition/mutations) comes from a **scanner upgrade** (gear/tree), not by default.
- **5-6 factions** eventually. New biomes: **orbital station** (low gravity), **ruined city** (vertical), **rift core** (endgame/pinnacle).
- Arenas get **destructible props**, **weather shifts** mid-run and **vertical layouts** (fits grapple/wall-run).

## Progression and economy

- Run upgrades: tag set bonuses, reroll/banish, cursed upgrades, a meta-unlocked pool.
- New sinks: pre-run consumables, a gamble vendor (unidentified items by slot), pinnacle keys. New earned currency: **rift shards** (elites/bosses; Ascended crafting, keys).
- Skill tree: **fixed core + procedural outer rings** (core builds shareable).
- HQ: **firing range** (dummies + DPS readout), **facility bonuses** that matter in runs, **trading post**.
- Co-op: **lobby browser** (public list) on top of codes.

## Presentation

- Keep the current modern industrial style, **refine it**. External assets are allowed if **CC0 only** (Poly Haven, ambientCG, Kenney); quality beats download size.
- Music: **adaptive industrial/synth** with intensity layers.

## Working agreement

- **Refactor `Game.ts` first**, then the combat kit, then loot (M11), map, enemies.
- One milestone per session.
