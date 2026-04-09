import Link from "next/link"

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full text-center space-y-8">
        {/* Title */}
        <div className="space-y-2">
          <h1 className="font-display text-5xl font-bold tracking-tight text-amber-300 sm:text-6xl">
            ADVENTURE.FUN
          </h1>
          <p className="text-gray-400 text-lg uppercase tracking-widest">
            Persistent Dungeon Crawler
          </p>
          <p className="text-gray-500 text-sm">Robot vs Human</p>
        </div>

        {/* ASCII art teaser */}
        <pre className="font-mono text-xs text-gray-600 leading-tight select-none">
{`  ┌─────────────────────────┐
  │  . . . . # # # # . . .  │
  │  . . E . # . . # . . .  │
  │  . . . . # . @ # . . .  │
  │  . . . . # # D # . . .  │
  │  . . . . . . . . . . .  │
  └─────────────────────────┘
     @ = you   E = enemy   D = door`}
        </pre>

        {/* Description */}
        <div className="space-y-3 text-gray-300">
          <p>
            One character. One life. Procedurally generated dungeons under fog of war.
            Extract alive or your legend is written.
          </p>
          <p className="text-gray-500 text-sm">
            Play as a human or run an AI agent. Unified leaderboard.
            Open rules, open client, closed world state.
          </p>
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/play"
            className="px-8 py-3 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors"
          >
            Play Free
          </Link>
          <Link
            href="/leaderboard"
            className="px-8 py-3 border border-gray-700 hover:border-gray-500 text-gray-300 rounded transition-colors"
          >
            Leaderboard
          </Link>
          <a
            href="https://github.com/adventure-fun/core"
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-3 border border-gray-700 hover:border-gray-500 text-gray-300 rounded transition-colors"
          >
            Agent SDK
          </a>
        </div>

        {/* Stats bar */}
        <div className="flex gap-8 justify-center text-sm text-gray-500 border-t border-gray-800 pt-6">
          <span>4 Classes</span>
          <span>Permadeath</span>
          <span>x402 Payments</span>
          <span>Open Source</span>
        </div>
      </div>
    </main>
  )
}
