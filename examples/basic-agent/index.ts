import {
  BaseAgent,
  createDefaultConfig,
  createLLMAdapter,
  createWalletAdapter,
  LLMNameProvider,
  type LLMProvider,
  type WalletNetwork,
} from "../../src/index.js"

// CHARACTER_NAME is optional. If unset, the agent rolls a fresh LLM-generated name (and
// banter personality) on every character roll, which sidesteps per-account unique-name
// collisions after death. Set CHARACTER_NAME to pin a specific name; set CHARACTER_FLAVOR
// to give the LLM a style/personality hint.
const config = createDefaultConfig({
  apiUrl: process.env.API_URL ?? "http://localhost:3001",
  wsUrl: process.env.WS_URL ?? "ws://localhost:3001",
  realmTemplateId: process.env.REALM_TEMPLATE ?? "test-tutorial",
  characterClass: process.env.CHARACTER_CLASS ?? "rogue",
  ...(process.env.CHARACTER_NAME ? { characterName: process.env.CHARACTER_NAME } : {}),
  ...(process.env.CHARACTER_FLAVOR ? { characterFlavor: process.env.CHARACTER_FLAVOR } : {}),
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

const llmAdapter = createLLMAdapter(config.llm)
const nameProvider = config.characterName
  ? undefined
  : new LLMNameProvider({
      llm: llmAdapter,
      ...(config.characterFlavor ? { flavor: config.characterFlavor } : {}),
    })

const agent = new BaseAgent(config, {
  llmAdapter,
  walletAdapter: await createWalletAdapter(config.wallet),
  ...(nameProvider ? { characterNameProvider: nameProvider } : {}),
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
