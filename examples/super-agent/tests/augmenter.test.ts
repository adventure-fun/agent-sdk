import { describe, expect, it } from "bun:test"
import type {
  ActionPlan,
  DecisionPrompt,
  DecisionResult,
  LLMAdapter,
  PlanningPrompt,
} from "../../../src/index.js"
import { AbilityAwareLLMAdapter } from "../src/llm/augmenter.js"
import { createDefaultClassProfileRegistry } from "../src/classes/index.js"
import { WorldModel } from "../src/world-model/world-model.js"
import { buildObservation, enemy } from "../../../tests/helpers/mock-observation.js"

class RecordingAdapter implements LLMAdapter {
  name = "recording"
  decideCalls: DecisionPrompt[] = []
  planCalls: PlanningPrompt[] = []

  async decide(prompt: DecisionPrompt): Promise<DecisionResult> {
    this.decideCalls.push(prompt)
    return { action: { type: "wait" }, reasoning: "noop" }
  }
  async plan(prompt: PlanningPrompt): Promise<ActionPlan> {
    this.planCalls.push(prompt)
    return { strategy: "noop", actions: [] }
  }
}

describe("AbilityAwareLLMAdapter", () => {
  const profiles = createDefaultClassProfileRegistry()

  it("injects the ability list and class rubric into the system prompt on decide()", async () => {
    const world = WorldModel.open(":memory:")
    const inner = new RecordingAdapter()
    const wrapper = new AbilityAwareLLMAdapter(inner, profiles, world)

    const observation = buildObservation({
      character: {
        class: "rogue",
        abilities: [
          {
            id: "rogue-backstab",
            name: "Backstab",
            description: "High single-target damage from stealth",
            resource_cost: 15,
            cooldown_turns: 3,
            current_cooldown: 0,
            range: "melee",
            target: "single",
          },
        ],
      },
      visible_entities: [enemy("e1")],
    })

    await wrapper.decide({
      observation,
      moduleRecommendations: [],
      legalActions: [],
      recentHistory: [],
      systemPrompt: "BASE",
    })

    expect(inner.decideCalls.length).toBe(1)
    const injected = inner.decideCalls[0]!.systemPrompt
    expect(injected).toContain("BASE")
    expect(injected).toContain("=== ABILITIES")
    expect(injected).toContain("rogue-backstab")
    expect(injected).toContain("Backstab")
    expect(injected).toContain("=== CLASS RUBRIC")
    expect(injected).toContain("Rogue tactical priorities")
    world.close()
  })

  it("adds cross-run memory when the world model has prior runs for this template+class", async () => {
    const world = WorldModel.open(":memory:")
    const runId = world.startRun("test-dungeon", "Test Dungeon", "rogue", 3)
    world.endRun(runId, {
      outcome: "extracted",
      floorReached: 4,
      turnsPlayed: 60,
      goldEarned: 200,
      xpEarned: 500,
      realmCompleted: true,
    })
    world.addRealmTip("test-dungeon", "rogue", "traps cluster on floor 2")

    const inner = new RecordingAdapter()
    const wrapper = new AbilityAwareLLMAdapter(inner, profiles, world)

    const observation = buildObservation({ character: { class: "rogue", abilities: [] } })
    await wrapper.decide({
      observation,
      moduleRecommendations: [],
      legalActions: [],
      recentHistory: [],
      systemPrompt: "",
    })

    const injected = inner.decideCalls[0]!.systemPrompt
    expect(injected).toContain("=== CROSS-RUN MEMORY")
    expect(injected).toContain("1 clears")
    expect(injected).toContain("traps cluster on floor 2")
    world.close()
  })

  it("forwards plan() with augmented system prompt", async () => {
    const world = WorldModel.open(":memory:")
    const inner = new RecordingAdapter()
    const wrapper = new AbilityAwareLLMAdapter(inner, profiles, world)

    const observation = buildObservation({ character: { class: "knight", abilities: [] } })
    await wrapper.plan({
      observation,
      moduleRecommendations: [],
      legalActions: [],
      recentHistory: [],
      systemPrompt: "STRATEGIC",
      planType: "strategic",
      maxActions: 8,
    })

    expect(inner.planCalls.length).toBe(1)
    const injected = inner.planCalls[0]!.systemPrompt
    expect(injected).toContain("STRATEGIC")
    expect(injected).toContain("Knight tactical priorities")
    world.close()
  })

  it("injects RETREAT MODE hint when realm is cleared and agent is not at entrance", async () => {
    const world = WorldModel.open(":memory:")
    const inner = new RecordingAdapter()
    const wrapper = new AbilityAwareLLMAdapter(inner, profiles, world)

    const observation = buildObservation({
      position: { floor: 1, room_id: "boss-room", tile: { x: 3, y: 3 } },
      realm_info: {
        status: "realm_cleared",
        entrance_room_id: "entrance-room",
      },
      character: { class: "rogue", abilities: [] },
    })

    await wrapper.decide({
      observation,
      moduleRecommendations: [],
      legalActions: [],
      recentHistory: [],
      systemPrompt: "",
      memorySnapshot: {
        seenItems: [],
        encounteredDoors: [],
        knownKeyTemplateIds: [],
        currentFloorKnownTiles: [],
        currentRoomStalls: null,
        visitedRoomCount: 3,
        visitedRoomIds: ["entrance-room", "hall-room", "boss-room"],
        roomConnections: [
          { fromRoomId: "entrance-room", direction: "right", toRoomId: "hall-room" },
          { fromRoomId: "hall-room", direction: "right", toRoomId: "boss-room" },
        ],
        turnsWithoutNewRoom: 0,
      },
    })

    const injected = inner.decideCalls[0]!.systemPrompt
    expect(injected).toContain("RETREAT MODE")
    expect(injected).toContain("BACKTRACK")
    expect(injected).toContain("entrance-room --right--> hall-room")
    expect(injected).toContain("hall-room --right--> boss-room")
    expect(injected).toContain("Rooms visited this run")
    world.close()
  })

  it("does not inject RETREAT MODE hint when realm is still active", async () => {
    const world = WorldModel.open(":memory:")
    const inner = new RecordingAdapter()
    const wrapper = new AbilityAwareLLMAdapter(inner, profiles, world)

    const observation = buildObservation({
      realm_info: { status: "active" },
      character: { class: "rogue", abilities: [] },
    })
    await wrapper.decide({
      observation,
      moduleRecommendations: [],
      legalActions: [],
      recentHistory: [],
      systemPrompt: "",
    })
    const injected = inner.decideCalls[0]!.systemPrompt
    expect(injected).not.toContain("RETREAT MODE")
    world.close()
  })

  it("degrades gracefully when memorySnapshot is absent in retreat mode", async () => {
    const world = WorldModel.open(":memory:")
    const inner = new RecordingAdapter()
    const wrapper = new AbilityAwareLLMAdapter(inner, profiles, world)

    const observation = buildObservation({
      position: { floor: 1, room_id: "boss-room", tile: { x: 3, y: 3 } },
      realm_info: {
        status: "boss_cleared",
        entrance_room_id: "entrance-room",
      },
      character: { class: "rogue", abilities: [] },
    })
    await wrapper.decide({
      observation,
      moduleRecommendations: [],
      legalActions: [],
      recentHistory: [],
      systemPrompt: "",
    })
    const injected = inner.decideCalls[0]!.systemPrompt
    expect(injected).toContain("RETREAT MODE")
    expect(injected).toContain("No room connections recorded yet")
    world.close()
  })

  it("injects VISIBLE INTERACTABLES hint when the agent can see a non-locked-exit interactable", async () => {
    const world = WorldModel.open(":memory:")
    const inner = new RecordingAdapter()
    const wrapper = new AbilityAwareLLMAdapter(inner, profiles, world)

    const observation = buildObservation({
      character: { class: "rogue", abilities: [] },
      visible_entities: [
        {
          id: "sc-sarcophagus",
          type: "interactable",
          name: "Sarcophagus",
          position: { x: 4, y: 3 },
        },
      ],
    })
    await wrapper.decide({
      observation,
      moduleRecommendations: [],
      legalActions: [],
      recentHistory: [],
      systemPrompt: "",
    })

    const injected = inner.decideCalls[0]!.systemPrompt
    expect(injected).toContain("VISIBLE INTERACTABLES")
    expect(injected).toContain("sc-sarcophagus")
    expect(injected).toContain("Sarcophagus")
    expect(injected).toContain("DO NOT trust room_text")
    world.close()
  })

  it("does not list locked exits under VISIBLE INTERACTABLES", async () => {
    const world = WorldModel.open(":memory:")
    const inner = new RecordingAdapter()
    const wrapper = new AbilityAwareLLMAdapter(inner, profiles, world)

    const observation = buildObservation({
      character: { class: "rogue", abilities: [] },
      visible_entities: [
        {
          id: "sc-iron-gate",
          type: "interactable",
          name: "Iron Gate",
          position: { x: 5, y: 3 },
          is_locked_exit: true,
        },
      ],
    })
    await wrapper.decide({
      observation,
      moduleRecommendations: [],
      legalActions: [],
      recentHistory: [],
      systemPrompt: "",
    })

    const injected = inner.decideCalls[0]!.systemPrompt
    expect(injected).not.toContain("VISIBLE INTERACTABLES")
    world.close()
  })

  it("injects LOCKED DOOR RECOVERY hint when a recent interact_blocked event fires", async () => {
    const world = WorldModel.open(":memory:")
    const inner = new RecordingAdapter()
    const wrapper = new AbilityAwareLLMAdapter(inner, profiles, world)

    const observation = buildObservation({
      character: { class: "rogue", abilities: [] },
      recent_events: [
        {
          turn: 25,
          type: "interact_blocked",
          detail: "The door is locked.",
          data: {},
        },
      ],
    })
    await wrapper.decide({
      observation,
      moduleRecommendations: [],
      legalActions: [],
      recentHistory: [],
      systemPrompt: "",
    })

    const injected = inner.decideCalls[0]!.systemPrompt
    expect(injected).toContain("LOCKED DOOR RECOVERY")
    expect(injected).toContain("go BACK through rooms")
  })

  it("injects UNPLACED KEY hint when the agent carries a key and the realm is active", async () => {
    const world = WorldModel.open(":memory:")
    const inner = new RecordingAdapter()
    const wrapper = new AbilityAwareLLMAdapter(inner, profiles, world)

    const observation = buildObservation({
      character: { class: "rogue", abilities: [] },
      inventory: [
        {
          item_id: "inv-1",
          template_id: "crypt-key",
          name: "Crypt Key",
          quantity: 1,
          modifiers: {},
        },
      ],
    })
    await wrapper.decide({
      observation,
      moduleRecommendations: [],
      legalActions: [],
      recentHistory: [],
      systemPrompt: "",
    })

    const injected = inner.decideCalls[0]!.systemPrompt
    expect(injected).toContain("UNPLACED KEY IN INVENTORY")
    expect(injected).toContain("Crypt Key")
    expect(injected).toContain("template_id=crypt-key")
  })

  it("does not inject UNPLACED KEY hint when the realm is already cleared", async () => {
    const world = WorldModel.open(":memory:")
    const inner = new RecordingAdapter()
    const wrapper = new AbilityAwareLLMAdapter(inner, profiles, world)

    const observation = buildObservation({
      character: { class: "rogue", abilities: [] },
      realm_info: { status: "realm_cleared" },
      inventory: [
        {
          item_id: "inv-1",
          template_id: "crypt-key",
          name: "Crypt Key",
          quantity: 1,
          modifiers: {},
        },
      ],
    })
    await wrapper.decide({
      observation,
      moduleRecommendations: [],
      legalActions: [],
      recentHistory: [],
      systemPrompt: "",
    })

    const injected = inner.decideCalls[0]!.systemPrompt
    expect(injected).not.toContain("UNPLACED KEY IN INVENTORY")
  })
})
