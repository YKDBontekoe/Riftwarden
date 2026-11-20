/** Havok collision filter groups. */
export const PHYS_ENV = 1;
export const PHYS_PLAYER = 2;
/** Invisible containment above the perimeter walls: blocks the drone, ignored by ENV_QUERY rays (LOS, grapple, loot). */
export const PHYS_BOUND = 4;
/** Raycast query that only considers static level geometry. */
export const ENV_QUERY = { membership: PHYS_ENV, collideWith: PHYS_ENV };
