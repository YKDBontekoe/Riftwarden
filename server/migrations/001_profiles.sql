CREATE TABLE profiles (
    player_id text PRIMARY KEY,
    revision integer NOT NULL DEFAULT 0,
    version integer NOT NULL,
    save_id text NOT NULL,
    callsign text NOT NULL,
    created_at bigint NOT NULL,
    last_saved_at bigint NOT NULL,
    salvage bigint NOT NULL CHECK (salvage >= 0),
    credits bigint NOT NULL CHECK (credits >= 0),
    components bigint NOT NULL CHECK (components >= 0),
    storage_capacity integer NOT NULL,
    storage_expansions integer NOT NULL,
    selected_tier integer NOT NULL CHECK (selected_tier > 0),
    unlocked_tier integer NOT NULL CHECK (unlocked_tier >= selected_tier),
    layout_version integer NOT NULL,
    tutorial_skipped boolean NOT NULL,
    market_rotation bigint NOT NULL,
    market_generated_at bigint NOT NULL,
    market_refreshes bigint NOT NULL,
    crafts bigint NOT NULL,
    milestones text[] NOT NULL,
    facilities text[] NOT NULL,
    blueprints text[] NOT NULL,
    tutorial_steps text[] NOT NULL,
    tower_unlocks text[] NOT NULL,
    transaction_ids text[] NOT NULL
);

CREATE TABLE profile_totals (
    player_id text PRIMARY KEY REFERENCES profiles ON DELETE CASCADE,
    runs bigint NOT NULL,
    returned bigint NOT NULL,
    defeated bigint NOT NULL,
    abandoned bigint NOT NULL,
    interrupted bigint NOT NULL,
    kills bigint NOT NULL,
    salvage_secured bigint NOT NULL,
    items_secured bigint NOT NULL,
    items_lost bigint NOT NULL,
    items_scrapped bigint NOT NULL,
    best_rarity integer NOT NULL,
    bosses_defeated bigint NOT NULL,
    elites_defeated bigint NOT NULL,
    deaths bigint NOT NULL,
    player_damage double precision NOT NULL,
    tower_damage double precision NOT NULL,
    reactor_damage double precision NOT NULL,
    dev_runs bigint NOT NULL
);

CREATE TABLE profile_economy_stats (
    player_id text PRIMARY KEY REFERENCES profiles ON DELETE CASCADE,
    credits_earned bigint NOT NULL,
    credits_spent bigint NOT NULL,
    items_bought bigint NOT NULL,
    items_sold bigint NOT NULL,
    items_dismantled bigint NOT NULL,
    items_crafted bigint NOT NULL,
    rerolls bigint NOT NULL,
    enhancements bigint NOT NULL,
    component_swaps bigint NOT NULL
);

CREATE TABLE profile_tier_records (
    player_id text NOT NULL REFERENCES profiles ON DELETE CASCADE,
    tier integer NOT NULL,
    best_wave bigint NOT NULL,
    best_kills bigint NOT NULL,
    runs bigint NOT NULL,
    checkpoints bigint NOT NULL,
    salvage_secured bigint NOT NULL,
    longest_run double precision NOT NULL,
    last_played_at bigint NOT NULL,
    highest_wave bigint NOT NULL,
    bosses_defeated bigint NOT NULL,
    elites_defeated bigint NOT NULL,
    best_bosses_run bigint NOT NULL,
    best_player_damage double precision NOT NULL,
    best_tower_damage double precision NOT NULL,
    deaths bigint NOT NULL,
    items_banked bigint NOT NULL,
    PRIMARY KEY (player_id, tier)
);

CREATE TABLE profile_active_runs (
    player_id text PRIMARY KEY REFERENCES profiles ON DELETE CASCADE,
    id text NOT NULL,
    tier integer NOT NULL,
    started_at bigint NOT NULL,
    banked_through_wave bigint NOT NULL,
    salvage_secured bigint NOT NULL,
    items_secured bigint NOT NULL,
    credits_secured bigint NOT NULL,
    components_secured bigint NOT NULL
);

