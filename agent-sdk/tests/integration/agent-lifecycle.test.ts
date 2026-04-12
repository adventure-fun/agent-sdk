import { describe, expect, it } from "bun:test"
import { BaseAgent } from "../../src/agent.js"
import { createDefaultConfig } from "../../src/config.js"
import type { Observation } from "../../src/protocol.js"
import type { SessionToken } from "../../src/auth.js"
import { MockLLMAdapter } from "../helpers/mock-llm.js"
import { MockWalletAdapter } from "../helpers/mock-wallet.js"

type RequestRecord = {
  path: string
  options: RequestInit
}

type ConnectPlanStep =
  | { outcome: "extracted" }
  | { outcome: "death" }

class StubClient {
  readonly requests: RequestRecord[] = []
  readonly connectedRealmIds: string[] = []

  private readonly connectPlan: ConnectPlanStep[]
  private readonly requestHandler: (path: string, options: RequestInit) => Promise<unknown>

  constructor(args: {
    connectPlan: ConnectPlanStep[]
    requestHandler: (path: string, options: RequestInit) => Promise<unknown>
  }) {
    this.connectPlan = [...args.connectPlan]
    this.requestHandler = args.requestHandler
  }

  async connect(
    realmId: string,
    handlers: {
      onObservation?: (observation: Observation) => void | Promise<void>
      onDeath?: (payload: { cause: string; floor: number; room: string; turn: number }) => void
      onExtracted?: (payload: {
        loot_summary: Observation["inventory"]
        xp_gained: number
        gold_gained: number
        completion_bonus?: { xp: number; gold: number }
        realm_completed: boolean
      }) => void | Promise<void>
    },
  ): Promise<void> {
    this.connectedRealmIds.push(realmId)
    const step = this.connectPlan.shift()
    if (!step) {
      throw new Error("No connect plan step configured")
    }

    if (step.outcome === "death") {
      handlers.onDeath?.({ cause: "test", floor: 1, room: "r1", turn: 5 })
      return
    }

    await handlers.onExtracted?.({
      loot_summary: [],
      xp_gained: 25,
      gold_gained: 10,
      realm_completed: true,
    })
  }

  async connectLobby(): Promise<void> {}

  disconnect(): void {}

  disconnectLobby(): void {}

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    this.requests.push({ path, options })
    return this.requestHandler(path, options) as Promise<T>
  }

  sendAction(): void {}

  on(): void {}

  off(): void {}
}

