import type {
  ActionPlan,
  DecisionResult,
  HistoryEntry,
  LLMAdapter,
  PlannedAction,
} from "./adapters/llm/index.js"
import {
  buildStrategicSystemPrompt,
  buildSystemPrompt,
  buildTacticalSystemPrompt,
} from "./adapters/llm/index.js"
import type { DecisionConfig } from "./config.js"
import type { Action, Observation } from "./protocol.js"
import type { AgentContext, ModuleRecommendation, ModuleRegistry } from "./modules/index.js"

type PlannerTier = "strategic" | "tactical" | "module" | "emergency" | "per-turn"
type StrategicTrigger = "initial_observation" | "floor_change" | "realm_status_change" | "resources_critical"
type TacticalTrigger =
  | "combat_start"
  | "combat_end"
  | "trap_triggered"
  | "plan_exhausted"
  | "action_illegal"

const COMPLETED_REALM_STATUSES = new Set(["boss_cleared", "realm_cleared"])

interface ActivePlan {
  source: "strategic" | "tactical"
  strategy: string
  actions: PlannedAction[]
}

export interface PlannerDecision extends DecisionResult {
  tier: PlannerTier
  planDepth: number
  triggerReason?: StrategicTrigger | TacticalTrigger
}

export class ActionPlanner {
  private currentPlan: ActivePlan | null = null
  private strategicContext: string | undefined
  private previousObservation: Observation | null = null

  constructor(
    private readonly strategicLLM: LLMAdapter,
    private readonly tacticalLLM: LLMAdapter,
    private readonly registry: ModuleRegistry,
    private readonly config: DecisionConfig,
  ) {}

  async decideAction(observation: Observation, context: AgentContext): Promise<PlannerDecision> {
    const recommendations = this.registry.analyzeAll(observation, context)
    const emergencyDecision = this.tryEmergencyOverride(observation, recommendations)
    if (emergencyDecision) {
      this.previousObservation = observation
      return emergencyDecision
    }

    const lootDecision = this.tryLootBeforeExtractionOverride(observation, recommendations)
    if (lootDecision) {
      this.previousObservation = observation
      return lootDecision
    }

    const homingDecision = this.tryPostClearHomingOverride(observation, recommendations)
    if (homingDecision) {
      this.previousObservation = observation
      return homingDecision
    }

    if (this.config.strategy === "module-only") {
      const decision = this.chooseModuleDecision(observation, recommendations)
      this.previousObservation = observation
      return decision
    }

    if (this.config.strategy === "llm-every-turn") {
      const result = await this.strategicLLM.decide({
        observation,
        moduleRecommendations: recommendations,
        legalActions: observation.legal_actions,
        recentHistory: this.buildHistory(context),
        systemPrompt: buildSystemPrompt(context.config),
      })
      this.previousObservation = observation
      return {
        ...result,
        tier: "per-turn",
        planDepth: 0,
      }
    }

    const strategicTrigger = this.getStrategicTrigger(observation, recommendations)
    if (strategicTrigger) {
      const decision = await this.planAndSelect(
        "strategic",
        strategicTrigger,
        observation,
        recommendations,
        context,
      )
      this.previousObservation = observation
      return decision
    }

    const tacticalTrigger = this.getTacticalTrigger(observation)
    if (tacticalTrigger) {
      const decision = await this.planAndSelect(
        "tactical",
        tacticalTrigger,
        observation,
        recommendations,
        context,
      )
      this.previousObservation = observation
      return decision
    }

    if (!this.currentPlan || this.currentPlan.actions.length === 0) {
      const decision = await this.planAndSelect(
        "tactical",
        "plan_exhausted",
        observation,
        recommendations,
        context,
      )
      this.previousObservation = observation
      return decision
    }

    const planned = this.consumeCurrentPlan(observation, recommendations)
    if (planned) {
      this.previousObservation = observation
      return planned
    }

    const decision = await this.planAndSelect(
      "tactical",
      "action_illegal",
      observation,
      recommendations,
      context,
    )
    this.previousObservation = observation
    return decision
  }

