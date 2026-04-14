"use client"

// Public character detail page — /character/[id].
//
// This is the canonical destination for clicking a character name anywhere
// in the app (leaderboard, spectate index, user profile, chat). It renders
// a read-only profile built from GET /characters/public/:id.
//
// All of the data on this page already flows elsewhere in the app, so the
// page is intentionally read-only: no payments, no mutations, no hook calls
// that mutate state. If the character is alive and actively playing, we
// offer a "Spectate live" link to /spectate/[id]. If they're dead, we offer
// a "View Legend" link to /legends/[id].

import Link from "next/link"
import { use, useEffect, useState } from "react"
import type { CharacterClass } from "@adventure-fun/schemas"
import {
  characterDisplayName,
  ownerLabel,
  ownerProfileHref,
} from "../../lib/character-display"

// Material Symbols per class — shared with leaderboard + spectate index.
const CLASS_ICON: Record<string, string> = {
  knight: "shield",
  mage:   "auto_awesome",
  rogue:  "bolt",
  archer: "my_location",
}

const CLASS_COLOR: Record<string, string> = {
  knight: "text-ob-tertiary",
  mage:   "text-ob-primary",
  rogue:  "text-ob-secondary",
  archer: "text-ob-tertiary",
}

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

interface CharacterDetail {
  character: {
    id: string
    name: string
    class: CharacterClass
    level: number
    xp: number
    gold: number
    hp_current: number
    hp_max: number
    hp_max_effective?: number
    resource_current: number
    resource_max: number
    stats: {
      hp: number
      attack: number
      defense: number
      accuracy: number
      evasion: number
      speed: number
    }
    skill_tree: Record<string, boolean>
    perks: Record<string, number>
    status: "alive" | "dead"
    stat_rerolled: boolean
    created_at: string
    died_at: string | null
  }
  owner: {
    id: string
    handle: string | null
    wallet: string
    player_type: "human" | "agent"
    x_handle: string | null
    github_handle: string | null
  } | null
  inventory: Array<{
    id: string
    template_id: string
    quantity: number
    modifiers: Record<string, number>
    slot: string | null
  }>
  lore_discovered: Array<{ lore_entry_id: string; discovered_at_turn: number }>
  current_realm: {
    id: string
    template_id: string
    status: string
    floor_reached: number
    created_at: string
  } | null
  realms_completed: number
  perks_template: Array<{
    id: string
    name: string
    description: string
    stat: "hp" | "attack" | "defense" | "accuracy" | "evasion" | "speed"
    value_per_stack: number
    max_stacks: number
  }>
  history: {
    deepest_floor: number | null
    cause_of_death: string | null
  } | null
}

