/**
 * Persistent player state (pure module; storage is injected).
 *
 * Format in storage: JSON `{ v: <schema version>, sum: <fnv1a of data json>, data }`.
 * - Unknown/missing fields fall back to safe defaults (sanitizeSave).
 * - A checksum mismatch or unparsable text counts as corrupt: the raw text is kept
 *   under CORRUPT_KEY and the last good backup (BACKUP_KEY) or a fresh save is used.
 * - Older versions are upgraded by MIGRATIONS; newer versions are never downgraded.
 */
export * from './types';
export * from './defaults';
export * from './coerce';
export * from './sanitize';
export * from './migrations';
export * from './codec';
export * from './ownership';
export * from './rules';
export * from './engineering';
