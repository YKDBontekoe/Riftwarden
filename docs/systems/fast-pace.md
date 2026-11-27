# Fast-pace pass (after M8)

> Moved verbatim from the old root `CLAUDE.md` (2026-11). Quoted section names (e.g. "Loot depth", "Run map") refer to other files in this folder (index: [README.md](README.md)). Test counts are the numbers recorded when the work landed, not current totals.

Goal: high-tempo play (think VOIDBREAKER): fast enemies, little dead time, momentum movement, punchy kills. Measured with
`scripts/playtest.cjs` (bot, tier I, towers): waves 1-8 clear in 20-35 s each with first contact ~2.5-4 s after the call-in
(before: 24-43 s for fewer enemies, 18-30 s prep in between).

- **Tempo** (`waves/pace.ts`): prep 20 s (wave 1) / 12 s, clear celebration 1.6 s, every spawn time x0.72 (hand waves and
  the planner). Calling a wave early (G) pays `2 cores` per whole skipped second (`earlyCallBonus`, alert "EARLY CALL"),
  on top of Rapid Deployment. The upgrade picker keeps the pointer lock: 1/2/3 picks and play resumes at once (Esc frees
  the cursor; clicking a card re-locks inside the gesture).
- **Enemies** ~1.6x faster (`ENEMIES[*].speed`: walker 5.8, rusher 14, bulwark 4.5, ...). Walkers/Bulwarks shoot the drone
  more often (2.0 / 1.8 s, 0.48 s telegraph, bolts 28 / 31 m/s); reactor attack cadence is unchanged. `WalkerMotion`
  shortens the swing and lengthens the stride with ground speed so feet stay planted.
- **Movement** (`Player.MOVE`): run 16.5, sprint 24, dash 50 -> carry 31, gravity 30. Momentum: above the run/sprint
  target and pushing roughly along the velocity, speed bleeds at `overspeedDecel` (26 m/s^2 ground) / `airDrag` (6 m/s^2)
  while steering toward the input, so dash -> jump -> boost chains keep ~30 m/s; releasing the keys still stops in ~0.1 s.
  A grounded dash drops the eye (`slideDip`), carried overspeed widens the FOV (`speedFov`) and adds aberration +
  vignette (`PostFx.speed`, `Game.motionFx`, both off with reduced motion); a dash start kicks the lens. Server
  `MAX_SPEED` = `MOVE.dashSpeed + 4`.
- **Kill feel** (`Game.playerKill`, direct weapon kills): hitstop dilates *hostile* time only (0.045 s x0.2, heavy kills
  0.1 s x0.04; `hitstopEnabled = false` on the co-op server), dash refund (`killDashRefund` 0.3, heavy x2; replicas refund
  on their personal `hit:kill` event), kill chain per Player (`chain`/`chainAt`, 2.5 s window) -> personal `chain` UI event
  -> `KillChain` HUD (x n CHAIN / RAMPAGE 6+ / OVERDRIVE 12+), kill sound pitch rises with the chain.
- **Deaths**: `DEATH_TIME` ~0.4-0.7 s; the kill pops immediately (sparks, debris, small flash) and the wreck is knocked
  away from the last hit's source (`Enemy.hitFromX/Z`, `wreckKnock`, drag 5/s, clamped to the arena). The final burst
  re-reads the wreck position. Ordinary explosions use one star flash at 0.75x size (pairs only from scale >= 1.5) so
  pack fights stay readable.
- **Numbers**: `DamageNumberEvent.target` (enemy id x4096 + spawn gen) merges hits on one target within 0.45 s into one
  rising total that pops per hit and keeps the strongest kind.
- **Heat** (`combat/heat.ts`): heat x0.75, cooling x1.35, cool delay x0.7, full-rate cooling while locked out (was 75%).
  Applied at fire time so existing items get it; `weaponSummary` uses it so terminals show effective heat/cooling.
- **Smoothness**: `Flow.frame` feeds `FrameClock` (steady deltas replace jitter within 20%, debt repaid proportionally,
  1/20 s clamp). Beam endpoint computation is allocation-free.
- **Not done yet**: real-GPU feel check; a dedicated slide key (C is taken by tower refits, Ctrl+W closes tabs); kill
  feel for tower/effect kills; hitstop is not replicated to co-op clients; balance of faster waves on tiers IV-V is untested.
