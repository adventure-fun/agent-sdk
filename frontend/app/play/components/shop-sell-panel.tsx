"use client"

import { useState, useMemo } from "react"
import type { InventoryItem, ItemTemplate } from "@adventure-fun/schemas"
import { getInventoryCapacity } from "@adventure-fun/schemas"

export function ShopSellPanel({
  sections,
  inventory,
  gold,
  isLoading,
  onSell,
  onDiscard,
}: {
  sections: Array<{ id: "consumable" | "equipment"; label: string; items: ItemTemplate[] }>
  inventory: InventoryItem[]
  gold: number
  isLoading: boolean
  onSell: (itemId: string, quantity: number) => Promise<void>
  onDiscard: (itemId: string) => Promise<void>
}) {
  const [sellQuantities, setSellQuantities] = useState<Record<string, number>>({})
  const [confirmActionId, setConfirmActionId] = useState<string | null>(null)

  const templateMap = useMemo(() => {
    const map: Record<string, ItemTemplate> = {}
    for (const s of sections) for (const item of s.items) map[item.id] = item
    return map
  }, [sections])

  const bagSlotsUsed = inventory.filter((item) => !item.slot).length
  const bagCapacity = getInventoryCapacity()

  return (
    <div className="rounded border border-gray-800 bg-gray-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500">Sell Inventory</h3>
          <p className="text-xs text-gray-600">{bagSlotsUsed}/{bagCapacity} bag slots used</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">Equipped items stay protected</span>
          <div className="rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200">
            Gold: {gold}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {inventory.length === 0 ? (
          <div className="rounded border border-dashed border-gray-700 p-4 text-center text-sm text-gray-500">
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
              <div key={item.id} className="rounded border border-gray-800 bg-gray-950/70 p-3 text-xs space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-gray-100">{item.name}</p>
                    <p className="text-gray-500">
                      {item.quantity} in bag
                      {canSell ? (
                        <span className="ml-2 text-amber-400">
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
                    <p className="text-gray-400">
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
                        className="rounded bg-amber-500 px-3 py-1.5 text-xs font-bold text-black transition-colors hover:bg-amber-400 disabled:opacity-40"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmActionId(null)}
                        className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-500"
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
                        className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
                      >
                        {Array.from({ length: item.quantity }, (_, index) => index + 1).map((value) => (
                          <option key={value} value={value}>
                            Sell {value} ({sellPrice * value}g)
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-gray-500">Cannot sell</span>
                    )}
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => setConfirmActionId(item.id)}
                      className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-200 transition-colors hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
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
