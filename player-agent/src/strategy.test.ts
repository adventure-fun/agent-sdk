import { describe, expect, it } from "bun:test"
import type { Observation } from "@adventure-fun/schemas"
import { decideAction } from "./strategy.js"

function makeObservation(overrides?: Partial<Observation>): Observation {
  return {
    turn: 1,
    character: {
      id: "char-1",
      class: "rogue",
      level: 1,
      xp: 0,
      xp_to_next_level: 10,
      skill_points: 0,
      hp: { current: 20, max: 20 },
      resource: { type: "energy", current: 5, max: 5 },
      buffs: [],
      debuffs: [],
      cooldowns: {},
      abilities: [],
      base_stats: {
        hp: 20,
        attack: 5,
        defense: 3,
        accuracy: 5,
        evasion: 5,
        speed: 5,
      },
      effective_stats: {
        hp: 20,
        attack: 5,
        defense: 3,
        accuracy: 5,
        evasion: 5,
        speed: 5,
      },
      skill_tree: {},
    },
    inventory: [],
    inventory_slots_used: 0,
    inventory_capacity: 10,
    equipment: {
      weapon: null,
      armor: null,
      helm: null,
      hands: null,
      accessory: null,
    },
    gold: 0,
    position: {
      floor: 1,
      room_id: "room-1",
      tile: { x: 1, y: 1 },
    },
    visible_tiles: [],
    known_map: { floors: {} },
    visible_entities: [],
    room_text: null,
    recent_events: [],
    legal_actions: [{ type: "wait" }],
    realm_info: {
      template_name: "tutorial-cellar",
      floor_count: 1,
      current_floor: 1,
      status: "active",
    },
    ...overrides,
  }
}

describe("player agent strategy", () => {
  it("attacks a visible enemy when an attack is legal", () => {
    const observation = makeObservation({
      visible_entities: [
        {
          id: "enemy-1",
          type: "enemy",
          name: "Rat",
          position: { x: 2, y: 1 },
          hp_current: 3,
          hp_max: 10,
        },
      ],
      legal_actions: [{ type: "attack", target_id: "enemy-1" }],
    })

    expect(decideAction(observation)).toEqual({
      type: "attack",
      target_id: "enemy-1",
    })
  })

  it("waits when no higher-priority action is available", () => {
    expect(decideAction(makeObservation())).toEqual({ type: "wait" })
  })
})
