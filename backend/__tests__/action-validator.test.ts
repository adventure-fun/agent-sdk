import { describe, expect, it } from "bun:test"
import type { Action, GameState, Tile, ActiveEffect } from "@adventure-fun/schemas"

function makeTiles(width: number, height: number): Tile[][] {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({
      x,
      y,
      type: "floor" as const,
      entities: [],
    })),
  )
}

function makeState(overrides?: Partial<GameState>): GameState {
  return {
    turn: 5,
    realm: {
      template_id: "tutorial-cellar",
      template_version: 1,
      seed: 42,
      total_floors: 1,
    },
    character: {
      id: "char-1",
      class: "knight",
      level: 3,
      xp: 150,
      gold: 50,
      hp: { current: 40, max: 50 },
      resource: { type: "stamina", current: 8, max: 10 },
      stats: {
        hp: 50,
        attack: 22,
        defense: 10,
        accuracy: 14,
        evasion: 12,
        speed: 11,
      },
      effective_stats: {
        hp: 50,
        attack: 22,
        defense: 10,
        accuracy: 14,
        evasion: 12,
        speed: 11,
      },
      buffs: [],
      debuffs: [],
      abilities: ["knight-slash"],
      cooldowns: {},
      skill_tree: {},
    },
    position: {
      floor: 1,
      room_id: "f1_r0_test-room",
      tile: { x: 3, y: 3 },
    },
    inventory: [
      {
        id: "inv-potion",
        template_id: "health-potion",
        name: "Health Potion",
        quantity: 2,
        modifiers: {},
        owner_type: "character",
        owner_id: "char-1",
      },
    ],
    equipment: {
      weapon: {
        id: "eq-sword",
        template_id: "iron-sword",
        name: "Iron Sword",
        quantity: 1,
        modifiers: {},
        owner_type: "character",
        owner_id: "char-1",
        slot: "weapon",
      },
      armor: null,
      accessory: null,
      "class-specific": null,
    },
    activeFloor: {
      rooms: [
        {
          id: "f1_r0_test-room",
          tiles: makeTiles(7, 7),
          enemies: [
            {
              id: "enemy-1",
              template_id: "goblin",
              hp: 15,
              hp_max: 20,
              position: { x: 4, y: 3 },
              effects: [],
              cooldowns: {},
            },
          ],
          items: [
            {
              id: "item-1",
              template_id: "health-potion",
              quantity: 1,
              position: { x: 3, y: 4 },
            },
          ],
        },
      ],
    },
    discoveredTiles: { 1: [{ x: 3, y: 3 }] },
    mutatedEntities: [],
    realmStatus: "active",
    ...overrides,
  }
}

// ── 9.2 — Action payload validation ─────────────────────────────────────────

