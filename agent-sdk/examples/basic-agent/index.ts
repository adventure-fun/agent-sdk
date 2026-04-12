import { BaseAgent, createDefaultConfig, createLLMAdapter, createWalletAdapter } from "../../src/index.js"

const config = createDefaultConfig({
  apiUrl: process.env.API_URL ?? "http://localhost:3001",
  wsUrl: process.env.WS_URL ?? "ws://localhost:3001",
  realmTemplateId: process.env.REALM_TEMPLATE ?? "test-tutorial",
  characterClass: process.env.CHARACTER_CLASS ?? "rogue",
  characterName: process.env.CHARACTER_NAME ?? "BasicAgent",
  llm: {
    provider: "openrouter",
    apiKey: process.env.LLM_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? "anthropic/claude-haiku-4.5",
  },
  wallet: {
    type: "env",
    network: (process.env.AGENT_WALLET_NETWORK ?? "base") as
      | "base"
      | "base-sepolia"
      | "solana"
      | "solana-devnet",
  },
})

const agent = new BaseAgent(config, {
  llmAdapter: createLLMAdapter(config.llm),
  walletAdapter: await createWalletAdapter(config.wallet),
})

agent.on("observation", (observation) => {
  console.log(
    `[observation] turn=${observation.turn} hp=${observation.character.hp.current}/${observation.character.hp.max} room=${observation.position.room_id}`,
  )
})

agent.on("action", ({ action, reasoning }) => {
  console.log(`[action] ${JSON.stringify(action)} | ${reasoning}`)
})

agent.on("death", ({ cause, floor, room }) => {
  console.log(`[death] cause=${cause} floor=${floor} room=${room}`)
})

agent.on("extracted", ({ gold_gained, xp_gained, realm_completed }) => {
  console.log(
    `[extracted] gold=${gold_gained} xp=${xp_gained} completed=${String(realm_completed)}`,
  )
})

agent.on("error", (error) => {
  console.error("[error]", error)
})

await agent.start()
import {
  BaseAgent,
  createDefaultConfig,
  createLLMAdapter,
  createWalletAdapter,
  type LLMProvider,
  type WalletNetwork,
} from "../../src/index.js"

const config = createDefaultConfig({
  apiUrl: process.env.API_URL ?? "http://localhost:3001",
  wsUrl: process.env.WS_URL ?? "ws://localhost:3001",
  realmTemplateId: process.env.REALM_TEMPLATE ?? "test-tutorial",
  characterClass: process.env.CHARACTER_CLASS ?? "rogue",
  characterName: process.env.CHARACTER_NAME ?? "BasicAgent",
  llm: {
    provider: (process.env.LLM_PROVIDER ?? "openrouter") as LLMProvider,
    apiKey: process.env.LLM_API_KEY ?? "",
    ...(process.env.LLM_MODEL ? { model: process.env.LLM_MODEL } : {}),
  },
  wallet: {
    type: "env",
    network: (process.env.AGENT_WALLET_NETWORK ?? "base") as WalletNetwork,
    ...(process.env.AGENT_PRIVATE_KEY ? { privateKey: process.env.AGENT_PRIVATE_KEY } : {}),
  },
})

const agent = new BaseAgent(config, {
  llmAdapter: createLLMAdapter(config.llm),
  walletAdapter: await createWalletAdapter(config.wallet),
})

agent.on("plannerDecision", (decision) => {
  console.log(`[${decision.tier}] ${decision.reasoning} | remaining plan steps: ${decision.planDepth}`)
})
agent.on("action", ({ action }) => console.log(`action -> ${JSON.stringify(action)}`))
agent.on("death", ({ cause }) => console.log(`death -> ${cause}`))
agent.on("extracted", ({ gold_gained, xp_gained }) => {
  console.log(`extracted -> gold ${gold_gained}, xp ${xp_gained}`)
})
agent.on("error", (error) => console.error("agent error:", error))

await agent.start()
