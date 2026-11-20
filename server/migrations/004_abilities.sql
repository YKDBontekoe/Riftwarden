-- Save v10: two ability slots and an ultimate slot.
ALTER TABLE profile_items DROP CONSTRAINT IF EXISTS profile_items_equipped_slot_check;
ALTER TABLE profile_items ADD CONSTRAINT profile_items_equipped_slot_check
    CHECK (equipped_slot IN ('weapon','weapon2','armor','shield','reactor','processor','accessory','accessory2','ability','ability2','ultimate'));
ALTER TABLE profile_presets ADD COLUMN ability text, ADD COLUMN ability2 text, ADD COLUMN ultimate text;
UPDATE profiles SET version = 10 WHERE version = 9;
