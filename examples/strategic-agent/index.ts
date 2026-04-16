import {
  BaseAgent,
  createLLMAdapter,
  createWalletAdapter,
  LLMNameProvider,
} from "../../src/index.js"
import { createStrategicModules, strategicConfig } from "./config.js"

const strategicLLM = createLLMAdapter(strategicConfig.llm)
const tacticalLLM = createLLMAdapter({
  ...strategicConfig.llm,
  ...(strategicConfig.decision?.tacticalModel ?? strategicConfig.llm.model
    ? { model: strategicConfig.decision?.tacticalModel ?? strategicConfig.llm.model }
    : {}),
})

const nameProvider = strategicConfig.characterName
  ? undefined
  : new LLMNameProvider({
      llm: strategicLLM,
      ...(strategicConfig.characterFlavor ? { flavor: strategicConfig.characterFlavor } : {}),
    })

const agent = new BaseAgent(strategicConfig, {
  llmAdapter: strategicLLM,
  tacticalLLMAdapter: tacticalLLM,
  walletAdapter: await createWalletAdapter(strategicConfig.wallet),
  modules: createStrategicModules(),
  ...(nameProvider ? { characterNameProvider: nameProvider } : {}),
})

let terminalState: "extracted" | "death" | "stopped" | null = null
let previousPosition:
  | {
      roomId: string
      x: number
      y: number
    }
  | null = null

// Surface planner behavior so developers can see when the expensive planner,
// cheap replanner, or zero-cost module path made the turn decision.
agent.on("plannerDecision", (decision) => {
  const trigger = decision.triggerReason ? ` (${decision.triggerReason})` : ""
  console.log(`[planner:${decision.tier}]${trigger} ${decision.reasoning} | queue=${decision.planDepth}`)
})
agent.on("observation", (observation) => {
  const moveDirections = observation.legal_actions
    .filter(
      (action): action is Extract<typeof observation.legal_actions[number], { type: "move" }> =>
        action.type === "move",
    )
    .map((action) => action.direction)
    .join(", ")
  const stuck =
    previousPosition?.roomId === observation.position.room_id
    && previousPosition.x === observation.position.tile.x
    && previousPosition.y === observation.position.tile.y
      ? " stuck=true"
      : ""
  const visibleEnemies = observation.visible_entities
    .filter((entity) => entity.type === "enemy")
    .map((entity) => `${entity.name}@(${entity.position.x},${entity.position.y})`)
    .join(", ")
  const visibleInteractables = observation.visible_entities
    .filter((entity) => entity.type === "interactable")
    .map((entity) => `${entity.name}@(${entity.position.x},${entity.position.y})`)
    .join(", ")
  const visibleItems = observation.visible_entities
    .filter((entity) => entity.type === "item")
    .map((entity) => `${entity.name}@(${entity.position.x},${entity.position.y})`)
    .join(", ")
  console.log(
    `[observation] turn=${observation.turn} hp=${observation.character.hp.current}/${observation.character.hp.max} room=${observation.position.room_id} tile=(${observation.position.tile.x},${observation.position.tile.y}) moves=[${moveDirections || "none"}] enemies=[${visibleEnemies || "none"}] items=[${visibleItems || "none"}] interactables=[${visibleInteractables || "none"}]${stuck}`,
  )
  previousPosition = {
    roomId: observation.position.room_id,
    x: observation.position.tile.x,
    y: observation.position.tile.y,
  }
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

terminalState = null
previousPosition = null
console.log("\n=== strategic agent session ===")
await agent.start()
console.log(`[session-ended] final_state=${terminalState ?? "unknown"}`)
