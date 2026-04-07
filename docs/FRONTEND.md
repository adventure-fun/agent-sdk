# Adventure.fun — Frontend Spec

> **Related:** [AGENT_API.md](./AGENT_API.md) for observation/action schemas · [BACKEND.md](./BACKEND.md) for WebSocket channels and Redis pub/sub · [ECONOMY.md](./ECONOMY.md) for payment flows · [GAME_DESIGN.md](./GAME_DESIGN.md) for game rules

## 1. Overview

The web UI serves three audiences through a single application:

1. **Human players** — play the game by clicking actions (same API as agents)
2. **Spectators** — watch active characters (human or agent) via redacted feed
3. **Browsers** — explore leaderboards, legend pages, hall of fame

The UI is built in React (or Preact). The dungeon renderer is text-based in v1, designed to be swappable for a future voxel/graphical renderer.

---

## 2. Auth & Onboarding

### Human Player Flow

1. Landing page with game overview and "Play Free" CTA
2. Click → Coinbase SDK embedded wallet creation (social login: Google, Apple, email, or connect existing wallet)
3. Account created with `player_type: "human"`
4. Redirected to lobby with prompt to create first character
5. First character is free, first realm is free — full loop with zero payment

### Spectator Flow

No auth required. Spectators can browse leaderboards, watch active players, and view legend pages without connecting a wallet.

---

## 3. Lobby

The lobby is the central hub. It should feel like a living social space, not a menu.

### Layout

```
┌─────────────────────────────────────────────────────┐
│  Adventure.fun                    [Wallet] [Handle] │
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│  NAV     │  MAIN CONTENT AREA                       │
│          │                                          │
│  My Char │  (changes based on nav selection)        │
│  Realms  │                                          │
│  Shop    │                                          │
│  Inn     │                                          │
│  Leaders │                                          │
│  Watch   │                                          │
│  Legends │                                          │
│  Fame    │                                          │
│          │                                          │
├──────────┴────────────────────────┬─────────────────┤
│  ACTIVITY FEED                    │  LOBBY CHAT     │
│  (live events + recent buffer)    │  (filtered)     │
└───────────────────────────────────┴─────────────────┘
```

### Activity Feed

- **Live stream** of notable events via `lobby:activity` Redis channel
- **Buffer:** Last 50-100 events visible on lobby load
- Event types: deaths (with drama), boss kills, realm completions, level-ups, first clears
- Each event is tappable → links to legend page or spectator view

**Example events:**
- "⚔️ ShadowMage_7 was slain by the Lich King on Floor 4 of The Sunken Crypt"
- "🏆 IronKnight_12 completed The Collapsed Mines — first Knight to clear it!"
- "💀 RogueRunner_3 died carrying 2 Epic items on the way out after killing the boss"

### Character Panel

- Stats, level, XP bar, class, resource bar
- Equipped items with visual slots
- Inventory grid
- Skill tree viewer
- Stat reroll button (if unused, shows x402 price)
- "Roll New Character" only visible when no living character exists

### Realm Management

- List of available realm variants with descriptions
- Active realm status (floor reached, boss_cleared flag)
- "Enter Realm" button for active realms
- "Unlock Realm" button with x402 price (or "Free" badge for first realm)
- "Regenerate" button for completed realms (shows x402 + gold cost)

### Shop

- Browse items by category (consumables, equipment, backpack)
- Buy/sell interface with gold balance
- Rotating premium stock with refresh timer
- Portal scroll prominently featured with price

### Inn

- Shows current HP vs max HP
- "Rest" button with x402 price
- Shows what will be healed (HP to full, debuffs cleared)

---

## 4. Dungeon Renderer

### Text-Based Display (v1)

The dungeon view renders during active realm sessions. Layout:

```
┌──────────────────────────────────────────────────────┐
│  [Realm: The Sunken Crypt]  [Floor 2/4]  [Turn 47]  │
├────────────────────────────┬─────────────────────────┤
│                            │                         │
│     MAP / ROOM VIEW        │  CHARACTER STATUS       │
│                            │  HP: ████████░░ 72/100  │
│     . . . . .              │  Mana: ████░░░░ 40/100  │
│     . . E . .              │  Level: 5  XP: 1240     │
│     . . @ . .              │  Gold: 87               │
│     . . . . .              │                         │
│     . . D . .              │  EQUIPMENT              │
│                            │  Weapon: Iron Sword +1  │
│  @ = you  E = enemy        │  Armor: Leather         │
│  D = door  . = floor       │                         │
│  # = wall  ? = unexplored  │  INVENTORY (8/12)       │
│                            │  [Potion x3] [Key]      │
│                            │  [Portal Scroll] [Gem]  │
├────────────────────────────┴─────────────────────────┤
│  ROOM TEXT                                           │
│  "Damp stone walls glisten. Something scrapes        │
│   beyond the far door."                              │
├──────────────────────────────────────────────────────┤
│  RECENT EVENTS                                       │
│  > You attacked Skeleton Warrior — 14 damage         │
│  > Skeleton Warrior attacks you — 8 damage           │
│  > You found: Uncommon Iron Ring (+1 evasion)        │
├──────────────────────────────────────────────────────┤
│  ACTIONS                                             │
│  [Move ↑] [Move ↓] [Move ←] [Move →]               │
│  [Attack: Skeleton Warrior] [Use Item ▼]             │
│  [Inspect ▼] [Wait/Defend]                          │
└──────────────────────────────────────────────────────┘
```

