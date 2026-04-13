import type { CharacterClass, EquipSlot, InventoryItem, ItemTemplate } from "@adventure-fun/schemas"
import { getInventoryCapacity } from "@adventure-fun/schemas"
import { EQUIP_SLOT_ORDER, EQUIP_SLOT_LABELS } from "../constants"
import { safeGetItemTemplate, getEquipComparisonTitle } from "../utils"
import { ItemGridSlot } from "./item-grid-slot"

export function GearManagementPanel({
  inventory,
  itemTemplateMap,
  characterClass,
  isLoading,
  onEquip,
  onUnequip,
  onUseConsumable,
  hpCurrent,
  hpMax,
  resourceCurrent,
  resourceMax,
}: {
  inventory: InventoryItem[]
  itemTemplateMap: Record<string, ItemTemplate>
  characterClass: CharacterClass
  isLoading: boolean
  onEquip: (itemId: string) => Promise<void>
  onUnequip: (slot: EquipSlot) => Promise<void>
  onUseConsumable?: (itemId: string) => Promise<void>
  hpCurrent?: number
  hpMax?: number
  resourceCurrent?: number
  resourceMax?: number
}) {
  const equippedItems = Object.fromEntries(
    EQUIP_SLOT_ORDER.map((slot) => [slot, inventory.find((item) => item.slot === slot) ?? null]),
  ) as Record<EquipSlot, InventoryItem | null>
  const bagItems = inventory.filter((item) => !item.slot)
  const bagCapacity = getInventoryCapacity()
  const bagFull = bagItems.length >= bagCapacity

  return (
    <div className="rounded border border-ob-outline-variant/15 bg-ob-bg/60 p-3 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-ob-outline">Equipment and Inventory</p>
          <p className="text-[11px] text-ob-outline">{bagItems.length}/{bagCapacity} bag slots used</p>
        </div>
        {bagFull ? (
          <span className="rounded border border-ob-error/30 bg-ob-error/15 px-2 py-1 text-[10px] uppercase tracking-wide text-ob-error">
            Bag full
          </span>
        ) : null}
      </div>

      {/* Equipment grid */}
      <div className="flex flex-wrap gap-2">
        {EQUIP_SLOT_ORDER.map((slot) => {
          const item = equippedItems[slot]
          const template = item ? safeGetItemTemplate(item.template_id, itemTemplateMap) : null
          return (
            <ItemGridSlot
              key={slot}
              label={EQUIP_SLOT_LABELS[slot]}
              item={item}
              template={template}
              action={item ? (
                <button
                  type="button"
                  disabled={isLoading || bagFull}
                  onClick={() => void onUnequip(slot)}
                  title={bagFull ? "Free a bag slot before unequipping." : `Unequip ${item.name}`}
                  className="mt-2 w-full rounded border border-ob-outline-variant/30 px-2 py-1 text-[11px] text-ob-on-surface transition-colors hover:border-ob-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Unequip
                </button>
              ) : undefined}
            />
          )
        })}
      </div>

      {/* Bag grid */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-xs font-bold uppercase tracking-wider text-ob-outline">Bag</p>
          <span className="text-[11px] text-ob-outline">Unequip here, then sell in the shop</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {bagItems.map((item) => {
            const template = safeGetItemTemplate(item.template_id, itemTemplateMap)
            const canEquip = template?.type === "equipment" && !!template.equip_slot
            const classLocked =
              canEquip && template.class_restriction && template.class_restriction !== characterClass
            const equippedInSlot =
              canEquip && template.equip_slot ? equippedItems[template.equip_slot] : null

            const isConsumable = template?.type === "consumable"
            const lobbyEffect = isConsumable
              ? template?.effects?.find((e) => e.type === "heal-hp" || e.type === "restore-resource")
              : null
            const canUseInLobby = onUseConsumable && lobbyEffect && (
              (lobbyEffect.type === "heal-hp" && hpCurrent != null && hpMax != null && hpCurrent < hpMax) ||
              (lobbyEffect.type === "restore-resource" && resourceCurrent != null && resourceMax != null && resourceCurrent < resourceMax)
            )

            return (
              <ItemGridSlot
                key={item.id}
                label=""
                item={item}
                template={template}
                quantityLabel={item.quantity > 1 ? (item.template_id?.startsWith("ammo-") ? `(${item.quantity})` : `x${item.quantity}`) : undefined}
                badge={
                  classLocked ? (
                    <span className="absolute -top-1 -right-1 rounded-full border border-violet-700 bg-violet-950 px-1 text-[8px] text-violet-300">
                      !
                    </span>
                  ) : undefined
                }
                action={
                  <>
                    {canEquip ? (
                      <button
                        type="button"
                        disabled={isLoading || Boolean(classLocked)}
                        onClick={() => void onEquip(item.id)}
                        title={getEquipComparisonTitle(template, equippedInSlot, itemTemplateMap)}
                        className="mt-2 w-full rounded border border-ob-tertiary/40 bg-ob-tertiary/10 px-2 py-1 text-[11px] font-semibold text-ob-tertiary transition-colors hover:bg-ob-tertiary/15 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Equip
                      </button>
                    ) : null}
                    {canUseInLobby ? (
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => void onUseConsumable(item.id)}
                        className="mt-2 w-full rounded border border-green-700/70 bg-green-950/20 px-2 py-1 text-[11px] font-semibold text-green-200 transition-colors hover:bg-green-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Use
                      </button>
                    ) : null}
                  </>
                }
              />
            )
          })}
          {/* Empty slots */}
          {Array.from({ length: Math.max(0, bagCapacity - bagItems.length) }, (_, i) => (
            <ItemGridSlot key={`empty-${i}`} label="" item={null} template={null} />
          ))}
        </div>
      </div>
    </div>
  )
}
