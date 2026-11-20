-- Elements: every weapon roll carries a damage element (NULL = pre-element weapon = kinetic).
ALTER TABLE profile_weapon_rolls ADD COLUMN IF NOT EXISTS element text
    CHECK (element IN ('kinetic','thermal','electric','cryo','corrosive','void'));