describe("9.2 — parseAction (input sanitization)", () => {
  let parseAction: typeof import("../src/game/action-validator.js").parseAction

  it("module loads without error", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(typeof parseAction).toBe("function")
  })

  it("rejects null/undefined input", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction(null).valid).toBe(false)
    expect(parseAction(undefined).valid).toBe(false)
  })

  it("rejects non-object input", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction("move").valid).toBe(false)
    expect(parseAction(42).valid).toBe(false)
    expect(parseAction(true).valid).toBe(false)
  })

  it("rejects objects without a type field", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ direction: "up" }).valid).toBe(false)
  })

  it("rejects unknown action types", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    const result = parseAction({ type: "teleport", x: 5, y: 5 })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("type")
  })

  it("parses valid move action", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    const result = parseAction({ type: "move", direction: "up" })
    expect(result.valid).toBe(true)
    expect(result.action).toEqual({ type: "move", direction: "up" })
  })

  it("rejects move with invalid direction", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    const result = parseAction({ type: "move", direction: "northeast" })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("direction")
  })

  it("rejects move without direction", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ type: "move" }).valid).toBe(false)
  })

  it("parses valid attack action with ability_id", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    const result = parseAction({ type: "attack", target_id: "enemy-1", ability_id: "knight-slash" })
    expect(result.valid).toBe(true)
    expect(result.action).toEqual({ type: "attack", target_id: "enemy-1", ability_id: "knight-slash" })
  })

  it("parses attack action without ability_id (defaults to basic-attack)", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    const result = parseAction({ type: "attack", target_id: "enemy-1" })
    expect(result.valid).toBe(true)
    expect(result.action).toEqual({ type: "attack", target_id: "enemy-1" })
  })

  it("rejects attack without target_id", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ type: "attack" }).valid).toBe(false)
  })

  it("rejects attack with non-string target_id", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ type: "attack", target_id: 123 }).valid).toBe(false)
  })

  it("parses valid use_item action", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    const result = parseAction({ type: "use_item", item_id: "potion-1" })
    expect(result.valid).toBe(true)
  })

  it("rejects use_item without item_id", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ type: "use_item" }).valid).toBe(false)
  })

  it("parses valid pickup action", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ type: "pickup", item_id: "item-1" }).valid).toBe(true)
  })

  it("rejects pickup without item_id", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ type: "pickup" }).valid).toBe(false)
  })

  it("parses valid drop action", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ type: "drop", item_id: "item-1" }).valid).toBe(true)
  })

  it("parses valid equip action", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ type: "equip", item_id: "sword-1" }).valid).toBe(true)
  })

  it("rejects equip without item_id", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ type: "equip" }).valid).toBe(false)
  })

  it("parses valid unequip action with valid slot", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    const result = parseAction({ type: "unequip", slot: "weapon" })
    expect(result.valid).toBe(true)
    expect(result.action).toEqual({ type: "unequip", slot: "weapon" })
  })

  it("rejects unequip with invalid slot", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ type: "unequip", slot: "hat" }).valid).toBe(false)
  })

  it("parses valid inspect action", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ type: "inspect", target_id: "enemy-1" }).valid).toBe(true)
  })

  it("parses valid interact action", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ type: "interact", target_id: "chest-1" }).valid).toBe(true)
  })

  it("parses valid disarm_trap action", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ type: "disarm_trap", item_id: "trap-1" }).valid).toBe(true)
  })

  it("parses parameterless actions: wait, use_portal, retreat", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    expect(parseAction({ type: "wait" }).valid).toBe(true)
    expect(parseAction({ type: "use_portal" }).valid).toBe(true)
    expect(parseAction({ type: "retreat" }).valid).toBe(true)
  })

  it("strips unknown extra fields from the action", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    const result = parseAction({
      type: "move",
      direction: "left",
      __proto__: {},
      malicious: "DROP TABLE",
    })
    expect(result.valid).toBe(true)
    const action = result.action as { type: string; direction: string; malicious?: string }
    expect(action.type).toBe("move")
    expect(action.direction).toBe("left")
    expect(action.malicious).toBeUndefined()
  })

  it("rejects overly long string values", async () => {
    const mod = await import("../src/game/action-validator.js")
    parseAction = mod.parseAction
    const longId = "a".repeat(300)
    expect(parseAction({ type: "attack", target_id: longId }).valid).toBe(false)
  })
})

// ── 9.1 — Legal action validation ───────────────────────────────────────────

