export type Direction = "up" | "down" | "left" | "right"

export type EquipSlot = "weapon" | "armor" | "accessory" | "class-specific"

export type Action =
  | { type: "move"; direction: Direction }
  | { type: "attack"; target_id: string; ability_id?: string }
  | { type: "disarm_trap"; item_id: string }
  | { type: "use_item"; item_id: string; target_id?: string }
  | { type: "equip"; item_id: string }
  | { type: "unequip"; slot: EquipSlot }
  | { type: "inspect"; target_id: string }
  | { type: "interact"; target_id: string }
  | { type: "use_portal" }
  | { type: "retreat" }
  | { type: "wait" }
  | { type: "pickup"; item_id: string }
  | { type: "drop"; item_id: string }

export type Observation = Record<string, unknown>

export type ServerMessage =
  | { type: "observation"; data: Observation }
  | { type: "error"; message: string }
  | {
      type: "death"
      data: { cause: string; floor: number; room: string; turn: number }
    }
  | {
      type: "extracted"
      data: {
        loot_summary: unknown[]
        xp_gained: number
        gold_gained: number
        completion_bonus?: { xp: number; gold: number }
        realm_completed: boolean
      }
    }