describe("BaseAgent lifecycle enhancements", () => {
  it("updates profile, rerolls only bad stats, spends skill points, and regenerates completed realms", async () => {
    const requestCounts = new Map<string, number>()
    const client = new StubClient({
      connectPlan: [{ outcome: "extracted" }],
      requestHandler: async (path) => {
        requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1)

        switch (path) {
          case "/auth/profile":
            return { handle: "shade", x_handle: "shade_x", github_handle: "shadehub" }
          case "/characters/me":
            return {
              id: "char-1",
              class: "rogue",
              name: "Shade",
              stat_rerolled: false,
              stats: {
                hp: 20,
                attack: 5,
                defense: 5,
                accuracy: 5,
                evasion: 5,
                speed: 5,
              },
            }
          case "/characters/reroll-stats":
            return {
              id: "char-1",
              class: "rogue",
              name: "Shade",
              stat_rerolled: true,
              stats: {
                hp: 30,
                attack: 8,
                defense: 7,
                accuracy: 9,
                evasion: 9,
                speed: 10,
              },
            }
          case "/characters/progression":
            return {
              skill_points: 1,
              skill_tree_unlocked: {},
            }
          case "/characters/skill":
            return { ok: true }
          case "/realms/mine":
            return {
              realms: [{ id: "realm-1", template_id: "test-tutorial", status: "completed" }],
            }
          case "/realms/realm-1/regenerate":
            return { id: "realm-1", template_id: "test-tutorial", status: "generated" }
          default:
            throw new Error(`Unexpected request path: ${path}`)
        }
      },
    })

    const agent = new BaseAgent(
      createDefaultConfig({
        apiUrl: "https://example.com",
        wsUrl: "wss://example.com",
        realmTemplateId: "test-tutorial",
        characterClass: "rogue",
        characterName: "Shade",
        rerollStats: {
          enabled: true,
          minTotal: 50,
        },
        realmProgression: {
          strategy: "regenerate",
        },
        profile: {
          handle: "shade",
          xHandle: "shade_x",
          githubHandle: "shadehub",
        },
        skillTree: {
          autoSpend: true,
          preferredNodes: ["shadowstep"],
        },
        llm: {
          provider: "openai",
          apiKey: "test-key",
        },
        wallet: {
          type: "env",
        },
      }),
      {
        llmAdapter: new MockLLMAdapter(),
        walletAdapter: new MockWalletAdapter(),
        authenticateFn: async (): Promise<SessionToken> => ({
          token: "session-token",
          expires_at: Date.now() + 60_000,
        }),
        clientFactory: async () => client,
      },
    )

    await agent.start()

    expect(requestCounts.get("/auth/profile")).toBe(1)
    expect(requestCounts.get("/characters/reroll-stats")).toBe(1)
    expect(requestCounts.get("/characters/skill")).toBe(1)
    expect(requestCounts.get("/realms/realm-1/regenerate")).toBe(1)
    expect(client.connectedRealmIds).toEqual(["realm-1"])
  })

  it("skips rerolling when the rolled stats are acceptable", async () => {
    const requestCounts = new Map<string, number>()
    const client = new StubClient({
      connectPlan: [{ outcome: "extracted" }],
      requestHandler: async (path) => {
        requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1)

        switch (path) {
          case "/characters/me":
            return {
              id: "char-1",
              class: "rogue",
              name: "Shade",
              stat_rerolled: false,
              stats: {
                hp: 40,
                attack: 10,
                defense: 10,
                accuracy: 10,
                evasion: 10,
                speed: 10,
              },
            }
          case "/realms/mine":
            return {
              realms: [{ id: "realm-1", template_id: "test-tutorial", status: "generated" }],
            }
          default:
            throw new Error(`Unexpected request path: ${path}`)
        }
      },
    })

    const agent = new BaseAgent(
      createDefaultConfig({
        apiUrl: "https://example.com",
        wsUrl: "wss://example.com",
        realmTemplateId: "test-tutorial",
        rerollStats: {
          enabled: true,
          minTotal: 40,
        },
        llm: {
          provider: "openai",
          apiKey: "test-key",
        },
        wallet: {
          type: "env",
        },
      }),
      {
        llmAdapter: new MockLLMAdapter(),
        walletAdapter: new MockWalletAdapter(),
        authenticateFn: async (): Promise<SessionToken> => ({
          token: "session-token",
          expires_at: Date.now() + 60_000,
        }),
        clientFactory: async () => client,
      },
    )

    await agent.start()

    expect(requestCounts.get("/characters/reroll-stats") ?? 0).toBe(0)
  })

  it("advances to the next template when realm progression is new-realm", async () => {
    const client = new StubClient({
      connectPlan: [{ outcome: "extracted" }],
      requestHandler: async (path) => {
        switch (path) {
          case "/characters/me":
            return {
              id: "char-1",
              class: "rogue",
              name: "Shade",
              stat_rerolled: false,
              stats: {
                hp: 40,
                attack: 10,
                defense: 10,
                accuracy: 10,
                evasion: 10,
                speed: 10,
              },
            }
          case "/realms/mine":
            return {
              realms: [{ id: "realm-1", template_id: "tutorial-cellar", status: "completed" }],
            }
          case "/realms/generate":
            return { id: "realm-2", template_id: "collapsed-mines", status: "generated" }
          default:
            throw new Error(`Unexpected request path: ${path}`)
        }
      },
    })

    const agent = new BaseAgent(
      createDefaultConfig({
        apiUrl: "https://example.com",
        wsUrl: "wss://example.com",
        realmTemplateId: "tutorial-cellar",
        realmProgression: {
          strategy: "new-realm",
          templatePriority: ["tutorial-cellar", "collapsed-mines"],
        },
        llm: {
          provider: "openai",
          apiKey: "test-key",
        },
        wallet: {
          type: "env",
        },
      }),
      {
        llmAdapter: new MockLLMAdapter(),
        walletAdapter: new MockWalletAdapter(),
        authenticateFn: async (): Promise<SessionToken> => ({
          token: "session-token",
          expires_at: Date.now() + 60_000,
        }),
        clientFactory: async () => client,
      },
    )

    await agent.start()

    expect(client.requests.some(({ path, options }) =>
      path === "/realms/generate" && String(options.body).includes("collapsed-mines"),
    )).toBeTrue()
    expect(client.connectedRealmIds).toEqual(["realm-2"])
  })

  it("rolls a new character and continues after death when rerollOnDeath is enabled", async () => {
    let meCalls = 0
    const client = new StubClient({
      connectPlan: [{ outcome: "death" }, { outcome: "extracted" }],
      requestHandler: async (path) => {
        switch (path) {
          case "/characters/me":
            meCalls += 1
            if (meCalls === 1) {
              return {
                id: "char-1",
                class: "rogue",
                name: "Shade",
                stat_rerolled: false,
                stats: {
                  hp: 40,
                  attack: 10,
                  defense: 10,
                  accuracy: 10,
                  evasion: 10,
                  speed: 10,
                },
              }
            }

            throw Object.assign(new Error("No living character"), { status: 404 })
          case "/characters/roll":
            return {
              id: "char-2",
              class: "rogue",
              name: "Shade II",
              stat_rerolled: false,
              stats: {
                hp: 41,
                attack: 10,
                defense: 10,
                accuracy: 10,
                evasion: 10,
                speed: 10,
              },
            }
          case "/realms/mine":
            return {
              realms: [{ id: `realm-${meCalls}`, template_id: "test-tutorial", status: "generated" }],
            }
          default:
            throw new Error(`Unexpected request path: ${path}`)
        }
      },
    })

    const agent = new BaseAgent(
      createDefaultConfig({
        apiUrl: "https://example.com",
        wsUrl: "wss://example.com",
        realmTemplateId: "test-tutorial",
        characterClass: "rogue",
        characterName: "Shade II",
        rerollOnDeath: true,
        llm: {
          provider: "openai",
          apiKey: "test-key",
        },
        wallet: {
          type: "env",
        },
      }),
      {
        llmAdapter: new MockLLMAdapter(),
        walletAdapter: new MockWalletAdapter(),
        authenticateFn: async (): Promise<SessionToken> => ({
          token: "session-token",
          expires_at: Date.now() + 60_000,
        }),
        clientFactory: async () => client,
      },
    )

    await agent.start()

    expect(client.requests.some(({ path }) => path === "/characters/roll")).toBeTrue()
    expect(client.connectedRealmIds).toEqual(["realm-1", "realm-2"])
  })
})
