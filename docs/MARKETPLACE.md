# Adventure.fun — Marketplace Spec

> **Related:** [ECONOMY.md](./ECONOMY.md) for currency model · [BACKEND.md](./BACKEND.md) for DB schema and auth · [AGENT_API.md](./AGENT_API.md) for endpoint contracts · [GAME_DESIGN.md](./GAME_DESIGN.md) for item/inventory rules

## 1. Overview

The marketplace is a P2P item exchange where sellers list items for USDC and buyers pay sellers directly via x402 dynamic `payTo` routing. The server never custodies funds — it orchestrates listings, escrows items, and verifies payments.

**Revenue model:**
- **Gold listing fee** (percentage of NPC sell price) — charged upfront to seller, non-refundable
- **Dead seller listings** — when a seller's character dies, active listings persist but `payTo` routes to the platform wallet instead of the seller's wallet. Thematically: "loot from fallen legends, sold by the house."

**Access:** Lobby only. Players cannot browse, buy, or list while in a dungeon.

---

## 2. Marketplace Flow

### Listing

```
Seller in lobby
    │
    ├── Selects item from inventory
    ├── Sets USDC price (free market, no bounds)
    │
    ▼
POST /marketplace/list
    │
    ├── Validate: character alive, item owned, not equipped, not in dungeon
    ├── Calculate listing fee: ceil(item.sell_price * fee_percentage)
    ├── Deduct gold listing fee from character
    ├── Transfer item: owner_type → 'escrow', owner_id → listing_id
    ├── Create listing record
    │
    ▼
Item is now escrowed and invisible to all character inventory operations
```

### Buying

```
Buyer in lobby
    │
    ├── Browses marketplace listings
    ├── Selects item to buy
    │
    ▼
POST /marketplace/buy/:listingId
    │
    ├── Server looks up listing
    ├── Determines payTo:
    │     ├── Seller alive → payTo = seller's wallet address
    │     └── Seller dead  → payTo = platform wallet address
    ├── Returns 402 Payment Required
    │     payTo: determined above
    │     amount: listing USDC price
    │
    ▼
Buyer's wallet pays via x402 facilitator (direct on-chain transfer)
    │
    ▼
Buyer retries POST /marketplace/buy/:listingId with payment proof
    │
    ├── Server verifies payment via facilitator
    ├── Transfer item: owner_type → 'character', owner_id → buyer's character_id
    ├── Mark listing as sold
    ├── Log transaction
    │
    ▼
Item appears in buyer's inventory
```

### Cancellation

```
Seller in lobby (character must be alive)
    │
    ▼
POST /marketplace/cancel/:listingId
    │
    ├── Validate: seller owns listing, listing is active
    ├── Transfer item: owner_type → 'character', owner_id → seller's character_id
    ├── Mark listing as cancelled
    ├── Gold listing fee is NOT refunded
    │
    ▼
Item returns to seller's inventory
```

### Seller Death

```
Character dies
    │
    ├── Normal death processing (corpse container, legend page, etc.)
    ├── Active marketplace listings are NOT cancelled
    ├── Listings remain active with status 'orphaned'
    ├── payTo routing changes: platform wallet instead of seller wallet
    │
    ▼
If a listing sells after seller death:
    ├── USDC goes to platform wallet (revenue)
    ├── Item transfers to buyer normally
    └── Gold fee was already collected at listing time
```

---

## 3. Listing Fee

### Model

Percentage of the item's NPC sell price (`ItemTemplate.sell_price`), charged in gold.

```
listing_fee = ceil(item.sell_price * marketplace_fee_percentage)
```

### Configuration

```json
{
  "marketplace_fee_percentage": 0.10,
  "marketplace_min_fee": 1
}
```

- `marketplace_fee_percentage`: Config-driven, starting at 10%. Tunable.
- `marketplace_min_fee`: Minimum 1 gold per listing (prevents zero-fee listings on items with very low NPC value).

### Rules

- Charged **upfront** when the listing is created
- **Non-refundable** — cancellation does not return the fee
- Deducted from character's gold balance — listing rejected if insufficient gold
- Fee is a **gold sink**, not USDC

---

## 4. Item Escrow Model

### The Problem

A simple `is_listed: true` flag on inventory items is fragile. Every piece of code that touches items (equip, consume, sell to NPC, drop, use in combat, transfer to corpse) would need to check the flag. Miss one and a listed item gets used mid-auction.

### The Solution: Physical Relocation via `owner_type`

Items use a polymorphic ownership model:

```sql
-- Replace character_id FK with polymorphic ownership
ALTER TABLE inventory_items
  ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'character'
    CHECK (owner_type IN ('character', 'escrow', 'corpse')),
  ADD COLUMN owner_id UUID NOT NULL;
```

| owner_type | owner_id | Meaning |
|---|---|---|
| `character` | character UUID | Normal inventory — visible to all game logic |
| `escrow` | listing UUID | Marketplace escrow — invisible to character operations |
| `corpse` | corpse_container UUID | Dropped on death — invisible to character operations |

