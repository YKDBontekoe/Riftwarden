# Measured performance

## Performance overhaul (2026-11), before / after

`scripts/bench-perf.cjs` and `scripts/bench-coop.mjs` (see [`README.md`](README.md)), run on the commit before the
overhaul (`88c0d92`) and after it with the same scripts, headless Chromium + SwiftShader on the cloud container, low
preset, 1280x720. Combat rows are the median of two runs (worst step: the worst of both). **sim** = one fixed 60 Hz
simulation step (CPU, representative up to the CPU difference); **frame** = step + `scene.render()` in software GL
(not representative of a GPU). Draw calls and active meshes are averaged over every rendered frame.

| Scenario | Metric | Before | After |
| --- | --- | --- | --- |
| early (wave 2, 9 enemies) | sim p50 / p99 / p99.9 (ms) | 2.4 / 8.8 / 19 | 0.5 / 2.6 / 7.3 |
| late (wave 30, 120 enemies, 12 towers, 14 upgrades, firing) | sim p50 / p99 / p99.9 (ms) | 7.3 / 34.7 / 431 | 2.3 / 13.0 / 43.1 |
| late | worst step (ms) | 687 | 45.5 |
| extreme (wave 40, 250-261 enemies) | sim p50 / p99 / p99.9 (ms) | 11.7 / 69.3 / 711 | 3.3 / 13.7 / 22.9 |
| extreme | worst step (ms) | 1520 | 37.3 |
| extreme | frame p50 / p99 (ms, software GL) | 126-133 / 1633-1865 | 103-119 / 163-181 |
| loot (64 pickups + 40 enemies) | sim p50 / p99 (ms) | 3.8 / 11.4 | 1.1 / 5.5 |
| extended (20 simulated min, 80 enemies) | sim p50 / p99 / worst (ms) | 4.8 / 19.0 / 220 | 0.8 / 3.8 / 19.4 |
| extended | steps over 40 ms | 10 (AI up to 78 ms) | 0 |
| extended | JS heap every 2 min (MB, no forced GC) | 360 -> 560, climbing | 286 -> 350-400, flat after 2 min |
| extended | meshes after the pools filled | 9748, flat | 9547, flat |
| extreme | shader variants first compiled mid-fight | 16-18 | 4-5 |
| late | shader variants first compiled mid-fight | 2 | 7-10 |
| co-op 2 players, 120 enemies (server) | tick p50 / p99 / max (ms) | 1.00 / 5.92 / 26.7 | 0.74 / 3.89 / 9.5 |
| co-op 4 players, 200 enemies (server) | tick p50 / p99 / max (ms) | 1.87 / 7.55 / 19.5 | 1.34 / 6.60 / 19.6 |
| co-op | snapshot bytes per player (avg / max), traffic per player | 7.8 KB / 15.2 KB, 205 KB/s (2p) | unchanged (no wire change) |

- Draw calls are unchanged where comparable (early 201/201, extreme 542/544, loot 729/697). In **late** the old code
  averaged 161 draws, but only when that scenario is the second arena of the browser session; run as the first arena
  it draws 467 (new: 499) at equal active meshes (4362 / 4462), and the new code has fewer active meshes still waiting
  for a shader (53 vs 90). The 161 is an artefact of the old code's session history, not a saving the overhaul lost.
- Mid-fight shader variants: in **late** (second arena of the session) the new code compiles more (7-10 vs 2): first
  drops of new loot bases and weapon-swap viewmodel parts still build lazily (listed under "Not done yet" in the
  system note); the old code's count there has the same session-history caveat as its draw calls.
- The heap growth before was most likely Babylon's log cache: a per-frame warning (walker shield `visibility` on an
  instance) is prepended to `Logger._LogCache`, one ever-growing string, every frame.
- Render frames of several seconds remain in software GL when SwiftShader fails the known hit-flash PBR variant and
  falls back (e2e-m1 "Z"); not a GPU behaviour.
- Biggest single costs found before (late fight, CPU profile): triangle picks against the merged level shells
  (crosshair inspect every frame ~2 ms/step, shots, HUD aim), the shield warning (5% of all JS), material dirty scans
  from scorch fades and loot materials, pick predicates over every mesh, all agents re-planning in one frame, and
  shader compiles of pooled effects on first use. Details: [`../systems/performance.md`](../systems/performance.md).

## Earlier measurements

> Measured (headless SwiftShader, so GPU numbers are not representative). Re-measure on a real GPU with F3 before drawing conclusions.

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

- M6 (headless SwiftShader, `e2e-m6` J): 42 enemies incl. elites + Siege Colossus, 8 towers, 14 upgrades, instability hazards, drone firing: simulation p50 1.9 ms / p95 8.9 ms per frame, AI ~1.0 ms; rare 100-250 ms frames also occur with plain M5 content in this environment (GC), so assertions use p50/p95. 340 draw calls; render ~48 ms/frame in software GL (not representative). Ordnance/telegraph pools peaked at 5 / 22. Production app chunk 677 kB (225 kB gzip).
