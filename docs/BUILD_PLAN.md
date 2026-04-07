# Adventure.fun — v1 Build Plan

> **Specs:** [GAME_DESIGN](./specs/GAME_DESIGN.md) · [BACKEND](./specs/BACKEND.md) · [FRONTEND](./specs/FRONTEND.md) · [AGENT_API](./specs/AGENT_API.md) · [ECONOMY](./specs/ECONOMY.md) · [CONTENT](./specs/CONTENT.md)

## 1. Product Definition

Adventure.fun is a persistent, text-first, solo dungeon crawler for autonomous agents and human players. Players create characters, explore procedurally generated dungeon realms under partial information, manage resources and builds, and attempt to extract loot before permadeath ends the run. Open rules, open client code, closed hidden world state, authoritative server simulation.

**Target users:** AI agent developers, human dungeon crawl players, spectators.

**Capstone success criteria:** 50 paying customers or 100 GitHub stars.

**v1 success criteria:** 1,000+ concurrent players (human + agent), minimal social media virality through shareable death cards and legend pages.

---

## 2. v1 Scope

### Included

- Text-first web UI for human play and spectating
- Solo realms only
- 4 classes: Knight, Mage, Rogue, Archer (player-chosen)
- Free character creation (one living character per account)
- Free first realm per account; additional realms via x402
- Stat reroll via x402 (once per character)
- Inn healing and realm regeneration via x402
- All x402 prices configurable
- In-game gold economy with explicit sinks
- Seed + delta persistence model
- Server-authoritative deterministic simulation
- Unified leaderboards (human + agent, tagged, filterable)
- Narrative layer with strategic lore
- Live spectating via redacted SpectatorObservation
- Lobby activity feed + persistent hall of fame
- Adversarial chat filtering
- Shareable legend pages with OG tags + death/completion cards
- Coinbase embedded wallets (humans) + OpenWallet adapter (agents)
- Open-source engine, agent SDK, reference agent

### Excluded (deferred)

- Co-op/PvP realms, P2P marketplace, EIP-8004, voxel renderer, third-party realms, replay UI, respec

---

## 3. Account Model

- One wallet can hold **two accounts**: one human, one agent
- Account type inferred from auth flow: Coinbase embedded = human, SDK wallet sig = agent
- **One living character at a time** per account (must die before rolling another)
- Unified leaderboard with `player_type` tag and filter toggle

---

## 4. Core Loop

```
Auth (Coinbase Embedded or SDK Wallet Sig)
  → Create Account (type inferred)
  → Roll Character (free, choose class, random stats)
  → Optional: pay to reroll stats (once)
  → Enter Lobby (buy supplies, sell loot, inn, chat)
  → Unlock Realm (first free, then x402)
  → Dungeon Run (observe → act → repeat)
      → Extract via entrance or portal → back to Lobby
      → Die → Permadeath → Legend preserved → Roll new character
```

---

## 5. Milestone Plan

| Phase | Week | Focus |
|---|---|---|
| 1. Design Lock & Schemas | 1-2 | TypeScript schemas, content templates, DB schema, API contract |
| 2. Headless Simulation | 3-4 | Realm gen, turn loop, combat, visibility, determinism tests, CLI harness |
| 3. Persistence & Re-Entry | 5-6 | Supabase Postgres, accounts, characters, delta persistence, reconnect |
| 4. Economy & Lobby | 6-7 | Inventory, shops, gold sinks, inn, lobby REST API |
| 5. Wallet & Payments | 7-8 | Coinbase embedded, x402 gates, free tier logic, configurable pricing |
| 6. Narrative Layer | 8-9 | Room text, interactables, triggers, lore codex |
| 7. Classes & Content | 9-10 | 4 classes, skill trees, enemies, bosses, 2-3 realm templates, balance pass |
| 8. Real-Time Systems | 10-11 | Redis pub/sub, spectator feed, lobby activity, chat filtering, leaderboards |
| 9. Web UI | 11-13 | Human player UI, dungeon renderer, spectator, leaderboards, legends, OG cards |
| 10. Agent SDK | 13-14 | OpenWallet adapter, reference agent, SDK docs, testing harness |
| 11. Security & Testing | 14-15 | Rate limits, load test (1k+), security audit, balance testing, staging |
| 12. Launch | 15-16 | Production deploy, open-source publish, launch event |

---

## 6. Locked Decisions

1. Solo realms only in v1
2. Text-first, headless engine — UI is an adapter
3. Server-authoritative deterministic simulation
4. Seed + delta persistence with deterministic entity IDs (`f{floor}_r{room}_{type}_{index}`)
5. Free character creation — one living character at a time per account
6. First realm free per account — additional realms via x402
7. All x402 prices configurable
8. Stat reroll via x402 — once per character, bounded ±5% variance
9. Gold fully separate from x402 — with explicit sinks
10. Real money cannot buy combat power
11. Permadeath with legend preservation
12. No auto-retreat ever — timeout = wait/defend
13. Boss kill does not auto-extract — must escape alive
14. Death always creates corpse container
15. Observation packet model — only earned visibility
16. Spectators receive redacted SpectatorObservation
17. Separate human and agent accounts — type inferred from auth flow
18. Coinbase embedded wallets (humans), OpenWallet adapter (agents)
19. Unified leaderboard — tagged by player type, filterable
20. Speed stat is dual-purpose — initiative + evasion/accuracy
21. 4 classes, 3-tier skill trees, data-driven and config-tunable
22. One active realm per variant per character
23. NPC economy only in v1
24. Config-driven balance values
25. Lore is sometimes strategic
26. Run events stored for future replay
27. Chat with adversarial content filtering — chat is untrusted input
28. Redis pub/sub for real-time fan-out — Supabase for Postgres only
29. Shareable legend pages with OG tags + death/completion cards
30. v1 targets 1,000+ concurrent players

---

## 7. Open Questions

| # | Gap | Notes |
|---|---|---|
| 1 | Gold economy balance | Iterative tuning during development |
| 2 | Enemy difficulty scaling per floor | Needs curve formula |
| 3 | Realm completion rewards | Gold/XP bonus, harder variant unlock? |
| 4 | Skill tree tier unlock levels | Suggested 3, 6, 10 |
| 5 | x402 pricing starting points | Inn, reroll, realm — all configurable |
| 6 | Content testing framework | Validate realm templates are beatable |
| 7 | API versioning | `/v1/...` for SDK compatibility |
| 8 | Bun vs Node.js | Verify x402 SDK + WS compatibility |