describe("9.1 — isActionLegal (server-side legal action check)", () => {
  let isActionLegal: typeof import("../src/game/action-validator.js").isActionLegal

  it("module exports isActionLegal", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal
    expect(typeof isActionLegal).toBe("function")
  })

  it("accepts a move action that matches a legal action", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [
      { type: "move", direction: "up" },
      { type: "move", direction: "down" },
      { type: "wait" },
    ]
    expect(isActionLegal({ type: "move", direction: "up" }, legal)).toBe(true)
  })

  it("rejects a move direction not in legal actions", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [
      { type: "move", direction: "up" },
      { type: "wait" },
    ]
    expect(isActionLegal({ type: "move", direction: "left" }, legal)).toBe(false)
  })

  it("accepts wait when wait is legal", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [{ type: "wait" }]
    expect(isActionLegal({ type: "wait" }, legal)).toBe(true)
  })

  it("accepts attack with matching target_id and ability_id", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [
      { type: "attack", target_id: "enemy-1", ability_id: "basic-attack" },
      { type: "attack", target_id: "enemy-1", ability_id: "knight-slash" },
    ]
    expect(isActionLegal({ type: "attack", target_id: "enemy-1", ability_id: "knight-slash" }, legal)).toBe(true)
  })

  it("rejects attack on a target not in legal actions", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [
      { type: "attack", target_id: "enemy-1", ability_id: "basic-attack" },
    ]
    expect(isActionLegal({ type: "attack", target_id: "enemy-999", ability_id: "basic-attack" }, legal)).toBe(false)
  })

  it("rejects attack with an ability not in legal actions for that target", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [
      { type: "attack", target_id: "enemy-1", ability_id: "basic-attack" },
    ]
    expect(isActionLegal({ type: "attack", target_id: "enemy-1", ability_id: "fireball" }, legal)).toBe(false)
  })

  it("matches attack without ability_id against legal basic-attack", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [
      { type: "attack", target_id: "enemy-1", ability_id: "basic-attack" },
    ]
    expect(isActionLegal({ type: "attack", target_id: "enemy-1" }, legal)).toBe(true)
  })

  it("accepts pickup when item_id matches a legal pickup", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [
      { type: "pickup", item_id: "item-1" },
      { type: "wait" },
    ]
    expect(isActionLegal({ type: "pickup", item_id: "item-1" }, legal)).toBe(true)
  })

  it("rejects pickup for a non-legal item_id", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [
      { type: "pickup", item_id: "item-1" },
    ]
    expect(isActionLegal({ type: "pickup", item_id: "item-999" }, legal)).toBe(false)
  })

  it("accepts use_portal when it is in legal actions", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [{ type: "use_portal" }, { type: "wait" }]
    expect(isActionLegal({ type: "use_portal" }, legal)).toBe(true)
  })

  it("rejects use_portal when it is not in legal actions", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [{ type: "wait" }]
    expect(isActionLegal({ type: "use_portal" }, legal)).toBe(false)
  })

  it("accepts unequip when slot matches", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [
      { type: "unequip", slot: "weapon" },
    ]
    expect(isActionLegal({ type: "unequip", slot: "weapon" }, legal)).toBe(true)
    expect(isActionLegal({ type: "unequip", slot: "armor" }, legal)).toBe(false)
  })

  it("accepts use_item when item_id matches", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [
      { type: "use_item", item_id: "potion-1" },
    ]
    expect(isActionLegal({ type: "use_item", item_id: "potion-1" }, legal)).toBe(true)
    expect(isActionLegal({ type: "use_item", item_id: "potion-99" }, legal)).toBe(false)
  })

  it("accepts equip when item_id matches", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [
      { type: "equip", item_id: "sword-1" },
    ]
    expect(isActionLegal({ type: "equip", item_id: "sword-1" }, legal)).toBe(true)
  })

  it("accepts inspect when target_id matches", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [
      { type: "inspect", target_id: "enemy-1" },
    ]
    expect(isActionLegal({ type: "inspect", target_id: "enemy-1" }, legal)).toBe(true)
    expect(isActionLegal({ type: "inspect", target_id: "enemy-2" }, legal)).toBe(false)
  })

  it("accepts interact when target_id matches", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [
      { type: "interact", target_id: "lever-1" },
    ]
    expect(isActionLegal({ type: "interact", target_id: "lever-1" }, legal)).toBe(true)
  })

  it("accepts disarm_trap when item_id matches", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [
      { type: "disarm_trap", item_id: "trap-1" },
    ]
    expect(isActionLegal({ type: "disarm_trap", item_id: "trap-1" }, legal)).toBe(true)
  })

  it("accepts retreat when it is in legal actions", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [{ type: "retreat" }]
    expect(isActionLegal({ type: "retreat" }, legal)).toBe(true)
  })

  it("accepts drop when item_id matches", async () => {
    const mod = await import("../src/game/action-validator.js")
    isActionLegal = mod.isActionLegal

    const legal: Action[] = [{ type: "drop", item_id: "junk-1" }]
    expect(isActionLegal({ type: "drop", item_id: "junk-1" }, legal)).toBe(true)
    expect(isActionLegal({ type: "drop", item_id: "junk-2" }, legal)).toBe(false)
  })
})
