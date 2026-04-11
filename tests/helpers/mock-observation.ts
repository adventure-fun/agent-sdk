import type {
  Action,
  Entity,
  EquipSlot,
  GameEvent,
  InventoryItem,
  InventorySlot,
  Observation,
} from "../../src/protocol.js"

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

const DEFAULT_CHARACTER: Observation["character"] = {
  id: "char-001",
  class: "rogue",
  level: 3,
  xp: 120,
  xp_to_next_level: 200,
  skill_points: 0,
  hp: { current: 25, max: 30 },
  resource: { type: "energy", current: 80, max: 100 },
  buffs: [],
  debuffs: [],
  cooldowns: {},
  abilities: [],
  base_stats: { hp: 30, attack: 10, defense: 5, accuracy: 13, evasion: 14, speed: 16 },
  effective_stats: { hp: 30, attack: 10, defense: 5, accuracy: 13, evasion: 14, speed: 16 },
  skill_tree: {},
}

const DEFAULT_EQUIPMENT: Record<EquipSlot, InventoryItem | null> = {
  weapon: null,
  armor: null,
  helm: null,
  hands: null,
  accessory: null,
}

export function buildObservation(overrides: DeepPartial<Observation> = {}): Observation {
  const character = {
    ...DEFAULT_CHARACTER,
    ...overrides.character,
    hp: { ...DEFAULT_CHARACTER.hp, ...overrides.character?.hp },
    resource: { ...DEFAULT_CHARACTER.resource, ...overrides.character?.resource },
    base_stats: { ...DEFAULT_CHARACTER.base_stats, ...overrides.character?.base_stats },
    effective_stats: { ...DEFAULT_CHARACTER.effective_stats, ...overrides.character?.effective_stats },
  } as Observation["character"]

  return {
    turn: overrides.turn ?? 1,
    character,
    inventory: (overrides.inventory ?? []) as InventorySlot[],
    inventory_slots_used: overrides.inventory_slots_used ?? 0,
    inventory_capacity: overrides.inventory_capacity ?? 10,
    equipment: { ...DEFAULT_EQUIPMENT, ...overrides.equipment } as Record<EquipSlot, InventoryItem | null>,
    gold: overrides.gold ?? 50,
    position: {
      floor: 1,
      room_id: "room-1",
      tile: { x: 3, y: 3 },
      ...overrides.position,
    },
    visible_tiles: overrides.visible_tiles ?? [],
    known_map: overrides.known_map ?? { floors: {} },
    visible_entities: (overrides.visible_entities ?? []) as Entity[],
    room_text: overrides.room_text ?? "A dark corridor stretches before you.",
    recent_events: (overrides.recent_events ?? []) as GameEvent[],
    legal_actions: (overrides.legal_actions ?? []) as Action[],
    realm_info: {
      template_name: "test-dungeon",
      floor_count: 2,
      current_floor: 1,
      status: "active",
      ...overrides.realm_info,
    },
  }
}

export function enemy(
  id: string,
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id,
    type: "enemy",
    name: overrides.name ?? "Goblin",
    position: overrides.position ?? { x: 4, y: 3 },
    hp_current: overrides.hp_current ?? 15,
    hp_max: overrides.hp_max ?? 15,
    behavior: overrides.behavior ?? "aggressive",
    ...overrides,
  }
}

export function trap(
  id: string,
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id,
    type: "trap_visible",
    name: overrides.name ?? "Spike Trap",
    position: overrides.position ?? { x: 5, y: 3 },
    ...overrides,
  }
}

export function item(
  id: string,
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id,
    type: "item",
    name: overrides.name ?? "Health Potion",
    position: overrides.position ?? { x: 2, y: 3 },
    rarity: overrides.rarity ?? "common",
    ...overrides,
  }
}

export function inventorySlot(
  overrides: Partial<InventorySlot> = {},
): InventorySlot {
  return {
    item_id: overrides.item_id ?? "inv-001",
    template_id: overrides.template_id ?? "health-potion",
    name: overrides.name ?? "Health Potion",
    quantity: overrides.quantity ?? 1,
    modifiers: overrides.modifiers ?? { heal: 15 },
  }
}

export function inventoryItem(
  overrides: Partial<InventoryItem> = {},
): InventoryItem {
  return {
    id: overrides.id ?? "inv-001",
    template_id: overrides.template_id ?? "iron-sword",
    name: overrides.name ?? "Iron Sword",
    quantity: overrides.quantity ?? 1,
    modifiers: overrides.modifiers ?? { attack: 5 },
    owner_type: overrides.owner_type ?? "character",
    owner_id: overrides.owner_id ?? "char-001",
    slot: overrides.slot ?? "weapon",
  }
}

export function attackAction(targetId: string): Action {
  return { type: "attack", target_id: targetId }
}

export function moveAction(direction: "up" | "down" | "left" | "right"): Action {
  return { type: "move", direction }
}

export function healAction(itemId: string): Action {
  return { type: "use_item", item_id: itemId }
}

export function pickupAction(itemId: string): Action {
  return { type: "pickup", item_id: itemId }
}

export function equipAction(itemId: string): Action {
  return { type: "equip", item_id: itemId }
}

export function portalAction(): Action {
  return { type: "use_portal" }
}

export function retreatAction(): Action {
  return { type: "retreat" }
}

export function waitAction(): Action {
  return { type: "wait" }
}

export function disarmAction(itemId: string): Action {
  return { type: "disarm_trap", item_id: itemId }
}

export function dropAction(itemId: string): Action {
  return { type: "drop", item_id: itemId }
}
