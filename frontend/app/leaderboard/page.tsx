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
import { useActiveSpectateSessions } from "../hooks/use-active-spectate-sessions"
import { isLiveOnSpectate } from "../lib/leaderboard-links"
import { listItemReveal, pageEnter, sectionReveal } from "../lib/motion"
import { characterHref, ownerLabel, ownerProfileHref } from "../lib/character-display"

// ── Filter / sort options ────────────────────────────────────────────────────

const SORT_OPTIONS: Array<{ id: LeaderboardSort; label: string; helper: string }> = [
  { id: "xp",          label: "XP",            helper: "Most experienced delvers" },
  { id: "level",       label: "LEVEL",         helper: "Highest current level" },
  { id: "floor",       label: "DEEPEST FLOOR", helper: "Greatest depth reached" },
  { id: "completions", label: "COMPLETIONS",   helper: "Most realms cleared" },
]

const PLAYER_FILTERS: Array<{ id: LeaderboardPlayerFilter; label: string }> = [
  { id: "all",   label: "ALL" },
  { id: "human", label: "HUMANS" },
  { id: "agent", label: "AGENTS" },
]

const CLASS_FILTERS: Array<{ id: LeaderboardClassFilter; label: string }> = [
  { id: "all",    label: "ALL CLASSES" },
  { id: "knight", label: "KNIGHT" },
  { id: "mage",   label: "MAGE" },
  { id: "rogue",  label: "ROGUE" },
  { id: "archer", label: "ARCHER" },
]

// ── Class theming ────────────────────────────────────────────────────────────
// Each class has a Material Symbol glyph and an OBSIDIAN accent color. The
// trio (primary/secondary/tertiary) keeps the four classes visually distinct
// without introducing a fourth named color.
const CLASS_ICON: Record<CharacterClass, string> = {
  knight: "shield",
  mage:   "auto_awesome",
  rogue:  "bolt",
  archer: "my_location",
}

const CLASS_COLOR: Record<CharacterClass, string> = {
  knight: "text-ob-tertiary",
  mage:   "text-ob-primary",
  rogue:  "text-ob-secondary",
  archer: "text-ob-tertiary",
}

const PAGE_SIZE = 25

// ── Podium accent palette ────────────────────────────────────────────────────
// The center card is the champion (rank #1) and gets the most aggressive
// styling: full primary border + glow. #2 and #3 are flanking cards on the
// neutral surface-container-high background with a thin accent border.
const PODIUM_VARIANTS = [
  {
    label: "VANGUARD",
    accent: "tertiary",
    iconBg: "border-ob-tertiary/30",
    iconColor: "text-ob-tertiary",
    badgeBg: "bg-ob-tertiary/10 text-ob-tertiary border-ob-tertiary/20",
  },
  {
    label: "CHAMPION",
    accent: "primary",
    iconBg: "border-ob-primary/40 shadow-[0_0_30px_rgba(255,209,108,0.2)]",
    iconColor: "text-ob-primary",
    badgeBg: "bg-ob-primary text-ob-on-primary",
  },
  {
    label: "TRAILBLAZER",
    accent: "secondary",
    iconBg: "border-ob-secondary/30",
    iconColor: "text-ob-secondary",
    badgeBg: "bg-ob-secondary/10 text-ob-secondary border-ob-secondary/20",
  },
] as const

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeWallet(wallet: string | null | undefined) {
  return wallet?.trim().toLowerCase() ?? null
}