**All existing inventory queries** naturally exclude escrowed and corpse items because they filter on `WHERE owner_type = 'character' AND owner_id = :characterId`. No changes needed to game logic, combat, shops, equip/unequip, or dungeon code.

### Lifecycle

```
Normal inventory:  owner_type='character', owner_id=character_id
    │
    ├── List on marketplace ──► owner_type='escrow', owner_id=listing_id
    │                               │
    │                               ├── Sold ──► owner_type='character', owner_id=buyer_character_id
    │                               └── Cancelled ──► owner_type='character', owner_id=seller_character_id
    │
    └── Character dies ──► owner_type='corpse', owner_id=corpse_container_id
                              │
                              └── (Future co-op: recovered ──► owner_type='character', owner_id=recoverer_id)
```

### Escrow + Death Interaction

When a character dies with active marketplace listings:
- Items in regular inventory → `owner_type='corpse'` (normal death behavior)
- Items in escrow → **stay as `owner_type='escrow'`** (listings persist)
- If an escrowed item later sells, it transfers directly to buyer (`owner_type='character'`)
- If an orphaned listing is somehow cancelled (admin action), item is destroyed (no living character to return it to)

### Impact on Existing Schema

The `corpse_containers` table no longer needs a JSONB `items` column — corpse items are just inventory rows with `owner_type='corpse'`. This is cleaner and means corpse items are live queryable rows, not frozen snapshots. This also future-proofs for co-op item recovery.

Updated `corpse_containers`:
```sql
CREATE TABLE corpse_containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_instance_id UUID REFERENCES realm_instances(id) NOT NULL,
  character_id UUID REFERENCES characters(id) NOT NULL,
  floor INTEGER NOT NULL,
  room_id TEXT NOT NULL,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  gold_amount INTEGER DEFAULT 0,     -- gold snapshot (gold is destroyed on death, stored for legend page)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Corpse items are inventory_items with owner_type='corpse', owner_id=corpse_container.id
```

---

## 5. API Endpoints

| Endpoint | Method | Auth | x402 | Description |
|---|---|---|---|---|
| `/marketplace/listings` | GET | Public | No | Browse active listings. Supports filters: rarity, class, item type, price range. |
| `/marketplace/listings/:id` | GET | Public | No | Get single listing detail. |
| `/marketplace/list` | POST | Session | No | Create listing. Body: `{ item_id, price_usd }`. Gold fee deducted. |
| `/marketplace/buy/:id` | POST | Session | Yes (dynamic payTo) | Buy item. Returns 402 with seller/platform wallet as payTo. |
| `/marketplace/cancel/:id` | POST | Session | No | Cancel own listing. Item returned, fee not refunded. |
| `/marketplace/my-listings` | GET | Session | No | View own active listings. |

### Listing Response

```typescript
interface MarketplaceListing {
  id: string
  seller: {
    handle: string
    wallet: string              // truncated for display
    character_name: string
    character_class: string
    character_status: "alive" | "dead"
  }
  item: {
    template_id: string
    name: string
    type: string
    rarity: string
    stats: Record<string, number>
    modifiers: Record<string, number>
    description: string
  }
  price_usd: string             // e.g., "0.50"
  listing_fee_gold: number
  status: "active" | "sold" | "cancelled"
  is_orphaned: boolean          // true if seller's character is dead
  created_at: string
  sold_at: string | null
}
```

### Buy Flow (x402)

```
POST /marketplace/buy/:id
    │
    ▼ (no payment header)
402 Payment Required
Headers:
  PAYMENT-REQUIRED: base64({
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",         // Base mainnet
      price: "0.50",                   // listing price in USDC
      payTo: "0xSellerOrPlatformAddr", // dynamic based on seller status
      asset: "0x...USDC",
    }]
  })
    │
    ▼ (with payment proof)
200 OK
Body: { success: true, item_transferred: true, listing_id: "..." }
```

---

## 6. Marketplace UI (Lobby Panel)

### Browse View

