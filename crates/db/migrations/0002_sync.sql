-- Offline-first sync: each device log is replayed once (entries are de-duplicated by device + seq).
CREATE TABLE profile_devices (
    account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    device     text NOT NULL,
    last_seq   bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, device),
    CONSTRAINT profile_devices_device_len CHECK (char_length(device) BETWEEN 1 AND 64)
);
