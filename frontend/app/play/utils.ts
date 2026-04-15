import type { ActiveEffect, ItemTemplate, Observation } from "@adventure-fun/schemas"
import { parseUnits } from "viem"
import { USDC_CHAIN_LABEL } from "../lib/chain"
import { STAT_LABELS, STAT_KEYS, EQUIP_SLOT_LABELS } from "./constants"

export function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

// Returns true while balance is loading (rawBalance === null) so the UI doesn't
// flash "insufficient" before the on-chain read returns.
export function hasEnoughUsdc(rawBalance: bigint | null, priceUsd: string): boolean {
  if (rawBalance === null) return true
  const n = Number.parseFloat(priceUsd)
  if (!Number.isFinite(n) || n <= 0) return true
  try {
    const needed = parseUnits(priceUsd, 6)
    return rawBalance >= needed
  } catch {
    return true
  }
}

// Maps an x402 / CDP / backend error message into a user-readable string.
// Strategy:
//   1. If the message is JSON, extract a meaningful field (code | message | error)
//      and recurse with it as the new candidate.
//   2. Match a known x402 reason code or CDP wallet rejection pattern.
//   3. Match the legacy substring patterns (insufficient, rejected, network).
//   4. Fall back to a friendly generic — never expose raw JSON or stack traces.
const X402_REASON_MESSAGES: Record<string, string> = {
  insufficient_funds: `There is not enough ${USDC_CHAIN_LABEL} in your wallet to settle this payment.`,
  invalid_signature: "The payment signature could not be verified. Try again.",
  invalid_exact_evm_payload_signature: "The payment signature could not be verified. Try again.",
  invalid_exact_evm_payload_authorization_value: "The payment amount didn't match what was requested. Try again.",
  invalid_exact_evm_payload_authorization_valid_after: "Your wallet's clock is off. Refresh and try again.",
  invalid_exact_evm_payload_authorization_valid_before: "The payment authorization expired before settlement. Try again.",
  invalid_exact_evm_payload_recipient: "The payment destination didn't match. Try again.",
  invalid_payload: "The payment payload was malformed. Refresh and try again.",
  invalid_scheme: "Unsupported payment scheme. Refresh and try again.",
  invalid_network: "Unsupported network. Make sure you're on Base.",
  nonce_already_used: "This payment was already submitted. Refresh and try again.",
  authorization_expired: "The payment authorization expired before settlement. Try again.",
  facilitator_unreachable: "The payment network is taking too long to respond. Please try again in a moment.",
  unexpected_verify_error: "Payment verification failed. Please try again.",
  unexpected_settle_error: "Payment settlement failed. Please try again.",
  verification_failed: "Payment verification failed. Please try again.",
  settlement_failed: "Payment settlement failed. Please try again.",
}

const FRIENDLY_FALLBACK = "Payment could not be completed. Please try again, or contact support if this keeps happening."

function tryParseJsonMessage(message: string): string | null {
  const trimmed = message.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed !== "object" || parsed === null) return null
    const obj = parsed as Record<string, unknown>
    // Prefer code (stable identifier), then message, then error.
    if (typeof obj["code"] === "string") return obj["code"] as string
    if (typeof obj["message"] === "string") return obj["message"] as string
    if (typeof obj["error"] === "string") return obj["error"] as string
    if (typeof obj["reason"] === "string") return obj["reason"] as string
    return null
  } catch {
    return null
  }
}

export function friendlyPaymentError(message: string | null | undefined): string {
  if (!message) return FRIENDLY_FALLBACK

  // Recurse once if the message is itself a JSON blob.
  const unwrapped = tryParseJsonMessage(message)
  if (unwrapped && unwrapped !== message) return friendlyPaymentError(unwrapped)

  const normalized = message.toLowerCase().trim()

  // Exact / substring x402 reason codes.
  for (const [code, friendly] of Object.entries(X402_REASON_MESSAGES)) {
    if (normalized === code || normalized.includes(code)) return friendly
  }

  // CDP wallet rejection patterns.
  if (
    normalized.includes("user rejected")
    || normalized.includes("user denied")
    || normalized.includes("popup closed")
    || normalized.includes("rejected") && !normalized.includes("rejected by")  // keep "rejected by network" out of this branch
    || normalized.includes("cancelled")
    || normalized.includes("canceled")
  ) {
    return "Payment was cancelled before settlement completed."
  }

  // Legacy substring matches.
  if (normalized.includes("insufficient")) {
    return `There is not enough ${USDC_CHAIN_LABEL} in your wallet to settle this payment.`
  }
  if (normalized.includes("network") || normalized.includes("timeout")) {
    return "The payment network is taking too long to respond. Please try again in a moment."
  }

  // If the message looks like a normal sentence (no JSON braces, no error_code_format),
  // pass it through; otherwise use the friendly fallback.
  if (/[{}]|^[a-z_]+$/.test(message.trim())) return FRIENDLY_FALLBACK
  return message
}

