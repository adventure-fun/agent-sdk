import type { CharacterClass } from "@adventure-fun/schemas"

export const TILE_SIZE = 64

export const COLORS: Record<string, number> = {
  wall: 0x3b3b3b,
  floor: 0x1a1a2e,
  door: 0x8b6914,
  stairs: 0x4a90d9,
  stairs_up: 0x4a90d9,
  entrance: 0x4a90d9,
}


export const PLAYER_COLOR = 0x2ecc71

// Registry: enemy slug → spritesheet JSON path + animation key
export const ENEMY_SPRITE_REGISTRY: Record<string, { json: string; animKey: string }> = {
  "hollow-rat": { json: "/sprites/enemies/common/hollow-rat-idle.json", animKey: "hollow-rat-idle" },
  "cave-crawler": { json: "/sprites/enemies/collapsed-passage/cave-crawler-idle.json", animKey: "cave-crawler-idle" },
  "blighted-wolf": { json: "/sprites/enemies/blighted-hollow/blighted-wolf-idle.json", animKey: "blighted-wolf-idle" },
  "hollow-spore": { json: "/sprites/enemies/blighted-hollow/hollow-spore-idle.json", animKey: "hollow-spore-idle" },
  "skeleton-warrior": { json: "/sprites/enemies/sunken-crypt/skeleton-warrior-idle.json", animKey: "skeleton-warrior-idle" },
  "drowned-husk": { json: "/sprites/enemies/sunken-crypt/drowned-husk-idle.json", animKey: "drowned-husk-idle" },
  "stone-golem": { json: "/sprites/enemies/collapsed-mines/stone-golem-idle.json", animKey: "stone-golem-idle" },
  "iron-automaton": { json: "/sprites/enemies/collapsed-mines/iron-automaton-idle.json", animKey: "iron-automaton-idle" },
  "mine-drone": { json: "/sprites/enemies/collapsed-mines/mine-drone-idle.json", animKey: "mine-drone-idle" },
  "forge-construct": { json: "/sprites/enemies/collapsed-mines/forge-construct-idle.json", animKey: "forge-construct-idle" },
  "iron-sentinel": { json: "/sprites/enemies/collapsed-mines/iron-sentinel-idle.json", animKey: "iron-sentinel-idle" },
  "the-iron-sentinel": { json: "/sprites/enemies/collapsed-mines/iron-sentinel-idle.json", animKey: "iron-sentinel-idle" },
  "hollow-warden": { json: "/sprites/enemies/sunken-crypt/hollow-warden-idle.json", animKey: "hollow-warden-idle" },
  "the-hollow-warden": { json: "/sprites/enemies/sunken-crypt/hollow-warden-idle.json", animKey: "hollow-warden-idle" },
  "lich-king": { json: "/sprites/enemies/common/lich-king-idle.json", animKey: "lich-king-idle" },
  "ghost": { json: "/sprites/enemies/common/ghost-idle.json", animKey: "ghost-idle" },
  "necromancer": { json: "/sprites/enemies/common/necromancer-idle.json", animKey: "necromancer-idle" },
  "zombie": { json: "/sprites/enemies/common/zombie-idle.json", animKey: "zombie-idle" },
}