function formatMetric(
  entry: { xp: number; level: number; deepest_floor: number; realms_completed: number },
  sort: LeaderboardSort,
): string {
  switch (sort) {
    case "xp":          return `${entry.xp.toLocaleString()} XP`
    case "level":       return `LVL ${entry.level}`
    case "floor":       return `Floor ${entry.deepest_floor}`
    case "completions": return `${entry.realms_completed} clear${entry.realms_completed === 1 ? "" : "s"}`
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  const { account } = useAdventureAuth()
  const { entries, total, offset, isLoading, error, fetchLeaderboard } = useLeaderboard()
  const { liveCharacterIds } = useActiveSpectateSessions({ refreshMs: 12_000 })
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

  // Re-order the top 3 so the champion sits in the middle (visual podium).
  // We display the entries in the order [#2, #1, #3] which means the champion
  // gets the prominent center slot in the 3-column grid. Guarded by the
  // length check so the non-null assertions below are safe.
  const podiumEntries = useMemo(() => {
    if (currentPage !== 1 || entries.length < 3) return [] as typeof entries
    return [entries[1]!, entries[0]!, entries[2]!]
  }, [currentPage, entries])

  // The user's own entry on the current page, if present. Used to render the
  // "Your Position" hero card above the podium.
  const featuredEntry = useMemo(
    () => entries.find((entry) => normalizeWallet(entry.owner.wallet) === playerWallet) ?? null,
    [entries, playerWallet],
  )

  const featuredRank = useMemo(() => {
    if (!featuredEntry) return null
    return offset + entries.findIndex((e) => e.character_id === featuredEntry.character_id) + 1
  }, [entries, featuredEntry, offset])

  const goToPage = async (page: number) => {
    const nextPage = Math.min(Math.max(page, 1), totalPages)
    await loadLeaderboard((nextPage - 1) * PAGE_SIZE)
  }

  const selectedSort = SORT_OPTIONS.find((o) => o.id === sort) ?? SORT_OPTIONS[0]!

  return (
    <motion.main
      variants={pageEnter}
      initial="hidden"
      animate="visible"
      className="min-h-screen bg-ob-bg p-12 pt-16 ob-body relative overflow-hidden"
    >
      {/* Ambient amber glow behind the hero */}
      <div className="pointer-events-none absolute -top-32 -left-12 w-[500px] h-[500px] bg-ob-primary/5 rounded-full blur-[150px] -z-0" />
      <div className="pointer-events-none absolute top-1/2 right-0 w-[600px] h-[600px] bg-ob-tertiary/5 rounded-full blur-[200px] -z-0 opacity-30" />

      <div className="relative z-10 mx-auto max-w-6xl">
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <motion.section variants={sectionReveal} className="mb-16">
          <h1 className="ob-headline text-5xl md:text-6xl text-ob-primary mb-4 tracking-tight ob-amber-glow">
            LEADERBOARD
          </h1>
          <div className="flex items-center gap-4">
            <span className="h-px w-24 bg-gradient-to-r from-ob-primary to-transparent" />
            <p className="ob-label text-ob-on-surface-variant text-sm tracking-widest uppercase">
              Tracking the most formidable delvers across the obsidian planes — {selectedSort.helper.toLowerCase()}.
            </p>
          </div>
        </motion.section>

        {/* ── PERSONAL RANK + TOP 3 PODIUM ────────────────────────────────── */}
        {(featuredEntry || podiumEntries.length > 0) && !isLoading ? (
          <motion.section
            variants={sectionReveal}
            className="grid grid-cols-12 gap-6 md:gap-8 mb-16"
          >
            {/* Personal rank card — left side, 4 cols on lg */}
            {featuredEntry ? (
              <article className="col-span-12 lg:col-span-4 bg-ob-surface-container-low p-6 lg:p-8 rounded-xl relative overflow-hidden flex flex-col justify-between ob-relic-glow border border-ob-primary/10 min-h-[280px]">
                <div>
                  <h3 className="ob-label tracking-widest uppercase text-ob-on-surface-variant text-xs mb-6">
                    YOUR POSITION
                  </h3>
                  <div className="flex items-baseline gap-3 mb-2">
                    <span className="ob-headline text-5xl text-ob-on-surface">
                      #{featuredRank}
                    </span>
                  </div>
                  <Link
                    href={characterHref(featuredEntry.character_id)}
                    className="ob-headline not-italic text-ob-primary text-xl uppercase tracking-wider hover:opacity-90 transition-opacity"
                  >
                    {featuredEntry.character_name}
                  </Link>
                </div>

                <div className="mt-8 flex justify-between items-end">
                  <div className="space-y-1">
                    <div className="ob-label text-[10px] text-ob-on-surface-variant uppercase tracking-widest">
                      DEEPEST FLOOR
                    </div>
                    <div className="text-2xl ob-label text-ob-tertiary font-medium">
                      {featuredEntry.deepest_floor}
                    </div>
                  </div>
                  <div className="text-right space-y-1">
                    <div className="ob-label text-[10px] text-ob-on-surface-variant uppercase tracking-widest">
                      COMPLETIONS
                    </div>
                    <div className="text-2xl ob-label text-ob-secondary font-medium">
                      {featuredEntry.realms_completed}
                    </div>
                  </div>
                </div>

                {isLiveOnSpectate(featuredEntry, liveCharacterIds) ? (
                  <Link
                    href={`/spectate/${featuredEntry.character_id}`}
                    className="absolute top-4 right-4 ob-label text-[10px] text-ob-secondary tracking-widest border border-ob-secondary/40 px-2 py-1 rounded hover:bg-ob-secondary/10 transition-colors"
                  >
                    ● LIVE
                  </Link>
                ) : null}

                <div className="absolute inset-0 ob-scanline pointer-events-none opacity-20" />
              </article>
            ) : (
              <div className="col-span-12 lg:col-span-4 bg-ob-surface-container-low p-8 rounded-xl border border-ob-outline-variant/10 flex flex-col items-center justify-center text-center min-h-[280px]">
                <span className="material-symbols-outlined text-4xl text-ob-on-surface-variant/40 mb-4">
                  person_search
                </span>
                <div className="ob-label text-[10px] text-ob-on-surface-variant uppercase tracking-widest mb-2">
                  NO ENTRY ON THIS PAGE
                </div>
                <div className="text-xs text-ob-on-surface-variant max-w-[200px]">
                  Roll a character and start a run to claim a spot on the ladder.
                </div>
              </div>
            )}

            {/* Top 3 champions — right side, 8 cols on lg */}
            <div className="col-span-12 lg:col-span-8 grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
              {podiumEntries.length === 3 ? (
                podiumEntries.map((entry, displayIndex) => {
                  // displayIndex is the order in [vanguard, champion, trailblazer]
                  // actualRank is the real rank from the leaderboard
                  const actualRank = displayIndex === 1 ? 1 : displayIndex === 0 ? 2 : 3
                  const variant = PODIUM_VARIANTS[displayIndex]!
                  const isChampion = displayIndex === 1
                  // Every podium character links to its canonical character page.
                  const NameTag = Link
                  const nameProps = { href: characterHref(entry.character_id) }

                  return (
                    <motion.article
                      key={entry.character_id}
                      variants={listItemReveal}
                      className={`relative rounded-xl border flex flex-col items-center text-center transition-all duration-500 group ${
                        isChampion
                          ? "bg-ob-primary/5 border-2 border-ob-primary/20 hover:bg-ob-primary/10 p-6 md:p-8"
                          : "bg-ob-surface-container-high border-ob-outline-variant/10 hover:bg-ob-surface-container-highest p-6"
                      }`}
                    >
                      {isChampion ? (
                        <div className="absolute top-0 right-0 p-4">
                          <span
                            className="material-symbols-outlined text-ob-primary animate-pulse"
                            style={{ fontVariationSettings: "'FILL' 1" }}
                          >
                            workspace_premium
                          </span>
                        </div>
                      ) : null}

                      <div
                        className={`rounded-full bg-ob-surface-container-lowest mb-4 flex items-center justify-center border-2 ${variant.iconBg} ${
                          isChampion ? "w-24 h-24" : "w-16 h-16"
                        }`}
                      >
                        <span
                          className={`material-symbols-outlined ${variant.iconColor} ${isChampion ? "text-5xl" : "text-3xl"}`}
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          {CLASS_ICON[entry.class]}
                        </span>
                      </div>

                      <div className={`ob-label tracking-widest uppercase mb-1 ${variant.iconColor} ${isChampion ? "text-sm" : "text-xs"}`}>
                        {variant.label}
                      </div>

                      <NameTag
                        {...(nameProps as { href: string })}
                        className={`ob-headline text-ob-on-surface mb-4 hover:opacity-90 transition-opacity ${isChampion ? "text-2xl" : "text-lg"}`}
                      >
                        {entry.character_name.toUpperCase()}
                      </NameTag>

                      <div
                        className={`px-4 py-1 rounded-full ob-label tracking-widest font-bold border ${variant.badgeBg} ${
                          isChampion ? "text-xs px-6 py-2" : "text-[10px]"
                        }`}
                      >
                        RANK #{actualRank}
                      </div>

                      <div className="mt-3 ob-label text-[10px] text-ob-on-surface-variant uppercase tracking-tighter">
                        {formatMetric(entry, sort)}
                      </div>

                      {isLiveOnSpectate(entry, liveCharacterIds) ? (
                        <Link
                          href={`/spectate/${entry.character_id}`}
                          className="mt-3 ob-label text-[10px] text-ob-secondary tracking-widest hover:underline"
                        >
                          ● SPECTATE LIVE
                        </Link>
                      ) : null}
                    </motion.article>
                  )
                })
              ) : (
                <div className="col-span-3 bg-ob-surface-container-high rounded-xl p-12 text-center border border-ob-outline-variant/10">
                  <span className="material-symbols-outlined text-4xl text-ob-on-surface-variant/40 mb-2 block">
                    hourglass_empty
                  </span>
                  <div className="ob-label text-[10px] text-ob-on-surface-variant uppercase tracking-widest">
                    Awaiting top three contenders for {selectedSort.label}
                  </div>
                </div>
              )}
            </div>
          </motion.section>
        ) : null}

        {/* ── DETAILED TABLE ──────────────────────────────────────────────── */}
        <motion.section
          variants={sectionReveal}
          className="bg-ob-surface-container-low rounded-xl border border-ob-outline-variant/10 overflow-hidden"
        >
          {/* Filter bar */}
          <div className="p-6 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-ob-outline-variant/10">
            {/* Sort tabs */}
            <div className="flex flex-wrap gap-1 p-1 bg-ob-surface-container-lowest rounded-xl">
              {SORT_OPTIONS.map((option) => {
                const isActive = option.id === sort
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSort(option.id)}
                    className={`px-4 md:px-6 py-2 rounded-lg ob-label text-xs tracking-widest uppercase transition-colors ${
                      isActive
                        ? "bg-ob-surface-container-high text-ob-primary shadow-sm"
                        : "text-ob-on-surface-variant hover:text-ob-on-surface"
                    }`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>

            {/* Player type + class filter */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1 p-1 bg-ob-surface-container-lowest rounded-xl">
                {PLAYER_FILTERS.map((filter) => {
                  const isActive = filter.id === playerFilter
                  return (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => setPlayerFilter(filter.id)}
                      className={`px-3 py-1.5 rounded-lg ob-label text-[10px] tracking-widest uppercase transition-colors ${
                        isActive
                          ? "bg-ob-surface-container-high text-ob-primary"
                          : "text-ob-on-surface-variant hover:text-ob-on-surface"
                      }`}
                    >
                      {filter.label}
                    </button>
                  )
                })}
              </div>

              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-ob-on-surface-variant text-sm pointer-events-none">
                  filter_list
                </span>
                <select
                  value={classFilter}
                  onChange={(e) => setClassFilter(e.currentTarget.value as LeaderboardClassFilter)}
                  className="bg-ob-surface-container-lowest border-none ob-label text-[10px] tracking-widest uppercase text-ob-on-surface-variant pl-10 pr-8 py-2 rounded-lg focus:ring-1 focus:ring-ob-primary appearance-none cursor-pointer"
                >
                  {CLASS_FILTERS.map((filter) => (
                    <option key={filter.id} value={filter.id}>
                      {filter.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Error banner */}
          {error ? (
            <div className="border-b border-ob-error/20 bg-ob-error/10 px-6 py-4 flex items-center justify-between gap-4">
              <span className="text-sm text-ob-error">{error}</span>
              <button
                type="button"
                onClick={() => void loadLeaderboard(offset)}
                className="ob-label text-[10px] uppercase tracking-widest text-ob-error border border-ob-error/40 hover:bg-ob-error/10 px-3 py-1.5 rounded transition-colors"
              >
                Retry
              </button>
            </div>
          ) : null}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="ob-label text-[10px] text-ob-on-surface-variant tracking-widest uppercase bg-ob-surface-container-high/50">
                  <th className="px-6 md:px-8 py-5 font-medium">RANK</th>
                  <th className="px-6 md:px-8 py-5 font-medium">CHARACTER</th>
                  <th className="px-6 md:px-8 py-5 font-medium">CLASS</th>
                  <th className="px-6 md:px-8 py-5 font-medium">LEVEL</th>
                  <th className="px-6 md:px-8 py-5 font-medium">{selectedSort.label === "XP" ? "TOTAL XP" : selectedSort.label}</th>
                  <th className="px-6 md:px-8 py-5 font-medium">TYPE</th>
                  <th className="px-6 md:px-8 py-5 font-medium">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ob-outline-variant/5">
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, index) => (
                    <tr key={`skeleton-${index}`} className="animate-pulse">
                      <td className="px-8 py-5"><div className="h-4 w-8 rounded bg-ob-surface-container-high" /></td>
                      <td className="px-8 py-5"><div className="h-4 w-32 rounded bg-ob-surface-container-high" /></td>
                      <td className="px-8 py-5"><div className="h-4 w-20 rounded bg-ob-surface-container-high" /></td>
                      <td className="px-8 py-5"><div className="h-4 w-16 rounded bg-ob-surface-container-high" /></td>
                      <td className="px-8 py-5"><div className="h-4 w-24 rounded bg-ob-surface-container-high" /></td>
                      <td className="px-8 py-5"><div className="h-4 w-16 rounded bg-ob-surface-container-high" /></td>
                      <td className="px-8 py-5"><div className="h-4 w-16 rounded bg-ob-surface-container-high" /></td>
                    </tr>
                  ))
                ) : entries.length > 0 ? (
                  entries.map((entry, index) => {
                    const rank = offset + index + 1
                    const isOwnedEntry = normalizeWallet(entry.owner.wallet) === playerWallet
                    const isDead = entry.status !== "alive"
                    const isLive = isLiveOnSpectate(entry, liveCharacterIds)
                    const ownerHref = ownerProfileHref(entry.owner)
                    const ownerText = ownerLabel(entry.owner)

                    return (
                      <motion.tr
                        layout
                        variants={listItemReveal}
                        key={entry.character_id}
                        className={`transition-colors cursor-pointer group ${
                          isOwnedEntry ? "bg-ob-primary/5 hover:bg-ob-primary/10"
                          : "hover:bg-ob-primary/5"
                        } ${isDead ? "opacity-60 hover:opacity-100" : ""}`}
                      >
                        <td className="px-6 md:px-8 py-5">
                          <span className={`ob-label font-bold ${rank <= 3 ? "text-ob-primary" : "text-ob-on-surface-variant"}`}>
                            #{rank}
                          </span>
                        </td>
                        <td className="px-6 md:px-8 py-5">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${
                              isOwnedEntry ? "bg-ob-primary/20 border-ob-primary/40" : "bg-ob-surface-container-highest border-ob-outline-variant/10"
                            }`}>
                              <span className={`material-symbols-outlined text-lg ${CLASS_COLOR[entry.class]}`}>
                                {CLASS_ICON[entry.class]}
                              </span>
                            </div>
                            <div className="min-w-0">
                              {/* Character name always links to /character/[id].
                                  /legends/[id] is still reachable from the
                                  character page footer ("View Legend" button)
                                  for dead characters. */}
                              <Link
                                href={characterHref(entry.character_id)}
                                className={`ob-headline not-italic font-bold uppercase block truncate hover:opacity-90 transition-opacity ${
                                  isOwnedEntry ? "text-ob-primary" : isDead ? "text-ob-on-surface-variant line-through" : "text-ob-on-surface"
                                }`}
                              >
                                {entry.character_name}
                              </Link>
                              <div className="flex items-center gap-2 mt-0.5">
                                {ownerText ? (
                                  ownerHref ? (
                                    <Link
                                      href={ownerHref}
                                      className="text-[10px] text-ob-on-surface-variant hover:text-ob-primary transition-colors truncate"
                                    >
                                      by {ownerText}
                                    </Link>
                                  ) : (
                                    <span className="text-[10px] text-ob-on-surface-variant truncate">
                                      by {ownerText}
                                    </span>
                                  )
                                ) : null}
                                {isOwnedEntry ? (
                                  <span className="ob-label text-[9px] uppercase tracking-widest text-ob-primary border border-ob-primary/30 bg-ob-primary/10 px-1.5 py-0.5 rounded">
                                    YOU
                                  </span>
                                ) : null}
                                {isLive ? (
                                  <Link
                                    href={`/spectate/${entry.character_id}`}
                                    className="ob-label text-[9px] uppercase tracking-widest text-ob-secondary hover:underline"
                                  >
                                    ● LIVE
                                  </Link>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 md:px-8 py-5">
                          <div className="flex items-center gap-2">
                            <span className={`material-symbols-outlined text-sm ${CLASS_COLOR[entry.class]}`}>
                              {CLASS_ICON[entry.class]}
                            </span>
                            <span className="ob-label text-xs uppercase tracking-tight">
                              {entry.class}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 md:px-8 py-5 ob-label text-sm">LVL {entry.level}</td>
                        <td className="px-6 md:px-8 py-5 ob-label text-sm text-ob-tertiary">
                          {formatMetric(entry, sort)}
                        </td>
                        <td className="px-6 md:px-8 py-5">
                          <span className={`ob-label text-[10px] px-2 py-0.5 border rounded uppercase ${
                            entry.player_type === "human"
                              ? "border-ob-primary/20 bg-ob-primary/5 text-ob-primary"
                              : "border-ob-outline-variant bg-ob-outline-variant/10 text-ob-on-surface-variant"
                          }`}>
                            {entry.player_type}
                          </span>
                        </td>
                        <td className="px-6 md:px-8 py-5">
                          {entry.status === "alive" ? (
                            <span className="flex items-center gap-2 text-ob-secondary ob-label text-[10px] uppercase tracking-widest">
                              <span className="w-1.5 h-1.5 rounded-full bg-ob-secondary shadow-[0_0_8px_#6bfe9c]" />
                              ALIVE
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <span className="flex items-center gap-2 text-ob-error ob-label text-[10px] uppercase tracking-widest">
                                <span className="w-1.5 h-1.5 rounded-full bg-ob-error" />
                                DEAD
                              </span>
                              {entry.cause_of_death ? (
                                <div className="text-[10px] text-ob-on-surface-variant max-w-xs truncate">
                                  {entry.cause_of_death}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </td>
                      </motion.tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-16 text-center">
                      <span className="material-symbols-outlined text-4xl text-ob-on-surface-variant/40 mb-3 block">
                        person_search
                      </span>
                      <div className="ob-headline not-italic text-ob-on-surface text-lg mb-1">
                        No entries match these filters
                      </div>
                      <div className="text-sm text-ob-on-surface-variant">
                        Try a different class, sort, or player type.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          <div className="p-6 md:p-8 border-t border-ob-outline-variant/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-ob-surface-container-high/30">
            <div className="ob-label text-[10px] text-ob-on-surface-variant uppercase tracking-widest">
              SHOWING {entries.length === 0 ? 0 : offset + 1}-{Math.min(offset + entries.length, total)} OF {total.toLocaleString()} DELVERS
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={isLoading || currentPage <= 1}
                className="p-2 rounded-lg border border-ob-outline-variant/20 text-ob-on-surface-variant hover:text-ob-primary hover:border-ob-primary/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-sm">chevron_left</span>
              </button>
              <span className="ob-label text-xs px-3 text-ob-on-surface">
                <span className="text-ob-primary font-bold">{currentPage}</span>
                <span className="text-ob-on-surface-variant mx-1">/</span>
                <span className="text-ob-on-surface-variant">{totalPages}</span>
              </span>
              <button
                type="button"
                onClick={() => goToPage(currentPage + 1)}
                disabled={isLoading || currentPage >= totalPages}
                className="p-2 rounded-lg border border-ob-outline-variant/20 text-ob-on-surface-variant hover:text-ob-primary hover:border-ob-primary/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-sm">chevron_right</span>
              </button>
            </div>
          </div>
        </motion.section>
      </div>
    </motion.main>
  )
}