export function formatItemQuantity(name: string, quantity: number, templateId?: string): string {
  if (templateId?.startsWith("ammo-")) return `${name} (${quantity})`
  return `${name} x${quantity}`
}

export type RealmCompletionStatus = Observation["realm_info"]["status"] | undefined

export function isRealmComplete(status: RealmCompletionStatus): status is "boss_cleared" | "realm_cleared" {
  return status === "boss_cleared" || status === "realm_cleared"
}

export function getExtractionHint(
  status: RealmCompletionStatus,
  canPortal: boolean,
  canRetreat: boolean,
  hasPortalScroll: boolean,
) {
  if (!isRealmComplete(status)) return null

  const completionLead = status === "realm_cleared" ? "Realm cleared." : "Boss defeated."
  if (canPortal) {
    return hasPortalScroll
      ? `${completionLead} Use your portal scroll to escape, return to the first room to exit back to town, or keep delving for more loot.`
      : `${completionLead} Your portal is ready.`
  }
  if (canRetreat) {
    return `${completionLead} You can retreat safely from the entrance.`
  }
  return `${completionLead} Find a portal scroll or return to the first-floor entrance to escape.`
}

export function getCompletionBonusText(status: RealmCompletionStatus) {
  return status === "boss_cleared"
    ? "for clearing the realm boss."
    : "for completing the realm."
}

export function getResourceBarColor(resourceType: Observation["character"]["resource"]["type"]) {
  switch (resourceType) {
    case "stamina": return "bg-ob-primary"
    case "mana": return "bg-blue-500"
    case "energy": return "bg-emerald-500"
    case "focus": return "bg-violet-500"
  }
}

export function getDebuffPalette(effectType: ActiveEffect["type"]) {
  switch (effectType) {
    case "poison": return "bg-green-950/40 border-green-900/60 text-ob-secondary"
    case "stun": return "bg-yellow-950/40 border-yellow-900/60 text-yellow-300"
    case "slow": return "bg-blue-950/40 border-blue-900/60 text-blue-300"
    case "blind": return "bg-violet-950/40 border-violet-900/60 text-violet-300"
    case "buff-attack":
    case "buff-defense": return "bg-ob-primary/15 border-ob-primary/30 text-ob-primary"
  }
}

export function formatEffectLabel(effect: ActiveEffect) {
  const base = `${effect.type} ${effect.turns_remaining}t`
  if (effect.type === "poison") return `${base} • ${effect.magnitude} dmg`
  return `${base} • ${effect.magnitude}`
}

export function getHealthBarColor(pct: number) {
  if (pct > 50) return "bg-green-500"
  if (pct > 25) return "bg-ob-primary-dim"
  return "bg-ob-error"
}

export function getEnemyBehaviorHint(behavior: NonNullable<Observation["visible_entities"][number]["behavior"]>) {
  switch (behavior) {
    case "defensive": return "Defensive foes fall back and lean on self-buffs when weakened."
    case "patrol": return "Patrol foes stay on route until you enter their awareness range."
    case "ambush": return "Ambush foes hold position until you step into their kill zone."
    case "boss": return "Bosses change tactics as their health drops."
    case "aggressive": return "Aggressive foes push forward whenever they can."
  }
}