CREATE TABLE profile_run_history (
    player_id text NOT NULL REFERENCES profiles ON DELETE CASCADE,
    id text NOT NULL,
    position integer NOT NULL,
    tier integer NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('returned', 'defeat', 'abandoned', 'interrupted')),
    final_wave bigint NOT NULL,
    waves_cleared bigint NOT NULL,
    kills bigint NOT NULL,
    duration double precision NOT NULL,
    salvage_secured bigint NOT NULL,
    salvage_lost bigint NOT NULL,
    items_secured bigint NOT NULL,
    items_lost bigint NOT NULL,
    ended_at bigint NOT NULL,
    new_record boolean NOT NULL,
    credits_secured bigint NOT NULL,
    components_secured bigint NOT NULL,
    bosses text[] NOT NULL,
    elites bigint NOT NULL,
    deaths bigint NOT NULL,
    reactor_damage double precision NOT NULL,
    player_damage double precision NOT NULL,
    tower_damage double precision NOT NULL,
    items_collected bigint NOT NULL,
    events bigint NOT NULL,
    milestones text[] NOT NULL,
    records text[] NOT NULL,
    dev boolean NOT NULL,
    PRIMARY KEY (player_id, id),
    UNIQUE (player_id, position)
);

-- Items use keys local to a profile. Merchant stock, owned equipment, and installed
-- modules share the same item definition tables while retaining separate locations.
CREATE TABLE profile_items (
    player_id text NOT NULL REFERENCES profiles ON DELETE CASCADE,
    item_key text NOT NULL,
    scope text NOT NULL CHECK (scope IN ('owned', 'equipment', 'modules', 'socket')),
    parent_key text,
    position integer NOT NULL CHECK (position >= 0),
    storage_position integer CHECK (storage_position >= 0),
    equipped_slot text CHECK (equipped_slot IN ('weapon','armor','shield','reactor','processor','accessory','accessory2')),
    offer_id text,
    sold boolean,
    featured boolean,
    uid text NOT NULL,
    def_id text NOT NULL,
    acquired_at bigint NOT NULL,
    source text NOT NULL,
    category text NOT NULL,
    level integer NOT NULL,
    rarity text NOT NULL,
    name text NOT NULL,
    sockets integer NOT NULL CHECK (sockets >= 0),
    signature text,
    seed bigint NOT NULL,
    gen integer NOT NULL,
    locked boolean,
    enhance integer,
    rerolls bigint,
    mods bigint,
    PRIMARY KEY (player_id, item_key),
    FOREIGN KEY (player_id, parent_key) REFERENCES profile_items DEFERRABLE INITIALLY DEFERRED,
    CHECK ((scope = 'socket') = (parent_key IS NOT NULL)),
    CHECK (CASE WHEN scope = 'owned' THEN (storage_position IS NULL) <> (equipped_slot IS NULL)
                ELSE storage_position IS NULL AND equipped_slot IS NULL END),
    CHECK ((scope IN ('equipment', 'modules')) = (offer_id IS NOT NULL AND sold IS NOT NULL AND featured IS NOT NULL)),
    UNIQUE (player_id, parent_key, position),
    UNIQUE (player_id, storage_position),
    UNIQUE (player_id, equipped_slot)
);
CREATE UNIQUE INDEX profile_item_root_position ON profile_items (player_id, scope, position) WHERE parent_key IS NULL;
CREATE UNIQUE INDEX profile_item_owned_uid ON profile_items (player_id, uid) WHERE scope = 'owned';

CREATE TABLE profile_item_stats (
    player_id text NOT NULL REFERENCES profiles ON DELETE CASCADE,
    item_key text NOT NULL,
    position integer NOT NULL,
    kind text NOT NULL CHECK (kind IN ('base', 'affix')),
    stat text NOT NULL,
    op text NOT NULL,
    value double precision NOT NULL,
    id text,
    tier integer,
    roll double precision,
    locked boolean,
    PRIMARY KEY (player_id, item_key, kind, position),
    FOREIGN KEY (player_id, item_key) REFERENCES profile_items DEFERRABLE INITIALLY DEFERRED,
    CHECK ((kind = 'affix') = (id IS NOT NULL AND tier IS NOT NULL AND roll IS NOT NULL))
);

