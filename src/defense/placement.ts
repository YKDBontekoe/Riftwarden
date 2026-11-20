import { distToPolyline } from '../world/geometry';
import type { ArenaLayout } from '../world/layout';

export type PlacementReason =
  | 'ok'
  | 'no-surface'
  | 'bad-surface'
  | 'uneven'
  | 'blocks-route'
  | 'too-close-reactor'
  | 'overlaps-tower'
  | 'obstructed'
  | 'out-of-bounds'
  | 'too-far'
  | 'reserved'
  | 'insufficient-cores';

export const PLACEMENT_MESSAGES: Record<PlacementReason, string> = {
  ok: 'Valid position',
  'no-surface': 'No surface in reach',
  'bad-surface': 'Cannot build on this surface',
  uneven: 'Surface is uneven',
  'blocks-route': 'Would block an enemy lane',
  'too-close-reactor': 'Too close to the reactor',
  'overlaps-tower': 'Overlaps another defense',
  obstructed: 'Obstructed by geometry',
  'out-of-bounds': 'Outside the facility',
  'too-far': 'Out of build range',
  reserved: 'Reserved for facility machinery',
  'insufficient-cores': 'Not enough cores',
};

/** Surface kinds a tower may stand on (tagged on arena meshes as metadata.surface). */
export const BUILDABLE_SURFACES: ReadonlySet<string> = new Set(['floor', 'platform']);

export interface PlacementQuery {
  x: number;
  y: number;
  z: number;
  /** Surface tag of the picked mesh. */
  surface: string;
  normalY: number;
  /** Heights of the highest surface at footprint sample points (from engine downward picks). */
  footprintHeights: readonly number[];
  radius: number;
  playerX: number;
  playerZ: number;
  maxRange: number;
  cores: number;
  cost: number;
  towers: readonly { x: number; z: number; radius: number }[];
}

/** Footprint sample offsets (unit circle); callers scale by radius and pick the engine scene at each. */
export const FOOTPRINT_SAMPLES: readonly [number, number][] = [
  [0, 0],
  ...Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2), Math.sin((i / 8) * Math.PI * 2)] as [number, number]),
];

/**
 * Rules for free-form tower placement. On the classic arena lanes are reserved, so construction can never cut
 * enemies off from the reactor; on procedural (mazing) arenas towers may block lanes and get breached.
 */
export function validatePlacement(layout: ArenaLayout, q: PlacementQuery): PlacementReason {
  if (!BUILDABLE_SURFACES.has(q.surface) || q.normalY < 0.95) return 'bad-surface';
  const lim = layout.half - q.radius - 0.5;
  if (Math.abs(q.x) > lim || Math.abs(q.z) > lim) return 'out-of-bounds';
  const pdx = q.x - q.playerX;
  const pdz = q.z - q.playerZ;
  if (pdx * pdx + pdz * pdz > q.maxRange * q.maxRange) return 'too-far';

  for (const h of q.footprintHeights) {
    if (h > q.y + 0.05) return 'obstructed';
    if (h < q.y - 0.05) return 'uneven';
  }

  const rdx = q.x - layout.reactor.x;
  const rdz = q.z - layout.reactor.z;
  if (rdx * rdx + rdz * rdz < (layout.reactor.radius + 4.5) ** 2) return 'too-close-reactor';

  // Mazing arenas: towers may stand on lanes (enemies re-route or breach); gate mouths and rifts are reserved.
  if (q.y < 0.5 && !layout.mazing) {
    for (const route of Object.values(layout.routes)) {
      if (distToPolyline(q.x, q.z, route.points) < layout.laneHalfWidth + q.radius) return 'blocks-route';
    }
  }

  for (const z of layout.reserved ?? []) {
    if (q.x + q.radius > z.x0 && q.x - q.radius < z.x1 && q.z + q.radius > z.z0 && q.z - q.radius < z.z1) return 'reserved';
  }

  for (const t of q.towers) {
    const minD = t.radius + q.radius + 0.2;
    if ((q.x - t.x) ** 2 + (q.z - t.z) ** 2 < minD * minD) return 'overlaps-tower';
  }

  if (q.cores < q.cost) return 'insufficient-cores';
  return 'ok';
}
