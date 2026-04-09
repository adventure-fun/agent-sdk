"use client"

import { useEffect, useMemo, useState } from "react"
import type { LegendPage } from "@adventure-fun/schemas"

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

const CLASS_TONES: Record<LegendPage["character"]["class"], string> = {
  knight: "border-blue-500/30 bg-blue-500/10 text-blue-200",
  mage: "border-purple-500/30 bg-purple-500/10 text-purple-200",
  rogue: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  archer: "border-amber-500/30 bg-amber-500/10 text-amber-200",
}

const CLASS_SYMBOLS: Record<LegendPage["character"]["class"], string> = {
  knight: "🛡",
  mage: "✦",
  rogue: "🗡",
  archer: "🏹",
}

function formatDate(value: string) {
  return new Date(value).toLocaleString()
}

function socialLink(label: string, href: string | null | undefined) {
  if (!href) return null
  return (
    <a
      key={label}
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
    >
      {label}
    </a>
  )
}

export function LegendPageClient({ characterId }: { characterId: string }) {
  const [legend, setLegend] = useState<LegendPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const skillNodes = useMemo(() => Object.keys(legend?.character.skill_tree ?? {}), [legend])

  useEffect(() => {
    let cancelled = false

    async function loadLegend() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetch(`${API_URL}/legends/${characterId}`)
        const body = await response.json()
        if (!response.ok) {
          throw new Error(body.error ?? "Failed to load legend")
        }
        if (!cancelled) {
          setLegend(body as LegendPage)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load legend")
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadLegend()
    return () => {
      cancelled = true
    }
  }, [characterId])

  if (isLoading) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-gray-950 via-black to-gray-950 p-6 sm:p-8">
        <div className="mx-auto max-w-5xl space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="animate-pulse rounded-2xl border border-gray-800 bg-gray-900/60 p-6">
              <div className="h-6 w-48 rounded bg-gray-800" />
              <div className="mt-4 h-4 w-full rounded bg-gray-800" />
              <div className="mt-2 h-4 w-2/3 rounded bg-gray-800" />
            </div>
          ))}
        </div>
      </main>
    )
  }

  if (error || !legend) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-gray-950 via-black to-gray-950 p-6 sm:p-8">
        <div className="mx-auto max-w-2xl rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center">
          <h1 className="text-2xl font-bold text-red-300">Legend Unavailable</h1>
          <p className="mt-3 text-sm text-gray-400">{error ?? "This fallen hero could not be found."}</p>
        </div>
      </main>
    )
  }

  const socialLinks = [
    socialLink("X", legend.owner.x_handle ? `https://x.com/${legend.owner.x_handle.replace(/^@/, "")}` : null),
    socialLink("GitHub", legend.owner.github_handle ? `https://github.com/${legend.owner.github_handle}` : null),
  ].filter(Boolean)

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-950 via-black to-gray-950 p-6 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-6 shadow-[0_0_80px_rgba(245,158,11,0.08)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className={`inline-flex items-center gap-3 rounded-full border px-4 py-2 text-sm font-semibold ${CLASS_TONES[legend.character.class]}`}>
                <span aria-hidden="true">{CLASS_SYMBOLS[legend.character.class]}</span>
                <span className="capitalize">{legend.character.class}</span>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-amber-300 sm:text-4xl">{legend.character.name}</h1>
                <p className="mt-2 text-sm text-gray-400">
                  Fallen on floor {legend.history.death_floor} in {legend.history.death_room}.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-4 text-sm">
              <div className="text-gray-500">Cause of death</div>
              <div className="mt-1 font-semibold text-red-300">{legend.history.cause_of_death}</div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Final Stats</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {Object.entries(legend.character.stats).map(([stat, value]) => (
                  <div key={stat} className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
                    <div className="text-xs uppercase text-gray-500">{stat}</div>
                    <div className="mt-1 text-xl font-semibold text-gray-100">{value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Equipment at Death</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {Object.entries(legend.character.equipment_at_death).map(([slot, item]) => (
                  <div key={slot} className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
                    <div className="text-xs uppercase text-gray-500">{slot}</div>
                    {item ? (
                      <div className="mt-2 space-y-1">
                        <div className="font-semibold text-gray-100">{item.name}</div>
                        <div className="text-xs text-gray-500">{item.template_id}</div>
                        <div className="text-xs text-gray-400">Quantity: {item.quantity}</div>
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-gray-500">Empty slot</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Run History</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <HistoryCard label="Realms Cleared" value={legend.history.realms_completed} />
                <HistoryCard label="Deepest Floor" value={legend.history.deepest_floor} />
                <HistoryCard label="Enemies Defeated" value={legend.history.enemies_killed} />
                <HistoryCard label="Turns Survived" value={legend.history.turns_survived} />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Memorial</h2>
              <div className="mt-4 space-y-3 text-sm text-gray-300">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-gray-500">Level</span>
                  <span>{legend.character.level}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-gray-500">XP</span>
                  <span>{legend.character.xp.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-gray-500">Gold at death</span>
                  <span>{legend.character.gold_at_death}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-gray-500">Created</span>
                  <span>{formatDate(legend.history.created_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-gray-500">Died</span>
                  <span>{formatDate(legend.history.died_at)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Owner</h2>
              <div className="mt-4 space-y-2 text-sm text-gray-300">
                <div className="font-semibold text-gray-100">{legend.owner.handle || "Anonymous adventurer"}</div>
                <div className="capitalize text-gray-400">{legend.owner.player_type}</div>
                <div className="break-all text-xs text-gray-500">{legend.owner.wallet || "Wallet unavailable"}</div>
              </div>
              {socialLinks.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">{socialLinks}</div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Skill Tree Snapshot</h2>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(window.location.href).catch(() => {})}
                  className="rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-300 transition-colors hover:border-gray-500"
                >
                  Copy Link
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {skillNodes.length > 0 ? (
                  skillNodes.map((nodeId) => (
                    <span
                      key={nodeId}
                      className="rounded-full border border-purple-700/40 bg-purple-950/30 px-3 py-1 text-xs text-purple-200"
                    >
                      {nodeId}
                    </span>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">No unlocked skill nodes were recorded.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function HistoryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-gray-100">{value}</div>
    </div>
  )
}
