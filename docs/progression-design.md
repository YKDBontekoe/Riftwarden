# Riftwarden progression design

> Implementation status and the numbers that changed while building are in **§12 Implementation notes** at the end (they win over the earlier proposal numbers).

Goal: progression that **never runs out** and **never sprints**: a steady stream of small wins plus rare, celebrated spikes, with **loot as the main source of power**. Written from the owner Q&A of 2026-11-23. Nothing here is built yet; numbers are first proposals to tune with a simulation test (see "Validation").

## Owner answers (2026-11-23)

| Topic | Answer |
| --- | --- |
| What feels wrong | Power jumps too fast; no long-term goal |
| Horizon | Endless, evenly paced (no "done" point) |
| Reward cadence | Mixed: constant small drips + rare big spikes |
| Main power source | Loot (gear) |
| Spike sources | All of them: rarity climbs too fast, item level jumps, crafting/merchant shortcuts, tree + run upgrades stacking |
| Long-term goals | Tiers beyond V, collection/codex, pinnacle bosses + keys, Rift War regions |
| Difficulty | Player picks the tier; acts/regions get harder on top, **multiplied by the tier** |
| Feel of being strong | All of them: faster kills, build identity, surviving deeper |
| Rarity pacing | **Tier-gated rarity** |
| Crafting / merchant | **Expensive but strong** (a long-term sink, not a shortcut) |
| Skill tree + run upgrades | **Keep as is** |
| Tiers beyond V | **Endless numbered** (Rift Levels) |
| Small drips | Weapon-family mastery; better loot feedback |
| Big spikes | Chase drops, feature unlocks, tier breakthroughs, war victories |
| New players | **Staged unlocks** |
| Unlock trigger | Mixed (Warden level for basics, Rift Level for endgame) on a **visible unlock track** |
| Mastery gives | Small stat bonuses, component unlocks, cosmetic finishes, family perks |
| Item level vs tier | Owner left it to design: **the Rift Level sets the item level** (below) |
| Existing profiles | **Fresh start is fine** (save version bump wipes) |

## Diagnosis: where the speed comes from today

1. **Rarity luck is exponential.** `rollRarity` multiplies rarity *i*'s weight by `luck^i` (capped at luck 4), and luck = source x tier (up to 3.2) x waves (+1.2%/wave). Current odds per drop:

   | Situation | Luck | Epic | Legendary | Exotic |
   | --- | --- | --- | --- | --- |
   | Tier I, wave 1, walker | 1.00 | 2.8% | 0.6% | 0.1% |
   | Tier I, wave 10, wave clear | 1.39 | 5.9% | 1.7% | 0.5% |
   | Tier III, wave 15, elite | 3.57 | 22.3% | **17.1%** | **12.2%** |
   | Tier V, wave 20, plain walker | 3.93 | 23.1% | **19.4%** | **15.3%** |

   By tier III, roughly one drop in three is legendary or exotic, so the top of the ladder is used up within hours.
2. **Item level jumps with the tier.** Tier bonuses of +0/8/18/32/50 levels and wave-based levels mean one tier unlock moves gear ~10-20 levels at once. Affix tiers unlock by level (`maxTierFor`), so this also unlocks top affixes early.
3. **Crafting skips the chase.** A masterwork craft (tier III) guarantees an epic and sometimes a legendary for 420 salvage / 520 credits / 12 components, which a few runs pay for. Merchant stock goes up to epic at your progress level.
4. **Multipliers stack** (gear x tree x run upgrades x forge). The owner keeps the tree and run upgrades as they are, so the fix goes into the loot curve and difficulty, not those systems.
5. **Nothing past tier V.** Tier V unlocks after tier IV wave 20 + a boss; then nothing is left except records.

## 1. Rift Levels: endless difficulty the player picks

- Threat tiers become **Rift Levels** (RL) 1, 2, 3, ... with no cap. RL 1-5 keep the current I-V numbers (names stay as labels: Standard ... Apex); beyond RL 5:
  - hostile HP x**1.17** per level, damage x**1.08** per level, budget +3% per level (capped at the spawn cap: surplus becomes HP as today), elite rate +4% per level, max mods 3 (4 from RL 15).
  - boss first wave stays at 6; `bossPower` +5% per level.