  private tryEmergencyOverride(
    observation: Observation,
    recommendations: ModuleRecommendation[],
  ): PlannerDecision | null {
    const hpRatio = observation.character.hp.max > 0
      ? observation.character.hp.current / observation.character.hp.max
      : 1
    const healing = recommendations.find(
      (recommendation) =>
        recommendation.moduleName === "healing" &&
        recommendation.suggestedAction &&
        this.isActionLegal(recommendation.suggestedAction, observation.legal_actions) &&
        recommendation.confidence >= 0.9 &&
        hpRatio <= (this.config.emergencyHpPercent ?? 0.2),
    )
    if (healing?.suggestedAction) {
      return {
        action: healing.suggestedAction,
        reasoning: healing.reasoning,
        tier: "emergency",
        planDepth: this.currentPlan?.actions.length ?? 0,
        triggerReason: "resources_critical",
      }
    }

    const portal = recommendations.find(
      (recommendation) =>
        recommendation.moduleName === "portal" &&
        recommendation.suggestedAction &&
        this.isActionLegal(recommendation.suggestedAction, observation.legal_actions) &&
        recommendation.confidence >= 0.95,
    )
    if (portal?.suggestedAction) {
      return {
        action: portal.suggestedAction,
        reasoning: portal.reasoning,
        tier: "emergency",
        planDepth: this.currentPlan?.actions.length ?? 0,
      }
    }

    return null
  }

  /**
   * After a clear, the tactical model often replans every turn (`plan_exhausted`) and can oscillate
   * on interior tiles instead of committing to doors/stairs. Deterministic exploration homing
   * (tagged with `context.extractionHoming`) overrides LLM tactical plans in that phase.
   */
  private tryPostClearHomingOverride(
    observation: Observation,
    recommendations: ModuleRecommendation[],
  ): PlannerDecision | null {
    if (!this.previousObservation) {
      return null
    }
    if (!COMPLETED_REALM_STATUSES.has(observation.realm_info.status)) {
      return null
    }
    if (hasPendingLootBeforeExtraction(observation)) {
      return null
    }

    const exploration = recommendations.find((rec) => rec.moduleName === "exploration")
    if (
      !exploration?.suggestedAction
      || exploration.context?.extractionHoming !== true
    ) {
      return null
    }
    if (!this.isActionLegal(exploration.suggestedAction, observation.legal_actions)) {
      return null
    }

    this.currentPlan = null
    return {
      action: exploration.suggestedAction,
      reasoning: exploration.reasoning,
      tier: "module",
      planDepth: 0,
    }
  }

  private tryLootBeforeExtractionOverride(
    observation: Observation,
    recommendations: ModuleRecommendation[],
  ): PlannerDecision | null {
    if (!hasPendingLootBeforeExtraction(observation)) {
      return null
    }

    const recommendation = [...recommendations]
      .filter(
        (candidate) =>
          candidate.suggestedAction
          && candidate.suggestedAction.type !== "use_portal"
          && candidate.suggestedAction.type !== "retreat"
          && this.isActionLegal(candidate.suggestedAction, observation.legal_actions),
      )
      .sort((left, right) => right.confidence - left.confidence)[0]

    if (!recommendation?.suggestedAction) {
      return null
    }

    return {
      action: recommendation.suggestedAction,
      reasoning: recommendation.reasoning,
      tier: "module",
      planDepth: this.currentPlan?.actions.length ?? 0,
    }
  }

  private getStrategicTrigger(
    observation: Observation,
    recommendations: ModuleRecommendation[],
  ): StrategicTrigger | null {
    if (!this.previousObservation) {
      return "initial_observation"
    }

    if (observation.position.floor !== this.previousObservation.position.floor) {
      return "floor_change"
    }

    if (observation.realm_info.status !== this.previousObservation.realm_info.status) {
      return "realm_status_change"
    }

    const healing = recommendations.find((recommendation) => recommendation.moduleName === "healing")
    if (healing?.context?.criticalHP === true && healing.context?.healingAvailable === false) {
      return "resources_critical"
    }

    return null
  }

