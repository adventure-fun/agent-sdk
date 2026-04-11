import type { CharacterClass, EquipSlot, InventoryItem, ItemTemplate } from "@adventure-fun/schemas"
import { getInventoryCapacity } from "@adventure-fun/schemas"
import { EQUIP_SLOT_ORDER, EQUIP_SLOT_LABELS } from "../constants"
import { safeGetItemTemplate, formatItemStats, getEquipComparisonTitle } from "../utils"

export function GearManagementPanel({
  inventory,
  itemTemplateMap,
  characterClass,
  isLoading,
  onEquip,
  onUnequip,
}: {
  inventory: InventoryItem[]
  itemTemplateMap: Record<string, ItemTemplate>
  characterClass: CharacterClass
  isLoading: boolean
  onEquip: (itemId: string) => Promise<void>
  onUnequip: (slot: EquipSlot) => Promise<void>
}) {
  const equippedItems = Object.fromEntries(
    EQUIP_SLOT_ORDER.map((slot) => [slot, inventory.find((item) => item.slot === slot) ?? null]),
  ) as Record<EquipSlot, InventoryItem | null>
  const bagItems = inventory.filter((item) => !item.slot)
  const bagCapacity = getInventoryCapacity()
  const bagFull = bagItems.length >= bagCapacity

  return (
    <div className="rounded border border-gray-800 bg-gray-950/60 p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Equipment and Inventory</p>
          <p className="text-[11px] text-gray-600">{bagItems.length}/{bagCapacity} bag slots used</p>
        </div>
        {bagFull ? (
          <span className="rounded border border-red-800/70 bg-red-950/30 px-2 py-1 text-[10px] uppercase tracking-wide text-red-200">
            Bag full
          </span>
        ) : null}
      </div>

      <div className="space-y-2">
        {EQUIP_SLOT_ORDER.map((slot) => {
          const item = equippedItems[slot]
          const template = item ? safeGetItemTemplate(item.template_id, itemTemplateMap) : null
          return (
            <div
              key={slot}
              className="flex items-center justify-between gap-3 rounded border border-gray-800 bg-gray-900/70 px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="text-gray-500">{EQUIP_SLOT_LABELS[slot]}</p>
                <p className={item ? "truncate text-gray-200" : "text-gray-600"}>{item?.name ?? "Empty"}</p>
                {template?.stats ? (
                  <p className="text-[11px] text-gray-500">{formatItemStats(template.stats)}</p>
                ) : null}
              </div>
              {item ? (
                <button
                  type="button"
                  disabled={isLoading || bagFull}
                  onClick={() => void onUnequip(slot)}
                  title={bagFull ? "Free a bag slot before unequipping." : `Unequip ${item.name}`}
                  className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 transition-colors hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Unequip
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Bag Gear</p>
          <span className="text-[11px] text-gray-600">Unequip here, then sell in the shop</span>
        </div>
        {bagItems.length === 0 ? (
          <div className="rounded border border-dashed border-gray-700 p-3 text-center text-xs text-gray-500">
            Your pack is empty.
          </div>
        ) : (
          <div className="space-y-2">
            {bagItems.map((item) => {
              const template = safeGetItemTemplate(item.template_id, itemTemplateMap)
              const canEquip = template?.type === "equipment" && !!template.equip_slot
              const classLocked =
                canEquip && template.class_restriction && template.class_restriction !== characterClass
              const equippedInSlot =
                canEquip && template.equip_slot ? equippedItems[template.equip_slot] : null

              return (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded border border-gray-800 bg-gray-900/70 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-gray-200">{item.name}</p>
                      {canEquip && template.equip_slot ? (
                        <span className="rounded border border-blue-800/60 bg-blue-950/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-blue-200">
                          {EQUIP_SLOT_LABELS[template.equip_slot]}
                        </span>
                      ) : null}
                      {classLocked ? (
                        <span className="rounded border border-violet-800/60 bg-violet-950/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-violet-200">
                          {template.class_restriction} only
                        </span>
                      ) : null}
                    </div>
                    <p className="text-gray-500">{item.template_id?.startsWith("ammo-") ? `(${item.quantity})` : `x${item.quantity}`}</p>
                    {template?.stats ? (
                      <p className="text-[11px] text-gray-500">{formatItemStats(template.stats)}</p>
                    ) : null}
                  </div>
                  {canEquip ? (
                    <button
                      type="button"
                      disabled={isLoading || Boolean(classLocked)}
                      onClick={() => void onEquip(item.id)}
                      title={getEquipComparisonTitle(template, equippedInSlot, itemTemplateMap)}
                      className="rounded border border-cyan-700/70 bg-cyan-950/20 px-2 py-1 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Equip
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
