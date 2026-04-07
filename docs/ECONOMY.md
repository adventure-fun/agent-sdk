# Adventure.fun — Economy Spec

> **Related:** [GAME_DESIGN.md](./GAME_DESIGN.md) for game mechanics · [BACKEND.md](./BACKEND.md) for payment endpoint implementation · [AGENT_API.md](./AGENT_API.md) for endpoint contracts

## 1. Dual Currency Model

Adventure.fun has two fully separate currencies:

- **x402 (real money via USDC):** Gates access and convenience. Cannot buy combat power.
- **Gold (in-game):** Earned from gameplay. Spent on items, equipment, consumables.

No gold-to-real-money conversion in v1.

---

## 2. Free Tier

### What's Free

- **Character creation:** Always free. Player chooses class, stats randomized within bounded range.
- **First realm per account:** One realm unlock is free (tracked via `accounts.free_realm_used` flag).

### Constraints

- One living character at a time per account (must die before rolling another)
- Free realm is one specific variant (not player's choice — always the introductory realm)
- After free realm, all additional unlocks cost x402

### Anti-Spam

- Wallet auth required (even for free tier) — sybil deterrent
- One alive character limit prevents throwaway spam
- Rate limiting on character creation (one per minute per account)

---

## 3. x402 Payments

### Gated Actions

All prices are **configurable** via server config (not hardcoded). Starting point suggestions:

| Endpoint | Action | Suggested Price | Notes |
|---|---|---|---|
| `POST /characters/reroll-stats` | Stat reroll | $0.10 - $0.25 | Once per character. Same class, new random stats within bounds. |
| `POST /realms/generate` | Unlock new realm variant | $0.25 | One-time per character per variant. First realm free per account. |
| `POST /inn/rest` | Full HP restore + clear debuffs | $0.05 - $0.10 | Repeatable. |
| `POST /realms/:id/regenerate` | Wipe completed realm, new seed | $0.25 + gold cost | Only for completed realms. |

### Payment Flow (x402 Protocol)

1. Agent/client sends request to protected endpoint
2. Server returns `402 Payment Required` with payment details (amount, chain, recipient)
3. Client pays via wallet (Coinbase embedded for humans, OpenWallet for agents)
4. Client retries request with payment proof header
5. Server verifies payment, processes request, logs to `payment_log` table

### Supported Chains

Solana, Base. Chain abstracted in payment layer — adding chains requires only config changes.

### What x402 Does NOT Buy

- Stat boosts beyond the bounded reroll
- Premium gear or items
- XP multipliers
- Gold
- Extra inventory slots (gold-purchasable only)
- Combat advantage of any kind

---

## 4. Gold Economy

### Sources (How Gold Enters)

| Source | Amount | Notes |
|---|---|---|
| Sell loot to NPC shops | Item-dependent | Primary source. Rarer items sell for more. |
| Realm completion bonus | Configurable | One-time per realm instance. |
| Floor clear bonus | Small, configurable | First time clearing a floor. |
| Event/quest rewards | Configurable | From triggered narrative events. |

### Sinks (How Gold Leaves)

| Sink | Cost | Design Goal |
|---|---|---|
| **Portal scrolls** | High | Major recurring drain. Critical survival item. |
| **Backpack upgrades** | Expensive | +2-4 inventory slots. One-time per character. |
| **Premium shop rotation** | High | Rotating rare/powerful items. Keeps gold valuable at all levels. |
| **Consumables** | Moderate | Potions, antidotes, buffs. Steady per-run drain. |
| **Equipment** | Escalating | Higher-tier gear at increasing prices. |
| **Realm regeneration (gold component)** | Configurable | Gold cost on top of x402 for regenerating completed realms. |

### Future Sink (Configurable, Not Active at Launch)

Inn healing can be toggled from x402-only to gold-based or dual-cost via server config flag. Available if x402 friction is too high or gold inflation becomes a problem.

### Anti-Inflation Design

- Economy should feel **tight** — gold is scarce enough for meaningful tradeoffs
- New characters can afford basic supplies (a few potions) from their first realm run
- Portal scrolls are the primary "expensive necessity" that keeps gold valuable
- Shop rotation ensures there's always something worth saving for
- All prices config-driven for live tuning

---

## 5. NPC Shops

### Structure

- Fixed base inventory (always available: basic potions, common gear)
- **Rotating premium stock** (changes on a schedule, higher rarity, higher prices)
- Buy and sell prices are asymmetric (sell price < buy price — standard RPG markup)
- Shop templates define inventory pools, pricing rules, and rotation schedule (see [CONTENT.md](./CONTENT.md))

### Portal Scroll Pricing

This is the **single most important balance lever** in the game.

- Must be expensive enough that carrying one is a real inventory + economic decision
- Must not be so expensive that only endgame characters can afford escape
- Drop rate from treasure rooms must be low enough to maintain gold value
- All values config-driven

---

## 6. Stat Reroll

- Available once per character via x402 payment
- Rerolls all stats within the same class's bounded ranges
- Same ±5% variance rules apply
- Does not change class
- Cannot be done mid-dungeon (lobby only)
- Tracked via `characters.stat_rerolled` boolean — endpoint rejects if already used

---

## 7. Fairness Rule

**Real money buys access and convenience, never combat power.**

This is non-negotiable for leaderboard legitimacy. If x402 purchases could grant direct power, the leaderboard becomes "who spent the most" rather than "who played the best."

The stat reroll is the closest edge case — it's acceptable because:
- Variance is bounded to ±5%
- It's a one-time convenience, not a repeatable advantage
- Skill tree choices and play quality dominate over initial stats
