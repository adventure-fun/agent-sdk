"use client"

import { useEffect, useRef, useMemo, useState } from "react"
import type { Observation, Action, ItemTemplate, Tile } from "@adventure-fun/schemas"
import { GameMap } from "../../components/game-map"
import { CharacterPanel } from "./character-panel"
import { StatusMeter } from "./status-meter"
import { StatusEffectBadge } from "./status-effect-badge"
import { EnemyBehaviorBadge } from "./enemy-behavior-badge"
import { DungeonEquipmentPanel } from "./dungeon-equipment-panel"
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
  // `wait` is always legal in the engine but hidden from the UI — see the
  // Utility buttons block below for rationale.
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
  const hpColor = hpPct > 50 ? "bg-green-500" : hpPct > 25 ? "bg-ob-primary-dim" : "bg-ob-error"
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
        tone: "border-ob-tertiary/40 bg-ob-tertiary/10 text-ob-tertiary",
      }
    }

    return {
      label: `Stairs down lead to floor ${Math.min(realm_info.floor_count, realm_info.current_floor + 1)}.`,
      tone: "border-cyan-800/70 bg-ob-tertiary/10 text-ob-tertiary",
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

  // Tracks the d-pad direction the user just pressed (via key OR click)
  // so we can flash ONLY that button briefly. Without this, the previous
  // implementation relied on `disabled:opacity-30` to communicate the
  // in-flight state, which made all four arrows fade simultaneously
  // every time a single move was issued — looked like the whole d-pad
  // was blinking. Now we visually highlight the pressed direction only.
  const [pressedDir, setPressedDir] = useState<"up" | "down" | "left" | "right" | null>(null)
  const flashDir = (dir: "up" | "down" | "left" | "right") => {
    setPressedDir(dir)
    // Long enough to be perceptible, short enough to clear before the
    // next turn rolls in for fast players. Matches the engine's typical
    // turn-resolution latency loosely.
    window.setTimeout(() => setPressedDir((prev) => (prev === dir ? null : prev)), 180)
  }

  // Arrow key → movement mapping
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (waitingForResponse) return
      const dirMap: Record<string, "up" | "down" | "left" | "right"> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        w: "up",
        s: "down",
        a: "left",
        d: "right",
        W: "up",
        S: "down",
        A: "left",
        D: "right",
      }
      const direction = dirMap[e.key]
      if (!direction) return
      const action = moveActions.find((a) => a.direction === direction)
      if (action) {
        e.preventDefault()
        flashDir(direction)
        onAction(action)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [moveActions, waitingForResponse, onAction])

  return (
    <main className="min-h-screen flex flex-col px-4 pt-2 pb-4 bg-aw-bg aw-label">
      <div className="max-w-6xl w-full mx-auto flex-1 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between text-xs text-aw-outline">
          <span className="text-aw-primary aw-headline font-bold tracking-widest">{realm_info.template_name}</span>
          <span className="flex items-center gap-3 tracking-widest uppercase">
            <span>
              Floor {realm_info.current_floor} / {realm_info.floor_count}
            </span>
            <span className="text-aw-surface-bright">
              {floorCanAscend ? "↑" : "·"}
              {floorCanDescend ? "↓" : "·"}
            </span>
            <span>Turn {observation.turn}</span>
          </span>
        </div>
        {extractionHint && (
          <div className="border border-aw-primary/30 bg-aw-primary-container/10 px-4 py-3 text-sm text-aw-on-primary-container">
            <div className="aw-headline text-[10px] text-aw-primary tracking-widest mb-1">
              EXTRACTION_READY
            </div>
            <p className="text-aw-on-surface-variant">{extractionHint}</p>
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
          <div className="md:w-2/3 border border-aw-secondary/20 rounded-sm p-3 bg-black relative"
               style={{ boxShadow: "0 0 30px rgba(118,211,244,0.04)" }}>
            {/* Corner brackets */}
            <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-aw-secondary/30 pointer-events-none" />
            <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-aw-secondary/30 pointer-events-none" />
            <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-aw-secondary/30 pointer-events-none" />
            <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-aw-secondary/30 pointer-events-none" />
            <GameMap
              visibleTiles={visible_tiles}
              knownTiles={knownTiles}
              playerPosition={position.tile}
              playerHpPercent={Math.round(hpPct)}
              entities={visible_entities}
              realmTemplateId={realm_info.template_id}
              playerClass={character.class}
              recentEvents={recent_events}
              turn={observation.turn}
              playerDebuffs={character.debuffs}
            />
            {visibleInteractables.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-2">
                {visibleInteractables.map((entity) => (
                  <span
                    key={entity.id}
                    className="border border-aw-primary/40 bg-aw-primary-container/20 px-3 py-1 text-[11px] text-aw-primary tracking-wide"
                    title="Room-wide interactable"
                  >
                    ! {entity.name}
                  </span>
                ))}
              </div>
            )}
            {/* Info + d-pad row.
                Layout: room text, recent events, action error, and all
                non-movement action buttons live in the LEFT 2/3. The
                d-pad lives in the RIGHT 1/3 with `self-start` so its
                top edge always lines up with the top of the room text,
                regardless of how tall the events list grows. Without
                this split, every new event pushed the d-pad downward
                and made it feel like the controls were jumping around
                the screen. */}
            <div className="mt-3 border-t border-white/5 pt-2 flex flex-row gap-4">
              {/* LEFT: info + non-movement actions */}
              <div className="w-2/3 flex flex-col min-w-0">
                {/* Room text — reserves line-height even when empty so
                    the recent-events block below doesn't jump. */}
                <p className="text-aw-on-surface-variant text-xs italic min-h-[1.25rem]">
                  {room_text ?? "\u00A0"}
                </p>

                {/* Recent events — scrollable slot showing the last 6 events
                    so multi-hit AoEs, status ticks, and counter-attacks don't
                    scroll off the screen before the player can read them. */}
                <div className="mt-3 border-t border-white/5 pt-2 min-h-[5.5rem] max-h-[14rem] overflow-y-auto">
                  <div className="text-[10px] text-aw-outline uppercase tracking-[0.2em] mb-1">RECENT_EVENTS</div>
                  {recent_events.length > 0 ? (
                    recent_events.slice(-6).map((e, i, arr) => (
                      <div
                        key={`${e.turn}-${i}`}
                        className={`text-xs rounded border px-2 py-1 mb-1 ${
                          getRecentEventPalette(e, i === arr.length - 1)
                        }`}
                      >
                        {getRecentEventLead(e)} {e.detail}
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-aw-outline italic">No events yet.</div>
                  )}
                </div>

                {/* Action error toast */}
                {actionError && (
                  <button
                    onClick={onDismissError}
                    className="mt-2 w-full rounded border border-ob-error/30 bg-ob-error/15 px-4 py-2 text-sm text-ob-error text-left transition-opacity hover:bg-ob-error/20"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span>{actionError}</span>
                      <span className="text-ob-error text-xs shrink-0">dismiss</span>
                    </div>
                  </button>
                )}

                {/* Non-movement action buttons follow below. Wrapped in
                    its own block so the d-pad column doesn't share their
                    width budget. */}
                <div className="mt-3 border-t border-white/5 pt-3 space-y-3">

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
                            : "bg-ob-error/15 hover:bg-ob-error/20 text-ob-error"
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
                        className="px-3 py-1.5 text-xs bg-aw-primary-container/30 hover:bg-aw-primary-container/50 text-aw-primary border border-aw-primary/20 tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                        className="px-3 py-1.5 text-xs bg-aw-primary-container/30 hover:bg-aw-primary-container/50 text-aw-primary border border-aw-primary/20 tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center gap-2">
                          <span>Pick up {entity?.name ?? action.item_id}</span>
                          {itemRarity && (
                            <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${getItemRarityBadgePalette(itemRarity)}`}>
                              {itemRarity}
                            </span>
                          )}
                          {disarmableItemIds.has(action.item_id) && (
                            <span className="rounded border border-ob-error/30 bg-ob-error/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ob-error">
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

              {/* Utility: Portal, Retreat.
                  The "Wait" action is always legal (engine line turn.ts:3084
                  pushes it unconditionally) so it is never the *only* option
                  — showing it in the UI as a button is visual clutter with
                  no player value. Keyboard shortcut for wait could be added
                  later if we find a real use case. */}
              <div className="flex flex-wrap gap-2 justify-center">
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
              <p className="text-center text-[10px] text-aw-surface-bright tracking-wide">
                Portal escape requires a portal scroll. Retreat works only from the first-floor entrance.
              </p>
                </div>
              </div>

              {/* RIGHT: d-pad column. `self-start` keeps the top edge
                  pinned to the same y as the room text in the left
                  column, so the d-pad never moves vertically when the
                  events list grows or shrinks. */}
              <div className="w-1/3 flex justify-center self-start">
                {moveActions.length > 0 && (
                  <div
                    className="grid grid-cols-3 gap-1.5"
                    aria-label="Movement controls"
                  >
                    {([
                      { pos: 0, dir: null },
                      { pos: 1, dir: "up",    compass: "N" },
                      { pos: 2, dir: null },
                      { pos: 3, dir: "left",  compass: "W" },
                      { pos: 4, dir: null },
                      { pos: 5, dir: "right", compass: "E" },
                      { pos: 6, dir: null },
                      { pos: 7, dir: "down",  compass: "S" },
                      { pos: 8, dir: null },
                    ] as const).map((cell) => {
                      if (!cell.dir) {
                        return <div key={cell.pos} aria-hidden className="w-14 h-14" />
                      }
                      const action = moveActions.find((a) => a.direction === cell.dir)
                      const isLegal = !!action
                      const isPressed = pressedDir === cell.dir
                      const glyph = cell.dir === "up" ? "↑"
                        : cell.dir === "down" ? "↓"
                        : cell.dir === "left" ? "←"
                        : "→"
                      return (
                        <button
                          key={cell.pos}
                          type="button"
                          // Still disable during waitingForResponse to
                          // prevent queueing a second move, but DO NOT
                          // rely on the disabled fade for visual
                          // feedback — see pressedDir below.
                          disabled={!isLegal || waitingForResponse}
                          onClick={() => {
                            if (action) {
                              flashDir(cell.dir)
                              onAction(action)
                            }
                          }}
                          // Only the just-pressed direction lights up;
                          // the others stay at full opacity (unless they
                          // were never legal in this room, in which case
                          // they're permanently dimmed). Previously the
                          // global `disabled:opacity-30` made all four
                          // arrows blink together each turn.
                          className={`w-14 h-14 text-ob-on-surface border rounded-lg transition-colors flex flex-col items-center justify-center ${
                            isPressed
                              ? "bg-ob-primary/30 border-ob-primary text-ob-primary shadow-[0_0_12px_rgba(255,184,77,0.5)]"
                              : isLegal
                                ? "bg-ob-surface-container hover:bg-ob-surface-container-high active:bg-ob-surface-container-highest border-ob-outline-variant/15 hover:border-ob-primary/30"
                                : "bg-ob-surface-container border-ob-outline-variant/10 opacity-30 cursor-not-allowed"
                          }`}
                          title={`Move ${cell.compass}`}
                        >
                          <span className="text-xl leading-none">{glyph}</span>
                          <span className="ob-label text-[9px] tracking-widest text-ob-outline mt-0.5">
                            {cell.compass}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Status panel */}
          <CharacterPanel
            className="md:w-1/3"
            classLabel={character.class}
            level={character.level}
            gold={gold}
            xpToNext={dungeonXpToNext}
            xpForNext={character.xp + dungeonXpToNext}
            xpLevel={character.level}
            xp={character.xp}
            compactXp
            hpCurrent={character.hp.current}
            hpMax={character.hp.max}
            hpColor={hpColor}
            hpBonus={(() => {
              let bonus = 0
              for (const eq of Object.values(equipment)) {
                if (!eq) continue
                const tmpl = itemTemplateMap[eq.template_id]
                if (tmpl?.stats?.hp && typeof tmpl.stats.hp === "number") bonus += tmpl.stats.hp
              }
              return bonus
            })()}
            resourceLabel={character.resource.type}
            resourceCurrent={character.resource.current}
            resourceMax={character.resource.max}
            resourceColor={resourceColor}
            statRows={statRows}
          >
            {/* Buffs/Debuffs */}
            {(character.buffs.length > 0 || character.debuffs.length > 0) && (
              <div>
                <div className="text-[10px] text-aw-outline uppercase tracking-[0.2em] mb-1">Effects</div>
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
                <div className="text-[10px] text-aw-outline uppercase tracking-[0.2em] mb-2">Enemies</div>
                <div className="space-y-3">
                  {visibleEnemies.map((enemy) => {
                    const enemyHpPct = enemy.hp_max ? ((enemy.hp_current ?? enemy.hp_max) / enemy.hp_max) * 100 : 0
                    const enemyEffects = enemy.effects ?? []
                    return (
                      <div
                        key={enemy.id}
                        className={`rounded border p-3 ${
                          enemy.is_boss
                            ? "border-ob-primary/30 bg-ob-primary/10"
                            : "border-ob-outline-variant/15 bg-ob-bg"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm font-medium text-ob-on-surface">{enemy.name}</div>
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
                          <p className="mt-2 text-[11px] text-ob-outline">
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
                <div className="text-[10px] text-aw-outline uppercase tracking-[0.2em] mb-2">Nearby Objects</div>
                <div className="space-y-2">
                  {nearbyItems.map((item) => (
                    <div key={item.id} className="rounded border border-ob-outline-variant/15 bg-ob-bg p-2 text-xs">
                      {(() => {
                        const isTrapped = (item as { trapped?: boolean }).trapped === true
                        return (
                          <>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-ob-on-surface">{item.name}</span>
                        {isTrapped && (
                          <span className="rounded border border-ob-error/30 bg-ob-error/15 px-2 py-1 text-[10px] uppercase tracking-wide text-ob-error">
                            Trap detected
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-ob-outline">
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
                      className="rounded border border-ob-error/30 bg-ob-error/10 p-2 text-xs text-ob-error"
                    >
                      <div className="font-medium">{trap.name}</div>
                      <p className="mt-1 text-[11px] text-ob-error/80">
                        The trap's location is now marked on the floor.
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-[10px] text-aw-outline uppercase tracking-[0.2em] mb-1">Abilities</div>
              <div className="space-y-2">
                {character.abilities.map((ability) => (
                  <AbilityCard
                    key={ability.id}
                    ability={ability}
                    resourceType={character.resource.type}
                    resourceCurrent={character.resource.current}
                    usable={usableAbilityIds.has(ability.id)}
                  />
                ))}
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
          </CharacterPanel>
        </div>

      </div>
    </main>
  )
}

function AbilityCard({
  ability,
  resourceType,
  resourceCurrent,
  usable,
}: {
  ability: Observation["character"]["abilities"][number]
  resourceType: string
  resourceCurrent: number
  usable: boolean
}) {
  const [open, setOpen] = useState(false)
  const onCooldown = ability.current_cooldown > 0
  const missingResource = resourceCurrent < ability.resource_cost && !onCooldown
  const tone = onCooldown
    ? "border-ob-outline-variant/15 bg-ob-bg text-ob-outline"
    : missingResource
      ? "border-ob-error/30 bg-ob-error/15 text-ob-error"
      : usable
        ? "border-emerald-800/70 bg-ob-secondary/10 text-ob-secondary"
        : "border-ob-outline-variant/15 bg-ob-bg text-ob-on-surface-variant"

  const statusLabel = onCooldown
    ? `${ability.current_cooldown}t cd`
    : missingResource
      ? "Low res"
      : usable
        ? "Ready"
        : "No target"

  return (
    <div className={`rounded border text-xs ${tone}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left"
      >
        <span className="font-medium">{ability.name}</span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide">{statusLabel}</span>
          <svg className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5l3 3 3-3" /></svg>
        </span>
      </button>
      {open ? (
        <div className="border-t border-current/10 px-2 py-1.5 space-y-1">
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span>{formatAbilityRange(ability.range)}</span>
            <span>Cost {ability.resource_cost} {resourceType}</span>
          </div>
          <p className="text-[11px] text-ob-on-surface-variant">{ability.description}</p>
        </div>
      ) : null}
    </div>
  )
}
