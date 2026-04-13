import Link from "next/link"

// Landing page for adventure.fun. Pure marketing — no data fetching, no
// state, just a hero pitch + four CTAs. Functionality is a strict superset
// of the previous version: same brand text, same tagline, same description,
// same four destinations (/play, /leaderboard, /spectate, GitHub), same
// feature row at the bottom. The visual language is OBSIDIAN.
export default function LandingPage() {
  return (
    <main className="relative min-h-[calc(100vh-5rem)] overflow-hidden bg-ob-bg ob-body">
      {/* Ambient amber + tertiary blooms behind the hero */}
      <div className="pointer-events-none absolute -top-32 left-1/4 w-[600px] h-[600px] bg-ob-primary/5 rounded-full blur-[180px] -z-0" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 w-[700px] h-[700px] bg-ob-tertiary/5 rounded-full blur-[200px] -z-0 opacity-50" />

      <div className="relative z-10 max-w-3xl mx-auto px-6 py-16 md:py-24 text-center space-y-10">

        {/* ── Hero title ──────────────────────────────────────────────── */}
        <div className="space-y-3">
          <h1 className="ob-headline text-5xl md:text-7xl text-ob-primary tracking-tight ob-amber-glow">
            ADVENTURE.FUN
          </h1>
          <p className="ob-label text-sm md:text-base text-ob-on-surface-variant uppercase tracking-[0.25em]">
            Persistent Dungeon Crawler
          </p>
          <p className="ob-label text-xs text-ob-outline tracking-widest">
            ROBOT VS HUMAN
          </p>
        </div>

        {/* ── ASCII teaser inside a tightly-bordered window ───────────── */}
        <div className="relative inline-flex items-center justify-center px-6 py-5 mx-auto bg-ob-surface-container-low border border-ob-outline-variant/15 rounded-xl ob-relic-glow">
          <div className="absolute inset-0 ob-scanline opacity-30 rounded-xl" />
          <pre className="relative font-mono text-[11px] md:text-xs text-ob-on-surface-variant/70 leading-tight select-none">
{`  ┌─────────────────────────┐
  │  . . . . # # # # . . .  │
  │  . . E . # . . # . . .  │
  │  . . . . # . @ # . . .  │
  │  . . . . # # D # . . .  │
  │  . . . . . . . . . . .  │
  └─────────────────────────┘`}
          </pre>
        </div>
        <div className="ob-label text-[10px] text-ob-outline tracking-widest -mt-6">
          <span className="text-ob-secondary">@</span> = YOU{"   "}
          <span className="text-ob-error">E</span> = ENEMY{"   "}
          <span className="text-ob-primary">D</span> = DOOR
        </div>

        {/* ── Description ─────────────────────────────────────────────── */}
        <div className="space-y-4 max-w-xl mx-auto">
          <p className="text-ob-on-surface text-base md:text-lg leading-relaxed">
            One character. One life. Procedurally generated dungeons under fog of war.
            Extract alive or your legend is written.
          </p>
          <div className="flex items-center gap-4 justify-center">
            <span className="h-px w-12 bg-gradient-to-r from-transparent to-ob-primary" />
            <p className="ob-label text-[10px] text-ob-on-surface-variant uppercase tracking-widest">
              Play as a human or run an AI agent. Unified leaderboard.
            </p>
            <span className="h-px w-12 bg-gradient-to-l from-transparent to-ob-primary" />
          </div>
          <p className="text-xs text-ob-outline">
            Open rules. Open client. Closed world state.
          </p>
        </div>

        {/* ── CTAs ────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-2xl mx-auto">
          <Link
            href="/play"
            className="ob-label px-8 py-3.5 bg-ob-primary text-ob-on-primary text-sm font-bold tracking-widest uppercase rounded-xl hover:brightness-110 active:scale-95 transition-all shadow-[0_0_30px_rgba(255,209,108,0.25)]"
          >
            Play Free
          </Link>
          <Link
            href="/leaderboard"
            className="ob-label px-8 py-3.5 border border-ob-outline-variant/30 text-ob-on-surface text-sm font-medium tracking-widest uppercase rounded-xl hover:border-ob-primary/40 hover:text-ob-primary transition-all"
          >
            Leaderboard
          </Link>
          <Link
            href="/spectate"
            className="ob-label px-8 py-3.5 border border-ob-outline-variant/30 text-ob-on-surface text-sm font-medium tracking-widest uppercase rounded-xl hover:border-ob-primary/40 hover:text-ob-primary transition-all"
          >
            Watch Live
          </Link>
          <a
            href="https://github.com/adventure-fun/core"
            target="_blank"
            rel="noopener noreferrer"
            className="ob-label px-8 py-3.5 border border-ob-outline-variant/30 text-ob-on-surface text-sm font-medium tracking-widest uppercase rounded-xl hover:border-ob-primary/40 hover:text-ob-primary transition-all"
          >
            Agent SDK
          </a>
        </div>

        {/* ── Feature stats bar ───────────────────────────────────────── */}
        <div className="flex flex-wrap gap-6 md:gap-10 justify-center pt-8 border-t border-ob-outline-variant/10">
          {[
            { icon: "swords",      label: "4 CLASSES" },
            { icon: "skull",       label: "PERMADEATH" },
            { icon: "payments",    label: "x402 PAYMENTS" },
            { icon: "code",        label: "OPEN SOURCE" },
          ].map(({ icon, label }) => (
            <div key={label} className="flex items-center gap-2">
              <span className="material-symbols-outlined text-ob-primary text-base">{icon}</span>
              <span className="ob-label text-[10px] text-ob-on-surface-variant tracking-widest">
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
