/** Havok collision filter groups. */
export const PHYS_ENV = 1;
export const PHYS_PLAYER = 2;
/** Raycast query that only considers static level geometry. */
export const ENV_QUERY = { membership: PHYS_ENV, collideWith: PHYS_ENV };
