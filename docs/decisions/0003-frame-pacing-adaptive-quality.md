# 0003. Variable-step client frames with adaptive quality

- Status: Accepted
- Date: 2026-11-27
- Deciders: session (performance overhaul)

## Context

The overhaul asked for consistent frame pacing at 60-144 Hz, frame-rate-independent gameplay and graceful degradation
in heavy fights. The client runs one variable simulation step per rendered frame (jitter-filtered by `FrameClock`,
clamped at 1/20 s); the co-op server already runs fixed 60 Hz steps and replicas interpolate 100 ms behind. Profiling
(`docs/testing/performance.md`) showed the stutter came from specific CPU hotspots and mid-fight shader compiles, not
from the loop structure.

## Options

1. Fixed-step simulation with render interpolation on the client: classic, but every rendered transform (enemy rigs,
   drone, camera, projectiles, effects, towers) would need a previous/current pose and interpolation, the camera would
   show a pose up to one step old (more input latency), and every system's update order would change.
2. Keep variable steps, make every per-frame rate `dt`-correct, remove the measured hitches, and add an adaptive
   quality controller that sheds cosmetic cost under sustained overload.

## Decision

Option 2: it fixes the measured causes with the lowest input latency and without rewriting presentation.

## Consequences

- New per-frame smoothing or random chances must scale with `dt` (`docs/systems/performance.md`, Frame loop).
- Adaptive quality changes only cosmetic density and render resolution, with hysteresis, never gameplay visuals.
- If a future system needs determinism across frame rates on the client (e.g. client-side prediction of hostiles), a
  fixed-step sub-loop for that system is the follow-up, not a global loop change.
