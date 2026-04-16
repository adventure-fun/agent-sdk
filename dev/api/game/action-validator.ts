/**
 * Server-side action validation for Adventure.fun
 *
 * Two layers:
 *   1. parseAction  — structural validation / sanitization of raw client input
 *   2. isActionLegal — checks parsed action against the engine's computed legal actions
 */

import type { Action, EquipSlot } from "../../engine/index.js"

const MAX_STRING_LENGTH = 200
const VALID_DIRECTIONS = new Set(["up", "down", "left", "right"])
const VALID_EQUIP_SLOTS: Set<string> = new Set(["weapon", "armor", "helm", "hands", "accessory"])
const VALID_ACTION_TYPES = new Set([
  "move",
  "attack",
  "use_item",
  "pickup",
  "drop",
  "equip",
  "unequip",
  "inspect",
  "interact",
  "disarm_trap",
  "use_portal",
  "retreat",
  "wait",
])

type ParseResult =
  | { valid: true; action: Action; error?: undefined }
  | { valid: false; action?: undefined; error: string }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_STRING_LENGTH
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "string" && value.length > 0 && value.length <= MAX_STRING_LENGTH) return value
  return undefined
}

function fail(error: string): ParseResult {
  return { valid: false, error }
}

function ok(action: Action): ParseResult {
  return { valid: true, action }
}

export function parseAction(raw: unknown): ParseResult {
  if (!isObject(raw)) {
    return fail("Action must be an object")
  }

  const type = raw.type
  if (typeof type !== "string" || !VALID_ACTION_TYPES.has(type)) {
    return fail(`Invalid action type: ${String(type)}`)
  }

  switch (type) {
    case "move": {
      const direction = raw.direction
      if (typeof direction !== "string" || !VALID_DIRECTIONS.has(direction)) {
        return fail(`Invalid direction: ${String(direction)}`)
      }
      return ok({ type: "move", direction: direction as Action & { type: "move" } extends { direction: infer D } ? D : never })
    }

    case "attack": {
      if (!isNonEmptyString(raw.target_id)) {
        return fail("attack requires a valid string target_id")
      }
      const abilityId = optionalString(raw.ability_id)
      return ok({
        type: "attack",
        target_id: raw.target_id,
        ...(abilityId !== undefined ? { ability_id: abilityId } : {}),
      })
    }

    case "use_item": {
      if (!isNonEmptyString(raw.item_id)) {
        return fail("use_item requires a valid string item_id")
      }
      const targetId = optionalString(raw.target_id)
      return ok({
        type: "use_item",
        item_id: raw.item_id,
        ...(targetId !== undefined ? { target_id: targetId } : {}),
      })
    }

    case "pickup": {
      if (!isNonEmptyString(raw.item_id)) {
        return fail("pickup requires a valid string item_id")
      }
      return ok({ type: "pickup", item_id: raw.item_id })
    }

    case "drop": {
      if (!isNonEmptyString(raw.item_id)) {
        return fail("drop requires a valid string item_id")
      }
      return ok({ type: "drop", item_id: raw.item_id })
    }

    case "equip": {
      if (!isNonEmptyString(raw.item_id)) {
        return fail("equip requires a valid string item_id")
      }
      return ok({ type: "equip", item_id: raw.item_id })
    }

    case "unequip": {
      const slot = raw.slot
      if (typeof slot !== "string" || !VALID_EQUIP_SLOTS.has(slot)) {
        return fail(`Invalid equip slot: ${String(slot)}`)
      }
      return ok({ type: "unequip", slot: slot as EquipSlot })
    }

    case "inspect": {
      if (!isNonEmptyString(raw.target_id)) {
        return fail("inspect requires a valid string target_id")
      }
      return ok({ type: "inspect", target_id: raw.target_id })
    }

    case "interact": {
      if (!isNonEmptyString(raw.target_id)) {
        return fail("interact requires a valid string target_id")
      }
      return ok({ type: "interact", target_id: raw.target_id })
    }

    case "disarm_trap": {
      if (!isNonEmptyString(raw.item_id)) {
        return fail("disarm_trap requires a valid string item_id")
      }
      return ok({ type: "disarm_trap", item_id: raw.item_id })
    }

    case "wait":
      return ok({ type: "wait" })

    case "use_portal":
      return ok({ type: "use_portal" })

    case "retreat":
      return ok({ type: "retreat" })

    default:
      return fail(`Unknown action type: ${type}`)
  }
}

export function isActionLegal(action: Action, legalActions: Action[]): boolean {
  return legalActions.some((legal) => actionsMatch(action, legal))
}

function actionsMatch(incoming: Action, legal: Action): boolean {
  if (incoming.type !== legal.type) return false

  switch (incoming.type) {
    case "move":
      return (legal as { type: "move"; direction: string }).direction === incoming.direction

    case "attack": {
      const legalAttack = legal as { type: "attack"; target_id: string; ability_id?: string }
      if (legalAttack.target_id !== incoming.target_id) return false

      const incomingAbility = incoming.ability_id ?? "basic-attack"
      const legalAbility = legalAttack.ability_id ?? "basic-attack"
      return incomingAbility === legalAbility
    }

    case "use_item":
      return (legal as { type: "use_item"; item_id: string }).item_id === incoming.item_id

    case "pickup":
      return (legal as { type: "pickup"; item_id: string }).item_id === incoming.item_id

    case "drop":
      return (legal as { type: "drop"; item_id: string }).item_id === incoming.item_id

    case "equip":
      return (legal as { type: "equip"; item_id: string }).item_id === incoming.item_id

    case "unequip":
      return (legal as { type: "unequip"; slot: string }).slot === incoming.slot

    case "inspect":
      return (legal as { type: "inspect"; target_id: string }).target_id === incoming.target_id

    case "interact":
      return (legal as { type: "interact"; target_id: string }).target_id === incoming.target_id

    case "disarm_trap":
      return (legal as { type: "disarm_trap"; item_id: string }).item_id === incoming.item_id

    case "wait":
    case "use_portal":
    case "retreat":
      return true

    default:
      return false
  }
}
