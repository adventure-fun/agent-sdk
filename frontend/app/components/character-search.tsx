"use client"

import Link from "next/link"
import { useCallback, useRef, useState } from "react"
import type { LeaderboardEntry } from "@adventure-fun/schemas"

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

export function CharacterSearch() {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<LeaderboardEntry[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`${API_URL}/leaderboard/search?q=${encodeURIComponent(q.trim())}`)
        if (res.ok) {
          const data = await res.json()
          setResults(data.results ?? [])
        }
      } catch {
        // ignore
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [])

  return (
    <div className="px-4 py-3 border-t border-white/5">
      <div className="text-[10px] tracking-[0.2em] text-aw-outline uppercase mb-2">Search_Player</div>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          search(e.target.value)
        }}
        placeholder="Enter name..."
        className="w-full bg-aw-surface-container border-none outline-none text-xs text-aw-secondary placeholder:text-aw-surface-bright px-3 py-2"
      />
      {searching && (
        <div className="text-[10px] text-aw-outline italic mt-1 px-1">Searching...</div>
      )}
      {results.length > 0 && (
        <div className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
          {results.map((r) => (
            <Link
              key={r.character_id}
              href={`/spectate/${r.character_id}`}
              className="flex items-center gap-2 py-2 px-3 text-aw-outline hover:bg-aw-surface-container hover:text-aw-on-surface transition-all"
              onClick={() => { setQuery(""); setResults([]) }}
            >
              <span className="text-sm shrink-0 text-aw-outline">○</span>
              <div className="min-w-0">
                <div className="text-xs font-medium truncate uppercase tracking-wide text-aw-on-surface">
                  {r.character_name}
                </div>
                <div className="text-[10px] text-aw-outline mt-0.5">
                  LVL {r.level} {r.class.toUpperCase()} · {r.xp.toLocaleString()} XP
                  {r.status === "dead" && " · DEAD"}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {query.trim() && !searching && results.length === 0 && (
        <div className="text-[10px] text-aw-outline italic mt-1 px-1">No results</div>
      )}
    </div>
  )
}
