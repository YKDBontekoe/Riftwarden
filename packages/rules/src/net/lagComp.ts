// Lag compensation for co-op shot claims [pure]. A client sees hostiles interpolated ~100 ms behind the newest
// snapshot plus half its round trip, so a hit it claims lies where the target WAS. The server keeps a short trail
// of each target's positions and checks a claim against the closest point of that trail instead of the current
// position plus a speed-based slack (which let fast targets be hit from too far and slow ones not at all).

/** How far back a claim may refer (interpolation delay + a generous one-way latency). */
export const REWIND_S = 0.5;
/** Seconds between recorded samples (the snapshot rate). */
export const SAMPLE_S = 0.05;

export class PositionTrail {
  private t: number[] = [];
  private p: number[] = [];

  /** Record a position at time `now` (drops samples older than the rewind window). */
  push(now: number, x: number, y: number, z: number): void {
    this.t.push(now);
    this.p.push(x, y, z);
    let drop = 0;
    while (drop < this.t.length - 1 && this.t[drop] < now - REWIND_S) drop++;
    if (drop) {
      this.t.splice(0, drop);
      this.p.splice(0, drop * 3);
    }
  }

  get size(): number {
    return this.t.length;
  }

  /** Distance from (x, y, z) to the nearest point of the trail (segments between samples, plus `current`). */
  distance(x: number, y: number, z: number, current: readonly [number, number, number]): number {
    const pts = [...this.p, current[0], current[1], current[2]];
    let best = Infinity;
    for (let i = 0; i + 3 <= pts.length; i += 3) {
      const ax = pts[i], ay = pts[i + 1], az = pts[i + 2];
      if (i + 6 > pts.length) {
        best = Math.min(best, Math.hypot(x - ax, y - ay, z - az));
        break;
      }
      const bx = pts[i + 3], by = pts[i + 4], bz = pts[i + 5];
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const len2 = dx * dx + dy * dy + dz * dz;
      const k = len2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / len2)) : 0;
      best = Math.min(best, Math.hypot(x - (ax + dx * k), y - (ay + dy * k), z - (az + dz * k)));
    }
    return best;
  }
}

/** Correction blending for the client's own drone: small server corrections are spread over `BLEND_S`. */
export const BLEND_S = 0.2;
/** Corrections larger than this snap (teleports, respawns, blinks). */
export const SNAP_M = 6;

/** Share of a pending correction to apply this frame (frame-rate independent, sums to 1 over BLEND_S). */
export function blendStep(dt: number, left: number): number {
  return left <= 0 ? 0 : Math.min(1, dt / left);
}