- **Unlocking**: RL N+1 unlocks when you **clear an act boss on RL N** (map runs) or reach wave 15 on RL N (classic). RL 1-2 also unlock at the first checkpoint, as today, so new players are not stuck.
- **Acts and regions multiply on top** (owner: "the player picks a tier, acts get tougher, multiplied by the tier"): `effective = RL scaling x actEffect(act) x region difficulty`. The current act effect (+8% HP, +5% damage per act) stays; the Rift War adds a per-region factor (+6% HP per unlocked region index), so later regions are harder **at every RL**.
- **Recommended RL**: the deploy terminal shows a "recommended" RL from the loadout score vs the RL's expected wave-10 HP pool (the intel threat math already exists in `runmap/intel.ts`). Players can go higher: higher RL = better drops, so pushing is the reward.
- Records per RL (the existing per-tier records extend naturally); a **best Rift Level** headline replaces "best tier".

## 2. Item level comes from the Rift Level

`itemLevel = 10 x RL + min(5, floor(wave / 10)) + act - 1 + sourceBonus + jitter(-1..+1)`

- One RL step = +10 item levels: a clear, predictable gear tier. Waves and acts add at most ~+8, so one lucky deep run cannot jump ahead.
- `flatScale` and affix tier unlocks keep working on item level; enemy HP growth per RL (x1.17) is slightly faster than item power per 10 levels (~x1.1 from flat scaling + affix tiers), so **gear alone does not keep pace forever**: rarity, uniques, sets, ascension and mastery close the gap. That is the soft wall the design doc asks for ("deep endless is a soft wall on purpose").
- Optional floor: drops never roll below `10 x (RL - 1)`, so dropping a level for farming still gives usable gear.

## 3. Tier-gated rarity

Replace `luck^index` with a **per-RL odds table** in which luck only moves weight between rarities that the RL has already unlocked, capped at x2.

| Rarity | Can drop from | Odds per ordinary drop at its first RL | ... at RL +10 | Ceiling |
| --- | --- | --- | --- | --- |
| Rare | RL 1 | 8% | 12% | 15% |
| Epic | RL 1 (bosses only on RL 1-2) | 1.5% (RL 3) | 5% | 8% |
| Legendary | RL 4 (bosses / caches from RL 3) | 0.4% | 1.5% | 3% |
| Exotic | RL 8 | 0.08% | 0.4% | 1% |
| Ascended | RL 12 (promotion of an exotic, as today) | 1 in 20 exotics | 1 in 10 | 1 in 8 |

- Sources keep a **floor** (boss = epic, checkpoint/elite cache = rare) and luck, but luck now multiplies only the next unlocked step and is capped (x2), so a tier V boss is exciting without being a legendary fountain.
- **Bad-luck protection** stays hidden and small: each ordinary drop without a legendary+ (once legendary is unlocked) raises its chance by 1% of the base, reset on a hit. This cuts the long tail without changing the average much.
- Uniques keep target farming (seed-decided), but each unique gets a **minimum RL** (boss uniques RL 4+, faction uniques RL 6+, Ninth Gate RL 8+).

Rough targets for an average player (to check with the simulation): first epic in the first hour, first legendary around **4-6 h**, first exotic around **15-25 h**, first ascended around **40-60 h**, after which uniques, sets, ascension and mastery carry the chase.

## 4. Crafting and the merchant: expensive but strong

- **Fabrication stays strong** (it is the targeted way to get a slot/family), but costs scale with the RL whose loot pool you craft from and need the currency that is gated by progress:
  - Craft level = `10 x highest cleared RL`, the same as drops.
  - Grades: standard / refined / superior as today (prices x `rlFactor = 1 + 0.25 x (RL - 1)`); **masterwork** (epic, 15% legendary) adds **rift shards** (6 + RL); a new **apex** grade (legendary guaranteed, unlocks at RL 8) costs 40 shards + 2x masterwork materials.
  - **Escalation per rotation**: each craft at superior or above in the same market rotation costs +25% more (reset on rotation), so crafting is a regular sink, not a farm.
