import { describe, expect, it } from "bun:test"
import type { Observation } from "@adventure-fun/schemas"
import {
  addSpectator,
  broadcastSpectatorObservation,
  closeSpectators,
  removeSpectator,
} from "../src/game/spectators.js"

function createObservation(): Observation {
  return {
    turn: 12,
    character: {
      id: "char-1",
      class: "mage",
      level: 7,
      xp: 900,
      xp_to_next_level: 100,
      skill_points: 2,
      hp: { current: 28, max: 40 },
      resource: { type: "mana", current: 12, max: 20 },
      buffs: [],
      debuffs: [],
      cooldowns: {},
      abilities: [],
      base_stats: { hp: 40, attack: 10, defense: 6, accuracy: 12, evasion: 8, speed: 9 },
      effective_stats: { hp: 40, attack: 10, defense: 6, accuracy: 12, evasion: 8, speed: 9 },
      skill_tree: {},
    },
    inventory: [],
    equipment: { weapon: null, armor: null, accessory: null, "class-specific": null },
    gold: 40,
    position: { floor: 2, room_id: "room-2", tile: { x: 3, y: 4 } },
    visible_tiles: [],
    visible_entities: [
      { id: "enemy-1", type: "enemy", name: "Ghoul", position: { x: 4, y: 4 }, hp_current: 10, hp_max: 20 },
    ],
    recent_events: [{ turn: 12, type: "enemy_attack", detail: "Ghoul claws the mage.", data: {} }],
    room_text: "A damp crypt chamber.",
    legal_actions: [],
    known_map: {
      total_floors: 3,
      current_floor: 2,
      discovered_tiles: [],
      rooms_visited: [],
    },
    realm_info: {
      template_id: "sunken-crypt",
      template_name: "Sunken Crypt",
      current_floor: 2,
      total_floors: 3,
      status: "active",
    },
  } as unknown as Observation
}

describe("11.5 — spectator helpers", () => {
  it("adds and removes spectators from the session set", () => {
    const spectators = new Set<{ send(payload: string): void; close(): void }>()
    const socket = { send() {}, close() {} }

    expect(addSpectator(spectators, socket)).toBe(1)
    expect(removeSpectator(spectators, socket)).toBe(0)
  })

  it("broadcasts spectator-safe observations", () => {
    const sent: string[] = []
    const spectators = new Set([{ send: (payload: string) => sent.push(payload), close() {} }])

    broadcastSpectatorObservation(spectators, createObservation())

    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]!)).toEqual({
      type: "observation",
      data: {
        turn: 12,
        character: {
          id: "char-1",
          class: "mage",
          level: 7,
          hp_percent: 70,
          resource_percent: 60,
        },
        position: { floor: 2, room_id: "room-2", tile: { x: 3, y: 4 } },
        visible_tiles: [],
        known_map: {
          total_floors: 3,
          current_floor: 2,
          discovered_tiles: [],
          rooms_visited: [],
        },
        visible_entities: [
          {
            id: "enemy-1",
            type: "enemy",
            name: "Ghoul",
            position: { x: 4, y: 4 },
            health_indicator: "medium",
          },
        ],
        room_text: "A damp crypt chamber.",
        recent_events: [{ turn: 12, type: "enemy_attack", detail: "Ghoul claws the mage.", data: {} }],
        realm_info: {
          template_id: "sunken-crypt",
          template_name: "Sunken Crypt",
          current_floor: 2,
          total_floors: 3,
          status: "active",
        },
      },
    })
  })

  it("notifies and closes spectators when a session ends", () => {
    const sent: string[] = []
    let closed = 0
    const spectators = new Set([
      {
        send: (payload: string) => sent.push(payload),
        close: () => {
          closed += 1
        },
      },
    ])

    closeSpectators(spectators, "death")

    expect(sent).toEqual([JSON.stringify({ type: "session_ended", reason: "death" })])
    expect(closed).toBe(1)
    expect(spectators.size).toBe(0)
  })
})