CREATE TABLE profile_weapon_rolls (
    player_id text NOT NULL REFERENCES profiles ON DELETE CASCADE,
    item_key text NOT NULL,
    damage double precision NOT NULL,
    fire_rate double precision NOT NULL,
    heat_per_shot double precision NOT NULL,
    cool_rate double precision NOT NULL,
    range double precision,
    accuracy double precision,
    pierce integer,
    charge_time double precision,
    beam_width double precision,
    ramp_max double precision,
    PRIMARY KEY (player_id, item_key),
    FOREIGN KEY (player_id, item_key) REFERENCES profile_items DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE profile_weapon_builds (
    player_id text NOT NULL REFERENCES profiles ON DELETE CASCADE,
    item_key text NOT NULL,
    v integer NOT NULL,
    family text NOT NULL,
    chassis text NOT NULL,
    barrel text NOT NULL,
    core text NOT NULL,
    cooling text NOT NULL,
    mechanism text NOT NULL,
    attachments text[] NOT NULL,
    finish text NOT NULL,
    length double precision NOT NULL,
    bulk double precision NOT NULL,
    hue double precision NOT NULL,
    sockets text[] NOT NULL,
    PRIMARY KEY (player_id, item_key),
    FOREIGN KEY (player_id, item_key) REFERENCES profile_items DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE profile_item_modules (
    player_id text NOT NULL REFERENCES profiles ON DELETE CASCADE,
    item_key text NOT NULL,
    type text NOT NULL,
    compatible text[] NOT NULL,
    socket_cost integer NOT NULL,
    PRIMARY KEY (player_id, item_key),
    FOREIGN KEY (player_id, item_key) REFERENCES profile_items DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE profile_presets (
    player_id text NOT NULL REFERENCES profiles ON DELETE CASCADE,
    position integer NOT NULL,
    name text NOT NULL,
    weapon text,
    armor text,
    shield text,
    reactor text,
    processor text,
    accessory text,
    accessory2 text,
    PRIMARY KEY (player_id, position)
);

CREATE TABLE profile_market_exchange (
    player_id text NOT NULL REFERENCES profiles ON DELETE CASCADE,
    id text NOT NULL,
    position integer NOT NULL,
    quantity integer NOT NULL,
    PRIMARY KEY (player_id, id),
    UNIQUE (player_id, position)
);

CREATE TABLE profile_hq_placeables (
    player_id text NOT NULL REFERENCES profiles ON DELETE CASCADE,
    uid text NOT NULL,
    position integer NOT NULL,
    type text NOT NULL,
    x double precision NOT NULL,
    y double precision NOT NULL,
    z double precision NOT NULL,
    rotation_y double precision NOT NULL,
    scale double precision NOT NULL,
    PRIMARY KEY (player_id, uid),
    UNIQUE (player_id, position)
);

CREATE TABLE profile_hq_placeable_properties (
    player_id text NOT NULL REFERENCES profiles ON DELETE CASCADE,
    uid text NOT NULL,
    property text NOT NULL,
    text_value text,
    number_value double precision,
    boolean_value boolean,
    PRIMARY KEY (player_id, uid, property),
    FOREIGN KEY (player_id, uid) REFERENCES profile_hq_placeables DEFERRABLE INITIALLY DEFERRED,
    CHECK (num_nonnulls(text_value, number_value, boolean_value) = 1)
);

CREATE TABLE profile_hq_structure (
    player_id text NOT NULL REFERENCES profiles ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('floors', 'edges', 'ceilings', 'pillars')),
    grid_key text NOT NULL,
    piece text NOT NULL,
    PRIMARY KEY (player_id, kind, grid_key)
);

CREATE TABLE profile_hq_stations (
    player_id text NOT NULL REFERENCES profiles ON DELETE CASCADE,
    station text NOT NULL,
    x double precision NOT NULL,
    z double precision NOT NULL,
    yaw double precision NOT NULL,
    PRIMARY KEY (player_id, station)
);

CREATE TABLE profile_hq_owned (
    player_id text NOT NULL REFERENCES profiles ON DELETE CASCADE,
    piece text NOT NULL,
    quantity integer NOT NULL CHECK (quantity >= 0),
    PRIMARY KEY (player_id, piece)
);
