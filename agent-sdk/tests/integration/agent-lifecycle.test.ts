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

  async getCurrentCharacter() {
    return this.request("/characters/me")
  }

  async getLobbyInventory() {
    return this.request("/lobby/shop/inventory")
  }

  async getLobbyShops() {
    return this.request("/lobby/shops")
  }

  async getMyRealms() {
    return this.request("/realms/mine")
  }

  async getRealmTemplates() {
    return this.request("/content/realms")
  }

  async getItemTemplates() {
    return this.request("/content/items")
  }

  async buyShopItem(input: { itemId: string; quantity?: number }) {
    return this.request("/lobby/shop/buy", {
      method: "POST",
      body: JSON.stringify({ item_id: input.itemId, quantity: input.quantity ?? 1 }),
    })
  }

  async sellShopItem(input: { itemId: string; quantity?: number }) {
    return this.request("/lobby/shop/sell", {
      method: "POST",
      body: JSON.stringify({ item_id: input.itemId, quantity: input.quantity ?? 1 }),
    })
  }

  async discardLobbyItem(itemId: string) {
    return this.request("/lobby/discard", {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    })
  }

  async equipLobbyItem(itemId: string) {
    return this.request("/lobby/equip", {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    })
  }

  async unequipLobbySlot(slot: string) {
    return this.request("/lobby/unequip", {
      method: "POST",
      body: JSON.stringify({ slot }),
    })
  }

  async useLobbyConsumable(itemId: string) {
    return this.request("/lobby/use-consumable", {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    })
  }

  async restAtInn() {
    return this.request("/lobby/inn/rest", { method: "POST" })
  }

  disconnect(): void {}

  disconnectLobby(): void {}

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    this.requests.push({ path, options })
    if (path === "/lobby/shop/inventory") {
      const character = await this.requestHandler("/characters/me", options)
      return {
        gold: (character as { gold?: number }).gold ?? 0,
        inventory: [],
      } as T
    }
    if (path === "/lobby/shops") {
      return { sections: [], featured: [] } as T
    }
    if (path === "/content/items") {
      return { items: [] } as T
    }
    if (path === "/lobby/shop/buy") {
      return { gold: 0, item: null, message: "ok" } as T
    }
    if (path === "/lobby/shop/sell") {
      return {
        gold: 0,
        sold: { item_id: "", template_id: "", quantity: 1, total_gold: 0 },
        message: "ok",
      } as T
    }
    if (path === "/lobby/discard" || path === "/lobby/use-consumable" || path === "/lobby/inn/rest") {
      return { message: "ok" } as T
    }
    if (path === "/lobby/equip" || path === "/lobby/unequip") {
      return { inventory: [], message: "ok" } as T
    }
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
          continueOnExtraction: false,
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
        realmProgression: {
          strategy: "auto",
          continueOnExtraction: false,
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
          continueOnExtraction: false,
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
                status: "alive",
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

            // Some stacks return 404 for dead; others return 200 with a non-alive status — both must re-roll.
            return {
              id: "char-1",
              class: "rogue",
              name: "Shade",
              status: "dead",
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
        realmProgression: {
          strategy: "auto",
          continueOnExtraction: false,
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

    expect(client.requests.some(({ path }) => path === "/characters/roll")).toBeTrue()
    expect(client.connectedRealmIds).toHaveLength(2)
    expect(client.connectedRealmIds[0]).not.toBe(client.connectedRealmIds[1])
  })

  it("sells incompatible gear and discards unsellable junk during lobby cleanup", async () => {
    const requests: RequestRecord[] = []
    let gold = 12
    let inventory = [
      {
        id: "item-1",
        template_id: "weapon-short-bow",
        name: "Short Bow",
        slot: null,
        quantity: 1,
        modifiers: { attack: 4 },
      },
      {
        id: "item-2",
        template_id: "quest-trophy",
        name: "Quest Trophy",
        slot: null,
        quantity: 1,
        modifiers: {},
      },
      {
        id: "item-3",
        template_id: "health-potion",
        name: "Health Potion",
        slot: null,
        quantity: 1,
        modifiers: {},
      },
    ]

    const client = {
      connectedRealmIds: [] as string[],
      async connect(
        realmId: string,
        handlers: {
          onExtracted?: (payload: {
            loot_summary: Observation["inventory"]
            xp_gained: number
            gold_gained: number
            realm_completed: boolean
          }) => void | Promise<void>
        },
      ): Promise<void> {
        this.connectedRealmIds.push(realmId)
        await handlers.onExtracted?.({
          loot_summary: [],
          xp_gained: 5,
          gold_gained: 0,
          realm_completed: true,
        })
      },
      async connectLobby(): Promise<void> {},
      disconnect(): void {},
      disconnectLobby(): void {},
      sendAction(): void {},
      on(): void {},
      off(): void {},
      async getCurrentCharacter() {
        return {
          id: "char-1",
          class: "rogue",
          name: "Shade",
          gold,
          hp_current: 40,
          hp_max: 40,
          resource_current: 20,
          resource_max: 20,
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
      },
      async getLobbyInventory() {
        return { gold, inventory }
      },
      async getLobbyShops() {
        return { sections: [], featured: [] }
      },
      async getItemTemplates() {
        return {
          items: [
            {
              id: "weapon-short-bow",
              name: "Short Bow",
              type: "equipment",
              rarity: "common",
              equip_slot: "weapon",
              class_restriction: "archer",
              stats: { attack: 4 },
              effects: [],
              stack_limit: 1,
              sell_price: 7,
              buy_price: 15,
              ammo_type: "ammo-arrows-10",
            },
            {
              id: "quest-trophy",
              name: "Quest Trophy",
              type: "loot",
              rarity: "common",
              equip_slot: null,
              class_restriction: null,
              stats: {},
              effects: [],
              stack_limit: 1,
              sell_price: 0,
              buy_price: 0,
              ammo_type: null,
            },
            {
              id: "health-potion",
              name: "Health Potion",
              type: "consumable",
              rarity: "common",
              equip_slot: null,
              class_restriction: null,
              stats: {},
              effects: [{ type: "heal-hp", magnitude: 20 }],
              stack_limit: 5,
              sell_price: 1,
              buy_price: 5,
              ammo_type: null,
            },
          ],
        }
      },
      async getMyRealms() {
        return {
          realms: [{ id: "realm-1", template_id: "test-tutorial", status: "generated" }],
        }
      },
      async getRealmTemplates() {
        return { templates: [] }
      },
      async sellShopItem(input: { itemId: string; quantity?: number }) {
        requests.push({
          path: "/lobby/shop/sell",
          options: {
            method: "POST",
            body: JSON.stringify({ item_id: input.itemId, quantity: input.quantity ?? 1 }),
          },
        })
        const item = inventory.find((entry) => entry.id === input.itemId)
        if (!item) {
          throw new Error(`Missing inventory item: ${input.itemId}`)
        }
        inventory = inventory.filter((entry) => entry.id !== item.id)
        gold += 7
        return {
          gold,
          sold: {
            item_id: item.id,
            template_id: item.template_id,
            quantity: input.quantity ?? 1,
            total_gold: 7,
          },
          message: "Sold item.",
        }
      },
      async discardLobbyItem(itemId: string) {
        requests.push({
          path: "/lobby/discard",
          options: {
            method: "POST",
            body: JSON.stringify({ item_id: itemId }),
          },
        })
        inventory = inventory.filter((entry) => entry.id !== itemId)
        return { message: "Discarded item." }
      },
      async buyShopItem() {
        throw new Error("Unexpected buy")
      },
      async equipLobbyItem() {
        throw new Error("Unexpected equip")
      },
      async unequipLobbySlot() {
        throw new Error("Unexpected unequip")
      },
      async useLobbyConsumable() {
        throw new Error("Unexpected use")
      },
      async restAtInn() {
        throw new Error("Unexpected inn rest")
      },
      async request<T>(path: string): Promise<T> {
        if (path === "/characters/me") {
          return this.getCurrentCharacter() as Promise<T>
        }
        throw new Error(`Unexpected raw request: ${path}`)
      },
    }

    const agent = new BaseAgent(
      createDefaultConfig({
        apiUrl: "https://example.com",
        wsUrl: "wss://example.com",
        realmTemplateId: "test-tutorial",
        realmProgression: {
          strategy: "auto",
          continueOnExtraction: false,
        },
        lobby: {
          useLLM: false,
          autoSellJunk: true,
          autoEquipUpgrades: false,
          buyPotionMinimum: 0,
          buyPortalScroll: false,
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

    expect(requests.some(({ path, options }) =>
      path === "/lobby/shop/sell" && String(options.body).includes("\"item-1\""),
    )).toBeTrue()
    expect(requests.some(({ path, options }) =>
      path === "/lobby/discard" && String(options.body).includes("\"item-2\""),
    )).toBeTrue()
    expect(inventory.map((item) => item.id)).toEqual(["item-3"])
    expect(gold).toBe(19)
    expect(client.connectedRealmIds).toEqual(["realm-1"])
  })
})
