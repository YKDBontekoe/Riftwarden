-- Save v9: a secondary weapon slot (one weapon is active at a time in the arena).
ALTER TABLE profile_items DROP CONSTRAINT IF EXISTS profile_items_equipped_slot_check;
ALTER TABLE profile_items ADD CONSTRAINT profile_items_equipped_slot_check
    CHECK (equipped_slot IN ('weapon','weapon2','armor','shield','reactor','processor','accessory','accessory2'));
ALTER TABLE profile_presets ADD COLUMN weapon2 text;
UPDATE profiles SET version = 9 WHERE version = 8;
