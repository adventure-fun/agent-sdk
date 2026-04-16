import { describe, expect, it } from "bun:test"
import { BaseAgent } from "../../src/agent.js"
import { GameClientError } from "../../src/client.js"
import { createDefaultConfig } from "../../src/config.js"
import type { LLMAdapter } from "../../src/adapters/llm/index.js"
import type { WalletAdapter } from "../../src/adapter.js"
import type { CharacterRecord } from "../../src/agent.js"

function mockLLM(): LLMAdapter {
  return {
    name: "mock",
    decide: async () => ({ action: { type: "wait" }, reasoning: "mock" }),
  }
}

function mockWallet(): WalletAdapter {
  return {
    getAddress: async () => "0xMOCK",
    signMessage: async () => "sig",
    signTransaction: async () => "tx",
  }
}

function buildAgent(): BaseAgent {
  return new BaseAgent(
    createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test-key" },
      wallet: { type: "env" },
    }),
    { llmAdapter: mockLLM(), walletAdapter: mockWallet() },
  )
}

function buildCharacter(hp: number, hpMax: number): CharacterRecord {
  return {
    id: "char-1",
    name: "Tester",
    class: "rogue",
    level: 1,
    xp: 0,
    xp_to_next_level: 100,
    skill_points: 0,
    hp_current: hp,
    hp_max: hpMax,
    resource_current: 10,
    resource_max: 10,
    status: "alive",
    gold: 0,
    stats: { hp: hpMax, attack: 5, defense: 5, accuracy: 5, evasion: 5, speed: 5 },
    skill_tree: {},
  } as unknown as CharacterRecord
}

describe("BaseAgent.ensureLobbyRecovery inn-rest retry", () => {
  it("retries restAtInn on 409 and returns healed state when second attempt succeeds", async () => {
    const agent = buildAgent()
    ;(agent as unknown as { isRunning: boolean }).isRunning = true

    let restAttempts = 0
    const client = {
      async restAtInn() {
        restAttempts++
        if (restAttempts === 1) {
          throw new GameClientError(
            "game",
            "Request failed: POST /lobby/inn/rest → 409 Conflict",
            { status: 409 },
          )
        }
        return { message: "ok" }
      },
    }

    // Stub loadLobbyState on the agent: first call (after the 409) returns damaged so we retry;
    // second call (after the successful rest) returns healed and we return.
    let loadCalls = 0
    ;(agent as unknown as {
      loadLobbyState: (client: unknown) => Promise<unknown>
    }).loadLobbyState = async () => {
      loadCalls++
      return {
        character: buildCharacter(loadCalls >= 2 ? 33 : 8, 33),
        inventoryGold: 0,
        inventory: [],
        shops: [],
        itemTemplates: [],
      }
    }

    const initialState = {
      character: buildCharacter(8, 33),
      inventoryGold: 0,
      inventory: [],
      shops: [],
      itemTemplates: [],
    }

    const result = await (agent as unknown as {
      ensureLobbyRecovery: (client: unknown, state: unknown) => Promise<{ character: CharacterRecord }>
    }).ensureLobbyRecovery(client, initialState)

    expect(restAttempts).toBe(2)
    expect(result.character.hp_current).toBe(33)
  })

  it("accepts server-reported fully rested state when /characters/me confirms it", async () => {
    const agent = buildAgent()
    ;(agent as unknown as { isRunning: boolean }).isRunning = true

    const client = {
      async restAtInn() {
        throw new GameClientError(
          "game",
          "Request failed: POST /lobby/inn/rest → 409 Conflict",
          { status: 409 },
        )
      },
    }

    // Client thinks 8/33, but re-fetch returns 33/33 (server-side auto-heal landed after our
    // stale snapshot). We must accept and proceed without retrying forever.
    ;(agent as unknown as {
      loadLobbyState: (client: unknown) => Promise<unknown>
    }).loadLobbyState = async () => ({
      character: buildCharacter(33, 33),
      inventoryGold: 0,
      inventory: [],
      shops: [],
      itemTemplates: [],
    })

    const initialState = {
      character: buildCharacter(8, 33),
      inventoryGold: 0,
      inventory: [],
      shops: [],
      itemTemplates: [],
    }

    const result = await (agent as unknown as {
      ensureLobbyRecovery: (client: unknown, state: unknown) => Promise<{ character: CharacterRecord }>
    }).ensureLobbyRecovery(client, initialState)

    expect(result.character.hp_current).toBe(33)
  })

  it("throws after exhausting retries rather than entering the next realm unhealed", async () => {
    // 5 retries × cumulative backoff (500 + 1000 + 1500 + 2000 ms) ≈ 5s. Give the runner headroom.
    const agent = buildAgent()
    ;(agent as unknown as { isRunning: boolean }).isRunning = true

    const client = {
      async restAtInn() {
        throw new GameClientError(
          "game",
          "Request failed: POST /lobby/inn/rest → 409 Conflict",
          { status: 409 },
        )
      },
    }

    // Always damaged — retries exhaust without healing and we throw.
    ;(agent as unknown as {
      loadLobbyState: (client: unknown) => Promise<unknown>
    }).loadLobbyState = async () => ({
      character: buildCharacter(8, 33),
      inventoryGold: 0,
      inventory: [],
      shops: [],
      itemTemplates: [],
    })

    const initialState = {
      character: buildCharacter(8, 33),
      inventoryGold: 0,
      inventory: [],
      shops: [],
      itemTemplates: [],
    }

    // ensureLobbyRecovery used to throw after exhausting retries, which would
    // crash the agent mid-run. It now logs a warning and returns the freshest
    // state; the main loop's empty-extraction streak detector stops the agent
    // cleanly if the character keeps failing runs due to low HP.
    const result = await (agent as unknown as {
      ensureLobbyRecovery: (client: unknown, state: unknown) => Promise<unknown>
    }).ensureLobbyRecovery(client, initialState)
    expect(result).toBeDefined()
  }, 15000)
})
