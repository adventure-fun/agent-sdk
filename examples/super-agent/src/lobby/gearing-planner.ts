import type {
  CharacterClass,
  EquipSlot,
  InventoryItem,
  LobbyHook,
  LobbyState,
  ShopCatalogItem,
} from "../../../../src/index.js"
import type { ClassProfile, ClassProfileRegistry } from "../classes/profile.js"
import type { WorldModel } from "../world-model/world-model.js"

export type BudgetAction =
  | {
      type: "buy"
      item: ShopCatalogItem
      quantity: number
      reason: string
    }
  | {
      type: "skip"
      reason: string
    }

const PROTECTED_TEMPLATE_IDS = new Set(["health-potion", "portal-scroll"])

/**
 * Per-class reserve target: how much gold the agent keeps in its pocket before spending on
 * tier-up gear. Scales loosely with level so higher-level runs hold more back for potions.
 */
export function reserveTarget(characterLevel: number): number {
  return Math.max(50, characterLevel * 40)
}

/**
 * Compute a "modifier total" for an item — used to compare the equipped slot against a
 * candidate shop item. Matches the InventoryModule's itemValue() heuristic.
 */
export function itemValueFromModifiers(
  modifiers: Record<string, number> | undefined | null,
): number {
  if (!modifiers) return 0
  return Object.values(modifiers).reduce((sum, v) => sum + Math.abs(v), 0)
}

function itemValueFromStats(stats: Record<string, number> | null | undefined): number {
  if (!stats) return 0
  return Object.values(stats).reduce((sum, v) => sum + Math.abs(v), 0)
}

/**
 * Produces an ordered list of BudgetActions for the given lobby state. The planner is pure:
 * no side effects, no network calls. Caller (the BaseAgent lobby hook) executes the actions
 * in order against the live `AgentClient`.
 *
 * State machine (simplified):
 *   1. Stock class-specific consumables below minQty.
 *   2. Buy tier-up gear when gold > reserveTarget + price AND the candidate beats the equipped
 *      item's modifier-total AND historical shop price says today's price isn't overpriced.
 * The heuristic buy-potion/buy-portal passes in BaseAgent still run after this hook (unless
 * the hook signals `true`), so we intentionally do NOT touch potions/portal scrolls here.
 */
export function planBudgetActions(input: {
  state: LobbyState
  profile: ClassProfile
  world: WorldModel | null
}): BudgetAction[] {
  const { state, profile, world } = input
  const actions: BudgetAction[] = []

  const gold = state.inventoryGold
  const level = state.character.level ?? 1
  const reserve = reserveTarget(level)

  const shopItems = collectShopItems(state.shops)
  const shopById = new Map(shopItems.map((item) => [item.id, item]))

  // 1. Class-specific consumables.
  for (const target of profile.consumableTargets) {
    const owned = countInventoryByName(state.inventory, target.templateNamePattern)
    if (owned >= target.minQty) continue
    const candidate = shopItems.find(
      (item) =>
        !isProtectedId(item.id)
        && target.templateNamePattern.test(item.name ?? "")
        && isAffordable(item, gold - reserve),
    )
    if (!candidate) continue
    const needed = target.minQty - owned
    const maxByStack = candidate.stack_limit ?? needed
    const quantity = Math.min(needed, Math.max(1, maxByStack))
    actions.push({
      type: "buy",
      item: candidate,
      quantity,
      reason: `Stock ${target.minQty} ${candidate.name} (class consumable)`,
    })
  }

  // 2. Tier-up gear. Iterate each equip slot in a stable order.
  const SLOTS: EquipSlot[] = ["weapon", "armor", "helm", "hands", "accessory"]
  const equippedBySlot = new Map<EquipSlot, InventoryItem>()
  for (const inv of state.inventory) {
    if (inv.slot) equippedBySlot.set(inv.slot, inv)
  }

  for (const slot of SLOTS) {
    const target = profile.tierTargets[slot]
    if (!target) continue

    const equipped = equippedBySlot.get(slot)
    const equippedValue = equipped ? itemValueFromModifiers(equipped.modifiers) : 0
    const minRequired = (target.minAttack ?? 0) + (target.minDefense ?? 0)
    if (equippedValue >= minRequired) continue

    const candidates = shopItems.filter(
      (item) =>
        item.equip_slot === slot
        && isClassCompatible(item, state.character.class)
        && isAffordable(item, gold - reserve)
        && itemValueFromStats(item.stats ?? {}) > equippedValue
        && !isOverpricedVsHistory(item, world),
    )
    if (candidates.length === 0) continue

    // Pick the best affordable upgrade.
    const best = candidates.reduce<ShopCatalogItem | null>((acc, cur) => {
      const curValue = itemValueFromStats(cur.stats ?? {})
      const accValue = acc ? itemValueFromStats(acc.stats ?? {}) : -Infinity
      return curValue > accValue ? cur : acc
    }, null)
    if (!best) continue

    actions.push({
      type: "buy",
      item: best,
      quantity: 1,
      reason: `Tier-up ${slot}: ${best.name} (stats ${JSON.stringify(best.stats ?? {})})`,
    })

    // Deduct from a local gold estimate so back-to-back tier-ups don't overspend.
    const price = best.buy_price ?? 0
    input.state = {
      ...state,
      inventoryGold: state.inventoryGold - price,
    }
    // Remove from shop map so we don't re-buy the same item across iterations.
    shopById.delete(best.id)
  }

  return actions
}

