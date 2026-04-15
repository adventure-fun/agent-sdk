"use client"

import { useState, useMemo } from "react"
import type { InventoryItem, ItemTemplate } from "@adventure-fun/schemas"
import { getInventoryCapacity } from "@adventure-fun/schemas"
import { getItemIconSrc } from "../utils"
import { ShopItemIcon } from "./shop-item-icon"

export function ShopSellPanel({
  sections,
  inventoryTemplates,
  inventory,
  gold,
  isLoading,
  onSell,
  onDiscard,
}: {
  sections: Array<{ id: "consumable" | "equipment"; label: string; items: ItemTemplate[] }>
  inventoryTemplates?: Record<string, ItemTemplate>
  inventory: InventoryItem[]
  gold: number
  isLoading: boolean
  onSell: (itemId: string, quantity: number) => Promise<void>
  onDiscard: (itemId: string) => Promise<void>
}) {
  const [sellQuantities, setSellQuantities] = useState<Record<string, number>>({})
  const [confirmActionId, setConfirmActionId] = useState<string | null>(null)

  const templateMap = useMemo(() => {
    const map: Record<string, ItemTemplate> = { ...inventoryTemplates }
    for (const s of sections) for (const item of s.items) map[item.id] = item
    return map
  }, [sections, inventoryTemplates])

  const bagSlotsUsed = inventory.filter((item) => !item.slot).length
  const bagCapacity = getInventoryCapacity()

  return (
    <div className="rounded border border-ob-outline-variant/15 bg-ob-surface-container-low p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-ob-outline">Sell Inventory</h3>
          <p className="text-xs text-ob-outline">{bagSlotsUsed}/{bagCapacity} bag slots used</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ob-outline">Equipped items stay protected</span>
          <div className="rounded-full border border-ob-primary/30 bg-ob-primary/10 px-4 py-2 text-sm font-semibold text-ob-primary">
            Gold: {gold}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {inventory.length === 0 ? (
          <div className="rounded border border-dashed border-ob-outline-variant/30 p-4 text-center text-sm text-ob-outline">
            Your pack is empty.
          </div>
        ) : (
          inventory.map((item) => {
            const quantity = Math.min(sellQuantities[item.id] ?? 1, item.quantity)
            const isEquipped = Boolean(item.slot)
            const template = templateMap[item.template_id]
            const sellPrice = template?.sell_price ?? 0
            const canSell = sellPrice > 0
            const isConfirming = confirmActionId === item.id

            return (
              <div key={item.id} className="rounded border border-ob-outline-variant/15 bg-ob-bg/70 p-3 text-xs space-y-2">
                <div className="flex items-start gap-2">
                  {(() => {
                    const src = getItemIconSrc(template?.type, item.template_id)
                    return src ? <ShopItemIcon src={src} /> : null
                  })()}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-ob-on-surface">{item.name}</p>
                    <p className="text-ob-outline">
                      {item.quantity} in bag
                      {canSell ? (
                        <span className="ml-2 text-ob-primary">
                          {sellPrice}g each
                        </span>
                      ) : null}
                    </p>
                  </div>
                  {isEquipped ? (
                    <span className="rounded-full border border-blue-700/40 bg-blue-950/30 px-2 py-1 text-[10px] text-blue-200">
                      Equipped
                    </span>
                  ) : null}
                </div>

                {isEquipped ? null : isConfirming ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-ob-on-surface-variant">
                      {canSell
                        ? `Sell ${quantity} for ${sellPrice * quantity}g?`
                        : `Discard ${item.name}?`}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => {
                          setConfirmActionId(null)
                          if (canSell) {
                            void onSell(item.id, quantity)
                          } else {
                            void onDiscard(item.id)
                          }
                        }}
                        className="rounded bg-ob-primary px-3 py-1.5 text-xs font-bold text-black transition-colors hover:bg-ob-primary disabled:opacity-40"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmActionId(null)}
                        className="rounded border border-ob-outline-variant/30 px-3 py-1.5 text-xs text-ob-on-surface-variant transition-colors hover:border-ob-primary/40"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    {canSell ? (
                      <select
                        value={quantity}
                        onChange={(event) =>
                          setSellQuantities((current) => ({
                            ...current,
                            [item.id]: Number(event.target.value),
                          }))}
                        className="rounded border border-ob-outline-variant/30 bg-ob-surface-container-low px-2 py-1 text-xs text-ob-on-surface"
                      >
                        {Array.from({ length: item.quantity }, (_, index) => index + 1).map((value) => (
                          <option key={value} value={value}>
                            Sell {value} ({sellPrice * value}g)
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-ob-outline">Cannot sell</span>
                    )}
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => setConfirmActionId(item.id)}
                      className="rounded border border-ob-outline-variant/30 px-3 py-1.5 text-xs text-ob-on-surface transition-colors hover:border-ob-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {canSell ? "Sell" : "Discard"}
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
