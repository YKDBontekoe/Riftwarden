-- Branching run map: resumable map progress on the active run, map records and history paths.
ALTER TABLE profile_active_runs ADD COLUMN IF NOT EXISTS map jsonb;
ALTER TABLE profile_active_runs ADD COLUMN IF NOT EXISTS node_bank integer;
ALTER TABLE profile_tier_records ADD COLUMN IF NOT EXISTS deepest_act bigint NOT NULL DEFAULT 0;
ALTER TABLE profile_tier_records ADD COLUMN IF NOT EXISTS best_nodes bigint NOT NULL DEFAULT 0;
ALTER TABLE profile_tier_records ADD COLUMN IF NOT EXISTS acts_cleared bigint NOT NULL DEFAULT 0;
ALTER TABLE profile_totals ADD COLUMN IF NOT EXISTS nodes_cleared bigint NOT NULL DEFAULT 0;
ALTER TABLE profile_totals ADD COLUMN IF NOT EXISTS acts_cleared bigint NOT NULL DEFAULT 0;
ALTER TABLE profile_run_history ADD COLUMN IF NOT EXISTS act integer;
ALTER TABLE profile_run_history ADD COLUMN IF NOT EXISTS nodes integer;
ALTER TABLE profile_run_history ADD COLUMN IF NOT EXISTS path text[];
