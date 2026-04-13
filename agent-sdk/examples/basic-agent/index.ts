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
