-- The shared Rift War (one row): regions, node liberation/corruption, events, orders, buffs, log, online samples.
CREATE TABLE IF NOT EXISTS war_state (
    id integer PRIMARY KEY CHECK (id = 1),
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
