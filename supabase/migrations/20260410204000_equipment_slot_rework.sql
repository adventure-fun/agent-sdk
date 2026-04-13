
-- Equipment Slot Rework: 4 slots → 5 slots
-- Old: weapon, armor, accessory, class-specific
-- New: weapon, armor, helm, hands, accessory

-- 1. Reassign class-specific → armor (wooden shield is the only item using this slot)
UPDATE inventory_items SET slot = 'armor' WHERE slot = 'class-specific';

-- 2. Reassign gloves from accessory → hands
UPDATE inventory_items SET slot = 'hands'
WHERE slot = 'accessory'
AND template_id IN (
  'gear-chain-gloves', 'gear-warden-gauntlets', 'gear-pressure-gauntlets',
  'gear_chain_gloves', 'gear_warden_gauntlets', 'gear_pressure_gauntlets'
);

-- 3. Reassign helms from armor → helm
UPDATE inventory_items SET slot = 'helm'
WHERE slot = 'armor'
AND template_id IN (
  'gear-leather-cap', 'gear-miners-helm',
  'gear_leather_cap', 'gear_miners_helm'
);

-- 4. Normalize underscore IDs to hyphens for collapsed-mines items
UPDATE inventory_items SET template_id = 'shaft-access-key' WHERE template_id = 'shaft_access_key';
UPDATE inventory_items SET template_id = 'shaft-master-key' WHERE template_id = 'shaft_master_key';
UPDATE inventory_items SET template_id = 'gear-miners-helm' WHERE template_id = 'gear_miners_helm';
UPDATE inventory_items SET template_id = 'gear-steamforged-blade' WHERE template_id = 'gear_steamforged_blade';
UPDATE inventory_items SET template_id = 'gear-construct-core' WHERE template_id = 'gear_construct_core';
UPDATE inventory_items SET template_id = 'gear-pressure-gauntlets' WHERE template_id = 'gear_pressure_gauntlets';
UPDATE inventory_items SET template_id = 'gear-sentinels-hammer' WHERE template_id = 'gear_sentinels_hammer';
UPDATE inventory_items SET template_id = 'gear-sentinels-chassis' WHERE template_id = 'gear_sentinels_chassis';
UPDATE inventory_items SET template_id = 'gear-builders-signet' WHERE template_id = 'gear_builders_signet';

-- 5. Add CHECK constraint for the new slot values
ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_slot_check
  CHECK (slot IS NULL OR slot IN ('weapon', 'armor', 'helm', 'hands', 'accessory'));
