"use client"

import { useEffect, useRef, useMemo } from "react"
import type { Observation, Action, ItemTemplate, Tile } from "@adventure-fun/schemas"
import { GameMap } from "../../components/game-map"
import { StatusMeter } from "./status-meter"
import { StatusEffectBadge } from "./status-effect-badge"
import { EnemyBehaviorBadge } from "./enemy-behavior-badge"
import { DungeonEquipmentPanel } from "./dungeon-equipment-panel"
import { XpProgressBar } from "./xp-progress-bar"
import {
  getExtractionHint,
  getResourceBarColor,
  getHealthBarColor,
  getEnemyBehaviorHint,
  getRecentEventPalette,
  getRecentEventLead,
  formatAbilityRange,
  getItemRarityBadgePalette,
  formatItemQuantity,
} from "../utils"
import { EQUIP_SLOT_ORDER, EQUIP_SLOT_LABELS } from "../constants"

export function DungeonView({
  observation,
  itemTemplateMap,
  waitingForResponse,
  actionError,
  onAction,
  onRetreat,
  onDismissError,
}: {
  observation: Observation
  itemTemplateMap: Record<string, ItemTemplate>
  waitingForResponse: boolean
  actionError: string | null
  onAction: (action: Action) => void
  onRetreat: () => void
  onDismissError: () => void
}) {
  const observationWithNewItems = observation as Observation & { new_item_ids?: string[] }
  const {
    character,
    position,
    visible_tiles,
    visible_entities,
    recent_events,
    legal_actions,
    realm_info,
    room_text,
    inventory,
    inventory_slots_used,
    inventory_capacity,
    equipment,
    gold,
  } = observation

  // Group legal actions by type
  const moveActions = legal_actions.filter((a): a is Action & { type: "move" } => a.type === "move")
  const attackActions = legal_actions.filter((a): a is Action & { type: "attack" } => a.type === "attack")
  const disarmTrapActions = legal_actions.filter(
    (a) => (a as { type: string }).type === "disarm_trap",
  ) as unknown as Array<{ type: "disarm_trap"; item_id: string }>
  const interactActions = legal_actions.filter((a): a is Action & { type: "interact" } => a.type === "interact")
  const useItemActions = legal_actions.filter((a): a is Action & { type: "use_item" } => a.type === "use_item")
  const equipActions = legal_actions.filter((a): a is Action & { type: "equip" } => a.type === "equip")
  const unequipActions = legal_actions.filter((a): a is Action & { type: "unequip" } => a.type === "unequip")
  const canWait = legal_actions.some((a) => a.type === "wait")
  const canPortal = legal_actions.some((a) => a.type === "use_portal")
  const canRetreat = legal_actions.some((a) => a.type === "retreat")
  const canPickup = legal_actions.filter((a): a is Action & { type: "pickup" } => a.type === "pickup")
  const portalScroll = inventory.find((item) => item.template_id === "portal-scroll")
  const portalLabel = portalScroll
    ? `Use Portal Scroll${portalScroll.quantity > 1 ? ` (${portalScroll.quantity})` : ""}`
    : "Step Through Portal"
  const extractionHint = getExtractionHint(realm_info.status, canPortal, canRetreat, portalScroll != null)
  const usableAbilityIds = new Set(attackActions.map((action) => action.ability_id ?? "basic-attack"))
  const abilityMap = new Map(character.abilities.map((ability) => [ability.id, ability]))
  const disarmAbility = abilityMap.get("rogue-disarm-trap")
  const disarmableItemIds = new Set(disarmTrapActions.map((action) => action.item_id))
  const visibleEnemies = visible_entities
    .filter(
      (entity): entity is Observation["visible_entities"][number] & { type: "enemy" } =>
        entity.type === "enemy",
    )
    .sort((left, right) => {
      if ((left.is_boss ? 1 : 0) !== (right.is_boss ? 1 : 0)) {
        return (right.is_boss ? 1 : 0) - (left.is_boss ? 1 : 0)
      }
      const leftRatio = left.hp_max ? (left.hp_current ?? left.hp_max) / left.hp_max : 1
      const rightRatio = right.hp_max ? (right.hp_current ?? right.hp_max) / right.hp_max : 1
      return leftRatio - rightRatio
    })
  const nearbyItems = visible_entities.filter(
    (entity): entity is Observation["visible_entities"][number] & { type: "item" } =>
      entity.type === "item",
  )
  const visibleTrapMarkers = visible_entities.filter(
    (entity): entity is Observation["visible_entities"][number] & { type: "trap_visible" } =>
      entity.type === "trap_visible",
  )
  const visibleInteractables = visible_entities.filter(
    (entity): entity is Observation["visible_entities"][number] & { type: "interactable" } =>
      entity.type === "interactable",
  )
  const dungeonXpToNext =
    "xp_to_next_level" in character && typeof character.xp_to_next_level === "number"
      ? character.xp_to_next_level
      : 0

  const hpPct = character.hp.max > 0 ? (character.hp.current / character.hp.max) * 100 : 0
  const hpColor = hpPct > 50 ? "bg-green-500" : hpPct > 25 ? "bg-yellow-500" : "bg-red-500"
  const resourceColor = getResourceBarColor(character.resource.type)
  const inventoryNearlyFull = inventory_slots_used >= Math.max(1, inventory_capacity - 2)
  const floorCanAscend = realm_info.current_floor > 1
  const floorCanDescend = realm_info.current_floor < realm_info.floor_count
  const adjacentStairHint = useMemo(() => {
    const adjacentStair = visible_tiles.find((tile) => {
      const distance = Math.abs(tile.x - position.tile.x) + Math.abs(tile.y - position.tile.y)
      return distance === 1 && (tile.type === "stairs" || tile.type === "stairs_up")
    })
    if (!adjacentStair) return null

    if (adjacentStair.type === "stairs_up") {
      return {
        label: `Stairs up lead back to floor ${Math.max(1, realm_info.current_floor - 1)}.`,
        tone: "border-sky-800/70 bg-sky-950/20 text-sky-200",
      }
    }

    return {
      label: `Stairs down lead to floor ${Math.min(realm_info.floor_count, realm_info.current_floor + 1)}.`,
      tone: "border-cyan-800/70 bg-cyan-950/20 text-cyan-200",
    }
  }, [position.tile, realm_info.current_floor, realm_info.floor_count, visible_tiles])
  const newItemIds = useMemo(
    () => new Set(observationWithNewItems.new_item_ids ?? []),
    [observationWithNewItems.new_item_ids],
  )
  const equipActionByItemId = useMemo(
    () => new Map(equipActions.map((action) => [action.item_id, action])),
    [equipActions],
  )
  const unequipActionBySlot = useMemo(
    () => new Map(unequipActions.map((action) => [action.slot, action])),
    [unequipActions],
  )
  const statRows = [
    { label: "ATK", base: character.base_stats.attack, effective: character.effective_stats.attack },
    { label: "DEF", base: character.base_stats.defense, effective: character.effective_stats.defense },
    { label: "ACC", base: character.base_stats.accuracy, effective: character.effective_stats.accuracy },
    { label: "EVA", base: character.base_stats.evasion, effective: character.effective_stats.evasion },
    { label: "SPD", base: character.base_stats.speed, effective: character.effective_stats.speed },
  ]

  // Fog-of-war: accumulate visible tiles so previously-seen areas stay on the map (dimmed)
  const tileAccumRef = useRef<Map<string, Tile>>(new Map())
  const lastRoomRef = useRef<string>("")

  const currentRoomId = position.room_id
  if (currentRoomId !== lastRoomRef.current) {
    tileAccumRef.current = new Map()
    lastRoomRef.current = currentRoomId
  }
  const visibleKeySet = new Set<string>()
  for (const tile of visible_tiles) {
    const key = `${tile.x},${tile.y}`
    visibleKeySet.add(key)
    tileAccumRef.current.set(key, tile)
  }
  const knownTiles = useMemo(() => {
    const result: Tile[] = []
    for (const [key, tile] of tileAccumRef.current) {
      if (!visibleKeySet.has(key)) result.push(tile)
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible_tiles])

  // Arrow key → movement mapping
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (waitingForResponse) return
      const dirMap: Record<string, "up" | "down" | "left" | "right"> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      }
      const direction = dirMap[e.key]
      if (!direction) return
      const action = moveActions.find((a) => a.direction === direction)
      if (action) {
        e.preventDefault()
        onAction(action)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [moveActions, waitingForResponse, onAction])

  return (
    <main className="min-h-screen flex flex-col p-4">
      <div className="max-w-5xl w-full mx-auto flex-1 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span className="text-amber-400 font-bold">{realm_info.template_name}</span>
          <span className="flex items-center gap-2">
            <span>
              Floor {realm_info.current_floor} / {realm_info.floor_count}
            </span>
            <span className="text-gray-600">
              {floorCanAscend ? "↑" : "·"}
              {floorCanDescend ? "↓" : "·"}
            </span>
            <span>Turn {observation.turn}</span>
          </span>
        </div>
        {extractionHint && (
          <div className="rounded border border-amber-800/70 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
            <div className="font-semibold uppercase tracking-wide text-[11px] text-amber-400">
              Extraction Ready
            </div>
            <p className="mt-1">{extractionHint}</p>
          </div>
        )}
        {adjacentStairHint && (
          <div className={`rounded border px-4 py-3 text-sm ${adjacentStairHint.tone}`}>
            <div className="font-semibold uppercase tracking-wide text-[11px]">Stairway Nearby</div>
            <p className="mt-1">{adjacentStairHint.label}</p>
          </div>
        )}

        {/* Main area: map + status */}
        <div className="flex flex-col md:flex-row gap-4 flex-1">
          {/* Map */}
          <div className="md:w-2/3 border border-gray-800 rounded p-4 bg-gray-950">
            <GameMap
              visibleTiles={visible_tiles}
              knownTiles={knownTiles}
              playerPosition={position.tile}
              entities={visible_entities}
            />
            {visibleInteractables.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-800 pt-2">
                {visibleInteractables.map((entity) => (
                  <span
                    key={entity.id}
                    className="rounded-full border border-amber-800/60 bg-amber-950/20 px-3 py-1 text-[11px] text-amber-200"
                    title="Room-wide interactable"
                  >
                    ! {entity.name}
                  </span>
                ))}
              </div>
            )}
            {room_text && (
              <p className="text-gray-400 text-xs mt-3 italic border-t border-gray-800 pt-2">
                {room_text}
              </p>
            )}

            {/* Recent events — moved inside map column */}
            {recent_events.length > 0 && (
              <div className="mt-3 border-t border-gray-800 pt-2">
                <div className="text-xs text-gray-500 uppercase mb-1">Recent Events</div>
                {recent_events.slice(-8).map((e, i) => (
                  <div
                    key={i}
                    className={`text-xs rounded border px-2 py-1 mb-1 ${
                      getRecentEventPalette(e, i >= recent_events.length - 2)
                    }`}
                  >
                    {getRecentEventLead(e)} {e.detail}
                  </div>
                ))}
              </div>
            )}

            {/* Action error toast — moved inside map column */}
            {actionError && (
              <button
                onClick={onDismissError}
                className="mt-2 w-full rounded border border-red-800/70 bg-red-950/30 px-4 py-2 text-sm text-red-200 text-left transition-opacity hover:bg-red-950/50"
              >
                <div className="flex items-center justify-between gap-3">
                  <span>{actionError}</span>
                  <span className="text-red-400 text-xs shrink-0">dismiss</span>
                </div>
              </button>
            )}

            {/* Action buttons — moved inside map column */}
            <div className="mt-3 border-t border-gray-800 pt-3 space-y-3">
              {waitingForResponse && (
                <p className="text-gray-500 text-xs text-center">Resolving...</p>
              )}

              {/* Movement */}
              {moveActions.length > 0 && (
                <div className="flex flex-wrap gap-2 justify-center">
                  {(["up", "down", "left", "right"] as const).map((dir) => {
                    const action = moveActions.find((a) => a.direction === dir)
                    if (!action) return null
                    const labels = { up: "Move N", down: "Move S", left: "Move W", right: "Move E" }
                    return (
                      <button
                        key={dir}
                        disabled={waitingForResponse}
                        onClick={() => onAction(action)}
                        className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {labels[dir]}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Attack */}
              {attackActions.length > 0 && (
                <div className="flex flex-wrap gap-2 justify-center">
                  {attackActions.map((action, i) => {
                    const entity = visible_entities.find((e) => e.id === action.target_id)
                    const ability = abilityMap.get(action.ability_id ?? "basic-attack")
                    const targetLabel = action.target_id === "self"
                      ? "Self"
                      : entity?.hp_current != null && entity.hp_max != null
                        ? `${entity.name} (${entity.hp_current}/${entity.hp_max} HP)`
                        : (entity?.name ?? action.target_id)
                    return (
                      <button
                        key={i}
                        disabled={waitingForResponse}
                        onClick={() => onAction(action)}
                        className={`px-3 py-2 text-left text-xs rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          action.target_id === "self"
                            ? "bg-violet-900/50 hover:bg-violet-900 text-violet-200"
                            : "bg-red-900/50 hover:bg-red-900 text-red-200"
                        }`}
                      >
                        <div className="font-medium">{ability?.name ?? "Attack"}: {targetLabel}</div>
                        <div className="text-[11px] opacity-80">
                          {ability
                            ? `${ability.resource_cost} ${character.resource.type} • ${formatAbilityRange(ability.range)}`
                            : "Basic attack"}
                        </div>
                        {entity?.behavior && (
                          <div className="mt-1 text-[11px] opacity-70">
                            {entity.is_boss ? "Boss target" : `${entity.behavior} target`}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Trap utility */}
              {disarmTrapActions.length > 0 && (
                <div className="space-y-2">
                  <div className="text-center text-[11px] uppercase tracking-wide text-teal-400">Trap Utility</div>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {disarmTrapActions.map((action, i) => {
                      const entity = visible_entities.find((e) => e.id === action.item_id)
                      return (
                        <button
                          key={i}
                          disabled={waitingForResponse}
                          onClick={() => onAction(action as unknown as Action)}
                          className="px-3 py-2 text-left text-xs bg-teal-950/50 hover:bg-teal-900/60 text-teal-200 rounded border border-teal-800/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <div className="font-medium">Disarm Trap: {entity?.name ?? action.item_id}</div>
                          <div className="text-[11px] opacity-80">Costs {disarmAbility?.resource_cost ?? 1} {character.resource.type}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Interact */}
              {interactActions.length > 0 && (
                <div className="flex flex-wrap gap-2 justify-center">
                  {interactActions.map((action, i) => {
                    const entity = visible_entities.find((e) => e.id === action.target_id)
                    return (
                      <button
                        key={i}
                        disabled={waitingForResponse}
                        onClick={() => onAction(action)}
                        className="px-3 py-1 text-xs bg-amber-900/50 hover:bg-amber-900 text-amber-300 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Interact: {entity?.name ?? action.target_id}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Pickup */}
              {canPickup.length > 0 && (
                <div className="flex flex-wrap gap-2 justify-center">
                  {canPickup.map((action, i) => {
                    const entity = visible_entities.find((e) => e.id === action.item_id)
                    const itemRarity =
                      entity?.type === "item" && "rarity" in entity && typeof entity.rarity === "string"
                        ? entity.rarity
                        : null
                    return (
                      <button
                        key={i}
                        disabled={waitingForResponse}
                        onClick={() => onAction(action)}
                        className="px-3 py-1 text-xs bg-amber-900/50 hover:bg-amber-900 text-amber-300 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center gap-2">
                          <span>Pick up {entity?.name ?? action.item_id}</span>
                          {itemRarity && (
                            <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${getItemRarityBadgePalette(itemRarity)}`}>
                              {itemRarity}
                            </span>
                          )}
                          {disarmableItemIds.has(action.item_id) && (
                            <span className="rounded border border-red-800/70 bg-red-950/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-200">
                              Trapped
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Use Item */}
              {useItemActions.length > 0 && (
                <div className="flex flex-wrap gap-2 justify-center">
                  {useItemActions.map((action, i) => {
                    const item = inventory.find((it) => it.item_id === action.item_id)
                    return (
                      <button
                        key={i}
                        disabled={waitingForResponse}
                        onClick={() => onAction(action)}
                        className="px-3 py-1 text-xs bg-blue-900/50 hover:bg-blue-900 text-blue-300 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Use {item?.name ?? action.item_id}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Utility: Wait, Portal, Retreat */}
              <div className="flex flex-wrap gap-2 justify-center">
                {canWait && (
                  <button
                    disabled={waitingForResponse}
                    onClick={() => onAction({ type: "wait" })}
                    className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Wait
                  </button>
                )}
                {canPortal && (
                  <button
                    disabled={waitingForResponse}
                    onClick={() => onAction({ type: "use_portal" })}
                    className="px-3 py-2 text-left text-xs bg-indigo-900/60 hover:bg-indigo-900 text-indigo-200 rounded border border-indigo-700/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <div className="font-medium">{portalLabel}</div>
                    <div className="text-[11px] opacity-80">
                      {portalScroll ? "Consumes 1 scroll and ends the run safely." : "Escape through the active portal."}
                    </div>
                  </button>
                )}
                {canRetreat && (
                  <button
                    disabled={waitingForResponse}
                    onClick={onRetreat}
                    className="px-3 py-2 text-left text-xs bg-slate-900/70 hover:bg-slate-800 text-slate-200 rounded border border-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <div className="font-medium">Retreat to Town</div>
                    <div className="text-[11px] opacity-80">Available only from the first-floor entrance.</div>
                  </button>
                )}
              </div>
              <p className="text-center text-[11px] text-gray-600">
                Portal escape requires a portal scroll. Retreat works only from the first-floor entrance.
              </p>
            </div>
          </div>

          {/* Status panel */}
          <div className="md:w-1/3 border border-gray-800 rounded p-4 space-y-4">
            {/* Character info */}
            <div>
              <div className="text-xs text-gray-500 uppercase mb-1">
                Level {character.level} {character.class}
              </div>
              <div className="text-xs text-gray-500 mb-2">Gold: {gold}</div>
              <XpProgressBar
                xp={character.xp}
                level={character.level}
                xpToNext={dungeonXpToNext}
                xpForNext={character.xp + dungeonXpToNext}
                compact
              />
            </div>

            <StatusMeter
              label="HP"
              current={character.hp.current}
              max={character.hp.max}
              colorClass={hpColor}
            />

            <StatusMeter
              label={character.resource.type}
              current={character.resource.current}
              max={character.resource.max}
              colorClass={resourceColor}
            />

            {/* Stats */}
            <div className="text-xs text-gray-600 space-y-1">
              {statRows.map((stat) => (
                <div key={stat.label} className="flex justify-between gap-3">
                  <span>{stat.label}</span>
                  <span className="text-gray-300">
                    {stat.effective}
                    {stat.effective !== stat.base && (
                      <span className={stat.effective > stat.base ? "text-green-400" : "text-red-400"}>
                        {" "}
                        ({stat.effective > stat.base ? "+" : ""}
                        {stat.effective - stat.base})
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {/* Buffs/Debuffs */}
            {(character.buffs.length > 0 || character.debuffs.length > 0) && (
              <div>
                <div className="text-xs text-gray-500 uppercase mb-1">Effects</div>
                <div className="flex flex-wrap gap-2">
                  {character.buffs.map((buff, index) => (
                    <StatusEffectBadge key={`buff-${index}`} effect={buff} tone="buff" />
                  ))}
                  {character.debuffs.map((debuff, index) => (
                    <StatusEffectBadge key={`debuff-${index}`} effect={debuff} tone="debuff" />
                  ))}
                </div>
              </div>
            )}

            {visibleEnemies.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 uppercase mb-2">Enemies</div>
                <div className="space-y-3">
                  {visibleEnemies.map((enemy) => {
                    const enemyHpPct = enemy.hp_max ? ((enemy.hp_current ?? enemy.hp_max) / enemy.hp_max) * 100 : 0
                    const enemyEffects = enemy.effects ?? []
                    return (
                      <div
                        key={enemy.id}
                        className={`rounded border p-3 ${
                          enemy.is_boss
                            ? "border-amber-800/70 bg-amber-950/15"
                            : "border-gray-800 bg-gray-950"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm font-medium text-gray-200">{enemy.name}</div>
                          <EnemyBehaviorBadge behavior={enemy.behavior} isBoss={enemy.is_boss} />
                        </div>
                        <div className="mt-2">
                          <StatusMeter
                            label={enemy.is_boss ? "Boss HP" : "HP"}
                            current={enemy.hp_current ?? enemy.hp_max ?? 0}
                            max={enemy.hp_max ?? enemy.hp_current ?? 0}
                            colorClass={getHealthBarColor(enemyHpPct)}
                          />
                        </div>
                        {enemyEffects.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {enemyEffects.map((effect, index) => (
                              <StatusEffectBadge
                                key={`${enemy.id}-effect-${index}`}
                                effect={effect}
                                tone={effect.type.startsWith("buff-") ? "buff" : "debuff"}
                              />
                            ))}
                          </div>
                        )}
                        {!enemy.is_boss && enemy.behavior && (
                          <p className="mt-2 text-[11px] text-gray-500">
                            {getEnemyBehaviorHint(enemy.behavior)}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {(nearbyItems.length > 0 || visibleTrapMarkers.length > 0) && (
              <div>
                <div className="text-xs text-gray-500 uppercase mb-2">Nearby Objects</div>
                <div className="space-y-2">
                  {nearbyItems.map((item) => (
                    <div key={item.id} className="rounded border border-gray-800 bg-gray-950 p-2 text-xs">
                      {(() => {
                        const isTrapped = (item as { trapped?: boolean }).trapped === true
                        return (
                          <>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-gray-200">{item.name}</span>
                        {isTrapped && (
                          <span className="rounded border border-red-800/70 bg-red-950/30 px-2 py-1 text-[10px] uppercase tracking-wide text-red-200">
                            Trap detected
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500">
                        {isTrapped
                          ? "A Rogue can disarm this before looting it."
                          : "Safe to pick up from an adjacent tile."}
                      </p>
                          </>
                        )
                      })()}
                    </div>
                  ))}
                  {visibleTrapMarkers.map((trap) => (
                    <div
                      key={trap.id}
                      className="rounded border border-red-900/70 bg-red-950/20 p-2 text-xs text-red-200"
                    >
                      <div className="font-medium">{trap.name}</div>
                      <p className="mt-1 text-[11px] text-red-300/80">
                        The trap's location is now marked on the floor.
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-xs text-gray-500 uppercase mb-1">Abilities</div>
              <div className="space-y-2">
                {character.abilities.map((ability) => {
                  const usable = usableAbilityIds.has(ability.id)
                  const onCooldown = ability.current_cooldown > 0
                  const missingResource =
                    character.resource.current < ability.resource_cost && !onCooldown
                  const tone = onCooldown
                    ? "border-gray-800 bg-gray-950 text-gray-500"
                    : missingResource
                      ? "border-red-900/70 bg-red-950/30 text-red-300"
                      : usable
                        ? "border-emerald-800/70 bg-emerald-950/20 text-emerald-300"
                        : "border-gray-800 bg-gray-950 text-gray-400"

                  return (
                    <div key={ability.id} className={`rounded border p-2 text-xs ${tone}`}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{ability.name}</span>
                        <span className="text-[10px] uppercase tracking-wide">
                          {formatAbilityRange(ability.range)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-[11px]">
                        <span>
                          Cost {ability.resource_cost} {character.resource.type}
                        </span>
                        <span>
                          {onCooldown
                            ? `${ability.current_cooldown}t cooldown`
                            : missingResource
                              ? "Need more resource"
                              : usable
                                ? "Ready"
                                : "No target"}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-400">{ability.description}</p>
                    </div>
                  )
                })}
              </div>
            </div>

            <DungeonEquipmentPanel
              inventory={inventory}
              equipment={equipment}
              itemTemplateMap={itemTemplateMap}
              inventorySlotsUsed={inventory_slots_used}
              inventoryCapacity={inventory_capacity}
              newItemIds={newItemIds}
              equipActionByItemId={equipActionByItemId}
              unequipActionBySlot={unequipActionBySlot}
              waitingForResponse={waitingForResponse}
              onAction={onAction}
            />
          </div>
        </div>

      </div>
    </main>
  )
}
