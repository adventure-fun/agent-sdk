"use client"

import { useState, useMemo } from "react"
import type { InventoryItem, ItemTemplate } from "@adventure-fun/schemas"
import { getInventoryCapacity } from "@adventure-fun/schemas"

export function ShopPanel({
  sections,
  featured,
  inventory,
  gold,
  isLoading,
  error,
  onBuy,
  onSell,
  onDiscard,
}: {
  sections: Array<{ id: "consumable" | "equipment"; label: string; items: ItemTemplate[] }>
  featured: ItemTemplate[]
  inventory: InventoryItem[]
  gold: number
  isLoading: boolean
  error: string | null
  onBuy: (itemId: string, quantity: number) => Promise<void>
  onSell: (itemId: string, quantity: number) => Promise<void>
  onDiscard: (itemId: string) => Promise<void>
}) {
  const [category, setCategory] = useState<string>("all")
  const [buyQuantities, setBuyQuantities] = useState<Record<string, number>>({})
  const [sellQuantities, setSellQuantities] = useState<Record<string, number>>({})
  const [confirmActionId, setConfirmActionId] = useState<string | null>(null)

  const templateMap = useMemo(() => {
    const map: Record<string, ItemTemplate> = {}
    for (const s of sections) for (const item of s.items) map[item.id] = item
    return map
  }, [sections])

  const allItems = sections.flatMap((s) => s.items)
  const filteredItems = category === "all"
    ? allItems
    : category === "consumable"
      ? allItems.filter((i) => i.type === "consumable")
      : allItems.filter((i) => i.equip_slot === category)

  const bagSlotsUsed = inventory.filter((item) => !item.slot).length
  const bagCapacity = getInventoryCapacity()

  return (
    <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
      <div className="space-y-4">
        <div className="rounded border border-gray-800 bg-gray-900 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Lobby Shop</h2>
              <p className="text-xs text-gray-600">Buy supplies before the next descent.</p>
            </div>
            <div className="rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200">
              Gold: {gold}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { id: "all", label: "All" },
              { id: "consumable", label: "Consumables" },
              { id: "weapon", label: "Weapons" },
              { id: "armor", label: "Armor" },
              { id: "helm", label: "Helms" },
              { id: "hands", label: "Hands" },
              { id: "accessory", label: "Accessories" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategory(tab.id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  category === tab.id
                    ? "border-amber-400/60 bg-amber-500/10 text-amber-200"
                    : "border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          {isLoading ? <p className="text-sm text-gray-500">Loading shop inventory...</p> : null}

          {featured.length > 0 ? (
            <div className="rounded border border-amber-900/30 bg-amber-950/10 p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-300/70">Featured Gear</p>
              <div className="flex flex-wrap gap-2">
                {featured.slice(0, 4).map((item) => (
                  <span
                    key={item.id}
                    className="rounded-full border border-gray-700 bg-gray-950 px-3 py-1 text-xs text-gray-300"
                  >
                    {item.name} · {item.buy_price}g
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              {filteredItems.map((item) => {
                const quantity = buyQuantities[item.id] ?? 1
                const canStack = inventory.some(
                  (inventoryItem) =>
                    !inventoryItem.slot
                    && inventoryItem.template_id === item.id
                    && inventoryItem.quantity < item.stack_limit,
                )
                const inventoryFull = bagSlotsUsed >= bagCapacity && !canStack
                const tooExpensive = gold < item.buy_price * quantity
                const disabled = tooExpensive || inventoryFull

                return (
                  <div
                    key={item.id}
                    className="rounded border border-gray-800 bg-gray-950/60 p-3 text-xs space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        {item.equip_slot ? (
                          <span className="mb-1 inline-block rounded border border-cyan-700/40 bg-cyan-950/30 px-2 py-0.5 text-[10px] font-bold uppercase text-cyan-300">
                            {item.equip_slot}
                          </span>
                        ) : null}
                        <p className="font-bold text-gray-100">{item.name}</p>
                        <p className="mt-1 text-gray-500">{item.description}</p>
                      </div>
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
                        {item.buy_price}g
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 text-[10px]">
                      <span className="rounded-full border border-gray-700 px-2 py-1 text-gray-400">
                        {item.rarity}
                      </span>
                      {item.stack_limit > 1 ? (
                        <span className="rounded-full border border-gray-700 px-2 py-1 text-gray-400">
                          stack {item.stack_limit}
                        </span>
                      ) : null}
                      {item.class_restriction ? (
                        <span className="rounded-full border border-purple-700/40 bg-purple-950/30 px-2 py-1 text-purple-300">
                          {item.class_restriction} only
                        </span>
                      ) : null}
                    </div>

                    {item.stats && Object.keys(item.stats).length > 0 ? (
                      <div className="text-[11px] text-gray-400">
                        {Object.entries(item.stats)
                          .filter(([, value]) => value !== 0)
                          .map(([stat, value]) => `${stat.toUpperCase()} ${Number(value) > 0 ? "+" : ""}${value}`)
                          .join(" · ")}
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between gap-3">
                      <select
                        value={quantity}
                        onChange={(event) =>
                          setBuyQuantities((current) => ({
                            ...current,
                            [item.id]: Number(event.target.value),
                          }))}
                        className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
                      >
                        {Array.from({ length: Math.min(item.stack_limit, 5) }, (_, index) => index + 1).map((value) => (
                          <option key={value} value={value}>
                            Qty {value}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={disabled || isLoading}
                        onClick={() => onBuy(item.id, quantity)}
                        className="rounded bg-amber-500 px-3 py-1.5 text-xs font-bold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                        title={
                          inventoryFull
                            ? "Inventory full"
                            : tooExpensive
                              ? "Not enough gold"
                              : undefined
                        }
                      >
                        Buy
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded border border-gray-800 bg-gray-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500">Sell Inventory</h3>
              <p className="text-xs text-gray-600">{bagSlotsUsed}/{bagCapacity} bag slots used</p>
            </div>
            <span className="text-xs text-gray-500">Equipped items stay protected</span>
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
      </div>
    </div>
  )
}
