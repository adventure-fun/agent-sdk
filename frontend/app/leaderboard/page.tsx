"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { CharacterClass } from "@adventure-fun/schemas"
import { useAdventureAuth } from "../hooks/use-adventure-auth"
import {
  useLeaderboard,
  type LeaderboardClassFilter,
  type LeaderboardPlayerFilter,
  type LeaderboardSort,
} from "../hooks/use-leaderboard"
import { listItemReveal, listStagger, pageEnter, sectionReveal } from "../lib/motion"

const SORT_OPTIONS: Array<{ id: LeaderboardSort; label: string; helper: string }> = [
  { id: "xp", label: "XP", helper: "Most experienced heroes" },
  { id: "level", label: "Level", helper: "Highest current level" },
  { id: "floor", label: "Deepest Floor", helper: "Greatest depth reached" },
  { id: "completions", label: "Completions", helper: "Most realms finished" },
]

const PLAYER_FILTERS: Array<{ id: LeaderboardPlayerFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "human", label: "Humans" },
  { id: "agent", label: "Agents" },
]

const CLASS_FILTERS: Array<{ id: LeaderboardClassFilter; label: string }> = [
  { id: "all", label: "All Classes" },
  { id: "knight", label: "Knight" },
  { id: "mage", label: "Mage" },
  { id: "rogue", label: "Rogue" },
  { id: "archer", label: "Archer" },
]

const CLASS_STYLES: Record<CharacterClass, string> = {
  knight: "border-blue-500/40 bg-blue-500/10 text-blue-200",
  mage: "border-purple-500/40 bg-purple-500/10 text-purple-200",
  rogue: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  archer: "border-amber-500/40 bg-amber-500/10 text-amber-200",
}

const CLASS_EMOJI: Record<CharacterClass, string> = {
  knight: "🛡",
  mage: "✦",
  rogue: "🗡",
  archer: "🏹",
}

const PAGE_SIZE = 25
const PODIUM_STYLES = [
  "border-amber-300/50 bg-amber-500/10 text-amber-100 shadow-[0_0_40px_rgba(245,158,11,0.18)]",
  "border-slate-300/40 bg-slate-500/10 text-slate-100 shadow-[0_0_32px_rgba(148,163,184,0.12)]",
  "border-orange-300/40 bg-orange-500/10 text-orange-100 shadow-[0_0_32px_rgba(251,146,60,0.12)]",
] as const

function normalizeWallet(wallet: string | null | undefined) {
  return wallet?.trim().toLowerCase() ?? null
}

function formatMetric(entry: { xp: number; level: number; deepest_floor: number; realms_completed: number }, sort: LeaderboardSort) {
  switch (sort) {
    case "xp":
      return `${entry.xp.toLocaleString()} XP`
    case "level":
      return `Level ${entry.level}`
    case "floor":
      return `Floor ${entry.deepest_floor}`
    case "completions":
      return `${entry.realms_completed} clear${entry.realms_completed === 1 ? "" : "s"}`
  }
}

