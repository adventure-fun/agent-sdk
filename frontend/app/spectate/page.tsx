"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { useActiveSpectateSessions } from "../hooks/use-active-spectate-sessions"
import { pageEnter, sectionReveal } from "../lib/motion"

export default function SpectateIndexPage() {
  const { sessions, isLoading, error, refetch } = useActiveSpectateSessions({ refreshMs: 12_000 })

  return (
    <motion.main
      variants={pageEnter}
      initial="hidden"
      animate="visible"
      className="min-h-screen bg-gradient-to-b from-gray-950 via-black to-gray-950 p-4 sm:p-6"
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <motion.div variants={sectionReveal} className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
          <p className="text-xs uppercase tracking-[0.3em] text-amber-300/70">Spectator Mode</p>
          <h1 className="font-display mt-2 text-3xl font-bold text-amber-300">Live runs</h1>
          <p className="mt-2 max-w-xl text-sm text-gray-400">
            Watch active dungeon sessions in real time. The list refreshes every few seconds and only shows runs on this
            server.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-full border border-gray-600 px-4 py-2 text-sm text-gray-200 transition-colors hover:border-amber-400/50 hover:text-amber-100"
            >
              Refresh now
            </button>
            <Link
              href="/"
              className="rounded-full border border-gray-700 px-4 py-2 text-sm text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-200"
            >
              Home
            </Link>
          </div>
        </motion.div>

        {error ? (
          <motion.div
            variants={sectionReveal}
            className="flex flex-col gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-full border border-red-300/30 px-3 py-1.5 text-xs font-medium text-red-100 transition-colors hover:border-red-200/50 hover:bg-red-500/10"
            >
              Retry
            </button>
          </motion.div>
        ) : null}

        <motion.section variants={sectionReveal} className="space-y-3">
          {isLoading && sessions.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-8 text-center text-sm text-gray-500">
              Loading live sessions…
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-8 text-center text-sm text-gray-400">
              No live runs right now. Delvers may be in the hub or between realms—check back shortly.
            </div>
          ) : (
            <ul className="space-y-3">
              {sessions.map((row) => (
                <li key={row.character_id}>
                  <Link
                    href={`/spectate/${row.character_id}`}
                    className="block rounded-2xl border border-gray-800 bg-gray-900/70 p-4 transition-colors hover:border-amber-500/30 hover:bg-gray-900"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-display text-lg font-semibold capitalize text-gray-100">
                          {row.character.class} · Level {row.character.level}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">Character {row.character_id.slice(0, 8)}…</div>
                      </div>
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200">
                        Watch live
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-gray-400 sm:grid-cols-2">
                      <div>
                        <span className="text-gray-600">Realm</span>{" "}
                        <span className="text-gray-200">{row.realm_info.template_name}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Floor</span>{" "}
                        <span className="text-gray-200">
                          {row.realm_info.current_floor} · {row.realm_info.status.replaceAll("_", " ")}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Turn</span> <span className="text-gray-200">{row.turn}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Room</span>{" "}
                        <span className="text-gray-200">{row.position.room_id}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </motion.section>
      </div>
    </motion.main>
  )
}