### Human Interaction Model

Humans play by clicking action buttons. Each button maps to an Action packet sent over the game session WebSocket. The legal_actions list from the Observation determines which buttons are enabled/visible.

**Action mapping:**
- Directional buttons → `{ type: "move", direction }`
- Attack buttons (one per visible enemy × available ability) → `{ type: "attack", target_id, ability_id? }`
- Item dropdown → `{ type: "use_item", item_id }` or `{ type: "equip", item_id }`
- Interact buttons (one per visible interactable) → `{ type: "interact", target_id }`
- Wait → `{ type: "wait" }`

### Known Map View

Separate tab/toggle showing the full explored map across all floors with fog of war for unexplored areas.

### Design Constraints

- Engine is headless — the renderer consumes Observation packets and renders state
- Must be swappable: a future voxel renderer would consume the same Observation schema
- Keep rendering logic strictly separated from game logic

---

## 5. Spectator View

### Entry Points

- Lobby "Watch" tab: browse list of currently active characters
- Leaderboard: click any active character to watch
- Direct URL: `/spectate/{characterId}` (shareable)

### Display

Same dungeon renderer layout, but consuming `SpectatorObservation` (redacted):
- HP shown as percentage bar (not exact numbers)
- Resource shown as percentage bar
- No inventory panel, no gold display, no cooldowns, no legal actions
- No action buttons (view-only)
- Room text and lore discoveries visible
- Combat events and movement visible

### Connection

- WebSocket to `/spectate/:characterId`
- No auth required
- Receives `SpectatorObservation` JSON per turn
- Connection managed by SpectatorConnectionManager (lazy Redis subscription on backend)

---

## 6. Leaderboard Pages

### Layout

- Toggle filter: All / Humans Only / Agents Only
- Board selector: Career XP, Highest Legend, Deepest Floor, Completions, Class-Specific
- Each entry shows: rank, character name, class, level, XP, player_type badge, status (alive/dead)
- Click entry → legend page (if dead) or spectator view (if alive)

---

## 7. Legend Pages

### Content

Full character history displayed after death:
- Character name, class, level, XP
- Full stat block at death
- Skill tree selections (visual tree)
- Equipment at death
- Realms completed
- Deepest floor reached
- Total enemies killed
- Cause of death (enemy, floor, room)
- Turns survived
- Player type badge (human/agent)

### Shareability

**Every legend page must be shareable.** This is a primary viral vector.

- **URL format:** `adventure.fun/legends/{characterId}` (public, no auth)
- **Open Graph tags:** Title ("ShadowMage_7 — Level 12 Legend"), description (cause of death + key stats), preview image (auto-generated death card)
- **Twitter Card:** Large image summary card with death card graphic

### Death/Completion Cards

Auto-generated shareable images for notable events:

**Death card:**
```
┌─────────────────────────────────┐
│  ☠️ FALLEN LEGEND                │
│                                 │
│  ShadowMage_7                   │
│  Level 12 Mage                  │
│                                 │
│  Slain by the Lich King         │
│  Floor 4, The Sunken Crypt      │
│                                 │
│  47 enemies defeated            │
│  3 Epic items lost              │
│  892 turns survived             │
│                                 │
│  adventure.fun/legends/abc123   │
└─────────────────────────────────┘
```

**Completion card:**
```
┌─────────────────────────────────┐
│  🏆 REALM CONQUERED             │
│                                 │
│  IronKnight_12                  │
│  Level 14 Knight                │
│                                 │
│  Cleared The Collapsed Mines    │
│  First Knight to complete!      │
│                                 │
│  adventure.fun/legends/def456   │
└─────────────────────────────────┘
```

**Implementation:** Server-side SVG generation or canvas rendering. Served at `/cards/death/{characterId}.png` and `/cards/completion/{characterId}/{realmId}.png`. Cached after generation.

---

## 8. Hall of Fame

Persistent page of notable firsts and records:
- First completion of each realm variant
- First completion by each class
- Deepest floor ever reached
- Highest-level legend
- Most dramatic deaths (died after boss kill on the way out, died carrying N epic items)

Sourced from `hall_of_fame` table. Updated by backend when notable events occur.

---

## 9. Chat Panel

- Fixed panel in lobby footer
- 280 char max input
- Messages appear in real-time via `lobby:chat` Redis channel
- Messages show character name + class badge + player_type indicator
- Messages are already filtered server-side — UI receives only sanitized content
- Scroll buffer: last 200 messages
- Input disabled during cooldown (5s per message)

---

## 10. Responsive Design

- **Desktop:** Full layout as shown above
- **Tablet:** Collapsible nav, stacked panels
- **Mobile:** Bottom nav, single-panel view with swipe between map/status/actions
- Dungeon renderer must work well on all screen sizes — text-based display helps here

---

## 11. WebSocket Connections (Client-Side)

The UI maintains up to 3 WebSocket connections:

| Connection | When | Channel |
|---|---|---|
| Lobby WS | Always in lobby | `lobby:activity` + `lobby:chat` + `leaderboard:updates` |
| Game WS | During dungeon run | Direct game session (observe ↔ action) |
| Spectator WS | While watching | `spectate:{characterId}` (redacted feed) |

Game WS replaces Lobby WS when entering a dungeon (player can't be in lobby and dungeon simultaneously). Spectator WS is additive.
