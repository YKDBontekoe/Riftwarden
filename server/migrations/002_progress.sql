-- Save v8: Warden levels and the procedural skill tree.
ALTER TABLE profiles
    ADD COLUMN xp bigint NOT NULL DEFAULT 0 CHECK (xp >= 0),
    ADD COLUMN tree_seed bigint NOT NULL DEFAULT 0 CHECK (tree_seed >= 0),
    ADD COLUMN tree_allocated text[] NOT NULL DEFAULT '{}',
    ADD COLUMN respecs integer NOT NULL DEFAULT 0 CHECK (respecs >= 0);

-- Veterans are credited from their service record (same formula as MIGRATIONS[7] in the client save).
UPDATE profiles p SET
    xp = LEAST(5000000,
        COALESCE((SELECT t.kills * 2 + t.bosses_defeated * 250 + t.elites_defeated * 15 FROM profile_totals t WHERE t.player_id = p.player_id), 0)
        + COALESCE((SELECT SUM(r.checkpoints) * 300 FROM profile_tier_records r WHERE r.player_id = p.player_id), 0)
        + cardinality(p.milestones) * 300),
    version = 8
WHERE p.version = 7;