- **Merchant**: stock rarity follows the RL gates (max one grade below your highest unlocked rarity), prices x `rlFactor`; the featured slot can hold a legendary only from RL 6.
- **Engineering** (rerolls, enhance, ascension) stays as is; it improves what you already found, which is the right job for it.
- Exotics and uniques are still never craftable.

## 5. Staged feature unlocks (visible unlock track)

A new **Unlock Track** on the Command Console (and a compact strip in the HQ HUD) always shows the next three goals with their condition. Basics unlock with **Warden level**, endgame systems with **Rift Level**:

| Unlock | Trigger |
| --- | --- |
| Plasma family, Frag Charge, Sentinel towers, storage, deploy | start |
| Second ability slot | Warden 2 |
| Railgun family | Warden 3 |
| Secondary weapon slot | Warden 4 |
| Exchange merchant, reclamation | Warden 5 |
| Beam family, ultimate slot | Warden 7 |
| Neural Lattice (skill tree) | Warden 8 |
| Fabricator (standard/refined) | Warden 10 |
| Drone Swarm family | Warden 12 |
| Module broker + weapon modules | RL 3 |
| Tower tech research, elite nodes | RL 3 |
| Superior crafting, affix engineering | RL 4 |
| Forge hubs, vaults on the map | RL 5 |
| Masterwork crafting, enhancement past +6 | RL 6 |
| Pinnacle keys + pinnacle bosses | RL 8 |
| Ascension at the workshop | RL 12 |
| Apex crafting | RL 8 |

- Drops respect the unlocked set: no items for families or slots you can't use yet land in storage.
- Every unlock is a **celebrated moment** (full-width banner, sound, the station lights up in the HQ, tutorial card for the new system).

## 6. Small drips

### Weapon-family mastery
- Each family (plasma, rail, beam, swarm, later launcher/flamer) has **mastery XP** from damage dealt and kills with it (banked like Warden XP: lost unsecured share on defeat follows the same 25% rule).
- **Ranks 1-50** (`xp(r) = 300 + 90 x r`), ~1 rank per 1-2 runs at first, slowing down.
- Rewards:
  - **+0.5% damage per rank** with that family, soft-capped toward +15% (same soft-cap curve as the tree).
  - **Component unlocks**: some barrels/cores/mechanisms only roll (and craft) after rank 5/10/20 of their family (for example the rail `cycle` mechanism at rank 5, prism core at 20).
  - **Cosmetic finishes** at ranks 10/20/30/40/50 (applied through the existing finish system) and a family title.
  - **Family perks** every 5 ranks: pick 1 of 2 small rules (rail: keep charge on swap / +1 pierce on full charge; plasma: last bolt of a magazine-heat cycle crits / +10% bolt speed; beam: ramp kept 0.5 s after losing the target / +15% width; swarm: +1 drone at full lock / seekers re-target once). Perks are respeccable for free.
- HUD: a thin mastery bar on the weapon card that fills during a run ("+340 PLASMA MASTERY").

### Better loot feedback
- **Build-aware upgrade score** (already on the roadmap): weights each stat by how much the current build uses it; drives the pickup prompt, the item card verdict and an "UPGRADE" beam pulse on the floor.
- **NEW BEST** tag the first time an item beats every owned item in a slot (per family for weapons), with a distinct chime.
- **Run loot recap**: on the summary screen, the 3 best finds with their verdicts, and "+N% power since last run".
- Pickup prompt shows the item level against your RL baseline ("+3 above RL") so higher-level drops feel good even at the same rarity.

## 7. Big spikes