  private getTacticalTrigger(observation: Observation): TacticalTrigger | null {
    if (!this.previousObservation) {
      return null
    }

    const previousEnemyCount = this.countVisibleEnemies(this.previousObservation)
    const currentEnemyCount = this.countVisibleEnemies(observation)

    if (previousEnemyCount === 0 && currentEnemyCount > 0) {
      return "combat_start"
    }

    if (previousEnemyCount > 0 && currentEnemyCount === 0) {
      return "combat_end"
    }

    if (
      observation.recent_events.some((event) =>
        event.type === "trap_triggered" ||
        event.type === "trap_spotted" ||
        event.type === "trap_damage",
      )
    ) {
      return "trap_triggered"
    }

    return null
  }

  private async planAndSelect(
    tier: "strategic" | "tactical",
    triggerReason: StrategicTrigger | TacticalTrigger,
    observation: Observation,
    recommendations: ModuleRecommendation[],
    context: AgentContext,
  ): Promise<PlannerDecision> {
    const llm = tier === "strategic" ? this.strategicLLM : this.tacticalLLM
    const systemPrompt = tier === "strategic"
      ? buildStrategicSystemPrompt(context.config)
      : buildTacticalSystemPrompt(this.strategicContext)
    const plan = await this.requestPlan(
      llm,
      tier,
      observation,
      recommendations,
      context,
      systemPrompt,
    )

    this.currentPlan = {
      source: tier,
      strategy: plan.strategy,
      actions: [...plan.actions],
    }
    if (tier === "strategic") {
      this.strategicContext = plan.strategy
    }

    const planned = this.consumeCurrentPlan(observation, recommendations, triggerReason)
    if (planned) {
      return planned
    }

    const moduleFallback = this.chooseTopLegalModuleRecommendation(
      observation.legal_actions,
      recommendations,
    )
    if (moduleFallback?.suggestedAction) {
      return {
        action: moduleFallback.suggestedAction,
        reasoning: moduleFallback.reasoning,
        tier: "module",
        planDepth: this.currentPlan?.actions.length ?? 0,
        triggerReason,
      }
    }

    return this.defaultDecision(observation, "Fallback: no valid planned or module action.", "module", triggerReason)
  }

  private async requestPlan(
    llm: LLMAdapter,
    tier: "strategic" | "tactical",
    observation: Observation,
    recommendations: ModuleRecommendation[],
    context: AgentContext,
    systemPrompt: string,
  ): Promise<ActionPlan> {
    if (typeof llm.plan === "function") {
      return llm.plan({
        observation,
        moduleRecommendations: recommendations,
        legalActions: observation.legal_actions,
        recentHistory: this.buildHistory(context),
        systemPrompt,
        planType: tier,
        maxActions: this.config.maxPlanLength ?? 10,
        ...(tier === "tactical" && this.strategicContext
          ? { strategicContext: this.strategicContext }
          : {}),
      })
    }

    const decision = await llm.decide({
      observation,
      moduleRecommendations: recommendations,
      legalActions: observation.legal_actions,
      recentHistory: this.buildHistory(context),
      systemPrompt,
    })
    return {
      strategy: decision.reasoning,
      actions: [{ action: decision.action, reasoning: decision.reasoning }],
    }
  }

  private consumeCurrentPlan(
    observation: Observation,
    recommendations: ModuleRecommendation[],
    triggerReason?: StrategicTrigger | TacticalTrigger,
  ): PlannerDecision | null {
    if (!this.currentPlan) {
      return null
    }

    const next = this.currentPlan.actions[0]
    if (!next) {
      return null
    }

    if (!this.isActionLegal(next.action, observation.legal_actions)) {
      this.currentPlan.actions.shift()
      const moduleFallback = this.chooseTopLegalModuleRecommendation(
        observation.legal_actions,
        recommendations,
      )
      if (
        moduleFallback?.suggestedAction &&
        moduleFallback.confidence >= (this.config.moduleConfidenceThreshold ?? 0.75)
      ) {
        return {
          action: moduleFallback.suggestedAction,
          reasoning: moduleFallback.reasoning,
          tier: "module",
          planDepth: this.currentPlan.actions.length,
          triggerReason: triggerReason ?? "action_illegal",
        }
      }

      return null
    }

    this.currentPlan.actions.shift()
    return withOptionalTriggerReason({
      action: next.action,
      reasoning: next.reasoning,
      tier: this.currentPlan.source,
      planDepth: this.currentPlan.actions.length,
      triggerReason,
    })
  }

