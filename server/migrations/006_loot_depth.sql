-- Loot depth: Drone Swarm roll parameters (NULL on other families).
ALTER TABLE profile_weapon_rolls ADD COLUMN IF NOT EXISTS drones integer CHECK (drones BETWEEN 1 AND 12);
ALTER TABLE profile_weapon_rolls ADD COLUMN IF NOT EXISTS seek_cone double precision;
-- Rift shards (Ascended crafting currency).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS shards bigint NOT NULL DEFAULT 0 CHECK (shards >= 0);
-- Hand-made uniques (loot/uniques.ts); NULL = procedural item.
ALTER TABLE profile_items ADD COLUMN IF NOT EXISTS unique_id text;
