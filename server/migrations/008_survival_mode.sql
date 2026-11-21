-- Survival mode (no towers, the machines hunt the drone, one life): per-run mode and survival records.
ALTER TABLE profile_active_runs ADD COLUMN IF NOT EXISTS mode text CHECK (mode IS NULL OR mode = 'survival');
ALTER TABLE profile_run_history ADD COLUMN IF NOT EXISTS mode text CHECK (mode IS NULL OR mode = 'survival');
ALTER TABLE profile_tier_records ADD COLUMN IF NOT EXISTS survival_runs bigint NOT NULL DEFAULT 0;
ALTER TABLE profile_tier_records ADD COLUMN IF NOT EXISTS survival_best_wave bigint NOT NULL DEFAULT 0;
ALTER TABLE profile_tier_records ADD COLUMN IF NOT EXISTS survival_best_nodes bigint NOT NULL DEFAULT 0;