// Registry: item template_id → spritesheet JSON path + animation key
export const ITEM_SPRITE_REGISTRY: Record<string, { json: string; animKey: string }> = {
  // Loot
  "gold-coins": { json: "/sprites/loot/gold-coins.json", animKey: "gold-coins-idle" },
  "loot-crude-gem": { json: "/sprites/loot/loot-crude-gem.json", animKey: "loot-crude-gem" },
  "loot-old-coin": { json: "/sprites/loot/loot-old-coin.json", animKey: "loot-old-coin" },
  // Consumables
  "health-potion": { json: "/sprites/consumables/health-potion.json", animKey: "health-potion" },
  "mana-potion": { json: "/sprites/consumables/mana-potion.json", animKey: "mana-potion" },
  "antidote": { json: "/sprites/consumables/antidote.json", animKey: "antidote" },
  "buff-potion": { json: "/sprites/consumables/buff-potion.json", animKey: "buff-potion" },
  "elixir-of-focus": { json: "/sprites/consumables/elixir-of-focus.json", animKey: "elixir-of-focus" },
  "berserker-draught": { json: "/sprites/consumables/berserker-draught.json", animKey: "berserker-draught" },
  "ironflask": { json: "/sprites/consumables/ironflask.json", animKey: "ironflask" },
  "smelling-salts": { json: "/sprites/consumables/smelling-salts.json", animKey: "smelling-salts" },
  "portal-scroll": { json: "/sprites/consumables/portal-scroll.json", animKey: "portal-scroll" },
  "greater-health-potion": { json: "/sprites/consumables/health-potion.json", animKey: "health-potion" },
  "greater-mana-potion": { json: "/sprites/consumables/mana-potion.json", animKey: "mana-potion" },
  "ammo-arrows-10": { json: "/sprites/consumables/ammo-arrows-10.json", animKey: "ammo-arrows-10" },
  "ammo-bolts-10": { json: "/sprites/consumables/ammo-bolts-10.json", animKey: "ammo-bolts-10" },
  // Loot (realm-specific)
  "gear-bone-fragment": { json: "/sprites/loot/gear-bone-fragment.json", animKey: "gear-bone-fragment" },
  "gear-construct-core": { json: "/sprites/loot/gear-construct-core.json", animKey: "gear-construct-core" },
  "loot-ancient-gear": { json: "/sprites/loot/loot-ancient-gear.json", animKey: "loot-ancient-gear" },
  "loot-blighted-fang": { json: "/sprites/loot/loot-blighted-fang.json", animKey: "loot-blighted-fang" },
  "loot-crypt-relic": { json: "/sprites/loot/loot-crypt-relic.json", animKey: "loot-crypt-relic" },
  "loot-guardian-sigil": { json: "/sprites/loot/loot-guardian-sigil.json", animKey: "loot-guardian-sigil" },
  "loot-sentinel-fragment": { json: "/sprites/loot/loot-sentinel-fragment.json", animKey: "loot-sentinel-fragment" },
  "loot-steam-crystal": { json: "/sprites/loot/loot-steam-crystal.json", animKey: "loot-steam-crystal" },
  "loot-violet-crystal": { json: "/sprites/loot/loot-violet-crystal.json", animKey: "loot-violet-crystal" },
  "loot-violet-shard": { json: "/sprites/loot/loot-violet-shard.json", animKey: "loot-violet-shard" },
  // Key items
  "crypt-key": { json: "/sprites/keys/crypt-key.json", animKey: "crypt-key" },
  "mine-key": { json: "/sprites/keys/mine-key.json", animKey: "mine-key" },
  "shaft-access-key": { json: "/sprites/keys/shaft-access-key.json", animKey: "shaft-access-key" },
  "shaft-master-key": { json: "/sprites/keys/shaft-master-key.json", animKey: "shaft-master-key" },
  // Equipment (weapons)
  "gear-bone-wand": { json: "/sprites/equipment/gear-bone-wand.json", animKey: "gear-bone-wand" },
  "gear-combat-dagger": { json: "/sprites/equipment/gear-combat-dagger.json", animKey: "gear-combat-dagger" },
  "gear-crypt-blade": { json: "/sprites/equipment/gear-crypt-blade.json", animKey: "gear-crypt-blade" },
  "gear-crypt-longbow": { json: "/sprites/equipment/gear-crypt-longbow.json", animKey: "gear-crypt-longbow" },
  "gear-piston-daggers": { json: "/sprites/equipment/gear-piston-daggers.json", animKey: "gear-piston-daggers" },
  "gear-pneumatic-crossbow": { json: "/sprites/equipment/gear-pneumatic-crossbow.json", animKey: "gear-pneumatic-crossbow" },
  "gear-sentinels-hammer": { json: "/sprites/equipment/gear-sentinels-hammer.json", animKey: "gear-sentinels-hammer" },
  "gear-shadow-knife": { json: "/sprites/equipment/gear-shadow-knife.json", animKey: "gear-shadow-knife" },
  "gear-steamforged-blade": { json: "/sprites/equipment/gear-steamforged-blade.json", animKey: "gear-steamforged-blade" },
  "gear-venom-blade": { json: "/sprites/equipment/gear-venom-blade.json", animKey: "gear-venom-blade" },
  "gear-voltaic-staff": { json: "/sprites/equipment/gear-voltaic-staff.json", animKey: "gear-voltaic-staff" },
  "gear-wardens-blade": { json: "/sprites/equipment/gear-wardens-blade.json", animKey: "gear-wardens-blade" },
  "hunters-bow": { json: "/sprites/equipment/hunters-bow.json", animKey: "hunters-bow" },
  "iron-sword": { json: "/sprites/equipment/iron-sword.json", animKey: "iron-sword" },
  "oak-staff": { json: "/sprites/equipment/oak-staff.json", animKey: "oak-staff" },
  "weapon-iron-sword": { json: "/sprites/equipment/weapon-iron-sword.json", animKey: "weapon-iron-sword" },
  "weapon-oak-staff": { json: "/sprites/equipment/weapon-oak-staff.json", animKey: "weapon-oak-staff" },
  "weapon-rusty-dagger": { json: "/sprites/equipment/weapon-rusty-dagger.json", animKey: "weapon-rusty-dagger" },
  "weapon-short-bow": { json: "/sprites/equipment/weapon-short-bow.json", animKey: "weapon-short-bow" },
  // Equipment (armor/shields)
  "gear-chainmail": { json: "/sprites/equipment/gear-chainmail.json", animKey: "gear-chainmail" },
  "gear-crypt-shield": { json: "/sprites/equipment/gear-crypt-shield.json", animKey: "gear-crypt-shield" },
  "gear-leather-vest": { json: "/sprites/equipment/gear-leather-vest.json", animKey: "gear-leather-vest" },
  "gear-sentinels-chassis": { json: "/sprites/equipment/gear-sentinels-chassis.json", animKey: "gear-sentinels-chassis" },
  "gear-steamplate": { json: "/sprites/equipment/gear-steamplate.json", animKey: "gear-steamplate" },
  "gear-wardens-plate": { json: "/sprites/equipment/gear-wardens-plate.json", animKey: "gear-wardens-plate" },
  "leather-armor": { json: "/sprites/equipment/leather-armor.json", animKey: "leather-armor" },
  "wooden-shield": { json: "/sprites/equipment/wooden-shield.json", animKey: "wooden-shield" },
  // Equipment (gloves)
  "gear-chain-gloves": { json: "/sprites/equipment/gear-chain-gloves.json", animKey: "gear-chain-gloves" },
  "gear-leather-gloves": { json: "/sprites/equipment/gear-leather-gloves.json", animKey: "gear-leather-gloves" },
  "gear-plated-gloves": { json: "/sprites/equipment/gear-plated-gloves.json", animKey: "gear-plated-gloves" },
  "gear-pressure-gauntlets": { json: "/sprites/equipment/gear-pressure-gauntlets.json", animKey: "gear-pressure-gauntlets" },
  "gear-sentinels-grips": { json: "/sprites/equipment/gear-sentinels-grips.json", animKey: "gear-sentinels-grips" },
  "gear-warden-gauntlets": { json: "/sprites/equipment/gear-warden-gauntlets.json", animKey: "gear-warden-gauntlets" },
  // Equipment (rings/accessories)
  "gear-blight-ward": { json: "/sprites/equipment/gear-blight-ward.json", animKey: "gear-blight-ward" },
  "gear-builders-signet": { json: "/sprites/equipment/gear-builders-signet.json", animKey: "gear-builders-signet" },
  "gear-core-fragment-ring": { json: "/sprites/equipment/gear-core-fragment-ring.json", animKey: "gear-core-fragment-ring" },
  "gear-guardian-amulet": { json: "/sprites/equipment/gear-guardian-amulet.json", animKey: "gear-guardian-amulet" },
  "gear-hollow-ward": { json: "/sprites/equipment/gear-hollow-ward.json", animKey: "gear-hollow-ward" },
  "gear-iron-band": { json: "/sprites/equipment/gear-iron-band.json", animKey: "gear-iron-band" },
  "gear-tomb-ring": { json: "/sprites/equipment/gear-tomb-ring.json", animKey: "gear-tomb-ring" },
  "iron-ring": { json: "/sprites/equipment/iron-ring.json", animKey: "iron-ring" },
  // Equipment (helms)
  "gear-crypt-crown": { json: "/sprites/equipment/gear-crypt-crown.json", animKey: "gear-crypt-crown" },
  "gear-forged-visor": { json: "/sprites/equipment/gear-forged-visor.json", animKey: "gear-forged-visor" },
  "gear-iron-helm": { json: "/sprites/equipment/gear-iron-helm.json", animKey: "gear-iron-helm" },
  "gear-leather-cap": { json: "/sprites/equipment/gear-leather-cap.json", animKey: "gear-leather-cap" },
  "gear-miners-helm": { json: "/sprites/equipment/gear-miners-helm.json", animKey: "gear-miners-helm" },
  "gear-sentinels-crest": { json: "/sprites/equipment/gear-sentinels-crest.json", animKey: "gear-sentinels-crest" },
}

