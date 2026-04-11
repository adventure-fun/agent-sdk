import type { Action, EquipSlot, ItemTemplate, Observation } from "@adventure-fun/schemas"
import { EQUIP_SLOT_ORDER, EQUIP_SLOT_LABELS } from "../constants"
import { formatItemQuantity, safeGetItemTemplate, formatItemStats, getEquipComparisonTitle } from "../utils"

export function DungeonEquipmentPanel({
  inventory,
  equipment,
  itemTemplateMap,
  inventorySlotsUsed,
  inventoryCapacity,
  newItemIds,
  equipActionByItemId,
  unequipActionBySlot,
  waitingForResponse,
  onAction,
}: {
  inventory: Observation["inventory"]
  equipment: Observation["equipment"]
  itemTemplateMap: Record<string, ItemTemplate>
  inventorySlotsUsed: number
  inventoryCapacity: number
  newItemIds: Set<string>
  equipActionByItemId: Map<string, Extract<Action, { type: "equip" }>>
  unequipActionBySlot: Map<EquipSlot, Extract<Action, { type: "unequip" }>>
  waitingForResponse: boolean
  onAction: (action: Action) => void
}) {
  const inventoryNearlyFull = inventorySlotsUsed >= Math.max(1, inventoryCapacity - 2)

  return (
    <>
      <div>
        <div className="text-xs text-gray-500 uppercase mb-1">Equipment</div>
        <div className="space-y-2 text-xs">
          {EQUIP_SLOT_ORDER.map((slot) => {
            const item = equipment[slot]
            const template = item ? safeGetItemTemplate(item.template_id, itemTemplateMap) : null
            const action = unequipActionBySlot.get(slot)
            return (
              <div
                key={slot}
                className="flex items-center justify-between gap-3 rounded border border-gray-800 bg-gray-950/50 px-2 py-1.5"
              >
                <div className="min-w-0">
                  <p className="text-gray-500">{EQUIP_SLOT_LABELS[slot]}</p>
                  <p className={item ? "truncate text-gray-300" : "text-gray-700"}>
                    {item?.name ?? "Empty"}
                  </p>
                  {template?.stats ? (
                    <p className="text-[11px] text-gray-500">{formatItemStats(template.stats)}</p>
                  ) : null}
                </div>
                {item && action ? (
                  <button
                    type="button"
                    disabled={waitingForResponse}
                    onClick={() => onAction(action)}
                    className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 transition-colors hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Unequip
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="text-xs text-gray-500 uppercase">
            Inventory ({inventorySlotsUsed}/{inventoryCapacity})
          </div>
          {inventorySlotsUsed >= inventoryCapacity && (
            <span className="rounded border border-red-800/70 bg-red-950/30 px-2 py-1 text-[10px] uppercase tracking-wide text-red-200">
              Full
            </span>
          )}
          {inventorySlotsUsed < inventoryCapacity && inventoryNearlyFull && (
            <span className="rounded border border-amber-800/70 bg-amber-950/20 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-200">
              Nearly full
            </span>
          )}
        </div>
        <div className="text-xs text-gray-400 space-y-2">
          {inventory.length > 0 ? (
            inventory.map((item) => {
              const template = safeGetItemTemplate(item.template_id, itemTemplateMap)
              const equipAction = equipActionByItemId.get(item.item_id)
              const equippedInSlot =
                template?.type === "equipment" && template.equip_slot
                  ? equipment[template.equip_slot]
                  : null

              return (
                <div
                  key={item.item_id}
                  className="flex items-start justify-between gap-3 rounded border border-gray-800 bg-gray-950/50 px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate">
                        {formatItemQuantity(item.name, item.quantity, item.template_id)}
                      </p>
                      {template?.type === "equipment" && template.equip_slot ? (
                        <span className="rounded border border-blue-800/60 bg-blue-950/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-blue-200">
                          {EQUIP_SLOT_LABELS[template.equip_slot]}
                        </span>
                      ) : null}
                      {newItemIds.has(item.item_id) && (
                        <span className="rounded border border-emerald-800/70 bg-emerald-950/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-200">
                          New
                        </span>
                      )}
                    </div>
                    {template?.stats ? (
                      <p className="text-[11px] text-gray-500">{formatItemStats(template.stats)}</p>
                    ) : null}
                  </div>
                  {equipAction ? (
                    <button
                      type="button"
                      disabled={waitingForResponse}
                      onClick={() => onAction(equipAction)}
                      title={template ? getEquipComparisonTitle(template, equippedInSlot, itemTemplateMap) : undefined}
                      className="rounded border border-cyan-700/70 bg-cyan-950/20 px-2 py-1 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Equip
                    </button>
                  ) : null}
                </div>
              )
            })
          ) : (
            <p className="text-gray-600">Pack is empty.</p>
          )}
        </div>
      </div>
    </>
  )
}
