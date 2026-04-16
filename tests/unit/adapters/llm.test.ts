import { describe, expect, it } from "bun:test"
import {
  buildActionToolSchema,
  buildDecisionPrompt,
  buildSystemPrompt,
  parseActionFromJSON,
  parseActionFromText,
} from "../../../src/adapters/llm/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  attackAction,
  buildObservation,
  enemy,
  moveAction,
  portalAction,
  waitAction,
} from "../../helpers/mock-observation.js"

describe("LLM adapter shared helpers", () => {
  it("builds a system prompt that documents supported actions", () => {
    const prompt = buildSystemPrompt(
      createDefaultConfig({
        characterName: "Scout",
        llm: { provider: "openrouter", apiKey: "test-key" },
        wallet: { type: "env" },
      }),
    )

    expect(prompt).toContain("Scout")
    expect(prompt).toContain("choose_action")
    expect(prompt).toContain('"move"')
    expect(prompt).toContain('"attack"')
    expect(prompt).toContain('"disarm_trap"')
    expect(prompt).toContain('"use_item"')
    expect(prompt).toContain('"equip"')
    expect(prompt).toContain('"unequip"')
    expect(prompt).toContain('"inspect"')
    expect(prompt).toContain('"interact"')
    expect(prompt).toContain('"use_portal"')
    expect(prompt).toContain('"retreat"')
    expect(prompt).toContain('"wait"')
    expect(prompt).toContain('"pickup"')
    expect(prompt).toContain('"drop"')
  })

  it("builds a decision prompt with observation, module, and history context", () => {
    const observation = buildObservation({
      turn: 7,
      visible_entities: [enemy("goblin-1")],
      legal_actions: [attackAction("goblin-1"), moveAction("left"), waitAction()],
      room_text: "A goblin blocks the corridor.",
    })

    const prompt = buildDecisionPrompt(
      observation,
      [
        {
          moduleName: "combat",
          suggestedAction: attackAction("goblin-1"),
          reasoning: "Enemy is adjacent and vulnerable.",
          confidence: 0.9,
        },
      ],
      [
        {
          turn: 6,
          action: moveAction("up"),
          reasoning: "Exploring north.",
          observation_summary: "Turn 6, HP:25/30",
        },
      ],
    )

    expect(prompt).toContain("Turn: 7")
    expect(prompt).toContain("A goblin blocks the corridor.")
    expect(prompt).toContain("Enemy is adjacent and vulnerable.")
    expect(prompt).toContain('"type": "attack"')
    expect(prompt).toContain("Turn 6")
    expect(prompt).toContain('"type": "wait"')
  })

  it("builds a provider-agnostic action tool schema", () => {
    const schema = buildActionToolSchema()

    expect(schema.name).toBe("choose_action")
    expect(schema.input_schema.type).toBe("object")
    expect(schema.input_schema.required).toContain("action")
    expect(schema.input_schema.required).toContain("reasoning")

    const actionSchema = schema.input_schema.properties.action
    expect(actionSchema.type).toBe("object")
    // Flat schema: type is an enum of all action types, other fields are optional and
    // conditionally relevant based on the chosen type. This shape works across OpenAI,
    // Anthropic, and Google Gemini function-calling implementations — Gemini struggles
    // with `oneOf` discriminated unions.
    expect(actionSchema.properties).toBeDefined()
    expect(actionSchema.properties?.type).toBeDefined()
    expect(actionSchema.properties?.type?.enum).toBeArray()
    expect(actionSchema.properties?.type?.enum).toHaveLength(13)
    expect(actionSchema.required).toContain("type")
  })

  it("parses valid JSON actions and rejects invalid ones", () => {
    const legalActions = [moveAction("up"), attackAction("goblin-1"), waitAction()]

    expect(
      parseActionFromJSON(
        {
          action: { type: "attack", target_id: "goblin-1" },
          reasoning: "Attack the goblin.",
        },
        legalActions,
      ),
    ).toEqual(attackAction("goblin-1"))

    expect(
      parseActionFromJSON(
        {
          action: { type: "attack", target_id: "other-goblin" },
          reasoning: "Invalid target.",
        },
        legalActions,
      ),
    ).toBeNull()

    expect(
      parseActionFromJSON(
        {
          action: { type: "move", direction: "north" },
          reasoning: "Bad direction.",
        },
        legalActions,
      ),
    ).toBeNull()
  })

  it("parses JSON embedded in markdown or raw text", () => {
    const legalActions = [attackAction("goblin-1"), portalAction(), waitAction()]

    expect(
      parseActionFromText(
        '```json\n{"action":{"type":"attack","target_id":"goblin-1"},"reasoning":"Strike now."}\n```',
        legalActions,
      ),
    ).toEqual(attackAction("goblin-1"))

    expect(
      parseActionFromText(
        'Decision:\n{"action":{"type":"use_portal"},"reasoning":"Leave safely."}',
        legalActions,
      ),
    ).toEqual(portalAction())

    expect(parseActionFromText("No valid JSON here.", legalActions)).toBeNull()
  })

  it("returns null when legal actions are empty or action type is unknown", () => {
    expect(
      parseActionFromJSON(
        {
          action: { type: "sing" },
          reasoning: "Not a game action.",
        },
        [],
      ),
    ).toBeNull()

    expect(parseActionFromText('{"action":{"type":"wait"},"reasoning":"Wait."}', [])).toBeNull()
  })
})