export default function CharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<CharacterDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`${API_URL}/characters/public/${id}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<CharacterDetail>
      })
      .then((body) => {
        if (!cancelled) setData(body)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load character")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return (
      <main className="min-h-[calc(100vh-5rem)] bg-ob-bg ob-body flex items-center justify-center">
        <div className="ob-label text-xs tracking-widest uppercase text-ob-on-surface-variant animate-pulse">
          Loading character profile...
        </div>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="min-h-[calc(100vh-5rem)] bg-ob-bg ob-body flex items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-4 bg-ob-surface-container-low p-8 rounded-xl border border-ob-outline-variant/15">
          <span className="material-symbols-outlined text-4xl text-ob-error">error_outline</span>
          <div className="ob-headline not-italic text-xl text-ob-on-surface">Character not found</div>
          <p className="text-sm text-ob-on-surface-variant">{error ?? "We couldn't find that character."}</p>
          <Link href="/leaderboard" className="inline-block ob-label text-xs uppercase tracking-widest text-ob-primary border border-ob-primary/40 hover:bg-ob-primary/10 px-4 py-2 rounded-lg transition-colors">
            Back to leaderboard
          </Link>
        </div>
      </main>
    )
  }

  const { character, owner, current_realm, realms_completed } = data
  const isAlive = character.status === "alive"
  const hpMaxDisplay = character.hp_max_effective ?? character.hp_max
  const hpPct = hpMaxDisplay > 0 ? (character.hp_current / hpMaxDisplay) * 100 : 0
  const resourcePct = character.resource_max > 0 ? (character.resource_current / character.resource_max) * 100 : 0
  const displayName = characterDisplayName(character.name, owner)
  const profileHref = ownerProfileHref(owner)

  const statRows: Array<{ label: string; value: number }> = [
    { label: "ATK", value: character.stats.attack },
    { label: "DEF", value: character.stats.defense },
    { label: "ACC", value: character.stats.accuracy },
    { label: "EVA", value: character.stats.evasion },
    { label: "SPD", value: character.stats.speed },
  ]

  // Join the shared perk pool template against the character's unlocked
  // stacks. Filter out anything the character hasn't touched — the public
  // profile is a read-only viewer, not a purchase screen, so empty perks
  // would just be clutter.
  const perkRows = (data.perks_template ?? [])
    .map((perk) => {
      const stacks = character.perks?.[perk.id] ?? 0
      return { perk, stacks }
    })
    .filter((row) => row.stacks > 0)

  return (
    <main className="min-h-[calc(100vh-5rem)] bg-ob-bg ob-body relative overflow-hidden">
      {/* Ambient background blobs */}
      <div className="pointer-events-none absolute -top-32 left-1/4 w-[500px] h-[500px] bg-ob-primary/5 rounded-full blur-[180px] -z-0" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-ob-tertiary/5 rounded-full blur-[200px] -z-0 opacity-50" />

      <div className="relative z-10 max-w-5xl mx-auto px-6 py-12 md:py-16 space-y-8">

        {/* ── Hero header ─────────────────────────────────────────────── */}
        <section className="flex items-start gap-6">
          <div className={`w-24 h-24 rounded-2xl bg-ob-surface-container-low border-2 flex items-center justify-center shrink-0 ${
            isAlive ? "border-ob-primary/40 ob-relic-glow" : "border-ob-outline-variant/30"
          }`}>
            <span
              className={`material-symbols-outlined text-5xl ${CLASS_COLOR[character.class] ?? "text-ob-primary"}`}
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {CLASS_ICON[character.class] ?? "person"}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="ob-label text-[10px] tracking-[0.25em] text-ob-secondary uppercase mb-1">
              CHARACTER PROFILE
            </div>
            <h1 className="ob-headline text-3xl md:text-4xl text-ob-primary mb-2 tracking-tight ob-amber-glow truncate">
              {displayName}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className={`ob-label text-[10px] uppercase tracking-widest ${CLASS_COLOR[character.class] ?? "text-ob-primary"}`}>
                LVL {character.level} {character.class}
              </span>
              {isAlive ? (
                <span className="flex items-center gap-2 ob-label text-[10px] uppercase tracking-widest text-ob-secondary">
                  <span className="w-1.5 h-1.5 rounded-full bg-ob-secondary shadow-[0_0_8px_#6bfe9c]" />
                  ALIVE
                </span>
              ) : (
                <span className="flex items-center gap-2 ob-label text-[10px] uppercase tracking-widest text-ob-error">
                  <span className="w-1.5 h-1.5 rounded-full bg-ob-error" />
                  FALLEN
                </span>
              )}
              {profileHref ? (
                <Link
                  href={profileHref}
                  className="ob-label text-[10px] uppercase tracking-widest text-ob-on-surface-variant hover:text-ob-primary transition-colors"
                >
                  OWNED BY {ownerLabel(owner).toUpperCase()}
                </Link>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            {isAlive && current_realm ? (
              <Link
                href={`/spectate/${character.id}`}
                className="ob-label text-[10px] uppercase tracking-widest bg-ob-primary text-ob-on-primary px-4 py-2 rounded-lg hover:brightness-110 transition-all font-bold text-center"
              >
                ● Spectate Live
              </Link>
            ) : null}
            {!isAlive ? (
              <Link
                href={`/legends/${character.id}`}
                className="ob-label text-[10px] uppercase tracking-widest border border-ob-primary/40 text-ob-primary px-4 py-2 rounded-lg hover:bg-ob-primary/10 transition-colors text-center"
              >
                View Legend
              </Link>
            ) : null}
          </div>
        </section>

        {/* ── Key stats bento (issue #6 — feature parity with legend) ── */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-4">
            <div className="ob-label text-[9px] uppercase tracking-widest text-ob-on-surface-variant mb-1">TOTAL XP</div>
            <div className="ob-headline not-italic text-2xl text-ob-tertiary">{character.xp.toLocaleString()}</div>
          </div>
          <div className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-4">
            <div className="ob-label text-[9px] uppercase tracking-widest text-ob-on-surface-variant mb-1">GOLD</div>
            <div className="ob-headline not-italic text-2xl text-ob-primary">{character.gold.toLocaleString()}</div>
          </div>
          <div className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-4">
            <div className="ob-label text-[9px] uppercase tracking-widest text-ob-on-surface-variant mb-1">DEEPEST FLOOR</div>
            <div className="ob-headline not-italic text-2xl text-ob-primary">
              {data.history?.deepest_floor ?? "—"}
            </div>
          </div>
          <div className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-4">
            <div className="ob-label text-[9px] uppercase tracking-widest text-ob-on-surface-variant mb-1">REALMS CLEARED</div>
            <div className="ob-headline not-italic text-2xl text-ob-secondary">{realms_completed}</div>
          </div>
          <div className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-4">
            <div className="ob-label text-[9px] uppercase tracking-widest text-ob-on-surface-variant mb-1">LORE FOUND</div>
            <div className="ob-headline not-italic text-2xl text-ob-on-surface">{data.lore_discovered.length}</div>
          </div>
        </section>

        {/* ── Vitals + stats split ────────────────────────────────────── */}
        <section className="grid md:grid-cols-2 gap-6">
          {/* Vital bars */}
          <div className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-6 space-y-5">
            <h3 className="ob-label text-[10px] tracking-[0.2em] text-ob-on-surface-variant uppercase">VITAL SIGNS</h3>

            <div className="space-y-1">
              <div className="flex justify-between ob-label text-[10px]">
                <span className="text-ob-secondary font-bold">HEALTH</span>
                <span className="text-ob-on-surface">{character.hp_current} / {hpMaxDisplay}</span>
              </div>
              <div className="h-2 w-full bg-ob-surface-container-lowest rounded-full overflow-hidden">
                <div
                  className={`h-full ${hpPct < 25 ? "bg-ob-error" : "bg-ob-secondary"} shadow-[0_0_8px_rgba(107,254,156,0.3)] transition-all duration-500`}
                  style={{ width: `${hpPct}%` }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between ob-label text-[10px]">
                <span className="text-ob-tertiary font-bold">RESOURCE</span>
                <span className="text-ob-on-surface">{character.resource_current} / {character.resource_max}</span>
              </div>
              <div className="h-2 w-full bg-ob-surface-container-lowest rounded-full overflow-hidden">
                <div
                  className="h-full bg-ob-tertiary shadow-[0_0_8px_rgba(127,197,255,0.3)] transition-all duration-500"
                  style={{ width: `${resourcePct}%` }}
                />
              </div>
            </div>

            {current_realm ? (
              <div className="pt-4 border-t border-ob-outline-variant/10">
                <div className="ob-label text-[10px] uppercase tracking-widest text-ob-on-surface-variant mb-1">CURRENT REALM</div>
                <div className="ob-headline not-italic text-base text-ob-on-surface">{current_realm.template_id}</div>
                <div className="text-xs text-ob-on-surface-variant">
                  Floor {current_realm.floor_reached} · {current_realm.status}
                </div>
              </div>
            ) : null}

            {!isAlive && character.died_at ? (
              <div className="pt-4 border-t border-ob-outline-variant/10 space-y-1">
                <div className="ob-label text-[10px] uppercase tracking-widest text-ob-error">FALLEN</div>
                <div className="text-xs text-ob-on-surface-variant">
                  {new Date(character.died_at).toLocaleString()}
                </div>
                {/* Cause of death pulled from leaderboard_entries via the
                    /characters/public/:id endpoint. Keeps this page
                    feature-parity with the legend page so a viewer
                    doesn't have to hop over to see what killed them. */}
                {data.history?.cause_of_death ? (
                  <div className="text-xs text-ob-error/80 italic mt-1">
                    &quot;{data.history.cause_of_death}&quot;
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Stat grid */}
          <div className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-6">
            <h3 className="ob-label text-[10px] tracking-[0.2em] text-ob-on-surface-variant uppercase mb-4">COMBAT STATS</h3>
            <div className="grid grid-cols-5 gap-2">
              {statRows.map((s) => (
                <div key={s.label} className="bg-ob-surface-container p-3 rounded-lg border border-ob-outline-variant/10 text-center">
                  <div className="ob-label text-[9px] uppercase tracking-widest text-ob-on-surface-variant">{s.label}</div>
                  <div className="ob-headline not-italic text-lg text-ob-on-surface mt-1">{s.value}</div>
                </div>
              ))}
            </div>
            {character.stat_rerolled ? (
              <p className="ob-label text-[10px] text-ob-on-surface-variant uppercase tracking-widest mt-4">
                STATS RE-ROLLED ONCE
              </p>
            ) : null}
          </div>
        </section>

        {/* ── Equipment ───────────────────────────────────────────────── */}
        {data.inventory.filter((i) => i.slot).length > 0 ? (
          <section className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-6">
            <h3 className="ob-label text-[10px] tracking-[0.2em] text-ob-on-surface-variant uppercase mb-4">EQUIPMENT</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {["weapon", "armor", "helm", "hands", "accessory"].map((slot) => {
                const equipped = data.inventory.find((i) => i.slot === slot)
                return (
                  <div key={slot} className="bg-ob-surface-container p-3 rounded-lg border border-ob-outline-variant/10 text-center">
                    <div className="ob-label text-[9px] uppercase tracking-widest text-ob-on-surface-variant mb-2">{slot}</div>
                    {equipped ? (
                      <div className="text-xs text-ob-on-surface truncate" title={equipped.template_id}>
                        {equipped.template_id}
                      </div>
                    ) : (
                      <div className="text-xs text-ob-outline italic">—</div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}

        {/* ── Perks acquired ──────────────────────────────────────────── */}
        {perkRows.length > 0 ? (
          <section className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-6">
            <h3 className="ob-label text-[10px] tracking-[0.2em] text-ob-on-surface-variant uppercase mb-4">PERKS ACQUIRED</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {perkRows.map(({ perk, stacks }) => {
                const total = perk.value_per_stack * stacks
                return (
                  <div key={perk.id} className="bg-ob-surface-container p-3 rounded-lg border border-ob-outline-variant/10">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="ob-label text-xs text-ob-secondary font-bold uppercase tracking-wide">
                        {perk.name}
                      </div>
                      <div className="ob-label text-[9px] bg-slate-900/60 text-ob-on-surface-variant px-1.5 py-0.5 rounded">
                        {stacks} / {perk.max_stacks}
                      </div>
                    </div>
                    <div className="text-xs text-ob-on-surface mb-1">+{total} {perk.stat}</div>
                    <div className="text-[11px] italic text-ob-on-surface-variant">{perk.description}</div>
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}

        {/* ── Meta footer ─────────────────────────────────────────────── */}
        <section className="text-xs text-ob-outline flex flex-wrap gap-4">
          <span>CHARACTER ID: {character.id.slice(0, 8)}…</span>
          <span>CREATED: {new Date(character.created_at).toLocaleDateString()}</span>
          {owner?.player_type ? (
            <span className="uppercase">{owner.player_type}</span>
          ) : null}
        </section>
      </div>
    </main>
  )
}