function collectShopItems(shops: LobbyState["shops"]): ShopCatalogItem[] {
  const out: ShopCatalogItem[] = []
  for (const section of shops.sections) {
    for (const item of section.items) out.push(item)
  }
  return out
}

function countInventoryByName(
  inventory: InventoryItem[],
  pattern: RegExp,
): number {
  let count = 0
  for (const inv of inventory) {
    if (pattern.test(inv.name)) count += inv.quantity
  }
  return count
}

function isProtectedId(templateId: string): boolean {
  return PROTECTED_TEMPLATE_IDS.has(templateId)
}

function isAffordable(item: ShopCatalogItem, spendable: number): boolean {
  if (item.buy_price == null) return false
  return item.buy_price <= spendable
}

function isClassCompatible(item: ShopCatalogItem, klass: CharacterClass): boolean {
  if (!item.class_restriction) return true
  return item.class_restriction.toLowerCase() === klass.toLowerCase()
}

function isOverpricedVsHistory(item: ShopCatalogItem, world: WorldModel | null): boolean {
  if (!world) return false
  const record = world.getShopPrice(item.id)
  if (!record || record.buyPrice == null || item.buy_price == null) return false
  // Consider "overpriced" when today's price is >= 1.3x the historical minimum we've seen.
  return item.buy_price >= record.buyPrice * 1.3
}

/**
 * Creates a `LobbyHook` that runs the BudgetPlanner against the current state and executes the
 * resulting BudgetActions via the provided client. Returns `void` so the BaseAgent still runs
 * its default equip/potion/portal passes after this hook.
 */
export function createBudgetLobbyHook(
  profiles: ClassProfileRegistry,
  world: WorldModel,
  logger: (msg: string) => void = () => {},
): LobbyHook {
  return async ({ state, client }): Promise<void> => {
    // Feed observed prices back into the world model on every lobby visit.
    const shopItems = collectShopItems(state.shops)
    world.upsertShopPrices(shopItems)

    const profile = profiles.get(state.character.class)
    const actions = planBudgetActions({ state, profile, world })

    for (const action of actions) {
      if (action.type === "skip") continue
      try {
        await client.buyShopItem({
          itemId: action.item.id,
          quantity: action.quantity,
        })
        logger(
          `[budget] buy ${action.item.name} x${action.quantity} — ${action.reason}`,
        )
      } catch (error) {
        const normalized = error instanceof Error ? error.message : String(error)
        logger(`[budget] buy ${action.item.name} failed: ${normalized}`)
      }
    }
  }
}