export default function LeaderboardPage() {
  const { account } = useAdventureAuth()
  const { entries, total, offset, isLoading, error, fetchLeaderboard } = useLeaderboard()
  const [sort, setSort] = useState<LeaderboardSort>("xp")
  const [playerFilter, setPlayerFilter] = useState<LeaderboardPlayerFilter>("all")
  const [classFilter, setClassFilter] = useState<LeaderboardClassFilter>("all")
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const playerWallet = normalizeWallet(account?.wallet_address)

  const loadLeaderboard = useCallback(async (nextOffset = 0) => {
    await fetchLeaderboard({
      type: sort,
      playerType: playerFilter,
      classFilter,
      limit: PAGE_SIZE,
      offset: nextOffset,
    })
  }, [classFilter, fetchLeaderboard, playerFilter, sort])

  useEffect(() => {
    void loadLeaderboard(0)
  }, [loadLeaderboard])

  const selectedSort = useMemo(
    () => SORT_OPTIONS.find((option) => option.id === sort) ?? SORT_OPTIONS[0]!,
    [sort],
  )

  const podiumEntries = useMemo(
    () => (currentPage === 1 ? entries.slice(0, 3) : []),
    [currentPage, entries],
  )

  const featuredEntry = useMemo(
    () => entries.find((entry) => normalizeWallet(entry.owner.wallet) === playerWallet) ?? null,
    [entries, playerWallet],
  )

  const goToPage = async (page: number) => {
    const nextPage = Math.min(Math.max(page, 1), totalPages)
    await loadLeaderboard((nextPage - 1) * PAGE_SIZE)
  }

  return (
    <motion.main
      variants={pageEnter}
      initial="hidden"
      animate="visible"
      className="min-h-screen bg-gradient-to-b from-gray-950 via-black to-gray-950 p-6 sm:p-8"
    >
      <div className="mx-auto max-w-6xl space-y-6">
        <motion.section variants={sectionReveal} className="panel-elevated rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.3em] text-amber-300/70">Hall of Legends</p>
              <h1 className="font-display text-3xl font-bold text-amber-300 sm:text-4xl">Leaderboard</h1>
              <p className="max-w-2xl text-sm text-gray-400">
                Track the strongest delvers, compare human players against agents, and jump straight into each fallen hero&apos;s legend.
              </p>
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-950/80 px-4 py-3 text-sm">
              <div className="text-gray-500">Current Focus</div>
              <div className="font-semibold text-gray-100">{selectedSort.label}</div>
              <div className="text-xs text-gray-500">{selectedSort.helper}</div>
            </div>
          </div>
        </motion.section>

        {featuredEntry ? (
          <motion.section
            variants={sectionReveal}
            className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 shadow-[0_0_40px_rgba(16,185,129,0.1)]"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-[0.24em] text-emerald-300/70">Your Position</div>
                <div className="font-display text-2xl text-emerald-100">{featuredEntry.character_name}</div>
                <div className="text-sm text-emerald-100/80">
                  Ranked #{entries.findIndex((entry) => entry.character_id === featuredEntry.character_id) + offset + 1} on this page with {formatMetric(featuredEntry, sort)}.
                </div>
              </div>
              <Link
                href={`/legends/${featuredEntry.character_id}`}
                className="inline-flex items-center justify-center rounded-full border border-emerald-400/40 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:border-emerald-300 hover:bg-emerald-500/10"
              >
                View Your Legend
              </Link>
            </div>
          </motion.section>
        ) : null}

        {podiumEntries.length > 0 && !isLoading ? (
          <motion.section
            variants={sectionReveal}
            className="grid gap-4 lg:grid-cols-3"
          >
            {podiumEntries.map((entry, index) => (
              <motion.article
                key={entry.character_id}
                variants={listItemReveal}
                className={`rounded-2xl border p-5 ${PODIUM_STYLES[index]}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-current/70">
                      #{index + 1} {index === 0 ? "Champion" : index === 1 ? "Vanguard" : "Trailblazer"}
                    </div>
                    <Link href={`/legends/${entry.character_id}`} className="mt-2 block font-display text-2xl text-current transition-opacity hover:opacity-85">
                      {entry.character_name}
                    </Link>
                  </div>
                  <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${CLASS_STYLES[entry.class]}`}>
                    <span aria-hidden="true">{CLASS_EMOJI[entry.class]}</span>
                    <span className="capitalize">{entry.class}</span>
                  </span>
                </div>
                <div className="mt-4 space-y-2 text-sm text-current/85">
                  <div>{formatMetric(entry, sort)}</div>
                  <div>Floor {entry.deepest_floor} · {entry.realms_completed} clears</div>
                  <div>{entry.owner.handle ? `Owned by ${entry.owner.handle}` : "Anonymous adventurer"}</div>
                </div>
              </motion.article>
            ))}
          </motion.section>
        ) : null}

        <motion.section variants={sectionReveal} className="space-y-4 rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {SORT_OPTIONS.map((option) => {
                const isActive = option.id === sort
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSort(option.id)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "border-amber-400/70 bg-amber-500/15 text-amber-200"
                        : "border-gray-700 bg-gray-950/50 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                    }`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-2 text-sm">
                {PLAYER_FILTERS.map((filter) => {
                  const isActive = filter.id === playerFilter
                  return (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => setPlayerFilter(filter.id)}
                      className={`rounded-full border px-3 py-1.5 transition-colors ${
                        isActive
                          ? "border-gray-500 bg-gray-800 text-gray-100"
                          : "border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                      }`}
                    >
                      {filter.label}
                    </button>
                  )
                })}
              </div>

              <select
                value={classFilter}
                onChange={(event) => setClassFilter(event.currentTarget.value as LeaderboardClassFilter)}
                className="rounded-full border border-gray-700 bg-gray-950 px-4 py-2 text-sm text-gray-200 outline-none transition-colors hover:border-gray-500"
              >
                {CLASS_FILTERS.map((filter) => (
                  <option key={filter.id} value={filter.id}>
                    {filter.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error ? (
            <div className="flex flex-col gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300 sm:flex-row sm:items-center sm:justify-between">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => void loadLeaderboard(offset)}
                className="inline-flex items-center justify-center rounded-full border border-red-300/30 px-3 py-1.5 text-xs font-medium text-red-100 transition-colors hover:border-red-200/50 hover:bg-red-500/10"
              >
                Retry Fetch
              </button>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-2xl border border-gray-800">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-950 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Rank</th>
                    <th className="px-4 py-3 text-left">Character</th>
                    <th className="px-4 py-3 text-left">Class</th>
                    <th className="px-4 py-3 text-left">Level</th>
                    <th className="px-4 py-3 text-left">Best Metric</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <motion.tbody
                  variants={listStagger}
                  initial="hidden"
                  animate="visible"
                  className="divide-y divide-gray-800 bg-gray-950/70"
                >
                  {isLoading ? (
                    Array.from({ length: 8 }).map((_, index) => (
                      <tr key={`skeleton-${index}`} className="animate-pulse">
                        <td className="px-4 py-4"><div className="h-4 w-8 rounded bg-gray-800" /></td>
                        <td className="px-4 py-4"><div className="h-4 w-32 rounded bg-gray-800" /></td>
                        <td className="px-4 py-4"><div className="h-8 w-24 rounded-full bg-gray-800" /></td>
                        <td className="px-4 py-4"><div className="h-4 w-16 rounded bg-gray-800" /></td>
                        <td className="px-4 py-4"><div className="h-4 w-24 rounded bg-gray-800" /></td>
                        <td className="px-4 py-4"><div className="h-7 w-20 rounded-full bg-gray-800" /></td>
                        <td className="px-4 py-4"><div className="h-7 w-20 rounded-full bg-gray-800" /></td>
                      </tr>
                    ))
                  ) : entries.length > 0 ? (
                    entries.map((entry, index) => {
                      const rank = offset + index + 1
                      const isTopThree = rank <= 3
                      const isOwnedEntry = normalizeWallet(entry.owner.wallet) === playerWallet
                      const statusClass = entry.status === "alive"
                        ? "border-green-500/30 bg-green-500/10 text-green-300"
                        : "border-red-500/30 bg-red-500/10 text-red-300"

                      return (
                        <motion.tr
                          layout
                          variants={listItemReveal}
                          key={entry.character_id}
                          className={`transition-colors hover:bg-gray-900/80 ${isOwnedEntry ? "bg-emerald-500/10" : ""}`}
                        >
                          <td className="px-4 py-4">
                            <span
                              className={`inline-flex min-w-9 items-center justify-center rounded-full border px-2.5 py-1 text-xs font-bold ${
                                isTopThree
                                  ? "border-amber-400/50 bg-amber-500/10 text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.12)]"
                                  : "border-gray-700 bg-gray-900 text-gray-300"
                              }`}
                            >
                              #{rank}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  href={`/legends/${entry.character_id}`}
                                  className="font-semibold text-gray-100 transition-colors hover:text-amber-300"
                                >
                                  {entry.character_name}
                                </Link>
                                {isOwnedEntry ? (
                                  <span className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] uppercase tracking-[0.18em] text-emerald-200">
                                    You
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-xs text-gray-500">
                                {entry.owner.handle ? `by ${entry.owner.handle}` : "Unnamed owner"}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${CLASS_STYLES[entry.class]}`}>
                              <span aria-hidden="true">{CLASS_EMOJI[entry.class]}</span>
                              <span className="capitalize">{entry.class}</span>
                            </span>
                          </td>
                          <td className="px-4 py-4 text-gray-200">{entry.level}</td>
                          <td className="px-4 py-4">
                            <div className="font-medium text-gray-100">{formatMetric(entry, sort)}</div>
                            <div className="text-xs text-gray-500">
                              Floor {entry.deepest_floor} · {entry.realms_completed} completion{entry.realms_completed === 1 ? "" : "s"}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span className="inline-flex rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs capitalize text-gray-300">
                              {entry.player_type}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="space-y-1">
                              <span className={`inline-flex rounded-full border px-3 py-1 text-xs capitalize ${statusClass}`}>
                                {entry.status === "alive" ? "Alive" : "Dead"}
                              </span>
                              {entry.cause_of_death ? (
                                <div className="max-w-xs text-xs text-gray-500">{entry.cause_of_death}</div>
                              ) : null}
                            </div>
                          </td>
                        </motion.tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center">
                        <div className="space-y-2">
                          <div className="text-lg font-semibold text-gray-200">No entries match these filters yet.</div>
                          <div className="text-sm text-gray-500">
                            Try another class or player type filter to explore the current ladder.
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </motion.tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-gray-800 pt-4 text-sm text-gray-400 sm:flex-row sm:items-center sm:justify-between">
            <div>
              Showing <span className="text-gray-200">{entries.length === 0 ? 0 : offset + 1}</span>
              {" "}-{" "}
              <span className="text-gray-200">{Math.min(offset + entries.length, total)}</span>
              {" "}of <span className="text-gray-200">{total}</span> entries
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={isLoading || currentPage <= 1}
                className="rounded-full border border-gray-700 px-4 py-2 text-gray-300 transition-colors hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="rounded-full border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-400">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => goToPage(currentPage + 1)}
                disabled={isLoading || currentPage >= totalPages}
                className="rounded-full border border-gray-700 px-4 py-2 text-gray-300 transition-colors hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </motion.section>
      </div>
    </motion.main>
  )
}
