-- Architecture v2: accounts with passkeys, sessions and recovery codes; profiles as rules-owned documents.
-- Everyone starts fresh: nothing is migrated from the legacy Node server's tables.

CREATE TABLE accounts (
    id          uuid PRIMARY KEY,
    name        text NOT NULL,
    -- Case-insensitive uniqueness of display names.
    name_key    text NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    renamed_at  timestamptz,
    admin       boolean NOT NULL DEFAULT false,
    CONSTRAINT accounts_name_len CHECK (char_length(name) BETWEEN 3 AND 18),
    CONSTRAINT accounts_name_key CHECK (name_key = lower(name))
);

CREATE TABLE passkeys (
    -- WebAuthn credential id.
    credential_id bytea PRIMARY KEY,
    account_id    uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    -- Serialised webauthn-rs Passkey (public key, counter, flags).
    passkey       jsonb NOT NULL,
    label         text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_used_at  timestamptz
);
CREATE INDEX passkeys_account ON passkeys (account_id);

CREATE TABLE recovery_codes (
    account_id  uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
    -- Argon2id PHC string of the one-time code.
    code_hash   text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    -- SHA-256 of the opaque session token (the token itself is never stored).
    token_hash   bytea PRIMARY KEY,
    account_id   uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    user_agent   text NOT NULL DEFAULT ''
);
CREATE INDEX sessions_account ON sessions (account_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE profiles (
    account_id    uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
    -- SaveData as owned by packages/rules (shape, sanitize and migrations live there).
    doc           jsonb NOT NULL,
    -- Increments on every committed change; clients sync against it.
    rev           bigint NOT NULL DEFAULT 0,
    -- SaveData version of `doc` (rules migrations run before replays).
    rules_version integer NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE war_state (
    id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    data        jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
