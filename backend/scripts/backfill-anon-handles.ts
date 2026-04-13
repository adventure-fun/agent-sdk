// One-shot script: backfill anon handles for accounts with null handle.
//
// The /auth/connect endpoint auto-assigns a fun anonymous handle
// ("anon-silly-smelly-rat") to every new account and backfills the
// existing nulls on their next login (see backend/src/routes/auth.ts).
// But players who haven't logged in since the handle generator shipped
// still have `null` in the `accounts.handle` column, which means every
// leaderboard row / chat message / character page for their characters
// renders with a bare wallet fragment instead of a friendly handle.
//
// This script runs the same `generateAnonHandle()` function that
// /auth/connect uses, so it stays in sync with the word list and
// profanity filter — no divergence risk vs a hand-written SQL migration.
// Idempotent by construction: only updates rows where `handle IS NULL`.
//
// Usage (from repo root):
//   bun run --env-file .env backend/scripts/backfill-anon-handles.ts
//
// The script exits 0 on success regardless of how many rows were updated
// (zero is a valid outcome if everyone already has a handle). Retries up
// to 5 times per account on unique-constraint collision because the
// handle pool (~126k combinations) is finite and collisions grow
// non-linearly as the account count grows.

import { createClient } from "@supabase/supabase-js"
import { generateAnonHandle } from "../src/game/handle-generator.ts"

const url = process.env["SUPABASE_URL"]
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })

console.log("Fetching accounts with null handle...")
const { data: accounts, error } = await db
  .from("accounts")
  .select("id, wallet_address, player_type")
  .is("handle", null)

if (error) {
  console.error("Failed to fetch accounts:", error.message)
  process.exit(1)
}

const nullAccounts = accounts ?? []
console.log(`Found ${nullAccounts.length} account(s) needing a handle`)

if (nullAccounts.length === 0) {
  console.log("Nothing to backfill. Exiting.")
  process.exit(0)
}

let updated = 0
let failed = 0

for (const account of nullAccounts) {
  const row = account as { id: string; wallet_address: string; player_type: string }
  let lastError: string | null = null
  let success = false

  for (let attempt = 0; attempt < 5 && !success; attempt++) {
    const handle = generateAnonHandle()
    // Scope the update to rows that still have a null handle so this is
    // safe to re-run — we never overwrite a handle that /auth/connect
    // already assigned between when we fetched the list and when we
    // reached this row.
    const { error: updateError } = await db
      .from("accounts")
      .update({ handle })
      .eq("id", row.id)
      .is("handle", null)

    if (!updateError) {
      console.log(`  ✓ ${row.wallet_address.slice(0, 10)}… (${row.player_type}) → ${handle}`)
      success = true
      updated++
      break
    }
    lastError = updateError.message
    // Only retry on unique-violation — any other error is real.
    if (!/duplicate key|unique/i.test(updateError.message)) break
  }

  if (!success) {
    console.error(`  ✗ ${row.wallet_address.slice(0, 10)}… failed: ${lastError}`)
    failed++
  }
}

console.log(`\nDone. ${updated} updated, ${failed} failed.`)
process.exit(failed > 0 ? 1 : 0)