// Item size overrides: render smaller than full tile
export const ITEM_SIZE_OVERRIDES: Record<string, { size: number; offset: number }> = {
  "gold-coins": { size: 32, offset: 16 },
}

// Default facing direction for sprites — "right" means the sprite art faces right
// When moving in the opposite direction, the sprite is flipped via scale.x = -1
export const ENEMY_DEFAULT_FACING: Record<string, "left" | "right"> = {
  "hollow-rat": "left",
  "cave-crawler": "left",
  "blighted-wolf": "left",
  "hollow-spore": "left",
  "skeleton-warrior": "left",
  "drowned-husk": "left",
  "stone-golem": "right",
  "iron-automaton": "left",
  "mine-drone": "left",
  "forge-construct": "left",
  "iron-sentinel": "left",
  "hollow-warden": "right",
  "lich-king": "left",
  "ghost": "right",
  "necromancer": "left",
  "zombie": "left",
}

// All player classes face right by default
export const PLAYER_DEFAULT_FACING: "left" | "right" = "right"

// Locked gate/door interactables — rendered wall-style with rotation
export const LOCKED_GATE_IDS = new Set(["cp-iron-gate", "sc-locked-door-f2"])

// Interactable entity ID → spritesheet JSON path + animation key
export const INTERACTABLE_SPRITE_REGISTRY: Record<string, { json: string; animKey: string }> = {
  "tutorial-chest-supplies": { json: "/sprites/interactables/chest.json", animKey: "chest" },
  "tutorial-chest-weapon": { json: "/sprites/interactables/chest.json", animKey: "chest" },
  "tutorial-wall-scratches": { json: "/sprites/interactables/chest.json", animKey: "chest" },
  "cm-workshop-lockbox": { json: "/sprites/interactables/chest.json", animKey: "chest" },
  // Collapsed Passage
  "cp-overseer-journal": { json: "/sprites/interactables/overseers-journal.json", animKey: "overseers-journal" },
  "cp-lockbox": { json: "/sprites/interactables/corroded-lockbox.json", animKey: "corroded-lockbox" },
  "cp-scattered-tools": { json: "/sprites/interactables/scattered-mining-tools.json", animKey: "scattered-mining-tools" },
  // Blighted Hollow
  "bh-carved-stone": { json: "/sprites/interactables/carved-stone-fragment.json", animKey: "carved-stone-fragment" },
  "bh-ranger-pack": { json: "/sprites/interactables/decayed-rangers-pack.json", animKey: "decayed-rangers-pack" },
  "bh-clear-spring": { json: "/sprites/interactables/clear-spring.json", animKey: "clear-spring" },
  "bh-broken-seal": { json: "/sprites/interactables/the-cracked-seal.json", animKey: "the-cracked-seal" },
  "bh-dead-tree": { json: "/sprites/interactables/violet-veined-tree.json", animKey: "violet-veined-tree" },
}