export function getRecentEventPalette(
  event: Observation["recent_events"][number],
  isRecent: boolean,
) {
  if (event.type === "floor_change") {
    return event.detail.startsWith("Ascended")
      ? "border-ob-tertiary/40 bg-ob-tertiary/10 text-ob-tertiary"
      : "border-cyan-800/70 bg-ob-tertiary/10 text-ob-tertiary"
  }
  if (event.type === "boss_phase") return "border-ob-primary/30 bg-ob-primary/10 text-ob-primary"
  if (event.type === "realm_clear") return "border-emerald-800/70 bg-ob-secondary/10 text-ob-secondary"
  if (event.type === "level_up") return "border-yellow-700/70 bg-yellow-950/20 text-yellow-200"
  if (event.type === "trap_triggered") return "border-ob-error/30 bg-ob-error/10 text-ob-error"
  if (event.type === "trap_disarmed") return "border-teal-800/70 bg-teal-950/20 text-teal-200"
  if (event.type === "pickup") return "border-ob-primary/30 bg-ob-primary/10 text-ob-primary"
  if (event.type === "pickup_blocked") return "border-ob-error/30 bg-ob-error/15 text-ob-error"
  if (event.type === "interact" && event.data?.category === "lore") return "border-ob-primary/30 bg-ob-primary/10 text-ob-primary"
  if (event.type === "use_item" && event.detail.includes("layout of this entire floor")) return "border-indigo-800/70 bg-indigo-950/20 text-indigo-200"
  return isRecent
    ? "border-ob-outline-variant/15 bg-ob-bg text-ob-on-surface"
    : "border-ob-outline-variant/15 bg-black/20 text-ob-outline"
}

export function getRecentEventLead(event: Observation["recent_events"][number]) {
  if (event.type === "floor_change") return event.detail.startsWith("Ascended") ? "↑" : "↓"
  return ">"
}

export function formatAbilityRange(range: number | "melee") {
  return range === "melee" ? "Melee" : `${range} tiles`
}

export function getItemRarityBadgePalette(rarity: string) {
  switch (rarity) {
    case "common": return "border-ob-outline-variant/30 bg-ob-bg/30 text-ob-on-surface"
    case "uncommon": return "border-emerald-800/70 bg-ob-secondary/10 text-ob-secondary"
    case "rare": return "border-blue-800/70 bg-blue-950/20 text-blue-200"
    case "epic": return "border-violet-800/70 bg-violet-950/20 text-violet-200"
  }
}

export function safeGetItemTemplate(
  templateId: string,
  itemTemplateMap: Record<string, ItemTemplate>,
): ItemTemplate | null {
  return itemTemplateMap[templateId] ?? null
}

export function formatItemStats(stats: ItemTemplate["stats"] | undefined) {
  if (!stats) return null
  const entries = Object.entries(stats).filter(([, value]) => typeof value === "number" && value !== 0)
  if (entries.length === 0) return null
  return entries
    .map(([stat, value]) => `${value > 0 ? "+" : ""}${value} ${STAT_LABELS[stat] ?? stat.toUpperCase()}`)
    .join(" · ")
}

export function getEquipComparisonTitle(
  template: ItemTemplate,
  equippedItem: { template_id: string; name: string } | null | undefined,
  itemTemplateMap: Record<string, ItemTemplate>,
) {
  const slotLabel = template.equip_slot ? EQUIP_SLOT_LABELS[template.equip_slot] : "Slot"
  const incomingStats = formatItemStats(template.stats) ?? "no stat bonuses"
  if (!equippedItem) return `${slotLabel}: empty -> ${template.name} (${incomingStats})`
  const equippedTemplate = safeGetItemTemplate(equippedItem.template_id, itemTemplateMap)
  const equippedStats = formatItemStats(equippedTemplate?.stats) ?? "no stat bonuses"
  return `${slotLabel}: ${template.name} (${incomingStats}) replaces ${equippedItem.name} (${equippedStats})`
}

export function formatLoreLabel(loreId: string) {
  return loreId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function getStatDisplayMax(stat: typeof STAT_KEYS[number]) {
  return stat === "hp" ? 50 : 25
}

export function getRollQualityTone(fillPct: number) {
  if (fillPct >= 67) return "bg-emerald-400"
  if (fillPct >= 34) return "bg-ob-primary"
  return "bg-rose-400"
}

export function getItemIconSrc(type: string | undefined, templateId: string): string | null {
  if (type === "equipment") return `/sprites/equipment/${templateId}.png`
  if (type === "consumable") return `/sprites/consumables/${templateId}.png`
  if (type === "loot") return `/sprites/loot/${templateId}.png`
  if (type === "key-item") return `/sprites/keys/${templateId}.png`
  return null
}

export function xpThresholdForLevel(level: number): number {
  if (level <= 1) return 0
  const n = level - 1
  return 50 * n * n + 50 * n
}
