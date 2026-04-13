import { describe, expect, it } from "bun:test"
import { buildDecisionPrompt } from "./adapters/llm/index.js"
import { createDefaultConfig } from "./config.js"
import { createAgentContext } from "./modules/index.js"
import { ExplorationModule } from "./modules/exploration.js"
import type { Observation } from "./protocol.js"

describe("navigation improvements", () => {
  it("includes spatial context in the decision prompt", () => {
    const prompt = buildDecisionPrompt(createObservation(), [], [])

    expect(prompt).toContain("Spatial context:")
    expect(prompt).toContain("Position: (0, 0)")
    expect(prompt).toContain("- up: legal, destination floor at (0, -1)")
    expect(prompt).toContain("- left: illegal, destination wall at (-1, 0)")
  })

  it("avoids repeating a stalled move direction when alternatives exist", () => {
    const context = createAgentContext(
      createDefaultConfig({
        llm: { provider: "openai", apiKey: "test-key" },
        wallet: { type: "env" },
      }),
    )
    context.previousActions.push({
      turn: 0,
      action: { type: "move", direction: "up" },
      reasoning: "testing stalled movement",
    })
    context.mapMemory.lastPosition = {
      floor: 1,
      roomId: "room-a",
      x: 0,
      y: 0,
    }

    const module = new ExplorationModule()
    const recommendation = module.analyze(createObservation(), context)

    expect(recommendation.suggestedAction).toBeDefined()
    expect(recommendation.suggestedAction?.type).toBe("move")
    expect(
      (recommendation.suggestedAction as Extract<Observation["legal_actions"][number], { type: "move" }>).direction,
    ).not.toBe("up")
    expect(recommendation.reasoning).toContain("Exploring")
  })
})

function createObservation(): Observation {
  return {
    turn: 1,
    character: {
      id: "char-1",
      class: "rogue",
      level: 1,
      xp: 0,
      xp_to_next_level: 100,
      skill_points: 0,
      hp: { current: 20, max: 20 },
      resource: { type: "energy", current: 10, max: 10 },
      buffs: [],
      debuffs: [],
      cooldowns: {},
      abilities: [],
      base_stats: {
        hp: 20,
        attack: 5,
        defense: 5,
        accuracy: 5,
        evasion: 5,
        speed: 5,
      },
      effective_stats: {
        hp: 20,
        attack: 5,
        defense: 5,
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
      room_id: "room-a",
      tile: { x: 0, y: 0 },
    },
    visible_tiles: [
      { x: 0, y: 0, type: "floor", entities: [] },
      { x: 0, y: -1, type: "floor", entities: [] },
      { x: 1, y: 0, type: "floor", entities: [] },
      { x: -1, y: 0, type: "wall", entities: [] },
      { x: 0, y: 1, type: "door", entities: [] },
    ],
    known_map: { floors: { 1: { tiles: [], rooms_visited: [] } } },
    visible_entities: [],
    room_text: "A small entry room.",
    recent_events: [],
    legal_actions: [
      { type: "move", direction: "up" },
      { type: "move", direction: "right" },
      { type: "move", direction: "down" },
      { type: "wait" },
    ],
    realm_info: {
      template_id: "tutorial",
      template_name: "Tutorial",
      floor_count: 1,
      current_floor: 1,
      entrance_room_id: "room-a",
      status: "active",
    },
  }
}