// Realm template ID → enemy slugs (roster + boss)
// Enemy roster IDs use underscores in some realms; we normalise to hyphens for sprite lookup
export const REALM_ENEMIES: Record<string, string[]> = {
  "tutorial-cellar": ["hollow-rat"],
  "collapsed-passage": ["hollow-rat", "cave-crawler"],
  "blighted-hollow": ["blighted-wolf", "hollow-spore"],
  "sunken-crypt": ["skeleton-warrior", "drowned-husk", "hollow-warden"],
  "collapsed-mines": ["stone-golem", "iron-automaton", "mine-drone", "forge-construct", "iron-sentinel"],
}

// Player class → spritesheet JSON path + animation key
export const PLAYER_SPRITE_REGISTRY: Record<CharacterClass, { json: string; animKey: string }> = {
  knight: { json: "/sprites/player/knight-idle.json", animKey: "knight-idle" },
  mage: { json: "/sprites/player/mage-idle.json", animKey: "mage-idle" },
  rogue: { json: "/sprites/player/rogue-idle.json", animKey: "rogue-idle" },
  archer: { json: "/sprites/player/archer-idle.json", animKey: "archer-idle" },
}

export const HP_BAR_WIDTH = 48
export const HP_BAR_HEIGHT = 3
export const HP_BAR_GAP = 2
export const HP_BAR_BG = 0x444444
export const HP_COLOR_HIGH = 0x22c55e   // green
export const HP_COLOR_MID = 0xecb200    // amber/yellow
export const HP_COLOR_LOW = 0xef4444    // red