- **Chase drops**: uniques, sets (M11) and Ascended, each with a **codex** (HQ Archive station): silhouettes of undiscovered items with their source hint; completion bars per category; the first find of each entry gives a one-time shard bonus and a banner.
- **Tier breakthroughs**: every **5th Rift Level** cleared (RL 5, 10, 15, ...) gives a breakthrough: guaranteed cache (one rarity above the RL's normal ceiling), a title, and the next unlock on the track.
- **Pinnacle bosses** (RL 8+): keys drop from elites (1-2% each at RL 8, rising slowly) or are crafted from 20 shards at the HQ; one key = one pinnacle node on the war map. Pinnacle drops: guaranteed legendary, pinnacle-exclusive uniques, a high ascended chance.
- **War victories**: when a Rift War region is liberated, everyone who secured at least one sector there gets a **region cache** at their next HQ visit (scaled to their own RL) and the region's codex page; the next region (harder at every RL) unlocks for everyone.

## 8. Not changed (owner: keep as is)

- Skill tree (Warden levels, rings, keystones) and run upgrades, forge stacks.
- Stakes: unsecured loot lost on defeat, 25% XP kept, banking at checkpoints.
- Tempo: 12 s prep, 20-35 s waves.

## 9. Fresh start

The owner accepts a wipe. Bump the save version with a migration that resets progress (`items`, resources, records, progress, market) while keeping settings and the profile id; PostgreSQL gets a matching migration that resets profile rows. The War state is not reset (it is shared, not per player).

## 10. Build order (phases)

1. **Loot curve**: Rift Levels (endless tiers, unlock rule, deploy terminal picker, records), item level from RL, gated rarity table + bad-luck protection, unique minimum RLs, save version bump (wipe). Simulation test for the time-to-first-X targets.
2. **Sinks**: crafting/merchant cost scaling, masterwork/apex grades, rotation escalation.
3. **Unlock track**: gate data table, Command Console track + HQ strip, unlock banners, drops respect locked families.
4. **Mastery**: XP + ranks + damage bonus + component gates + finishes + perks, weapon card bar.
5. **Feedback**: build-aware score, NEW BEST, run loot recap.
6. **Spikes**: codex station, breakthroughs, pinnacle keys + bosses, war victory caches.

## Validation

- A pure **progression simulation** (`tests/progression-sim.test.ts`): a modelled player who clears N waves per run at the recommended RL, collects drops with the real `rollDrops`, banks with the real ledger, crafts with the real costs and climbs RL when its loadout score allows. It asserts the targets above (first legendary 4-6 h, first exotic 15-25 h, RL reached after 10/50/100 h) so later tuning cannot silently speed things up again.
- Odds tables tested per RL (sum to 1, monotone in RL, gates respected).

## 11. Second round decisions (2026-11-23)

### Infinite skill tree
- Owner: **the skill tree is infinite.** Rings are already generated per profile without limit (one per 5 levels); this makes sure every one stays worth taking:
  - Every Warden level keeps giving 1 point forever; rings keep revealing forever (no last ring).
  - The per-stat soft cap (`cap x (1 - e^(-sum/cap))`) stays, but its cap **grows slowly with the ring** (+2% of the ring-1 cap per ring), so deep nodes never become worthless while one stat still cannot run away.
  - Deep rings lean on **notables and keystones** (choices) more than minors: from ring 20 one keystone every 2 rings, from ring 40 notables take half the slots.
  - Level curve unchanged (`400 + 220(L-1) + 6(L-1)^2`), so points arrive more slowly the deeper you go: the tree is the endless drip next to mastery.
  - UI: the Neural Lattice must handle hundreds of nodes (ring culling outside the view, search by stat, "jump to frontier", allocated-path highlight).
  - Tests: ring 500 generation stays finite and fast; the growing cap stays bounded per ring.

### Step-up nodes on the run map
- Owner: **yes.** The run starts at the picked RL; the map can offer **Rift Surge** nodes that raise the RL by +1 for **the rest of the run** (towers, enemies, item level and rarity gates follow the new RL from the next node on).
  - Appear from act 2, at most one per act, never on the act-boss row; the node card shows the new RL and its loot gates ("Legendary unlocks at RL 4").
  - Clearing a step-up node counts as progress toward unlocking that RL (clearing an act boss at a raised RL unlocks it, as if deployed there).
  - Rewards: the node itself gives +1 shard and an extra cache; afterwards the run simply has better loot and harder fights.
  - Co-op: part of the map vote like any node; the lobby's RL is the starting point.
  - Records: the run's best RL is recorded separately from the deploy RL.

### Seasons + permanent ladder
- Owner: **both.** Like seasonal vs eternal realms:
  - **Permanent** profile: never resets; everything in this doc applies.
  - **Seasonal** profile (opt-in at the HQ, a second profile slot per account): starts fresh each season (**1 month**), own Rift Level ladder, own leaderboards (highest RL cleared, fastest act-boss clear per RL, deepest wave per RL; solo and co-op boards).
  - At season end the seasonal profile's gear, resources and records **move into the permanent profile** (storage overflow goes to a claimable "season cargo" bay), Warden XP and mastery XP are added; seasonal leaderboards are archived.
  - Season rewards: cosmetic finishes, titles, a codex page per season; a **season journey** (10-20 goals such as "clear RL 10", "liberate a region", "find 5 uniques") with cosmetic rewards.
  - Each season can add one **season rule** (for example "elites drop keys twice as often") to keep it fresh; permanent never gets season rules.
  - The Rift War stays shared by both (it is not per profile); seasonal and permanent players fight the same war.
  - Needs: profile namespace per season in sync (`SyncJournal` already keys by namespace), PostgreSQL `season` column + leaderboard tables, gateway endpoints for boards.

### Mastery team bonus in co-op
- Owner: **personal mastery plus a team bonus.**
  - Each player keeps their own mastery XP and ranks.
  - **Squad mastery XP**: +10% mastery XP per other warden in the operation (max +30%).
  - **Shared family bonus**: when two or more wardens use the same family, all of them get +2% damage with it (+3% for three, +4% for four), shown on the team HUD.
  - **Mastery aura**: each family perk tier you have reached (every 5 ranks) gives teammates using that family +0.2% damage, capped at +3% per family, so a veteran helps newer players.

### Third round decisions (2026-11-23)
- **Codex teasers: yes.** Locked families, abilities and systems show in the codex (and on the unlock track) as dark silhouettes with their unlock condition ("Railgun: Warden level 3").
- **Season length: 1 month.** A month is short, so the season journey has ~12 goals sized for ~20-30 h of play, and the seasonal Rift Level ladder climbs faster than permanent (RL unlock needs an act boss **or** wave 10 instead of 15). Season rules rotate monthly from a small list; the first rule is still to be picked (proposed: "Elites drop pinnacle keys twice as often").
- **Solo leaderboards list only server-validated runs.** Co-op runs (simulated by the server) are trusted. Solo runs get a "validated" flag only when `runCheck.ts` accepts them; until combat replay exists, solo boards additionally require the run's records to fall inside server-side plausibility ceilings (kills/s, damage per item level, wave time). Runs that fail stay on the profile but not on the boards.

Build order addition: phase 4 (mastery) includes the co-op team bonus; infinite-tree work goes with phase 3 (unlock track); step-up nodes go into phase 1 (they need Rift Levels); seasons + leaderboards become **phase 7**, after the spikes.

## 12. Implementation notes (what was built; these numbers win)

The pacing simulation (`tests/progression-sim.test.ts`: real wave composer + drop tables, ~700 drops per hour, a modelled
player who climbs once their gear matches the next level) drove these changes from the first proposal:

- **Difficulty curve** (`tiers.ts`): every level, the named five included, follows the item power curve of its own drops:
  hull = `itemScale(levelBase(RL)) x 1.05^(RL-1)`, damage = `itemScale(levelBase(RL)) x 1.03^(RL-1)`. With the proposal's
  fixed +17% per level, gear (10 item levels per RL, quadratic flat stats) outran enemies until ~RL 30.
- **Unlocking**: RL n+1 needs `min(8, 1 + floor(n / 2))` checkpoints secured *on RL n* (a progress bar in the deploy
  terminal), counted on the level the run plays at (Rift Surges count on the surged level).
- **Item level**: `10 x (RL - 1) + 1` at wave 1, up to +9 by wave (`lootLevel`), so the deepest band of one level meets
  the first wave of the next.
- **Rarity gates** (`loot/rarity.ts` `RARITY_UNLOCK`, `GATED`): epic RL 3 (0.6% rising to 6%), legendary RL 7 (0.04%
  rising to 2%), exotic RL 12 (0.001% rising to 0.6%), Ascended promotion of exotics from RL 14 (1 in 10, 1 in 5 from
  RL 19). Luck is `luck^(0.5 x rarity index)`, capped at x3. Bosses and caches open epics one level early (never
  legendary/exotic). Boss floors are rare (not epic). Bad-luck protection: +1% of the legendary/exotic weight per dry
  drop (cap x3), journaled per roll and replayed by the server.
- **Measured pacing** (median of 5 simulated players): first epic ~0.4 h, first legendary ~1.5 h, first exotic ~11 h,
  first Ascended ~70 h; RL 9 at ~2 h, RL 12 at ~5.5 h, RL 15 at ~23 h, RL 18 at ~55 h, RL 21 at ~85 h (no plateau).
- **Uniques** respect the gates (legendary uniques from RL 7, exotic ones from RL 12) and the family locks.
- **Rift Surge**: after 2 cleared map nodes, then every 3; travel to a combat/elite sector at +1 RL for the rest of the
  run; map entries are validated (one node and at most one surge per entry) so loot of forged levels is refused.
- **Crafting**: superior RL 3, masterwork RL 7 (+6 shards), apex RL 10 (legendary, +40 shards); shards +1 per 20 item
  levels; +25% per heavy craft in a market rotation (cap x4). HQ merchants never exceed the level's own drop ceiling
  (featured legendary from RL 9); map merchants no epics before RL 3.
- **Unlock track** (`progression/unlocks.ts`): Warden 2 ability II + Exchange, 3 Railgun + Reclamation, 4 secondary
  weapon, 5 accessory II, 6 Beam, 7 ultimate slot, 8 Neural Lattice, 10 Fabricator, 12 Drone Swarm, 14 HQ
  construction; RL 2 enhancement, RL 3 modules + tower research, RL 4 affixes, RL 5 component refits, RL 7 legendary,
  RL 12 exotic, RL 14 ascension. Locked families/categories never drop (loot locks are recorded at run start and
  replayed by the server), locked ops/stations/slots refuse with the reason. Single-item scrap in storage is always open.
- **Infinite tree**: node values +15%/ring to ring 10 then +5%/ring; per-stat soft cap x(1 + 3% per ring of the
  deepest allocation); keystone every 2 rings from ring 20, half notables from ring 40; 2001 rings (level cap);
  keystone rules clamped (XP x3, 600 start cores). The lattice view culls, zooms deeper, searches and jumps to the frontier.
- **Fresh start**: save v11 (`MIGRATIONS[10]`) rebuilds a default profile deterministically from the old document's id
  and times (identity, callsign, tutorial kept); the deploy terminal explains it once.
- **Automation**: `?test` keeps every unlock open (`setUnlockAll`); `?test&locks` uses the real track.
- **Mastery** (as proposed): XP per weapon kill (normal 6, elite 30, HVT 120, boss 300); ranks 1-50 with
  `xp(r) = 300 + 90r`; +0.5%/rank damage soft-capped toward 15% (+12% at 50); components unlock at ranks 5/10/20 (scatter
  choke / cycler / pulse / salvo, long shroud / quad rails / resonator rings / hive cluster, prism core); finishes at
  10/20/30/40/50; perks every 5 ranks (pairs per family, +10%/tier, free to change). Co-op: +10% XP per other warden
  (max +30%), +1% damage per warden sharing the family (from 2), aura +0.2% per teammate perk tier (cap 3%).
- **Loot feedback**: 'My build' priority is the default; NEW BEST compares item power per kind (weapons per family).
- **Spikes**: codex 24 entries (4 families, 5 rarities, 15 uniques; first-find shards 1-10); breakthroughs at RL
  5/10/15...; pinnacle keys from RL 8 (1.2% + 0.6%/modifier per elite, or 20 shards), pinnacle run = boss on wave 1,
  +50% hull, +30% luck, 2 legendary-floor rolls; war caches = item at the unlocked level + shards.
- **Seasons**: calendar months from November 2026; rules rotate Key Rush / Mastery Fever / Bountiful Rift / Rapid
  Climb; seasonal ladder needs one checkpoint fewer (two under Rapid Climb); 12-goal journey (titles at 6 and 12);
  rollover on the first load after the month ends; boards = top 50 by RL or deepest wave, seasonal and all time.
