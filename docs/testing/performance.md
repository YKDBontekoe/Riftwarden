# Measured performance

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