  private chooseModuleDecision(
    observation: Observation,
    recommendations: ModuleRecommendation[],
  ): PlannerDecision {
    const moduleRecommendation = this.chooseTopLegalModuleRecommendation(
      observation.legal_actions,
      recommendations,
    )
    if (moduleRecommendation?.suggestedAction) {
      return {
        action: moduleRecommendation.suggestedAction,
        reasoning: moduleRecommendation.reasoning,
        tier: "module",
        planDepth: 0,
      }
    }

    return this.defaultDecision(observation, "Fallback: no legal module recommendation.", "module")
  }

  private chooseTopLegalModuleRecommendation(
    legalActions: Action[],
    recommendations: ModuleRecommendation[],
  ): ModuleRecommendation | undefined {
    return [...recommendations]
      .filter(
        (recommendation) =>
          recommendation.suggestedAction &&
          this.isActionLegal(recommendation.suggestedAction, legalActions),
      )
      .sort((left, right) => right.confidence - left.confidence)[0]
  }

  private defaultDecision(
    observation: Observation,
    reasoning: string,
    tier: PlannerTier,
    triggerReason?: StrategicTrigger | TacticalTrigger,
  ): PlannerDecision {
    const action = observation.legal_actions.find((candidate) => candidate.type === "wait")
      ?? observation.legal_actions[0]
      ?? { type: "wait" }
    return withOptionalTriggerReason({
      action,
      reasoning,
      tier,
      planDepth: this.currentPlan?.actions.length ?? 0,
      triggerReason,
    })
  }

  private buildHistory(context: AgentContext): HistoryEntry[] {
    return context.previousActions.slice(-10).map((entry) => ({
      turn: entry.turn,
      action: entry.action,
      reasoning: entry.reasoning,
      observation_summary: `Turn ${entry.turn}`,
    }))
  }

  private countVisibleEnemies(observation: Observation): number {
    return observation.visible_entities.filter((entity) => entity.type === "enemy").length
  }

  private isActionLegal(action: Action, legalActions: Action[]): boolean {
    return legalActions.some((legalAction) => this.actionsMatch(action, legalAction))
  }

  private actionsMatch(left: Action, right: Action): boolean {
    if (left.type !== right.type) {
      return false
    }

    switch (left.type) {
      case "move":
        return left.direction === (right as Extract<Action, { type: "move" }>).direction
      case "attack":
        return (
          left.target_id === (right as Extract<Action, { type: "attack" }>).target_id &&
          left.ability_id === (right as Extract<Action, { type: "attack" }>).ability_id
        )
      case "disarm_trap":
      case "equip":
      case "pickup":
      case "drop":
        return left.item_id === (right as typeof left).item_id
      case "use_item":
        return (
          left.item_id === (right as Extract<Action, { type: "use_item" }>).item_id &&
          left.target_id === (right as Extract<Action, { type: "use_item" }>).target_id
        )
      case "unequip":
        return left.slot === (right as Extract<Action, { type: "unequip" }>).slot
      case "inspect":
      case "interact":
        return left.target_id === (right as typeof left).target_id
      case "use_portal":
      case "retreat":
      case "wait":
        return true
    }
  }
}

function hasPendingLootBeforeExtraction(observation: Observation): boolean {
  if (!COMPLETED_REALM_STATUSES.has(observation.realm_info.status)) {
    return false
  }

  if (observation.visible_entities.some((entity) => entity.type === "enemy")) {
    return false
  }

  return (
    observation.legal_actions.some((action) => action.type === "pickup")
    || observation.visible_entities.some((entity) => entity.type === "item")
  )
}

function withOptionalTriggerReason(
  decision: Omit<PlannerDecision, "triggerReason"> & {
    triggerReason?: PlannerDecision["triggerReason"] | undefined
  },
): PlannerDecision {
  if (decision.triggerReason === undefined) {
    const { triggerReason: _triggerReason, ...rest } = decision
    return rest as PlannerDecision
  }

  return decision as PlannerDecision
}
