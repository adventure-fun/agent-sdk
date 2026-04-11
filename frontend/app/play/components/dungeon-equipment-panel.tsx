import type { Action, EquipSlot, ItemTemplate, Observation } from "@adventure-fun/schemas"
import { EQUIP_SLOT_ORDER, EQUIP_SLOT_LABELS } from "../constants"
import { formatItemQuantity, safeGetItemTemplate, getEquipComparisonTitle } from "../utils"
import { ItemGridSlot } from "./item-grid-slot"

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
      {/* Equipment grid */}
      <div>
        <div className="text-xs text-gray-500 uppercase mb-2">Equipment</div>
        <div className="flex flex-wrap gap-2">
          {EQUIP_SLOT_ORDER.map((slot) => {
            const item = equipment[slot]
            const template = item ? safeGetItemTemplate(item.template_id, itemTemplateMap) : null
            const action = unequipActionBySlot.get(slot)
            return (
              <ItemGridSlot
                key={slot}
                label={EQUIP_SLOT_LABELS[slot]}
                item={item}
                template={template}
                action={item && action ? (
                  <button
                    type="button"
                    disabled={waitingForResponse}
                    onClick={() => onAction(action)}
                    className="mt-2 w-full rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 transition-colors hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Unequip
                  </button>
                ) : undefined}
              />
            )
          })}
        </div>
      </div>

      {/* Inventory grid */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
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
        <div className="flex flex-wrap gap-2">
          {inventory.length > 0 ? (
            inventory.map((item) => {
              const template = safeGetItemTemplate(item.template_id, itemTemplateMap)
              const equipAction = equipActionByItemId.get(item.item_id)
              const equippedInSlot =
                template?.type === "equipment" && template.equip_slot
                  ? equipment[template.equip_slot]
                  : null

              return (
                <ItemGridSlot
                  key={item.item_id}
                  label=""
                  item={item}
                  template={template}
                  quantityLabel={item.quantity > 1 ? `x${item.quantity}` : undefined}
                  badge={
                    newItemIds.has(item.item_id) ? (
                      <span className="absolute -top-1 -right-1 rounded-full border border-emerald-700 bg-emerald-950 px-1 text-[8px] text-emerald-300">
                        New
                      </span>
                    ) : undefined
                  }
                  action={equipAction ? (
                    <button
                      type="button"
                      disabled={waitingForResponse}
                      onClick={() => onAction(equipAction)}
                      title={template ? getEquipComparisonTitle(template, equippedInSlot, itemTemplateMap) : undefined}
                      className="mt-2 w-full rounded border border-cyan-700/70 bg-cyan-950/20 px-2 py-1 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Equip
                    </button>
                  ) : undefined}
                />
              )
            })
          ) : (
            <p className="text-xs text-gray-600">Pack is empty.</p>
          )}
          {/* Empty slots */}
          {Array.from({ length: Math.max(0, inventoryCapacity - inventory.length) }, (_, i) => (
            <ItemGridSlot key={`empty-${i}`} label="" item={null} template={null} />
          ))}
        </div>
      </div>
    </>
  )
}
