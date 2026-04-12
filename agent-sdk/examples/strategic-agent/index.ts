import { BaseAgent, createLLMAdapter, createWalletAdapter } from "../../src/index.js"
import { createStrategicModules, strategicConfig } from "./config.js"

const strategicLLM = createLLMAdapter(strategicConfig.llm)
const tacticalLLM = createLLMAdapter({
  ...strategicConfig.llm,
  ...(strategicConfig.decision?.tacticalModel ?? strategicConfig.llm.model
    ? { model: strategicConfig.decision?.tacticalModel ?? strategicConfig.llm.model }
    : {}),
})

const agent = new BaseAgent(strategicConfig, {
  llmAdapter: strategicLLM,
  tacticalLLMAdapter: tacticalLLM,
  walletAdapter: await createWalletAdapter(strategicConfig.wallet),
  modules: createStrategicModules(),
})

let terminalState: "extracted" | "death" | "stopped" | null = null

// Surface planner behavior so developers can see when the expensive planner,
// cheap replanner, or zero-cost module path made the turn decision.
agent.on("plannerDecision", (decision) => {
  const trigger = decision.triggerReason ? ` (${decision.triggerReason})` : ""
  console.log(`[planner:${decision.tier}]${trigger} ${decision.reasoning} | queue=${decision.planDepth}`)
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
  terminalState = "death"
  console.log(`[death] cause=${cause} floor=${floor} room=${room}`)
})
agent.on("extracted", ({ gold_gained, xp_gained, realm_completed }) => {
  terminalState = "extracted"
  console.log(
    `[extracted] gold=${gold_gained} xp=${xp_gained} completed=${String(realm_completed)}`,
  )
})
agent.on("error", (error) => {
  console.error("[error]", error)
})
agent.on("disconnected", () => {
  if (terminalState === null) {
    terminalState = "stopped"
  }
  console.log("[disconnected]")
})

let runNumber = 0
while (true) {
  runNumber += 1
  terminalState = null
  console.log(`\n=== strategic run ${runNumber} ===`)
  await agent.start()

  if (terminalState !== "extracted") {
    break
  }

  console.log("Re-entering according to the configured realm progression strategy.")
}