```
┌──────────────────────────────────────────────────────┐
│  MARKETPLACE                          [My Listings]  │
├──────────────────────────────────────────────────────┤
│  Filters: [All ▼] [Any Rarity ▼] [Any Class ▼]     │
│           [Price: Low → High ▼]                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ⚔️ Iron Sword +2 (Rare)              $0.25 USDC    │
│     +12 Attack, +3 Speed                             │
│     Listed by: ShadowKnight_4 (Knight)               │
│     [Buy]                                            │
│                                                      │
│  🛡️ Enchanted Leather Armor (Epic)    $1.50 USDC    │
│     +18 Defense, +5 Evasion, Poison Resist           │
│     Listed by: FallenMage_7 ☠️ (Mage)  ← orphaned   │
│     [Buy]                                            │
│                                                      │
│  📜 Portal Scroll (Common)            $0.10 USDC    │
│     One-use escape to lobby                          │
│     Listed by: CleverRogue_2 (Rogue)                 │
│     [Buy]                                            │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### List Item View

```
┌──────────────────────────────────────────────────────┐
│  LIST ITEM FOR SALE                                  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Item: Iron Sword +2 (Rare)                          │
│  NPC Sell Price: 45 gold                             │
│  Listing Fee: 5 gold (10% of NPC value)              │
│                                                      │
│  Your Price: [________] USDC                         │
│                                                      │
│  Your Gold Balance: 87 gold                          │
│  After Fee: 82 gold                                  │
│                                                      │
│  [List Item]  [Cancel]                               │
│                                                      │
│  ⚠️ Listing fee is non-refundable.                   │
│  ⚠️ Item will be held in escrow until sold/cancelled.│
│                                                      │
└──────────────────────────────────────────────────────┘
```

Orphaned listings (dead seller) show a ☠️ skull badge and note that proceeds go to the house.

---

## 7. Database Schema

```sql
CREATE TABLE marketplace_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id UUID REFERENCES accounts(id) NOT NULL,
  seller_character_id UUID REFERENCES characters(id) NOT NULL,
  seller_wallet TEXT NOT NULL,
  item_id UUID REFERENCES inventory_items(id) NOT NULL,
  item_snapshot JSONB NOT NULL,         -- frozen item details at list time (for display after sale)
  price_usd NUMERIC(10,4) NOT NULL,
  listing_fee_gold INTEGER NOT NULL,
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'sold', 'cancelled')),
  is_orphaned BOOLEAN DEFAULT FALSE,   -- set to true when seller character dies
  buyer_account_id UUID REFERENCES accounts(id),
  buyer_character_id UUID REFERENCES characters(id),
  payment_tx_hash TEXT,
  payment_recipient TEXT,              -- actual wallet that received payment (seller or platform)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sold_at TIMESTAMPTZ
);

CREATE INDEX idx_listings_active ON marketplace_listings(status) WHERE status = 'active';
CREATE INDEX idx_listings_seller ON marketplace_listings(seller_character_id);
```

### Death Trigger

When a character dies, in addition to normal death processing:

```sql
-- Mark all active listings by this character as orphaned
UPDATE marketplace_listings
SET is_orphaned = TRUE
WHERE seller_character_id = :dead_character_id
  AND status = 'active';
```

No items are moved — escrowed items stay in escrow. Only the `payTo` routing changes at buy time.

---

## 8. Security Considerations

### Item Duplication Prevention

- Items are physically relocated to escrow (`owner_type='escrow'`) — they cannot exist in both inventory and marketplace simultaneously
- The `inventory_items.id` is a unique FK on the listing — one item, one listing
- Buy and cancel operations are wrapped in DB transactions with row-level locks

### Price Manipulation

- Free market pricing means price manipulation is possible (artificially low prices for item transfers between accounts)
- Acceptable for v1 — the gold listing fee provides a small cost to manipulation
- Monitor for patterns if needed (same wallet buying from itself via alt accounts)

### Payment Verification

- Server verifies payment via x402 facilitator before transferring the item
- Payment must match the exact amount and payTo address specified in the 402 response
- Transaction hash logged in `payment_tx_hash` for audit trail

### Dead Seller Routing

- `payTo` determination happens at buy-time, not list-time
- Server checks `characters.status` for the seller's character when building the 402 response
- If dead → `payTo = platform_wallet` (configured in server env)
- Logged in `payment_recipient` column for transparency

### Rate Limiting

- Listing creation: max 10 per minute per account (prevents spam even with fee)
- Buy attempts: max 5 per minute per account (prevents 402 spam)
- Cancel: max 10 per minute per account

---

## 9. Configuration

All marketplace parameters are config-driven:

```json
{
  "marketplace": {
    "enabled": true,
    "fee_percentage": 0.10,
    "min_fee_gold": 1,
    "platform_wallet": "0x...",
    "max_listings_per_minute": 10,
    "max_buys_per_minute": 5,
    "supported_chains": ["eip155:8453", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"]
  }
}
```

---

## 10. Marketplace in the Milestone Plan

The marketplace is a **v1.5 feature** — designed and documented now, built after core game loop is solid. Estimated effort: 3-5 days.

**Prerequisites:**
- `owner_type` / `owner_id` inventory model (implement during Milestone 4)
- x402 V2 SDK with dynamic `payTo` support (verify during Milestone 5)
- Lobby UI framework (Milestone 9)

**Implementation order:**
1. Migrate inventory model to `owner_type`/`owner_id` (do this in v1 even without marketplace — it cleans up corpse containers)
2. Add `marketplace_listings` table
3. Implement list/buy/cancel endpoints
4. Wire x402 dynamic `payTo` routing
5. Add marketplace UI panel to lobby
6. Add orphaned listing logic to death handler
